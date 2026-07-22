# Rama Bhaiya Planner

Field planner for recruiting auto drivers across Delhi — plan the day's visits,
see where you're strong and where you're not, and keep a record of every trip.

Built from `rama bhaiya drivers list and city data.xlsx`.

---

## Running it

Double-click **`Rama Planner.bat`**. It opens your browser once the server is
actually ready. Close the black window to stop it.

Nothing to install. No `npm install`, no internet needed for the app itself
(only the map tiles need a connection).

**The black window IS the planner.** Leave it open. Closing it stops the server,
and the browser tab goes dead — the page keeps showing whatever it last loaded,
but every button stops working. If that happens the app now says so plainly
("The planner has stopped") with the steps to restart, and reloads itself the
moment you do. Nothing is lost either way: everything is saved to disk as you go.

**Troubleshooting**

| What you see | What it means |
|---|---|
| **"The planner has stopped"** | The black window was closed. Double-click `Rama Planner.bat` again — the page reloads by itself. |
| **"Failed to fetch"** (old versions) | Same thing — the server isn't running. |
| **"Port 4520 is already busy"** | It's *already* running. Just open `http://localhost:4520`. |
| Window flashes and vanishes | Node isn't installed — get it from [nodejs.org](https://nodejs.org). |

---

## What the spreadsheet actually said

The importer read 190 rows and found **166 people holding 199 autos**.

The gap between 190 and 199 is the interesting part. **A row is a vehicle, not
a person.** Vijay Pal has 11 rows on one phone number, each a different auto.
Vishal's row says "10 auots" with nine blanks under it. Raj Khan's *single* row
says `DL1RAB4567 (10 AUTOS)` — nine autos that were invisible if you counted rows.

So the app groups rows into **contacts** holding **vehicles**:

| | |
|---|---|
| Contacts | 166 |
| Autos | 199 |
| Fleet owners (2+ autos) | 9, holding 47 autos between them |
| Captains | 6 |
| Areas | 35 — 22 on your visit list, 16 with no drivers yet |

That matters because one conversation with Vijay Pal is worth eleven autos and
one with a solo driver is worth one. The planner ranks on that.

### Things worth checking in the sheet

The importer prints these every run. Four registrations are recorded twice:

- `DL1RV7504` — twice under **Vijay Pal** (rows 105 & 106). Probably one auto
  entered twice, so he likely has 10, not 11.
- `DL1RW7339` — twice under **Ashok Kumar** (rows 156 & 177).
- `DL1RAB9778` — claimed by **Jasbir Singh** *and* **Suraj** (rows 73 & 79).
  One of these is wrong.
- `DL1RZ9966` — claimed by **Ram Dev Mahto** *and* **Nilesh** (rows 163 & 172).

Nothing was silently "corrected" — only you know which entry is right. The app
flags them on the driver's page so you can fix them when you find out.

---

## The screens

**Today** — the day's route, where to go next by priority, and the biggest fleet
owners to call.

**Plan a Day** — tick areas, press *Estimate the day*, save it as a trip.
The fastest way to plan: pick a zone, tick **Untapped only**, press **Add all
shown**. That sweeps a whole zone the way your visit list is already grouped.

**Coverage Map** — every area, as circles or as a heatmap. Circle size is autos
on roll; colour is coverage, priority, or zone. The **Coverage / Demand / Gap**
buttons switch to heat. See *The heatmap* below.

**Areas** — all 68. Sort by any column; filter to **Missing** to see researched
demand where you have nobody. See *Where Delhi needs autos* below.

**Drivers** — all 166. Search by name, phone, or vehicle number. Filter to just
fleet owners, captains, shared numbers, or **one auto model**.

**Auto Models** — the fleet split by model, read off the number plates. See below.

**Visit Log** — what happened on each trip: who was met, how many signed, when
to follow up.

---

## The heatmap

Three layers on the **Coverage Map**, switched with the buttons at the top right.

| Layer | What it shows |
|---|---|
| **Coverage** | Where your autos actually are during a working day |
| **Demand** | Where the research says the rides are — ignores your drivers entirely |
| **Gap** | Demand you are **not** serving. Red = real rides, few or none of your autos |

**Gap is the recruiting map.** It is `demand × (1 − coverage)`, so an area only
cools down when you have actually covered it. Red on the Gap layer means money
on the table.

