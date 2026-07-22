/**
 * Rama Bhaiya Planner — server.
 * Zero dependencies. Node built-ins only.
 *
 * Runs in two places from the same code:
 *   - on the PC, double-clicked from Rama Planner.bat, data in data.json
 *   - on free hosting, behind a password, data in a private GitHub repo
 * See store.js for which one is picked and why.
 *
 * Everything is behind a login (auth.js). The moment this is reachable from
 * outside the office, the driver list is the company's most copyable asset.
 *
 * Routing and geocoding deliberately happen in the BROWSER via the Google Maps
 * JavaScript SDK, not here. That lets the API key stay locked to an HTTP-referrer
 * restriction — a key this server called out to would have to be left open to
 * the whole internet, and a leaked open key gets scraped and billed.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { ZONE_ORDER } = require('./areas');
const { readPlate, compareModels } = require('./plates');
const { DEMAND_FACTS } = require('./demand');
const { createStore } = require('./store');
const { flagAreas, flagSummary } = require('./coverage');
const auth = require('./auth');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');
const BACKUP_DIR = path.join(ROOT, 'backups');
const PUBLIC_DIR = path.join(ROOT, 'public');
// Hosts hand you the port to listen on; 4520 is only the local default.
const PORT = Number(process.env.PORT) || 4520;
const HOSTED = !!process.env.PORT;
// Set by netlify.toml. Changes two things: the data is re-read on every request
// instead of once at boot, and saves stop waiting for the write debounce.
// Both because a function container can be discarded the instant it replies.
const SERVERLESS = !!process.env.RAMA_SERVERLESS;

// ---------------------------------------------------------------- persistence

const EMPTY = {
  contacts: [],
  areas: [],
  trips: [],
  settings: {
    mapsApiKey: '',
    homeBase: { label: 'Office (set this in Settings)', lat: 28.656, lng: 77.2745 },
    visitsPerDay: 4,
    minutesPerStop: 45,
    // Average speed for a Delhi auto through mixed traffic, door to door.
    autoSpeedKmh: 18,
    // How much longer the real drive is than the straight line. Measured against
    // the actual Delhi road network over 13 of his own plans: 1.24x (West, open
    // roads) to 1.78x (Central, dense old city), 1.35x weighted by distance.
    detourFactor: 1.35,
  },
  meta: {},
};

const store = createStore({ dataFile: DATA_FILE, backupDir: BACKUP_DIR });

async function loadData() {
  let parsed;
  try {
    parsed = await store.load();
  } catch (err) {
    // Never silently start blank on a read error — that reads as "all my
    // drivers vanished" and invites overwriting the good copy with an empty one.
    throw new Error(`Could not read the data (${err.message}). Fix that before starting.`);
  }
  if (!parsed) return structuredClone(EMPTY);
  return { ...structuredClone(EMPTY), ...parsed, settings: { ...EMPTY.settings, ...(parsed.settings ?? {}) } };
}

/** Returns immediately; store.js batches the actual write. */
function saveData(data) {
  store.save(data);
}

let db = structuredClone(EMPTY); // replaced by loadData() in main()

// ---------------------------------------------------------------- helpers

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

function send(res, code, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 4e6) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- derived stats

const R_KM = 6371;
const rad = (d) => (d * Math.PI) / 180;

/** Straight-line km between two points. Used for ordering when no Maps key is set. */
function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/**
 * Per-area rollup: how strong is he here, when was he last here, what is it worth.
 *
 * The priority score answers one question: "where should Rama sir go next?"
 * It rewards target areas he has never worked, penalises places he was at
 * recently, and leans on the fact that a neighbouring area full of autos means
 * the next one over probably has autos too.
 */
