/**
 * Password login for the planner. Zero dependencies — node:crypto only.
 *
 * WHY IT LOOKS LIKE THIS: once the planner is on a public URL, the entire
 * driver list — 166 names, phone numbers and home areas — is one guessed URL
 * away from a competitor. So the gate is on by default and covers everything,
 * including the static files, not just /api.
 *
 * Sessions are STATELESS: a signed cookie carrying its own expiry, verified
 * against a secret kept in data.json. That matters on free hosting, where the
 * server is put to sleep after fifteen idle minutes and restarted cold on the
 * next visit. A server-side session table would be wiped by every one of those
 * naps and log Rama sir out several times a day.
 */

const crypto = require('crypto');

const COOKIE = 'rama_session';
const SESSION_DAYS = 30;

// scrypt parameters. N=16384 costs roughly 60-100ms on the free tier's slow
// CPU — slow enough to make guessing expensive, fast enough that logging in
// does not feel broken.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

// ---------------------------------------------------------------- password

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, n, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  try {
    const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), keyHex.length / 2, {
      ...SCRYPT,
      N: Number(n) || SCRYPT.N,
      keylen: keyHex.length / 2,
    });
    const want = Buffer.from(keyHex, 'hex');
    // Lengths must match before timingSafeEqual, which throws on a mismatch.
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  } catch {
    return false;
  }
}

/** Reject the passwords that make the gate decorative. */
function passwordProblem(pw) {
  const s = String(pw ?? '');
  if (s.length < 8) return 'Use at least 8 characters.';
  if (/^\d+$/.test(s)) return 'Digits only is too easy to guess — add some letters.';
  if (['password', '12345678', 'rama1234', 'transityx'].includes(s.toLowerCase())) {
    return 'That is one of the first passwords anybody tries. Pick another.';
  }
  return null;
}

// ---------------------------------------------------------------- sessions

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload, secret) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function unsign(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * `gen` is bumped whenever the password changes. An old cookie then fails the
 * check, so changing the password actually kicks everyone off every device —
 * which is the entire point of changing it after someone leaves.
 */
function issue(secret, gen) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return { token: sign({ exp, gen }, secret), exp };
}

function valid(token, secret, gen) {
  const p = unsign(token, secret);
  if (!p) return false;
  if (!Number.isFinite(p.exp) || p.exp < Date.now()) return false;
  return (p.gen ?? 0) === gen;
}

// ---------------------------------------------------------------- cookies

function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * `Secure` is decided per request, not per environment. Behind Render's proxy
 * the app itself speaks plain HTTP while the browser is on HTTPS, so trusting
 * our own socket would drop the flag on exactly the deployment that needs it.
 */
function isHttps(req) {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  return proto === 'https' || !!req.socket.encrypted;
}

function cookieHeader(name, value, req, maxAgeSec) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps(req)) bits.push('Secure');
  return bits.join('; ');
}

// ---------------------------------------------------------------- lockout

/**
 * Guessing costs time. Kept in memory on purpose: a restart clearing it is
 * fine, because a restart also costs the attacker their progress, and the
 * alternative is writing to storage on every wrong password.
 */
const MAX_FAILS = 8;
const LOCK_MS = 5 * 60 * 1000;
const fails = new Map(); // ip -> { n, until }

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function lockedFor(req) {
  const rec = fails.get(clientIp(req));
  if (!rec || !rec.until || rec.until < Date.now()) return 0;
  return Math.ceil((rec.until - Date.now()) / 1000);
}

function noteFail(req) {
  const ip = clientIp(req);
  const rec = fails.get(ip) ?? { n: 0, until: 0 };
  rec.n += 1;
  if (rec.n >= MAX_FAILS) {
    rec.until = Date.now() + LOCK_MS;
    rec.n = 0;
  }
  fails.set(ip, rec);
}

function noteSuccess(req) {
  fails.delete(clientIp(req));
}

module.exports = {
  COOKIE,
  SESSION_DAYS,
  hashPassword,
  verifyPassword,
  passwordProblem,
  issue,
  valid,
  readCookies,
  cookieHeader,
  isHttps,
  lockedFor,
  noteFail,
  noteSuccess,
};
