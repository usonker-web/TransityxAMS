/**
 * Import Rama sir's Excel into data.json.
 *
 *   node import.js "C:\path\to\rama bhaiya drivers list and city data.xlsx"
 *
 * Safe to re-run: it MERGES. Contacts are keyed by phone number, so anything
 * you typed inside the app — visit logs, notes, statuses — survives a re-import
 * of an updated spreadsheet. Nothing you added in the app is ever dropped.
 *
 * THE ONE IDEA THAT SHAPES THIS FILE
 * ---------------------------------
 * A row in the sheet is a VEHICLE, not a person. Vijay Pal has 11 rows on one
 * phone number, each a different auto — he is one man who owns eleven autos.
 * Vishal's row says "10 auots" with nine blank rows under it. Raj Khan's single
 * row says "DL1RAB4567 (10 AUTOS)".
 *
 * So we group rows into CONTACTS keyed by phone, each holding VEHICLES. That
 * turns a flat 190-row list into ~175 people, and — the point — it tells Rama
 * sir that one conversation with Vijay Pal is worth eleven autos, while one
 * with a solo driver is worth one. The planner ranks on that.
 */

const fs = require('fs');
const path = require('path');
const { readWorkbook } = require('./xlsx-read');
const { resolveArea } = require('./areas');
const { AREAS } = require('./areas');
const { DEMAND } = require('./demand');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data.json');

// ------------------------------------------------------------------ helpers

const uid = (() => {
  let n = 0;
  return (p) => `${p}_${(++n).toString(36)}${Date.now().toString(36).slice(-3)}`;
})();

/** Cell -> trimmed string. Excel's "-" placeholder means empty. */
function s(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const out = String(v).trim();
  return out === '-' ? '' : out;
}

/** Phones arrive as numbers, or as "93156/88600" when someone has two. */
function phones(v) {
  if (v == null) return [];
  return String(v)
    .split(/[\/,;&]| or /i)
    .map((p) => p.replace(/\D/g, ''))
    .filter((p) => p.length >= 10)
    .map((p) => p.slice(-10)); // normalise +91 / 0 prefixes
}

const VEHICLE_RE = /\b([A-Z]{2}\s?\d{1,2}\s?[A-Z]{1,3}\s?\d{3,4})\b/i;

/** Pull a real registration out of free text like "DL1RAB4567 (10 AUTOS)". */
function vehicleNumber(raw) {
  const m = s(raw).toUpperCase().match(VEHICLE_RE);
  return m ? m[1].replace(/\s/g, '') : '';
}

/** "10 auots" / "(10 AUTOS)" -> 10. Rama sir's shorthand for a declared fleet. */
function declaredFleet(raw) {
  const m = s(raw).match(/(\d+)\s*(?:autos?|auots?|gaadi|vehicles?)/i);
  return m ? Number(m[1]) : 0;
}

function isCaptainText(raw) {
  return /\bcapt(ain)?\b/i.test(s(raw));
}

/**
 * The Visit list writes zones as "Central east" / "Central  " — his spelling,
 * his spacing. Keep his words, fix only the casing, so the zone reliably
 * matches the colour map and filters in the UI.
 */
function normalizeZone(raw) {
  const z = s(raw).replace(/\s+/g, ' ').trim();
  if (!z) return '';
  return z.split(' ').map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// ------------------------------------------------------------------ parse

function parseDrivers(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    // A row counts if anything past the SR number is filled.
    if (!r.slice(1).some((c) => s(c))) continue;

    out.push({
      excelRow: i + 1,
      sr: s(r[0]),
      name: s(r[1]),
      phoneRaw: s(r[2]),
      phones: phones(r[2]),
      vehicleRaw: s(r[3]),
      tenure: /rent/i.test(s(r[4])) ? 'rent' : 'own',
      areaRaw: s(r[5]),
      reference: s(r[6]),
      parking: s(r[7]),
      passingDate: s(r[8]),
      finance: s(r[9]),
      financeDetails: s(r[10]),
    });
  }
  return out;
}

function parseCaptains(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !s(r[1])) continue;
    out.push({
      name: s(r[1]),
      phones: phones(r[2]),
      vehicleRaw: s(r[3]),
      areaRaw: s(r[4]),
      passingDate: s(r[5]),
    });
  }
  return out;
}