function areaStats(data) {
  const byArea = new Map(data.areas.map((a) => [a.id, { autos: 0, contacts: 0, fleets: 0, captains: 0 }]));

  for (const c of data.contacts) {
    if (!c.areaId || !byArea.has(c.areaId)) continue;
    const st = byArea.get(c.areaId);
    st.contacts += 1;
    st.autos += c.fleetSize ?? 0;
    if ((c.fleetSize ?? 0) > 1) st.fleets += 1;
    if (c.isCaptain) st.captains += 1;
  }

  const visitsByArea = new Map();
  for (const t of data.trips) {
    for (const stop of t.stops ?? []) {
      if (!visitsByArea.has(stop.areaId)) visitsByArea.set(stop.areaId, []);
      visitsByArea.get(stop.areaId).push({ date: t.date, status: t.status, signed: stop.autosSigned ?? 0 });
    }
  }

  const maxAutos = Math.max(1, ...[...byArea.values()].map((s) => s.autos));

  // Distance from each area to the nearest area that already has autos.
  // Recruitment spreads by word of mouth: an untapped patch next door to a
  // strong one is warmer ground than an identical patch across the city, and
  // it is a shorter drive. Without this every untapped target area ties on
  // exactly the same score and the ordering is arbitrary.
  const strongholds = data.areas.filter((a) => (byArea.get(a.id)?.autos ?? 0) > 0 && a.lat && a.lng);
  const nearestStrongKm = (a) => {
    if (!a.lat || !a.lng || !strongholds.length) return null;
    let best = Infinity;
    for (const s of strongholds) {
      if (s.id === a.id) continue;
      best = Math.min(best, haversine(a, s));
    }
    return Number.isFinite(best) ? best : null;
  };

  return data.areas.map((a) => {
    const st = byArea.get(a.id) ?? { autos: 0, contacts: 0, fleets: 0, captains: 0 };
    const visits = (visitsByArea.get(a.id) ?? []).filter((v) => v.status === 'done');
    visits.sort((x, y) => (x.date < y.date ? 1 : -1));
    const lastVisit = visits[0]?.date ?? null;
    const signedTotal = visits.reduce((n, v) => n + v.signed, 0);

    const daysSince = lastVisit
      ? Math.round((Date.parse(today()) - Date.parse(lastVisit)) / 86400000)
      : null;

    // --- priority: 0-100, higher = go here sooner
    const nearKm = nearestStrongKm(a);
    let score = 0;
    if (a.onVisitList) score += 25;                       // he already flagged it
    if (st.autos === 0) score += 30;                      // virgin territory
    else score -= Math.min(20, (st.autos / maxAutos) * 20); // already saturated
    if (daysSince == null) score += 15;                   // never been
    else score += Math.min(15, daysSince / 6);            // going stale
    if (st.captains > 0) score += 8;                      // a captain to meet
    if (st.fleets > 0) score += 7;                        // fleet owners nearby

    // Researched demand (demand.js). A 'gap' outranks a 'proven' hub: proven
    // hubs already have autos competing for the same fares, while the 0%-bus
    // wards are demand nobody is serving. That is where a new auto earns most.
    if (a.demand) {
      score += a.demand.kind === 'gap' ? 30 : 18;
      if (a.demand.confidence === 'high') score += 4;
    }
    // Warm ground, on a smooth curve rather than a threshold. Delhi is dense —
    // nearly every untapped area sits 1-4km from somewhere he already works, so
    // a banded bonus saturates and every target ties on the same score. The
    // exponential keeps the whole range separating things.
    if (nearKm != null) score += 12 * Math.exp(-nearKm / 6);

    return {
      ...a,
      ...st,
      lastVisit,
      daysSince,
      visitCount: visits.length,
      signedTotal,
      nearestStrongKm: nearKm == null ? null : Math.round(nearKm * 10) / 10,
      priority: Math.max(0, Math.min(100, Math.round(score))),
    };
  });
}

// ---------------------------------------------------------------- where drivers work

/**
 * What a driver told us about his working day, in one shape.
 *
 * The spreadsheet only ever knew ONE area per driver — the one he was recruited
 * from, which is roughly where he lives. That is not where he earns. So the app
 * collects three more things straight from the driver's mouth:
 *
 *   startAreaId   where he starts his day
 *   workAreaIds   the areas he moves through
 *   bestAreaId    the one he says gives him the most rides
 *
 * Until someone has actually asked him, fall back to the spreadsheet area and
 * mark it `assumed`. That keeps the heatmap honest: it can show something on day
 * one, while still being able to say how much of what you're looking at is a
 * real answer and how much is a guess.
 */
function workOf(c) {
  const start = c.startAreaId ?? null;
  const roam = Array.isArray(c.workAreaIds) ? c.workAreaIds.filter(Boolean) : [];
  const best = c.bestAreaId ?? null;
  const asked = !!(start || roam.length || best);

  if (asked) return { startAreaId: start ?? c.areaId ?? null, workAreaIds: roam, bestAreaId: best, asked: true };
  return { startAreaId: c.areaId ?? null, workAreaIds: [], bestAreaId: null, asked: false };
}

// A driver's day is worth his whole fleet: a man with 6 autos puts 6 autos on
// those streets, not one. Weighting by fleetSize is what makes one fleet owner
// outrank six solo drivers on the map, which is also how the recruiting maths
// works — one conversation, six autos.
const HEAT_START = 1;   // he begins his day here
const HEAT_ROAM = 1;    // he passes through here
const HEAT_BEST = 2.5;  // he told us he earns most here — this is the real signal

// --- corridors: the roads between a driver's areas
//
// A driver who works three areas does not teleport between them. The streets in
// between are covered too, and treating his patch as three dots understates it
// badly. So a corridor is drawn between every PAIR of his areas that is close
// enough to plausibly shuttle, using the same straight-line geometry the day
// estimate runs on.
//
// Every pair — not a route. He never told us what order he drives them in, and
// inventing one would draw a specific road he may never take. Connecting all
// nearby pairs makes no claim about order: it says "this cluster is his patch".
const CORRIDOR_MAX_KM = 10;   // beyond this it is not a daily shuttle, so no corridor
const CORRIDOR_MIN_KM = 0.4;  // closer than this and the areas already overlap
const CORRIDOR_STEP_KM = 0.7; // spacing of sample points along a corridor
const CORRIDOR_SHARE = 0.3;   // passing through is worth less than working there
const CORRIDOR_NEAR_KM = 1.2; // an area this close to a corridor counts as served

// Corridor samples are collapsed onto a ~440m grid. Without this, 166 drivers
// generate tens of thousands of overlapping points and the browser has to stamp
// every one of them on each repaint.
const HEAT_GRID_DEG = 0.004;

