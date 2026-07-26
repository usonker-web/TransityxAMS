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

/**
 * Where public/ actually is.
 *
 * On the PC this is simply next to this file. Bundled into a Netlify function it
 * is not: esbuild inlines server.js into the bundle, so __dirname stops meaning
 * "the project folder" and starts meaning "wherever the bundle landed", while
 * netlify.toml's included_files drops public/ next to the working directory.
 * The result is a server that runs perfectly and answers 404 to every page,
 * which is a confusing thing to debug from the outside.
 *
 * So look, rather than assume. All three candidates are checked once at startup.
 */
const PUBLIC_DIR = [
  path.join(ROOT, 'public'),          // the PC, and any plain `node server.js`
  path.join(process.cwd(), 'public'), // Netlify: cwd is the deploy root
  path.join(ROOT, '..', '..', 'public'), // bundle at netlify/functions/, repo above
].find((p) => fs.existsSync(p)) ?? path.join(ROOT, 'public');
// Hosts hand you the port to listen on; 4520 is only the local default.
const PORT = Number(process.env.PORT) || 4520;
const HOSTED = !!process.env.PORT;
/**
 * Are we running per-request rather than continuously? Changes two things: the
 * data is re-read on every request instead of once at boot, and saves stop
 * waiting for the write debounce. Both because a function container can be
 * discarded the instant it replies.
 *
 * Read fresh on every call rather than captured once. netlify.toml's
 * [context.*.environment] block sets variables for the BUILD, not for the
 * function runtime — so a value captured while this module is first evaluated
 * can easily be a value that never arrives. The adapter sets it directly for
 * that reason, and the Lambda markers below are the belt to that braces:
 * Netlify Functions run on Lambda, which always sets them.
 */
const isServerless = () => !!(
  process.env.RAMA_SERVERLESS ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.AWS_LAMBDA_FUNCTION_NAME
);

// store.js decides its write debounce when it is created, which happens a few
// lines below — before any adapter code has had a chance to run. Tell it now.
if (isServerless()) process.env.RAMA_SERVERLESS = '1';

// ---------------------------------------------------------------- persistence

const EMPTY = {
  contacts: [],
  areas: [],
  vehicles: [],
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
  const db = { ...structuredClone(EMPTY), ...parsed, settings: { ...EMPTY.settings, ...(parsed.settings ?? {}) } };
  return hoistVehicles(db);
}

/**
 * Autos used to live inside their owner, as `contact.vehicles`. They are their
 * own records now, because the things you want to say about an auto do not fit
 * inside a person: it has an owner AND a driver who is often somebody else, and
 * on a dual shift it has two drivers.
 *
 * This lifts the old shape into the new one, in memory, on every load. Running
 * on every load rather than once is deliberate — it makes the migration
 * idempotent, so a half-written save, an older backup restored by hand, or a
 * re-import that still writes the old shape all heal themselves on next start
 * instead of quietly producing a planner with no autos in it.
 *
 * Nothing is invented here. The owner is whoever the auto was filed under; the
 * driver is left EMPTY unless the sheet's `driverName` unambiguously matches one
 * contact, because guessing which of three men called Raju drives this auto
 * would be worse than admitting we do not know.
 */
function hoistVehicles(db) {
  // loadData merges EMPTY in first, so this is normally already an array. It is
  // guarded anyway because a migration that throws on unexpected input takes the
  // whole planner down with it, and the input here is a file on someone's disk.
  if (!Array.isArray(db.vehicles)) db.vehicles = [];
  const seen = new Set(db.vehicles.map((v) => v.id));

  // Names are matched case-insensitively and only when exactly one contact
  // answers to them. Ambiguous names stay unlinked and keep the raw text.
  const byName = new Map();
  for (const c of db.contacts) {
    const k = String(c.name ?? '').trim().toLowerCase();
    if (!k) continue;
    byName.set(k, byName.has(k) ? null : c.id); // null marks "more than one"
  }

  for (const c of db.contacts) {
    if (!Array.isArray(c.vehicles)) { delete c.vehicles; continue; }
    for (const v of c.vehicles) {
      if (v.id && seen.has(v.id)) continue;
      const driverId = byName.get(String(v.driverName ?? '').trim().toLowerCase()) ?? null;
      db.vehicles.push({
        id: v.id || `veh_${uid()}`,
        number: v.number ?? '',
        raw: v.raw ?? '',
        ownerId: c.id,
        // The owner very often drives his own single auto, but the sheet only
        // says so by repeating his name — so that is the only case we assume.
        drivers: driverId ? [{ contactId: driverId, shift: '' }] : [],
        dualShift: false,
        driverName: v.driverName ?? '',
        passingDate: v.passingDate ?? '',
        finance: v.finance ?? '',
        financeDetails: v.financeDetails ?? '',
        parking: v.parking ?? '',
        areaId: null,
        status: 'active',
        notes: '',
        source: 'excel',
        excelRow: v.excelRow ?? null,
      });
      if (v.id) seen.add(v.id);
    }
    // Gone from the stored contact: two copies of the same auto is how they
    // drift apart. The API puts a derived copy back on the way out.
    delete c.vehicles;
  }
  return db;
}

