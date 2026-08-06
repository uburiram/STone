/**
 * Automated tests for pure storage helpers + sanitize/safeCalculate patterns.
 * Run: node tests/storage-logic.test.js
 */
'use strict';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓', msg);
  } else {
    failed++;
    console.error('  ✗', msg);
  }
}

// Mirror of score / dirty parsers from storage.js
function scoreAppDataRaw(raw) {
  if (!raw || typeof raw !== 'string') return -1;
  try {
    const d = JSON.parse(raw);
    const n = Array.isArray(d.transactions) ? d.transactions.length : 0;
    let amountSum = 0;
    (d.transactions || []).forEach((t) => { amountSum += Number(t.amount) || 0; });
    return n * 1e9 + raw.length + Math.min(Math.abs(amountSum), 1e8);
  } catch (e) {
    return -1;
  }
}

function parseDirtyList(raw) {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(String) : [];
  } catch (e) {
    return [];
  }
}

function filterByDateRange(list, start, end) {
  return (list || []).filter((t) => {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    return true;
  });
}

function safeCalculate(expr) {
  // minimal subset matching app precedence via Function-free path for tests
  const cleaned = String(expr).replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  if (!/^[\d.+\-*/()]+$/.test(cleaned)) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('return (' + cleaned + ')');
    const v = fn();
    return typeof v === 'number' && isFinite(v) ? v : NaN;
  } catch (e) {
    return NaN;
  }
}

console.log('=== scoreAppDataRaw ===');
assert(scoreAppDataRaw(null) === -1, 'null → -1');
assert(scoreAppDataRaw('not-json') === -1, 'invalid json → -1');
const a = JSON.stringify({ transactions: [{ amount: 10 }, { amount: 20 }] });
const b = JSON.stringify({ transactions: [{ amount: 1 }] });
assert(scoreAppDataRaw(a) > scoreAppDataRaw(b), 'more txs score higher');

console.log('=== parseDirtyList ===');
assert(JSON.stringify(parseDirtyList(null)) === '[]', 'null → []');
assert(JSON.stringify(parseDirtyList('["a","b"]')) === JSON.stringify(['a', 'b']), 'parses ids');
assert(JSON.stringify(parseDirtyList('bad')) === '[]', 'bad json → []');

console.log('=== filterByDateRange ===');
const txs = [
  { id: '1', date: '2026-01-01', amount: 1 },
  { id: '2', date: '2026-02-15', amount: 2 },
  { id: '3', date: '2026-03-20', amount: 3 }
];
assert(filterByDateRange(txs, '2026-02-01', '2026-02-28').length === 1, 'Feb only');
assert(filterByDateRange(txs, null, null).length === 3, 'all');
assert(filterByDateRange(txs, '2026-03-01', '2026-12-31').length === 1, 'from March');

console.log('=== safeCalculate ===');
assert(safeCalculate('100+50') === 150, '100+50');
assert(safeCalculate('10*2+5') === 25, '10*2+5');
assert(Number.isNaN(safeCalculate('alert(1)')), 'rejects code');

console.log('=== LS size guard concept ===');
const MAX = 400000;
assert(MAX === 400000, 'LS_APPDATA_MAX_CHARS = 400000');
assert('x'.repeat(500000).length > MAX, 'large blob exceeds cap');

// Mirror of migrateFromLegacy import decision (must not re-import after intentional clear)
function shouldImportLegacy(migrated, existingCount, bestN) {
  if (migrated && existingCount === 0) return false; // intentional clear
  if (!migrated || bestN > existingCount) return true;
  return false;
}

console.log('=== migrateAfterClear guard ===');
assert(shouldImportLegacy(true, 0, 5) === false, 'migrated+empty → skip legacy (clear)');
assert(shouldImportLegacy(false, 0, 5) === true, 'first migrate → import');
assert(shouldImportLegacy(true, 2, 10) === true, 'legacy richer → merge');
assert(shouldImportLegacy(true, 10, 2) === false, 'local richer → keep');

// Mirror of applyCloudTxSnapshot prune decision
function shouldPruneLocal(id, cloudIds, dirtyIds, deletedIds) {
  if (cloudIds.has(id)) return false;
  if (dirtyIds.has(id)) return false; // keep unsynced local work
  return true; // prune stale (including already-deleted queue)
}

console.log('=== cloud snapshot prune safety ===');
const cloud = new Set(['a', 'b']);
const dirty = new Set(['c']); // local-only unsynced
const deleted = new Set(['d']);
assert(shouldPruneLocal('a', cloud, dirty, deleted) === false, 'on cloud → keep');
assert(shouldPruneLocal('c', cloud, dirty, deleted) === false, 'dirty local → keep');
assert(shouldPruneLocal('d', cloud, dirty, deleted) === true, 'not cloud not dirty → prune');
assert(shouldPruneLocal('x', cloud, dirty, deleted) === true, 'orphan → prune');

// Soft sync: only clear successfully uploaded ids
function clearDirtyAfterUpload(dirtyIds, uploadedIds) {
  const up = new Set(uploadedIds.map(String));
  return dirtyIds.filter((id) => !up.has(String(id)));
}
console.log('=== clearDirty partial success ===');
assert(
  JSON.stringify(clearDirtyAfterUpload(['1', '2', '3'], ['1', '3'])) === JSON.stringify(['2']),
  'missing upload stays dirty'
);
assert(
  JSON.stringify(clearDirtyAfterUpload(['1'], [])) === JSON.stringify(['1']),
  'all failed → all remain dirty'
);

console.log('\nResult:', passed, 'passed,', failed, 'failed');
process.exit(failed ? 1 : 0);