/**
 * Heat for the three map layers, as a point cloud.
 *
 * coverage  where his autos actually are during a working day, corridors included
 * demand    where the research says the rides are
 * gap       demand that his coverage is NOT serving — the recruiting map
 *
 * Gap is deliberately multiplicative rather than a subtraction: an area with
 * huge demand and half the coverage it needs should still glow, and a strong
 * area he has fully covered should go cold rather than merely dim.
 */
function heatPoints(data) {
  const areaById = new Map(data.areas.map((a) => [a.id, a]));
  const raw = new Map(data.areas.map((a) => [a.id, { coverage: 0, known: 0, assumed: 0, drivers: 0 }]));
  const grid = new Map();

  const add = (areaId, weight, asked) => {
    const cell = raw.get(areaId);
    if (!cell) return;
    cell.coverage += weight;
    if (asked) cell.known += weight;
    else cell.assumed += weight;
  };

  const addCorridor = (lat, lng, weight) => {
    const gy = Math.round(lat / HEAT_GRID_DEG);
    const gx = Math.round(lng / HEAT_GRID_DEG);
    const key = `${gy}:${gx}`;
    const cell = grid.get(key);
    if (cell) cell.weight += weight;
    else grid.set(key, { lat: gy * HEAT_GRID_DEG, lng: gx * HEAT_GRID_DEG, weight });
  };

  for (const c of data.contacts) {
    if (c.status && c.status !== 'active') continue;
    const w = Math.max(1, c.fleetSize ?? 1);
    const work = workOf(c);
    const touched = new Set();

    if (work.startAreaId) { add(work.startAreaId, w * HEAT_START, work.asked); touched.add(work.startAreaId); }
    for (const id of work.workAreaIds) {
      if (id === work.bestAreaId) continue; // counted below at the higher weight
      add(id, w * HEAT_ROAM, work.asked);
      touched.add(id);
    }
    if (work.bestAreaId) { add(work.bestAreaId, w * HEAT_BEST, work.asked); touched.add(work.bestAreaId); }
    for (const id of touched) { const cell = raw.get(id); if (cell) cell.drivers += 1; }

    // Corridors only make sense once he has actually been asked. Drawing them
    // from a single spreadsheet home address would invent movement nobody
    // reported — and one area on its own has nothing to connect to anyway.
    if (!work.asked || touched.size < 2) continue;

    const nodes = [...touched]
      .map((id) => areaById.get(id))
      .filter((a) => a?.lat && a?.lng);

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const km = haversine(nodes[i], nodes[j]);
        if (km > CORRIDOR_MAX_KM || km < CORRIDOR_MIN_KM) continue;
        const steps = Math.max(2, Math.round(km / CORRIDOR_STEP_KM));
        // Endpoints are skipped — the areas themselves already carry that heat.
        for (let k = 1; k < steps; k++) {
          const t = k / steps;
          addCorridor(
            nodes[i].lat + (nodes[j].lat - nodes[i].lat) * t,
            nodes[i].lng + (nodes[j].lng - nodes[i].lng) * t,
            w * CORRIDOR_SHARE
          );
        }
      }
    }
  }

  const demandRaw = (a) => {
    if (!a.demand) return 0;
    // A 'gap' ward (no bus service at all) is worth more than a 'proven' hub:
    // proven hubs already have autos competing for the same fares.
    const base = a.demand.kind === 'gap' ? 1 : 0.72;
    const conf = a.demand.confidence === 'high' ? 1.15 : a.demand.confidence === 'low' ? 0.85 : 1;
    return Math.min(1, base * conf);
  };

  const corridors = [...grid.values()];
  const maxCoverage = Math.max(1, ...[...raw.values()].map((c) => c.coverage));

  // An area sitting on somebody's corridor is partly served even if no driver
  // named it, so it must not keep scoring as a virgin gap. This credit feeds the
  // gap calculation only — the corridor already draws its own heat, and adding
  // it to the area's point as well would paint the same autos twice.
  const corridorCredit = (a) => {
    let sum = 0;
    for (const cell of corridors) {
      if (Math.abs(cell.lat - a.lat) > 0.02 || Math.abs(cell.lng - a.lng) > 0.02) continue;
      if (haversine(a, cell) <= CORRIDOR_NEAR_KM) sum += cell.weight;
    }
    return sum;
  };

  const areaPoints = data.areas
    .filter((a) => a.lat && a.lng)
    .map((a) => {
      const cell = raw.get(a.id);
      const coverageNorm = cell.coverage / maxCoverage;
      const servedNorm = Math.min(1, (cell.coverage + corridorCredit(a)) / maxCoverage);
      const demand = demandRaw(a);
      return {
        areaId: a.id,
        name: a.name,
        zone: a.zone,
        lat: a.lat,
        lng: a.lng,
        coverage: Math.round(cell.coverage * 100) / 100,
        coverageNorm: Math.round(coverageNorm * 1000) / 1000,
        // Softened so one monster area does not flatten the whole city to blue.
        coverageHeat: Math.round(Math.pow(coverageNorm, 0.6) * 1000) / 1000,
        demand: Math.round(demand * 1000) / 1000,
        gap: Math.round(demand * (1 - servedNorm) * 1000) / 1000,
        drivers: cell.drivers,
        knownShare: cell.coverage ? Math.round((cell.known / cell.coverage) * 100) : 0,
        assumedOnly: cell.coverage > 0 && cell.known === 0,
      };
    });

  // Corridor cells carry coverage only. There is no researched demand for a
  // stretch of road between two areas, so demand and gap stay at zero and those
  // two layers are left showing areas alone.
  const corridorPoints = corridors.map((cell) => ({
    lat: cell.lat,
    lng: cell.lng,
    corridor: true,
    coverage: Math.round(cell.weight * 100) / 100,
    coverageHeat: Math.round(Math.pow(Math.min(1, cell.weight / maxCoverage), 0.6) * 1000) / 1000,
    demand: 0,
    gap: 0,
  }));

  return [...areaPoints, ...corridorPoints];
}

