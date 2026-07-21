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
  sort: { areas: { key: 'priority', dir: -1 }, drivers: { key: 'fleetSize', dir: -1 } },
  filter: {
    drivers: '', driverZone: '', driverKind: '', driverModel: '', areaZone: '', areaDemand: '',
    coverZone: '', coverLevel: '',
    // Plan filters live here, not in the DOM: optimising re-renders the view,
    // and a zone sweep that silently forgets your zone is maddening.
    planQ: '', planZone: '', planListOnly: false, planUntapped: false,
  },
  mapColor: 'coverage',
  mapLayer: 'circles',  // circles | coverage | demand | gap
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

  /**
   * Mount Google when a key is set, otherwise Leaflet — but NEVER end up with a
   * dead map. A key that is mistyped, restricted to the wrong referrer, or on a
   * project without billing enabled will fail auth, and a blank grey rectangle
   * is strictly worse than the free map that was working before. So any Google
   * failure falls back to Leaflet and says why.
   */
  async mount(el, opts = {}) {
    this.fallbackReason = '';
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
      this.markers(areaMarkers());
      // Carry the heat layer across the swap — losing it silently would look
      // like the heatmap itself had broken.
      if (S.mapLayer && S.mapLayer !== 'circles') await this.heat(heatData(S.mapLayer));
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
  fit() { return this.impl.fit(); },
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
    this.map = L.map(el, { zoomControl: true, attributionControl: true }).setView([28.63, 77.22], 11);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(this.map);
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
      L.marker([it.lat, it.lng], { icon, title: it.title })
        .bindPopup(it.popup)
        .on('popupopen', () => bindPopupActions())
        .addTo(this.layer);
    }
  },

  fit() {
    const b = this.layer.getBounds?.();
    if (b?.isValid()) this.map.fitBounds(b.pad(0.12));
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
        this.info.setContent(it.popup);
        this.info.open(this.map, m);
        setTimeout(bindPopupActions, 0);
      });
      return m;
    });
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
  $('#badge-areas').textContent = s.areas;
  $('#badge-drivers').textContent = s.contacts;
  $('#badge-models').textContent = s.modelCount;
  $('#badge-trips').textContent = s.tripsDone || '';
  $('#badge-settings').textContent = S.data.settings.mapsApiKey ? '' : 'key';
}

function go(view) {
  S.view = view;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  const main = $('#main');
  main.classList.toggle('no-pad', view === 'map');
  main.scrollTop = 0;
  ({ today: viewToday, plan: viewPlan, map: viewMap, coverage: viewCoverage, areas: viewAreas, drivers: viewDrivers, models: viewModels, trips: viewTrips, settings: viewSettings }[view])();
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
        <div class="page-title">Today</div>
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
      <label class="check" style="margin:10px 0"><input type="checkbox" id="c-captain" ${c.isCaptain ? 'checked' : ''}> Captain (area lead)</label>
      ${c.phone ? `<a class="btn btn-block" href="tel:${esc(c.phone)}">Call ${esc(c.phone)}</a>` : ''}
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

    ${c.vehicles.length ? `<div class="drawer-section">
      <div class="drawer-section-title">Vehicles (${c.vehicles.length})</div>
      ${c.vehicles.map((v) => {
        const clash = v.number ? vIdx.get(v.number).filter((o) => o.id !== c.id) : [];
        const twiceHere = v.number && c.vehicles.filter((x) => x.number === v.number).length > 1;
        return `<div class="veh-row">
          <div>
            <span class="veh-num">${esc(v.number || v.raw || '—')}</span>
            ${clash.length ? `<span class="chip chip-red">also under ${esc(clash.map((o) => o.name).join(', '))}</span>`
              : twiceHere ? '<span class="chip chip-amber">listed twice</span>' : ''}
            ${v.driverName && v.driverName !== c.name ? `<div class="veh-driver">driven by ${esc(v.driverName)}</div>` : ''}
          </div>
          <div style="text-align:right">
            ${v.passingDate ? `<div class="veh-driver">passing ${esc(v.passingDate)}</div>` : ''}
            ${v.finance ? `<span class="chip chip-amber">${esc(v.finance)}</span>` : ''}
          </div>
        </div>`;
      }).join('')}
      ${withinSelf ? `<div class="field-hint" style="color:var(--amber)">${withinSelf} number${withinSelf === 1 ? ' is' : 's are'} repeated here, so this is probably <strong>${uniqueNums} auto${uniqueNums === 1 ? '' : 's'}</strong>, not ${c.fleetSize}. Correct the count above if so.</div>` : ''}
      ${dupes.some((v) => vIdx.get(v.number).some((o) => o.id !== c.id)) ? `<div class="field-hint" style="color:var(--red)">A number here is also recorded against someone else — one of the two entries is wrong.</div>` : ''}
      ${c.declaredFleet > c.vehicles.length ? `<div class="field-hint">Sheet says ${c.declaredFleet} autos but only ${c.vehicles.length} number${c.vehicles.length === 1 ? '' : 's'} written down — ${c.declaredFleet - c.vehicles.length} still to collect.</div>` : ''}
    </div>` : ''}

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

    <div class="drawer-foot"><button class="btn btn-primary btn-block" id="c-save">Save</button></div>`);

  wireAreaPick($('#c-work'));
  wireZoneChips($('#c-zones'), $('#c-work'), areas);

  $('#c-save').onclick = async () => {
    const work = readAreaPick($('#c-work'));
    await api('PUT', `/contacts/${id}`, {
      name: $('#c-name').value.trim(),
      phone: $('#c-phone').value.trim(),
      phones: $('#c-alt').value.split(',').map((p) => p.trim()).filter(Boolean),
      fleetSize: Number($('#c-fleet').value),
      areaId: $('#c-area').value || null,
      isCaptain: $('#c-captain').checked,
      notes: $('#c-notes').value,
      tenure: $('#c-tenure').value,
      parking: $('#c-parking').value.trim(),
      reference: $('#c-ref').value.trim(),
      startAreaId: $('#c-start').value || null,
      workAreaIds: work.workAreaIds,
      bestAreaId: work.bestAreaId,
    });
    await refresh();
    closeDrawer();
    toast('Saved', 'good');
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
  $$('.nav-item').forEach((b) => (b.onclick = () => go(b.dataset.view)));
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
