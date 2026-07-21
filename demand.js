/**
 * Where Delhi actually needs autos — researched, with sources.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Rama sir's visit list is 22 areas he already knows about. This is the other
 * half of the question: where does the CITY generate auto demand, whether or not
 * he has thought of it? Everything here is evidence-backed and carries its
 * source, so a claim can be checked rather than trusted.
 *
 * THE TWO KINDS
 * -------------
 *   'proven'  demand is already visibly there: a police prepaid auto booth, a
 *             notified stand, measured footfall. Autos are there because it works.
 *   'gap'     demand exists but is unserved. ICCT (2025) found eight Delhi wards
 *             with ZERO bus coverage — not from neglect but because a 12m bus
 *             physically cannot enter those streets. That hole is auto-shaped.
 *             The research called these the highest strategic upside.
 *
 * THE BACKGROUND NUMBERS
 * ----------------------
 *   - 45% of Delhi metro last-mile trips already use autos/share autos, vs 7%
 *     bus (WRI India, N=3,000, Oct 2022). Where both ran, 89% chose a PAID share
 *     auto over a FREE-for-women bus — waiting time is the binding cost, not fare.
 *   - Auto supply is legally capped at 1 lakh; the Supreme Court upheld the cap
 *     in July 2024. ~92,000 run at ~100% utilisation, 127 km/shift.
 *   - Delhi's 511 authorised stands hold ~5 autos each: ~2,555 slots, 2.7% of the
 *     fleet. Stands show where autos are PERMITTED, not where they are.
 *   - ICCT (2025): 31% of built-up Delhi is outside a 500m walk of any transit stop.
 *
 * mergeWith: the canonical area in areas.js this is the same place as. Rama sir's
 * "Ajmeri gate" IS New Delhi Railway Station — merging tells him his 23 autos
 * there are sitting on India's busiest station, rather than inventing a second
 * pin 600m away that he would drive to twice.
 */