/** How much of the coverage picture is a real answer vs the spreadsheet guess. */
function workProgress(data) {
  const active = data.contacts.filter((c) => !c.status || c.status === 'active');
  const asked = active.filter((c) => workOf(c).asked);
  return {
    drivers: active.length,
    asked: asked.length,
    remaining: active.length - asked.length,
    pct: active.length ? Math.round((asked.length / active.length) * 100) : 0,
    autosAsked: asked.reduce((n, c) => n + Math.max(1, c.fleetSize ?? 1), 0),
    autosTotal: active.reduce((n, c) => n + Math.max(1, c.fleetSize ?? 1), 0),
  };
}

/**
 * Fleet broken down by auto model, read from the number plates.
 *
 * Computed on every read rather than stamped in at import: the model is derived
 * from the plate, so a correction to a plate in the app shows up immediately and
 * a change to the rule needs no re-import.
 */
function modelStats(data) {
  const byModel = new Map();

  for (const c of data.contacts) {
    for (const v of c.vehicles) {
      const p = readPlate(v.number);
      if (!p.ok) continue;
      if (!byModel.has(p.model)) {
        byModel.set(p.model, {
          model: p.model,
          kind: p.kind,
          count: 0,
          areas: new Map(),
          owners: new Map(),
          plates: [],
        });
      }
      const st = byModel.get(p.model);
      st.count += 1;
      st.plates.push(v.number);
      if (c.areaId) st.areas.set(c.areaId, (st.areas.get(c.areaId) ?? 0) + 1);
      st.owners.set(c.id, (st.owners.get(c.id) ?? 0) + 1);
    }
  }

  const areaName = (id) => data.areas.find((a) => a.id === id)?.name ?? 'Unknown';
  const contactName = (id) => data.contacts.find((c) => c.id === id)?.name ?? 'Unknown';
  const total = [...byModel.values()].reduce((n, s) => n + s.count, 0);

  return [...byModel.values()]
    .sort((a, b) => compareModels(a.model, b.model))
    .map((s) => ({
      model: s.model,
      kind: s.kind,
      count: s.count,
      share: total ? Math.round((s.count / total) * 1000) / 10 : 0,
      areaCount: s.areas.size,
      topAreas: [...s.areas.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 4)
        .map(([id, n]) => ({ areaId: id, name: areaName(id), count: n })),
      topOwners: [...s.owners.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, 3)
        .map(([id, n]) => ({ contactId: id, name: contactName(id), count: n })),
      sample: s.plates[0] ?? '',
    }));
}

/**
 * @param stats  flagged areaStats, passed in when the caller has already built
 *               them — they cost a full heat pass and /api/data needs them anyway.
 */
function summary(data, stats = flagAreas(areaStats(data), heatPoints(data))) {
  const autos = data.contacts.reduce((n, c) => n + (c.fleetSize ?? 0), 0);
  const covered = stats.filter((a) => a.autos > 0).length;
  return {
    contacts: data.contacts.length,
    autos,
    areas: stats.length,
    covered,
    untapped: stats.length - covered,
    onVisitList: stats.filter((a) => a.onVisitList).length,
    // The headline the research exists to produce: researched demand areas
    // where he has nothing yet.
    demandAreas: stats.filter((a) => a.demand).length,
    demandGaps: stats.filter((a) => a.demand && a.autos === 0).length,
    demandGapsUnserved: stats.filter((a) => a.demand?.kind === 'gap' && a.autos === 0).length,
    // Areas explicitly flagged as needing covering — see coverage.js.
    coverageFlags: flagSummary(stats),
    captains: data.contacts.filter((c) => c.isCaptain).length,
    fleetOwners: data.contacts.filter((c) => (c.fleetSize ?? 0) > 1).length,
    autosInFleets: data.contacts.filter((c) => (c.fleetSize ?? 0) > 1).reduce((n, c) => n + c.fleetSize, 0),
    tripsPlanned: data.trips.filter((t) => t.status === 'planned').length,
    tripsDone: data.trips.filter((t) => t.status === 'done').length,
    signedTotal: data.trips.flatMap((t) => t.stops ?? []).reduce((n, s) => n + (s.autosSigned ?? 0), 0),
    zoneOrder: ZONE_ORDER,
    // Plates written down, vs autos known to exist. The gap is fleet autos whose
    // numbers were never collected (Vishal's ten, most of Raj Khan's).
    platesKnown: data.contacts.reduce((n, c) => n + c.vehicles.filter((v) => v.number).length, 0),
    modelCount: modelStats(data).length,
  };
}