The white dots stay clickable under the heat — the heat itself is just colour,
so the dots are what let you open an area and add it to the day.

### Where the coverage numbers come from

The spreadsheet knows one area per driver: the one he was recruited from, which
is roughly **where he lives**. That is not where he **earns**. So the app asks
the driver himself three things:

1. Where does he start his day?
2. Which areas does he drive in?
3. Which one gives him the most rides? *(the ★)*

Each answer is weighted by his fleet size — a man with 6 autos puts 6 autos on
those streets — and the ★ area counts **2.5×**, because that is the one piece of
information the driver actually volunteered.

Picking a **whole zone** ticks every area in it at once, for when a driver waves
at a region instead of naming streets.

### The roads between his areas

A driver working three areas does not teleport between them — the streets in
between are covered too. So a **corridor** of heat is drawn between every pair
of his areas, using the same straight-line geometry as the day estimate.

Every *pair*, not a route. He never says what order he drives them in, and
inventing one would paint a specific road he may never take. Connecting all
nearby pairs claims nothing about order — it just says *this cluster is his
patch*. Two rules keep it honest:

- **Pairs over 10km apart get no corridor**, only heat at both ends. One
  far-flung area shouldn't paint a fake highway across Delhi.
- **Passing through is worth 30% of working there**, so corridors read as
  cooler than the areas themselves.

An area sitting on somebody's corridor stops counting as a virgin gap, even if
no driver ever named it. That is where the extra detail shows up: the Gap layer
stops sending you to places your drivers already drive through daily.

Corridors need at least two areas **and** a driver who has actually been asked.
They are never drawn from a spreadsheet home address alone — that would be
inventing movement nobody reported.

### Until a driver has been asked

He is drawn at his home address and the map says so, in the panel, every time:
*"0 of 166 drivers have been asked."* A heatmap invites belief, so a coverage
picture built from home addresses has to admit what it is. Once you start
answering, that warning shrinks on its own.

Answers go in from two places: **Drivers → their name → Where he works**, and the
**Add a driver** form, which asks the three questions while the driver is still
standing in front of you.

Worth doing the **fleet owners first** — a man with 6 autos moves six autos'
worth of coverage, so his answer changes the map six times as much as a solo
driver's. Sort the Drivers page by autos and work down.

> These answers are **not in the spreadsheet** and never will be. They survive
> *Re-import Excel* — the importer carries them across explicitly.

---

## Where Delhi needs autos

Your visit list is 22 areas **you** knew about. This is the other half of the
question: where does the **city** generate auto demand, whether or not it was on
your list? 46 locations, researched from public data, each carrying its source.

Press **"Why these areas?"** on the Areas page to see the evidence in the app.

### What the evidence says

| | |
|---|---|
| **45%** of Delhi metro last-mile trips already use autos or share autos — vs **7%** for buses | WRI India, N=3,000, Oct 2022 |
| Where both ran, **89%** chose a *paid* share auto over a *free-for-women* bus | waiting time is the binding cost, not fare |
| Auto supply is **legally capped at 1 lakh** — Supreme Court upheld it July 2024 | ~92,000 autos at ~100% utilisation, 127 km/shift |
| Delhi's 511 authorised stands hold ~5 autos each — **2.7% of the fleet** | stands show where autos are *permitted*, not where they are |
| **31%** of built-up Delhi is >500m from any transit stop; **eight wards have 0% bus coverage** | ICCT, April 2025 |

That last line is the opening. Those wards aren't neglected — a 12-metre bus
*physically cannot enter* those streets. The hole is auto-shaped.

### The two ratings

- **`no buses`** — demand exists, nothing serves it. Fewer autos competing for
  the fare. The research called these the highest strategic upside.
- **`proven`** — demand is already visible: a police prepaid auto booth, a
  notified stand, measured footfall. It works, but others are already there.

### Your nine biggest openings

Real demand, little or no bus service, **none of your autos**:

