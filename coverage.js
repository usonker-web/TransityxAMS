/**
 * Which areas need covering — the flag.
 *
 * The app already had two half-answers to this: a priority score (a blend of
 * everything, good for ordering a day) and a heatmap (good for looking at). But
 * neither one says the flat thing out loud: *this place needs autos and has
 * none of yours*. That sentence is what recruiting runs on, so it gets its own
 * calculation, its own level, and its own words.
 *
 * Three levels, deliberately few:
 *
 *   critical  a ward with NO bus service and not one of your autos. Nine of
 *             these exist. Every trip there is somebody who needs an auto and
 *             has no other way to move.
 *   high      a proven demand hub with none of your autos (29 of those), or
 *             somewhere you are present but far too thinly.
 *   watch     worth a look — his own visit list, or somewhere nobody has been
 *             in months.
 *
 * WHY THE TOP LEVEL IS SO NARROW: he covers 19 areas out of 68, so "needs
 * coverage" is technically true of almost the whole city. A flag that fires on
 * fifty areas is not a flag, it is wallpaper — he would learn to ignore it in a
 * week. Critical is reserved for the nine places where the case is unarguable,
 * and the rest are ranked below them.
 *
 * Anything that would only ever be noise gets NO flag. An untapped area with no
 * researched demand is not a flag; it is just a place. Flagging all eleven of
 * those would put the whole map back into the list.
 */

const STALE_DAYS = 120;      // covered, but nobody has been in four months
const THIN_GAP = 0.45;       // share of an area's demand still unserved
const THIN_MIN_DEMAND = 0.3; // ignore thin coverage of weak demand

/**
 * @param a       one row of areaStats (autos, demand, onVisitList, daysSince…)
 * @param heat    that area's heat cell: { demand, gap } normalised 0-1
 */
function flagFor(a, heat) {
  const reasons = [];
  const demand = a.demand ?? null;
  const gap = heat?.gap ?? 0;
  const demandLevel = heat?.demand ?? 0;

  let level = null;
  let headline = '';

  if (demand && a.autos === 0) {
    // Researched riders, zero of his autos. A ward with no buses at all is the
    // only thing allowed to be critical — see the note at the top of the file.
    const noBuses = demand.kind === 'gap';
    level = noBuses ? 'critical' : 'high';
    headline = noBuses
      ? 'No bus service here, and none of your autos'
      : 'Proven demand, and none of your autos';
    reasons.push(noBuses
      ? 'Ward has no bus service at all — every trip is somebody looking for an auto'
      : 'Researched demand hub');
    if (demand.confidence === 'high') reasons.push('High confidence in the research');
  } else if (demand && gap >= THIN_GAP && demandLevel >= THIN_MIN_DEMAND) {
    // He is here, but not enough of him is here.
    level = 'high';
    headline = 'Rides here you are not catching';
    reasons.push(`${a.autos} auto${a.autos === 1 ? '' : 's'} against demand this size is thin`);
  } else if (a.onVisitList && a.autos === 0) {
    level = 'high';
    headline = 'On your own visit list, still nothing here';
    reasons.push('You flagged this area yourself');
  } else if (a.onVisitList && a.visitCount === 0) {
    level = 'watch';
    headline = 'On your list, never visited';
    reasons.push('You flagged this area yourself');
  } else if (a.autos > 0 && a.daysSince != null && a.daysSince >= STALE_DAYS) {
    level = 'watch';
    headline = `Nobody has been for ${Math.round(a.daysSince / 30)} months`;
    reasons.push('Drivers here have not seen you in a long time');
  }

  if (!level) return null;

  // Extra colour, added to whatever the level is.
  if (a.autos === 0 && a.visitCount === 0) reasons.push('Never visited');
  else if (a.daysSince != null && a.daysSince >= 60) reasons.push(`Last visit ${a.daysSince} days ago`);
  if (a.nearestStrongKm != null && a.nearestStrongKm <= 4 && a.autos === 0) {
    reasons.push(`Only ${a.nearestStrongKm} km from where you are already strong`);
  }

  // Ranking within the flagged set. The level dominates — a critical area is
  // always above a high one — and priority separates areas inside a level.
  const base = { critical: 200, high: 120, watch: 50 }[level];
  const score = base + a.priority + Math.round(gap * 30);

  return { level, headline, reasons, score, gap: Math.round(gap * 100) / 100 };
}

/**
 * Attach a flag to every area. Mutates nothing — returns a new list.
 *
 * `heatPoints` carries corridor cells too, which have no areaId; those are road
 * between areas and can never be flagged, so they are simply skipped.
 */
function flagAreas(stats, heatPoints) {
  const heatByArea = new Map();
  for (const p of heatPoints ?? []) if (p.areaId) heatByArea.set(p.areaId, p);
  return stats.map((a) => ({ ...a, flag: flagFor(a, heatByArea.get(a.id)) }));
}

/** Counts for the badge and the headline stat. */
function flagSummary(flagged) {
  const of = (lvl) => flagged.filter((a) => a.flag?.level === lvl).length;
  return {
    critical: of('critical'),
    high: of('high'),
    watch: of('watch'),
    total: flagged.filter((a) => a.flag).length,
    // What the badge shows: the ones that mean "go there".
    urgent: of('critical') + of('high'),
  };
}

module.exports = { flagAreas, flagSummary, flagFor };
