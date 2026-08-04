
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

function safeCalculate(expr) {
  if (!expr) return 0;
  let cleaned = String(expr)
    .replace(/×/g, '*')
    .replace(/x/gi, '*')
    .replace(/÷/g, '/')
    .replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) return NaN;
  try {
    let rawTokens = cleaned.match(/(\d+(?:\.\d+)?|[+\-*/()])/g);
    if (!rawTokens) return NaN;
    let tokens = [];
    for (let i = 0; i < rawTokens.length; i++) {
      const t = rawTokens[i];
      if ((t === '-' || t === '+') &&
          (tokens.length === 0 || '+-*/('.includes(String(tokens[tokens.length - 1])))) {
        const next = rawTokens[i + 1];
        if (next && !isNaN(next)) {
          tokens.push(parseFloat((t === '-' ? '-' : '') + next));
          i++;
          continue;
        }
      }
      if (!isNaN(t)) tokens.push(parseFloat(t));
      else tokens.push(t);
    }
    let outputQueue = [];
    let operatorStack = [];
    let precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
    for (let token of tokens) {
      if (typeof token === 'number') {
        outputQueue.push(token);
      } else if ('+-*/'.includes(token)) {
        while (
          operatorStack.length > 0 &&
          '+-*/'.includes(operatorStack[operatorStack.length - 1]) &&
          precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
        ) {
          outputQueue.push(operatorStack.pop());
        }
        operatorStack.push(token);
      } else if (token === '(') {
        operatorStack.push(token);
      } else if (token === ')') {
        while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
          outputQueue.push(operatorStack.pop());
        }
        operatorStack.pop();
      }
    }
    while (operatorStack.length > 0) outputQueue.push(operatorStack.pop());
    let evalStack = [];
    for (let token of outputQueue) {
      if (typeof token === 'number') {
        evalStack.push(token);
      } else {
        let b = evalStack.pop();
        let a = evalStack.pop();
        if (a === undefined || b === undefined) return NaN;
        if (token === '+') evalStack.push(a + b);
        if (token === '-') evalStack.push(a - b);
        if (token === '*') evalStack.push(a * b);
        if (token === '/') {
          if (b === 0) return NaN;
          evalStack.push(a / b);
        }
      }
    }
    return evalStack.length === 1 ? evalStack[0] : NaN;
  } catch (e) {
    return NaN;
  }
}

function escapeAttr(str) {
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, ' ')
    .replace(/\r/g, '');
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

assert(safeCalculate('100+50') === 150, '100+50');
assert(safeCalculate('10*2+5') === 25, '10*2+5');
assert(safeCalculate('10×2+5') === 25, 'unicode multiply');
assert(safeCalculate('100÷4') === 25, 'unicode divide');
assert(safeCalculate('10x2') === 20, 'letter x multiply');
assert(Number.isNaN(safeCalculate('10/0')), 'div by zero');
assert(Number.isNaN(safeCalculate('alert(1)')), 'rejects code');
assert(safeCalculate('-5+10') === 5, 'unary minus');
assert(safeCalculate('(2+3)*4') === 20, 'parens');

assert(escapeAttr("a'b") === "a\\'b", 'escape single quote');
assert(escapeAttr('a"b') === 'a&quot;b', 'escape double quote');
assert(escapeAttr('a<b>') === 'a&lt;b&gt;', 'escape angle brackets');
assert(!escapeAttr('id\n1').includes('\n'), 'strip newlines');

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