const DEMAND = [
  // ---------------------------------------------------------------- proven: transit
  {
    name: 'Kashmere Gate', mergeWith: 'Kashmiri Gate', lat: 28.6675, lng: 77.2280,
    zone: 'Central', category: 'metro', kind: 'proven', confidence: 'high',
    reason: 'Busiest metro station in India — 250,386 passengers a day, fused with Maharana Pratap ISBT.',
    evidence: '250,386/day (Oct 2023). Only 3-line interchange (Red/Yellow/Violet). Delhi Traffic Police prepaid auto booth on site.',
    source: 'https://en.wikipedia.org/wiki/Kashmere_Gate_metro_station',
  },
  {
    name: 'New Delhi Railway Station', mergeWith: 'Ajmeri Gate', lat: 28.6425, lng: 77.2205,
    zone: 'Central', category: 'rail', kind: 'proven', confidence: 'high',
    reason: 'India\'s busiest station — the only place in Delhi with TWO police prepaid auto booths.',
    evidence: '~500,000 passengers/day, ~350 trains. Prepaid auto booths at BOTH Paharganj and Ajmeri Gate sides. Skywalk to metro since Feb 2022.',
    source: 'https://traffic.delhipolice.gov.in/prepaid-booths/',
  },
  {
    name: 'Rajiv Chowk / Connaught Place', mergeWith: 'Connaught Place', lat: 28.6328, lng: 77.2196,
    zone: 'Central', category: 'metro', kind: 'proven', confidence: 'high',
    reason: '216,524 passengers a day. A JICA study named auto stand space its single biggest problem.',
    evidence: '216,524/day (Oct 2023), Blue/Yellow interchange. JICA lists priority issue #1 as "Space for Auto Rickshaw/Rickshaw Stand/Drop-Off". Palika/Janpath prepaid booth adjacent.',
    source: 'https://en.wikipedia.org/wiki/Rajiv_Chowk_metro_station',
  },
  {
    name: 'Anand Vihar', mergeWith: 'Anand Vihar', lat: 28.6469, lng: 77.3159,
    zone: 'Central East', category: 'isbt', kind: 'proven', confidence: 'high',
    reason: 'ISBT + railway terminal + metro + RRTS in one. 212 autos are formally registered at the rail stand.',
    evidence: 'Metro 73,361/day (Oct 2023, +25% vs 2019). Prepaid booth. Delhi HC record: 212 autos + 100 taxis at the rail stand. Two notified auto halt-and-go stands at the ISBT gates.',
    source: 'https://en.wikipedia.org/wiki/Anand_Vihar_metro_station',
  },
  {
    name: 'Hazrat Nizamuddin', mergeWith: null, lat: 28.5892, lng: 77.2542,
    zone: 'South', category: 'rail', kind: 'proven', confidence: 'high',
    reason: 'Major long-distance rail terminal with a prepaid auto stand right at the exit, and poor metro links.',
    evidence: 'Delhi Traffic Police prepaid auto booth; stand sits close to the exit. Weak metro integration = structural auto dependence.',
    source: 'https://traffic.delhipolice.gov.in/prepaid-booths/',
  },
  {
    name: 'Sarai Kale Khan ISBT', mergeWith: null, lat: 28.5852, lng: 77.2579,
    zone: 'South', category: 'isbt', kind: 'proven', confidence: 'high',
    reason: 'One of Delhi\'s three main ISBTs, next to Nizamuddin rail and the new RRTS hub.',
    evidence: 'Delhi Traffic Police prepaid auto booth. Interstate arrivals with luggage convert to autos at a high rate.',
    source: 'https://traffic.delhipolice.gov.in/prepaid-booths/',
  },
  {
    name: 'Inderlok', mergeWith: null, lat: 28.6734, lng: 77.1703,
    zone: 'Central West', category: 'metro', kind: 'proven', confidence: 'high',
    reason: 'DMRC\'s own plan provisions parking for 20 autos plus drop-off for 20 more — their demand estimate, not a guess.',
    evidence: '63,546/day (Oct 2023). Red/Green interchange, Magenta coming. DMRC multi-modal tender explicitly provisions 20 auto parking + 20 three-wheeler pick-up/drop.',
    source: 'https://timesofindia.indiatimes.com/city/delhi/a-plan-for-smooth-sailing-outside-3-metro-stations/articleshow/103824108.cms',
  },
  {
    name: 'Chhatarpur', mergeWith: null, lat: 28.5066, lng: 77.1749,
    zone: 'South', category: 'metro', kind: 'proven', confidence: 'high',
    reason: 'So choked with autos that DMRC made it their FIRST multi-modal integration station. Gateway to the Sangam Vihar belt.',
    evidence: 'TOI: "two rows of autos parked at one gate; half the road occupied by autos". DMRC\'s first MMI station precisely because of auto congestion.',
    source: 'https://timesofindia.indiatimes.com/city/delhi/smooth-ride-inside-metro-not-so-much-outside-how-last-mile-saviours-clog-traffic-near-stations-in-delhi/articleshow/99417944.cms',
  },
  {
    name: 'Welcome / Seelampur', mergeWith: null, lat: 28.6721, lng: 77.2779,
    zone: 'North East', category: 'metro', kind: 'proven', confidence: 'medium',
    reason: 'Red/Pink interchange in Delhi\'s densest district — which has only 15 of the city\'s 511 auto stands.',
    evidence: 'North East Delhi is the densest district but holds just 15 of 511 authorised stands — the sharpest supply/demand mismatch in the city. Gramin Seva GS-31 terminates at Seelampur metro.',
    source: 'https://en.wikipedia.org/wiki/Welcome_metro_station',
  },
  {
    name: 'Botanical Garden', mergeWith: null, lat: 28.5642, lng: 77.3348,
    zone: 'NCR', category: 'metro', kind: 'proven', confidence: 'high',
    reason: 'Blue/Magenta interchange — the first inter-metro interchange outside Delhi. DMRC battery-swap site.',
    evidence: 'MDPI 2025 last-mile study site (N=385): scored strong on intermodal linkage. Feeds Noida residential + Okhla.',
    source: 'https://www.mdpi.com/2673-7590/5/4/134',
  },
  {
    name: 'Kalkaji Mandir', mergeWith: null, lat: 28.5501, lng: 77.2590,
    zone: 'South', category: 'metro', kind: 'proven', confidence: 'high',
    reason: 'Violet/Magenta interchange with a notified auto stand at the gate. Temple, tourist and Nehru Place office demand.',
    evidence: 'Notified auto halt-and-go stand at Kalkaji Mandir gate (Outer Ring Rd to Lotus Temple). DMRC MMI station.',
    source: 'https://www.republicworld.com/india/delhi-traffic-police-notifies-24-auto-rickshaw-halt-and-go-stands',
  },
  {
    name: 'Central Secretariat', mergeWith: null, lat: 28.6150, lng: 77.2118,
    zone: 'Central', category: 'office', kind: 'proven', confidence: 'medium',
    reason: 'Yellow/Violet interchange serving the central government cluster, with buses arriving from the underserved belt.',
    evidence: 'WRI Delhi survey site. Kendriya Terminal adjacent, with DTC routes terminating from Burari, Deoli and Karawal Nagar.',
    source: 'https://en.wikipedia.org/wiki/Central_Secretariat_metro_station',
  },

  // ---------------------------------------------------------------- proven: markets
  {
    name: 'Azadpur Mandi', mergeWith: null, lat: 28.7089, lng: 77.1750,
    zone: 'North West', category: 'market', kind: 'proven', confidence: 'high',
    reason: 'Asia\'s largest fruit and veg market. Peak trade is 3-9 AM — demand exactly when the metro is shut.',
    evidence: '~3 lakh people dependent; 20,000 labourers/day; 6,000 wholesalers; 4,000-7,000 vehicles/day; 12,500-13,000 tonnes/day. On Delhi Traffic Police\'s 62 congestion hotspots.',
    source: 'https://www.newindianexpress.com/states/delhi/2025/Jun/16/azadpurs-invisible-hands-backbone-of-new-delhis-food-chain-yet-treated-like-dirt',
  },
  {
    name: 'Chandni Chowk', mergeWith: null, lat: 28.6562, lng: 77.2301,
    zone: 'Central', category: 'market', kind: 'proven', confidence: 'high',
    reason: '5-6 lakh visitors a day. Autos are the named dominant access mode. Old Delhi railway station is 600m away.',
    evidence: '5-6 lakh daily visitors (Shahjahanabad Redevelopment Corp); ~Rs 450-500 cr/day trade. DMRC tendered a multi-modal hub here including a 20-capacity e-rickshaw lane. Old Delhi Rly (~100,000/day) has its own prepaid auto booth.',
    source: 'https://srdc.delhi.gov.in/en/srdc/redevelopment-chandni-chowk',
  },
  {
    name: 'Sarojini Nagar', mergeWith: null, lat: 28.5748, lng: 77.1955,
    zone: 'South', category: 'market', kind: 'proven', confidence: 'high',
    reason: '50-60,000 visitors a day, double at weekends, with only 450 car spaces — so most arrive some other way.',
    evidence: '50,000-60,000/day, doubling weekends/festivals (Mini Market Traders Assoc via TOI); ~3,000 retail units; only 450 surface car spaces. Prepaid auto booth on site.',
    source: 'https://timesofindia.indiatimes.com/city/delhi/delhis-sarojini-nagar-market-to-get-new-multilevel-parking-in-june/articleshow/120702506.cms',
  },
  {
    name: 'Karol Bagh', mergeWith: null, lat: 28.6439, lng: 77.1885,
    zone: 'Central', category: 'market', kind: 'proven', confidence: 'high',
    reason: 'Ajmal Khan Road was pedestrianised in 2019, so vehicles must drop at the edge — a structural auto-drop generator.',
    evidence: '5,000+ shops across 15 markets. TOI names Karol Bagh metro an auto-congestion hotspot; CRRI notes no service lane for auto bays. WRI survey site.',
    source: 'https://timesofindia.indiatimes.com/city/delhi/smooth-ride-inside-metro-not-so-much-outside-how-last-mile-saviours-clog-traffic-near-stations-in-delhi/articleshow/99417944.cms',
  },
  {
    name: 'Lajpat Nagar', mergeWith: 'Lajpat Nagar', lat: 28.5706, lng: 77.2365,
    zone: 'South', category: 'market', kind: 'proven', confidence: 'high',
    reason: 'Metro 78,218/day plus ~1 lakh market footfall. Evening corridor speeds drop to 5 km/h.',
    evidence: 'Metro 78,218/day (Oct 2023, +19.7% vs 2019), Violet/Pink interchange. Central Market ~1 lakh weekday footfall, 1,200+ shops. Prepaid auto booth.',
    source: 'https://en.wikipedia.org/wiki/Lajpat_Nagar_metro_station',
  },
  {
    name: 'Saket / Select Citywalk', mergeWith: null, lat: 28.5285, lng: 77.2196,
    zone: 'South', category: 'market', kind: 'proven', confidence: 'high',
    reason: '15 million annual footfall (REIT-audited). A Gramin Seva route already links Sangam Vihar to here.',
    evidence: 'Select Citywalk: 15m annual footfall (~41,000/day), 249 stores. GS-92 runs Sangam Vihar-Saket Metro. Max Saket hospital adjacent.',
    source: 'https://www.nexusselecttrust.com/nexus-city-walk',
  },
  {
    name: 'Vasant Kunj Malls', mergeWith: 'Vasant Kunj', lat: 28.5200, lng: 77.1590,
    zone: 'South', category: 'market', kind: 'proven', confidence: 'high',
    reason: 'One of only four retail zones in Delhi with a police prepaid auto booth. Affluent and poorly metro-served.',
    evidence: 'Prepaid auto booth. Two notified auto halt-and-go stands at Vasant Vihar metro gates 1 and 2.',
    source: 'https://traffic.delhipolice.gov.in/prepaid-booths/',
  },

  // ---------------------------------------------------------------- proven: hospitals
  {
    name: 'AIIMS / Safdarjung', mergeWith: null, lat: 28.5676, lng: 77.2080,
    zone: 'South', category: 'hospital', kind: 'proven', confidence: 'high',
    reason: '~25,000 outpatients a day across two hospitals, mostly from out of town, all needing door-to-door transport.',
    evidence: 'AIIMS ~15,000 OPD/day (~25 lakh/yr, per Director M Srinivas); Safdarjung ~2,700 beds and ~10,000 OPD/day. BOTH have police prepaid auto booths. Delhi\'s densest non-transit auto generator.',
    source: 'https://traffic.delhipolice.gov.in/prepaid-booths/',
  },
  {
    name: 'Lok Nayak (LNJP) Hospital', mergeWith: 'Ramlila Ground', lat: 28.6395, lng: 77.2340,
    zone: 'Central', category: 'hospital', kind: 'proven', confidence: 'medium',
    reason: 'Delhi govt\'s largest hospital. Auto drivers told a reporter they wait at Gate 1 specifically to find fares.',
    evidence: '~2,000 beds, ~6,000-8,000 OPD/day. The Patriot interviewed drivers who work Gate 1 as a stand — direct field evidence.',
    source: 'https://thepatriot.in/community/delhi-polls-auto-drivers-demand-stands-insurance-and-subsidies-63583',
  },
  {
    name: 'RML Hospital', mergeWith: 'Gole Market', lat: 28.6258, lng: 77.1985,
    zone: 'Central', category: 'hospital', kind: 'proven', confidence: 'high',
    reason: 'One of only three hospitals in Delhi with a police prepaid auto booth — demand verified by the police themselves.',
    evidence: 'Major central-govt hospital near CP. Prepaid auto booth (only AIIMS, Safdarjung and RML have one).',
    source: 'https://traffic.delhipolice.gov.in/prepaid-booths/',
  },
  {
    name: 'GTB Hospital, Dilshad Garden', mergeWith: null, lat: 28.6840, lng: 77.3090,
    zone: 'Central East', category: 'hospital', kind: 'proven', confidence: 'medium',
    reason: 'Largest government hospital in East Delhi, serving trans-Yamuna and west UP.',
    evidence: '~1,500+ beds. Adjacent Dilshad Garden metro is a DMRC MMI station; Gramin Seva GS-4 terminates there.',
    source: 'https://timesofindia.indiatimes.com/city/delhi/e-autos-for-last-mile-link-as-delhi-metro-to-cede-feeder-buses/articleshow/92837381.cms',
  },

  // ---------------------------------------------------------------- proven: offices / campuses
  {
    name: 'Nehru Place', mergeWith: null, lat: 28.5494, lng: 77.2513,
    zone: 'South', category: 'office', kind: 'proven', confidence: 'high',
    reason: 'Asia\'s largest IT market — ~130,000 visitors a day, scored HIGH on auto availability in a 2025 study.',
    evidence: '~130,000 visitors/day; 60,000-80,000 daily office commuters (MDPI 2025); traders claim a 1.25 lakh workforce. MDPI: "intense IPT activity". TOI names it an auto-congestion hotspot.',
    source: 'https://www.mdpi.com/2673-7590/5/4/134',
  },
  {
    name: 'Netaji Subhash Place', mergeWith: null, lat: 28.6959, lng: 77.1525,
    zone: 'North West', category: 'office', kind: 'proven', confidence: 'medium',
    reason: 'Red/Pink interchange for the Pitampura commercial district, in the district with the most auto stands in Delhi.',
    evidence: 'North West holds 73 of Delhi\'s 511 authorised stands — the most of any district, indicating dense established auto operations.',
    source: 'https://www.tribuneindia.com/news/archive/delhi/now-auto-rickshaw-stands-available-on-google-maps-801457',
  },
  {
    name: 'Okhla Industrial Area', mergeWith: 'Okhla', lat: 28.5355, lng: 77.2732,
    zone: 'South', category: 'office', kind: 'proven', confidence: 'medium',
    reason: '2,018 industrial plots running shifts — worker flows that fall outside metro peak hours.',
    evidence: '2,018 allotted plots (1,163 Ph-I + 855 Ph-II, DDA). Delhi-wide: 8,690 factories employing 404,169 workers. Okhla Vihar and Jasola Apollo are DMRC MMI stations.',
    source: 'https://dcmsme.gov.in/dips/Brief%20industrial%20profile%20of%20Delhi.pdf',
  },
  {
    name: 'Aerocity', mergeWith: null, lat: 28.5486, lng: 77.1197,
    zone: 'South', category: 'office', kind: 'proven', confidence: 'medium',
    reason: '4,000+ hotel rooms and 100+ corporates. Use this, NOT the airport — airport prepaid booths are taxi-only.',
    evidence: '~230 acres, 4,000+ hotel rooms, 100+ corporates. IMPORTANT: Delhi Traffic Police prepaid booths at IGI T1 and T3 are TAXI-ONLY — autos are structurally excluded from the terminals.',
    source: 'https://www.gmrgroup.com/airports-and-aero-services/airport-land-development/gmr-aerocity-delhi',
  },
  {
    name: 'Hauz Khas', mergeWith: 'Hauz Khas', lat: 28.5434, lng: 77.2063,
    zone: 'South', category: 'metro', kind: 'proven', confidence: 'high',
    reason: 'Yellow/Magenta interchange serving IIT Delhi. Police say auto volume was what used to jam it.',
    evidence: 'WRI survey site. Delhi Traffic Police: "Hauz Khas was earlier infamous for traffic jams, but after the MMI hub traffic moves smoothly" — auto/IPT volume was the cause.',
    source: 'https://www.newindianexpress.com/cities/delhi/2020/Oct/05/a-plan-to-create-chaos-free-life-outside-delhi-metro-stations-2205928.html',
  },
  {
    name: 'GTB Nagar / DU North', mergeWith: 'Delhi University', lat: 28.6982, lng: 77.2070,
    zone: 'North', category: 'university', kind: 'proven', confidence: 'high',
    reason: 'DU North Campus + the Mukherjee Nagar coaching belt. Half the road outside the metro is e-rickshaws.',
    evidence: 'TOI: "almost half the road outside GTB Nagar metro station is filled with e-rickshaws" — named auto-congestion hotspot. Gramin Seva GS to Gandhi Vihar.',
    source: 'https://timesofindia.indiatimes.com/city/delhi/smooth-ride-inside-metro-not-so-much-outside-how-last-mile-saviours-clog-traffic-near-stations-in-delhi/articleshow/99417944.cms',
  },
  {
    name: 'Jamia Millia Islamia', mergeWith: null, lat: 28.5625, lng: 77.2800,
    zone: 'South', category: 'university', kind: 'proven', confidence: 'high',
    reason: '~22,000 students plus 21,400 distance learners, with a notified auto stand at the metro.',
    evidence: '~22,000 full-time (~7,000 Delhi campus UG/PG) + 21,400 distance learners. Notified auto halt-and-go stand on MM Johar Ali Marg near Jamia Millia metro. DMRC MMI station. WRI survey site.',
    source: 'https://traffic.delhipolice.gov.in/prepaid-booths/',
  },
  {
    name: 'Shahdara', mergeWith: 'Shahdara', lat: 28.6735, lng: 77.2890,
    zone: 'Central East', category: 'residential', kind: 'proven', confidence: 'high',
    reason: 'A JICA study found rickshaws take a relatively large share of access here — a proven auto-access station.',
    evidence: 'Tehsil pop. 322,931. JICA: notable for "a variety of access transport modes as well as a station plaza" where bus and rickshaw take larger shares. On Delhi Police\'s 62 congestion hotspots.',
    source: 'https://openjicareport.jica.go.jp/pdf/11969227_01.pdf',
  },
  {
    name: 'Laxmi Nagar', mergeWith: 'Laxmi Nagar', lat: 28.6306, lng: 77.2776,
    zone: 'Central East', category: 'residential', kind: 'proven', confidence: 'high',
    reason: 'DMRC provisions a 46-vehicle auto bay here — the LARGEST in any published DMRC plan.',
    evidence: '41,262/day (Jan 2015 — understated today). Wikipedia: "one of the busiest stations... home to numerous workers and students"; coaching-centre density. DMRC MMI provisions an IPT bay for 46 vehicles.',
    source: 'https://timesofindia.indiatimes.com/city/delhi/a-plan-for-smooth-sailing-outside-3-metro-stations/articleshow/103824108.cms',
  },

  // ---------------------------------------------------------------- gaps: the underserved wards
  {
    name: 'Sangam Vihar', mergeWith: null, lat: 28.4975, lng: 77.2406,
    zone: 'South', category: 'residential', kind: 'gap', confidence: 'high',
    reason: 'A million people with NO public transport at all. The single strongest opportunity in this whole list.',
    evidence: '~1,000,000 people over 5 km2 — Asia\'s largest unauthorised colony, only 2 entry roads. CSE: "Sangam Vihar does not have any public transport... residents use bicycles, cycle rickshaws, motorbikes, and auto rickshaws." ICCT: Sangam Vihar-A ward = 0% bus coverage, B = 4%.',
    source: 'https://sarainwater.org/wp-content/uploads/2024/07/Publication-water-and-waste-water.pdf',
  },
  {
    name: 'Deoli / Khanpur', mergeWith: null, lat: 28.5030, lng: 77.2450,
    zone: 'South', category: 'residential', kind: 'gap', confidence: 'high',
    reason: '0% bus coverage. Buses cannot physically enter the streets — the gap is auto-shaped by design.',
    evidence: 'ICCT (2025): Deoli ward has literally 0% bus coverage. Adjoins Sangam Vihar. 12m buses cannot enter the street network.',
    source: 'https://theicct.org/wp-content/uploads/2025/04/ID-321-%E2%80%93-Neighborhood-transit-working-paper-A4-50163-WEB-v5.pdf',
  },
  {
    name: 'Mustafabad / Karawal Nagar', mergeWith: null, lat: 28.7050, lng: 77.2760,
    zone: 'North East', category: 'residential', kind: 'gap', confidence: 'high',
    reason: 'Delhi\'s densest district holds only 15 of the city\'s 511 auto stands. The sharpest mismatch in Delhi.',
    evidence: 'ICCT: Mustafabad 0% bus coverage; Karawal Nagar-East 3%. North East is Delhi\'s densest district yet has 15 of 511 authorised stands. Gramin Seva GS-31/33 run here.',
    source: 'https://theicct.org/wp-content/uploads/2025/04/ID-321-%E2%80%93-Neighborhood-transit-working-paper-A4-50163-WEB-v5.pdf',
  },
  {
    name: 'Uttam Nagar', mergeWith: null, lat: 28.6248, lng: 77.0652,
    zone: 'West', category: 'residential', kind: 'gap', confidence: 'high',
    reason: 'No station plaza, no feeder buses, no parking — and the highest commuter dissatisfaction JICA measured.',
    evidence: '41,649/day (Jan 2015, understated today). JICA: "no station plaza, feeder buses and parking non-existent; 80% access on foot, remainder likely rickshaws" — highest dissatisfaction of 4 studied stations. ICCT priority cluster.',
    source: 'https://openjicareport.jica.go.jp/pdf/11969227_01.pdf',
  },
  {
    name: 'Najafgarh', mergeWith: null, lat: 28.6125, lng: 76.9847,
    zone: 'West', category: 'residential', kind: 'gap', confidence: 'high',
    reason: '1.36 million people, peripheral and poorly bus-served. Two notified auto stands already on the Najafgarh road.',
    evidence: 'Tehsil pop. 1,365,152 (Census 2011). ICCT priority underserved cluster; WRI Delhi survey site. Two notified auto halt-and-go stands on the Najafgarh-Uttam Nagar road. Gramin Seva territory.',
    source: 'https://theicct.org/wp-content/uploads/2025/04/ID-321-%E2%80%93-Neighborhood-transit-working-paper-A4-50163-WEB-v5.pdf',
  },
  {
    name: 'Kirari / Nangloi', mergeWith: null, lat: 28.6870, lng: 77.0480,
    zone: 'North West', category: 'residential', kind: 'gap', confidence: 'high',
    reason: '4% bus coverage across a dense unauthorised colony belt in outer West Delhi.',
    evidence: 'ICCT: Kirari 4% bus coverage; Nangloi Jat an ICCT priority cluster. WRI Delhi survey site (Nangloi).',
    source: 'https://theicct.org/wp-content/uploads/2025/04/ID-321-%E2%80%93-Neighborhood-transit-working-paper-A4-50163-WEB-v5.pdf',
  },
  {
    name: 'Burari', mergeWith: null, lat: 28.7592, lng: 77.1938,
    zone: 'North', category: 'residential', kind: 'gap', confidence: 'medium',
    reason: 'Delhi\'s fastest-growing town (+111% in a decade) with NO metro station at all.',
    evidence: '146,190 (Census Town 2011), +110.9% decadal growth. No metro. Only a DMRC feeder from Vishwavidyalaya serves Shankarpura Burari. Fast-growing + unserved = high latent demand.',
    source: 'https://www.census2011.co.in/data/town/63957-burari-delhi.html',
  },
  {
    name: 'Badarpur Border', mergeWith: null, lat: 28.4930, lng: 77.3030,
    zone: 'South', category: 'residential', kind: 'gap', confidence: 'medium',
    reason: 'Delhi-Haryana boundary bus terminal with a notified auto stand and high interstate transfer volume.',
    evidence: 'Violet Line, major bus terminal. Notified auto halt-and-go stand at Badarpur bus terminal under the flyover. A Gramin Seva route runs Sangam Vihar-Badarpur Border.',
    source: 'https://www.republicworld.com/india/delhi-traffic-police-notifies-24-auto-rickshaw-halt-and-go-stands',
  },
  {
    name: 'Dwarka Mor', mergeWith: null, lat: 28.6193, lng: 77.0334,
    zone: 'West', category: 'residential', kind: 'gap', confidence: 'medium',
    reason: 'Gateway between Dwarka and the dense Uttam Nagar belt. Check locally first — Dwarka shows e-rickshaw surplus.',
    evidence: 'Serves NSUT + DD Upadhyaya College. CAUTION: 2025 Dwarka study found only 28% e-rickshaw mode share but a 25% surplus fleet — verify on the ground before committing.',
    source: 'https://doi.org/10.1080/29941849.2025.2518201',
  },

  // ---------------------------------------------------------------- watch-list / caution
  {
    name: 'Rithala', mergeWith: null, lat: 28.7206, lng: 77.1071,
    zone: 'North West', category: 'metro', kind: 'proven', confidence: 'medium',
    reason: 'Red Line terminus with a DMRC feeder depot. NOTE: Rohini is NOT underserved — go for throughput, not gap-filling.',
    evidence: 'DMRC e-rickshaw battery-swapping station + feeder depot. CAUTION: contrary to common assumption, ICCT does NOT list Rohini as underserved — it is comparatively well covered.',
    source: 'https://www.tribuneindia.com/news/delhi/delhi-metro-expands-last-mile-network-eyes-more-commuter-friendly-mobility-options/',
  },
  {
    name: 'Dwarka Sector 21', mergeWith: null, lat: 28.5523, lng: 77.0581,
    zone: 'West', category: 'metro', kind: 'proven', confidence: 'medium',
    reason: 'Blue Line terminus + Airport Express. CAUTION: DMRC already ran its first e-auto fleet here and waits are ~2 min.',
    evidence: 'Future Dwarka ISBT + Bijwasan rail. DMRC deployed its FIRST e-auto fleet (136 vehicles) across Dwarka. 2025 study found 18% surplus e-rickshaw fleet and ~2 min waits — likely oversupplied.',
    source: 'https://doi.org/10.1080/29941849.2025.2518201',
  },

  // ---------------------------------------------------------------- outside Delhi (permit warning)
  {
    name: 'Sikanderpur (Gurugram)', mergeWith: null, lat: 28.4814, lng: 77.0931,
    zone: 'NCR', category: 'metro', kind: 'proven', confidence: 'medium',
    reason: '300-500k daily footfall serving Cyber City. OUTSIDE DELHI — a DL auto needs the right permit to ply here.',
    evidence: 'Yellow Line + Rapid Metro interchange. Wikipedia notes it serves commuters "who previously reached these places by auto or bus". PERMIT: your fleet is 170/174 DL-registered; Delhi permits do not automatically cover Haryana.',
    source: 'https://en.wikipedia.org/wiki/Sikanderpur_metro_station',
  },
  {
    name: 'Udyog Vihar (Gurugram)', mergeWith: null, lat: 28.5057, lng: 77.0872,
    zone: 'NCR', category: 'office', kind: 'proven', confidence: 'medium',
    reason: '1,200+ units on 728 acres running shifts. OUTSIDE DELHI — permit check needed before recruiting for it.',
    evidence: '1,200+ industrial/commercial units, 5 phases; single factories run 3,000 workers each. Poorly metro-served vs worker volume. PERMIT: Haryana, not Delhi.',
    source: 'https://en.wikipedia.org/wiki/Udyog_Vihar',
  },
  {
    name: 'Vaishali (Ghaziabad)', mergeWith: null, lat: 28.6499, lng: 77.3397,
    zone: 'NCR', category: 'residential', kind: 'proven', confidence: 'medium',
    reason: 'Blue Line terminus serving Khora — one of Asia\'s densest settlements. OUTSIDE DELHI — UP permit.',
    evidence: 'Serves Vaishali, Vasundhara, Indirapuram, Khora. DMRC e-rickshaw battery-swapping station. Terminus + dense unplanned catchment. PERMIT: Uttar Pradesh, not Delhi.',
    source: 'https://www.tribuneindia.com/news/delhi/delhi-metro-expands-last-mile-network-eyes-more-commuter-friendly-mobility-options/',
  },
];