// ---------------------------------------------------------------- routing fallback

/**
 * Order stops when no Maps key is set: nearest-neighbour from the home base,
 * then a 2-opt pass to undo the crossings nearest-neighbour always leaves.
 *
 * This is straight-line distance — it ignores the Yamuna, one-ways, and traffic,
 * so treat it as a sensible order rather than a real route. With a Maps key the
 * browser asks Google for the true optimal driving order instead.
 */
function orderStops(home, points) {
  if (points.length <= 2) return points.map((_, i) => i);

  const all = [home, ...points];
  const dist = (i, j) => haversine(all[i], all[j]);

  // nearest neighbour
  const unvisited = new Set(points.map((_, i) => i + 1));
  const tour = [];
  let cur = 0;
  while (unvisited.size) {
    let best = null;
    let bestD = Infinity;
    for (const i of unvisited) {
      const d = dist(cur, i);
      if (d < bestD) { bestD = d; best = i; }
    }
    tour.push(best);
    unvisited.delete(best);
    cur = best;
  }

  // 2-opt. The tour is a LOOP — he drives back to base at the end — so the
  // return leg has to be scored too, or the solver happily leaves him finishing
  // on the far side of the city.
  const legs = () => {
    let total = dist(0, tour[0]);
    for (let i = 0; i < tour.length - 1; i++) total += dist(tour[i], tour[i + 1]);
    return total + dist(tour[tour.length - 1], 0);
  };
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const before = legs();
        const slice = tour.slice(i, j + 1).reverse();
        const candidate = [...tour.slice(0, i), ...slice, ...tour.slice(j + 1)];
        const saved = tour.slice();
        tour.length = 0;
        tour.push(...candidate);
        if (legs() < before - 1e-9) improved = true;
        else { tour.length = 0; tour.push(...saved); }
      }
    }
  }

  return tour.map((i) => i - 1);
}

// ---------------------------------------------------------------- auth

/**
 * Settings as the browser is allowed to see them.
 *
 * The password hash and the session secret sit in the same object as the map
 * key and the home base, and /api/data spreads the whole db straight down the
 * wire. Stripping them here — at the one place settings are handed out — is
 * what stops the login from being readable by anyone already logged in, and
 * from ending up in a browser cache or a screen share.
 */
function publicSettings(s) {
  const { auth: a, ...rest } = s;
  return { ...rest, hasPassword: !!a?.hash };
}

/**
 * Make sure there is a session secret, and take a password from the
 * environment if one was given and none is set yet.
 *
 * The env var only ever SEEDS. If it overrode on every boot, changing the
 * password in Settings would silently undo itself at the next restart — and on
 * free hosting there is a restart every few hours.
 */
function ensureAuth() {
  db.settings.auth ??= {};
  const a = db.settings.auth;
  let changed = false;

  if (!a.secret) {
    a.secret = crypto.randomBytes(32).toString('hex');
    changed = true;
  }
  if (!a.hash && process.env.RAMA_PASSWORD) {
    a.hash = auth.hashPassword(process.env.RAMA_PASSWORD);
    a.gen = (a.gen ?? 0) + 1;
    a.setAt = new Date().toISOString();
    changed = true;
    console.log('  Password taken from the RAMA_PASSWORD setting.');
  }
  if (changed) saveData(db);
}

const loggedIn = (req) => {
  const a = db.settings.auth ?? {};
  if (!a.hash || !a.secret) return false;
  const token = auth.readCookies(req)[auth.COOKIE];
  return !!token && auth.valid(token, a.secret, a.gen ?? 0);
};

const needsSetup = () => !db.settings.auth?.hash;

function grantSession(res, req) {
  const a = db.settings.auth;
  const { token } = auth.issue(a.secret, a.gen ?? 0);
  res.setHeader('Set-Cookie', auth.cookieHeader(auth.COOKIE, token, req, auth.SESSION_DAYS * 86400));
}