| Area | Zone | Why |
|---|---|---|
| **Sangam Vihar** | South | ~1,000,000 people, **no public transport at all**. Asia's largest unauthorised colony, 2 entry roads. 0% bus coverage. |
| **Deoli / Khanpur** | South | 0% bus coverage. Adjoins Sangam Vihar. |
| **Mustafabad / Karawal Nagar** | North East | Delhi's **densest district** holds just **15 of 511** auto stands. Sharpest mismatch in the city. |
| **Uttam Nagar** | West | No station plaza, no feeder buses, no parking. Highest commuter dissatisfaction JICA measured. |
| **Najafgarh** | West | 1.36 million people, peripheral, poorly bus-served. |
| **Kirari / Nangloi** | North West | 4% bus coverage across a dense colony belt. |
| **Burari** | North | Delhi's fastest-growing town (**+111%** in a decade), **no metro station**. |
| **Badarpur Border** | South | Delhi-Haryana boundary terminal, notified auto stand, high transfer volume. |
| **Dwarka Mor** | West | Gateway to the Uttam Nagar belt — *but check locally, Dwarka shows e-rickshaw surplus*. |

### What the research overturned

Three things that "sound right" but aren't:

- **Rohini is NOT underserved.** It's a DMRC e-auto priority area with a feeder
  depot at Rithala — comparatively well covered.
- **The airport is a dead end for autos.** The police prepaid booths at IGI T1
  and T3 are **taxi-only**; autos are structurally excluded. **Aerocity** is the
  auto play, not the terminals.
- **Dwarka may be oversupplied.** A 2025 study found surplus e-rickshaws and
  ~2 minute waits. DMRC put its first 136 e-autos there.

### Something you already have

**Your "Ajmeri gate" IS New Delhi Railway Station** — ~500,000 passengers a day,
and the only site in Delhi with **two** police prepaid auto booths. Your 23 autos
there are sitting on the best auto pitch in the city. The merge shows this rather
than dropping a second pin 600m away that you'd drive to twice.

Same for Kashmiri Gate (= India's busiest metro station, 250,386/day), Connaught
Place (= Rajiv Chowk, 216,524/day), and DU (= GTB Nagar).

### Caveats worth knowing

- **Coordinates are accurate to ~100-200m.** Fine for "which part of Delhi";
  verify any that drive real routing.
- **The four NCR entries are outside Delhi** (Sikanderpur, Udyog Vihar, Vaishali,
  Botanical Garden). 170 of your 174 plates are `DL`-registered — a Delhi permit
  does not automatically cover Haryana or UP. Check before recruiting for them.
- Some ridership figures are from Jan 2015 and materially understate today —
  treat them as floors.
- DMRC already runs 1,507 e-autos at ~40 of 288 stations (+316 by Mar 2027). The
  white space is the underserved wards, not the well-served metro plazas.

The data lives in `demand.js` with sources on every entry.

---

## Auto models, from the number plate

A Delhi auto's registration is `DL1R` + **series** + number. The letters after
the **R** are the model:

```
DL1R U 5904   ->  model "U"
DL1R W 0740   ->  model "W"
DL1R AA 4770  ->  model "AA"     two-letter series are their own model,
DL1R AB 7643  ->  model "AB"     not all lumped together as "A"
DL1R AC 1944  ->  model "AC"
```

Your fleet, from the 174 plates that have been written down:

| | Model | Autos | Share |
|---|---|---|---|
| oldest | **M** | 1 | 0.6% |
| | **P** | 11 | 6.3% |
| | **Q** | 14 | 8.0% |
| | **S** | 11 | 6.3% |
| | **U** | 20 | 11.5% |
| | **V** | 15 | 8.6% |
| | **W** | 25 | 14.4% |
| | **Z** | 17 | 9.8% |
| | **AA** | 17 | 9.8% |
| | **AB** | 24 | 13.8% |
| newest | **AC** | 8 | 4.6% |

**The list reads oldest to newest, not A-to-Z.** RTO series are issued in
order — single letters are exhausted first, then the two-letter ones begin. So
`M` is your oldest stock and `AC` the newest, still being issued, which is why
it has the fewest. Sorting alphabetically would put `AA`/`AB`/`AC` at the top,
which is backwards.

**11 plates aren't `DL1R…`** — `DL1-NCR` (6), `UP16-DT` (2), `UP14-FT`,
`HR55-AP`, `DL1-AB`. They're listed separately under *Not the Delhi auto series*
rather than being forced into a model or quietly dropped.

`DL1AB1195` (Raju, Rohini) has **no R at all** — it may be a typo for
`DL1RAB1195`. Worth checking.

**25 of your 199 autos have no plate written down**, so they're not in this
breakdown — mostly fleet autos (Vishal's ten, most of Raj Khan's). The Auto
Models page says so at the top rather than quietly showing 174 as if it were
everything.

The rule lives in `plates.js` if it ever needs changing. Models are worked out
from the plate every time the page loads, so correcting a plate in the app
updates the breakdown immediately — no re-import needed.

---

## How "priority" is worked out

A 0–100 score answering *where should Rama sir go next*:

| Signal | Points |
|---|---|
| No drivers there yet | +30 |
| **Researched demand, no bus service** | **+30** |
| On your visit list | +25 |
| **Researched demand, proven hub** | **+18** |
| Never visited | +15 (or up to +15 as it goes stale) |
| Close to an area you already work | up to +12 |
| A captain there | +8 |
| Fleet owners there | +7 |
| High-confidence research | +4 |
| Already saturated | up to −20 |

A `no buses` gap outranks a `proven` hub because proven hubs already have autos
competing for the same fares, while the 0%-bus wards are demand nobody serves.

The proximity term matters more than it looks: without it every untapped
visit-list area scores identically and the ordering is meaningless. Recruitment
spreads by word of mouth, so an untapped patch next to a strong one is warmer
ground — and a shorter drive.

**Priority answers "where should I go next", not "what's the biggest prize."**
It deliberately favours areas that are close and already on your list, because
that's what makes a good day's trip. For the strategic question — what am I
missing entirely — use **Where you're missing out** on Today, or the **Missing**
filter on Areas. Sangam Vihar is a bigger long-term prize than Gole Market, but
Gole Market is the better trip tomorrow.

---

## The day's estimate

Pick areas, press **Estimate the day**. You get a sensible stop order and a
distance/time figure — instantly, offline, with no routing service that can fail.

**There is deliberately no live route planner.** Rama sir knows Delhi's roads
better than any map, the stop order is only a suggestion, and an online router
is one more thing that can break mid-plan (as the Google Directions error showed).
So the estimate is pure arithmetic:

```
straight-line distance  ×  1.35  =  estimated road distance
                            ÷  18 km/h  =  driving time
              +  (stops × minutes per stop)  =  the day
```

### Where 1.35 comes from

Roads are never straight. The factor was **measured against the real Delhi road
network** across 13 of Rama sir's own plans (every zone, plus priority and
gap mixes):