/** Headline findings, shown in the app so the numbers carry their source. */
const DEMAND_FACTS = [
  {
    fact: '45% of Delhi metro last-mile trips already use autos or share autos — against 7% for buses.',
    detail: 'Where both were available, 89% chose a PAID share auto over a FREE-for-women bus. Waiting time is the binding cost, not fare.',
    source: 'WRI India, N=3,000, Oct 2022',
  },
  {
    fact: 'Auto supply is legally capped at 1 lakh, and the Supreme Court upheld the cap in July 2024.',
    detail: '~92,000 autos (the DL1R series) run at roughly 100% utilisation, 127 km per shift — against 60% for cars and 45% for two-wheelers. Every auto already on the road is working.',
    source: 'Supreme Court, July 2024 (Bajaj Auto plea dismissed)',
  },
  {
    fact: 'Delhi has 511 authorised auto stands holding about 5 autos each — roughly 2.7% of the fleet.',
    detail: 'Stands show where autos are PERMITTED, not where they are. Do not read stand maps as demand maps.',
    source: 'Delhi Traffic Police',
  },
  {
    fact: '31% of built-up Delhi is more than a 500m walk from any transit stop, and eight wards have 0% bus coverage.',
    detail: 'Not neglect: a 12m bus physically cannot enter those street networks. That hole is auto-shaped — it is the strategic opening.',
    source: 'ICCT, April 2025',
  },
];

module.exports = { DEMAND, DEMAND_FACTS };
