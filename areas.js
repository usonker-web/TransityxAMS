/**
 * Canonical Delhi areas: aliases, zones, and approximate centroids.
 *
 * WHY THIS EXISTS: the spreadsheet spells the same place several ways —
 * "Laxmi nagar" on the Drivers sheet is "Laxinagar" on the Visit list, and
 * "Cnaught place" is "Cnoughtplace". Without folding those together the
 * coverage map would show one area twice and the visit planner would send
 * Rama sir to a place he already works.
 *
 * COORDINATES are hand-set area centroids, accurate to roughly a few hundred
 * metres — right for "which part of Delhi is this" and for ordering a day's
 * stops. They are NOT door addresses. Once a Maps API key is set, Settings →
 * "Refine coordinates" re-geocodes them properly.
 *
 * ZONE names deliberately reuse Rama sir's own vocabulary from the Visit list
 * sheet (Central, Central West, Central East, South) so the app speaks the
 * language he already planned in. Zones he had no word for were added.
 */

// canonical name -> { zone, lat, lng, aliases }
const AREAS = [
  // --- Central ------------------------------------------------------------
  { name: 'Ajmeri Gate',        zone: 'Central',      lat: 28.6432, lng: 77.2270, aliases: ['ajmeri gate', 'ajmerigate', 'ajmeri  gate'] },
  { name: 'Kashmiri Gate',      zone: 'Central',      lat: 28.6667, lng: 77.2280, aliases: ['kashmiri gate', 'kashmirigate'] },
  { name: 'Kamla Market',       zone: 'Central',      lat: 28.6390, lng: 77.2260, aliases: ['kamala market', 'kamla market'] },
  { name: 'Connaught Place',    zone: 'Central',      lat: 28.6315, lng: 77.2167, aliases: ['cnaught place', 'cnoughtplace', 'connaught place', 'cp'] },
  { name: 'Bangla Sahib',       zone: 'Central',      lat: 28.6265, lng: 77.2090, aliases: ['bangla sahib', 'bangla shahib', 'banglasahib'] },
  { name: 'Ramlila Ground',     zone: 'Central',      lat: 28.6390, lng: 77.2320, aliases: ['ramlila ground', 'ramlilaground'] },
  { name: 'Gole Market',        zone: 'Central',      lat: 28.6330, lng: 77.2050, aliases: ['gole market', 'golemarket'] },

  // --- Central East -------------------------------------------------------
  { name: 'Geeta Colony',       zone: 'Central East', lat: 28.6560, lng: 77.2745, aliases: ['geeta colony', 'gita colony', 'geetacolony'] },
  { name: 'Shashi Garden',      zone: 'Central East', lat: 28.6120, lng: 77.2890, aliases: ['shashi garden', 'shashigarden'] },
  { name: 'Laxmi Nagar',        zone: 'Central East', lat: 28.6304, lng: 77.2777, aliases: ['laxmi nagar', 'laxinagar', 'laxminagar'] },
  { name: 'Preet Vihar',        zone: 'Central East', lat: 28.6410, lng: 77.2950, aliases: ['preetvihar', 'preet vihar'] },
  { name: 'Karkardooma',        zone: 'Central East', lat: 28.6520, lng: 77.3020, aliases: ['karkarduma', 'karkardooma'] },
  { name: 'Mayur Vihar',        zone: 'Central East', lat: 28.6090, lng: 77.2950, aliases: ['mayurvihar', 'mayur vihar'] },
  { name: 'Shahdara',           zone: 'Central East', lat: 28.6710, lng: 77.2890, aliases: ['shadhra', 'shahdara', 'shahadra'] },
  { name: 'Anand Vihar',        zone: 'Central East', lat: 28.6470, lng: 77.3160, aliases: ['anandvihar', 'anand vihar'] },

  // --- Central West -------------------------------------------------------
  { name: 'Pitampura',          zone: 'Central West', lat: 28.6980, lng: 77.1310, aliases: ['pritam pura', 'pitampura', 'pritampura'] },
  { name: 'Ashok Vihar',        zone: 'Central West', lat: 28.6900, lng: 77.1750, aliases: ['ashok vihar', 'ashokvihar'] },
  { name: 'Patel Nagar',        zone: 'Central West', lat: 28.6510, lng: 77.1680, aliases: ['patel nagar', 'patelnagar'] },
  { name: 'Shadipur',           zone: 'Central West', lat: 28.6520, lng: 77.1580, aliases: ['sadipur', 'shadipur'] },
  { name: 'Kirti Nagar',        zone: 'Central West', lat: 28.6520, lng: 77.1450, aliases: ['kirtinagar', 'kirti nagar'] },
  { name: 'Tilak Nagar',        zone: 'Central West', lat: 28.6410, lng: 77.0940, aliases: ['tilak nagar', 'tilaknagar'] },

  // --- South --------------------------------------------------------------
  { name: 'Hauz Khas',          zone: 'South',        lat: 28.5494, lng: 77.2001, aliases: ['hauz khas', 'hauzkhas', 'hauz khaas'] },
  { name: 'Dhaula Kuan',        zone: 'South',        lat: 28.5920, lng: 77.1610, aliases: ['dholakua', 'dhaula kuan', 'dhaulakuan'] },
  { name: 'Okhla',              zone: 'South',        lat: 28.5480, lng: 77.2730, aliases: ['okhala', 'okhla'] },
  { name: 'Shaheen Bagh',       zone: 'South',        lat: 28.5500, lng: 77.2950, aliases: ['sahinbag okhala ncr', 'shaheen bagh', 'sahinbag'] },
  { name: 'Lajpat Nagar',       zone: 'South',        lat: 28.5680, lng: 77.2430, aliases: ['lajpat nagar', 'lajpatnagar'] },
  { name: 'Jasola',             zone: 'South',        lat: 28.5390, lng: 77.2930, aliases: ['jashola', 'jasola'] },
  { name: 'Bhikaji Cama Place', zone: 'South',        lat: 28.5690, lng: 77.1860, aliases: ['bikaji gama place', 'bhikajigama', 'bhikaji cama place'] },
  { name: 'Vasant Kunj',        zone: 'South',        lat: 28.5200, lng: 77.1590, aliases: ['vashant kunj', 'vasant kunj'] },
  { name: 'Sarita Vihar',       zone: 'South',        lat: 28.5310, lng: 77.2900, aliases: ['sarita vihar', 'saritavihar'] },

  // --- North / West -------------------------------------------------------
  { name: 'Delhi University',   zone: 'North',        lat: 28.6890, lng: 77.2100, aliases: ['du', 'delhi university', 'north campus'] },
  { name: 'Sonia Vihar',        zone: 'North East',   lat: 28.7180, lng: 77.2500, aliases: ['sonia vihar', 'soniavihar'] },
  { name: 'Rohini',             zone: 'North West',   lat: 28.7495, lng: 77.0565, aliases: ['rohini'] },
  { name: 'Mangolpuri',         zone: 'North West',   lat: 28.6950, lng: 77.0700, aliases: ['mangolepuri', 'mangolpuri'] },
  { name: 'Vikaspuri',          zone: 'West',         lat: 28.6350, lng: 77.0680, aliases: ['vikaspuri', 'vikas puri'] },
];

const ZONE_ORDER = ['Central', 'Central East', 'Central West', 'South', 'North', 'North East', 'North West', 'West', 'Unzoned'];

const lookup = new Map();
for (const a of AREAS) {
  lookup.set(a.name.toLowerCase(), a);
  for (const alias of a.aliases) lookup.set(alias, a);
}

/** Fold a spreadsheet spelling onto a canonical area. Returns null if unknown. */
function resolveArea(raw) {
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (lookup.has(key)) return lookup.get(key);
  const squashed = key.replace(/[^a-z]/g, '');
  for (const [k, v] of lookup) {
    if (k.replace(/[^a-z]/g, '') === squashed) return v;
  }
  return null;
}

module.exports = { AREAS, ZONE_ORDER, resolveArea };