| | |
|---|---|
| Range | 1.24× (West, open roads) — 1.78× (Central, dense old city) |
| Used | **1.35×**, weighted by distance |

That lands the estimate within about ±10% of the true drive — versus the raw
straight line, which was **38% short** and would have him running out of daylight.

Both numbers live in **Settings → Planning** and can be changed:

- **Auto speed** (default 18 km/h) — realistic door-to-door for a Delhi auto.
- **Detour factor** (default 1.35) — raise it if his days routinely run longer
  than the estimate, lower it if shorter.

## Google Maps (optional)

The key does **not** affect planning at all — the estimate is offline arithmetic.
It only changes two things:

| API | What it gives you | If it's off |
|---|---|---|
| **Maps JavaScript** | Google's map on the Coverage page | free OpenStreetMap instead |
| **Geocoding** | the *Find address* button in Settings | paste coordinates instead |

Neither is needed. **Settings → Check my key** tests both and names any that's
blocked — but you can ignore the whole thing and lose nothing but the map's
appearance.

> Had the `DIRECTIONS_ROUTE: REQUEST_DENIED` error before? It's gone — the app
> no longer calls Directions at all. Planning is arithmetic now.

### Settings → "Check my key"

Press it. It tests all three and tells you which one is blocked and what to tick.
Use it instead of guessing: a key can draw a perfect map while Directions is
dead, and Google's own error messages point at the wrong cause (a missing
Directions API can report itself as a *billing* problem).

### Setting one up

1. **console.cloud.google.com** → new project
2. Enable **billing**. Google gives **$200 of free credit every month**; this app
   uses a tiny fraction of it. A map with "For development purposes only"
   stamped across it means billing is off.
3. **APIs & Services → Library** → enable **all three**: `Maps JavaScript API`,
   `Directions API`, `Geocoding API`. Enabling only the first is the usual
   mistake — you get a map but no real routes.
4. **Credentials → Create credentials → API key**
5. **Restrict it.** *Application restrictions* → **HTTP referrers** → add
   `http://localhost:4520/*`. *API restrictions* → **Restrict key** → tick those
   three. If you restrict the key here, the three APIs must be ticked **here as
   well as** enabled in step 3 — miss that and they'll report as blocked.
