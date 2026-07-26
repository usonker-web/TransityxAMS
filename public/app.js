/**
 * Rama Bhaiya Planner — front end.
 *
 * Two map backends behind one interface (see MapView), used ONLY to draw the map:
 *   - Google Maps, when a key is set in Settings.
 *   - Leaflet + OpenStreetMap otherwise — free, keyless, works today.
 *
 * There is no live routing anywhere. A day's distance is estimated on the server
 * (straight line × a measured Delhi detour factor), so planning is instant,
 * offline, and cannot fail with a denied or dead API. The Google key only
 * changes the map's appearance and enables address lookup — never the estimate.
 */

'use strict';

// ================================================================ state

const S = {
  data: null,
  view: 'today',
  pick: new Set(),      // areaIds selected in the planner
  planned: null,        // last computed route
  planDate: todayStr(),
  sort: {
    areas: { key: 'priority', dir: -1 },
    drivers: { key: 'fleetSize', dir: -1 },
    vehicles: { key: 'owner', dir: 1 },
  },
  filter: {
    drivers: '', driverZone: '', driverKind: '', driverModel: '', areaZone: '', areaDemand: '',
    coverZone: '', coverLevel: '',
    vehicleQ: '', vehicleModel: '', vehicleShift: '', vehicleStatus: '', vehicleLink: '',
    captainQ: '',
    // Plan filters live here, not in the DOM: optimising re-renders the view,
    // and a zone sweep that silently forgets your zone is maddening.
    planQ: '', planZone: '', planListOnly: false, planUntapped: false,
  },
  mapColor: 'coverage',
  mapLayer: 'circles',  // circles | coverage | demand | gap
  hunterPick: new Set(),  // areaIds a client has asked about, on Auto Hunter
  hunterFocus: new Set(), // contactIds spotlighted on Auto Hunter
  hunterMode: 'routes',   // routes | subdistricts | districts
  hunterDistrict: null,   // boundary clicked and kept, on either district map
  heat: null,           // blob size + intensity; filled from localStorage at boot
};

/** 133 -> "2h 13m". Nobody thinks in raw minutes. */
function hm(min) {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ZONE_COLOR = {
  'Central': '#00c2e0',
  'Central East': '#8b5cf6',
  'Central West': '#f59e0b',
  'South': '#10b981',
  'North': '#ec4899',
  'North East': '#f97316',
  'North West': '#3b82f6',
  'West': '#eab308',
  'NCR': '#64748b',
  'Unzoned': '#5b6b7d',
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const area = (id) => S.data?.areaStats.find((a) => a.id === id);
const areaName = (id) => area(id)?.name ?? 'Unknown area';

// ================================================================ theme

/**
 * Dark (default) or light. The choice lives in localStorage — it is a per-PC
 * display preference, not shared data, so it never touches data.json or needs
 * the server. The <head> applies it before first paint; these helpers keep the
 * toggle buttons in sync and let the user change it.
 */
const THEMES = ['dark', 'light'];
const currentTheme = () => {
  try { const t = localStorage.getItem('ramaTheme'); return THEMES.includes(t) ? t : 'dark'; }
  catch { return 'dark'; }
};
function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  $$('[data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === name));
}
function setTheme(name) {
  if (!THEMES.includes(name)) return;
  try { localStorage.setItem('ramaTheme', name); } catch {}
  applyTheme(name);
}

// ================================================================ api

async function api(method, path, body) {
  setSave('saving');
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    // The session ran out, or someone changed the password. There is nothing
    // useful to show on a page whose data is gone, so go straight to the login
    // rather than papering the screen with red toasts.
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('Signed out.');
    }
    if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
    setSave('saved');
    return json;
  } catch (err) {
    setSave('error');
    // fetch throws a bare TypeError when it cannot reach the server at all.
    // The browser calls that "Failed to fetch", which tells the user nothing
    // and reads like the app is broken. It almost always means one thing: the
    // black window got closed. Say that, and watch for it coming back.
    if (err instanceof TypeError) {
      showServerDown();
      throw new Error('The planner is not running.');
    }
    toast(err.message, 'bad');
    throw err;
  }
}

/**
 * The server is gone. Take over the screen, say so in plain words, and poll
 * until it returns — then reload. Nothing is lost: everything already saved is
 * in data.json on disk.
 */
let serverDownShown = false;
function showServerDown() {
  if (serverDownShown) return;
  serverDownShown = true;

  const el = document.createElement('div');
  el.className = 'down-scrim';
  el.innerHTML = `
    <div class="down-card">
      <div class="down-title">The planner has stopped</div>
      <p class="down-text">
        The black <strong>Rama Bhaiya Planner</strong> window that runs it isn't open any more —
        so this page has nothing to talk to. Nothing is lost; your drivers, notes and
        trips are all saved on disk.
      </p>
      <div class="down-steps">
        <div class="down-step"><span class="down-num">1</span> Go to the <strong>Rama Bhaiya Planner</strong> folder on your Desktop</div>
        <div class="down-step"><span class="down-num">2</span> Double-click <strong>Rama Planner.bat</strong></div>
        <div class="down-step"><span class="down-num">3</span> Leave the black window open — closing it stops the planner</div>
      </div>
      <div class="down-wait"><span class="down-dot"></span> Watching for it to come back — this page will reload by itself.</div>
      <button class="btn btn-primary btn-block" id="down-retry" style="margin-top:14px">Check now</button>
    </div>`;
  document.body.appendChild(el);

  const probe = async () => {
    try {
      const r = await fetch('/api/data', { cache: 'no-store' });
      if (r.ok) { location.reload(); return true; }
    } catch { /* still down */ }
    return false;
  };
  const timer = setInterval(probe, 2000);
  $('#down-retry').onclick = async () => {
    const btn = $('#down-retry');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    if (!(await probe())) {
      btn.disabled = false;
      btn.textContent = 'Still not running — check again';
    }
  };
  window.addEventListener('beforeunload', () => clearInterval(timer));
}

async function refresh() {
  S.data = await api('GET', '/data');
  // Which autos cross which district is derived from the routes, so it stops
  // being true the moment anybody's areas change. The boundaries themselves are
  // fixed and stay loaded.
  clearShapeRoutes();
  paintBadges();
}

function setSave(state) {
  const el = $('#save-state');
  if (!el) return;
  el.className = `save-state ${state === 'saved' ? '' : state}`;
  el.textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : 'Saved';
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ================================================================ map backends

/**
 * One interface, two implementations. Views only ever call these methods, so
 * adding a Maps key swaps the engine underneath without touching view code.
 */
const MapView = {
  impl: null,
  ready: false,
  fallbackReason: '',
  // Set by whichever screen mounted the map, so a Google failure can rebuild
  // that screen rather than a hardcoded one. Cleared on every mount.
  repaint: null,

  /**
   * Mount Google when a key is set, otherwise Leaflet — but NEVER end up with a
   * dead map. A key that is mistyped, restricted to the wrong referrer, or on a
   * project without billing enabled will fail auth, and a blank grey rectangle
   * is strictly worse than the free map that was working before. So any Google
   * failure falls back to Leaflet and says why.
   */
  async mount(el, opts = {}) {
    this.fallbackReason = '';
    this.repaint = null;
    // Stale from a previous visit to this page: the old map object points at a
    // DOM node that no longer exists, so nothing may treat it as usable until
    // this mount actually succeeds.
    this.ready = false;
    const key = S.data.settings.mapsApiKey?.trim();

    if (key) {
      try {
        await GoogleImpl.load(key);
        this.impl = GoogleImpl;
        this.impl.mount(el, opts);
        this.ready = true;
        // Google reports a bad key asynchronously, after the map tries to draw.
        // Hand the caller a way to react rather than stalling every load here.
        window.gm_authFailure = () => {
          this.fallbackReason = 'Google rejected the key. Check that billing is on, the key is right, and localhost:4520 is an allowed referrer.';
          this.swapToFree(el, opts);
        };
        return 'google';
      } catch (err) {
        this.fallbackReason = err.message;
      }
    }

    el.innerHTML = '';
    this.impl = LeafletImpl;
    await LeafletImpl.load();
    LeafletImpl.mount(el, opts);
    this.ready = true;
    return this.fallbackReason ? 'osm-fallback' : 'osm';
  },

  /** Google died after mounting — rebuild on the free map in place. */
  async swapToFree(el, opts) {
    try {
      el.innerHTML = '';
      this.impl = LeafletImpl;
      await LeafletImpl.load();
      LeafletImpl.mount(el, opts);
      // Each map screen paints something different, so the screen that mounted
      // this map is the only thing that knows how to put it back. Without this
      // the swap repainted the Coverage Map's circles over whatever was actually
      // on screen — a wrong picture is worse than the rejected key it replaced.
      if (this.repaint) {
        await this.repaint();
      } else {
        this.markers(areaMarkers());
        // Carry the heat layer across the swap — losing it silently would look
        // like the heatmap itself had broken.
        if (S.mapLayer && S.mapLayer !== 'circles') await this.heat(heatData(S.mapLayer));
      }
      this.fit();
      const note = $('#map-note');
      if (note) note.innerHTML = `<strong>Fell back to the free map.</strong> ${esc(this.fallbackReason)}`;
      const banner = $('#map-banner');
      if (banner) banner.textContent = 'Google Maps key was rejected — showing the free map instead.';
      toast('Google key rejected — using the free map', 'bad');
    } catch (e) {
      toast(e.message, 'bad');
    }
  },
  markers(items) { return this.impl.markers(items); },
  lines(items, handlers) { return this.impl.lines(items, handlers); },
  setLineHighlight(group) { return this.impl.setLineHighlight(group); },
  clearLines() { return this.impl.clearLines(); },
  shapes(items, handlers) { return this.impl.shapes(items, handlers); },
  setShapeHighlight(key, style) { return this.impl.setShapeHighlight(key, style); },
  clearShapes() { return this.impl.clearShapes(); },
  fit() { return this.impl.fit(); },
  fitTo(points) { return this.impl.fitTo(points); },
  heat(points) { return this.impl.heat(points, S.heat); },
  tuneHeat() { return this.impl.tuneHeat(S.heat); },
  clearHeat() { return this.impl.clearHeat(); },
  get kind() { return this.impl?.kind ?? 'none'; },
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src.split('?')[0]} — check your internet connection.`));
    document.head.appendChild(s);
  });
}

function loadCss(href) {
  return new Promise((resolve) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = resolve;
    l.onerror = resolve;
    document.head.appendChild(l);
  });
}

// ---------------------------------------------------------------- heat colours

/**
 * The heat is drawn here, on a plain canvas, rather than by either map vendor.
 *
 * Google DELETED HeatmapLayer in Maps JavaScript API 3.65 — it is not
 * deprecated, it is gone, and pinning to an older version only reschedules the
 * outage. Leaflet's heat plugin is a CDN script that could go the same way. So
 * the renderer is ours: about eighty lines, no dependency to remove, no vendor
 * able to break the picture again, and one implementation means the map looks
 * identical with or without a working Google key.
 *
 * The algorithm is the standard one. Stamp a soft radial brush per point at an
 * alpha set by its weight, let overlapping stamps accumulate, then recolour the
 * result by reading each pixel's alpha as a position along the gradient.
 *
 * The first stop MUST be fully transparent. A heatmap whose low end is opaque
 * blue paints the entire city, and "everywhere is slightly covered" is exactly
 * the impression this feature exists to destroy.
 */
const HEAT_STOPS = [
  [0.00, 'rgba(43,63,214,0)'],
  [0.12, 'rgba(43,63,214,0.55)'],
  [0.30, 'rgba(30,110,230,0.72)'],
  [0.45, 'rgba(0,180,216,0.82)'],
  [0.58, 'rgba(0,214,180,0.87)'],
  [0.70, 'rgba(49,214,122,0.90)'],
  [0.80, 'rgba(150,225,70,0.93)'],
  [0.88, 'rgba(242,212,60,0.95)'],
  [0.95, 'rgba(245,158,11,0.97)'],
  [1.00, 'rgba(239,68,68,1)'],
];

/** 256-entry colour lookup, built once: alpha 0-255 -> RGBA along the ramp. */
let _heatShades = null;
function heatShades() {
  if (_heatShades) return _heatShades;
  const c = document.createElement('canvas');
  c.width = 1; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [pos, colour] of HEAT_STOPS) g.addColorStop(pos, colour);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, 256);
  _heatShades = ctx.getImageData(0, 0, 1, 256).data;
  return _heatShades;
}

/**
 * One soft dot, drawn offscreen and then stamped per point.
 *
 * The circle is drawn outside the canvas and only its shadow lands inside —
 * that is what produces a smooth falloff without hand-rolling a gradient.
 */
let _brush = { canvas: null, radius: -1, blur: -1 };
function heatBrush(radius, blur) {
  if (_brush.canvas && _brush.radius === radius && _brush.blur === blur) return _brush.canvas;
  const r = radius + blur;
  const c = document.createElement('canvas');
  c.width = c.height = r * 2;
  const ctx = c.getContext('2d');
  ctx.shadowOffsetX = ctx.shadowOffsetY = r * 2;
  ctx.shadowBlur = blur;
  ctx.shadowColor = '#000';
  ctx.beginPath();
  ctx.arc(-r, -r, radius, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.fill();
  _brush = { canvas: c, radius, blur };
  return c;
}

/** Points are in canvas pixels: [{x, y, weight}]. */
function renderHeat(canvas, points, { radius, blur, max, minOpacity = 0.05 }) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!points.length || !canvas.width || !canvas.height) return;

  const brush = heatBrush(radius, blur);
  const r = radius + blur;
  for (const p of points) {
    ctx.globalAlpha = Math.min(1, Math.max(p.weight / max, minOpacity));
    ctx.drawImage(brush, p.x - r, p.y - r);
  }
  ctx.globalAlpha = 1;

  // Recolour: the accumulated alpha of each pixel is its heat.
  const shades = heatShades();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    const j = d[i] * 4;
    if (j) { d[i - 3] = shades[j]; d[i - 2] = shades[j + 1]; d[i - 1] = shades[j + 2]; d[i] = shades[j + 3]; }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * How fat and how hot the blobs are.
 *
 * Delhi at zoom 11 is roughly 60km across, and a 46px radius makes neighbouring
 * areas bleed into one blob — which is the point, coverage is continuous on the
 * ground rather than a set of dots. But the right radius depends on the screen
 * and on how zoomed in he is, so it is his to set, not mine to guess.
 *
 * Intensity is stored as the point at which the ramp saturates to red, so a
 * LOWER number is a HOTTER map. The slider is inverted to hide that.
 */
const HEAT_DEFAULTS = { radius: 46, intensity: 1.35 };
const HEAT_LIMITS = { radius: [18, 95], intensity: [0.45, 3.2] };

const heatPrefs = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('ramaHeat') ?? '{}');
    const clamp = (v, [lo, hi], dflt) => (Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
    return {
      radius: clamp(raw.radius, HEAT_LIMITS.radius, HEAT_DEFAULTS.radius),
      intensity: clamp(raw.intensity, HEAT_LIMITS.intensity, HEAT_DEFAULTS.intensity),
    };
  } catch { return { ...HEAT_DEFAULTS }; }
};

function saveHeatPrefs(p) {
  try { localStorage.setItem('ramaHeat', JSON.stringify(p)); } catch {}
}

// Blur is proportional to radius so the blobs stay equally soft at every size,
// instead of turning into hard discs when the slider is dragged wide.
const heatBlur = (radius) => Math.round(radius * 0.74);

// ---------------------------------------------------------------- Leaflet (free)

const LeafletImpl = {
  kind: 'osm',
  map: null,
  layer: null,
  heatLayer: null,

  async load() {
    if (window.L) return;
    await loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
    await loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js');
  },

  /**
   * A canvas pinned over the map, repainted whenever the view settles. Leaflet
   * hides it mid-zoom via `leaflet-zoom-hide` and we redraw on zoomend, which
   * is far cheaper than trying to transform heat blobs through the animation.
   */
  async heat(points, prefs) {
    this.clearHeat();
    if (!points.length) return;

    const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide');
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    this.map.getPanes().overlayPane.appendChild(canvas);

    // Bound once and reused, so the map listeners never need rebinding when the
    // sliders change the settings.
    const redraw = () => this.paintHeat();
    this.heatLayer = { canvas, redraw, prefs: { ...prefs }, points };
    this.map.on('moveend zoomend resize', redraw);
    this.paintHeat();
  },

  paintHeat() {
    const h = this.heatLayer;
    if (!h) return;
    const pad = h.prefs.radius * 2;
    const size = this.map.getSize();
    h.canvas.width = size.x + pad * 2;
    h.canvas.height = size.y + pad * 2;
    h.canvas.style.width = `${h.canvas.width}px`;
    h.canvas.style.height = `${h.canvas.height}px`;
    // Keep the canvas glued to the map's top-left however the pane is offset,
    // padded outwards so blobs near the edge are not sliced off.
    L.DomUtil.setPosition(h.canvas, this.map.containerPointToLayerPoint([-pad, -pad]));

    renderHeat(h.canvas, h.points.map((p) => {
      const pt = this.map.latLngToContainerPoint([p.lat, p.lng]);
      return { x: pt.x + pad, y: pt.y + pad, weight: p.weight };
    }), { radius: h.prefs.radius, blur: heatBlur(h.prefs.radius), max: h.prefs.intensity });
  },

  /** Live slider drag — repaint in place, no layer teardown. */
  tuneHeat(prefs) {
    if (!this.heatLayer) return;
    this.heatLayer.prefs = { ...prefs };
    this.paintHeat();
  },

  clearHeat() {
    if (!this.heatLayer) return;
    this.map.off('moveend zoomend resize', this.heatLayer.redraw);
    this.heatLayer.canvas.remove();
    this.heatLayer = null;
  },

  mount(el) {
    this.map = L.map(el, { zoomControl: true, attributionControl: true })
      .setView([28.63, 77.22], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(this.map);
    /**
     * Lines get their own canvas renderer, for two reasons.
     *
     * Auto Hunter draws a segment per pair of areas per driver, which runs to
     * roughly a thousand. As separate SVG paths that is a thousand DOM nodes and
     * a map that stutters on every pan; on one canvas it is one node.
     *
     * `tolerance` is the other half. These lines are deliberately thin, and a
     * 2px line is something you chase with the mouse rather than hover. Six
     * pixels of slack makes them catchable without drawing them any fatter.
     */
    this.lineRenderer = L.canvas({ tolerance: 6, padding: 0.3 });
    // Lines first, so they sit under the markers. Leaflet puts markers in their
    // own pane above the overlay pane anyway, but the order here says the intent.
    this.lineLayer = L.layerGroup().addTo(this.map);
    this.layer = L.layerGroup().addTo(this.map);
  },

  markers(items) {
    this.layer.clearLayers();
    for (const it of items) {
      const size = it.size;
      const icon = L.divIcon({
        className: '',
        html: `<div class="mk ${it.ring ? `flag-${it.ring}` : ''}" style="width:${size}px;height:${size}px;background:${it.color}">${it.label ?? ''}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const m = L.marker([it.lat, it.lng], { icon, title: it.title });
      // A marker either opens a popup or acts as a button, never both — two
      // things happening on one click is how you get a popup you cannot dismiss.
      if (it.onClick) m.on('click', it.onClick);
      else m.bindPopup(it.popup).on('popupopen', () => bindPopupActions());
      m.addTo(this.layer);
    }
  },

  /**
   * Straight segments. Items carrying a `group` become hoverable and are indexed
   * by it, so highlighting one auto later restyles only its handful of segments
   * rather than rebuilding all thousand.
   */
  lines(items, handlers = {}) {
    this.lineLayer.clearLayers();
    this.lineIndex = new Map();
    this.hovered = null;

    for (const it of items) {
      const pl = L.polyline([[it.a.lat, it.a.lng], [it.b.lat, it.b.lng]], {
        color: it.color,
        weight: it.weight,
        opacity: it.opacity,
        interactive: !!it.group,
        renderer: this.lineRenderer,
        lineCap: 'round',
      });
      if (it.group) {
        pl._base = { color: it.color, weight: it.weight, opacity: it.opacity };
        if (!this.lineIndex.has(it.group)) this.lineIndex.set(it.group, []);
        this.lineIndex.get(it.group).push(pl);
        const at = (e) => ({ x: e.originalEvent.clientX, y: e.originalEvent.clientY });
        pl.on('mouseover', (e) => handlers.onEnter?.(it.group, at(e)));
        pl.on('mousemove', (e) => handlers.onMove?.(at(e)));
        pl.on('mouseout', () => handlers.onLeave?.());
      }
      pl.addTo(this.lineLayer);
    }
  },

  /** Lift one auto's whole patch out of the crowd; null puts everything back. */
  setLineHighlight(group) {
    for (const pl of this.lineIndex?.get(this.hovered) ?? []) pl.setStyle(pl._base);
    this.hovered = group;
    for (const pl of this.lineIndex?.get(group) ?? []) {
      pl.setStyle({ weight: pl._base.weight + 2.5, opacity: 1 });
      pl.bringToFront();
    }
  },

  clearLines() {
    this.lineLayer?.clearLayers();
    this.lineIndex = new Map();
    this.hovered = null;
  },

  /**
   * Filled shapes — district boundaries. These sit under the routes, in their
   * own pane, so a district can be hovered without the lines drawn over it
   * stealing the pointer.
   */
  shapes(items, handlers = {}) {
    this.clearShapes();
    if (!this.shapePane) {
      this.shapePane = this.map.createPane('huntShapes');
      this.shapePane.style.zIndex = 350; // above tiles (200), below overlay (400)
    }
    this.shapeIndex = new Map();
    for (const it of items) {
      const poly = L.polygon(it.rings.map((r) => r.map(([lng, lat]) => [lat, lng])), {
        pane: 'huntShapes',
        color: it.stroke,
        weight: it.weight,
        opacity: it.strokeOpacity,
        fillColor: it.fill,
        fillOpacity: it.fillOpacity,
        interactive: true,
      });
      poly._base = {
        color: it.stroke, weight: it.weight, opacity: it.strokeOpacity,
        fillColor: it.fill, fillOpacity: it.fillOpacity,
      };
      this.shapeIndex.set(it.key, poly);
      const at = (e) => ({ x: e.originalEvent.clientX, y: e.originalEvent.clientY });
      poly.on('mouseover', (e) => handlers.onEnter?.(it.key, at(e)));
      poly.on('mousemove', (e) => handlers.onMove?.(at(e)));
      poly.on('mouseout', () => handlers.onLeave?.());
      poly.on('click', () => handlers.onClick?.(it.key));
      poly.addTo(this.map);
      this.shapes_ = this.shapes_ ?? [];
      this.shapes_.push(poly);
    }
  },

  setShapeHighlight(key, style) {
    for (const [k, poly] of this.shapeIndex ?? []) {
      poly.setStyle(k === key ? { ...poly._base, ...style } : poly._base);
      if (k === key) poly.bringToFront();
    }
  },

  clearShapes() {
    for (const p of this.shapes_ ?? []) p.remove();
    this.shapes_ = [];
    this.shapeIndex = new Map();
  },

  fit() {
    const b = this.layer.getBounds?.();
    if (b?.isValid()) this.map.fitBounds(b.pad(0.12));
  },

  /** Frame an arbitrary set of points — used to go to one auto's patch. */
  fitTo(points) {
    if (!points.length) return;
    // One area has no extent to fit, and fitBounds on a zero-size box slams the
    // map to maximum zoom — a street corner instead of a neighbourhood.
    if (points.length === 1) return this.map.setView([points[0].lat, points[0].lng], 13);
    const b = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    if (b.isValid()) this.map.fitBounds(b.pad(0.25), { maxZoom: 14 });
  },
};

// ---------------------------------------------------------------- Google

const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1b2430' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8496a9' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#26313f' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#5b6b7d' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a4859' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#334155' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#171f2a' }] },
];

/**
 * Google is used for the MAP only. There is deliberately no Directions code
 * here: the day's distance is estimated arithmetically (see estimateDay), which
 * needs no API, cannot be denied, and works offline.
 */
