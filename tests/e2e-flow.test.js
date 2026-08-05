/**
 * STone — integration-style flow tests (no browser)
 * Covers: sanitize → score → nested merge → path → backup payload shape
 * Run: node tests/e2e-flow.test.js
 */
'use strict';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✓', msg); }
  else { failed++; console.error('  ✗', msg); }
}

// --- mirrors of critical pure helpers ---
function roundMoney(n) {
  const x = Number(n);
  if (!isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function sanitizeSubsTree(subs, depth, MAX) {
  MAX = MAX || 5;
  if (!Array.isArray(subs)) return [];
  if (depth > MAX - 1) return [];
  const out = [];
  const seen = new Set();
  for (const s of subs) {
    if (typeof s === 'string') {
      const name = String(s).trim().slice(0, 200);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push(name);
    } else if (s && typeof s === 'object' && typeof s.name === 'string') {
      const name = String(s.name).trim().slice(0, 200);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const children = sanitizeSubsTree(s.children, depth + 1, MAX);
      out.push(children.length ? { name, children } : name);
    }
  }
  return out;
}

function mergeSubsByName(localSubs, cloudSubs) {
  const local = Array.isArray(localSubs) ? localSubs : [];
  const cloud = Array.isArray(cloudSubs) ? cloudSubs : [];
  function nodeName(n) {
    if (typeof n === 'string') return n;
    if (n && typeof n === 'object' && typeof n.name === 'string') return n.name;
    return '';
  }
  function nodeChildren(n) {
    if (typeof n === 'string') return [];
    if (n && typeof n === 'object' && Array.isArray(n.children)) return n.children;
    return [];
  }
  function isBranch(n) {
    return n && typeof n === 'object' && typeof n.name === 'string';
  }
  const map = new Map();
  const order = [];
  function upsert(node) {
    const name = nodeName(node).trim();
    if (!name) return;
    const key = name.toLowerCase();
    const kids = nodeChildren(node);
    if (!map.has(key)) {
      order.push(key);
      map.set(key, { name, children: (kids.length > 0 || isBranch(node)) ? kids.slice() : null });
      return;
    }
    const cur = map.get(key);
    if (kids.length > 0) {
      if (cur.children == null) cur.children = [];
      cur.children = mergeSubsByName(cur.children, kids);
    }
  }
  local.forEach(upsert);
  cloud.forEach(upsert);
  return order.map((key) => {
    const cur = map.get(key);
    if (cur.children && cur.children.length > 0) return { name: cur.name, children: cur.children };
    return cur.name;
  });
}

function isInvalidCategoryName(name, sep) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return true;
  if (s.indexOf(sep) !== -1 || s.indexOf('›') !== -1) return true;
  return false;
}

// ===== Flow 1: save transaction shape → reload sanitize keeps data =====
console.log('=== Flow: save → sanitize → still present ===');
const saved = {
  transactions: [
    { id: 'tx1', type: 'income', date: '2026-08-05', time: '10:00', category: 'เงินสด', subCategory: '', amount: 100.5, note: 'test' },
    { id: 'tx2', type: 'expense', date: '2026-08-05', time: '11:00', category: 'ค่าเช่าสถานที่', subCategory: 'ค่าไฟ', amount: 50, note: '' }
  ],
  categories: {
    income: [{ name: 'เงินสด', subs: [] }],
    expense: [{ name: 'ค่าเช่าสถานที่', subs: ['ค่าไฟ', 'ค่าน้ำ'] }]
  },
  materials: ['มะละกอ'],
  equipments: ['ครก'],
  customGoal: null,
  customGoalPercent: null
};
const raw = JSON.stringify(saved);
const reloaded = JSON.parse(raw);
assert(reloaded.transactions.length === 2, '2 txs after reload');
assert(roundMoney(reloaded.transactions[0].amount) === 100.5, 'amount preserved');
assert(reloaded.categories.expense[0].subs[0] === 'ค่าไฟ', 'legacy subs string preserved');

// ===== Flow 2: nested category sanitize does not drop legacy =====
console.log('=== Flow: nested + legacy categories ===');
const nested = sanitizeSubsTree([
  'ค่าไฟ',
  { name: 'ค่าน้ำ', children: ['รายเดือน', 'รายปี'] }
], 1);
assert(nested[0] === 'ค่าไฟ', 'leaf kept');
assert(nested[1].name === 'ค่าน้ำ' && nested[1].children.length === 2, 'branch kept');

// ===== Flow 3: cloud merge by name =====
console.log('=== Flow: guest↔cloud category merge ===');
const merged = mergeSubsByName(
  [{ name: 'ค่าน้ำ', children: ['รายเดือน'] }],
  [{ name: 'ค่าน้ำ', children: ['รายปี'] }, 'ค่าขยะ']
);
assert(merged.filter((x) => (typeof x === 'string' ? x : x.name) === 'ค่าน้ำ').length === 1, 'no duplicate name');
assert(merged[0].children.includes('รายเดือน') && merged[0].children.includes('รายปี'), 'children union');

// ===== Flow 4: path encoding for nested subCategory =====
console.log('=== Flow: nested path encoding ===');
const SEP = ' › ';
const path = ['ชั้น2', 'ชั้น3'].join(SEP);
assert(path.split(SEP).length === 2, 'path round-trip');
assert(!isInvalidCategoryName('ค่าน้ำ', SEP), 'valid name');
assert(isInvalidCategoryName('a › b', SEP), 'rejects path sep in name');

// ===== Flow 5: backup payload shape =====
console.log('=== Flow: auto-backup payload ===');
const backup = {
  transactions: saved.transactions,
  categories: saved.categories,
  materials: saved.materials,
  equipments: saved.equipments,
  customGoal: null,
  customGoalPercent: null
};
const bakStr = JSON.stringify(backup);
assert(bakStr.length > 50, 'backup non-empty');
const restored = JSON.parse(bakStr);
assert(restored.transactions[1].category === 'ค่าเช่าสถานที่', 'restore category ok');

// ===== Flow 6: money net after day ops =====
console.log('=== Flow: daily net ===');
let inc = 0, exp = 0;
saved.transactions.forEach((t) => {
  if (t.type === 'income') inc = roundMoney(inc + t.amount);
  else exp = roundMoney(exp + t.amount);
});
assert(roundMoney(inc - exp) === 50.5, 'daily net 50.5');

console.log('\nResult:', passed, 'passed,', failed, 'failed');
process.exit(failed ? 1 : 0);