function parseVisitList(rows) {
  const out = [];
  // Row 1 is the "Visit list day wise" banner; row 2 is the real header.
  for (let i = 2; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !s(r[1])) continue;
    out.push({ areaRaw: s(r[1]), zone: normalizeZone(r[2]) });
  }
  return out;
}

// ------------------------------------------------------------------ build

function buildAreas(driverRows, captainRows, visitRows, existing) {
  const byName = new Map(existing.map((a) => [a.name, a]));
  const unresolved = new Set();

  const ensure = (canonical, patch = {}) => {
    let area = byName.get(canonical.name);
    if (!area) {
      area = {
        id: uid('area'),
        name: canonical.name,
        zone: canonical.zone,
        lat: canonical.lat,
        lng: canonical.lng,
        coordsSource: 'builtin',
        onVisitList: false,
        notes: '',
      };
      byName.set(area.name, area);
    }
    Object.assign(area, patch);
    return area;
  };

  // Seed every known area so the map shows untapped territory, not just
  // places that already have drivers. Scouting blank areas is the whole job.
  for (const a of AREAS) ensure(a);

  for (const row of [...driverRows, ...captainRows]) {
    if (!row.areaRaw) continue;
    const canonical = resolveArea(row.areaRaw);
    if (!canonical) unresolved.add(row.areaRaw);
  }

  for (const v of visitRows) {
    const canonical = resolveArea(v.areaRaw);
    if (!canonical) { unresolved.add(v.areaRaw); continue; }
    // His Visit-list zone wins: it is how he actually thinks about the city.
    ensure(canonical, { onVisitList: true, zone: v.zone || canonical.zone });
  }

  // ---- researched demand (see demand.js)
  // Each entry either attaches to one of his areas (mergeWith) or becomes a new
  // one. Attaching matters: his "Ajmeri gate" IS New Delhi Railway Station, so
  // merging tells him his 23 autos there sit on India's busiest station instead
  // of dropping a second pin 600m away that he'd drive to twice.
  const merged = [];
  const added = [];

  for (const d of DEMAND) {
    const demand = {
      kind: d.kind,
      category: d.category,
      reason: d.reason,
      evidence: d.evidence,
      confidence: d.confidence,
      source: d.source,
      researchedName: d.name,
    };

    if (d.mergeWith) {
      const host = byName.get(d.mergeWith);
      if (!host) {
        console.warn(`  ! demand.js: "${d.name}" wants to merge with "${d.mergeWith}", which is not an area. Adding standalone.`);
      } else {
        // Keep HIS coordinates and zone — he knows where he actually goes.
        host.demand = demand;
        merged.push(`${d.name} -> ${d.mergeWith}`);
        continue;
      }
    }

    let area = byName.get(d.name);
    if (!area) {
      area = {
        id: uid('area'),
        name: d.name,
        zone: d.zone,
        lat: d.lat,
        lng: d.lng,
        coordsSource: 'research',
        onVisitList: false,
        notes: '',
        source: 'research',
      };
      byName.set(d.name, area);
      added.push(d.name);
    }
    area.demand = demand;
  }

  return { areas: [...byName.values()], unresolved: [...unresolved], merged, added };
}

/**
 * @param removed  phone numbers of drivers deleted in the app. The sheet still
 *                 has their rows and would rebuild them here, making every
 *                 deletion temporary — so those rows are skipped. See the
 *                 DELETE handler in server.js.
 */