const GoogleImpl = {
  kind: 'google',
  map: null,
  mks: [],
  polys: [],
  info: null,
  heatLayer: null,

  async load(key) {
    if (window.google?.maps) return;
    await new Promise((resolve, reject) => {
      window.__gmapsReady = resolve;
      loadScript(
        // No `libraries=visualization` — that was for HeatmapLayer, which Google
        // deleted in 3.65. The heat is drawn on our own canvas overlay now, so
        // this asks for nothing beyond the plain Maps JavaScript API.
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__gmapsReady&v=weekly&region=IN`
      ).catch(reject);
      setTimeout(() => reject(new Error('Google Maps did not load. Check the key, its restrictions, and that Maps JavaScript API is enabled.')), 15000);
    });
  },

  mount(el) {
    this.map = new google.maps.Map(el, {
      center: { lat: 28.63, lng: 77.22 },
      zoom: 11,
      styles: DARK_STYLE,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      backgroundColor: '#131a23',
    });
    this.info = new google.maps.InfoWindow();
  },

  markers(items) {
    for (const m of this.mks) m.setMap(null);
    this.mks = items.map((it) => {
      const m = new google.maps.Marker({
        position: { lat: it.lat, lng: it.lng },
        map: this.map,
        title: it.title,
        label: it.label ? { text: String(it.label), color: '#fff', fontSize: '11px', fontWeight: '700' } : null,
        // Google has no CSS on its markers, so the halo is drawn as a thicker
        // coloured stroke — the closest this API gets to the ring the Leaflet
        // side renders.
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: it.size / 2,
          fillColor: it.color,
          fillOpacity: 1,
          strokeColor: { critical: '#ef4444', high: '#f59e0b' }[it.ring] ?? '#0d1117',
          strokeWeight: it.ring ? 4 : 2,
          strokeOpacity: it.ring ? 0.95 : 1,
        },
      });
      m.addListener('click', () => {
        if (it.onClick) return it.onClick();
        this.info.setContent(it.popup);
        this.info.open(this.map, m);
        setTimeout(bindPopupActions, 0);
      });
      return m;
    });
  },

  /**
   * Google has no canvas equivalent of Leaflet's renderer, so these are real
   * Polyline objects — and no `tolerance` either, so a hoverable line has to be
   * genuinely wide enough to hit. The view keeps the dormant weight at 2.5+ for
   * that reason rather than drawing hairlines nobody can catch.
   */
  lines(items, handlers = {}) {
    this.clearLines();
    this.lineIndex = new Map();

    this.polys = items.map((it) => {
      const pl = new google.maps.Polyline({
        path: [{ lat: it.a.lat, lng: it.a.lng }, { lat: it.b.lat, lng: it.b.lng }],
        map: this.map,
        strokeColor: it.color,
        strokeWeight: it.weight,
        strokeOpacity: it.opacity,
        // Only grouped lines are hit-tested. Anything else stays out of the way
        // of every mouse move the map handles.
        clickable: !!it.group,
        zIndex: 1,
      });
      if (it.group) {
        pl._base = { strokeColor: it.color, strokeWeight: it.weight, strokeOpacity: it.opacity, zIndex: 1 };
        if (!this.lineIndex.has(it.group)) this.lineIndex.set(it.group, []);
        this.lineIndex.get(it.group).push(pl);
        const at = (e) => ({ x: e.domEvent?.clientX ?? 0, y: e.domEvent?.clientY ?? 0 });
        pl.addListener('mouseover', (e) => handlers.onEnter?.(it.group, at(e)));
        pl.addListener('mousemove', (e) => handlers.onMove?.(at(e)));
        pl.addListener('mouseout', () => handlers.onLeave?.());
      }
      return pl;
    });
  },

  /** Lift one auto's whole patch out of the crowd; null puts everything back. */
  setLineHighlight(group) {
    for (const pl of this.lineIndex?.get(this.hovered) ?? []) pl.setOptions(pl._base);
    this.hovered = group;
    for (const pl of this.lineIndex?.get(group) ?? []) {
      pl.setOptions({ strokeWeight: pl._base.strokeWeight + 2.5, strokeOpacity: 1, zIndex: 900 });
    }
  },

  clearLines() {
    for (const p of this.polys ?? []) p.setMap(null);
    this.polys = [];
    this.lineIndex = new Map();
    this.hovered = null;
  },

  /** Filled shapes — district boundaries, drawn beneath the routes. */
  shapes(items, handlers = {}) {
    this.clearShapes();
    this.shapeIndex = new Map();
    this.shapes_ = items.map((it) => {
      const poly = new google.maps.Polygon({
        paths: it.rings.map((r) => r.map(([lng, lat]) => ({ lat, lng }))),
        map: this.map,
        strokeColor: it.stroke,
        strokeWeight: it.weight,
        strokeOpacity: it.strokeOpacity,
        fillColor: it.fill,
        fillOpacity: it.fillOpacity,
        clickable: true,
        zIndex: 0,
      });
      poly._base = {
        strokeColor: it.stroke, strokeWeight: it.weight, strokeOpacity: it.strokeOpacity,
        fillColor: it.fill, fillOpacity: it.fillOpacity, zIndex: 0,
      };
      this.shapeIndex.set(it.key, poly);
      const at = (e) => ({ x: e.domEvent?.clientX ?? 0, y: e.domEvent?.clientY ?? 0 });
      poly.addListener('mouseover', (e) => handlers.onEnter?.(it.key, at(e)));
      poly.addListener('mousemove', (e) => handlers.onMove?.(at(e)));
      poly.addListener('mouseout', () => handlers.onLeave?.());
      poly.addListener('click', () => handlers.onClick?.(it.key));
      return poly;
    });
  },

  setShapeHighlight(key, style) {
    for (const [k, poly] of this.shapeIndex ?? []) {
      if (k !== key) { poly.setOptions(poly._base); continue; }
      poly.setOptions({
        ...poly._base,
        ...(style.color ? { strokeColor: style.color } : {}),
        ...(style.weight ? { strokeWeight: style.weight } : {}),
        ...(style.fillOpacity != null ? { fillOpacity: style.fillOpacity } : {}),
        ...(style.opacity != null ? { strokeOpacity: style.opacity } : {}),
        zIndex: 2,
      });
    }
  },

  clearShapes() {
    for (const p of this.shapes_ ?? []) p.setMap(null);
    this.shapes_ = [];
    this.shapeIndex = new Map();
  },

  /**
   * Our own canvas overlay, because google.maps.visualization.HeatmapLayer was
   * REMOVED in Maps JavaScript API 3.65. OverlayView is core, long-stable API —
   * unlike the visualization library, it is not going anywhere.
   *
   * The class has to be built lazily: it extends google.maps.OverlayView, which
   * does not exist until the Maps script has loaded.
   */
  async heat(points, prefs) {
    this.clearHeat();
    if (!points.length) return;

    if (!this.HeatOverlay) {
      this.HeatOverlay = class extends google.maps.OverlayView {
        constructor(points, prefs) {
          super();
          this.points = points;
          this.prefs = { ...prefs };
        }
        onAdd() {
          this.canvas = document.createElement('canvas');
          this.canvas.style.position = 'absolute';
          this.canvas.style.pointerEvents = 'none';
          this.getPanes().overlayLayer.appendChild(this.canvas);
        }
        onRemove() {
          this.onRemoveFrame();
          this.canvas?.remove();
          this.canvas = null;
        }
        setPrefs(prefs) {
          this.prefs = { ...prefs };
          this.draw();
        }
        /**
         * Google calls draw() continuously while the map is being dragged, and a
         * repaint walks every pixel of the canvas twice. Collapsing repeats into
         * one paint per animation frame keeps a drag smooth instead of letting
         * the work queue up behind the pointer.
         */
        draw() {
          if (this._pending) return;
          this._pending = requestAnimationFrame(() => { this._pending = 0; this.render(); });
        }
        onRemoveFrame() {
          if (this._pending) cancelAnimationFrame(this._pending);
          this._pending = 0;
        }
        render() {
          const proj = this.getProjection();
          const map = this.getMap();
          if (!proj || !this.canvas || !map) return;
          const bounds = map.getBounds();
          if (!bounds) return;

          const sw = proj.fromLatLngToDivPixel(bounds.getSouthWest());
          const ne = proj.fromLatLngToDivPixel(bounds.getNorthEast());
          const pad = this.prefs.radius * 2;
          const left = Math.min(sw.x, ne.x) - pad;
          const top = Math.min(sw.y, ne.y) - pad;
          const w = Math.round(Math.abs(ne.x - sw.x) + pad * 2);
          const h = Math.round(Math.abs(sw.y - ne.y) + pad * 2);
          if (w <= 0 || h <= 0) return;

          this.canvas.style.left = `${left}px`;
          this.canvas.style.top = `${top}px`;
          this.canvas.width = w;
          this.canvas.height = h;
          this.canvas.style.width = `${w}px`;
          this.canvas.style.height = `${h}px`;

          renderHeat(this.canvas, this.points.map((p) => {
            const d = proj.fromLatLngToDivPixel(new google.maps.LatLng(p.lat, p.lng));
            return { x: d.x - left, y: d.y - top, weight: p.weight };
          }), {
            radius: this.prefs.radius,
            blur: heatBlur(this.prefs.radius),
            max: this.prefs.intensity,
          });
        }
      };
    }

    this.heatLayer = new this.HeatOverlay(points, prefs);
    this.heatLayer.setMap(this.map);
  },

  /** Live slider drag — repaint in place, no overlay teardown. */
  tuneHeat(prefs) {
    this.heatLayer?.setPrefs(prefs);
  },

  clearHeat() {
    if (this.heatLayer) { this.heatLayer.setMap(null); this.heatLayer = null; }
  },

  fit() {
    if (!this.mks.length) return;
    const b = new google.maps.LatLngBounds();
    for (const m of this.mks) b.extend(m.getPosition());
    this.map.fitBounds(b, 48);
  },

  /** Frame an arbitrary set of points — used to go to one auto's patch. */
  fitTo(points) {
    if (!points.length) return;
    // See the Leaflet note: a zero-size box fits to maximum zoom.
    if (points.length === 1) {
      this.map.setCenter({ lat: points[0].lat, lng: points[0].lng });
      this.map.setZoom(13);
      return;
    }
    const b = new google.maps.LatLngBounds();
    for (const p of points) b.extend({ lat: p.lat, lng: p.lng });
    this.map.fitBounds(b, 80);
  },
};

// ================================================================ marker model

function markerColor(a) {
  if (S.mapColor === 'zone') return ZONE_COLOR[a.zone] ?? ZONE_COLOR.Unzoned;
  if (S.mapColor === 'priority') {
    if (a.priority >= 70) return '#ef4444';
    if (a.priority >= 50) return '#f59e0b';
    if (a.priority >= 30) return '#00c2e0';
    return '#5b6b7d';
  }
  if (S.mapColor === 'demand') {
    if (!a.demand) return '#26313f';                              // not researched
    if (a.autos === 0) return a.demand.kind === 'gap' ? '#ef4444' : '#f59e0b'; // missing
    return '#10b981';                                             // demand, and he's there
  }
  // coverage
  if (a.autos === 0) return '#5b6b7d';
  if (a.autos < 6) return '#f59e0b';
  if (a.autos < 20) return '#00c2e0';
  return '#10b981';
}

function markerSize(a) {
  // In demand mode, size by opportunity rather than by autos — an area with
  // nothing of his but real demand is the biggest thing on the map, and sizing
  // it by his (zero) autos would hide exactly what he came to see.
  if (S.mapColor === 'demand') {
    if (!a.demand) return 12;
    return a.demand.kind === 'gap' ? 34 : 26;
  }
  if (a.autos === 0) return 16;
  return Math.min(46, 18 + Math.sqrt(a.autos) * 4.4);
}

function areaPopup(a) {
  const bits = [];
  if (a.autos) bits.push(`<b>${a.autos}</b> autos · ${a.contacts} contacts`);
  else bits.push('No drivers here yet');
  if (a.fleets) bits.push(`${a.fleets} fleet owner${a.fleets > 1 ? 's' : ''}`);
  if (a.captains) bits.push(`${a.captains} captain${a.captains > 1 ? 's' : ''}`);
  bits.push(a.lastVisit ? `Last visit ${a.lastVisit} (${a.daysSince}d ago)` : 'Never visited');
  if (a.demand) bits.push(`<span style="color:${a.demand.kind === 'gap' ? '#8b5cf6' : '#f59e0b'}">${esc(a.demand.reason.slice(0, 70))}${a.demand.reason.length > 70 ? '…' : ''}</span>`);

  const flag = a.flag
    ? `<div class="pop-meta" style="margin-top:6px;color:${{ critical: '#ef4444', high: '#f59e0b' }[a.flag.level] ?? 'inherit'}">
         <b>${FLAG_LEVEL[a.flag.level].mark} ${esc(a.flag.headline)}</b>
       </div>`
    : '';

  return `<div class="pop-title">${esc(a.name)}</div>
    <div class="pop-meta">${esc(a.zone)} · priority ${a.priority}${a.demand ? ` · <b>${a.demand.kind === 'gap' ? 'no buses here' : 'proven demand'}</b>` : ''}</div>
    ${flag}
    <div class="pop-meta" style="margin-top:5px">${bits.join('<br>')}</div>
    <div class="pop-actions">
      <button class="btn btn-sm btn-primary" data-pop-add="${a.id}">Add to plan</button>
      <button class="btn btn-sm" data-pop-open="${a.id}">Details</button>
    </div>`;
}

// ---------------------------------------------------------------- heat layers

const HEAT_LAYERS = {
  coverage: {
    label: 'Coverage',
    field: 'coverageHeat',
    blurb: 'Where your autos actually are during a working day — starting points, the areas drivers move through, the roads between them, and extra weight on the area each driver named as his best.',
    legend: [['#ef4444', 'Thick with your autos'], ['#f2d43c', 'A good few'], ['#31d67a', 'A handful'], ['#00b4d8', 'One or two'], ['transparent', 'Nobody of yours']],
  },
  demand: {
    label: 'Demand',
    field: 'demand',
    blurb: 'Where the research says the rides are — rail and metro hubs, and the wards with no bus service at all. This layer does not know or care where your drivers are.',
    legend: [['#ef4444', 'No buses at all — pure demand'], ['#f2d43c', 'Proven hub'], ['#00b4d8', 'Weaker signal'], ['transparent', 'Not researched']],
  },
  gap: {
    label: 'Gap',
    field: 'gap',
    blurb: 'Demand you are NOT serving. Hot means real rides and few or none of your autos. This is the recruiting map — the red is money on the table.',
    legend: [['#ef4444', 'Rides here, nobody of yours'], ['#f2d43c', 'Rides, thinly covered'], ['#00b4d8', 'Mostly covered'], ['transparent', 'No demand, or you own it']],
  },
};

/** Points for one heat layer, dropping the zeroes so cold areas stay clean. */
function heatData(layer) {
  const field = HEAT_LAYERS[layer]?.field;
  if (!field) return [];
  return (S.data.heatPoints ?? [])
    .filter((p) => p[field] > 0.02)
    .map((p) => ({ lat: p.lat, lng: p.lng, weight: p[field] }));
}

function areaMarkers() {
  // Under a heat layer the circles stop being the story and become handles:
  // the heat itself is not clickable, so small dots are what still let him
  // open an area and add it to the day.
  const heat = S.mapLayer !== 'circles';
  return S.data.areaStats
    .filter((a) => a.lat && a.lng)
    .map((a) => ({
      id: a.id,
      lat: a.lat,
      lng: a.lng,
      color: heat ? '#e8eef5' : markerColor(a),
      size: heat ? 9 : markerSize(a),
      label: heat ? '' : (a.autos || ''),
      // A halo, not a fill — the fill is already saying something else. Only
      // the two levels that mean "go there" get one; ringing the watch list
      // too would put a halo on most of the map.
      ring: a.flag && a.flag.level !== 'watch' ? a.flag.level : '',
      title: a.flag ? `${a.name} — ${a.flag.headline}` : `${a.name} — ${a.autos} autos`,
      popup: areaPopup(a),
    }));
}

/** Popups are re-created by both engines, so wire their buttons on each open. */
function bindPopupActions() {
  $$('[data-pop-add]').forEach((b) => {
    b.onclick = () => {
      S.pick.add(b.dataset.popAdd);
      toast(`${areaName(b.dataset.popAdd)} added to the plan`, 'good');
      go('plan');
    };
  });
  $$('[data-pop-open]').forEach((b) => {
    b.onclick = () => openArea(b.dataset.popOpen);
  });
}

// ================================================================ views

function paintBadges() {
  const s = S.data.summary;
  const t = S.data.trips.find((x) => x.date === todayStr() && x.status === 'planned');
  $('#badge-today').textContent = t ? `${t.stops.length}` : '';
  // Only the critical count. Putting all 55 flagged areas in a red pill would
  // read as an error state and stop meaning anything by the second day.
  $('#badge-coverage').textContent = s.coverageFlags.critical || '';
  // Drivers who have actually been asked where they work — which is exactly how
  // much Auto Hunter has to draw. Shown even at zero, because an empty badge
  // there would read as "nothing to see" when the truth is "nobody asked yet".
  $('#badge-hunter').textContent = S.data.workProgress?.asked ?? 0;
  $('#badge-areas').textContent = s.areas;
  $('#badge-drivers').textContent = s.contacts;
  $('#badge-captains').textContent = s.captains ?? 0;
  $('#badge-vehicles').textContent = s.vehicles ?? 0;
  $('#badge-models').textContent = s.modelCount;
  $('#badge-trips').textContent = s.tripsDone || '';
  $('#badge-settings').textContent = S.data.settings.mapsApiKey ? '' : 'key';
  // The collapsed-group roll-up is read off these badges, so it has to be
  // recomputed whenever they change and not only when the screen does.
  paintNav();
}

/**
 * Which group each screen lives under. Kept here rather than read back out of
 * the DOM so that go() can open the right group even when the click came from
 * somewhere else entirely — a "Open drivers" button on the map, say.
 */
const NAV_GROUP = {
  drivers: 'autor', captains: 'autor', vehicles: 'autor', models: 'autor',
  map: 'area', hunter: 'area', coverage: 'area', areas: 'area',
  plan: 'day', trips: 'day',
};

const navOpen = () => {
  try {
    const raw = JSON.parse(localStorage.getItem('ramaNav') ?? 'null');
    // Everything open on a first visit: a menu that starts shut hides the app
    // from someone who has never seen it.
    return Array.isArray(raw) ? new Set(raw) : new Set(['autor', 'area', 'day']);
  } catch { return new Set(['autor', 'area', 'day']); }
};

function paintNav() {
  const open = navOpen();
  for (const g of $$('.nav-group')) {
    const name = g.dataset.group;
    // The group holding the current screen stays open whatever was saved —
    // a highlighted row inside a collapsed group is a highlight nobody can see.
    const on = open.has(name) || NAV_GROUP[S.view] === name;
    g.classList.toggle('open', on);
    g.querySelector('.nav-head')?.setAttribute('aria-expanded', String(on));

    // Collapsed, the group speaks for its children: the critical-areas count is
    // the one number worth interrupting someone over, and burying it inside a
    // shut group would quietly switch that warning off.
    const rollup = $(`#rollup-${name}`);
    if (rollup) {
      const hidden = !on;
      const danger = [...g.querySelectorAll('.nav-sub .nav-badge.danger')]
        .reduce((n, b) => n + (Number(b.textContent) || 0), 0);
      rollup.textContent = hidden && danger ? String(danger) : '';
    }
  }
}

function toggleNavGroup(name) {
  const open = navOpen();
  if (open.has(name)) open.delete(name);
  else open.add(name);
  try { localStorage.setItem('ramaNav', JSON.stringify([...open])); } catch {}
  paintNav();
}

function go(view) {
  S.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  paintNav();
  const main = $('#main');
  // Full-bleed screens: the map fills the pane itself, so the usual page padding
  // would leave a border of background around it.
  main.classList.toggle('no-pad', view === 'map' || view === 'hunter');
  main.scrollTop = 0;
  ({ today: viewToday, plan: viewPlan, map: viewMap, hunter: viewHunter, coverage: viewCoverage, areas: viewAreas, drivers: viewDrivers, captains: viewCaptains, vehicles: viewVehicles, models: viewModels, trips: viewTrips, settings: viewSettings }[view])();
}

/**
 * Read the model straight off a plate — same rule as the server's plates.js.
 * Duplicated deliberately: the alternative is a round trip for something the
 * browser needs while typing in a filter box.
 */
function plateModel(raw) {
  const num = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = num.match(/^([A-Z]{2})(\d{1,2})([A-Z]+)(\d+)$/);
  if (!m) return '';
  const [, state, rto, series] = m;
  if (state === 'DL' && series.length > 1 && series[0] === 'R') return series.slice(1);
  return `${state}${rto}-${series}`;
}

// ---------------------------------------------------------------- today

function viewToday() {
  const s = S.data.summary;
  const stats = S.data.areaStats;
  const trip = S.data.trips.find((t) => t.date === todayStr() && t.status === 'planned')
    ?? S.data.trips.filter((t) => t.status === 'planned').sort((a, b) => (a.date < b.date ? -1 : 1))[0];

  const targets = stats.slice().sort((a, b) => b.priority - a.priority).slice(0, 6);
  // The flagged areas, worst first. Same calculation and same words as the
  // Needs Coverage page — this is a window onto that list, not a second opinion.
  const flagged = flaggedAreas().slice(0, 6);
  const fleets = S.data.contacts
    .filter((c) => (c.fleetSize ?? 0) > 1)
    .sort((a, b) => b.fleetSize - a.fleetSize)
    .slice(0, 5);

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Home</div>
        <div class="page-sub">${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-go="map">Open map</button>
        <button class="btn btn-primary" data-go="plan">Plan a day</button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat">
        <div class="stat-label">Autos on roll</div>
        <div class="stat-value teal">${s.autos}</div>
        <div class="stat-foot">${s.contacts} contacts</div>
      </div>
      <div class="stat">
        <div class="stat-label">Fleet owners</div>
        <div class="stat-value violet" style="color:var(--violet)">${s.fleetOwners}</div>
        <div class="stat-foot">${s.autosInFleets} autos between them</div>
      </div>
      <div class="stat">
        <div class="stat-label">Areas covered</div>
        <div class="stat-value">${s.covered}<span class="dim" style="font-size:15px">/${s.areas}</span></div>
        <div class="stat-foot">${s.untapped} untapped</div>
      </div>
      <div class="stat" style="cursor:pointer" data-go="coverage">
        <div class="stat-label">Needs coverage</div>
        <div class="stat-value" style="color:var(--red)">${s.coverageFlags.critical}<span class="dim" style="font-size:15px"> critical</span></div>
        <div class="stat-foot">${s.coverageFlags.total} areas flagged in all</div>
      </div>
      <div class="stat">
        <div class="stat-label">Signed from visits</div>
        <div class="stat-value amber">${s.signedTotal}</div>
        <div class="stat-foot">${s.tripsDone} visits done</div>
      </div>
    </div>

    <div class="today-grid">
      <div class="card">
        <div class="card-head">
          <div class="card-title">${trip ? (trip.date === todayStr() ? "Today's route" : `Next trip — ${trip.date}`) : 'No trip planned'}</div>
          ${trip ? `<button class="btn btn-sm" data-open-trip="${trip.id}">Open</button>` : ''}
        </div>
        ${trip ? tripStopsHtml(trip) : `
          <div class="empty">
            <div class="empty-title">Nothing planned yet</div>
            <div style="font-size:12.5px;margin-bottom:14px">Pick a few areas and I'll work out the best order to drive them.</div>
            <button class="btn btn-primary" data-go="plan">Plan a day</button>
          </div>`}
      </div>

      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="card-head">
            <div class="card-title">Flagged — needs covering</div>
            <button class="btn btn-sm btn-ghost" data-go="coverage">See all ${s.coverageFlags.total}</button>
          </div>
          <div class="field-hint" style="margin:-4px 0 8px">
            ${s.coverageFlags.critical} areas have real demand, no bus service, and none of your autos.
          </div>
          ${flagged.map((a) => `
            <div class="flag-mini flag-${a.flag.level}">
              <span class="flag-dot"></span>
              <div class="flag-mini-name">${esc(a.name)}
                <div class="flag-mini-why">${esc(a.flag.headline)}</div>
              </div>
              <button class="btn btn-sm" data-add-area="${a.id}">+</button>
            </div>`).join('')}
          <button class="btn btn-sm btn-ghost btn-block" id="t-why" style="margin-top:10px">Why these areas?</button>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">Where to go next</div>
            <div class="card-note">by priority</div>
          </div>
          ${targets.map((a) => `
            <div class="target-row">
              <span class="zone-dot" style="background:${ZONE_COLOR[a.zone] ?? '#5b6b7d'}"></span>
              <div class="target-name">${a.flag ? `<span class="flag-mark" title="${esc(a.flag.headline)}">${FLAG_LEVEL[a.flag.level].mark}</span> ` : ''}${esc(a.name)}
                <div class="target-meta">${a.autos ? `${a.autos} autos` : 'never worked'} · ${a.onVisitList ? 'on your list' : esc(a.zone)}${a.daysSince != null ? ` · ${a.daysSince}d ago` : ''}</div>
              </div>
              <div class="pri" style="width:78px">
                <div class="pri-bar"><div class="pri-fill" style="width:${a.priority}%;background:${a.priority >= 70 ? '#ef4444' : a.priority >= 50 ? '#f59e0b' : '#00c2e0'}"></div></div>
                <div class="pri-num">${a.priority}</div>
              </div>
              <button class="btn btn-sm" data-add-area="${a.id}">+</button>
            </div>`).join('')}
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-title">Biggest fleet owners</div>
            <div class="card-note">one call, many autos</div>
          </div>
          ${fleets.map((c) => `
            <div class="target-row">
              <div class="target-name">${esc(c.name)}
                <div class="target-meta">${esc(areaName(c.areaId))}${c.fleetType === 'group' ? ` · ${c.altNames.length + 1} drivers on one number` : ''}</div>
              </div>
              <span class="chip chip-violet">${c.fleetSize} autos</span>
              <a class="btn btn-sm tel" href="tel:${esc(c.phone)}">Call</a>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  wireCommon();
  $('#t-why').onclick = showDemandFacts;
  $$('[data-open-trip]').forEach((b) => (b.onclick = () => openTrip(b.dataset.openTrip)));
  $$('[data-add-area]').forEach((b) => (b.onclick = () => { S.pick.add(b.dataset.addArea); toast(`${areaName(b.dataset.addArea)} added`, 'good'); go('plan'); }));
}

function tripStopsHtml(trip) {
  const rows = trip.stops.map((st, i) => {
    const a = area(st.areaId);
    return `
      <div class="trip-stop ${st.done ? 'done' : ''}">
        <div class="stop-seq">${st.done ? '✓' : i + 1}</div>
        <div class="stop-body">
          <div class="stop-name">${esc(a?.name ?? '?')}</div>
          <div class="stop-meta">${esc(a?.zone ?? '')}${a?.autos ? ` · ${a.autos} autos already` : ' · untapped'}${st.autosSigned ? ` · <span style="color:var(--green)">+${st.autosSigned} signed</span>` : ''}</div>
        </div>
        <div class="stop-actions">
          <button class="btn btn-sm" data-log="${trip.id}:${i}">Log</button>
        </div>
      </div>`;
  }).join('');

  const foot = trip.totalKm != null
    ? `<div class="leg-line" style="padding-left:0;margin-top:10px">~${trip.totalKm} km · about ${hm(trip.totalMin)} including stops · estimated</div>`
    : '';
  return rows + foot;
}

// ---------------------------------------------------------------- needs coverage

const FLAG_LEVEL = {
  critical: {
    label: 'Critical',
    mark: '🚩',
    title: 'Nobody is serving these',
    note: 'No bus service in the ward, and not one of your autos. Every trip here is somebody stuck.',
  },
  high: {
    label: 'Needs autos',
    mark: '🔶',
    title: 'Real demand, you are not there',
    note: 'Researched demand hubs where you have nothing, and areas you are covering far too thinly.',
  },
  watch: {
    label: 'Worth a look',
    mark: '·',
    title: 'Keep an eye on these',
    note: 'On your own visit list but never visited, or somewhere nobody has been in months.',
  },
};

/** Every flagged area, hottest first. */
function flaggedAreas() {
  return S.data.areaStats
    .filter((a) => a.flag)
    .sort((x, y) => y.flag.score - x.flag.score);
}

function flagRow(a) {
  const L = FLAG_LEVEL[a.flag.level];
  const picked = S.pick.has(a.id);
  return `
    <div class="flag-row flag-${a.flag.level}">
      <span class="flag-dot" title="${esc(L.label)}"></span>
      <div class="flag-body">
        <div class="flag-name">${esc(a.name)}
          <span class="chip chip-dim">${esc(a.zone)}</span>
          ${a.autos ? `<span class="chip chip-teal">${a.autos} autos</span>` : ''}
        </div>
        <div class="flag-head">${esc(a.flag.headline)}</div>
        <ul class="flag-why">${a.flag.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>
      <div class="flag-side">
        <div class="pri" style="width:74px">
          <div class="pri-bar"><div class="pri-fill" style="width:${a.priority}%;background:${a.priority >= 70 ? 'var(--red)' : a.priority >= 50 ? 'var(--amber)' : 'var(--teal-hi)'}"></div></div>
          <div class="pri-num">${a.priority}</div>
        </div>
        <button class="btn btn-sm ${picked ? '' : 'btn-primary'}" data-add-area="${a.id}" ${picked ? 'disabled' : ''}>${picked ? 'In the plan' : 'Add to plan'}</button>
        <button class="btn btn-sm btn-ghost" data-open-area="${a.id}">Details</button>
      </div>
    </div>`;
}

/**
 * The list Rama sir works from: every area that needs covering, worst first,
 * each one saying WHY in his own terms rather than as a score.
 */
function viewCoverage() {
  const all = flaggedAreas();
  const f = S.data.summary.coverageFlags;
  const zone = S.filter.coverZone;
  const level = S.filter.coverLevel;
  const shown = all.filter((a) => (!zone || a.zone === zone) && (!level || a.flag.level === level));
  const zones = [...new Set(all.map((a) => a.zone))].sort();

  // The straight answer to "so where do I go tomorrow": the worst few that are
  // close enough to each other to be one day's driving is a harder problem than
  // it looks, so this just takes the top of the list and lets the planner sort
  // the order out — which is exactly what it is for.
  const topUp = shown.slice(0, S.data.settings.visitsPerDay ?? 4);

  const groups = ['critical', 'high', 'watch']
    .map((lvl) => {
      const rows = shown.filter((a) => a.flag.level === lvl);
      if (!rows.length) return '';
      const L = FLAG_LEVEL[lvl];
      return `
        <div>
          <div class="flag-group-head">
            <span class="flag-dot flag-${lvl}" style="align-self:center"></span>
            <span class="flag-group-title">${esc(L.title)}</span>
            <span class="flag-group-note">${rows.length} area${rows.length === 1 ? '' : 's'} · ${esc(L.note)}</span>
          </div>
          ${rows.map(flagRow).join('')}
        </div>`;
    })
    .join('');

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Needs Coverage</div>
        <div class="page-sub">${f.total} areas flagged — ${f.critical} critical, ${f.high} needing autos, ${f.watch} to watch</div>
      </div>
      <div class="page-actions">
        <button class="btn" data-go="map">See it on the map</button>
        <button class="btn btn-primary" id="cov-plan" ${topUp.length ? '' : 'disabled'}>Plan the top ${topUp.length}</button>
      </div>
    </div>

    <div class="stat-row four">
      <div class="stat" style="cursor:pointer" data-cov-level="critical">
        <div class="stat-label">Critical</div>
        <div class="stat-value" style="color:var(--red)">${f.critical}</div>
        <div class="stat-foot">No buses, none of your autos</div>
      </div>
      <div class="stat" style="cursor:pointer" data-cov-level="high">
        <div class="stat-label">Needs autos</div>
        <div class="stat-value amber">${f.high}</div>
        <div class="stat-foot">Demand you are not serving</div>
      </div>
      <div class="stat" style="cursor:pointer" data-cov-level="watch">
        <div class="stat-label">Worth a look</div>
        <div class="stat-value">${f.watch}</div>
        <div class="stat-foot">Your list, or gone stale</div>
      </div>
      <div class="stat">
        <div class="stat-label">Already covered</div>
        <div class="stat-value green">${S.data.summary.covered}<span class="dim" style="font-size:15px">/${S.data.summary.areas}</span></div>
        <div class="stat-foot">areas with at least one auto</div>
      </div>
    </div>

    <div class="search-bar">
      <select id="cov-zone">
        <option value="">All zones</option>
        ${zones.map((z) => `<option value="${esc(z)}" ${z === zone ? 'selected' : ''}>${esc(z)}</option>`).join('')}
      </select>
      <select id="cov-level">
        <option value="">All levels</option>
        ${Object.entries(FLAG_LEVEL).map(([k, L]) => `<option value="${k}" ${k === level ? 'selected' : ''}>${esc(L.title)}</option>`).join('')}
      </select>
      <div class="sp"></div>
      <span class="dim">${shown.length} of ${all.length} shown</span>
    </div>

    ${shown.length
      ? `<div class="flag-groups">${groups}</div>`
      : `<div class="empty"><div class="empty-title">Nothing flagged here</div><div style="font-size:12.5px">Every area in this filter has autos on it.</div></div>`}`;

  wireCommon();
  $('#cov-zone').onchange = (e) => { S.filter.coverZone = e.target.value; viewCoverage(); };
  $('#cov-level').onchange = (e) => { S.filter.coverLevel = e.target.value; viewCoverage(); };
  $$('[data-cov-level]').forEach((b) => (b.onclick = () => {
    // Clicking the same stat twice clears it — the stats double as the filter.
    S.filter.coverLevel = S.filter.coverLevel === b.dataset.covLevel ? '' : b.dataset.covLevel;
    viewCoverage();
  }));
  $$('[data-add-area]').forEach((b) => (b.onclick = () => {
    S.pick.add(b.dataset.addArea);
    toast(`${areaName(b.dataset.addArea)} added to the plan`, 'good');
    viewCoverage();
  }));
  $$('[data-open-area]').forEach((b) => (b.onclick = () => openArea(b.dataset.openArea)));
  $('#cov-plan').onclick = () => {
    for (const a of topUp) S.pick.add(a.id);
    toast(`${topUp.length} areas added`, 'good');
    go('plan');
  };
}

// ---------------------------------------------------------------- plan

function viewPlan() {
  const stats = S.data.areaStats.slice().sort((a, b) => b.priority - a.priority);
  const zones = [...new Set(stats.map((a) => a.zone))];

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Plan a day</div>
        <div class="page-sub">Tick the areas to work. I'll order them and estimate the day's distance and time.</div>
      </div>
    </div>

    <div class="plan-grid">
      <div>
        <div class="search-bar">
          <input type="search" id="plan-q" placeholder="Search areas…" value="${esc(S.filter.planQ)}">
          <select id="plan-zone">
            <option value="">All zones</option>
            ${zones.map((z) => `<option ${S.filter.planZone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}
          </select>
          <label class="check"><input type="checkbox" id="plan-list-only" ${S.filter.planListOnly ? 'checked' : ''}> On my visit list</label>
          <label class="check"><input type="checkbox" id="plan-untapped" ${S.filter.planUntapped ? 'checked' : ''}> Untapped only</label>
          <div class="sp"></div>
          <button class="btn btn-sm" id="plan-add-shown">Add all shown</button>
        </div>
        <div class="pick-count" id="pick-count"></div>
        <div class="pick-list" id="pick-list"></div>
        <div class="field-hint" style="margin-top:8px">Tip: pick a zone, tick <strong>Untapped only</strong>, then <strong>Add all shown</strong> — that sweeps a whole zone the way your visit list is already grouped.</div>
      </div>

      <div class="basket card">
        <div class="card-head">
          <div class="card-title">The plan</div>
          <button class="btn btn-sm btn-ghost" id="clear-pick">Clear</button>
        </div>

        <div class="field">
          <label class="field-label">Date</label>
          <input type="date" id="plan-date" value="${S.planDate}">
        </div>

        <div id="basket-body"></div>

        <div class="drawer-foot">
          <button class="btn btn-primary btn-block" id="btn-optimise">Estimate the day</button>
        </div>
        <div class="drawer-foot">
          <button class="btn btn-block" id="btn-save-trip" disabled>Save as trip</button>
        </div>
      </div>
    </div>`;

  const shown = () => {
    const q = S.filter.planQ.trim().toLowerCase();
    return stats.filter((a) =>
      (!q || a.name.toLowerCase().includes(q)) &&
      (!S.filter.planZone || a.zone === S.filter.planZone) &&
      (!S.filter.planListOnly || a.onVisitList) &&
      (!S.filter.planUntapped || a.autos === 0)
    );
  };

  const paint = () => {
    const rows = shown();

    // Say out loud how many areas a filter is hiding. Untapped areas score +30,
    // so they already fill the top of a priority-sorted list — ticking "Untapped
    // only" removes rows from the bottom, below the scroll, and looks like the
    // tick did nothing. This line is the only visible proof that it did.
    const hidden = stats.length - rows.length;
    $('#pick-count').innerHTML = hidden
      ? `Showing <strong>${rows.length}</strong> of ${stats.length} areas · ${hidden} hidden by filters`
      : `${stats.length} areas`;

    $('#pick-list').innerHTML = rows.length ? rows.map((a) => `
      <label class="pick ${S.pick.has(a.id) ? 'on' : ''}">
        <input type="checkbox" data-pick="${a.id}" ${S.pick.has(a.id) ? 'checked' : ''}>
        <span class="zone-dot" style="background:${ZONE_COLOR[a.zone] ?? '#5b6b7d'}"></span>
        <div class="pick-body">
          <div class="pick-name">${esc(a.name)} ${a.onVisitList ? '<span class="chip chip-teal">list</span>' : ''}
            ${a.demand && a.autos === 0 ? `<span class="chip ${a.demand.kind === 'gap' ? 'chip-violet' : 'chip-amber'}">${a.demand.kind === 'gap' ? 'no buses' : 'demand'}</span>` : ''}</div>
          <div class="pick-meta">${a.autos ? `${a.autos} autos · ${a.contacts} contacts` : 'no drivers yet'}${a.fleets ? ` · ${a.fleets} fleet` : ''}${a.lastVisit ? ` · seen ${a.daysSince}d ago` : ''}</div>
        </div>
        <div class="pri" style="width:70px">
          <div class="pri-bar"><div class="pri-fill" style="width:${a.priority}%;background:${a.priority >= 70 ? '#ef4444' : a.priority >= 50 ? '#f59e0b' : '#00c2e0'}"></div></div>
          <div class="pri-num">${a.priority}</div>
        </div>
      </label>`).join('') : '<div class="empty">No areas match.</div>';

    $$('[data-pick]').forEach((cb) => {
      cb.onchange = () => {
        cb.checked ? S.pick.add(cb.dataset.pick) : S.pick.delete(cb.dataset.pick);
        S.planned = null;
        paint();
        paintBasket();
      };
    });
  };

  const paintBasket = () => {
    const ids = [...S.pick];
    const ordered = S.planned?.order ?? ids;
    $('#basket-body').innerHTML = ids.length ? `
      ${ordered.map((id, i) => `
        <div class="basket-item">
          <span class="basket-seq">${i + 1}</span>
          <span class="basket-name">${esc(areaName(id))}</span>
          ${S.planned?.legMin ? `<span class="dim mono" style="font-size:11px">${S.planned.legMin[i]}m</span>` : ''}
          <button class="basket-x" data-unpick="${id}">×</button>
        </div>`).join('')}
      ${S.planned ? `
        <div class="route-summary">
          <div><div class="rs-label">Distance</div><div class="rs-value">~${S.planned.totalKm} km</div></div>
          <div><div class="rs-label">Time</div><div class="rs-value">~${hm(S.planned.totalMin)}</div></div>
        </div>
        <div class="field-hint">${hm(S.planned.driveMin)} driving + ${hm(S.planned.stopMin)} at stops.
          <br>Estimated: ${S.planned.crowKm} km straight-line × ${S.planned.detourFactor} for real Delhi roads,
          at ${S.planned.speedKmh} km/h. Expect ±10%.</div>` : ''}
      ${overLong(ids.length) ? `<div class="note warn" style="margin-top:10px">${overLong(ids.length)}</div>` : ''}
    ` : '<div class="dim" style="font-size:12.5px;padding:8px 0">Nothing picked yet. Tick a few areas on the left, or add them from the map.</div>';

    $$('[data-unpick]').forEach((b) => (b.onclick = () => { S.pick.delete(b.dataset.unpick); S.planned = null; paint(); paintBasket(); }));
    $('#btn-save-trip').disabled = !ids.length;
    $('#btn-optimise').disabled = ids.length < 1;
  };

  $('#plan-q').oninput = (e) => { S.filter.planQ = e.target.value; paint(); };
  $('#plan-zone').onchange = (e) => { S.filter.planZone = e.target.value; paint(); };
  $('#plan-list-only').onchange = (e) => { S.filter.planListOnly = e.target.checked; paint(); };
  $('#plan-untapped').onchange = (e) => { S.filter.planUntapped = e.target.checked; paint(); };
  $('#plan-date').onchange = (e) => { S.planDate = e.target.value; S.planned = null; paintBasket(); };
  $('#clear-pick').onclick = () => { S.pick.clear(); S.planned = null; paint(); paintBasket(); };
  $('#plan-add-shown').onclick = () => {
    const rows = shown();
    if (!rows.length) return toast('Nothing to add', 'bad');
    rows.forEach((a) => S.pick.add(a.id));
    S.planned = null;
    paint();
    paintBasket();
    toast(`${rows.length} area${rows.length === 1 ? '' : 's'} added`, 'good');
  };
  $('#btn-optimise').onclick = estimateDay;
  $('#btn-save-trip').onclick = saveTrip;

  paint();
  paintBasket();
}

/**
 * Say so when a day is overstuffed, measured against the "stops per day" and
 * "minutes per stop" he set in Settings. A route the app happily plans but he
 * cannot actually finish is worse than no plan — he'd drop the last stops and
 * the log would show visits that never happened.
 */
function overLong(count) {
  const perDay = S.data.settings.visitsPerDay ?? 4;
  if (count <= perDay) return '';
  const mins = S.planned?.totalMin;
  const time = mins ? ` — about ${hm(mins)} with driving` : '';
  return `<strong>${count} stops${time}.</strong> You planned for ${perDay} a day. Split it across two days, or drop the weakest stops.`;
}

/**
 * Estimate the day: sensible stop order and a distance figure.
 *
 * Deliberately NO routing service — not Google, not anything online. This runs
 * on the server in milliseconds, works offline, and cannot fail with a
 * REQUEST_DENIED or a dead API. Rama sir knows Delhi's roads better than any
 * router; what he needs from the app is a realistic number for the day, not
 * turn-by-turn directions.
 *
 * The distance is straight-line multiplied by the measured Delhi detour factor,
 * so it reflects a real drive rather than the crow-flies fiction.
 */
async function estimateDay() {
  const ids = [...S.pick];
  if (!ids.length) return;

  const btn = $('#btn-optimise');
  btn.disabled = true;
  btn.textContent = 'Working…';

  try {
    const r = await api('POST', '/route', { areaIds: ids, start: S.data.settings.homeBase });
    S.planned = {
      order: r.order,
      crowKm: r.crowKm,
      totalKm: r.totalKm,
      driveMin: r.driveMin,
      stopMin: r.stopMin,
      totalMin: r.totalMin,
      detourFactor: r.detourFactor,
      speedKmh: r.speedKmh,
      source: r.source,
    };
    toast(`${ids.length} stops · about ${r.totalKm} km, ${hm(r.totalMin)}`, 'good');
  } catch (err) {
    if (!serverDownShown) toast(err.message, 'bad');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Estimate the day';
    viewPlan();
  }
}

async function saveTrip() {
  const ids = S.planned?.order ?? [...S.pick];
  if (!ids.length) return;
  const trip = await api('POST', '/trips', { date: S.planDate, areaIds: ids });
  if (S.planned) {
    await api('PUT', `/trips/${trip.id}`, {
      routeSource: S.planned.source,
      totalKm: S.planned.totalKm,
      totalMin: S.planned.totalMin,
    });
  }
  S.pick.clear();
  S.planned = null;
  await refresh();
  toast('Trip saved', 'good');
  go('today');
}

// ---------------------------------------------------------------- map

async function viewMap() {
  $('#main').innerHTML = `
    <div class="map-shell">
      <div class="map-wrap"><div id="map"></div><div class="map-banner" id="map-banner">Loading map…</div></div>
      <div class="map-side">
        <div>
          <div class="card-title" style="margin-bottom:8px">Show</div>
          <div class="seg" id="map-layer">
            <button data-layer="circles" title="One circle per area">Circles</button>
            <button data-layer="coverage" title="Where your autos work">Coverage</button>
            <button data-layer="demand" title="Where the rides are">Demand</button>
            <button data-layer="gap" title="Rides you are not serving">Gap</button>
          </div>
        </div>
        <div id="map-colour-wrap">
          <div class="card-title" style="margin:12px 0 8px">Colour by</div>
          <select id="map-color">
            <option value="coverage">Coverage — how many autos</option>
            <option value="demand">Demand — what I'm missing</option>
            <option value="priority">Priority — where to go next</option>
            <option value="zone">Zone</option>
          </select>
        </div>
        <div id="map-heat-tune" class="heat-tune">
          <div class="tune-row">
            <label for="heat-radius">Blob size</label>
            <output id="heat-radius-out"></output>
          </div>
          <input type="range" id="heat-radius"
            min="${HEAT_LIMITS.radius[0]}" max="${HEAT_LIMITS.radius[1]}" step="1">
          <div class="tune-row">
            <label for="heat-intensity">Intensity</label>
            <output id="heat-intensity-out"></output>
          </div>
          <input type="range" id="heat-intensity" min="0" max="100" step="1">
          <button class="btn btn-sm btn-block" id="heat-reset" style="margin-top:8px">Back to default</button>
        </div>
        <div class="map-legend" id="map-legend"></div>
        <div id="map-heat-note"></div>
        <div class="card">
          <div class="card-title" style="margin-bottom:8px">In the plan</div>
          <div id="map-basket" class="dim" style="font-size:12.5px">Nothing picked. Click a circle to add an area.</div>
        </div>
        <div class="note" id="map-note"></div>
      </div>
    </div>`;

  // The ring is drawn on every layer, so it is explained on every legend.
  const flagLegend = `
    <div class="legend-row" style="margin-top:8px"><span class="legend-swatch" style="background:transparent;border:3px solid #ef4444"></span>Ring: critical — nobody serving it</div>
    <div class="legend-row"><span class="legend-swatch" style="background:transparent;border:3px solid #f59e0b"></span>Ring: demand you are not covering</div>`;

  const paintLegend = () => {
    const heat = HEAT_LAYERS[S.mapLayer];
    if (heat) {
      $('#map-legend').innerHTML = heat.legend
        .map(([c, t]) => `<div class="legend-row"><span class="legend-swatch ${c === 'transparent' ? 'swatch-none' : ''}" style="background:${c}"></span>${esc(t)}</div>`)
        .join('')
        + '<div class="legend-row dim" style="margin-top:4px">White dots are areas — click one to add it to the day.</div>'
        + flagLegend;
      return;
    }
    const L = {
      coverage: [['#5b6b7d', 'No drivers yet'], ['#f59e0b', '1–5 autos'], ['#00c2e0', '6–19 autos'], ['#10b981', '20+ autos']],
      demand: [['#ef4444', 'Demand, no buses, none of yours'], ['#f59e0b', 'Proven demand, none of yours'], ['#10b981', 'Demand, and you\'re there'], ['#26313f', 'Not researched']],
      priority: [['#ef4444', 'Go now (70+)'], ['#f59e0b', 'Soon (50–69)'], ['#00c2e0', 'Worth a look (30–49)'], ['#5b6b7d', 'Low']],
      zone: Object.entries(ZONE_COLOR).map(([z, c]) => [c, z]),
    }[S.mapColor];
    const foot = S.mapColor === 'demand'
      ? 'Big circle = no bus service at all'
      : 'Circle size = autos on roll';
    $('#map-legend').innerHTML = L.map(([c, t]) => `<div class="legend-row"><span class="legend-swatch" style="background:${c}"></span>${esc(t)}</div>`).join('')
      + `<div class="legend-row dim" style="margin-top:4px">${foot}</div>`
      + flagLegend;
  };

  /**
   * Say what the layer means, and — for coverage — how much of it is actually
   * known. A heatmap invites belief, so a coverage picture built almost entirely
   * from spreadsheet home addresses has to admit that out loud, every time.
   */
  const paintHeatNote = () => {
    const heat = HEAT_LAYERS[S.mapLayer];
    const box = $('#map-heat-note');
    if (!heat) { box.innerHTML = ''; return; }

    const wp = S.data.workProgress ?? { asked: 0, drivers: 0, remaining: 0, pct: 0 };
    const honesty = S.mapLayer === 'coverage' && wp.asked < wp.drivers
      ? `<div class="note warn" style="margin-top:8px">
           <strong>${wp.asked} of ${wp.drivers} drivers have been asked</strong> where they actually work.
           ${wp.asked === 0
             ? 'So this is not really coverage yet — it is the spreadsheet\'s home addresses. It shows where drivers <em>live</em>, not where they <em>earn</em>.'
             : `The other ${wp.remaining} are still drawn at their home address.`}
           Fill it in from a driver's page under <strong>Drivers</strong>.
           <button class="btn btn-sm btn-primary btn-block" style="margin-top:8px" data-go="drivers">Open drivers</button>
         </div>`
      : '';
    box.innerHTML = `<div class="field-hint" style="margin-top:10px">${heat.blurb}</div>${honesty}`;
    wireCommon();
  };

  // The side panel is painted on its own so it is already correct while the map
  // tiles are still loading, and so re-entering the page cannot touch a map that
  // has not been mounted into this DOM yet.
  // Intensity is stored as the saturation ceiling, where a LOWER number is a
  // HOTTER map. Nobody should have to know that, so the slider runs 0-100 the
  // way it reads — right is hotter — and the inversion happens here.
  const [iLo, iHi] = HEAT_LIMITS.intensity;
  const sliderToIntensity = (v) => Math.round((iHi - (v / 100) * (iHi - iLo)) * 100) / 100;
  const intensityToSlider = (i) => Math.round(((iHi - i) / (iHi - iLo)) * 100);

  const paintTuneLabels = () => {
    $('#heat-radius-out').textContent = `${S.heat.radius}px`;
    $('#heat-intensity-out').textContent = `${intensityToSlider(S.heat.intensity)}%`;
  };

  const paintPanel = () => {
    $$('#map-layer button').forEach((b) => b.classList.toggle('on', b.dataset.layer === S.mapLayer));
    const heat = S.mapLayer !== 'circles';
    $('#map-colour-wrap').style.display = heat ? 'none' : '';
    $('#map-heat-tune').style.display = heat ? '' : 'none';
    $('#heat-radius').value = S.heat.radius;
    $('#heat-intensity').value = intensityToSlider(S.heat.intensity);
    paintTuneLabels();
    paintLegend();
    paintHeatNote();
  };

  // Dragging retunes the existing layer in place rather than rebuilding it, so
  // the map keeps up with the slider instead of stuttering behind it.
  const onTune = () => {
    S.heat.radius = Number($('#heat-radius').value);
    S.heat.intensity = sliderToIntensity(Number($('#heat-intensity').value));
    paintTuneLabels();
    saveHeatPrefs(S.heat);
    if (MapView.ready && MapView.impl) MapView.tuneHeat();
  };

  const applyLayer = async () => {
    paintPanel();
    // The buttons stay clickable even when the map itself failed to load, so
    // switching layers must not throw on top of the error already shown.
    if (!MapView.ready || !MapView.impl) return;
    MapView.markers(areaMarkers());
    try {
      if (S.mapLayer === 'circles') MapView.clearHeat();
      else await MapView.heat(heatData(S.mapLayer));
    } catch (err) {
      toast(err.message, 'bad');
    }
  };

  const paintBasket = () => {
    $('#map-basket').innerHTML = S.pick.size
      ? [...S.pick].map((id) => `<div class="basket-item"><span class="basket-name">${esc(areaName(id))}</span><button class="basket-x" data-unpick="${id}">×</button></div>`).join('')
        + '<button class="btn btn-sm btn-primary btn-block" style="margin-top:10px" data-go="plan">Open the plan</button>'
      : '<span class="dim">Nothing picked. Click a circle to add an area.</span>';
    $$('[data-unpick]').forEach((b) => (b.onclick = () => { S.pick.delete(b.dataset.unpick); paintBasket(); }));
    wireCommon();
  };

  $('#map-color').value = S.mapColor;
  $('#map-color').onchange = (e) => {
    S.mapColor = e.target.value;
    paintLegend();
    MapView.markers(areaMarkers());
  };
  $$('#map-layer button').forEach((b) => (b.onclick = () => { S.mapLayer = b.dataset.layer; applyLayer(); }));
  $('#heat-radius').oninput = onTune;
  $('#heat-intensity').oninput = onTune;
  $('#heat-reset').onclick = () => {
    S.heat = { ...HEAT_DEFAULTS };
    saveHeatPrefs(S.heat);
    paintPanel();
    if (MapView.ready && MapView.impl) MapView.tuneHeat();
  };
  paintPanel();
  paintBasket();

  try {
    const kind = await MapView.mount($('#map'));
    MapView.markers(areaMarkers());
    MapView.fit();
    await applyLayer();
    const s = S.data.summary;
    $('#map-banner').innerHTML = `${s.autos} autos across ${s.covered} areas · <span class="dim">${s.untapped} areas untapped</span>`;
    // The map is just a picture of where autos are. Route planning lives on the
    // Plan page and needs no map or key at all.
    $('#map-note').innerHTML = kind === 'google'
      ? 'Google Maps — real Delhi roads and labels.'
      : 'Free OpenStreetMap. Add a Google Maps key in <strong>Settings</strong> for Google\'s own map.';
  } catch (err) {
    $('#map-banner').textContent = err.message;
    $('#map-note').innerHTML = `<strong>Map could not load.</strong> ${esc(err.message)}`;
  }

  // Popups add to the plan; keep the side panel honest when they do.
  const obs = setInterval(() => {
    if (S.view !== 'map') return clearInterval(obs);
    const n = $('#map-basket')?.querySelectorAll('[data-unpick]').length ?? 0;
    if (n !== S.pick.size) paintBasket();
  }, 400);
}

// ---------------------------------------------------------------- auto hunter

/**
 * AUTO HUNTER — "a client wants Connaught Place. Which of my autos go there?"
 *
 * Answering that by hand means reading down the driver list and remembering
 * where each one said he works. This screen is that lookup, drawn.
 *
 * WHAT A ROUTE IS HERE. Every PAIR of a driver's areas, joined by a straight
 * line. Not a tour in some order — he never told us the order he drives them in,
 * and picking one would draw a specific road he may never take. Connecting all
 * the pairs claims only what he actually said: "these places are my patch."
 * This is the same model server.js already uses for heat corridors, deliberately
 * so — two screens disagreeing about where a driver goes would be a bug.
 *
 * WHOSE ROUTES GET DRAWN. Only drivers who have been ASKED. 162 of the 168 have
 * nothing but a home address off the spreadsheet, and joining home addresses
 * with lines would draw movement nobody ever reported — a confident picture of
 * a guess. Those drivers are counted in the panel, never drawn.
 *
 * WHY NO DISTANCE CAP. The heat corridors stop at 10 km, because claiming auto
 * traffic on the streets of a 15 km line nobody described is too strong. Here
 * the line is not a claim about the streets in between; it is a claim that one
 * driver works both ends, which is exactly what he said. So every pair is drawn.
 */
function hunterRoutes() {
  const byId = new Map(S.data.areaStats.map((a) => [a.id, a]));

  const routes = [];
  let askedCount = 0;
  let activeCount = 0;

  for (const c of S.data.contacts) {
    if (c.status && c.status !== 'active') continue;
    activeCount++;
    const w = c.work;
    if (!w?.asked) continue;
    askedCount++;

    // bestArea is already forced into workAreaIds by the server, but a Set
    // keeps this honest if that ever stops being true.
    const ids = [...new Set([w.startAreaId, ...(w.workAreaIds ?? []), w.bestAreaId].filter(Boolean))];
    const nodes = ids.map((id) => byId.get(id)).filter((a) => a?.lat && a?.lng);
    if (!nodes.length) continue;

    const pairs = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) pairs.push([nodes[i], nodes[j]]);
    }

    // A driver with ONE marked area has no line to draw but still serves that
    // area, so he belongs in the answer. Dropping him here would make the map
    // and the list disagree about who covers the place.
    routes.push({
      contact: c,
      areaIds: new Set(nodes.map((n) => n.id)),
      nodes,
      pairs,
      autos: Math.max(1, c.fleetSize ?? 1),
      bestAreaId: w.bestAreaId ?? null,
      startAreaId: w.startAreaId ?? null,
    });
  }

  return { routes, askedCount, activeCount };
}

/**
 * One colour per auto, so two patches crossing the same ground read as two
 * things and not one tangle.
 *
 * A fixed palette rather than a hue computed from the id: generated hues drift
 * into muddy olives and near-blacks that vanish on this map, and there is no
 * way to keep them clear of the two hues that already mean something here —
 * green for where he starts, amber for the areas you picked.
 *
 * With more drivers than colours these repeat, and that is fine. The colour is
 * there to separate neighbours at a glance; hovering is what names the auto.
 */
const HUNTER_COLORS = [
  '#00c2e0', '#8b5cf6', '#ec4899', '#3b82f6', '#f43f5e', '#14b8a6',
  '#a855f7', '#0ea5e9', '#fb7185', '#22d3ee', '#c084fc', '#60a5fa',
];
/**
 * BOUNDARIES — Delhi's administrative areas, as their real shapes.
 *
 * An auto "travels through" a district if any of its areas sits inside that
 * district, or if any of the straight lines between its areas crosses it. The
 * second case is the whole point: a driver who works Rohini and Karol Bagh
 * passes through North West and Central without either being on his list, and a
 * client asking for a district cares about that.
 *
 * The lines are straight rather than real roads, so this claims what the rest of
 * the screen claims — that his patch spans those two places — and no more.
 */
/**
 * Two levels, because "district" means different things to different clients.
 * Delhi's eleven revenue districts are the coarse answer; its twenty-seven
 * sub-districts are the same administrative hierarchy one step down, and they
 * are named after the places this planner already works in — Karol Bagh, Preet
 * Vihar, Hauz Khas. Twenty-three of the twenty-seven contain at least one area
 * from the roster, against 5.8 areas crammed into each district.
 */
const SHAPE_LAYERS = {
  districts: { file: '/districts.json', one: 'district', many: 'districts', shapes: null, routes: null },
  subdistricts: { file: '/subdistricts.json', one: 'sub-district', many: 'sub-districts', shapes: null, routes: null },
};

/** Derived from the routes, so any edit to who works where invalidates it. */
function clearShapeRoutes() {
  for (const layer of Object.values(SHAPE_LAYERS)) layer.routes = null;
}

async function loadShapes(kind) {
  const layer = SHAPE_LAYERS[kind];
  if (layer.shapes) return layer.shapes;
  const res = await fetch(layer.file);
  if (!res.ok) throw new Error(`Could not load the ${layer.one} boundaries (${res.status}).`);
  const geo = await res.json();
  layer.shapes = geo.features.map((f) => {
    // One bounding box per district turns most of the work below into a single
    // comparison. Without it this is a million edge tests on every repaint.
    let minLng = 1e9, minLat = 1e9, maxLng = -1e9, maxLat = -1e9;
    for (const ring of f.geometry.coordinates) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    return {
      name: f.properties.name,
      // Sub-districts carry the district they sit in, so a shape can say
      // "Karol Bagh, in Central" rather than just its own name.
      parent: f.properties.district ?? '',
      rings: f.geometry.coordinates,
      bbox: [minLng, minLat, maxLng, maxLat],
    };
  });
  return layer.shapes;
}

/** Ray casting. Rings are [lng, lat] pairs, as GeoJSON stores them. */
function pointInRings(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

const ccw = (ax, ay, bx, by, cx, cy) => (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);

/** Do segments AB and CD cross? Endpoints touching counts, which is what we want. */
const segmentsCross = (ax, ay, bx, by, cx, cy, dx, dy) =>
  ccw(ax, ay, cx, cy, dx, dy) !== ccw(bx, by, cx, cy, dx, dy)
  && ccw(ax, ay, bx, by, cx, cy) !== ccw(ax, ay, bx, by, dx, dy);

function segmentTouchesShape(a, b, d) {
  // Reject on bounding boxes first — most segments are nowhere near most
  // shapes, and this is the difference between instant and sluggish.
  const [minLng, minLat, maxLng, maxLat] = d.bbox;
  if (Math.max(a.lng, b.lng) < minLng || Math.min(a.lng, b.lng) > maxLng) return false;
  if (Math.max(a.lat, b.lat) < minLat || Math.min(a.lat, b.lat) > maxLat) return false;

  if (pointInRings(a.lng, a.lat, d.rings) || pointInRings(b.lng, b.lat, d.rings)) return true;
  // Both ends outside: it still crosses if it cuts the boundary anywhere.
  for (const ring of d.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if (segmentsCross(a.lng, a.lat, b.lng, b.lat, ring[j][0], ring[j][1], ring[i][0], ring[i][1])) return true;
    }
  }
  return false;
}

/** shape name -> Set of contact ids whose patch touches it. Computed once per layer. */
function shapeRoutes(kind, routes) {
  const layer = SHAPE_LAYERS[kind];
  if (layer.routes) return layer.routes;
  const out = new Map(layer.shapes.map((d) => [d.name, new Set()]));
  for (const d of layer.shapes) {
    const hit = out.get(d.name);
    for (const r of routes) {
      // An area of his inside the shape settles it without touching a line.
      if (r.nodes.some((n) => pointInRings(n.lng, n.lat, d.rings))) { hit.add(r.contact.id); continue; }
      if (r.pairs.some(([a, b]) => segmentTouchesShape(a, b, d))) hit.add(r.contact.id);
    }
  }
  layer.routes = out;
  return out;
}

const HUNTER_START = '#10b981'; // where he begins his day — where the autos sit
const HUNTER_PICK = '#f59e0b';  // an area you asked about
const HUNTER_THRU = '#00c2e0';  // he passes through, but does not start here

function hunterColor(id) {
  // Stable per driver: the same auto keeps its colour between repaints and
  // between visits, so "the pink one" stays the pink one.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return HUNTER_COLORS[h % HUNTER_COLORS.length];
}

function viewHunter() {
  const { routes, askedCount, activeCount } = hunterRoutes();
  const sel = S.hunterPick;
  const focus = S.hunterFocus;
  const routeOf = new Map(routes.map((r) => [r.contact.id, r]));

  // A driver focused earlier may since have been deleted, or had his areas
  // cleared. Drop him rather than carrying a chip that points at nothing.
  for (const id of [...focus]) if (!routeOf.has(id)) focus.delete(id);

  // How many autos (not drivers) serve each area — the number a client cares
  // about is vehicles carrying the ad, not people signed.
  const autosByArea = new Map();
  const driversByArea = new Map();
  // Where autos are BASED, as opposed to merely passing through. That is the
  // more actionable of the two: it is where you can expect to find the vehicle
  // standing, which is where an ad actually gets applied.
  const startAutos = new Map();
  for (const r of routes) {
    for (const id of r.areaIds) {
      autosByArea.set(id, (autosByArea.get(id) ?? 0) + r.autos);
      driversByArea.set(id, (driversByArea.get(id) ?? 0) + 1);
    }
    if (r.startAreaId) startAutos.set(r.startAreaId, (startAutos.get(r.startAreaId) ?? 0) + r.autos);
  }

  // Sorted by how many of the SELECTED areas each driver covers, so a driver who
  // hits everything the client asked for rises above one who hits a single area.
  // That ordering is the whole answer when a client names three places at once.
  const matching = () => {
    // On the district map the question is "who crosses this shape", so the
    // answer comes from geometry rather than from a list of ticked areas. The
    // rest of the screen — the map highlighting, the driver cards — does not
    // need to know which of the two asked.
    if (shapeMode()) {
      const name = liveDistrict();
      if (!name || !shapesNow()) return [];
      const ids = shapeRoutes(shapeMode(), routes).get(name) ?? new Set();
      return routes
        .filter((r) => ids.has(r.contact.id))
        .map((r) => ({ r, hits: 1 }))
        .sort((a, b) => b.r.autos - a.r.autos || a.r.contact.name.localeCompare(b.r.contact.name));
    }
    if (!sel.size) return [];
    return routes
      .map((r) => ({ r, hits: [...sel].filter((id) => r.areaIds.has(id)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || b.r.autos - a.r.autos || a.r.contact.name.localeCompare(b.r.contact.name));
  };

  const totalLines = routes.reduce((n, r) => n + r.pairs.length, 0);

  $('#main').innerHTML = `
    <div class="map-shell">
      <div class="map-wrap">
        <div id="map"></div>
        <div class="map-banner" id="hunt-banner">Loading map…</div>
        <div class="hunt-tip" id="hunt-tip" hidden></div>
      </div>
      <div class="map-side">
        <div>
          <div class="page-title" style="font-size:16px">Auto Hunter</div>
          <div class="field-hint" id="hunt-sub"></div>
        </div>

        <div class="seg" id="hunt-mode">
          <button data-mode="routes" title="Every auto's patch, area by area">Routes</button>
          <button data-mode="subdistricts" title="Delhi's 27 sub-districts — Karol Bagh, Preet Vihar, Hauz Khas">Sub-districts</button>
          <button data-mode="districts" title="Delhi's 11 revenue districts — the broad answer">Districts</button>
        </div>

        ${askedCount === 0 ? `
          <div class="note warn">
            <strong>No driver has been asked yet where he works.</strong>
            This screen draws the areas a driver told you he covers — until
            someone has been asked there is nothing to draw. Open a driver,
            fill in <em>Where he works</em>, and his route appears here.
            <button class="btn btn-sm btn-primary btn-block" style="margin-top:8px" data-go="drivers">Open drivers</button>
          </div>` : ''}

        <div id="hunt-areas-wrap">
          <div>
            <div class="card-title" style="margin-bottom:6px">Which areas does the client want?</div>
            <input type="text" id="hunt-q" placeholder="Search an area…" autocomplete="off">
            <div class="hunt-picked" id="hunt-picked"></div>
          </div>
          <div class="hunt-list" id="hunt-areas"></div>
        </div>

        <div id="hunt-districts-wrap" hidden>
          <div class="card-title" style="margin-bottom:6px" id="hunt-dist-title">Which area does the client want?</div>
          <div class="field-hint" style="margin-bottom:8px">
            Hover one on the map to light it up and mark every auto whose patch
            crosses it. Click to keep it.
          </div>
          <div class="hunt-list" id="hunt-dist-list"></div>
        </div>

        <div class="hunt-rule"></div>

        <div>
          <div class="card-title" style="margin-bottom:6px">Or find one auto</div>
          <input type="text" id="hunt-dq" placeholder="Name, phone or number plate…" autocomplete="off">
          <div class="field-hint" style="margin-top:5px">Shows where that one goes, and dims the rest.</div>
          <div class="hunt-picked" id="hunt-focused"></div>
        </div>

        <div class="hunt-list" id="hunt-found"></div>

        <div id="hunt-result"></div>

        <div class="map-legend">
          <div class="legend-row">
            <span class="legend-line legend-multi"></span>
            <span><strong>Each colour is one auto.</strong> Hover a line to see whose it is.</span>
          </div>
          <div class="legend-row"><span class="legend-swatch" style="background:${HUNTER_START}"></span>Starts his day here — where the autos sit</div>
          <div class="legend-row"><span class="legend-swatch" style="background:${HUNTER_THRU}"></span>Passes through</div>
          <div class="legend-row"><span class="legend-swatch" style="background:${HUNTER_PICK}"></span>An area you picked</div>
          <div class="legend-row dim" id="hunt-legend-foot">Thicker line = more autos. Numbers on the dots are autos.</div>
        </div>
        <div class="note" id="hunt-note"></div>
      </div>
    </div>`;

  $('#hunt-sub').innerHTML = askedCount
    ? `<strong>${askedCount}</strong> of ${activeCount} drivers have said where they work · ${totalLines} links drawn`
    : `0 of ${activeCount} drivers have said where they work`;

  // ---- map painting

  const paintMap = () => {
    if (!MapView.ready || !MapView.impl) return;
    const hits = new Set(matching().map((x) => x.r.contact.id));

    // Focusing one auto by name is a narrower question than "who serves this
    // area", so when both are active the spotlight wins the map. The answer
    // panel below still belongs to the areas — the two questions stay separate.
    // `hits` rather than `sel` so this works whichever question was asked —
    // ticked areas, or a district being pointed at.
    const on_ = (id) => (focus.size ? focus.has(id) : hits.size ? hits.has(id) : false);
    const dim_ = (id) => (focus.size ? !focus.has(id) : hits.size ? !hits.has(id) : false);

    // Which areas the spotlit autos actually touch, so everywhere else can step
    // back and leave the answer standing on its own.
    const litAreas = new Set();
    if (focus.size) for (const id of focus) for (const a of routeOf.get(id)?.areaIds ?? []) litAreas.add(a);

    const segs = [];
    for (const r of routes) {
      const on = on_(r.contact.id);
      // Everything unselected stays visible but recedes. Hiding it would throw
      // away the reason to look at this screen at all — the shape of where the
      // whole fleet goes is the context that makes one answer meaningful.
      const dim = dim_(r.contact.id);
      // Fleet size, flattened. A 10-auto owner should read as heavier than a
      // solo driver without being ten times the width and swallowing the map.
      // The floor is deliberate: Google has no hover tolerance, so a line has to
      // be wide enough to actually catch with a mouse.
      const weight = 1.8 + Math.min(2.6, Math.sqrt(r.autos) * 0.7);
      for (const [a, b] of r.pairs) {
        segs.push({
          a, b,
          color: hunterColor(r.contact.id),
          weight: on ? weight + 1 : weight,
          // Dormant by default so the map reads as a quiet web rather than a
          // shout; hovering is what brings one auto forward.
          opacity: on ? 0.9 : dim ? 0.1 : 0.3,
          // The whole patch shares one group, so hovering any segment of it
          // lights all of it — an auto is a patch, not a line.
          group: r.contact.id,
        });
      }
    }
    // Brightest last, so a matched route is never buried under the faint ones.
    segs.sort((x, y) => x.opacity - y.opacity);
    MapView.lines(segs, { onEnter: showTip, onMove: moveTip, onLeave: hideTip });

    MapView.markers(S.data.areaStats
      .filter((a) => a.lat && a.lng)
      .map((a) => {
        const autos = autosByArea.get(a.id) ?? 0;
        const starts = startAutos.get(a.id) ?? 0;
        const picked = sel.has(a.id);
        // With a spotlight on, anywhere the spotlit autos do not go steps back
        // too — otherwise the dots keep advertising a fleet you are not looking
        // at and the one auto's shape never emerges.
        const off = focus.size > 0 && !litAreas.has(a.id);
        return {
          id: a.id,
          lat: a.lat,
          lng: a.lng,
          // Picked beats based beats passed-through. Green outranks the plain
          // coverage colour because "the autos live here" is the stronger fact.
          color: off ? '#2b3542'
            : picked ? HUNTER_PICK : starts ? HUNTER_START : autos ? HUNTER_THRU : '#3a4859',
          size: off ? 7 : picked ? 20 : autos ? 15 : 8,
          label: off ? '' : autos ? String(autos) : '',
          title: `${a.name} — ${autos} auto${autos === 1 ? '' : 's'} from `
               + `${driversByArea.get(a.id) ?? 0} driver(s)`
               + (starts ? `, ${starts} starting here` : ''),
          // Clicking the map is the fastest way to answer "and this one?", so a
          // marker toggles the area rather than opening a popup about it.
          onClick: () => toggle(a.id),
        };
      }));
  };

  // ---- hover: name the auto under the cursor

  const showTip = (group, pt) => {
    const r = routes.find((x) => x.contact.id === group);
    const el = $('#hunt-tip');
    if (!r || !el) return;
    const c = r.contact;
    const plates = (c.vehicles ?? []).map((v) => v.number).filter(Boolean);
    el.innerHTML = `
      <div class="hunt-tip-name" style="border-color:${hunterColor(c.id)}">${esc(c.name)}</div>
      <div class="hunt-tip-sub">${r.autos} auto${r.autos === 1 ? '' : 's'}${
        c.phone ? ` · ${esc(c.phone)}` : ''}</div>
      ${plates.length ? `<div class="hunt-tip-plates">${
        plates.slice(0, 3).map((p) => `<span>${esc(p)}</span>`).join('')
      }${plates.length > 3 ? `<span class="more">+${plates.length - 3}</span>` : ''}</div>` : ''}
      <div class="hunt-tip-areas">${r.nodes.map((n) => `<span${
        sel.has(n.id) ? ' class="hit"' : ''}>${esc(n.name)}</span>`).join('')}</div>`;
    el.hidden = false;
    moveTip(pt);
    MapView.setLineHighlight(group);
  };

  // Kept inside the window: near the right edge of a 296px panel the tooltip
  // would otherwise open off-screen exactly where the densest lines are.
  const moveTip = (pt) => {
    const el = $('#hunt-tip');
    if (!el || el.hidden) return;
    const pad = 16;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = pt.x + pad;
    let y = pt.y + pad;
    if (x + w > window.innerWidth - 8) x = pt.x - w - pad;
    if (y + h > window.innerHeight - 8) y = pt.y - h - pad;
    el.style.left = `${Math.max(8, x)}px`;
    el.style.top = `${Math.max(8, y)}px`;
  };

  const hideTip = () => {
    const el = $('#hunt-tip');
    if (el) el.hidden = true;
    if (MapView.ready && MapView.impl) MapView.setLineHighlight(null);
  };

  // ---- districts and sub-districts, which behave identically

  const DISTRICT_FILL = '#00c2e0';
  const DISTRICT_LIT = '#f59e0b';

  /** null on the Routes screen, otherwise which layer of boundaries is on. */
  const shapeMode = () => (S.hunterMode === 'routes' ? null : S.hunterMode);
  const shapesNow = () => (shapeMode() ? SHAPE_LAYERS[shapeMode()].shapes : null);
  /** Whichever shape is being pointed at, or the one clicked and kept. */
  const liveDistrict = () => hoverDistrict ?? S.hunterDistrict;
  let hoverDistrict = null;

  const paintDistricts = () => {
    const shapes = shapesNow();
    if (!MapView.ready || !MapView.impl || !shapes) return;
    const byDist = shapeRoutes(shapeMode(), routes);
    MapView.shapes(shapes.map((d) => {
      const on = liveDistrict() === d.name;
      return {
        key: d.name,
        rings: d.rings,
        stroke: on ? DISTRICT_LIT : DISTRICT_FILL,
        weight: on ? 3 : 1.2,
        strokeOpacity: on ? 1 : 0.55,
        fill: on ? DISTRICT_LIT : DISTRICT_FILL,
        // Barely there until pointed at. Eleven filled shapes at any real
        // opacity would bury the routes they exist to explain.
        fillOpacity: on ? 0.22 : (byDist.get(d.name)?.size ? 0.05 : 0.02),
      };
    }), {
      onEnter: (name, pt) => { hoverDistrict = name; showDistrictTip(name, pt); paintDistrictState(); },
      onMove: moveTip,
      onLeave: () => { hoverDistrict = null; hideTip(); paintDistrictState(); },
      onClick: (name) => {
        // Clicking keeps it, so you can move the mouse away and still read the
        // list. Clicking the same one again lets it go.
        S.hunterDistrict = S.hunterDistrict === name ? null : name;
        paintAll();
      },
    });
  };

  /**
   * Restyle only — no rebuild. Repainting eleven polygons on every mouse-over
   * would tear the map apart under the cursor.
   */
  const paintDistrictState = () => {
    const name = liveDistrict();
    if (MapView.ready && MapView.impl) {
      MapView.setShapeHighlight(name, {
        color: DISTRICT_LIT, weight: 3, opacity: 1, fillColor: DISTRICT_LIT, fillOpacity: 0.22,
      });
      // The lines crossing it are the answer, so they light up with it.
      paintMap();
    }
    paintDistList();
    paintResult();
  };

  const showDistrictTip = (name, pt) => {
    const el = $('#hunt-tip');
    if (!el) return;
    const shape = (shapesNow() ?? []).find((d) => d.name === name);
    const ids = shapeRoutes(shapeMode(), routes).get(name) ?? new Set();
    const autos = routes.filter((r) => ids.has(r.contact.id)).reduce((n, r) => n + r.autos, 0);
    el.innerHTML = `
      <div class="hunt-tip-name" style="border-color:${DISTRICT_LIT}">${esc(name)}</div>
      ${shape?.parent ? `<div class="hunt-tip-sub">in ${esc(shape.parent)} district</div>` : ''}
      <div class="hunt-tip-sub">${autos} auto${autos === 1 ? '' : 's'} from ${ids.size} driver${ids.size === 1 ? '' : 's'} cross${ids.size === 1 ? 'es' : ''} it</div>
      ${ids.size ? '' : '<div class="hunt-tip-sub">Nobody you have recorded goes through here.</div>'}`;
    el.hidden = false;
    moveTip(pt);
  };

  const paintDistList = () => {
    const box = $('#hunt-dist-list');
    const shapes = shapesNow();
    if (!box || !shapes) return;
    const byDist = shapeRoutes(shapeMode(), routes);
    const live = liveDistrict();
    box.innerHTML = shapes
      .map((d) => ({ d, ids: byDist.get(d.name) ?? new Set() }))
      .map(({ d, ids }) => ({
        d, ids, autos: routes.filter((r) => ids.has(r.contact.id)).reduce((n, r) => n + r.autos, 0),
      }))
      .sort((a, b) => b.autos - a.autos || a.d.name.localeCompare(b.d.name))
      .map(({ d, autos }) => `
        <button class="hunt-area ${live === d.name ? 'on' : ''}" data-dist="${esc(d.name)}"
          ${d.parent ? `title="in ${esc(d.parent)} district"` : ''}>
          <span class="hunt-area-name">${esc(d.name)}</span>
          <span class="hunt-area-n ${autos ? '' : 'zero'}">${autos || '—'}</span>
        </button>`).join('');
    $$('#hunt-dist-list [data-dist]').forEach((b) => (b.onclick = () => {
      S.hunterDistrict = S.hunterDistrict === b.dataset.dist ? null : b.dataset.dist;
      paintAll();
    }));
  };

  // ---- side panel painting

  const paintPicked = () => {
    $('#hunt-picked').innerHTML = sel.size
      ? [...sel].map((id) => `<span class="hunt-chip">${esc(areaName(id))}<button data-unpick="${id}" aria-label="Remove">×</button></span>`).join('')
        + `<button class="btn btn-sm" id="hunt-clear" style="margin-top:8px">Clear all</button>`
      : '<span class="dim" style="font-size:12px">Nothing picked yet — search above, or click an area on the map.</span>';
    $$('#hunt-picked [data-unpick]').forEach((b) => (b.onclick = () => toggle(b.dataset.unpick)));
    const c = $('#hunt-clear');
    if (c) c.onclick = () => { sel.clear(); paintAll(); };
  };

  const paintAreaList = () => {
    const q = ($('#hunt-q')?.value ?? '').trim().toLowerCase();
    const list = S.data.areaStats
      .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.zone ?? '').toLowerCase().includes(q))
      .map((a) => ({ a, autos: autosByArea.get(a.id) ?? 0 }))
      .sort((x, y) => y.autos - x.autos || x.a.name.localeCompare(y.a.name))
      .slice(0, q ? 40 : 12);

    $('#hunt-areas').innerHTML = list.length
      ? list.map(({ a, autos }) => `
          <button class="hunt-area ${sel.has(a.id) ? 'on' : ''}" data-pick="${a.id}">
            <span class="hunt-area-name">${esc(a.name)}</span>
            <span class="hunt-area-n ${autos ? '' : 'zero'}">${autos || '—'}</span>
          </button>`).join('')
        + (!q ? '<div class="dim" style="font-size:11.5px;margin-top:6px">Top 12 by autos. Search to find any of the 68.</div>' : '')
      : '<div class="dim" style="font-size:12px">No area matches that.</div>';

    $$('#hunt-areas [data-pick]').forEach((b) => (b.onclick = () => toggle(b.dataset.pick)));
  };

  // ---- finding one auto: the reverse of the area question

  const paintFocused = () => {
    $('#hunt-focused').innerHTML = focus.size
      ? [...focus].map((id) => {
        const r = routeOf.get(id);
        return `<span class="hunt-chip focus" style="border-color:${hunterColor(id)}">
          <span class="hunt-chip-dot" style="background:${hunterColor(id)}"></span>${esc(r.contact.name)}
          <button data-unfocus="${id}" aria-label="Remove">×</button></span>`;
      }).join('')
        + '<button class="btn btn-sm" id="hunt-unfocus-all" style="margin-top:8px">Show everything again</button>'
      : '';
    $$('#hunt-focused [data-unfocus]').forEach((b) => (b.onclick = () => toggleFocus(b.dataset.unfocus)));
    const c = $('#hunt-unfocus-all');
    if (c) c.onclick = () => { focus.clear(); paintAll(); };
  };

  const paintFound = () => {
    const q = ($('#hunt-dq')?.value ?? '').trim().toLowerCase();
    const box = $('#hunt-found');
    if (!q) { box.innerHTML = ''; return; }

    const digits = q.replace(/\D/g, '');
    // Searched across every active driver, not just the mapped ones. Being told
    // "he is here, but nobody has asked him where he works" is a useful answer;
    // silence looks like the driver does not exist.
    const found = S.data.contacts
      .filter((c) => !c.status || c.status === 'active')
      .filter((c) => {
        if (c.name?.toLowerCase().includes(q)) return true;
        if (digits && (c.phones ?? [c.phone]).some((p) => String(p ?? '').includes(digits))) return true;
        return (c.vehicles ?? []).some((v) => String(v.number ?? '').toLowerCase().includes(q));
      })
      .slice(0, 25);

    box.innerHTML = found.length
      ? found.map((c) => {
        const r = routeOf.get(c.id);
        const autos = Math.max(1, c.fleetSize ?? 1);
        return `<button class="hunt-found ${focus.has(c.id) ? 'on' : ''} ${r ? '' : 'unmapped'}"
            data-focus="${c.id}" ${r ? `style="--auto:${hunterColor(c.id)}"` : ''}>
            <span class="hunt-found-main">
              <span class="hunt-found-name">${esc(c.name)}</span>
              <span class="hunt-found-sub">${autos} auto${autos === 1 ? '' : 's'}${
                c.phone ? ` · ${esc(c.phone)}` : ''}</span>
            </span>
            <span class="hunt-found-n">${r ? `${r.areaIds.size} areas` : 'not mapped'}</span>
          </button>`;
      }).join('')
      : '<div class="dim" style="font-size:12px">Nobody matches that name, number or plate.</div>';

    $$('#hunt-found [data-focus]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.focus;
      // Nothing to spotlight for a driver with no areas recorded — so send the
      // user where they can fix that instead of doing nothing at all.
      if (!routeOf.has(id)) {
        toast('No areas recorded for him yet — fill in "Where he works"', 'bad');
        return openContact(id);
      }
      toggleFocus(id);
    }));
  };

  function toggleFocus(id) {
    const adding = !focus.has(id);
    if (adding) focus.add(id);
    else focus.delete(id);
    paintAll();
    // Go to him. An auto you searched for by name is one you cannot yet see, so
    // leaving the map where it was would be answering the question off-screen.
    if (adding && MapView.ready && MapView.impl) {
      const pts = [...focus].flatMap((x) => routeOf.get(x)?.nodes ?? []);
      MapView.fitTo(pts);
    }
  }

  const paintResult = () => {
    const box = $('#hunt-result');
    const district = shapeMode() ? liveDistrict() : null;
    const asked = shapeMode() ? !!district : sel.size > 0;
    if (!asked) { box.innerHTML = ''; return; }

    const hits = matching();
    if (!hits.length) {
      box.innerHTML = `<div class="note warn">
        <strong>No auto ${district ? `crosses ${esc(district)}` : `covers ${sel.size === 1 ? 'that area' : 'any of those areas'}`} yet.</strong>
        ${askedCount < activeCount
          ? `Only ${askedCount} of ${activeCount} drivers have been asked where they work, so this is a gap in what you have recorded as much as a gap on the road.`
          : 'Every driver has been asked, so this is a real gap — nobody you have works there.'}
      </div>`;
      return;
    }

    const autos = hits.reduce((n, x) => n + x.r.autos, 0);
    const all = hits.filter((x) => x.hits === sel.size).length;

    box.innerHTML = `
      <div class="card-title" style="margin-bottom:6px">
        ${autos} auto${autos === 1 ? '' : 's'} · ${hits.length} driver${hits.length === 1 ? '' : 's'}${
          district ? ` through ${esc(district)}` : ''}
      </div>
      ${district
        ? '<div class="field-hint" style="margin-bottom:8px">Their patch either sits in this district or crosses it. Biggest fleets first.</div>'
        : sel.size > 1
          ? `<div class="field-hint" style="margin-bottom:8px">${all} cover${all === 1 ? 's' : ''} all ${sel.size} areas. Sorted by how many they cover.</div>`
          : ''}
      <div class="hunt-drivers">
        ${hits.map(({ r, hits: n }) => `
          <div class="hunt-driver ${focus.has(r.contact.id) ? 'on' : ''}"
               data-focus-c="${r.contact.id}" title="Click to show only this auto on the map">
            <div class="hunt-driver-top">
              <button class="hunt-driver-name" data-open-c="${r.contact.id}">${esc(r.contact.name)}</button>
              <span class="hunt-driver-n">${r.autos} auto${r.autos === 1 ? '' : 's'}</span>
            </div>
            <div class="hunt-driver-sub">
              ${r.contact.phone ? `<a class="tel" href="tel:${esc(r.contact.phone)}">${esc(r.contact.phone)}</a> · ` : ''}
              ${!district && sel.size > 1 ? `covers ${n} of ${sel.size} · ` : ''}works ${r.areaIds.size} area${r.areaIds.size === 1 ? '' : 's'}
            </div>
            <div class="hunt-driver-areas">${r.nodes
              .map((a) => `<span class="${sel.has(a.id) ? 'hit' : ''}">${esc(a.name)}</span>`)
              .join('')}</div>
          </div>`).join('')}
      </div>`;

    // The card spotlights him on the map; his name opens his record. Two
    // different intentions, so the name stops the click going any further.
    $$('#hunt-result [data-focus-c]').forEach((el) => (el.onclick = () => toggleFocus(el.dataset.focusC)));
    $$('#hunt-result [data-open-c]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      openContact(b.dataset.openC);
    }));
  };

  const paintMode = () => {
    const kind = shapeMode();
    const layer = kind ? SHAPE_LAYERS[kind] : null;
    $$('#hunt-mode button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.hunterMode));
    $('#hunt-areas-wrap').hidden = !!kind;
    $('#hunt-districts-wrap').hidden = !kind;
    if (layer) {
      $('#hunt-dist-title').textContent = `Which ${layer.one} does the client want?`;
      $('#hunt-legend-foot').textContent =
        `A ${layer.one} lights up as you point at it, and so does every auto whose patch crosses it.`;
    } else {
      $('#hunt-legend-foot').textContent = 'Thicker line = more autos. Numbers on the dots are autos.';
    }
  };

  const paintAll = () => {
    paintMode();
    paintPicked();
    paintAreaList();
    paintFocused();
    paintFound();
    if (shapeMode()) paintDistList();
    paintResult();
    paintMap();
    if (MapView.ready && MapView.impl) {
      if (shapeMode()) paintDistricts();
      else MapView.clearShapes();
    }
    wireCommon();
  };

  /**
   * The boundaries are 40-60KB each and only these modes need them, so a layer
   * is fetched the first time it is asked for rather than on every visit to the
   * screen. Switching between the two levels clears the kept selection: a
   * sub-district name is not a district name, so it could not survive anyway.
   */
  const enterShapes = async (kind) => {
    if (S.hunterMode !== kind) S.hunterDistrict = null;
    S.hunterMode = kind;
    hoverDistrict = null;
    paintMode();
    if (!SHAPE_LAYERS[kind].shapes) {
      $('#hunt-dist-list').innerHTML =
        `<div class="dim" style="font-size:12px">Loading ${SHAPE_LAYERS[kind].one} boundaries…</div>`;
      try {
        await loadShapes(kind);
      } catch (err) {
        $('#hunt-dist-list').innerHTML = `<div class="note warn">${esc(err.message)}</div>`;
        return;
      }
    }
    paintAll();
  };

  function toggle(id) {
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    paintAll();
  }

  $('#hunt-q').oninput = paintAreaList;
  $('#hunt-dq').oninput = paintFound;
  $$('#hunt-mode button').forEach((b) => (b.onclick = () => {
    if (b.dataset.mode !== 'routes') return enterShapes(b.dataset.mode);
    S.hunterMode = 'routes';
    hoverDistrict = null;
    hideTip();
    paintAll();
  }));
  paintMode();
  paintPicked();
  paintAreaList();
  paintFocused();
  paintFound();
  paintResult();
  wireCommon();

  // ---- mount

  (async () => {
    try {
      const kind = await MapView.mount($('#map'));
      // Both layers, so a Google key rejected mid-session rebuilds whichever
      // mode was on screen rather than dropping back to bare routes.
      MapView.repaint = async () => {
        paintMap();
        if (shapeMode()) { await loadShapes(shapeMode()); paintDistricts(); }
      };
      paintMap();
      // Coming back to the screen with a boundary layer still selected has to
      // redraw it — the map was rebuilt from scratch just now.
      if (shapeMode()) await enterShapes(S.hunterMode);
      MapView.fit();
      $('#hunt-banner').innerHTML = askedCount
        ? `${routes.reduce((n, r) => n + r.autos, 0)} autos mapped across ${autosByArea.size} areas · <span class="dim">click an area to see who covers it</span>`
        : 'Nothing to draw yet — no driver has been asked where he works.';
      $('#hunt-note').innerHTML = kind === 'google'
        ? 'Google Maps — real Delhi roads and labels.'
        : 'Free OpenStreetMap. Add a Google Maps key in <strong>Settings</strong> for Google\'s own map.';
    } catch (err) {
      $('#hunt-banner').textContent = err.message;
      $('#hunt-note').innerHTML = `<strong>Map could not load.</strong> ${esc(err.message)}`;
    }
  })();
}

// ---------------------------------------------------------------- areas

const DEMAND_CAT = {
  metro: 'Metro', rail: 'Railway', isbt: 'Bus terminal', market: 'Market',
  office: 'Offices', hospital: 'Hospital', university: 'College', residential: 'Housing', airport: 'Airport',
};

function viewAreas() {
  const zones = [...new Set(S.data.areaStats.map((a) => a.zone))];
  const s = S.data.summary;
  const cols = [
    { k: 'name', t: 'Area' },
    { k: 'zone', t: 'Zone' },
    { k: 'demandSort', t: 'Demand' },
    { k: 'autos', t: 'Autos', num: true },
    { k: 'contacts', t: 'Contacts', num: true },
    { k: 'lastVisit', t: 'Last visit' },
    { k: 'signedTotal', t: 'Signed', num: true },
    { k: 'priority', t: 'Priority', num: true },
  ];

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Areas</div>
        <div class="page-sub">${s.areas} areas · ${s.untapped} with no drivers yet · ${s.onVisitList} on Rama sir's visit list · ${s.demandAreas} researched for auto demand</div>
      </div>
      <div class="page-actions"><button class="btn" id="a-why">Why these areas?</button></div>
    </div>

    ${s.demandGaps ? `<div class="note warn" style="margin-bottom:14px">
      <strong>${s.demandGaps} areas with researched auto demand have none of your autos</strong> —
      ${s.demandGapsUnserved} of them have little or no bus service at all. Filter to <strong>Missing</strong> below to see them.
    </div>` : ''}

    <div class="search-bar">
      <select id="a-zone"><option value="">All zones</option>${zones.map((z) => `<option ${S.filter.areaZone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
      <select id="a-demand">
        <option value="">All areas</option>
        <option value="missing" ${S.filter.areaDemand === 'missing' ? 'selected' : ''}>Missing — demand, no autos</option>
        <option value="gap" ${S.filter.areaDemand === 'gap' ? 'selected' : ''}>Unserved by buses</option>
        <option value="proven" ${S.filter.areaDemand === 'proven' ? 'selected' : ''}>Proven demand hubs</option>
        <option value="mine" ${S.filter.areaDemand === 'mine' ? 'selected' : ''}>Where I already am</option>
      </select>
      <div class="sp"></div>
      <span class="dim" id="a-count"></span>
      <button class="btn btn-sm" id="a-add-top">Add top 5 to a plan</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}" data-sort="${c.k}">${c.t}${S.sort.areas.key === c.k ? `<span class="sort-arrow">${S.sort.areas.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('')}<th class="no-sort"></th></tr></thead>
      <tbody id="a-body"></tbody>
    </table></div>`;

  const paint = () => {
    const { key, dir } = S.sort.areas;
    const rows = S.data.areaStats
      .map((a) => ({ ...a, demandSort: a.demand ? (a.demand.kind === 'gap' ? 2 : 1) : 0 }))
      .filter((a) => !S.filter.areaZone || a.zone === S.filter.areaZone)
      .filter((a) => {
        switch (S.filter.areaDemand) {
          case 'missing': return a.demand && a.autos === 0;
          case 'gap': return a.demand?.kind === 'gap';
          case 'proven': return a.demand?.kind === 'proven';
          case 'mine': return a.autos > 0;
          default: return true;
        }
      })
      .sort((x, y) => {
        const a = x[key] ?? (typeof y[key] === 'number' ? -1 : '');
        const b = y[key] ?? (typeof x[key] === 'number' ? -1 : '');
        return (typeof a === 'number' ? a - b : String(a).localeCompare(String(b))) * dir;
      });

    $('#a-count').textContent = `${rows.length} shown`;
    $('#a-body').innerHTML = rows.length ? rows.map((a) => `
      <tr class="clickable" data-area="${a.id}">
        <td class="strong"><span class="zone-dot" style="background:${ZONE_COLOR[a.zone] ?? '#5b6b7d'}"></span>${esc(a.name)}
          ${a.onVisitList ? '<span class="chip chip-teal">list</span>' : ''}
          ${a.demand && a.autos === 0 ? '<span class="chip chip-red">missing</span>' : ''}</td>
        <td class="muted">${esc(a.zone)}</td>
        <td>${a.demand
            ? `<span class="chip ${a.demand.kind === 'gap' ? 'chip-violet' : 'chip-amber'}">${a.demand.kind === 'gap' ? 'no buses' : 'proven'}</span>
               <span class="dim" style="font-size:11px">${esc(DEMAND_CAT[a.demand.category] ?? a.demand.category)}</span>`
            : '<span class="dim">—</span>'}</td>
        <td class="num ${a.autos ? '' : 'dim'}">${a.autos || '—'}</td>
        <td class="num ${a.contacts ? '' : 'dim'}">${a.contacts || '—'}</td>
        <td class="${a.lastVisit ? 'mono' : 'dim'}">${a.lastVisit ? `${a.lastVisit} <span class="dim">(${a.daysSince}d)</span>` : 'never'}</td>
        <td class="num ${a.signedTotal ? '' : 'dim'}" style="${a.signedTotal ? 'color:var(--green)' : ''}">${a.signedTotal || '—'}</td>
        <td class="num"><div class="pri"><div class="pri-bar"><div class="pri-fill" style="width:${a.priority}%;background:${a.priority >= 70 ? '#ef4444' : a.priority >= 50 ? '#f59e0b' : '#00c2e0'}"></div></div><div class="pri-num">${a.priority}</div></div></td>
        <td><button class="btn btn-sm" data-add-area="${a.id}">+ plan</button></td>
      </tr>`).join('') : '<tr><td colspan="9"><div class="empty">No areas match.</div></td></tr>';

    $$('[data-area]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('button')) openArea(tr.dataset.area); }));
    $$('[data-add-area]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); S.pick.add(b.dataset.addArea); toast(`${areaName(b.dataset.addArea)} added to the plan`, 'good'); }));
  };

  $$('[data-sort]').forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    S.sort.areas = { key: k, dir: S.sort.areas.key === k ? -S.sort.areas.dir : (['autos', 'contacts', 'signedTotal', 'priority', 'demandSort'].includes(k) ? -1 : 1) };
    viewAreas();
  }));
  $('#a-zone').onchange = (e) => { S.filter.areaZone = e.target.value; paint(); };
  $('#a-demand').onchange = (e) => { S.filter.areaDemand = e.target.value; paint(); };
  $('#a-why').onclick = showDemandFacts;
  $('#a-add-top').onclick = () => {
    S.data.areaStats.slice().sort((a, b) => b.priority - a.priority).slice(0, 5).forEach((a) => S.pick.add(a.id));
    toast('Top 5 priority areas added', 'good');
    go('plan');
  };
  paint();
}

/** The evidence behind the demand ratings — sourced, so it can be argued with. */
function showDemandFacts() {
  const s = S.data.summary;
  openDrawer(`
    <div class="drawer-head">
      <div>
        <div class="drawer-title">Where Delhi needs autos</div>
        <div class="drawer-sub">Researched from public data · ${s.demandAreas} areas rated</div>
      </div>
      <button class="drawer-x">×</button>
    </div>

    <div class="note" style="margin-bottom:16px">
      Your visit list is 22 areas <strong>you</strong> knew about. This is the other half:
      where the <strong>city</strong> generates auto demand, whether or not it was on your list.
      Every rating below carries its source.
    </div>

    ${(S.data.demandFacts ?? []).map((f) => `
      <div class="drawer-section">
        <div style="font-weight:600;font-size:13.5px;margin-bottom:5px">${esc(f.fact)}</div>
        <div class="field-hint" style="margin:0 0 5px">${esc(f.detail)}</div>
        <div class="dim" style="font-size:11px">${esc(f.source)}</div>
      </div>`).join('')}

    <div class="drawer-section">
      <div class="drawer-section-title">What the two ratings mean</div>
      <div style="margin-bottom:9px">
        <span class="chip chip-violet">no buses</span>
        <div class="field-hint" style="margin-top:4px">Demand exists but nothing serves it. A 12-metre bus physically cannot enter these
        streets, so the hole is auto-shaped. Fewer autos compete for the fare — the strongest opening.</div>
      </div>
      <div>
        <span class="chip chip-amber">proven</span>
        <div class="field-hint" style="margin-top:4px">Demand is already visible: a police prepaid auto booth, a notified stand, measured
        footfall. It works — but other autos are already there competing.</div>
      </div>
    </div>

    <div class="note warn">
      <strong>Three things the research overturned:</strong><br>
      · <strong>Rohini is not underserved</strong> — it is a DMRC e-auto priority area, comparatively well covered.<br>
      · <strong>The airport is a dead end for autos</strong> — the prepaid booths at IGI T1 and T3 are taxi-only. Aerocity is the auto play.<br>
      · <strong>Dwarka may be oversupplied</strong> — a 2025 study found surplus e-rickshaws and ~2 minute waits.
    </div>`);
}

// ---------------------------------------------------------------- drivers

function viewDrivers() {
  const zones = [...new Set(S.data.areaStats.map((a) => a.zone))];

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Drivers</div>
        <div class="page-sub">${S.data.summary.contacts} contacts holding ${S.data.summary.autos} autos · ${S.data.summary.fleetOwners} own more than one</div>
      </div>
      <div class="page-actions"><button class="btn btn-primary" id="d-new">+ Add driver</button></div>
    </div>
    <div class="search-bar">
      <input type="search" id="d-q" placeholder="Name, phone, or vehicle number…" value="${esc(S.filter.drivers)}">
      <select id="d-zone"><option value="">All zones</option>${zones.map((z) => `<option ${S.filter.driverZone === z ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select>
      <select id="d-kind">
        <option value="">Everyone</option>
        <option value="fleet" ${S.filter.driverKind === 'fleet' ? 'selected' : ''}>Fleet owners only</option>
        <option value="captain" ${S.filter.driverKind === 'captain' ? 'selected' : ''}>Captains only</option>
        <option value="group" ${S.filter.driverKind === 'group' ? 'selected' : ''}>Shared numbers</option>
      </select>
      <select id="d-model">
        <option value="">Any model</option>
        ${S.data.modelStats.map((m) => `<option value="${esc(m.model)}" ${S.filter.driverModel === m.model ? 'selected' : ''}>Model ${esc(m.model)} (${m.count})</option>`).join('')}
      </select>
      <div class="sp"></div>
      <span class="dim" id="d-count"></span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th data-sort="name">Name</th>
        <th data-sort="phone">Phone</th>
        <th data-sort="areaId">Area</th>
        <th class="num" data-sort="fleetSize">Autos${S.sort.drivers.key === 'fleetSize' ? `<span class="sort-arrow">${S.sort.drivers.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>
        <th class="no-sort">Vehicles</th>
        <th class="no-sort">Model</th>
        <th data-sort="reference">Source</th>
        <th class="no-sort"></th>
      </tr></thead>
      <tbody id="d-body"></tbody>
    </table></div>`;

  const paint = () => {
    const q = S.filter.drivers.trim().toLowerCase();
    const { key, dir } = S.sort.drivers;

    const rows = S.data.contacts
      .filter((c) => {
        if (S.filter.driverZone && area(c.areaId)?.zone !== S.filter.driverZone) return false;
        if (S.filter.driverKind === 'fleet' && (c.fleetSize ?? 0) <= 1) return false;
        if (S.filter.driverKind === 'captain' && !c.isCaptain) return false;
        if (S.filter.driverKind === 'group' && c.fleetType !== 'group') return false;
        if (S.filter.driverModel && !c.vehicles.some((v) => plateModel(v.number) === S.filter.driverModel)) return false;
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.altNames ?? []).some((n) => n.toLowerCase().includes(q)) ||
          c.phones.some((p) => p.includes(q)) ||
          c.vehicles.some((v) => v.number.toLowerCase().includes(q)) ||
          (areaName(c.areaId) ?? '').toLowerCase().includes(q)
        );
      })
      .sort((x, y) => {
        const get = (c) => (key === 'areaId' ? areaName(c.areaId) : c[key]);
        const a = get(x) ?? '';
        const b = get(y) ?? '';
        return (typeof a === 'number' ? a - b : String(a).localeCompare(String(b))) * dir;
      });

    $('#d-count').textContent = `${rows.length} shown · ${rows.reduce((n, c) => n + (c.fleetSize ?? 0), 0)} autos`;
    $('#d-body').innerHTML = rows.length ? rows.map((c) => `
      <tr class="clickable" data-contact="${c.id}">
        <td class="strong">${esc(c.name)}
          ${c.isCaptain ? '<span class="chip chip-amber">captain</span>' : ''}
          ${c.fleetType === 'group' ? '<span class="chip chip-violet">shared no.</span>' : ''}
        </td>
        <td class="mono">${c.phone ? `<a class="tel" href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '<span class="dim">—</span>'}</td>
        <td class="muted"><span class="zone-dot" style="background:${ZONE_COLOR[area(c.areaId)?.zone] ?? '#5b6b7d'}"></span>${esc(areaName(c.areaId))}</td>
        <td class="num">${(c.fleetSize ?? 0) > 1 ? `<span class="chip chip-violet">${c.fleetSize}</span>` : (c.fleetSize || '—')}</td>
        <td class="mono dim" style="max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${
          c.vehicles.filter((v) => v.number).length
            ? c.vehicles.filter((v) => v.number).map((v) => {
                const mo = plateModel(v.number);
                const hit = S.filter.driverModel && mo === S.filter.driverModel;
                return `<span${hit ? ' style="color:var(--teal-hi)"' : ''}>${esc(v.number)}</span>`;
              }).join(', ')
            : '—'}</td>
        <td>${[...new Set(c.vehicles.map((v) => plateModel(v.number)).filter(Boolean))]
              .map((mo) => `<span class="chip ${mo === S.filter.driverModel ? 'chip-teal' : 'chip-dim'}">${esc(mo)}</span>`).join(' ') || '<span class="dim">—</span>'}</td>
        <td class="muted">${esc(c.reference || '—')}</td>
        <td><button class="btn btn-sm" data-open-c="${c.id}">Open</button></td>
      </tr>`).join('') : '<tr><td colspan="8"><div class="empty">Nobody matches that search.</div></td></tr>';

    $$('[data-contact]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('button')) openContact(tr.dataset.contact); }));
    $$('[data-open-c]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openContact(b.dataset.openC); }));
  };

  $('#d-q').oninput = (e) => { S.filter.drivers = e.target.value; paint(); };
  $('#d-zone').onchange = (e) => { S.filter.driverZone = e.target.value; paint(); };
  $('#d-kind').onchange = (e) => { S.filter.driverKind = e.target.value; paint(); };
  $('#d-model').onchange = (e) => { S.filter.driverModel = e.target.value; paint(); };
  $('#d-new').onclick = newContact;
  $$('[data-sort]').forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    S.sort.drivers = { key: k, dir: S.sort.drivers.key === k ? -S.sort.drivers.dir : (k === 'fleetSize' ? -1 : 1) };
    viewDrivers();
  }));
  paint();
}

// ---------------------------------------------------------------- captains

/**
 * Captains are area leads: drivers who bring other drivers. The roster already
 * knew who they were — the spreadsheet has a Captains sheet — but not who
 * answers to whom, which is the thing worth knowing when a captain is the one
 * conversation that reaches twenty men.
 *
 * A captain is a driver, not a separate kind of record. Appointing one is a flag
 * on his own page, so he keeps his areas, his autos and his phone number.
 */
const captainsOf = () => S.data.contacts.filter((c) => c.isCaptain && (!c.status || c.status === 'active'));
const underCaptain = (id) => S.data.contacts.filter((c) => c.captainId === id);

function viewCaptains() {
  const caps = captainsOf().slice().sort((a, b) => underCaptain(b.id).length - underCaptain(a.id).length
    || a.name.localeCompare(b.name));
  const all = S.data.contacts.filter((c) => !c.status || c.status === 'active');
  const assigned = all.filter((c) => c.captainId).length;
  const loose = all.filter((c) => !c.captainId && !c.isCaptain).length;

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Captains</div>
        <div class="page-sub">${caps.length} captain${caps.length === 1 ? '' : 's'} ·
          ${assigned} driver${assigned === 1 ? '' : 's'} reporting to one ·
          ${loose} not under anybody</div>
      </div>
      <div class="page-actions"><button class="btn btn-primary" id="cap-new">+ Appoint a captain</button></div>
    </div>

    ${caps.length ? '' : `<div class="note" style="margin-bottom:14px">
      <strong>No captains yet.</strong> A captain is one of your own drivers who
      brings others in. Appoint one, then put drivers under him — one
      conversation with a captain is worth however many men answer to him.
    </div>`}

    <div class="search-bar">
      <input type="search" id="cap-q" placeholder="Captain or driver name…" value="${esc(S.filter.captainQ)}">
      <div class="sp"></div>
      <span class="dim" id="cap-count"></span>
    </div>

    <div id="cap-list"></div>`;

  const paint = () => {
    const q = S.filter.captainQ.trim().toLowerCase();
    const rows = caps
      .map((cap) => ({ cap, men: underCaptain(cap.id).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter(({ cap, men }) => !q || cap.name.toLowerCase().includes(q)
        || men.some((m) => m.name.toLowerCase().includes(q)));

    $('#cap-count').textContent = `${rows.length} shown · ${rows.reduce((n, r) => n + r.men.length, 0)} drivers under them`;
    $('#cap-list').innerHTML = rows.length ? rows.map(({ cap, men }) => `
      <div class="card cap-card">
        <div class="cap-head">
          <div>
            <button class="cap-name" data-open-c="${cap.id}">${esc(cap.name)}</button>
            <span class="chip chip-amber">captain</span>
            <div class="cap-sub">${esc(areaName(cap.areaId))}${cap.phone ? ` · <a class="tel" href="tel:${esc(cap.phone)}">${esc(cap.phone)}</a>` : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="cap-count">${men.length}</div>
            <div class="cap-sub">under him</div>
          </div>
        </div>
        <div class="cap-men">
          ${men.length ? men.map((m) => `
            <span class="cap-man">
              <button data-open-c="${m.id}">${esc(m.name)}</button>
              <span class="cap-man-n">${m.fleetSize ?? 0} auto${(m.fleetSize ?? 0) === 1 ? '' : 's'}</span>
              <button class="cap-man-x" data-release="${m.id}" title="Take him out from under ${esc(cap.name)}">×</button>
            </span>`).join('')
            : '<span class="dim" style="font-size:12.5px">Nobody under him yet.</span>'}
        </div>
        <button class="btn btn-sm" data-assign="${cap.id}" style="margin-top:10px">+ Put drivers under him</button>
      </div>`).join('')
      : '<div class="empty">Nobody matches that.</div>';

    $$('#cap-list [data-open-c]').forEach((b) => (b.onclick = () => openContact(b.dataset.openC)));
    $$('#cap-list [data-release]').forEach((b) => (b.onclick = async () => {
      await api('PUT', `/contacts/${b.dataset.release}`, { captainId: null });
      await refresh();
      viewCaptains();
      toast('Taken out');
    }));
    $$('#cap-list [data-assign]').forEach((b) => (b.onclick = () => assignToCaptain(b.dataset.assign)));
  };

  $('#cap-q').oninput = (e) => { S.filter.captainQ = e.target.value; paint(); };
  $('#cap-new').onclick = () => appointCaptain();
  paint();
}

/** Promote one of the drivers already on the roster. */
function appointCaptain() {
  const options = S.data.contacts
    .filter((c) => !c.isCaptain && (!c.status || c.status === 'active'))
    .sort((a, b) => (b.fleetSize ?? 0) - (a.fleetSize ?? 0) || a.name.localeCompare(b.name));

  if (!options.length) return toast('Every driver is already a captain', 'bad');

  openDrawer(`
    <div class="drawer-head">
      <div><div class="drawer-title">Appoint a captain</div>
        <div class="drawer-sub">One of your drivers, promoted</div></div>
      <button class="drawer-x">×</button>
    </div>
    <div class="field-hint" style="margin-bottom:12px">
      Fleet owners first — a man who already runs several autos usually already
      has other drivers listening to him.
    </div>
    <div class="field"><label class="field-label">Which driver</label>
      <select id="cap-who">
        ${options.map((c) => `<option value="${c.id}">${esc(c.name)}${(c.fleetSize ?? 0) > 1 ? ` — ${c.fleetSize} autos` : ''}${c.areaId ? ` · ${esc(areaName(c.areaId))}` : ''}</option>`).join('')}
      </select>
    </div>
    <div class="drawer-foot"><button class="btn btn-primary btn-block" id="cap-save">Make him a captain</button></div>`);

  $('#cap-save').onclick = async () => {
    const id = $('#cap-who').value;
    await api('PUT', `/contacts/${id}`, { isCaptain: true });
    await refresh();
    closeDrawer();
    toast('Captain appointed', 'good');
    viewCaptains();
  };
}

/** Tick as many drivers as you like and put them all under one captain. */
function assignToCaptain(captainId) {
  const cap = S.data.contacts.find((c) => c.id === captainId);
  if (!cap) return;
  const options = S.data.contacts
    .filter((c) => c.id !== captainId && (!c.status || c.status === 'active'))
    .sort((a, b) => a.name.localeCompare(b.name));

  openDrawer(`
    <div class="drawer-head">
      <div><div class="drawer-title">Under ${esc(cap.name)}</div>
        <div class="drawer-sub">Tick everyone who answers to him</div></div>
      <button class="drawer-x">×</button>
    </div>
    <div class="field"><input type="search" id="ca-q" placeholder="Search a driver…" autocomplete="off"></div>
    <div class="field-hint" style="margin-bottom:8px">
      A driver answers to one captain. Ticking a man who is already under
      somebody else moves him here.
    </div>
    <div class="ca-list" id="ca-list"></div>
    <div class="drawer-foot"><button class="btn btn-primary btn-block" id="ca-save">Save</button></div>`);

  const paintList = () => {
    const q = ($('#ca-q').value ?? '').trim().toLowerCase();
    $('#ca-list').innerHTML = options
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q))
      .slice(0, 200)
      .map((c) => {
        const elsewhere = c.captainId && c.captainId !== captainId
          ? S.data.contacts.find((x) => x.id === c.captainId)?.name
          : '';
        return `<label class="check ca-row">
          <input type="checkbox" data-man="${c.id}" ${c.captainId === captainId ? 'checked' : ''}>
          <span class="ca-name">${esc(c.name)}${c.isCaptain ? ' <span class="chip chip-amber">captain</span>' : ''}</span>
          <span class="ca-meta">${(c.fleetSize ?? 0)} auto${(c.fleetSize ?? 0) === 1 ? '' : 's'}${
            elsewhere ? ` · under ${esc(elsewhere)}` : ''}</span>
        </label>`;
      }).join('') || '<div class="dim" style="font-size:12px">Nobody matches that.</div>';
  };
  paintList();
  $('#ca-q').oninput = paintList;

  $('#ca-save').onclick = async () => {
    // Only the boxes actually on screen are read, so a search does not silently
    // release everybody it filtered out.
    const shown = $$('#ca-list [data-man]');
    const changes = [];
    for (const box of shown) {
      const c = S.data.contacts.find((x) => x.id === box.dataset.man);
      const now = c.captainId === captainId;
      if (box.checked && !now) changes.push([c.id, captainId]);
      if (!box.checked && now) changes.push([c.id, null]);
    }
    if (!changes.length) { closeDrawer(); return; }
    for (const [id, val] of changes) await api('PUT', `/contacts/${id}`, { captainId: val });
    await refresh();
    closeDrawer();
    toast(`${changes.length} driver${changes.length === 1 ? '' : 's'} updated`, 'good');
    viewCaptains();
  };
}

// ---------------------------------------------------------------- vehicles

/**
 * The auto side of the roster.
 *
 * Drivers and autos are different things and the app used to pretend otherwise:
 * an auto was a line inside its owner, so a man with six of them had six autos
 * you could read but not one you could edit. Worse, the owner is regularly not
 * the driver — he employs someone — and an auto on a dual shift has two drivers,
 * neither of which fits inside a single person's record.
 *
 * So this screen is about vehicles, and a driver's page now links here rather
 * than trying to hold the details itself.
 */
const SHIFT_LABEL = { day: 'Day', night: 'Night', '': '—' };

const vehicleOwner = (v) => S.data.contacts.find((c) => c.id === v.ownerId) ?? null;
const vehicleDrivers = (v) => (v.drivers ?? [])
  .map((d) => ({ ...d, contact: S.data.contacts.find((c) => c.id === d.contactId) }))
  .filter((d) => d.contact);
const vehicleIsDual = (v) => !!v.dualShift || (v.drivers ?? []).length > 1;

function viewVehicles() {
  const all = S.data.vehicles ?? [];
  const s = S.data.summary;

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Vehicles</div>
        <div class="page-sub">${all.length} autos on record ·
          ${s.vehiclesDualShift} on a dual shift ·
          ${s.vehiclesNoOwner ?? 0} not linked to an owner ·
          ${s.vehiclesNoDriver} with nobody driving them yet</div>
      </div>
      <div class="page-actions"><button class="btn btn-primary" id="v-new">+ Add an auto</button></div>
    </div>

    ${s.autos > all.length ? `<div class="note" style="margin-bottom:14px">
      Drivers have told you about <strong>${s.autos} autos</strong> between them, and
      <strong>${all.length}</strong> are written down here. The other
      ${s.autos - all.length} exist but their numbers were never collected —
      the coverage map still counts them, because he told you they are on the road.
    </div>` : ''}

    <div class="search-bar">
      <input type="search" id="v-q" placeholder="Plate, owner or driver…" value="${esc(S.filter.vehicleQ)}">
      <select id="v-model">
        <option value="">Any model</option>
        ${S.data.modelStats.map((m) => `<option value="${esc(m.model)}" ${S.filter.vehicleModel === m.model ? 'selected' : ''}>Model ${esc(m.model)} (${m.count})</option>`).join('')}
      </select>
      <select id="v-shift">
        <option value="">Any shift</option>
        <option value="dual" ${S.filter.vehicleShift === 'dual' ? 'selected' : ''}>Dual shift</option>
        <option value="single" ${S.filter.vehicleShift === 'single' ? 'selected' : ''}>One driver</option>
        <option value="none" ${S.filter.vehicleShift === 'none' ? 'selected' : ''}>No driver yet</option>
      </select>
      <select id="v-link" title="Autos still waiting to be matched to people">
        <option value="">Any link</option>
        <option value="noowner" ${S.filter.vehicleLink === 'noowner' ? 'selected' : ''}>No owner yet</option>
        <option value="nobody" ${S.filter.vehicleLink === 'nobody' ? 'selected' : ''}>Nobody at all</option>
        <option value="linked" ${S.filter.vehicleLink === 'linked' ? 'selected' : ''}>Fully linked</option>
      </select>
      <select id="v-status">
        <option value="">Any status</option>
        <option value="active" ${S.filter.vehicleStatus === 'active' ? 'selected' : ''}>On the road</option>
        <option value="idle" ${S.filter.vehicleStatus === 'idle' ? 'selected' : ''}>Idle</option>
      </select>
      <div class="sp"></div>
      <span class="dim" id="v-count"></span>
    </div>

    <div class="table-wrap"><table>
      <thead><tr>
        <th data-vsort="number">Plate</th>
        <th class="no-sort">Model</th>
        <th data-vsort="owner">Owner</th>
        <th class="no-sort">Driver</th>
        <th class="no-sort">Shift</th>
        <th class="no-sort">Finance</th>
        <th class="no-sort">Status</th>
        <th class="no-sort"></th>
      </tr></thead>
      <tbody id="v-body"></tbody>
    </table></div>`;

  const paint = () => {
    const q = S.filter.vehicleQ.trim().toLowerCase();
    const { key, dir } = S.sort.vehicles;

    const rows = all
      .filter((v) => {
        if (S.filter.vehicleModel && plateModel(v.number) !== S.filter.vehicleModel) return false;
        if (S.filter.vehicleShift === 'dual' && !vehicleIsDual(v)) return false;
        if (S.filter.vehicleShift === 'single' && (vehicleIsDual(v) || !(v.drivers ?? []).length)) return false;
        if (S.filter.vehicleShift === 'none' && (v.drivers ?? []).length) return false;
        if (S.filter.vehicleLink === 'noowner' && v.ownerId) return false;
        if (S.filter.vehicleLink === 'nobody' && (v.ownerId || (v.drivers ?? []).length)) return false;
        if (S.filter.vehicleLink === 'linked' && (!v.ownerId || !(v.drivers ?? []).length)) return false;
        if (S.filter.vehicleStatus && (v.status ?? 'active') !== S.filter.vehicleStatus) return false;
        if (!q) return true;
        return (
          (v.number ?? '').toLowerCase().includes(q)
          || (vehicleOwner(v)?.name ?? '').toLowerCase().includes(q)
          || vehicleDrivers(v).some((d) => d.contact.name.toLowerCase().includes(q))
          // The sheet's own text, for autos nobody has linked to a driver yet.
          || (v.driverName ?? '').toLowerCase().includes(q)
        );
      })
      .sort((x, y) => {
        const get = (v) => (key === 'owner' ? (vehicleOwner(v)?.name ?? '') : (v.number ?? ''));
        return String(get(x)).localeCompare(String(get(y))) * dir;
      });

    $('#v-count').textContent = `${rows.length} shown`;
    $('#v-body').innerHTML = rows.length ? rows.map((v) => {
      const owner = vehicleOwner(v);
      const drivers = vehicleDrivers(v);
      const dual = vehicleIsDual(v);
      const model = plateModel(v.number);
      return `
      <tr class="clickable" data-vehicle="${v.id}">
        <td class="strong mono">${esc(v.number || '— no plate —')}</td>
        <td>${model ? `<span class="chip chip-dim">${esc(model)}</span>` : '<span class="dim">—</span>'}</td>
        <td class="muted">${owner ? esc(owner.name) : '<span class="chip chip-amber">not linked</span>'}</td>
        <td class="muted">${
          drivers.length
            ? drivers.map((d) => esc(d.contact.name)).join(', ')
            : v.driverName
              ? `<span class="dim" title="From the spreadsheet — not linked to anyone in your list yet">${esc(v.driverName)} <span class="chip chip-amber">unlinked</span></span>`
              : '<span class="chip chip-amber">nobody yet</span>'}</td>
        <td>${dual ? '<span class="chip chip-violet">dual</span>' : drivers.length ? `<span class="chip chip-dim">${esc(SHIFT_LABEL[drivers[0].shift] ?? '—')}</span>` : '<span class="dim">—</span>'}</td>
        <td class="muted">${v.finance ? `<span class="chip chip-amber">${esc(v.finance)}</span>` : '<span class="dim">—</span>'}</td>
        <td>${(v.status ?? 'active') === 'idle' ? '<span class="chip chip-dim">idle</span>' : '<span class="chip chip-green">on the road</span>'}</td>
        <td><button class="btn btn-sm" data-open-v="${v.id}">Open</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="8"><div class="empty">No auto matches that.</div></td></tr>';

    $$('[data-vehicle]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('button')) openVehicle(tr.dataset.vehicle); }));
    $$('[data-open-v]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openVehicle(b.dataset.openV); }));
  };

  $('#v-q').oninput = (e) => { S.filter.vehicleQ = e.target.value; paint(); };
  $('#v-model').onchange = (e) => { S.filter.vehicleModel = e.target.value; paint(); };
  $('#v-shift').onchange = (e) => { S.filter.vehicleShift = e.target.value; paint(); };
  $('#v-link').onchange = (e) => { S.filter.vehicleLink = e.target.value; paint(); };
  $('#v-status').onchange = (e) => { S.filter.vehicleStatus = e.target.value; paint(); };
  $('#v-new').onclick = () => newVehicle();
  $$('[data-vsort]').forEach((th) => (th.onclick = () => {
    const k = th.dataset.vsort;
    S.sort.vehicles = { key: k, dir: S.sort.vehicles.key === k ? -S.sort.vehicles.dir : 1 };
    viewVehicles();
  }));
  paint();
}

/** The rows inside the Drivers section of an auto's drawer. */
function driverRows(drivers, contacts) {
  if (!drivers.length) {
    return '<div class="field-hint" id="vd-empty">Nobody recorded yet. Add whoever actually drives it — that may not be the owner.</div>';
  }
  return drivers.map((d, i) => `
    <div class="vd-row" data-vd="${i}">
      <select class="vd-who">
        ${contacts.map((c) => `<option value="${c.id}" ${c.id === d.contactId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      <select class="vd-shift">
        <option value="" ${d.shift === '' ? 'selected' : ''}>Shift —</option>
        <option value="day" ${d.shift === 'day' ? 'selected' : ''}>Day</option>
        <option value="night" ${d.shift === 'night' ? 'selected' : ''}>Night</option>
      </select>
      <button class="btn btn-sm btn-danger vd-x" data-vd-remove="${i}" aria-label="Remove">×</button>
    </div>`).join('');
}

function openVehicle(id) {
  const v = (S.data.vehicles ?? []).find((x) => x.id === id);
  if (!v) return;
  const contacts = S.data.contacts.slice().sort((a, b) => a.name.localeCompare(b.name));
  const areas = S.data.areaStats.slice().sort((a, b) => a.name.localeCompare(b.name));
  const model = plateModel(v.number);

  // Local working copy: drivers are added and removed before anything is saved,
  // so the drawer needs its own list rather than editing the loaded data.
  let drivers = (v.drivers ?? []).map((d) => ({ contactId: d.contactId, shift: d.shift ?? '' }));

  const clash = (S.data.vehicles ?? []).filter((x) => x.id !== v.id && x.number && x.number === v.number);

  openDrawer(`
    <div class="drawer-head">
      <div>
        <div class="drawer-title mono">${esc(v.number || '— no plate —')}
          ${model ? `<span class="chip chip-teal">Model ${esc(model)}</span>` : ''}</div>
        <div class="drawer-sub">${vehicleOwner(v) ? esc(vehicleOwner(v).name) : 'not linked to anyone yet'}${
          v.source === 'excel' ? ` · from the sheet, row ${v.excelRow ?? '?'}` : ' · added here'}</div>
      </div>
      <button class="drawer-x">×</button>
    </div>

    ${clash.length ? `<div class="note warn"><strong>This plate is on ${clash.length} other record${clash.length === 1 ? '' : 's'}.</strong>
      One of them is wrong — the same auto cannot be owned twice.</div>` : ''}

    <div class="drawer-section" style="margin-top:14px">
      <div class="drawer-section-title">The auto</div>
      <div class="field"><label class="field-label">Number plate</label>
        <input type="text" id="v-number" value="${esc(v.number)}" placeholder="DL1RW0740">
        <div class="field-hint">The model is read from the plate, so getting this right fills in the model too.</div>
      </div>
      <div class="field"><label class="field-label">Owner</label>
        <select id="v-owner">
          <option value="">— not linked yet —</option>
          ${contacts.map((c) => `<option value="${c.id}" ${c.id === v.ownerId ? 'selected' : ''}>${esc(c.name)}${(c.fleetSize ?? 0) > 1 ? ` (${c.fleetSize} autos)` : ''}</option>`).join('')}
        </select>
        <div class="field-hint">Whose auto it is — not necessarily who drives it. Blank is fine until you know.</div>
      </div>
      <div class="row">
        <div class="field"><label class="field-label">Passing date</label>
          <input type="date" id="v-passing" value="${esc(v.passingDate ?? '')}"></div>
        <div class="field"><label class="field-label">Status</label>
          <select id="v-status-f">
            <option value="active" ${(v.status ?? 'active') === 'active' ? 'selected' : ''}>On the road</option>
            <option value="idle" ${v.status === 'idle' ? 'selected' : ''}>Idle</option>
          </select></div>
      </div>
      <div class="field"><label class="field-label">Where it runs</label>
        <select id="v-area">
          <option value="">— same as the owner —</option>
          ${areas.map((a) => `<option value="${a.id}" ${a.id === v.areaId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <div class="field"><label class="field-label">RC number</label>
          <input type="text" id="v-rc" value="${esc(v.rcNumber ?? '')}" placeholder="Registration certificate"></div>
        <div class="field"><label class="field-label">Battery serial</label>
          <input type="text" id="v-battery" value="${esc(v.batterySerial ?? '')}" placeholder="On the battery itself"></div>
      </div>
      <div class="field">
        <label class="field-label">Condition</label>
        <div class="rate" id="v-rate">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rate-star" data-rate="${n}"
              title="${['', 'Poor', 'Rough', 'Fair', 'Good', 'Like new'][n]}">★</button>`).join('')}
          <button type="button" class="rate-clear" id="v-rate-clear">clear</button>
          <span class="rate-label" id="v-rate-label"></span>
        </div>
        <div class="field-hint">What shape the auto is in. Dents, scratches and anything that identifies it go in the notes below.</div>
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Who drives it</div>
      <div class="field-hint" style="margin-bottom:10px">
        The owner often is not the driver. Add each man who actually drives this
        auto — two of them, and it is running a dual shift.
      </div>
      <div id="v-drivers">${driverRows(drivers, contacts)}</div>
      <button class="btn btn-sm btn-block" id="v-add-driver" style="margin-top:8px">+ Add a driver</button>
      <label class="check" style="margin-top:12px">
        <input type="checkbox" id="v-dual" ${v.dualShift ? 'checked' : ''}>
        Runs a dual shift
      </label>
      <div class="field-hint">Tick this when you know it runs day and night but not yet who the second man is. Two drivers above already counts as dual.</div>
      ${v.driverName && !drivers.length ? `<div class="note" style="margin-top:10px">
        The sheet says <strong>${esc(v.driverName)}</strong> drives it, but that name was
        not matched to anyone in your list. Pick him above if he is there.
      </div>` : ''}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Money and parking</div>
      <div class="row">
        <div class="field"><label class="field-label">Finance</label>
          <input type="text" id="v-finance" value="${esc(v.finance ?? '')}" placeholder="finance / owned"></div>
        <div class="field"><label class="field-label">Parking</label>
          <input type="text" id="v-parking" value="${esc(v.parking ?? '')}" placeholder="On Parking"></div>
      </div>
      <div class="field"><label class="field-label">Finance details</label>
        <input type="text" id="v-findet" value="${esc(v.financeDetails ?? '')}" placeholder="Which financier, how much left"></div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Notes</div>
      <textarea id="v-notes" placeholder="Anything about this particular auto">${esc(v.notes ?? '')}</textarea>
    </div>

    <div class="drawer-foot">
      <button class="btn btn-primary" id="v-save">Save</button>
      <div class="sp"></div>
      <button class="btn btn-danger btn-sm" id="v-del">Delete</button>
    </div>`);

  // Driver rows are rebuilt whenever one is added or removed, so their current
  // values have to be read back out of the DOM first or an unsaved change to the
  // top row would vanish the moment a second driver is added.
  const readDrivers = () => $$('#v-drivers .vd-row').map((row) => ({
    contactId: row.querySelector('.vd-who').value,
    shift: row.querySelector('.vd-shift').value,
  }));

  const wireDrivers = () => {
    $$('#v-drivers [data-vd-remove]').forEach((b) => (b.onclick = () => {
      drivers = readDrivers();
      drivers.splice(Number(b.dataset.vdRemove), 1);
      $('#v-drivers').innerHTML = driverRows(drivers, contacts);
      wireDrivers();
    }));
  };
  wireDrivers();

  $('#v-add-driver').onclick = () => {
    drivers = readDrivers();
    drivers.push({ contactId: v.ownerId ?? contacts[0]?.id, shift: '' });
    $('#v-drivers').innerHTML = driverRows(drivers, contacts);
    wireDrivers();
  };

  // ---- condition, 1 to 5. Zero means nobody has judged it yet, which is a
  //      different thing from judging it poor.
  const RATE_WORDS = ['Not rated', 'Poor', 'Rough', 'Fair', 'Good', 'Like new'];
  let rating = Number(v.condition) || 0;
  const paintRate = () => {
    $$('#v-rate .rate-star').forEach((b) => b.classList.toggle('on', Number(b.dataset.rate) <= rating));
    $('#v-rate-label').textContent = RATE_WORDS[rating] ?? '';
    $('#v-rate-clear').style.display = rating ? '' : 'none';
  };
  $$('#v-rate .rate-star').forEach((b) => (b.onclick = () => {
    // Clicking the star already set clears it, so a misclick is one click back.
    rating = Number(b.dataset.rate) === rating ? 0 : Number(b.dataset.rate);
    paintRate();
  }));
  $('#v-rate-clear').onclick = () => { rating = 0; paintRate(); };
  paintRate();

  $('#v-save').onclick = async () => {
    await api('PUT', `/vehicles/${id}`, {
      number: $('#v-number').value.trim(),
      ownerId: $('#v-owner').value,
      drivers: readDrivers(),
      dualShift: $('#v-dual').checked,
      passingDate: $('#v-passing').value,
      status: $('#v-status-f').value,
      areaId: $('#v-area').value || null,
      finance: $('#v-finance').value.trim(),
      financeDetails: $('#v-findet').value.trim(),
      parking: $('#v-parking').value.trim(),
      rcNumber: $('#v-rc').value.trim(),
      batterySerial: $('#v-battery').value.trim(),
      condition: rating,
      notes: $('#v-notes').value,
    });
    await refresh();
    closeDrawer();
    toast('Auto saved', 'good');
    go(S.view);
  };

  $('#v-del').onclick = async () => {
    if (!confirm(`Delete ${v.number || 'this auto'}?\n\nIts details go with it. This cannot be undone.${
      v.source === 'excel' ? '\n\nIt came from the Excel sheet, so its row there will be skipped from now on — it will not come back on the next re-import.' : ''}`)) return;
    await api('DELETE', `/vehicles/${id}`);
    await refresh();
    closeDrawer();
    toast('Auto deleted');
    go(S.view);
  };
}

/**
 * Adding an auto asks for the plate and nothing else.
 *
 * Autos and drivers are collected separately in the field — a plate copied off a
 * windscreen at a parking stand, a driver met on the road — and which of them
 * belongs to whom is often not known until later. So owner and driver are
 * offered here and left blank by default: an empty field is honest, and a
 * pre-selected name is a guess that looks like a fact the moment it is saved.
 */
function newVehicle(ownerId = null) {
  const contacts = S.data.contacts.slice().sort((a, b) => a.name.localeCompare(b.name));
  const who = (sel) => `<option value="">— not linked yet —</option>`
    + contacts.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${(c.fleetSize ?? 0) > 1 ? ` (${c.fleetSize} autos)` : ''}</option>`).join('');

  openDrawer(`
    <div class="drawer-head">
      <div><div class="drawer-title">Add an auto</div>
        <div class="drawer-sub">The plate is all that is needed — link it to people later</div></div>
      <button class="drawer-x">×</button>
    </div>
    <div class="field"><label class="field-label">Number plate</label>
      <input type="text" id="nv-number" placeholder="DL1RW0740" autocomplete="off">
      <div class="field-hint">This is how the auto is identified everywhere else, so it is the one thing needed now.</div>
    </div>
    <div class="field"><label class="field-label">Owner</label>
      <select id="nv-owner">${who(ownerId)}</select>
      <div class="field-hint">Leave it blank if you do not know yet. It can be attached any time from the auto's page.</div>
    </div>
    <div class="field"><label class="field-label">Driver</label>
      <select id="nv-driver">${who(null)}</select>
      <div class="field-hint">Whoever actually drives it — often not the owner. A second driver, and the dual shift, go on the auto's page.</div>
    </div>
    <div class="row">
      <div class="field"><label class="field-label">Passing date</label><input type="date" id="nv-passing"></div>
      <div class="field"><label class="field-label">Finance</label><input type="text" id="nv-finance" placeholder="finance / owned"></div>
    </div>
    <div class="drawer-foot"><button class="btn btn-primary btn-block" id="nv-save">Add the auto</button></div>`);

  $('#nv-number').focus();

  $('#nv-save').onclick = async () => {
    const number = $('#nv-number').value.trim();
    if (!number) return toast('A number plate is needed — that is how an auto is identified', 'bad');
    const driverId = $('#nv-driver').value;
    let created;
    try {
      created = await api('POST', '/vehicles', {
        number,
        ownerId: $('#nv-owner').value || null,
        drivers: driverId ? [{ contactId: driverId, shift: '' }] : [],
        passingDate: $('#nv-passing').value,
        finance: $('#nv-finance').value.trim(),
      });
    } catch {
      // api() has already said what went wrong — most likely this plate is
      // already on record. Leave the form up so the number can be corrected
      // rather than throwing away everything else typed into it.
      return;
    }
    if (!created?.id) return;
    await refresh();
    closeDrawer();
    toast('Auto added', 'good');
    go(S.view);
    // Straight into the full page: adding one is usually the start of filling
    // it in, not the end.
    openVehicle(created.id);
  };
}

// ---------------------------------------------------------------- models

function viewModels() {
  const ms = S.data.modelStats;
  const s = S.data.summary;
  const max = Math.max(1, ...ms.map((m) => m.count));
  const delhi = ms.filter((m) => m.kind === 'delhi-auto');
  const other = ms.filter((m) => m.kind !== 'delhi-auto');
  const missing = s.autos - s.platesKnown;

  const row = (m) => `
    <tr class="clickable" data-model="${esc(m.model)}">
      <td class="strong"><span class="mono" style="font-size:14px;color:var(--teal-hi)">${esc(m.model)}</span>
        ${m.kind !== 'delhi-auto' ? '<span class="chip chip-dim">out of series</span>' : ''}</td>
      <td class="mono dim">${esc(m.sample)}</td>
      <td class="num strong">${m.count}</td>
      <td style="width:180px">
        <div class="pri"><div class="pri-bar"><div class="pri-fill" style="width:${(m.count / max) * 100}%;background:var(--teal)"></div></div>
        <div class="pri-num">${m.share}%</div></div>
      </td>
      <td class="num">${m.areaCount}</td>
      <td class="muted" style="max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${m.topAreas.map((a) => `${esc(a.name)} <span class="dim">${a.count}</span>`).join(', ') || '<span class="dim">—</span>'}</td>
      <td><button class="btn btn-sm" data-see="${esc(m.model)}">See autos</button></td>
    </tr>`;

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Auto models</div>
        <div class="page-sub">Read from the number plate — the letters after the <span class="mono">R</span> in <span class="mono">DL1R<b style="color:var(--teal-hi)">U</b>5904</span>. ${ms.length} models across ${s.platesKnown} plates.</div>
      </div>
    </div>

    ${missing > 0 ? `<div class="note warn" style="margin-bottom:16px">
      <strong>${missing} of your ${s.autos} autos have no number written down</strong>, so they are not in this breakdown —
      mostly fleet autos (Vishal's ten, Raj Khan's). Collect those numbers and the picture completes itself.
    </div>` : ''}

    <div class="table-wrap" style="margin-bottom:18px"><table>
      <thead><tr>
        <th class="no-sort">Model</th>
        <th class="no-sort">Example plate</th>
        <th class="num no-sort">Autos</th>
        <th class="no-sort">Share of fleet</th>
        <th class="num no-sort">Areas</th>
        <th class="no-sort">Mostly in</th>
        <th class="no-sort"></th>
      </tr></thead>
      <tbody>${delhi.map(row).join('')}</tbody>
    </table></div>

    ${other.length ? `
      <div class="card-title" style="margin-bottom:8px">Not the Delhi auto series</div>
      <div class="field-hint" style="margin-bottom:8px">These plates don't follow <span class="mono">DL1R…</span>, so they're grouped by their own series rather than forced into a model.</div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th class="no-sort">Series</th><th class="no-sort">Example plate</th><th class="num no-sort">Autos</th>
          <th class="no-sort">Share of fleet</th><th class="num no-sort">Areas</th><th class="no-sort">Mostly in</th><th class="no-sort"></th>
        </tr></thead>
        <tbody>${other.map(row).join('')}</tbody>
      </table></div>` : ''}

    <div class="note" style="margin-top:18px">
      <strong>Read this top to bottom as oldest to newest.</strong> RTO series are issued in order — single letters
      first (${esc(delhi.filter((m) => m.model.length === 1).map((m) => m.model).join(', '))}), then the two-letter ones
      (${esc(delhi.filter((m) => m.model.length === 2).map((m) => m.model).join(', '))}). So
      <span class="mono">${esc(delhi[0]?.model ?? '')}</span> is your oldest stock and
      <span class="mono">${esc(delhi[delhi.length - 1]?.model ?? '')}</span> the newest, still being issued —
      which is why it has the fewest.
    </div>`;

  $$('[data-model]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('button')) openModel(tr.dataset.model); }));
  $$('[data-see]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    S.filter.drivers = '';
    S.filter.driverModel = b.dataset.see;
    S.filter.driverZone = '';
    S.filter.driverKind = '';
    go('drivers');
  }));
}

function openModel(model) {
  const m = S.data.modelStats.find((x) => x.model === model);
  if (!m) return;

  const holders = S.data.contacts
    .map((c) => ({ c, n: c.vehicles.filter((v) => plateModel(v.number) === model).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const byArea = S.data.areaStats
    .map((a) => ({ a, n: holders.filter((h) => h.c.areaId === a.id).reduce((t, h) => t + h.n, 0) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  openDrawer(`
    <div class="drawer-head">
      <div>
        <div class="drawer-title">Model <span class="mono" style="color:var(--teal-hi)">${esc(m.model)}</span></div>
        <div class="drawer-sub">${m.count} autos · ${m.share}% of the fleet · e.g. ${esc(m.sample)}</div>
      </div>
      <button class="drawer-x">×</button>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Where these autos are (${byArea.length} areas)</div>
      ${byArea.map(({ a, n }) => `
        <div class="veh-row">
          <div><span class="zone-dot" style="background:${ZONE_COLOR[a.zone] ?? '#5b6b7d'}"></span>${esc(a.name)}
            <div class="veh-driver">${esc(a.zone)}</div></div>
          <span class="chip chip-teal">${n}</span>
        </div>`).join('')}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Who holds them (${holders.length})</div>
      ${holders.slice(0, 16).map(({ c, n }) => `
        <div class="veh-row">
          <div><a href="#" data-c="${c.id}" style="color:var(--text);text-decoration:none;font-weight:500">${esc(c.name)}</a>
            <div class="veh-driver">${esc(areaName(c.areaId))}${c.fleetSize > 1 ? ` · ${c.fleetSize} autos total` : ''}</div></div>
          <span class="chip ${n > 1 ? 'chip-violet' : 'chip-dim'}">${n}</span>
        </div>`).join('')}
      ${holders.length > 16 ? `<div class="dim" style="font-size:12px;padding-top:8px">+ ${holders.length - 16} more</div>` : ''}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">All ${m.count} plates</div>
      <div class="mono dim" style="font-size:11.5px;line-height:1.9;word-break:break-all">
        ${S.data.contacts.flatMap((c) => c.vehicles).filter((v) => plateModel(v.number) === model).map((v) => esc(v.number)).join(' · ')}
      </div>
    </div>

    <div class="drawer-foot"><button class="btn btn-primary btn-block" id="m-see">See these drivers</button></div>`);

  $('#m-see').onclick = () => {
    S.filter.drivers = '';
    S.filter.driverModel = model;
    S.filter.driverZone = '';
    S.filter.driverKind = '';
    closeDrawer();
    go('drivers');
  };
  $$('[data-c]').forEach((el) => (el.onclick = (e) => { e.preventDefault(); openContact(el.dataset.c); }));
}

// ---------------------------------------------------------------- trips

function viewTrips() {
  const trips = S.data.trips.slice().sort((a, b) => (a.date < b.date ? 1 : -1));

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Visit log</div>
        <div class="page-sub">${S.data.summary.tripsDone} done · ${S.data.summary.tripsPlanned} planned · ${S.data.summary.signedTotal} autos signed from visits</div>
      </div>
      <div class="page-actions"><button class="btn btn-primary" data-go="plan">Plan a day</button></div>
    </div>
    ${trips.length ? `<div class="table-wrap"><table>
      <thead><tr>
        <th class="no-sort">Date</th><th class="no-sort">Stops</th><th class="no-sort">Status</th>
        <th class="num no-sort">Distance</th><th class="num no-sort">Signed</th><th class="no-sort"></th>
      </tr></thead>
      <tbody>${trips.map((t) => `
        <tr class="clickable" data-trip="${t.id}">
          <td class="mono strong">${t.date}</td>
          <td class="muted" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.stops.map((s) => esc(areaName(s.areaId))).join(' → ')}</td>
          <td>${t.status === 'done' ? '<span class="chip chip-green">done</span>' : '<span class="chip chip-teal">planned</span>'}</td>
          <td class="num dim">${t.totalKm != null ? `${t.totalKm} km` : '—'}</td>
          <td class="num" style="${t.stops.some((s) => s.autosSigned) ? 'color:var(--green)' : ''}">${t.stops.reduce((n, s) => n + (s.autosSigned ?? 0), 0) || '—'}</td>
          <td><button class="btn btn-sm" data-open-trip="${t.id}">Open</button></td>
        </tr>`).join('')}</tbody>
    </table></div>` : `<div class="empty">
      <div class="empty-title">No visits logged yet</div>
      <div style="font-size:12.5px;margin-bottom:14px">Plan a day, then record what happened at each stop.</div>
      <button class="btn btn-primary" data-go="plan">Plan a day</button>
    </div>`}`;

  wireCommon();
  $$('[data-trip]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('button')) openTrip(tr.dataset.trip); }));
  $$('[data-open-trip]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openTrip(b.dataset.openTrip); }));
}

// ---------------------------------------------------------------- settings

function viewSettings() {
  const st = S.data.settings;
  const m = S.data.meta ?? {};
  const theme = currentTheme();

  $('#main').innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-sub">${S.data.storage?.kind === 'github'
          ? 'Data is kept in your private GitHub repo — every save is a version you can go back to.'
          : 'Data lives in <code class="mono">data.json</code> beside the app. A copy is saved to <code class="mono">backups/</code> once a day.'}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><div class="card-title">Appearance</div></div>
      <div class="field-label">Colour theme</div>
      <div class="theme-toggle wide">
        <button class="theme-opt ${theme === 'dark' ? 'on' : ''}" data-theme-set="dark"><span class="ico" aria-hidden="true">🌙</span> Dark</button>
        <button class="theme-opt ${theme === 'light' ? 'on' : ''}" data-theme-set="light"><span class="ico" aria-hidden="true">☀️</span> Light</button>
      </div>
      <div class="field-hint" style="margin-top:8px">Saved on this computer. It changes only how the app looks — not your data.</div>
    </div>

    <div class="grid grid-2" style="align-items:start">
      <div class="card">
        <div class="card-head"><div class="card-title">Google Maps key</div>
          ${st.mapsApiKey ? '<span class="chip chip-teal">saved</span>' : '<span class="chip chip-amber">not set</span>'}</div>
        ${st.mapsApiKey ? `<div class="field-hint" style="margin-bottom:10px">Saved is not the same as working. Open the <strong>Coverage Map</strong> — if the key is wrong, has no billing, or blocks localhost, the app falls back to the free map and tells you there.</div>` : ''}
        <div class="field">
          <label class="field-label">API key</label>
          <input type="text" id="s-key" value="${esc(st.mapsApiKey)}" placeholder="AIza…">
          <div class="field-hint">Entirely optional. The key only changes the <strong>map</strong> (Google's instead of free
          OpenStreetMap) and enables the address-lookup button below. The day's distance estimate never uses it —
          that is worked out here, offline, and cannot fail.</div>
        </div>
        <button class="btn btn-sm" id="s-check">Check my key</button>
        <div id="s-check-out" style="margin-top:10px"></div>
        <div class="note">
          <strong>Getting a key</strong> (optional — only for the Google map + address lookup)<br>
          1. <span class="mono">console.cloud.google.com</span> → new project<br>
          2. Enable billing (Google gives $200 free every month; this app uses a fraction of it)<br>
          3. APIs &amp; Services → Library → enable <code>Maps JavaScript API</code> and <code>Geocoding API</code><br>
          4. Credentials → Create credentials → API key<br>
          5. <strong>Restrict it:</strong> Application restrictions → HTTP referrers → add <code>http://localhost:4520/*</code>, then API restrictions → tick only those two.
        </div>
        <div class="note warn" style="margin-top:10px">
          The key sits in <code>data.json</code> on this PC and is sent to your browser to draw the map — that is normal for Google Maps. The <strong>referrer restriction</strong> in step 5 is what stops anyone else using it if it ever leaks. Don't skip it.
        </div>
      </div>

      <div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-head"><div class="card-title">Rama sir's base</div></div>
          <div class="field">
            <label class="field-label">What to call it</label>
            <input type="text" id="s-home-label" value="${esc(st.homeBase.label)}" placeholder="Office">
          </div>
          <div class="row">
            <div class="field"><label class="field-label">Latitude</label><input type="text" id="s-home-lat" value="${st.homeBase.lat}"></div>
            <div class="field"><label class="field-label">Longitude</label><input type="text" id="s-home-lng" value="${st.homeBase.lng}"></div>
          </div>
          <div class="field">
            <label class="field-label">Or paste the address</label>
            <input type="text" id="s-home-addr" placeholder="e.g. 12 Vikas Marg, Laxmi Nagar, Delhi">
            <div class="field-hint">Needs a Maps key. ${st.mapsApiKey ? 'Press Find to turn it into coordinates.' : 'Add a key first, or paste coordinates from Google Maps (right-click a spot → click the numbers to copy).'}</div>
          </div>
          <button class="btn btn-sm" id="s-geocode" ${st.mapsApiKey ? '' : 'disabled'}>Find address</button>
          <div class="field-hint" style="margin-top:10px">Every route starts and ends here.</div>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-title">Planning</div></div>
          <div class="row">
            <div class="field">
              <label class="field-label">Minutes per stop</label>
              <input type="number" id="s-stop-min" value="${st.minutesPerStop ?? 45}" min="5" max="240">
            </div>
            <div class="field">
              <label class="field-label">Stops per day</label>
              <input type="number" id="s-per-day" value="${st.visitsPerDay ?? 4}" min="1" max="12">
            </div>
            <div class="field">
              <label class="field-label">Auto speed km/h</label>
              <input type="number" id="s-speed" value="${st.autoSpeedKmh ?? 18}" min="5" max="60">
            </div>
          </div>
          <div class="field-hint">Used to estimate how long a day's route takes. <strong>18 km/h</strong> is a realistic
          door-to-door average for a Delhi auto in traffic — the free road router reports car free-flow speeds (~42 km/h),
          which would have you planning stops you can't reach. Raise it if Rama sir really is quicker.</div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div class="card-title">Password</div>
        <span class="chip chip-dim">shared by everyone who uses the planner</span>
      </div>
      <div class="row">
        <div class="field">
          <label class="field-label">Current password</label>
          <input type="password" id="s-pw-current" autocomplete="current-password">
        </div>
        <div class="field">
          <label class="field-label">New password</label>
          <input type="password" id="s-pw-new" autocomplete="new-password">
        </div>
        <div class="field">
          <label class="field-label">New password again</label>
          <input type="password" id="s-pw-confirm" autocomplete="new-password">
        </div>
      </div>
      <button class="btn btn-sm" id="s-pw-save">Change password</button>
      <div class="note warn" style="margin-top:12px">
        Changing it signs out <strong>every other phone and computer</strong> immediately —
        which is the point of changing it. Everyone will need the new one.
      </div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head">
        <div class="card-title">Where the data lives</div>
        <span class="chip ${(S.data.storage?.lastError) ? 'chip-red' : 'chip-green'}">${(S.data.storage?.lastError) ? 'problem' : 'saving fine'}</span>
      </div>
      <div class="kv">
        <dt>Storage</dt><dd class="mono">${esc(S.data.storage?.where ?? 'data.json')}</dd>
        <dt>Last saved</dt><dd class="mono">${S.data.storage?.lastSavedAt ? new Date(S.data.storage.lastSavedAt).toLocaleString('en-IN') : 'nothing changed yet this session'}</dd>
      </div>
      ${S.data.storage?.lastError ? `<div class="note warn" style="margin-top:10px"><strong>The last save failed:</strong> ${esc(S.data.storage.lastError)}<br>Your work is still safe in this browser and the app keeps retrying — but do not close it until this clears.</div>` : ''}
    </div>

    <div class="card" style="margin-top:14px">
      <div class="card-head"><div class="card-title">Spreadsheet</div></div>
      <div class="kv">
        <dt>Imported from</dt><dd class="mono">${esc(m.importedFrom ?? '—')}</dd>
        <dt>Last import</dt><dd class="mono">${m.importedAt ? new Date(m.importedAt).toLocaleString('en-IN') : '—'}</dd>
        <dt>Rows read</dt><dd class="mono">${m.excelDriverRows ?? '—'}</dd>
      </div>
      <div class="note" style="margin-top:12px">
        Updated the Excel? Double-click <code>Re-import Excel.bat</code>. It merges — your visit logs, notes and plans are kept. Contacts are matched on phone number.
      </div>
    </div>

    <div class="drawer-foot"><button class="btn btn-primary" id="s-save">Save settings</button></div>`;

  $('#s-save').onclick = async () => {
    await api('PUT', '/settings', {
      mapsApiKey: $('#s-key').value.trim(),
      homeBase: {
        label: $('#s-home-label').value.trim() || 'Base',
        lat: Number($('#s-home-lat').value) || 28.656,
        lng: Number($('#s-home-lng').value) || 77.2745,
      },
      minutesPerStop: Number($('#s-stop-min').value) || 45,
      visitsPerDay: Number($('#s-per-day').value) || 4,
      autoSpeedKmh: Number($('#s-speed').value) || 18,
    });
    await refresh();
    toast('Settings saved', 'good');
    viewSettings();
  };

  $('#s-pw-save').onclick = async () => {
    const current = $('#s-pw-current').value;
    const password = $('#s-pw-new').value;
    if (password !== $('#s-pw-confirm').value) return toast('The two new passwords are not the same', 'bad');
    // Not api(): a failure here is a wrong password, not a broken save, and the
    // "Saved / Error" indicator in the sidebar should not flicker red for it.
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return toast(json.error ?? 'Could not change the password', 'bad');
    toast('Password changed — everyone else has been signed out', 'good');
    viewSettings();
  };

  /**
   * Test the two Maps APIs this app can use (Maps JavaScript for the map,
   * Geocoding for address lookup) and name any that is broken.
   *
   * Worth the code: they fail INDEPENDENTLY and Google's errors point at the
   * wrong thing — a key can draw a perfect map while Geocoding is dead, and the
   * REST API answers a missing API with a message about billing.
   */
  $('#s-check').onclick = async () => {
    const key = $('#s-key').value.trim();
    const out = $('#s-check-out');
    if (!key) { out.innerHTML = '<div class="note warn">No key to check — the app is on the free map.</div>'; return; }

    out.innerHTML = '<div class="note">Checking…</div>';
    const rows = [];
    const line = (ok, name, detail) =>
      `<div style="display:flex;gap:8px;align-items:baseline;margin-bottom:4px">
         <span class="chip ${ok ? 'chip-green' : 'chip-red'}">${ok ? 'works' : 'blocked'}</span>
         <div><strong>${esc(name)}</strong>${detail ? `<div class="field-hint" style="margin-top:1px">${esc(detail)}</div>` : ''}</div>
       </div>`;

    let jsOk = false;
    try {
      await GoogleImpl.load(key);
      jsOk = !!window.google?.maps;
      rows.push(line(jsOk, 'Maps JavaScript API', jsOk ? 'The map itself will draw.' : 'Script did not load.'));
    } catch (err) {
      rows.push(line(false, 'Maps JavaScript API', err.message));
    }

    // Only Geocoding is worth testing now. Directions is deliberately not used
    // anywhere — the day's distance is arithmetic, so there is nothing to check.
    if (jsOk) {
      try {
        const g = new google.maps.Geocoder();
        const { results } = await g.geocode({ address: 'Connaught Place, New Delhi', region: 'IN' });
        rows.push(line(true, 'Geocoding API', `Address lookup works — found ${results[0].formatted_address}.`));
      } catch (err) {
        rows.push(line(false, 'Geocoding API', `${err.message ?? err} — the "Find address" button won't work. Paste coordinates instead (right-click a spot in Google Maps and click the numbers to copy).`));
      }
    }

    const blocked = rows.filter((r) => r.includes('chip-red')).length;
    out.innerHTML = `<div class="card" style="padding:12px">${rows.join('')}</div>` + (blocked ? `
      <div class="note warn" style="margin-top:10px">
        <strong>Nothing is broken.</strong> The map and the day's estimate don't need these —
        only the address-lookup button does, and you can paste coordinates instead.
        <br><br><strong>If you want to fix it, three things cause it:</strong><br>
        <strong>1. The key won't let it.</strong> <span class="mono">Credentials → your key → API restrictions</span>.
        If set to <em>Restrict key</em>, the blocked API must be ticked there. Enabling an API and
        letting your key call it are two different switches.<br>
        <strong>2. The API isn't enabled.</strong> <span class="mono">APIs &amp; Services → Library</span> →
        search it → <strong>Enable</strong>.<br>
        <strong>3. Billing.</strong> If the card on the account is failing, Google keeps already-enabled APIs
        alive while refusing new ones — so the map works and these don't. A clean map does not prove
        billing is healthy.
      </div>` : `
      <div class="note" style="margin-top:10px"><strong>All good.</strong> The map and address lookup both work.</div>`);
  };

  $('#s-geocode').onclick = async () => {
    const addr = $('#s-home-addr').value.trim();
    if (!addr) return toast('Type an address first', 'bad');
    try {
      await GoogleImpl.load(S.data.settings.mapsApiKey.trim());
      const geo = new google.maps.Geocoder();
      const { results } = await geo.geocode({ address: addr, region: 'IN' });
      if (!results.length) return toast('Could not find that address', 'bad');
      const loc = results[0].geometry.location;
      $('#s-home-lat').value = loc.lat().toFixed(6);
      $('#s-home-lng').value = loc.lng().toFixed(6);
      $('#s-home-label').value = $('#s-home-label').value || results[0].formatted_address;
      toast(`Found: ${results[0].formatted_address}`, 'good');
    } catch (err) {
      toast(err.message, 'bad');
    }
  };
}

// ================================================================ drawers

function closeDrawer() {
  $('#drawer').classList.remove('on');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('on');
}

function openDrawer(html) {
  const d = $('#drawer');
  d.innerHTML = html;
  d.classList.add('on');
  d.setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('on');
  $$('.drawer-x', d).forEach((b) => (b.onclick = closeDrawer));
}

// ---- area

function openArea(id) {
  const a = area(id);
  if (!a) return;
  const here = S.data.contacts.filter((c) => c.areaId === id).sort((x, y) => y.fleetSize - x.fleetSize);
  const visits = S.data.trips
    .filter((t) => t.stops.some((s) => s.areaId === id))
    .sort((x, y) => (x.date < y.date ? 1 : -1));

  openDrawer(`
    <div class="drawer-head">
      <div>
        <div class="drawer-title">${esc(a.name)}</div>
        <div class="drawer-sub">${esc(a.zone)}${a.onVisitList ? ' · on the visit list' : ''}</div>
      </div>
      <button class="drawer-x">×</button>
    </div>

    <div class="stat-row" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
      <div class="stat"><div class="stat-label">Autos</div><div class="stat-value teal" style="font-size:20px">${a.autos}</div></div>
      <div class="stat"><div class="stat-label">Contacts</div><div class="stat-value" style="font-size:20px">${a.contacts}</div></div>
      <div class="stat"><div class="stat-label">Priority</div><div class="stat-value amber" style="font-size:20px">${a.priority}</div></div>
    </div>

    ${a.demand ? `
      <div class="note ${a.demand.kind === 'gap' ? 'warn' : ''}" style="margin-bottom:16px">
        <div style="display:flex;gap:7px;align-items:center;margin-bottom:6px">
          <span class="chip ${a.demand.kind === 'gap' ? 'chip-violet' : 'chip-amber'}">${a.demand.kind === 'gap' ? 'no buses' : 'proven demand'}</span>
          <span class="chip chip-dim">${esc(DEMAND_CAT[a.demand.category] ?? a.demand.category)}</span>
          ${a.autos === 0 ? '<span class="chip chip-red">you have nobody here</span>' : ''}
        </div>
        <strong>${esc(a.demand.reason)}</strong>
        <div class="field-hint" style="margin-top:6px">${esc(a.demand.evidence)}</div>
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
          <span class="dim" style="font-size:11px">confidence: ${esc(a.demand.confidence)}</span>
          <a href="${esc(a.demand.source)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--teal-hi)">source ↗</a>
        </div>
        ${a.demand.researchedName !== a.name ? `<div class="field-hint" style="margin-top:6px">Researched as "<strong>${esc(a.demand.researchedName)}</strong>" — same place as your ${esc(a.name)}.</div>` : ''}
      </div>` : ''}

    <div class="drawer-section">
      <div class="drawer-section-title">Status</div>
      <dl class="kv">
        <dt>Last visit</dt><dd>${a.lastVisit ? `${a.lastVisit} (${a.daysSince} days ago)` : 'never visited'}</dd>
        <dt>Visits</dt><dd>${a.visitCount}</dd>
        <dt>Signed here</dt><dd>${a.signedTotal || 0} autos</dd>
        <dt>Fleet owners</dt><dd>${a.fleets}</dd>
        <dt>Captains</dt><dd>${a.captains}</dd>
        <dt>Coordinates</dt><dd class="mono">${a.lat.toFixed(4)}, ${a.lng.toFixed(4)} <span class="dim">(${a.coordsSource})</span></dd>
      </dl>
    </div>

    ${(() => {
      const mix = {};
      for (const c of here) for (const v of c.vehicles) {
        const mo = plateModel(v.number);
        if (mo) mix[mo] = (mix[mo] ?? 0) + 1;
      }
      const entries = Object.entries(mix).sort((x, y) => y[1] - x[1]);
      return entries.length ? `<div class="drawer-section">
        <div class="drawer-section-title">Auto models here</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${entries.map(([mo, n]) => `<span class="chip chip-teal" style="cursor:pointer" data-mo="${esc(mo)}">${esc(mo)} · ${n}</span>`).join('')}
        </div>
      </div>` : '';
    })()}

    <div class="drawer-section">
      <div class="drawer-section-title">Notes</div>
      <textarea id="area-notes" placeholder="Parking spots, best time of day, who to ask for…">${esc(a.notes)}</textarea>
    </div>

    ${here.length ? `<div class="drawer-section">
      <div class="drawer-section-title">Drivers here (${here.length})</div>
      ${here.slice(0, 14).map((c) => `
        <div class="veh-row">
          <div><a href="#" data-c="${c.id}" style="color:var(--text);text-decoration:none;font-weight:500">${esc(c.name)}</a>
            <div class="veh-driver">${esc(c.phone)}${c.isCaptain ? ' · captain' : ''}</div></div>
          <span class="chip ${c.fleetSize > 1 ? 'chip-violet' : 'chip-dim'}">${c.fleetSize} auto${c.fleetSize > 1 ? 's' : ''}</span>
        </div>`).join('')}
      ${here.length > 14 ? `<div class="dim" style="font-size:12px;padding-top:8px">+ ${here.length - 14} more — see the Drivers page</div>` : ''}
    </div>` : '<div class="drawer-section"><div class="note">No drivers here yet. This is fresh ground.</div></div>'}

    ${visits.length ? `<div class="drawer-section">
      <div class="drawer-section-title">Visit history</div>
      ${visits.map((t) => {
        const st = t.stops.find((s) => s.areaId === id);
        return `<div class="veh-row">
          <div><span class="mono">${t.date}</span>
            <div class="veh-driver">${esc(st.notes || (t.status === 'planned' ? 'planned' : 'no notes'))}</div></div>
          <span class="chip ${st.autosSigned ? 'chip-green' : 'chip-dim'}">${st.autosSigned ? `+${st.autosSigned}` : t.status}</span>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="drawer-foot">
      <button class="btn btn-primary" id="area-add">Add to plan</button>
      <button class="btn" id="area-save">Save notes</button>
    </div>`);

  $$('[data-mo]').forEach((el) => (el.onclick = () => { closeDrawer(); openModel(el.dataset.mo); }));
  $('#area-add').onclick = () => { S.pick.add(id); closeDrawer(); toast(`${a.name} added to the plan`, 'good'); go('plan'); };
  $('#area-save').onclick = async () => {
    await api('PUT', `/areas/${id}`, { notes: $('#area-notes').value });
    await refresh();
    closeDrawer();
    toast('Notes saved', 'good');
    go(S.view);
  };
  $$('[data-c]').forEach((el) => (el.onclick = (e) => { e.preventDefault(); openContact(el.dataset.c); }));
}

// ---- contact

/** Registration -> every contact holding it. Anything with 2+ is a conflict. */
function vehicleIndex() {
  const idx = new Map();
  for (const c of S.data.contacts) {
    for (const v of c.vehicles) {
      if (!v.number) continue;
      if (!idx.has(v.number)) idx.set(v.number, []);
      idx.get(v.number).push(c);
    }
  }
  return idx;
}

// ---------------------------------------------------------------- where he works

/** Has anyone actually asked this driver, or is the map still guessing? */
function workAsked(c) {
  return !!(c.startAreaId || c.bestAreaId || (c.workAreaIds ?? []).length);
}

/**
 * The area picker, shared by the contact drawer and the "add a driver" form.
 *
 * One row per area: a tick for "he drives here" and a star for "this is where he
 * earns most". The star implies the tick — you cannot earn most in a place you
 * never go — so starring an unticked area ticks it.
 */
/**
 * Zone shortcuts above the list, for when the driver waves at a region instead
 * of naming streets — "he works all over South Delhi".
 *
 * Picking a zone ticks every area in it right away rather than storing "South"
 * as its own kind of answer. Simpler to reason about, and he can immediately
 * untick the two or three that obviously do not apply.
 */
function zoneChips(areas) {
  const zones = [...new Set(areas.map((a) => a.zone).filter(Boolean))].sort();
  if (zones.length < 2) return '';
  return `<div class="zone-chips">
    <span class="zone-chips-label">Whole zone:</span>
    ${zones.map((z) => `<button type="button" class="zone-chip" data-zone-add="${esc(z)}">${esc(z)}</button>`).join('')}
    <button type="button" class="zone-chip zone-chip-clear" data-zone-clear="1">Clear all</button>
  </div>`;
}

function areaPickRows(areas, selectedIds, bestId) {
  const sel = new Set(selectedIds);
  return areas.map((a) => `
    <div class="apick ${sel.has(a.id) ? 'on' : ''}" data-apick-row="${a.id}" data-apick-name="${esc(a.name.toLowerCase())}">
      <label class="apick-hit">
        <input type="checkbox" data-apick="${a.id}" ${sel.has(a.id) ? 'checked' : ''}>
        <span class="apick-name">${esc(a.name)}</span>
        <span class="apick-zone">${esc(a.zone ?? '')}</span>
      </label>
      <button type="button" class="apick-star ${a.id === bestId ? 'on' : ''}" data-abest="${a.id}"
        title="He gets the most rides here">★</button>
    </div>`).join('');
}

/** Wire the zone shortcut buttons that sit above a picker. */
function wireZoneChips(chipRoot, pickRoot, areas) {
  $$('[data-zone-add]', chipRoot).forEach((btn) => {
    btn.onclick = () => {
      const ids = new Set(areas.filter((a) => a.zone === btn.dataset.zoneAdd).map((a) => a.id));
      let n = 0;
      $$('[data-apick]', pickRoot).forEach((cb) => {
        if (!ids.has(cb.dataset.apick) || cb.checked) return;
        cb.checked = true;
        cb.closest('.apick').classList.add('on');
        n++;
      });
      toast(n ? `${n} area${n === 1 ? '' : 's'} ticked in ${btn.dataset.zoneAdd}` : `All of ${btn.dataset.zoneAdd} was already ticked`, n ? 'good' : '');
    };
  });
  const clear = $('[data-zone-clear]', chipRoot);
  if (clear) {
    clear.onclick = () => {
      $$('[data-apick]', pickRoot).forEach((cb) => { cb.checked = false; cb.closest('.apick').classList.remove('on'); });
      $$('.apick-star', pickRoot).forEach((b) => b.classList.remove('on'));
    };
  }
}

function wireAreaPick(root) {
  $$('[data-apick]', root).forEach((cb) => {
    cb.onchange = () => {
      const row = cb.closest('.apick');
      row.classList.toggle('on', cb.checked);
      // Unticking the starred area drops the star with it, rather than leaving a
      // "best area" he was just recorded as not visiting.
      if (!cb.checked) $('.apick-star', row)?.classList.remove('on');
    };
  });
  $$('.apick-star', root).forEach((btn) => {
    btn.onclick = () => {
      const already = btn.classList.contains('on');
      $$('.apick-star', root).forEach((b) => b.classList.remove('on'));
      if (already) return;                       // clicking the star again clears it
      btn.classList.add('on');
      const row = btn.closest('.apick');
      const cb = $('[data-apick]', row);
      cb.checked = true;
      row.classList.add('on');
    };
  });
}

function readAreaPick(root) {
  return {
    workAreaIds: $$('[data-apick]', root).filter((cb) => cb.checked).map((cb) => cb.dataset.apick),
    bestAreaId: $('.apick-star.on', root)?.dataset.abest ?? null,
  };
}

/** Live filter for a long area list — 68 rows is too many to scroll blind. */
function wireAreaPickFilter(inputSel, root) {
  const input = $(inputSel);
  if (!input) return;
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    $$('.apick', root).forEach((row) => {
      row.style.display = !q || row.dataset.apickName.includes(q) ? '' : 'none';
    });
  };
}

function openContact(id) {
  const c = S.data.contacts.find((x) => x.id === id);
  if (!c) return;
  const areas = S.data.areaStats.slice().sort((a, b) => a.name.localeCompare(b.name));
  // Offer the referrers already on file. Only a handful of people refer drivers,
  // and picking from the list stops "Rama" turning into three spellings that no
  // longer group together.
  const refNames = [...new Set(S.data.contacts.map((x) => x.reference).filter(Boolean))].sort();

  const vIdx = vehicleIndex();
  const dupes = c.vehicles.filter((v) => v.number && vIdx.get(v.number).length > 1);
  const uniqueNums = new Set(c.vehicles.map((v) => v.number).filter(Boolean)).size;
  const withinSelf = c.vehicles.filter((v) => v.number).length - uniqueNums;

  const fleetNote = c.fleetType === 'group'
    ? `<div class="note warn">This one number reaches <strong>${c.altNames.length + 1} drivers</strong> — ${esc([c.name, ...c.altNames].join(', '))}. In the sheet they were ${c.excelRows.length} separate rows.</div>`
    : c.fleetSize > 1
      ? `<div class="note"><strong>${esc(c.name)} owns ${c.fleetSize} autos.</strong> One conversation here is worth ${c.fleetSize} — treat it as a fleet deal, not a single sign-up.</div>`
      : '';

  openDrawer(`
    <div class="drawer-head">
      <div>
        <div class="drawer-title">${esc(c.name)}
          ${c.isCaptain ? '<span class="chip chip-amber">captain</span>' : ''}</div>
        <div class="drawer-sub">${esc(areaName(c.areaId))} · ${c.fleetSize} auto${c.fleetSize === 1 ? '' : 's'}${c.reference ? ` · via ${esc(c.reference)}` : ''}</div>
      </div>
      <button class="drawer-x">×</button>
    </div>

    ${fleetNote}

    <div class="drawer-section" style="margin-top:14px">
      <div class="drawer-section-title">Contact</div>
      <div class="field"><label class="field-label">Name</label><input type="text" id="c-name" value="${esc(c.name)}"></div>
      <div class="row">
        <div class="field"><label class="field-label">Phone</label><input type="text" id="c-phone" value="${esc(c.phone)}"></div>
        <div class="field"><label class="field-label">Autos</label><input type="number" id="c-fleet" value="${c.fleetSize}" min="0"></div>
      </div>
      <div class="field">
        <label class="field-label">Area</label>
        <select id="c-area">
          <option value="">— not set —</option>
          ${areas.map((a) => `<option value="${a.id}" ${a.id === c.areaId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
        ${c.areaRaw ? `<div class="field-hint">Spreadsheet said "${esc(c.areaRaw)}".</div>` : ''}
      </div>
      ${c.phone ? `<a class="btn btn-block" href="tel:${esc(c.phone)}" style="margin-top:10px">Call ${esc(c.phone)}</a>` : ''}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Where he works
        ${workAsked(c) ? '<span class="chip chip-teal">asked</span>' : '<span class="chip chip-amber">not asked yet</span>'}</div>
      <div class="field-hint" style="margin-bottom:10px">
        ${workAsked(c)
          ? 'What he told us about his own day. This is what draws the coverage heatmap.'
          : 'Not asked yet — the map is currently guessing from his home area. Ask him next time you speak: where do you start, where do you drive, where do you get the most rides?'}
      </div>
      <div class="field">
        <label class="field-label">Starts his day at</label>
        <select id="c-start">
          <option value="">— not asked —</option>
          ${areas.map((a) => `<option value="${a.id}" ${a.id === (c.startAreaId ?? '') ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <label class="field-label" style="margin-top:6px">Areas he drives in — tap the ★ for where he gets the most rides</label>
      <div id="c-zones">${zoneChips(areas)}</div>
      <div class="area-pick" id="c-work">${areaPickRows(areas, c.workAreaIds ?? [], c.bestAreaId ?? null)}</div>
      <div class="field-hint" style="margin-top:6px">Two or more areas draws the roads between them as covered too, so long as they're close enough to shuttle between.</div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Papers</div>
      <div class="field-hint" style="margin-bottom:10px">
        All optional. Drivers turn up with whatever they have, and a blank here
        means "not collected", not "does not exist".
      </div>
      <div class="field"><label class="field-label">Driving licence</label>
        <input type="text" id="c-license" value="${esc(c.license ?? '')}" placeholder="DL-0420110012345"></div>
      <div class="row">
        <div class="field"><label class="field-label">Badge number</label>
          <input type="text" id="c-badge" value="${esc(c.badge ?? '')}" placeholder="PSV badge"></div>
        <div class="field"><label class="field-label">PAN</label>
          <input type="text" id="c-pan" value="${esc(c.pan ?? '')}" placeholder="ABCDE1234F"></div>
      </div>
      <div class="field"><label class="field-label">Aadhaar</label>
        <input type="text" id="c-aadhar" value="${esc(c.aadhar ?? '')}" placeholder="12 digits"></div>
      <div class="field"><label class="field-label">Address</label>
        <textarea id="c-address" rows="2" placeholder="Where he lives">${esc(c.address ?? '')}</textarea></div>

      <div class="field-label" style="margin-top:12px">Other documents</div>
      <div class="field-hint" style="margin-bottom:6px">Anything else he carries — a permit, insurance, police verification.</div>
      <div id="c-docs"></div>
      <button class="btn btn-sm btn-block" id="c-add-doc" style="margin-top:6px">+ Add a document</button>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Captain</div>
      <label class="check" style="margin-bottom:10px">
        <input type="checkbox" id="c-is-captain" ${c.isCaptain ? 'checked' : ''}>
        He is a captain — other drivers answer to him
      </label>
      ${c.isCaptain ? `<div class="field-hint" style="margin-bottom:10px">
        ${underCaptain(c.id).length} driver${underCaptain(c.id).length === 1 ? '' : 's'} under him.
        Put more under him on the <strong>Captains</strong> screen.
      </div>` : ''}
      <div class="field"><label class="field-label">He answers to</label>
        <select id="c-captain-of">
          <option value="">— nobody —</option>
          ${captainsOf().filter((x) => x.id !== c.id)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((x) => `<option value="${x.id}" ${x.id === c.captainId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
        </select>
        ${captainsOf().filter((x) => x.id !== c.id).length ? '' : '<div class="field-hint">No captains appointed yet.</div>'}
      </div>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">His autos (${c.vehicles.length})</div>
      <div class="field-hint" style="margin-bottom:10px">
        Each auto has its own page — that is where its driver, its shift and its
        papers live, because the man who owns an auto is often not the man
        driving it.
      </div>
      ${c.vehicles.length ? c.vehicles.map((v) => {
        const clash = v.number ? vIdx.get(v.number).filter((o) => o.id !== c.id) : [];
        const twiceHere = v.number && c.vehicles.filter((x) => x.number === v.number).length > 1;
        const drives = vehicleDrivers(v);
        return `<button class="veh-row veh-link" data-open-v="${v.id}">
          <div>
            <span class="veh-num">${esc(v.number || v.raw || '— no plate —')}</span>
            ${clash.length ? `<span class="chip chip-red">also under ${esc(clash.map((o) => o.name).join(', '))}</span>`
              : twiceHere ? '<span class="chip chip-amber">listed twice</span>' : ''}
            <div class="veh-driver">${
              drives.length
                ? `driven by ${esc(drives.map((d) => d.contact.name).join(', '))}`
                : v.driverName
                  ? `sheet says ${esc(v.driverName)} — not linked yet`
                  : 'no driver recorded'}</div>
          </div>
          <div style="text-align:right">
            ${vehicleIsDual(v) ? '<span class="chip chip-violet">dual shift</span>' : ''}
            ${v.finance ? `<span class="chip chip-amber">${esc(v.finance)}</span>` : ''}
            ${v.passingDate ? `<div class="veh-driver">passing ${esc(v.passingDate)}</div>` : ''}
          </div>
        </button>`;
      }).join('') : '<div class="dim" style="font-size:12.5px">No auto written down for him yet.</div>'}
      <button class="btn btn-sm btn-block" id="c-add-veh" style="margin-top:10px">+ Add an auto for him</button>
      ${withinSelf ? `<div class="field-hint" style="color:var(--amber)">${withinSelf} number${withinSelf === 1 ? ' is' : 's are'} repeated here, so this is probably <strong>${uniqueNums} auto${uniqueNums === 1 ? '' : 's'}</strong>, not ${c.fleetSize}. Correct the count above if so.</div>` : ''}
      ${dupes.some((v) => vIdx.get(v.number).some((o) => o.id !== c.id)) ? `<div class="field-hint" style="color:var(--red)">A number here is also recorded against someone else — one of the two entries is wrong.</div>` : ''}
      ${c.declaredFleet > c.vehicles.length ? `<div class="field-hint">Sheet says ${c.declaredFleet} autos but only ${c.vehicles.length} number${c.vehicles.length === 1 ? '' : 's'} written down — ${c.declaredFleet - c.vehicles.length} still to collect.</div>` : ''}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Notes</div>
      <textarea id="c-notes" placeholder="What was discussed, what he wants, when to call back…">${esc(c.notes)}</textarea>
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Record</div>
      <div class="row">
        <div class="field">
          <label class="field-label">House</label>
          <select id="c-tenure">
            <option value="own" ${c.tenure === 'rent' ? '' : 'selected'}>Own house</option>
            <option value="rent" ${c.tenure === 'rent' ? 'selected' : ''}>Rented</option>
          </select>
        </div>
        <div class="field">
          <label class="field-label">Parking</label>
          <input type="text" id="c-parking" value="${esc(c.parking ?? '')}" placeholder="On Parking, Parking Area…">
        </div>
      </div>
      <div class="field">
        <label class="field-label">Referred by</label>
        <input type="text" id="c-ref" list="ref-list" value="${esc(c.reference ?? '')}" placeholder="Rama, a captain, walk-in…">
        <datalist id="ref-list">${refNames.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">Other numbers</label>
        <input type="text" id="c-alt" value="${esc(c.phones.slice(1).join(', '))}" placeholder="Any second number that reaches him">
        <div class="field-hint">Separate with commas. The Phone box above stays his main number${c.phones.length > 1 ? ` — he is currently reachable on ${c.phones.length}` : ''}.</div>
      </div>
      <dl class="kv">
        <dt>From</dt><dd>${c.source === 'app' ? 'added here' : `Excel row${c.excelRows.length > 1 ? 's' : ''} ${c.excelRows.join(', ')}`}</dd>
      </dl>
      <div class="field-hint">Where the record came from is kept as a fact, not a setting — it is what lets a value be traced back to the sheet.</div>
    </div>

    <div class="drawer-foot">
      <button class="btn btn-primary" id="c-save">Save</button>
      <div class="sp"></div>
      <button class="btn btn-danger btn-sm" id="c-del">Delete</button>
    </div>`);

  wireAreaPick($('#c-work'));
  wireZoneChips($('#c-zones'), $('#c-work'), areas);

  // His autos are their own records, so these leave his page rather than trying
  // to edit a vehicle from inside a person.
  $$('#drawer [data-open-v]').forEach((b) => (b.onclick = () => openVehicle(b.dataset.openV)));
  $('#c-add-veh').onclick = () => newVehicle(c.id);

  // ---- other documents: a working copy, same as the vehicle's driver rows
  let docs = (c.docs ?? []).map((d) => ({ ...d }));

  const readDocs = () => $$('#c-docs .doc-row').map((row) => ({
    id: row.dataset.docId || undefined,
    name: row.querySelector('.doc-name').value.trim(),
    notes: row.querySelector('.doc-notes').value,
  }));

  const paintDocs = () => {
    $('#c-docs').innerHTML = docs.length ? docs.map((d, i) => `
      <div class="doc-row" data-doc-id="${esc(d.id ?? '')}">
        <div class="doc-top">
          <input type="text" class="doc-name" value="${esc(d.name ?? '')}" placeholder="What it is — permit, insurance…">
          <button class="btn btn-sm btn-danger doc-x" data-doc-remove="${i}" aria-label="Remove">×</button>
        </div>
        <textarea class="doc-notes" rows="2" placeholder="Number, expiry, anything worth remembering">${esc(d.notes ?? '')}</textarea>
      </div>`).join('')
      : '<div class="dim" style="font-size:12px">Nothing else recorded.</div>';

    $$('#c-docs [data-doc-remove]').forEach((b) => (b.onclick = () => {
      docs = readDocs();
      docs.splice(Number(b.dataset.docRemove), 1);
      paintDocs();
    }));
  };
  paintDocs();

  $('#c-add-doc').onclick = () => {
    docs = readDocs();
    docs.push({ name: '', notes: '' });
    paintDocs();
    // Straight into the new row's name box — it is the only field that matters.
    $$('#c-docs .doc-name').slice(-1)[0]?.focus();
  };

  $('#c-save').onclick = async () => {
    const work = readAreaPick($('#c-work'));
    await api('PUT', `/contacts/${id}`, {
      name: $('#c-name').value.trim(),
      phone: $('#c-phone').value.trim(),
      phones: $('#c-alt').value.split(',').map((p) => p.trim()).filter(Boolean),
      fleetSize: Number($('#c-fleet').value),
      areaId: $('#c-area').value || null,
      isCaptain: $('#c-is-captain').checked,
      captainId: $('#c-captain-of').value || null,
      notes: $('#c-notes').value,
      tenure: $('#c-tenure').value,
      parking: $('#c-parking').value.trim(),
      reference: $('#c-ref').value.trim(),
      startAreaId: $('#c-start').value || null,
      workAreaIds: work.workAreaIds,
      bestAreaId: work.bestAreaId,
      license: $('#c-license').value.trim(),
      badge: $('#c-badge').value.trim(),
      pan: $('#c-pan').value.trim().toUpperCase(),
      aadhar: $('#c-aadhar').value.trim(),
      address: $('#c-address').value.trim(),
      docs: readDocs(),
    });
    await refresh();
    closeDrawer();
    toast('Saved', 'good');
    go(S.view);
  };

  $('#c-del').onclick = async () => {
    // Spell out what actually goes, and say the quiet part about the sheet.
    // "Are you sure?" on its own invites a reflex Yes, and this is the one
    // action in the app that cannot be walked back.
    const autos = c.fleetSize > 0 ? `, his ${c.fleetSize} auto${c.fleetSize > 1 ? 's' : ''}` : '';
    const fromSheet = String(c.source ?? '').startsWith('excel')
      ? '\n\nHe came from the Excel sheet, so his row there will be skipped from now on — he will not come back on the next re-import.'
      : '';
    if (!confirm(`Delete ${c.name}?\n\nHis record${autos} and everything collected about where he works will be removed. This cannot be undone.${fromSheet}`)) return;

    await api('DELETE', `/contacts/${id}`);
    await refresh();
    closeDrawer();
    toast(`${c.name} deleted`);
    go(S.view);
  };
}

function newContact() {
  const areas = S.data.areaStats.slice().sort((a, b) => a.name.localeCompare(b.name));
  openDrawer(`
    <div class="drawer-head">
      <div><div class="drawer-title">Add a driver</div>
        <div class="drawer-sub">Someone new Rama sir met in the field</div></div>
      <button class="drawer-x">×</button>
    </div>
    <div class="field"><label class="field-label">Name</label><input type="text" id="n-name" placeholder="Driver's name"></div>
    <div class="row">
      <div class="field"><label class="field-label">Phone</label><input type="text" id="n-phone" placeholder="10 digits"></div>
      <div class="field"><label class="field-label">Autos</label><input type="number" id="n-fleet" value="1" min="1">
        <div class="field-hint">More than 1 if he owns a fleet.</div></div>
    </div>
    <div class="field"><label class="field-label">Area</label>
      <select id="n-area"><option value="">— pick —</option>${areas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
    <div class="field"><label class="field-label">Referred by</label><input type="text" id="n-ref" placeholder="Rama, a captain, walk-in…"></div>
    <label class="check" style="margin:10px 0"><input type="checkbox" id="n-captain"> Captain (area lead)</label>

    <div class="drawer-section">
      <div class="drawer-section-title">Where he works</div>
      <div class="field-hint" style="margin-bottom:10px">
        Ask him now, while he is standing in front of you — it is far harder to get later.
        This is what draws the coverage heatmap.
      </div>
      <div class="field">
        <label class="field-label">Starts his day at</label>
        <select id="n-start"><option value="">— same as his area —</option>${areas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
      </div>
      <label class="field-label" style="margin-top:6px">Areas he drives in — tap ★ for most rides</label>
      <div id="n-zones">${zoneChips(areas)}</div>
      <input type="search" id="n-filter" placeholder="Filter areas…" style="margin:6px 0 8px">
      <div class="area-pick" id="n-work">${areaPickRows(areas, [], null)}</div>
      <div class="field-hint" style="margin-top:6px">Two or more areas draws the roads between them as covered too.</div>
    </div>

    <div class="field"><label class="field-label">Notes</label><textarea id="n-notes" placeholder="Anything worth remembering"></textarea></div>
    <div class="drawer-foot"><button class="btn btn-primary btn-block" id="n-save">Add driver</button></div>`);

  wireAreaPick($('#n-work'));
  wireZoneChips($('#n-zones'), $('#n-work'), areas);
  wireAreaPickFilter('#n-filter', $('#n-work'));

  $('#n-save').onclick = async () => {
    const name = $('#n-name').value.trim();
    if (!name) return toast('Name is needed', 'bad');
    const areaId = $('#n-area').value || null;
    const work = readAreaPick($('#n-work'));
    const created = await api('POST', '/contacts', {
      name,
      phone: $('#n-phone').value.trim(),
      fleetSize: Number($('#n-fleet').value) || 1,
      areaId,
      reference: $('#n-ref').value.trim(),
      isCaptain: $('#n-captain').checked,
      notes: $('#n-notes').value,
    });
    // Work areas go in a second call: POST /contacts owns the roster fields and
    // PUT owns the "where he works" answers, so there is one place each of them
    // is validated rather than two that can drift apart.
    const start = $('#n-start').value || areaId;
    if (start || work.workAreaIds.length) {
      await api('PUT', `/contacts/${created.id}`, {
        startAreaId: start,
        workAreaIds: work.workAreaIds,
        bestAreaId: work.bestAreaId,
      });
    }
    await refresh();
    closeDrawer();
    toast(`${name} added`, 'good');
    go('drivers');
  };
}

// ---- trip

function openTrip(id) {
  const t = S.data.trips.find((x) => x.id === id);
  if (!t) return;
  const signed = t.stops.reduce((n, s) => n + (s.autosSigned ?? 0), 0);

  openDrawer(`
    <div class="drawer-head">
      <div>
        <div class="drawer-title">${t.date}</div>
        <div class="drawer-sub">${t.stops.length} stops${t.totalKm != null ? ` · ${t.totalKm} km · ${hm(t.totalMin)}` : ''} · from ${esc(t.startLabel)}</div>
      </div>
      <button class="drawer-x">×</button>
    </div>

    ${signed ? `<div class="note"><strong>${signed} auto${signed === 1 ? '' : 's'} signed</strong> on this trip.</div>` : ''}

    <div class="drawer-section" style="margin-top:14px">
      <div class="drawer-section-title">Stops — log what happened</div>
      ${t.stops.map((s, i) => {
        const a = area(s.areaId);
        return `<div class="card" style="margin-bottom:10px;padding:12px">
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">
            <div class="stop-seq">${i + 1}</div>
            <div style="flex:1"><div class="stop-name">${esc(a?.name ?? '?')}</div>
              <div class="stop-meta">${esc(a?.zone ?? '')}${a?.autos ? ` · ${a.autos} autos already here` : ' · untapped'}</div></div>
            <label class="check"><input type="checkbox" data-done="${i}" ${s.done ? 'checked' : ''}> done</label>
          </div>
          <div class="row">
            <div class="field" style="margin-bottom:8px">
              <label class="field-label">Autos signed</label>
              <input type="number" data-signed="${i}" value="${s.autosSigned ?? 0}" min="0">
            </div>
            <div class="field" style="margin-bottom:8px">
              <label class="field-label">Follow up on</label>
              <input type="date" data-follow="${i}" value="${esc(s.followUpDate ?? '')}">
            </div>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label class="field-label">Met</label>
            <input type="text" data-met="${i}" value="${esc(s.met ?? '')}" placeholder="Who he spoke to">
          </div>
          <div class="field" style="margin-bottom:0">
            <label class="field-label">Notes</label>
            <textarea data-notes="${i}" placeholder="What happened, what to do next">${esc(s.notes ?? '')}</textarea>
          </div>
        </div>`;
      }).join('')}
    </div>

    <div class="drawer-section">
      <div class="drawer-section-title">Trip notes</div>
      <textarea id="t-notes" placeholder="How the day went overall">${esc(t.notes ?? '')}</textarea>
    </div>

    <div class="drawer-foot">
      <button class="btn btn-primary" id="t-save">Save log</button>
      <button class="btn" id="t-status">${t.status === 'done' ? 'Reopen' : 'Mark done'}</button>
      <div class="sp"></div>
      <button class="btn btn-danger btn-sm" id="t-del">Delete</button>
    </div>`);

  const collect = () => t.stops.map((s, i) => ({
    ...s,
    done: $(`[data-done="${i}"]`).checked,
    autosSigned: Number($(`[data-signed="${i}"]`).value) || 0,
    met: $(`[data-met="${i}"]`).value,
    notes: $(`[data-notes="${i}"]`).value,
    followUpDate: $(`[data-follow="${i}"]`).value,
  }));

  $('#t-save').onclick = async () => {
    await api('PUT', `/trips/${id}`, { stops: collect(), notes: $('#t-notes').value });
    await refresh();
    closeDrawer();
    toast('Log saved', 'good');
    go(S.view);
  };

  $('#t-status').onclick = async () => {
    await api('PUT', `/trips/${id}`, { stops: collect(), notes: $('#t-notes').value, status: t.status === 'done' ? 'planned' : 'done' });
    await refresh();
    closeDrawer();
    toast(t.status === 'done' ? 'Trip reopened' : 'Trip marked done', 'good');
    go(S.view);
  };

  $('#t-del').onclick = async () => {
    if (!confirm(`Delete the trip on ${t.date}? This cannot be undone.`)) return;
    await api('DELETE', `/trips/${id}`);
    await refresh();
    closeDrawer();
    toast('Trip deleted');
    go(S.view);
  };
}

// ================================================================ wiring

function wireCommon() {
  $$('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $$('[data-log]').forEach((b) => (b.onclick = () => openTrip(b.dataset.log.split(':')[0])));
}

async function boot() {
  $$('.nav-item').forEach((b) => (b.onclick = () => (
    b.dataset.toggle ? toggleNavGroup(b.dataset.toggle) : go(b.dataset.view)
  )));
  $('#scrim').onclick = closeDrawer;
  $('#btn-plan-today').onclick = () => go('plan');
  $('#btn-sign-out').onclick = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login';
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // Theme toggle. Delegated so the same buttons work in the sidebar and on the
  // Settings page, which is re-rendered on every visit.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-set]');
    if (b) setTheme(b.dataset.themeSet);
  });
  applyTheme(currentTheme());
  S.heat = heatPrefs();

  try {
    await refresh();
    go('today');
  } catch (err) {
    // api() has already put up the "planner has stopped" screen if it was a
    // connection failure; anything else is a real load error worth showing.
    if (!serverDownShown) {
      $('#main').innerHTML = `<div class="empty"><div class="empty-title">Could not load data</div><div>${esc(err.message)}</div></div>`;
    }
  }
}

boot();
