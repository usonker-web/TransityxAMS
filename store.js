/**
 * Where data.json actually lives. Zero dependencies.
 *
 * Two backends behind one interface:
 *
 *   file    data.json next to this file. What the PC has always done.
 *   github  a file in a private GitHub repo, read and written over the
 *           contents API.
 *
 * WHY GITHUB: free hosting has no disk you can keep. Render, Koyeb and friends
 * hand you a container whose filesystem is thrown away on every restart, and
 * they restart constantly — after fifteen idle minutes, after every deploy.
 * Writing data.json there means losing a day's work to a nap. A private repo is
 * free, needs no card, survives everything, and gives every save a timestamped
 * version you can read and roll back. The backups/ folder becomes git history.
 *
 * Writes are DEBOUNCED. The app saves on every keystroke-sized edit, and one
 * HTTP round trip per edit would make the UI crawl and burn the API budget. The
 * in-memory copy is always the truth; the remote catches up a second or two
 * later, and pending work is flushed on shutdown.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- file backend

function fileStore({ dataFile, backupDir }) {
  return {
    kind: 'file',
    describe: () => `data.json in ${path.basename(path.dirname(dataFile))}`,

    async load() {
      if (!fs.existsSync(dataFile)) return null;
      return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    },

    async write(data) {
      // One snapshot per day, taken before the first write of that day.
      const stamp = new Date().toISOString().slice(0, 10);
      const dest = path.join(backupDir, `data-${stamp}.json`);
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.writeFileSync(dest, JSON.stringify(data, null, 2));
      }
      // tmp + rename, so a crash mid-write cannot leave a half-written file.
      const tmp = `${dataFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, dataFile);
    },
  };
}

// ---------------------------------------------------------------- github backend

function githubStore({ repo, token, branch, filePath }) {
  const api = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'rama-planner',
  };
  let sha = null; // version we last saw; GitHub rejects a write without it

  async function fetchSha() {
    const res = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).sha;
  }

  async function put(data, message) {
    const res = await fetch(api, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      const err = new Error(`GitHub ${res.status}: ${body}`);
      err.status = res.status;
      throw err;
    }
    sha = (await res.json()).content.sha;
  }

  return {
    kind: 'github',
    describe: () => `${repo} → ${filePath} (${branch})`,

    async load() {
      const res = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
      if (res.status === 404) return null; // first ever run: start empty and create it on first save
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `GitHub refused the token (${res.status}). Check RAMA_GH_TOKEN has "Contents: read and write" on ${repo}.`,
        );
      }
      if (!res.ok) throw new Error(`GitHub ${res.status} reading ${repo}/${filePath}`);
      const json = await res.json();
      sha = json.sha;
      return JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
    },

    async write(data) {
      const message = `planner: save ${new Date().toISOString()}`;
      try {
        await put(data, message);
      } catch (err) {
        // 409/422 means our sha is stale — someone (or a previous failed write)
        // moved the file on. Take the current version and write over it: this
        // process holds the newest data in memory, so ours is the one to keep.
        if (err.status !== 409 && err.status !== 422) throw err;
        sha = await fetchSha();
        await put(data, `${message} (retry)`);
      }
    },
  };
}

// ---------------------------------------------------------------- the store

const DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 10000; // never let continuous editing postpone a save forever
const RETRY_MS = 5000;

function createStore({ dataFile, backupDir, env = process.env }) {
  const backend = env.RAMA_GH_TOKEN && env.RAMA_GH_REPO
    ? githubStore({
      repo: env.RAMA_GH_REPO,
      token: env.RAMA_GH_TOKEN,
      branch: env.RAMA_GH_BRANCH || 'main',
      filePath: env.RAMA_GH_PATH || 'data.json',
    })
    : fileStore({ dataFile, backupDir });

  let timer = null;
  let firstDirtyAt = 0;
  let pendingData = null;   // newest snapshot waiting to go out
  let writing = false;
  let lastError = null;
  let lastSavedAt = null;

  async function drain() {
    if (writing || !pendingData) return;
    writing = true;
    const data = pendingData;
    pendingData = null;
    firstDirtyAt = 0;
    try {
      await backend.write(data);
      lastError = null;
      lastSavedAt = new Date().toISOString();
    } catch (err) {
      lastError = err.message;
      console.error(`  ! could not save — ${err.message}`);
      // Put it back only if nothing newer arrived meanwhile, then retry. Data
      // is never dropped on the floor; the in-memory copy stays authoritative.
      if (!pendingData) pendingData = data;
      setTimeout(() => drain(), RETRY_MS).unref?.();
    } finally {
      writing = false;
    }
  }

  return {
    kind: backend.kind,
    describe: () => backend.describe(),
    status: () => ({
      kind: backend.kind,
      where: backend.describe(),
      pending: !!pendingData || writing,
      lastSavedAt,
      lastError,
    }),

    load: () => backend.load(),

    /** Returns immediately. The write happens a moment later. */
    save(data) {
      pendingData = data;
      if (!firstDirtyAt) firstDirtyAt = Date.now();
      clearTimeout(timer);
      const wait = Math.min(DEBOUNCE_MS, Math.max(0, firstDirtyAt + MAX_WAIT_MS - Date.now()));
      timer = setTimeout(() => drain(), wait);
      timer.unref?.();
    },

    /**
     * Push anything outstanding and wait for it. Used on shutdown, where the
     * host gives us only a few seconds before SIGKILL — so this gives up rather
     * than looping on a backend that is refusing writes.
     */
    async flush({ timeoutMs = 8000 } = {}) {
      clearTimeout(timer);
      const deadline = Date.now() + timeoutMs;
      while ((pendingData || writing) && Date.now() < deadline) {
        if (writing) await new Promise((r) => setTimeout(r, 50));
        else await drain();
      }
      return !pendingData;
    },
  };
}

module.exports = { createStore };