function buildContacts(driverRows, captainRows, areas, existing, removed = []) {
  const areaIdByName = new Map(areas.map((a) => [a.name, a.id]));
  const areaIdOf = (raw) => {
    const c = resolveArea(raw);
    return c ? areaIdByName.get(c.name) : null;
  };

  // Key by phone: one number = one person to call = one conversation.
  const groups = new Map();
  const keyFor = (row) => row.phones[0] || `noPhone:${row.name.toLowerCase()}:${row.areaRaw}`;

  for (const row of driverRows) {
    const key = keyFor(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const captainPhones = new Set(captainRows.flatMap((c) => c.phones));
  const contacts = [];

  for (const [key, rows] of groups) {
    const first = rows[0];

    // Primary name = most frequent non-empty. Shared-phone groups keep the rest.
    const nameCounts = new Map();
    for (const r of rows) if (r.name) nameCounts.set(r.name, (nameCounts.get(r.name) ?? 0) + 1);
    const names = [...nameCounts.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const primaryName = names[0] || '(name not recorded)';

    const vehicles = [];
    let declared = 0;
    for (const r of rows) {
      declared = Math.max(declared, declaredFleet(r.vehicleRaw), declaredFleet(r.parking));
      const number = vehicleNumber(r.vehicleRaw);
      // Blank rows under a fleet line ("10 auots" + 9 blanks) are placeholders
      // for autos whose numbers were never written down — not real records.
      if (!number && !s(r.vehicleRaw)) continue;
      vehicles.push({
        id: uid('veh'),
        number,
        raw: s(r.vehicleRaw),
        driverName: r.name || primaryName,
        passingDate: r.passingDate,
        finance: r.finance,
        financeDetails: r.financeDetails,
        parking: r.parking,
        excelRow: r.excelRow,
      });
    }

    // Fleet size: the sheet undercounts when a fleet was written as one line
    // ("DL1RAB4567 (10 AUTOS)") and overcounts nothing. Take the larger signal.
    const fleetSize = Math.max(rows.length, declared, vehicles.length);

    const distinctNames = names.length;
    const fleetType =
      distinctNames > 1 ? 'group' : fleetSize > 1 ? 'multi' : 'solo';

    const allPhones = [...new Set(rows.flatMap((r) => r.phones))];

    contacts.push({
      id: uid('con'),
      name: primaryName,
      altNames: names.slice(1),
      phone: allPhones[0] ?? '',
      phones: allPhones,
      areaId: areaIdOf(first.areaRaw),
      areaRaw: first.areaRaw,
      tenure: first.tenure,
      reference: first.reference,
      parking: rows.map((r) => r.parking).filter(Boolean).join('; '),
      isCaptain: rows.some((r) => isCaptainText(r.vehicleRaw)) || allPhones.some((p) => captainPhones.has(p)),
      fleetSize,
      fleetType,
      declaredFleet: declared,
      vehicles,
      status: 'active',
      notes: '',
      source: 'excel',
      excelRows: rows.map((r) => r.excelRow),
    });
  }

  // Captains sheet: area leads. Some already exist as drivers; the rest are new.
  const byPhone = new Map();
  for (const c of contacts) for (const p of c.phones) byPhone.set(p, c);

  for (const cap of captainRows) {
    const hit = cap.phones.map((p) => byPhone.get(p)).find(Boolean);
    if (hit) {
      hit.isCaptain = true;
      if (!hit.areaId) hit.areaId = areaIdOf(cap.areaRaw);
      continue;
    }
    contacts.push({
      id: uid('con'),
      name: cap.name,
      altNames: [],
      phone: cap.phones[0] ?? '',
      phones: cap.phones,
      areaId: areaIdOf(cap.areaRaw),
      areaRaw: cap.areaRaw,
      tenure: 'own',
      reference: '',
      parking: '',
      isCaptain: true,
      fleetSize: 0,
      fleetType: 'captain',
      declaredFleet: 0,
      vehicles: [],
      status: 'active',
      notes: '',
      source: 'excel:captains',
      excelRows: [],
    });
  }

  // Drivers deleted in the app. Matched by phone because that is the same key
  // the merge below uses to recognise a sheet row as someone we already know.
  // Done after the captains pass so that a deleted driver who is also listed as
  // a captain stays deleted rather than coming back through the other sheet.
  const blocked = new Set(removed);
  const kept = blocked.size
    ? contacts.filter((c) => !(c.phones ?? []).some((p) => blocked.has(p)))
    : contacts;
  const skipped = contacts.length - kept.length;

  // Merge over anything the user already edited in the app.
  const existingByPhone = new Map();
  for (const c of existing) for (const p of c.phones ?? [c.phone]) if (p) existingByPhone.set(p, c);

  let updated = 0;
  const merged = kept.map((fresh) => {
    const prior = fresh.phones.map((p) => existingByPhone.get(p)).find(Boolean);
    if (!prior) return fresh;
    updated++;
    // Spreadsheet is source of truth for roster facts; the app owns the rest.
    //
    // "Where he works" is app-owned and MUST be carried across. It is not in the
    // sheet and never will be — it comes from asking the driver where he starts
    // and where he earns. Dropping it here would silently wipe every field
    // answer collected since the last import, and the loss would only show up
    // later as a heatmap that quietly went cold.
    // Columns he has corrected by hand in the app. The sheet still wins for
    // everything he has NOT touched — an override is only set when someone
    // actually edited that field on the driver's page.
    const ov = prior.overrides ?? {};

    return {
      ...fresh,
      id: prior.id,
      status: prior.status ?? fresh.status,
      notes: prior.notes ?? '',
      areaId: prior.areaIdOverride ? prior.areaId : fresh.areaId,
      areaIdOverride: prior.areaIdOverride ?? false,
      startAreaId: prior.startAreaId ?? null,
      workAreaIds: prior.workAreaIds ?? [],
      bestAreaId: prior.bestAreaId ?? null,
      workUpdatedAt: prior.workUpdatedAt ?? null,
      // Papers and the chain of command. None of this is in the spreadsheet and
      // none of it ever will be — it comes from the driver handing over a
      // licence, or from deciding who reports to whom. Dropping it here would
      // wipe every document collected since the last import.
      license: prior.license ?? '',
      address: prior.address ?? '',
      aadhar: prior.aadhar ?? '',
      pan: prior.pan ?? '',
      badge: prior.badge ?? '',
      docs: prior.docs ?? [],
      captainId: prior.captainId ?? null,
      overrides: ov,
      tenure: ov.tenure ? prior.tenure : fresh.tenure,
      reference: ov.reference ? prior.reference : fresh.reference,
      parking: ov.parking ? prior.parking : fresh.parking,
      // Appointed or demoted in the app beats the sheet's Captains tab. Without
      // this a captain appointed here is demoted on the next import while the
      // men under him keep pointing at him.
      isCaptain: ov.isCaptain ? prior.isCaptain : fresh.isCaptain,
      // Numbers are UNIONED rather than replaced. A phone is how a sheet row is
      // matched back to this contact, so dropping the sheet's own numbers would
      // orphan the record on the next import and split it into a duplicate.
      // Union keeps the match working and keeps any number he added by hand.
      phones: ov.phones
        ? [...new Set([...(fresh.phones ?? []), ...(prior.phones ?? [])])].filter(Boolean)
        : fresh.phones,
      phone: ov.phones ? (prior.phone || fresh.phone) : fresh.phone,
    };
  });

  // App-only contacts (added by hand, never in the sheet) must not vanish.
  const freshPhones = new Set(merged.flatMap((c) => c.phones));
  const appOnly = existing.filter(
    (c) => c.source !== 'excel' && c.source !== 'excel:captains' && !(c.phones ?? []).some((p) => freshPhones.has(p))
  );

  return { contacts: [...merged, ...appOnly], updated, skipped };
}

/**
 * Autos are their own records now (see hoistVehicles in server.js), so the sheet
 * no longer owns them outright — it owns the roster of plates, and the app owns
 * everything you can only learn by asking: who actually drives it, whether it
 * runs a second shift, where it is parked.
 *
 * So this MERGES rather than rebuilds. An auto touched in the app is matched
 * back to its sheet row and keeps its own version; an untouched one is refreshed
 * from the sheet as before.
 *
 * Matched by plate first, then by sheet row. The second key is what saves a
 * plate corrected by hand: the sheet still says the old number, so matching on
 * number alone would file the correction as a new auto and leave the old one
 * behind as a duplicate.
 */
function mergeVehicles(contacts, prior = [], removedPlates = []) {
  const blocked = new Set(removedPlates);
  const byNumber = new Map();
  const byRow = new Map();
  for (const v of prior) {
    if (v.number) byNumber.set(v.number, v);
    if (v.excelRow != null) byRow.set(v.excelRow, v);
  }

  const out = [];
  const used = new Set();
  let skipped = 0;

  for (const c of contacts) {
    for (const v of c.vehicles ?? []) {
      const num = String(v.number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      // Deleted on the Vehicles screen. The sheet still lists it, and without
      // this the deletion would last until the next import and then undo itself.
      if (num && blocked.has(num)) { skipped++; continue; }

      const was = (num && byNumber.get(num)) || (v.excelRow != null && byRow.get(v.excelRow)) || null;
      if (was) used.add(was.id);
      // Once someone has corrected an auto here, the app owns its details. The
      // sheet keeps only what the app has no opinion about.
      const mine = was?.edited ? was : null;

      out.push({
        id: was?.id ?? v.id,
        number: mine ? mine.number : num,
        raw: v.raw ?? '',
        ownerId: mine ? mine.ownerId : c.id,
        drivers: was?.drivers ?? [],
        dualShift: was?.dualShift ?? false,
        driverName: v.driverName ?? '',
        passingDate: mine ? mine.passingDate : (v.passingDate ?? ''),
        finance: mine ? mine.finance : (v.finance ?? ''),
        financeDetails: mine ? mine.financeDetails : (v.financeDetails ?? ''),
        parking: mine ? mine.parking : (v.parking ?? ''),
        areaId: was?.areaId ?? null,
        status: was?.status ?? 'active',
        notes: was?.notes ?? '',
        // Only ever known from the app — the sheet has no column for any of
        // them, so they are carried across whether or not the record was
        // otherwise edited.
        rcNumber: was?.rcNumber ?? '',
        batterySerial: was?.batterySerial ?? '',
        condition: was?.condition ?? 0,
        edited: was?.edited ?? false,
        source: 'excel',
        excelRow: v.excelRow ?? null,
      });
    }
  }

  // Autos added by hand that were never in the sheet, and any edited record the
  // sheet has since stopped listing. Neither may vanish just because a row moved.
  const kept = prior.filter((v) => !used.has(v.id) && (v.source !== 'excel' || v.edited));
  return { vehicles: [...out, ...kept], skipped, kept: kept.length };
}

// ------------------------------------------------------------------ main

function main() {
  const src = process.argv[2] || path.join(process.env.USERPROFILE ?? '', 'Downloads', 'rama bhaiya drivers list and city data.xlsx');
  if (!fs.existsSync(src)) {
    console.error(`\n  Cannot find the Excel file:\n    ${src}\n\n  Usage: node import.js "C:\\path\\to\\file.xlsx"\n`);
    process.exit(1);
  }

  const prior = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};
  const book = readWorkbook(src);

  const driverRows = parseDrivers(book.get('Drivers') ?? []);
  const captainRows = parseCaptains(book.get('Captians') ?? []);
  const visitRows = parseVisitList(book.get('Visit list') ?? []);

  const removedPhones = prior.meta?.removedPhones ?? [];
  const removedPlates = prior.meta?.removedPlates ?? [];

  const { areas, unresolved, merged, added } = buildAreas(driverRows, captainRows, visitRows, prior.areas ?? []);
  const { contacts, updated, skipped } = buildContacts(driverRows, captainRows, areas, prior.contacts ?? [], removedPhones);

  // A driver may point at a captain who has since been demoted in the sheet, or
  // whose row is gone. Release him rather than leave a link to somebody who is
  // not a captain — that state is invisible on screen, since he shows up in
  // nobody's list and not in the unassigned count either.
  const capIds = new Set(contacts.filter((c) => c.isCaptain).map((c) => c.id));
  let released = 0;
  for (const c of contacts) {
    if (c.captainId && !capIds.has(c.captainId)) { c.captainId = null; released++; }
  }

  // Autos come out of the contacts and become their own records. Anything the
  // app already knew about an auto is merged back in rather than overwritten.
  const { vehicles, skipped: platesSkipped, kept: platesKept } =
    mergeVehicles(contacts, prior.vehicles ?? [], removedPlates);
  for (const c of contacts) delete c.vehicles;

  const data = {
    contacts,
    areas,
    vehicles,
    trips: prior.trips ?? [],
    settings: {
      mapsApiKey: '',
      homeBase: { label: 'Office (set this in Settings)', lat: 28.6560, lng: 77.2745 },
      ...(prior.settings ?? {}),
    },
    meta: {
      importedFrom: path.basename(src),
      importedAt: new Date().toISOString(),
      excelDriverRows: driverRows.length,
      // Carried across deliberately. This object is rebuilt from scratch on
      // every import, so leaving this out would drop the list of deleted
      // drivers and let the very next import undo every deletion.
      removedPhones,
      removedPlates,
    },
  };

  fs.writeFileSync(`${DATA_FILE}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${DATA_FILE}.tmp`, DATA_FILE);

  // ---- report
  const autos = contacts.reduce((n, c) => n + c.fleetSize, 0);
  const fleets = contacts.filter((c) => c.fleetSize > 1).sort((a, b) => b.fleetSize - a.fleetSize);
  const withDrivers = new Set(contacts.map((c) => c.areaId).filter(Boolean));

  // A registration written twice is either a double-entered row or two people
  // claiming one auto. Only Rama sir knows which, so surface it rather than
  // quietly picking a winner and changing his numbers behind his back.
  const ownerById = new Map(contacts.map((c) => [c.id, c]));
  const seenVeh = new Map();
  for (const v of vehicles) {
    if (!v.number) continue;
    if (!seenVeh.has(v.number)) seenVeh.set(v.number, []);
    seenVeh.get(v.number).push({ contact: ownerById.get(v.ownerId) ?? { name: '(owner removed)' }, row: v.excelRow });
  }
  const dupVeh = [...seenVeh.entries()].filter(([, hits]) => hits.length > 1);

  // ASCII only: this prints to the Windows console (see server.js).
  console.log(`\n  Imported ${path.basename(src)}\n`);
  console.log(`    ${driverRows.length} sheet rows  ->  ${contacts.length} contacts  ->  ${autos} autos`);
  console.log(`    ${areas.length} areas (${areas.filter((a) => a.onVisitList).length} on the visit list, ${areas.length - withDrivers.size} with no drivers yet)`);
  console.log(`    ${contacts.filter((c) => c.isCaptain).length} captains, ${contacts.filter((c) => c.captainId).length} drivers under one`);
  if (released) console.log(`    ${released} driver(s) released — their captain is no longer one`);
  if (updated) console.log(`    ${updated} existing contacts refreshed (your notes and visit logs kept)`);
  // Say it out loud. A row silently vanishing from the sheet's count is exactly
  // what would send someone hunting for a parsing bug that isn't there.
  if (skipped) console.log(`    ${skipped} sheet row(s) skipped — deleted in the app (delete them from the sheet too, or they stay listed here every time)`);
  console.log(`    ${vehicles.length} autos on record (${vehicles.filter((v) => v.edited).length} edited here, kept as they are)`);
  if (platesSkipped) console.log(`    ${platesSkipped} plate(s) skipped — deleted on the Vehicles screen`);
  if (platesKept) console.log(`    ${platesKept} auto(s) kept that the sheet no longer lists`);
  const keptWork = contacts.filter((c) => c.startAreaId || c.bestAreaId || (c.workAreaIds ?? []).length).length;
  if (keptWork) console.log(`    ${keptWork} drivers kept their "where he works" answers (not in the sheet — collected in the app)`);

  console.log(`\n  Fleet owners — one call, many autos:`);
  for (const f of fleets.slice(0, 8)) {
    const area = areas.find((a) => a.id === f.areaId)?.name ?? '?';
    const kind = f.fleetType === 'group' ? `${f.altNames.length + 1} drivers on one number` : 'owns';
    console.log(`    ${String(f.fleetSize).padStart(3)} autos   ${f.name.padEnd(22)} ${area.padEnd(16)} (${kind})`);
  }

  const gaps = areas.filter((a) => a.demand && !withDrivers.has(a.id));
  console.log(`\n  Researched demand: ${merged.length} matched to areas you already work, ${added.length} added as new`);
  console.log(`    ${gaps.length} researched demand areas have NO autos of yours yet`);
  const topGaps = gaps.filter((a) => a.demand.kind === 'gap');
  if (topGaps.length) {
    console.log(`\n  Biggest openings (high demand, no bus service, none of your autos):`);
    for (const a of topGaps.slice(0, 6)) console.log(`    ${a.name.padEnd(26)} ${a.zone.padEnd(12)} ${a.demand.reason.slice(0, 62)}`);
  }

  if (dupVeh.length) {
    console.log(`\n  Vehicle numbers written twice — worth a check:`);
    for (const [num, hits] of dupVeh) {
      const names = [...new Set(hits.map((h) => h.contact.name))];
      const rows = hits.map((h) => h.row).join(' & ');
      console.log(
        names.length === 1
          ? `    ${num.padEnd(12)} twice under ${names[0]} (rows ${rows}) — likely the same auto entered twice`
          : `    ${num.padEnd(12)} claimed by ${names.join(' AND ')} (rows ${rows}) — one of these is wrong`
      );
    }
  }

  if (unresolved.length) {
    console.log(`\n  Area names I could not place (add them to areas.js):`);
    for (const u of unresolved) console.log(`    - "${u}"`);
  }
  console.log(`\n  Wrote ${path.relative(process.cwd(), DATA_FILE)}\n`);
}

main();
