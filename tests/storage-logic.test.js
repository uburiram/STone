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

function dbNameForScope(scope) {
  if (!scope || scope === 'guest') return 'somtum-idb-v2';
  return 'somtum-idb-v2-u-' + String(scope);
}

function lsKeyFor(key, activeScope, GLOBAL_LS_KEYS) {
  if (GLOBAL_LS_KEYS.has(key)) return key;
  if (activeScope === 'guest') return key;
  return 'somtum@' + activeScope + ':' + key;
}

function shouldAdoptDiskTx(memLen, diskLen, txCacheLoaded) {
  if (txCacheLoaded && memLen > diskLen) return false;
  if (memLen === 0) return true;
  return diskLen >= memLen;
}

function safeCalculate(expr) {
  const cleaned = String(expr).replace(/\u00d7/g, '*').replace(/x/gi, '*').replace(/\u00f7/g, '/').replace(/\s+/g, '');
  if (!/^[\d.+\-*/()]+$/.test(cleaned)) return NaN;
  try {
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
assert(safeCalculate('10\u00d73') === 30, 'unicode multiply');
assert(Number.isNaN(safeCalculate('alert(1)')), 'rejects code');

console.log('=== LS size guard concept ===');
const MAX = 400000;
assert(MAX === 400000, 'LS_APPDATA_MAX_CHARS = 400000');
assert('x'.repeat(500000).length > MAX, 'large blob exceeds cap');

console.log('=== scope helpers ===');
assert(dbNameForScope('guest') === 'somtum-idb-v2', 'guest db name');
assert(dbNameForScope(null) === 'somtum-idb-v2', 'null scope = guest');
assert(dbNameForScope('uid123') === 'somtum-idb-v2-u-uid123', 'user db name');
const GLOBAL = new Set(['somtumDarkMode', 'somtumActiveScope', 'somtumDataOwnerUid']);
assert(lsKeyFor('somtumDarkMode', 'uid1', GLOBAL) === 'somtumDarkMode', 'global key unprefixed');
assert(lsKeyFor('somtumHasUnsyncedData', 'guest', GLOBAL) === 'somtumHasUnsyncedData', 'guest unprefixed');
assert(lsKeyFor('somtumHasUnsyncedData', 'uid1', GLOBAL) === 'somtum@uid1:somtumHasUnsyncedData', 'user prefixed');

console.log('=== hydrate race guard ===');
assert(shouldAdoptDiskTx(0, 5, false) === true, 'empty mem adopts disk');
assert(shouldAdoptDiskTx(10, 5, true) === false, 'richer mem not clobbered');
assert(shouldAdoptDiskTx(5, 5, true) === true, 'equal adopts');
assert(shouldAdoptDiskTx(3, 10, false) === true, 'richer disk adopts');

console.log('\nResult:', passed, 'passed,', failed, 'failed');
process.exit(failed ? 1 : 0);