/** Everything under /api/auth/. Reachable without a session, by definition. */
async function authApi(req, res, url) {
  const action = url.pathname.split('/')[3] ?? '';
  const method = req.method;

  if (action === 'state' && method === 'GET') {
    return send(res, 200, { needsSetup: needsSetup(), loggedIn: loggedIn(req) });
  }

  // First run only: nobody has set a password yet, so anyone who can reach the
  // page may set one. On the hosted copy this window never opens, because
  // RAMA_PASSWORD is set before the first request ever arrives.
  if (action === 'setup' && method === 'POST') {
    if (!needsSetup()) return send(res, 400, { error: 'A password is already set.' });
    const { password } = await readBody(req);
    const problem = auth.passwordProblem(password);
    if (problem) return send(res, 400, { error: problem });
    db.settings.auth.hash = auth.hashPassword(password);
    db.settings.auth.gen = (db.settings.auth.gen ?? 0) + 1;
    db.settings.auth.setAt = new Date().toISOString();
    saveData(db);
    grantSession(res, req);
    return send(res, 200, { ok: true });
  }

  if (action === 'login' && method === 'POST') {
    const wait = auth.lockedFor(req);
    if (wait) {
      return send(res, 429, { error: `Too many wrong tries. Wait ${Math.ceil(wait / 60)} minute(s) and try again.` });
    }
    const { password } = await readBody(req);
    if (!auth.verifyPassword(password ?? '', db.settings.auth?.hash)) {
      auth.noteFail(req);
      return send(res, 401, { error: 'Wrong password.' });
    }
    auth.noteSuccess(req);
    grantSession(res, req);
    return send(res, 200, { ok: true });
  }

  if (action === 'logout' && method === 'POST') {
    res.setHeader('Set-Cookie', auth.cookieHeader(auth.COOKIE, '', req, 0));
    return send(res, 200, { ok: true });
  }

  // Changing the password needs the old one, even though you are already in:
  // otherwise a phone left unlocked on a table is a permanent takeover.
  if (action === 'password' && method === 'POST') {
    if (!loggedIn(req)) return send(res, 401, { error: 'Sign in first.' });
    const { current, password } = await readBody(req);
    if (!auth.verifyPassword(current ?? '', db.settings.auth?.hash)) {
      return send(res, 401, { error: 'That is not the current password.' });
    }
    const problem = auth.passwordProblem(password);
    if (problem) return send(res, 400, { error: problem });
    db.settings.auth.hash = auth.hashPassword(password);
    // Bumping gen invalidates every cookie ever issued, this browser's included
    // — so a new one is handed out here or the act of changing it logs you out.
    db.settings.auth.gen = (db.settings.auth.gen ?? 0) + 1;
    db.settings.auth.setAt = new Date().toISOString();
    saveData(db);
    grantSession(res, req);
    return send(res, 200, { ok: true, signedOutElsewhere: true });
  }

  return send(res, 404, { error: `No auth route for ${method} ${url.pathname}` });
}

// ---------------------------------------------------------------- api