6. Paste it into **Settings**, then press **Check my key**.

Step 5 isn't optional. The key is sent to your browser to draw the map — normal
and unavoidable for Google Maps — and the referrer restriction is what stops
anyone else spending your credit if it leaks.

Also set **Rama sir's base** in Settings. Every route starts and ends there.

---

## Updating from the spreadsheet

Edited the Excel? Double-click **`Re-import Excel.bat`**.

It **merges** — it does not wipe. Contacts are matched on phone number, so your
visit logs, notes, area notes and trips all survive. Anything you added inside
the app that was never in the sheet stays too.

It reads `%USERPROFILE%\Downloads\rama bhaiya drivers list and city data.xlsx`.
For a file elsewhere: `node import.js "C:\path\to\file.xlsx"`

---

## Your data

Everything lives in **`data.json`** next to the app. It's in OneDrive, so it's
backed up automatically.

- Every save is atomic (write to a temp file, then rename) — a crash mid-save
  can't corrupt it.
- A dated snapshot goes to **`backups/`** once a day.
- If `data.json` is ever corrupt the server **refuses to start** rather than
  opening blank. A blank screen looks like "everything vanished" and invites
  overwriting the good file. Restore from `backups/` instead.

---

## Putting it online

The site goes on **Netlify**, the data goes in **Firebase (Cloud Firestore)**.
The same code still runs on the PC. Nothing is rewritten — the app looks at its
settings and decides:

| Setting present | What changes |
|---|---|
| `PORT` | Listens on that port and stops opening a browser tab. |
| `RAMA_FB_*` | Data is read and written to Firestore instead of `data.json`. |
| `RAMA_SERVERLESS` | Re-reads the data on every request and stops batching writes. |
| `RAMA_GH_TOKEN` + `RAMA_GH_REPO` | The older option: data in a private GitHub repo. Still works; Firestore wins if both are set. |

### Why the data has to live somewhere else at all

Hosting gives you a container with **no disk you can keep**. It is thrown away
when the app restarts, and on Netlify it is thrown away after *every request*.
Saving `data.json` there means losing the lot. Firestore is a database that
belongs to you, holds this comfortably inside its free tier, and — unlike the
GitHub-repo trick this replaces — is a thing built for the job rather than a
clever misuse of version control.

### What actually gets stored

One document. `planner/data`, holding today's `data.json` verbatim as a single
JSON string.

Not shredded into a collection per driver, and this is deliberate. The app reads
and writes the whole dataset every time regardless, nothing queries it by field,
and Firestore's typed-value format mangles empty arrays on the way through. One
string means what comes back out is exactly what went in. The document limit is
1 MiB and the file is 188 KB with 166 drivers, so there is room for roughly 900
before this needs revisiting.

### Netlify runs the app, it does not just serve it

Worth understanding before you change anything. `server.js` is not a thin
wrapper around storage — most of it is the arithmetic behind the heatmap, the
coverage flags, the priority order and the day's route. The browser only renders
what that arithmetic produced. A purely static site would mean rewriting all of
it in the browser.

So the whole server runs as one Netlify function (`netlify/functions/app.mjs`),
per request instead of continuously. `netlify.toml` sends **every** path there,
including `index.html` and `app.js`, because the login gate covers the
application and not only its data — letting the CDN hand out the app around the
side of the function would be a gate with an open door next to it.

Two consequences fall out of running per-request, both handled by
`RAMA_SERVERLESS`:

- **The data is re-read on every call.** A function container is frozen the
  instant it replies and may be a different one next time, so there is no
  "loaded at boot" to trust. This costs one Firestore read per request and is
  what lets two people edit without one silently undoing the other.
- **Writes do not wait.** The 1.5-second debounce that spares a long-lived
  server a round trip per keystroke would simply never fire here, so it drops to
  zero and the function waits for Firestore before replying.

### Steps