/** Every auto filed under one person, newest sheet order preserved. */
const vehiclesOf = (data, contactId) => data.vehicles.filter((v) => v.ownerId === contactId);

/**
 * Two drivers means two shifts, whether or not anyone ticked the box — a second
 * driver on one auto IS the dual shift. The flag stays because an auto can be
 * known to run days and nights before the second man's name is known.
 */
const isDualShift = (v) => !!v.dualShift || (v.drivers ?? []).length > 1;

/** Returns immediately; store.js batches the actual write. */
function saveData(data) {
  store.save(data);
}

let db = structuredClone(EMPTY); // replaced by refreshDb() before anything is served
let dbLoaded = false;

/**
 * Pull the data in and make sure it has a session secret.
 *
 * `dbLoaded` exists because the empty starter object above is genuinely
 * dangerous once a real backend is configured: it looks like a planner with no
 * drivers in it, so the app offers to set a password and the first save writes
 * that emptiness over everything. Nothing may be served until this has
 * succeeded at least once — see handleRequest.
 */
async function refreshDb() {
  db = await loadData();
  ensureAuth();
  dbLoaded = true;
}

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
  const ownerById = new Map(data.contacts.map((c) => [c.id, c]));

  for (const v of data.vehicles) {
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
    // The auto's own area if it has been set, otherwise its owner's — an auto
    // parked somewhere other than where its owner lives is exactly the kind of
    // correction the Vehicles screen exists to record.
    const c = ownerById.get(v.ownerId);
    const areaId = v.areaId ?? c?.areaId ?? null;
    if (areaId) st.areas.set(areaId, (st.areas.get(areaId) ?? 0) + 1);
    if (c) st.owners.set(c.id, (st.owners.get(c.id) ?? 0) + 1);
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
    platesKnown: data.vehicles.filter((v) => v.number).length,
    modelCount: modelStats(data).length,
    // The auto side of the roster, as opposed to the people side.
    vehicles: data.vehicles.length,
    vehiclesDualShift: data.vehicles.filter((v) => isDualShift(v)).length,
    vehiclesNoDriver: data.vehicles.filter((v) => !(v.drivers ?? []).length).length,
    // Autos collected before anyone worked out whose they are — the queue of
    // work the Vehicles screen exists to clear.
    vehiclesNoOwner: data.vehicles.filter((v) => !v.ownerId).length,
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
    // ??= rather than assuming ensureAuth() has run. It always has, in every
    // path that exists today — but when it once did not, this line threw
    // "Cannot set properties of undefined" and said nothing about the real
    // problem, which was that no data had been loaded at all.
    const a = (db.settings.auth ??= {});
    a.hash = auth.hashPassword(password);
    a.gen = (a.gen ?? 0) + 1;
    a.setAt = new Date().toISOString();

    // Wait for this one, unlike every other save. A password that did not
    // persist is not a slow save, it is a locked door: the next request reloads
    // without it and sends you straight back to this screen, having apparently
    // done nothing at all. Say so instead.
    saveData(db);
    if (!(await store.flush({ timeoutMs: 5000 }))) {
      return send(res, 500, {
        error: `Could not save the password — the storage is not writable (${store.describe()}). `
             + `Check /health: if it reports "file" on a hosted site, the storage settings did not reach the server.`,
      });
    }
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
      // workOf() resolves the three "where he actually works" answers and, more
      // importantly, whether anyone has ASKED him — Auto Hunter draws routes
      // only for drivers who have been, because a line between spreadsheet home
      // addresses would invent movement nobody reported. Sent from here so that
      // rule has one definition; a copy of it in the browser would drift from
      // this one the first time either changed.
      // `vehicles` is put back on each contact on the way out, derived from the
      // real records. Autos are stored once, at the top level, but every screen
      // that already asks a driver what he drives keeps working unchanged.
      contacts: db.contacts.map((c) => ({ ...c, work: workOf(c), vehicles: vehiclesOf(db, c.id) })),
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
        status: 'active',
        notes: body.notes ?? '',
        source: 'app',
        excelRows: [],
        createdAt: new Date().toISOString(),
      };
      // Adding someone back lifts the import block on his number (see DELETE
      // below), so the spreadsheet can fill his record in again rather than
      // being skipped forever because of a deletion that has been undone.
      if (contact.phones.length && db.meta?.removedPhones?.length) {
        db.meta.removedPhones = db.meta.removedPhones.filter((p) => !contact.phones.includes(p));
      }

      db.contacts.push(contact);
      saveData(db);
      return send(res, 201, contact);
    }

    if (id && method === 'PUT') {
      const body = await readBody(req);
      const c = db.contacts.find((x) => x.id === id);
      if (!c) return send(res, 404, { error: 'Contact not found.' });
      const allowed = [
        'name', 'phone', 'areaId', 'tenure', 'reference', 'isCaptain', 'fleetSize', 'notes', 'status', 'parking',
        // Papers. Every one optional — drivers turn up with whatever they have,
        // and a form that insists on all five would just be filled with dashes.
        'license', 'address', 'aadhar', 'pan', 'badge',
      ];
      for (const k of allowed) if (k in body) c[k] = body[k];

      // Anything else he carries: a permit, an insurance paper, a police
      // verification. Name it and write what matters in the note.
      if ('docs' in body) {
        c.docs = (Array.isArray(body.docs) ? body.docs : [])
          .map((d) => ({
            id: d.id || `doc_${uid()}`,
            name: String(d.name ?? '').trim(),
            notes: String(d.notes ?? ''),
          }))
          .filter((d) => d.name || d.notes);
      }

      // Who he answers to. Must be a real captain, and not himself — a man
      // reporting to himself would show up inside his own list on the Captains
      // screen and never come out of it.
      if ('captainId' in body) {
        const cap = db.contacts.find((x) => x.id === body.captainId);
        c.captainId = cap && cap.id !== c.id && cap.isCaptain ? cap.id : null;
      }

      // Demoting a captain releases everyone under him. Leaving them pointing at
      // a man who is no longer a captain is how a driver disappears from the
      // screen entirely: not in anyone's list, and not in the unassigned one.
      if ('isCaptain' in body && !c.isCaptain) {
        for (const other of db.contacts) if (other.captainId === c.id) other.captainId = null;
      }

      // These three are spreadsheet columns, so by default a re-import would
      // overwrite them and quietly undo the correction. Marking them as edited
      // here is what makes the importer keep his version instead — same idea as
      // areaIdOverride, which already exists for the area column.
      // isCaptain is in here because the sheet has a Captains tab of its own.
      // Appointing somebody in the app has to outrank that, or the next
      // Re-import Excel demotes him and leaves his men pointing at a man who is
      // no longer a captain.
      for (const k of ['tenure', 'reference', 'parking', 'isCaptain']) {
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

    if (id && method === 'DELETE') {
      const i = db.contacts.findIndex((x) => x.id === id);
      if (i < 0) return send(res, 404, { error: 'Contact not found.' });
      const [gone] = db.contacts.splice(i, 1);

      // The importer rebuilds the roster from the spreadsheet and matches its
      // rows to records BY PHONE, whatever the record's own source says. So a
      // delete that only removed the object would last exactly until the next
      // "Re-import Excel" and then quietly undo itself — the worst kind of bug
      // here, because the driver reappears days later and looks like the app
      // inventing data.
      //
      // Remembering the numbers he was matched by is what lets the importer
      // skip those rows instead. Same principle as areaIdOverride: a decision
      // made in the app has to survive the sheet, or the sheet silently wins.
      const phones = (gone.phones?.length ? gone.phones : [gone.phone]).filter(Boolean);
      if (phones.length) {
        db.meta = db.meta ?? {};
        db.meta.removedPhones = [...new Set([...(db.meta.removedPhones ?? []), ...phones])];
      }

      // His autos go with him. Leaving them behind would produce records owned
      // by nobody, which show up on the Vehicles screen as autos belonging to a
      // driver who is not in the list any more — worse than losing them, because
      // it looks like data corruption rather than a deletion.
      const his = db.vehicles.filter((v) => v.ownerId === gone.id);
      if (his.length) {
        db.meta = db.meta ?? {};
        db.meta.removedPlates = [
          ...new Set([...(db.meta.removedPlates ?? []), ...his.map((v) => v.number).filter(Boolean)]),
        ];
        db.vehicles = db.vehicles.filter((v) => v.ownerId !== gone.id);
      }
      // And he stops being listed as somebody else's driver.
      for (const v of db.vehicles) {
        if ((v.drivers ?? []).some((d) => d.contactId === gone.id)) {
          v.drivers = v.drivers.filter((d) => d.contactId !== gone.id);
        }
      }
      // If he was a captain, the men under him are released rather than left
      // pointing at somebody who is no longer in the list.
      for (const other of db.contacts) if (other.captainId === gone.id) other.captainId = null;

      saveData(db);
      return send(res, 200, { ok: true, name: gone.name, vehicles: his.length });
    }
  }

  // ---- vehicles
  //
  // Autos are their own records, so this is a full CRUD rather than a field on
  // a driver. An auto's owner and its driver are two different links: the man
  // who bought it is regularly not the man behind the handlebars, and on a dual
  // shift there are two of the latter.
  if (resource === 'vehicles') {
    /** Keep only real contact links, and never the same man twice on one auto. */
    const cleanDrivers = (list) => {
      const out = [];
      const seen = new Set();
      for (const d of Array.isArray(list) ? list : []) {
        const cid = typeof d === 'string' ? d : d?.contactId;
        if (!cid || seen.has(cid) || !db.contacts.some((c) => c.id === cid)) continue;
        seen.add(cid);
        out.push({ contactId: cid, shift: ['day', 'night'].includes(d?.shift) ? d.shift : '' });
      }
      return out;
    };
    // Plates are compared and searched everywhere; letting the same auto in as
    // "dl1rw0740" and "DL 1RW 0740" would split it into two.
    const cleanNumber = (n) => String(n ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (method === 'POST') {
      const body = await readBody(req);
      const number = cleanNumber(body.number);

      // The plate IS the auto — it is how they are identified, searched and
      // matched back to the spreadsheet. A record without one is a row you can
      // never point at again, so this is the one field that is required.
      if (!number) return send(res, 400, { error: 'A number plate is needed — that is how an auto is identified.' });

      // Two records for one plate is a contradiction, not a duplicate: they
      // would disagree about who owns it the moment either is edited. (The
      // spreadsheet does contain a few, which the importer reports rather than
      // silently merging — but there is no reason to add more by hand.)
      const already = db.vehicles.find((v) => v.number && v.number === number);
      if (already) {
        const owner = db.contacts.find((c) => c.id === already.ownerId);
        return send(res, 409, {
          error: `${number} is already on record${owner ? ` under ${owner.name}` : ''}. Open that one instead of adding it twice.`,
          id: already.id,
        });
      }

      // Owner is deliberately optional. Autos and drivers are collected
      // separately in the field — a plate written down at a parking stand, a
      // driver met on the road — and linked up later once you know which is
      // whose. Forcing a name here would mean inventing one.
      const ownerId = body.ownerId && db.contacts.some((c) => c.id === body.ownerId) ? body.ownerId : null;

      const vehicle = {
        id: `veh_${uid()}`,
        number,
        raw: '',
        ownerId,
        drivers: cleanDrivers(body.drivers),
        dualShift: !!body.dualShift,
        driverName: '',
        passingDate: body.passingDate ?? '',
        finance: body.finance ?? '',
        financeDetails: body.financeDetails ?? '',
        parking: body.parking ?? '',
        rcNumber: body.rcNumber ?? '',
        batterySerial: body.batterySerial ?? '',
        condition: 0,
        areaId: body.areaId && db.areas.some((a) => a.id === body.areaId) ? body.areaId : null,
        status: body.status === 'idle' ? 'idle' : 'active',
        notes: body.notes ?? '',
        source: 'app',
        excelRow: null,
        createdAt: new Date().toISOString(),
      };
      db.vehicles.push(vehicle);
      saveData(db);
      return send(res, 201, vehicle);
    }

    if (id && method === 'PUT') {
      const body = await readBody(req);
      const v = db.vehicles.find((x) => x.id === id);
      if (!v) return send(res, 404, { error: 'Auto not found.' });

      if ('number' in body) {
        const n = cleanNumber(body.number);
        const clash = n && db.vehicles.find((x) => x.id !== v.id && x.number === n);
        if (clash) return send(res, 409, { error: `${n} is already on another record.`, id: clash.id });
        v.number = n;
      }
      // Empty unlinks. An auto can go back to having no known owner just as
      // easily as it can gain one — that is the point of linking them later.
      if ('ownerId' in body) {
        v.ownerId = body.ownerId && db.contacts.some((c) => c.id === body.ownerId) ? body.ownerId : null;
      }
      if ('drivers' in body) v.drivers = cleanDrivers(body.drivers);
      if ('dualShift' in body) v.dualShift = !!body.dualShift;
      if ('areaId' in body) {
        v.areaId = body.areaId && db.areas.some((a) => a.id === body.areaId) ? body.areaId : null;
      }
      if ('status' in body) v.status = body.status === 'idle' ? 'idle' : 'active';
      // 1 to 5, or 0 for "not rated". Clamped rather than rejected: a rating is
      // a judgement, and the worst thing it can do is refuse to be written down.
      if ('condition' in body) {
        const n = Math.round(Number(body.condition) || 0);
        v.condition = n >= 1 && n <= 5 ? n : 0;
      }
      for (const k of ['passingDate', 'finance', 'financeDetails', 'parking', 'notes', 'rcNumber', 'batterySerial']) {
        if (k in body) v[k] = body[k] ?? '';
      }
      // Anything corrected by hand has to survive the next Re-import Excel, the
      // same way a hand-fixed area does. See the merge in import.js.
      v.edited = true;
      saveData(db);
      return send(res, 200, v);
    }

    if (id && method === 'DELETE') {
      const i = db.vehicles.findIndex((x) => x.id === id);
      if (i < 0) return send(res, 404, { error: 'Auto not found.' });
      const [gone] = db.vehicles.splice(i, 1);
      // Same trap as deleting a driver: the sheet still lists this plate and
      // would rebuild it on the next import, so remember that it was removed.
      if (gone.number) {
        db.meta = db.meta ?? {};
        db.meta.removedPlates = [...new Set([...(db.meta.removedPlates ?? []), gone.number])];
      }
      saveData(db);
      return send(res, 200, { ok: true, number: gone.number });
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
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Say where we looked. A 404 for index.html on a host almost always means
    // public/ did not travel with the code, not that the URL was wrong.
    console.error(`  ! 404 ${pathname} — no ${file} (PUBLIC_DIR=${PUBLIC_DIR}, cwd=${process.cwd()})`);
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  }
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
const OPEN_PATHS = new Set([
  '/login', '/style.css', '/favicon.ico',
  // Delhi's administrative boundaries. Published government geography, the same
  // for everyone, and not a word of it is about this company or its drivers —
  // so the gate protects nothing by holding them back.
  //
  // Open for a second reason as well. Behind the gate, a failure to serve these
  // is invisible from outside: the district map simply does not work and there
  // is no way to tell a bad deploy from a bad browser cache without the
  // password. Reachable, they can be checked in one request.
  '/districts.json', '/subdistricts.json',
]);
const isOpen = (p) => OPEN_PATHS.has(p) || p.startsWith('/api/auth/');

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    /**
     * Deliberately open, and deliberately first — before the data load below,
     * so it still answers when that is what is broken.
     *
     * This exists because the failure it diagnoses is invisible from outside:
     * when the storage variables are missing, createStore quietly falls back to
     * a local file, finds nothing, and serves an empty planner with no error
     * anywhere. From a browser that is indistinguishable from a working site
     * that has lost its data.
     *
     * It reports which backend was chosen and whether anything came back. Never
     * the data, never the credentials.
     */
    if (url.pathname === '/health') {
      let doc = null;
      let error = null;
      // Read through the store rather than reporting on `db`, which has not
      // been loaded at this point and would always look empty.
      try { doc = await store.load(); } catch (err) { error = err.message; }
      return send(res, 200, {
        storage: store.kind,
        serverless: isServerless(),
        dataFound: !!doc,
        contacts: doc?.contacts?.length ?? 0,
        ...(error ? { error } : {}),
      });
    }

    // On a long-lived server `db` is loaded once in main() and lives in memory.
    // Serverless has no "once": each invocation may be a brand new container, or
    // a warm one holding a copy from minutes ago that another container has
    // since written over. So there, re-read before every request. It costs one
    // read per call and is the difference between two people editing safely and
    // one of them silently undoing the other.
    //
    // Everywhere else this is a one-off guard: if main() never ran — exactly
    // what happens when this module is required by the Netlify adapter — load
    // the data now rather than serve the empty starter object.
    if (isServerless() || !dbLoaded) await refreshDb();

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
  await refreshDb();

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