async function api(req, res, url) {
  const seg = url.pathname.split('/').filter(Boolean); // ['api', 'contacts', ':id']
  const [, resource, id] = seg;
  const method = req.method;

  // ---- data
  if (resource === 'data' && method === 'GET') {
    const heat = heatPoints(db);
    const stats = flagAreas(areaStats(db), heat);
    return send(res, 200, {
      ...db,
      settings: publicSettings(db.settings),
      areaStats: stats,
      modelStats: modelStats(db),
      summary: summary(db, stats),
      heatPoints: heat,
      workProgress: { ...workProgress(db), corridorCells: heat.filter((p) => p.corridor).length },
      demandFacts: DEMAND_FACTS,
      storage: store.status(),
    });
  }

  // ---- contacts
  if (resource === 'contacts') {
    if (method === 'POST') {
      const body = await readBody(req);
      if (!String(body.name ?? '').trim()) return send(res, 400, { error: 'Name is required.' });
      const contact = {
        id: uid(),
        name: String(body.name).trim(),
        altNames: [],
        phone: String(body.phone ?? '').replace(/\D/g, '').slice(-10),
        phones: [String(body.phone ?? '').replace(/\D/g, '').slice(-10)].filter(Boolean),
        areaId: body.areaId ?? null,
        areaRaw: '',
        tenure: body.tenure ?? 'own',
        reference: body.reference ?? '',
        parking: '',
        isCaptain: !!body.isCaptain,
        fleetSize: Number(body.fleetSize) > 0 ? Number(body.fleetSize) : 1,
        fleetType: Number(body.fleetSize) > 1 ? 'multi' : 'solo',
        declaredFleet: Number(body.fleetSize) || 0,
        vehicles: [],
        status: 'active',
        notes: body.notes ?? '',
        source: 'app',
        excelRows: [],
        createdAt: new Date().toISOString(),
      };
      db.contacts.push(contact);
      saveData(db);
      return send(res, 201, contact);
    }

    if (id && method === 'PUT') {
      const body = await readBody(req);
      const c = db.contacts.find((x) => x.id === id);
      if (!c) return send(res, 404, { error: 'Contact not found.' });
      const allowed = ['name', 'phone', 'areaId', 'tenure', 'reference', 'isCaptain', 'fleetSize', 'notes', 'status', 'parking'];
      for (const k of allowed) if (k in body) c[k] = body[k];

      // These three are spreadsheet columns, so by default a re-import would
      // overwrite them and quietly undo the correction. Marking them as edited
      // here is what makes the importer keep his version instead — same idea as
      // areaIdOverride, which already exists for the area column.
      for (const k of ['tenure', 'reference', 'parking']) {
        if (k in body) c.overrides = { ...(c.overrides ?? {}), [k]: true };
      }
      if ('phones' in body) c.overrides = { ...(c.overrides ?? {}), phones: true };
      if ('areaId' in body) c.areaIdOverride = true; // survive the next Excel re-import
      if ('fleetSize' in body) c.fleetSize = Math.max(0, Number(body.fleetSize) || 0);

      // Numbers. The primary and the alternates are edited in two different
      // places on the same form, so the whole list is rebuilt from whatever was
      // sent. The previous version replaced `phones` with just the primary,
      // which silently deleted the second number of anyone reachable on two.
      if ('phone' in body || 'phones' in body) {
        const clean = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);
        const primary = clean('phone' in body ? body.phone : c.phone);
        const rest = ('phones' in body ? body.phones ?? [] : c.phones ?? []).map(clean);
        c.phones = [...new Set([primary, ...rest])].filter(Boolean);
        c.phone = c.phones[0] ?? '';
      }

      // Where he actually works, as told to us by him. Written only when the
      // caller sends it, so a plain edit of his phone number cannot wipe a
      // field answer that took a conversation to get.
      if ('startAreaId' in body || 'workAreaIds' in body || 'bestAreaId' in body) {
        const real = (id) => (id && db.areas.some((a) => a.id === id) ? id : null);
        if ('startAreaId' in body) c.startAreaId = real(body.startAreaId);
        if ('workAreaIds' in body) {
          c.workAreaIds = [...new Set((body.workAreaIds ?? []).map(real).filter(Boolean))];
        }
        if ('bestAreaId' in body) c.bestAreaId = real(body.bestAreaId);
        // The best area must be somewhere he actually goes, or the heat lights
        // up a place he never visits.
        if (c.bestAreaId && c.bestAreaId !== c.startAreaId && !(c.workAreaIds ?? []).includes(c.bestAreaId)) {
          c.workAreaIds = [...(c.workAreaIds ?? []), c.bestAreaId];
        }
        c.workUpdatedAt = new Date().toISOString();
      }
      saveData(db);
      return send(res, 200, c);
    }
  }

  // ---- areas
  if (resource === 'areas' && id && method === 'PUT') {
    const body = await readBody(req);
    const a = db.areas.find((x) => x.id === id);
    if (!a) return send(res, 404, { error: 'Area not found.' });
    for (const k of ['name', 'zone', 'lat', 'lng', 'onVisitList', 'notes']) if (k in body) a[k] = body[k];
    if ('lat' in body || 'lng' in body) a.coordsSource = body.coordsSource ?? 'manual';
    saveData(db);
    return send(res, 200, a);
  }

  // ---- trips
  if (resource === 'trips') {
    if (method === 'GET') return send(res, 200, db.trips);

    if (method === 'POST') {
      const body = await readBody(req);
      const areaIds = (body.areaIds ?? []).filter((x) => db.areas.some((a) => a.id === x));
      if (!areaIds.length) return send(res, 400, { error: 'Pick at least one area to visit.' });

      const trip = {
        id: uid(),
        date: body.date || today(),
        status: 'planned',
        startLabel: body.startLabel ?? db.settings.homeBase.label,
        start: body.start ?? { lat: db.settings.homeBase.lat, lng: db.settings.homeBase.lng },
        stops: areaIds.map((areaId) => ({
          areaId,
          autosSigned: 0,
          met: '',
          notes: '',
          done: false,
          followUpDate: '',
        })),
        routeSource: 'unordered',
        totalKm: null,
        totalMin: null,
        notes: body.notes ?? '',
        createdAt: new Date().toISOString(),
      };
      db.trips.push(trip);
      saveData(db);
      return send(res, 201, trip);
    }

    if (id && method === 'PUT') {
      const body = await readBody(req);
      const t = db.trips.find((x) => x.id === id);
      if (!t) return send(res, 404, { error: 'Trip not found.' });
      for (const k of ['date', 'status', 'stops', 'notes', 'start', 'startLabel', 'routeSource', 'totalKm', 'totalMin']) {
        if (k in body) t[k] = body[k];
      }
      saveData(db);
      return send(res, 200, t);
    }

    if (id && method === 'DELETE') {
      const i = db.trips.findIndex((x) => x.id === id);
      if (i < 0) return send(res, 404, { error: 'Trip not found.' });
      db.trips.splice(i, 1);
      saveData(db);
      return send(res, 200, { ok: true });
    }
  }

  // ---- estimate a day's driving. No external routing service, ever: this runs
  // instantly, offline, and cannot fail.
  if (resource === 'route' && method === 'POST') {
    const body = await readBody(req);
    const home = body.start ?? db.settings.homeBase;
    const areas = (body.areaIds ?? []).map((x) => db.areas.find((a) => a.id === x)).filter(Boolean);
    if (!areas.length) return send(res, 400, { error: 'No areas given.' });

    const stopMin = areas.length * (db.settings.minutesPerStop ?? 45);
    const speed = db.settings.autoSpeedKmh || 18;
    const detour = db.settings.detourFactor || 1.35;

    const order = orderStops(home, areas);
    const ordered = order.map((i) => areas[i]);

    let crowKm = 0;
    let prev = home;
    const legs = [];
    for (const a of ordered) {
      const d = haversine(prev, a);
      crowKm += d;
      legs.push({ areaId: a.id, km: Math.round(d * detour * 10) / 10 });
      prev = a;
    }
    crowKm += haversine(prev, home); // return leg

    // Roads are never straight. Measured against the real Delhi road network
    // across 13 of his own plans, the drive is 1.24x to 1.78x the crow-flies
    // distance (1.35x weighted by distance). Reporting the raw straight line
    // would understate a real day by about a third and he'd run out of daylight.
    const roadKm = crowKm * detour;
    const driveMin = Math.round((roadKm / speed) * 60);

    return send(res, 200, {
      order: ordered.map((a) => a.id),
      legs,
      crowKm: Math.round(crowKm * 10) / 10,
      totalKm: Math.round(roadKm * 10) / 10,
      driveMin,
      stopMin,
      totalMin: driveMin + stopMin,
      source: 'estimate',
      speedKmh: speed,
      detourFactor: detour,
    });
  }

  // ---- settings
  if (resource === 'settings' && method === 'PUT') {
    const body = await readBody(req);
    // `auth` is not a setting. It is only ever written by /api/auth/*, or a
    // stray PUT from the settings form would overwrite the password hash with
    // whatever the browser happened to be holding.
    const { auth: _ignored, hasPassword: _also, ...safe } = body;
    db.settings = { ...db.settings, ...safe };
    saveData(db);
    return send(res, 200, publicSettings(db.settings));
  }

  return send(res, 404, { error: `No API route for ${method} ${url.pathname}` });
}