1. **A Firebase project** — [console.firebase.google.com](https://console.firebase.google.com).
   Add Firestore Database, production mode, region `asia-south1` (Mumbai) for
   the shortest hop from Delhi. Leave the security rules locked; nothing reaches
   Firestore from the browser, only from the function.
2. **A service account** — Project settings → Service accounts → Generate new
   private key. A JSON file downloads. It is a password to your database: do not
   commit it, do not email it.
3. **Three environment variables on Netlify** — Site configuration →
   Environment variables. From that JSON file:

   | Variable | From the JSON |
   |---|---|
   | `RAMA_FB_PROJECT` | `project_id` |
   | `RAMA_FB_CLIENT_EMAIL` | `client_email` |
   | `RAMA_FB_PRIVATE_KEY` | `private_key` — paste it whole, `BEGIN`/`END` lines and all |

   Add `RAMA_PASSWORD` too, for the first login. The `\n` sequences in the
   private key are expected; `store.js` turns them back into line breaks,
   because environment variables cannot carry real ones.
4. **Connect the repo to Netlify** and deploy. `netlify.toml` supplies the build
   settings, so the UI should not need anything beyond the variables above.
5. **Move the existing data across.** Once, from the project folder, with the
   same three `RAMA_FB_` variables set locally:

   ```
   node migrate-to-firebase.js
   ```

   Skip this and the site opens with **zero drivers** — it starts empty when it
   finds no document, and your first edit saves that emptiness over nothing.
   There is no data loss (the PC copy is untouched), but you will have stared at
   an empty planner wondering where 166 people went.

   It refuses to run if there is already a document in Firestore, because by
   then the online copy is the real one and this script pushes the *file* over
   the *database*. `RAMA_OVERWRITE=1` forces it if you genuinely mean to.

The startup line, in the Netlify function log, tells you which store it picked.
`Data: data.json in …` means the variables did not arrive and it is writing to a
disk that is about to be deleted.

### What it costs

Firestore's free tier is 1 GiB stored and 50,000 reads and 20,000 writes a day.
This app is one 188 KB document; a busy day for three people is a few hundred
reads. Netlify's free tier covers 125,000 function calls a month. Neither needs
a card.

### The password

Set once, then owned by the app. `RAMA_PASSWORD` only **seeds** it when none is
set — it deliberately does not override on restart, or changing the password in
Settings would silently undo itself. Changing it signs out every device, which
is the point of changing it after someone leaves.

One thing genuinely weakens when running per-request: the failed-login lockout
in `auth.js` is held in memory, and memory now lasts one request. It still slows
a single persistent attacker, but it no longer counts across a whole burst. The
password rules (eight characters, not all digits, not on the obvious list) are
doing most of the work.

### The PC copy and the hosted copy do not talk

Once it is online, the hosted one is the real one. The `.bat` on the PC still
reads the local `data.json` and the two will drift apart from the first edit.
Pick one and stick to it.

---

## The files

| File | What it is |
|---|---|
| `server.js` | Local web server + API. Zero dependencies. |
| `auth.js` | The password gate. Signed-cookie sessions, scrypt hashing. |
| `store.js` | Where the data lives — local disk, Firestore, or a private GitHub repo. |
| `netlify.toml` | Netlify build and routing. Sends every path to the function. |
| `netlify/functions/app.mjs` | Runs `server.js` as a Netlify function. Adapter only, no logic. |
| `migrate-to-firebase.js` | One-time: pushes the PC's `data.json` into Firestore. |
| `render.yaml` | Deploy settings for Render, the older host. |
| `import.js` | Excel → `data.json`. Merges; never wipes. |
| `xlsx-read.js` | Minimal `.xlsx` reader (an xlsx is a zip of XML; Node can do this alone). |
| `areas.js` | The Delhi areas: aliases, zones, coordinates. |
| `plates.js` | Number plate → auto model, and the series ordering. |
| `demand.js` | Researched auto-demand locations, with a source on every entry. |
| `public/` | The interface. |
| `data.json` | **Your data.** |
| `backups/` | Daily snapshots. |

### Adding a new area

Areas live in `areas.js`. Add the canonical name, its zone, its coordinates, and
every spelling the spreadsheet uses:

```js
{ name: 'Nangloi', zone: 'West', lat: 28.6820, lng: 77.0650,
  aliases: ['nangloi', 'nangloi jat'] },
```

Aliases are why `Laxmi nagar` on the Drivers sheet and `Laxinagar` on the Visit
list are understood as one place. Without them the map shows one area twice and
the planner sends Rama sir somewhere he already works.

Coordinates in `areas.js` are area centroids, accurate to a few hundred metres —
right for "which part of Delhi is this", not door addresses.
