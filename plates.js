/**
 * Number-plate reader: registration -> auto model.
 *
 * THE RULE (Rama sir's, confirmed against the real fleet)
 * ------------------------------------------------------
 * A Delhi auto's registration looks like DL1R<SERIES><NUMBER>. The letters
 * after the R are the model:
 *
 *     DL1RU5904   -> "U"
 *     DL1RW0740   -> "W"
 *     DL1RAA4770  -> "AA"    two-letter series are their OWN model,
 *     DL1RAB7643  -> "AB"    not all lumped together as "A"
 *     DL1RAC1944  -> "AC"
 *
 * Plates that aren't DL1R keep their own series so they stay visible rather
 * than being silently dropped or piled into one "other" heap:
 *
 *     DL1NCR0166  -> "DL1-NCR"
 *     UP16DT4426  -> "UP16-DT"
 *     HR55AP2251  -> "HR55-AP"
 *
 * ORDERING
 * --------
 * RTO series are issued in sequence: single letters first (A..Z), then
 * two-letter series (AA, AB, AC...). So M is older stock than AC. Sorting by
 * that sequence rather than alphabetically makes the fleet's age profile
 * readable — alphabetical would put AA/AB/AC first, which is backwards.
 */

const PLATE_RE = /^([A-Z]{2})(\d{1,2})([A-Z]+)(\d+)$/;

/**
 * @returns {{ok:boolean, model:string, series:string, state:string, rto:string,
 *             serial:string, kind:'delhi-auto'|'other-series'|'unreadable'}}
 */
function readPlate(raw) {
  const num = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = num.match(PLATE_RE);
  if (!m) return { ok: false, model: '', series: '', state: '', rto: '', serial: '', kind: 'unreadable' };

  const [, state, rto, series, serial] = m;

  // Delhi auto-rickshaw series: DL<rto>R<model>
  if (state === 'DL' && series.length > 1 && series[0] === 'R') {
    return { ok: true, model: series.slice(1), series, state, rto, serial, kind: 'delhi-auto' };
  }

  return { ok: true, model: `${state}${rto}-${series}`, series, state, rto, serial, kind: 'other-series' };
}

/**
 * Sort key following how RTO series are actually issued: shorter series first
 * (they were exhausted before the longer ones began), then alphabetically.
 * Non-DL1R groups sort last — they are a handful of strays, not the fleet.
 */
function modelOrder(model) {
  if (!model) return [9, '', ''];
  if (model.includes('-')) return [8, model, ''];   // DL1-NCR, UP16-DT...
  return [model.length, model, ''];                 // "M" before "AA"
}

function compareModels(a, b) {
  const [al, av] = modelOrder(a);
  const [bl, bv] = modelOrder(b);
  return al !== bl ? al - bl : av.localeCompare(bv);
}

/** Is this a plate we understand as a Delhi auto? */
const isDelhiAuto = (raw) => readPlate(raw).kind === 'delhi-auto';

module.exports = { readPlate, compareModels, isDelhiAuto };
