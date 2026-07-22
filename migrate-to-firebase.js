/**
 * One-time: copy the PC's data.json into Firestore.
 *
 * Run it once, before the first real use of the hosted site. Without it the
 * site opens empty — it starts blank when it finds no document, and the first
 * edit saves that blankness on top of nothing. The PC copy is never touched, so
 * the cost of forgetting is confusion rather than loss, but the confusion is
 * "where did 166 people go".
 *
 *   set RAMA_FB_PROJECT=...
 *   set RAMA_FB_CLIENT_EMAIL=...
 *   set RAMA_FB_PRIVATE_KEY=...
 *   node migrate-to-firebase.js
 *
 * Safe to run twice: it overwrites the document with the file, which is the
 * direction you want while the PC is still the real copy. Once the site is
 * live, this is the wrong direction — it would throw away everything entered
 * online. Hence the confirmation below.
 */

const fs = require('fs');
const path = require('path');
const { createStore } = require('./store.js');

const DATA_FILE = path.join(__dirname, 'data.json');

async function main() {
  if (!process.env.RAMA_FB_PROJECT) {
    throw new Error('RAMA_FB_PROJECT is not set. This needs the same three Firebase variables Netlify has.');
  }
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`No data.json next to this script. Nothing to move.`);
  }

  const local = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const counts = `${local.contacts?.length ?? 0} contacts, ${local.trips?.length ?? 0} trips`;

  const store = createStore({ dataFile: DATA_FILE, backupDir: path.join(__dirname, 'backups') });
  if (store.kind !== 'firestore') {
    throw new Error(`Expected the Firestore backend, got "${store.kind}". Check the three RAMA_FB_ variables.`);
  }
  console.log(`  Target: ${store.describe()}`);

  // Refuse to quietly flatten work that only exists online.
  const remote = await store.load();
  if (remote) {
    const rc = remote.contacts?.length ?? 0;
    console.log(`  There is already a document there, with ${rc} contacts.`);
    if (!process.env.RAMA_OVERWRITE) {
      console.log(`
  Stopping. This script pushes the PC copy OVER whatever is in Firestore, and
  something is already in Firestore. If the site has been used, that document is
  the real one and this would erase it.

  If you are sure the file is the one to keep, run again with RAMA_OVERWRITE=1.
`);
      process.exit(1);
    }
    console.log('  RAMA_OVERWRITE is set — replacing it.');
  }

  store.save(local);
  const ok = await store.flush({ timeoutMs: 30000 });
  if (!ok) throw new Error('The write did not finish. Nothing was changed on the PC; try again.');

  console.log(`  Moved ${counts} into Firestore.`);
}

main().catch((err) => {
  console.error(`\n  Could not move the data: ${err.message}\n`);
  process.exit(1);
});