// ---------------------------------------------------------------- static

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Never let a crafted path climb out of public/.
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  // Read whole rather than stream. These are four small files, and a stream
  // needs a real socket to pipe into — the Netlify adapter hands us a collector
  // object, not one of those.
  res.end(fs.readFileSync(file));
}

// ---------------------------------------------------------------- server

/**
 * Reachable without signing in. Deliberately tiny: the login page itself, the
 * stylesheet it wears, the icon, and the auth endpoints. Note that app.js is
 * NOT here — the whole application, not just its data, sits behind the gate.
 */
const OPEN_PATHS = new Set(['/login', '/style.css', '/favicon.ico']);
const isOpen = (p) => OPEN_PATHS.has(p) || p.startsWith('/api/auth/');

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // On a long-lived server `db` is loaded once in main() and lives in memory.
    // Serverless has no "once": each invocation may be a brand new container,
    // or a warm one holding a copy from minutes ago that another container has
    // since written over. So there, re-read before every request. It costs one
    // Firestore read per call and it is the difference between two people
    // editing safely and one of them silently undoing the other.
    if (SERVERLESS) {
      db = await loadData();
      ensureAuth(); // the session secret has to exist before any cookie is checked
    }

    if (url.pathname.startsWith('/api/auth/')) return await authApi(req, res, url);

    if (!loggedIn(req)) {
      if (!isOpen(url.pathname)) {
        // An API call answers with a status the page can act on; a navigation
        // gets sent to the login screen, because a browser showing raw JSON to
        // Rama sir is not an answer.
        if (url.pathname.startsWith('/api/')) return send(res, 401, { error: 'Signed out.', signedOut: true });
        res.writeHead(302, { Location: '/login' });
        return res.end();
      }
      if (url.pathname === '/login') return serveStatic(res, '/login.html');
    } else if (url.pathname === '/login') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    return serveStatic(res, url.pathname);
  } catch (err) {
    console.error(`  ! ${req.method} ${url.pathname} — ${err.message}`);
    send(res, 500, { error: err.message });
  }
}

const server = http.createServer(handleRequest);

// The browser is opened HERE, not by the .bat, and only once the port is
// actually accepting connections. Opening it first is a race the server loses
// on a cold start: the tab lands on "can't reach this page" a second before the
// server comes up, and it looks broken when it isn't.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
  Port ${PORT} is already busy.

  The planner is probably already running — look for another black window,
  or just open  http://localhost:${PORT}  in your browser.

  If it is not running, something else has taken the port. Close it and retry.
`);
  } else {
    console.error(`\n  Could not start: ${err.message}\n`);
  }
  process.exit(1);
});

// Hosts stop a container by sending SIGTERM and killing it a few seconds later.
// Anything still sitting in the write debounce has to go out in that window, or
// the last edit before a nap is the one that disappears.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log(`\n  ${sig} — saving before shutdown…`);
    const clean = await store.flush();
    console.log(clean ? '  Saved.' : '  ! Could not finish saving.');
    process.exit(clean ? 0 : 1);
  });
}

async function main() {
  db = await loadData();
  ensureAuth();

  server.listen(PORT, () => {
    const s = summary(db);
    const f = s.coverageFlags;
    // ASCII only below: this prints to the Windows console, which is not UTF-8
    // by default and turns a middot into mojibake.
    console.log(`
  Rama Bhaiya Planner
  -------------------
  ${s.contacts} contacts | ${s.autos} autos | ${s.covered}/${s.areas} areas covered | ${s.untapped} untapped
  ${f.urgent} areas flagged as needing coverage (${f.critical} critical)
  Data: ${store.describe()}
`);
    if (needsSetup()) {
      console.log('  No password set yet - the first person to open the page will be asked to choose one.\n');
    }
    if (!db.settings.mapsApiKey) {
      console.log('  No Google Maps key yet - running on free OpenStreetMap. Add one in Settings.\n');
    }

    if (HOSTED) {
      console.log(`  Listening on port ${PORT}.\n`);
    } else {
      console.log(`  Opening your browser at  http://localhost:${PORT}\n  To stop, close this window.\n`);
      if (!process.env.RAMA_NO_OPEN) exec(`start "" http://localhost:${PORT}`, { shell: 'cmd.exe' });
    }
  });
}

// Only listen when started directly (the .bat, or `npm start`). Required from
// the Netlify function, this file must hand over a request handler and open no
// port at all — the function has no port to open.
if (require.main === module) {
  main().catch((err) => {
    console.error(`\n  Could not start: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { handleRequest, store, loadData, ensureAuth, setDb: (d) => { db = d; } };
