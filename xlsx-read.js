/**
 * Minimal .xlsx reader. Zero dependencies — Node built-ins only.
 *
 * An .xlsx is a ZIP of XML parts. This unzips the parts we need (via zlib,
 * which ships with Node) and pulls cell values out of the sheet XML.
 *
 * Scope: reads cell values as strings/numbers/dates. It does not evaluate
 * formulas — a formula cell yields its last cached value, which is what
 * Excel stores anyway.
 */

const fs = require('fs');
const zlib = require('zlib');

// ------------------------------------------------------------------ zip

/**
 * Unzip every entry into a Map of filename -> Buffer.
 * Walks the central directory backwards from the EOCD record, which is the
 * only reliable way to find entries (local headers can lie about sizes when
 * a data descriptor is used).
 */
function unzip(buf) {
  const EOCD_SIG = 0x06054b50;
  const CDH_SIG = 0x02014b50;

  // EOCD is at the end, but a trailing comment can push it back up to 64KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx (no ZIP end-of-central-directory found).');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16); // start of central directory

  const files = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(ptr) !== CDH_SIG) break;

    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    // Re-read the local header: its extra field length often differs from the
    // central directory's, so the data offset must be computed from it.
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    files.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

// ------------------------------------------------------------------ xml

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[ent] ?? m;
  });
}

/** Concatenate every <t> in a chunk — a shared string can be split across runs. */
function textOf(xml) {
  let out = '';
  const re = /<t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m;
  while ((m = re.exec(xml))) out += decodeXml(m[1] ?? '');
  return out;
}

function sharedStrings(files) {
  const part = files.get('xl/sharedStrings.xml');
  if (!part) return [];
  const xml = part.toString('utf8');
  const out = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g;
  let m;
  while ((m = re.exec(xml))) out.push(m[1] ? textOf(m[1]) : '');
  return out;
}

// ------------------------------------------------------------------ cells

/** "BC12" -> 54 (zero-based column index). */
function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Excel serial date -> JS Date (UTC).
 * Excel treats 1900 as a leap year (it wasn't) so serials >= 60 are shifted
 * one day; the 25569 epoch offset already accounts for it.
 */
function serialToDate(n) {
  return new Date(Math.round((n - 25569) * 86400 * 1000));
}

/** Style indexes whose number format is a date/time. */
function dateStyles(files) {
  const part = files.get('xl/styles.xml');
  const isDate = new Set();
  if (!part) return isDate;
  const xml = part.toString('utf8');

  // Built-in numFmtIds that mean date/time.
  const builtinDate = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

  // Custom formats: treat as a date if the code has date/time tokens and no
  // currency-ish literal that would make it a plain number.
  const custom = new Set();
  const fmtRe = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g;
  let m;
  while ((m = fmtRe.exec(xml))) {
    const code = decodeXml(m[2]);
    if (/[dmyhs]/i.test(code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, ''))) {
      custom.add(Number(m[1]));
    }
  }

  const xfBlock = xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/);
  if (!xfBlock) return isDate;
  const xfRe = /<xf[^>]*numFmtId="(\d+)"[^>]*\/?>/g;
  let i = 0;
  while ((m = xfRe.exec(xfBlock[0]))) {
    const id = Number(m[1]);
    if (builtinDate.has(id) || custom.has(id)) isDate.add(i);
    i++;
  }
  return isDate;
}

/** Map sheet name -> zip part path, honouring the rels indirection. */
function sheetPaths(files) {
  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';

  const relTarget = new Map();
  const relRe = /<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g;
  let m;
  while ((m = relRe.exec(rels))) relTarget.set(m[1], m[2]);

  const out = new Map();
  const shRe = /<sheet[^>]*\/?>/g;
  while ((m = shRe.exec(wb))) {
    const tag = m[0];
    const name = tag.match(/name="([^"]*)"/)?.[1];
    const rid = tag.match(/r:id="([^"]*)"/)?.[1];
    if (!name || !rid) continue;
    let target = relTarget.get(rid);
    if (!target) continue;
    target = target.replace(/^\/xl\//, '').replace(/^\//, '');
    out.set(decodeXml(name), target.startsWith('xl/') ? target : `xl/${target}`);
  }
  return out;
}

// ------------------------------------------------------------------ public

/**
 * Read a workbook.
 * @returns {Map<string, Array<Array<string|number|Date|null>>>} sheet name -> rows of cells
 */
function readWorkbook(filePath) {
  const files = unzip(fs.readFileSync(filePath));
  const strings = sharedStrings(files);
  const dateStyleIds = dateStyles(files);

  const book = new Map();
  for (const [name, part] of sheetPaths(files)) {
    const xml = files.get(part)?.toString('utf8');
    if (!xml) continue;

    const rows = [];
    const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>|<row[^>]*\br="(\d+)"[^>]*\/>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const rowNum = Number(rm[1] ?? rm[3]);
      const body = rm[2] ?? '';
      const cells = [];

      const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let cm;
      while ((cm = cellRe.exec(body))) {
        const attrs = cm[1];
        const inner = cm[2] ?? '';
        const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
        if (!ref) continue;
        const type = attrs.match(/t="([^"]+)"/)?.[1] ?? 'n';
        const style = Number(attrs.match(/s="(\d+)"/)?.[1] ?? NaN);

        let value = null;
        if (type === 's') {
          const idx = Number(textOf(`<t>${inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? ''}</t>`));
          value = strings[idx] ?? '';
        } else if (type === 'inlineStr') {
          value = textOf(inner);
        } else if (type === 'str') {
          value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        } else if (type === 'b') {
          value = (inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '0') === '1';
        } else {
          const raw = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (raw == null || raw === '') value = null;
          else {
            const num = Number(raw);
            value = Number.isFinite(num)
              ? (dateStyleIds.has(style) ? serialToDate(num) : num)
              : decodeXml(raw);
          }
        }
        cells[colIndex(ref)] = value;
      }

      rows[rowNum - 1] = cells;
    }

    // Normalise: no holes, no undefined.
    const height = rows.length;
    const width = rows.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);
    const grid = [];
    for (let r = 0; r < height; r++) {
      const row = [];
      for (let c = 0; c < width; c++) row.push(rows[r]?.[c] ?? null);
      grid.push(row);
    }
    book.set(name, grid);
  }
  return book;
}

module.exports = { readWorkbook };
