
'use strict';
function roundMoney(n) {
  const x = Number(n);
  if (!isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}
function sumIncomeExpense(list) {
  let income = 0, expense = 0;
  (list || []).forEach(function(tx) {
    if (!tx) return;
    const a = roundMoney(tx.amount);
    if (tx.type === 'income') income = roundMoney(income + a);
    else if (tx.type === 'expense') expense = roundMoney(expense + a);
  });
  return { income, expense, net: roundMoney(income - expense) };
}
let pass = 0, fail = 0;
function assert(c, m) { if (c) { pass++; console.log('  OK', m); } else { fail++; console.error('  FAIL', m); } }

assert(roundMoney(10.1 + 10.2) === 20.3, 'float 10.1+10.2');
assert(roundMoney('12.345') === 12.35, 'round 12.345');
assert(roundMoney(undefined) === 0, 'undefined -> 0');
assert(roundMoney(NaN) === 0, 'NaN -> 0');

const s = sumIncomeExpense([
  { type: 'income', amount: 100.10 },
  { type: 'income', amount: 50.20 },
  { type: 'expense', amount: 30.05 },
  { type: 'expense', amount: 10.00 },
  { type: 'other', amount: 999 },
  null
]);
assert(s.income === 150.3, 'income 150.30');
assert(s.expense === 40.05, 'expense 40.05');
assert(s.net === 110.25, 'net 110.25');

const empty = sumIncomeExpense([]);
assert(empty.income === 0 && empty.expense === 0 && empty.net === 0, 'empty');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
