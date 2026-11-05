// Tests for Html.Keyed diffing (_VirtualDom_diffKeyedKids).
//
// Every transition is checked three ways:
//   1. the patched DOM is identical to a fresh render of the new view
//   2. every kid whose key survives keeps its exact DOM node
//   3. the number of mounted kids that get detached and re-attached is the
//      minimum possible: matched kids minus the longest run already in order

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./kernel.js');

const k = load();

// record DOM mutations
let log = null;
for (const method of ['insertBefore', 'appendChild', 'removeChild', 'replaceChild']) {
  const original = k.window.Node.prototype[method];
  k.window.Node.prototype[method] = function (...args) {
    if (log) log.push({ method, parent: this, node: args[0] });
    return original.apply(this, args);
  };
}


// VIEWS

const item = (key, version = 0) =>
  k.node('li', version % 3 === 2 ? [k.attr('data-v', String(version))] : [], [k.text(key + (version ? '@' + version : ''))]);

// kids: array of keys, or array of [key, version]
const list = kids =>
  k.keyed('ul', [], kids.map(kid => Array.isArray(kid) ? [kid[0], item(kid[0], kid[1])] : [kid, item(kid)]));

const keysOf = kids => kids.map(kid => Array.isArray(kid) ? kid[0] : kid);


// EXPECTATIONS

// smallest number of moves: matched kids minus their longest increasing run
function minimumMoves(xKeys, yKeys) {
  const pool = new Map();
  xKeys.forEach((key, i) => (pool.get(key) || pool.set(key, []).get(key)).push(i));
  const sources = [];
  for (const key of yKeys) {
    const queue = pool.get(key);
    if (queue && queue.length) sources.push(queue.shift());
  }
  // O(n log n) longest strictly increasing subsequence, written independently
  const tails = [];
  for (const s of sources) {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] < s) lo = mid + 1; else hi = mid; }
    tails[lo] = s;
  }
  return sources.length - tails.length;
}


// RUN ONE TRANSITION

function transition(oldView, newView, dom) {
  const before = [...dom.childNodes];
  log = [];
  const patches = k.diff(oldView, newView);
  const patched = k.applyPatches(dom, oldView, patches);
  const ops = log;
  log = null;

  assert.equal(patched.outerHTML, k.render(newView).outerHTML, 'patched DOM must match a fresh render');

  // a mounted kid "moved" if any DOM operation touched it (removeChild, or
  // being appended into a fragment or re-inserted) and it is still there
  const after = new Set(patched.childNodes);
  const mounted = new Set(before);
  const detached = new Set(ops.filter(op => mounted.has(op.node)).map(op => op.node));
  return {
    dom: patched,
    patches,
    ops,
    before,
    moved: [...detached].filter(n => after.has(n)).length,
    destroyed: before.filter(n => !after.has(n)).length,
    created: [...patched.childNodes].filter(n => !before.includes(n)).length,
    insertsIntoList: ops.filter(op => op.parent === patched && op.method !== 'removeChild').length,
  };
}

function check(xKids, yKids) {
  const xView = list(xKids), yView = list(yKids);
  const dom = k.render(xView);
  const xKeys = keysOf(xKids), yKeys = keysOf(yKids);
  const result = transition(xView, yView, dom);

  // surviving keys keep their DOM node (keys are unique here)
  if (new Set(xKeys).size === xKeys.length && new Set(yKeys).size === yKeys.length) {
    const nodeOf = new Map(xKeys.map((key, i) => [key, result.before[i]]));
    yKeys.forEach((key, j) => {
      if (nodeOf.has(key)) assert.equal(result.dom.childNodes[j], nodeOf.get(key), `kid "${key}" must keep its DOM node`);
    });
  }

  assert.equal(result.moved, minimumMoves(xKeys, yKeys), 'number of moved kids must be minimal');
  return result;
}


// SCENARIOS

const N = 1000;
const L = Array.from({ length: N }, (_, i) => 'k' + i);
const without = (xs, ...idx) => xs.filter((_, i) => !idx.includes(i));
const news = (n, p = 'new') => Array.from({ length: n }, (_, i) => p + i);

const scenarios = [
  // name, old, new, expected { moved, created, destroyed }
  ['no change', L, L, { moved: 0, created: 0, destroyed: 0 }],
  ['append 1', L, [...L, 'n'], { moved: 0, created: 1, destroyed: 0 }],
  ['append 100', L, [...L, ...news(100)], { moved: 0, created: 100, destroyed: 0 }],
  ['prepend 1', L, ['n', ...L], { moved: 0, created: 1, destroyed: 0 }],
  ['prepend 100', L, [...news(100), ...L], { moved: 0, created: 100, destroyed: 0 }],
  ['remove first', L, L.slice(1), { moved: 0, created: 0, destroyed: 1 }],
  ['remove first 2', L, L.slice(2), { moved: 0, created: 0, destroyed: 2 }],
  ['remove last 3', L, L.slice(0, -3), { moved: 0, created: 0, destroyed: 3 }],
  ['remove 2 in the middle', L, without(L, 500, 501), { moved: 0, created: 0, destroyed: 2 }],
  ['remove every other', L, L.filter((_, i) => i % 2), { moved: 0, created: 0, destroyed: 500 }],
  ['insert 2 in the middle', L, [...L.slice(0, 500), 'a', 'b', ...L.slice(500)], { moved: 0, created: 2, destroyed: 0 }],
  ['replace 1 in the middle', L, [...L.slice(0, 500), 'x', ...L.slice(501)], { moved: 0, created: 1, destroyed: 1 }],
  ['swap first two', L, [L[1], L[0], ...L.slice(2)], { moved: 1, created: 0, destroyed: 0 }],
  ['swap first and last', L, [L[N - 1], ...L.slice(1, -1), L[0]], { moved: 2, created: 0, destroyed: 0 }],
  ['move first to end', L, [...L.slice(1), L[0]], { moved: 1, created: 0, destroyed: 0 }],
  ['move last to front', L, [L[N - 1], ...L.slice(0, -1)], { moved: 1, created: 0, destroyed: 0 }],
  ['move one from 100 to 900', L, [...without(L, 100).slice(0, 899), L[100], ...without(L, 100).slice(899)], { moved: 1, created: 0, destroyed: 0 }],
  ['move a block of 10 to the end', L, [...L.slice(10), ...L.slice(0, 10)], { moved: 10, created: 0, destroyed: 0 }],
  ['reverse', L, [...L].reverse(), { moved: N - 1, created: 0, destroyed: 0 }],
  ['replace everything', L, news(N), { moved: 0, created: N, destroyed: N }],
  ['clear', L, [], { moved: 0, created: 0, destroyed: N }],
  ['from empty', [], L, { moved: 0, created: N, destroyed: 0 }],
  ['remove 2 at front, move one, append', L, [...L.slice(2, 50), L[700], ...without(L, 700).slice(50), 'n'], { moved: 1, created: 1, destroyed: 2 }],
];

test('keyed scenarios on a list of 1000', async t => {
  for (const [name, xs, ys, expected] of scenarios) {
    await t.test(name, () => {
      const r = check(xs, ys);
      assert.deepEqual({ moved: r.moved, created: r.created, destroyed: r.destroyed }, expected);
    });
  }
});

test('an unchanged list produces no patches at all', () => {
  assert.equal(k.diff(list(L), list(L)).length, 0);
});

test('appending many new kids touches the list once (one fragment)', () => {
  assert.equal(check(L, [...L, ...news(100)]).insertsIntoList, 1);
  assert.equal(check([], L).insertsIntoList, 1);
});

test('kids that stay are never detached, so they keep focus', () => {
  const make = keys => k.keyed('ul', [], keys.map(key =>
    [key, key === 'e' ? k.node('li', [], [k.node('input', [], [])]) : item(key)]));
  const x = make(['a', 'b', 'c', 'd', 'e']);
  const dom = k.render(x);
  k.document.body.appendChild(dom);
  const input = dom.querySelector('input');
  input.focus();
  assert.equal(k.document.activeElement, input);
  // remove two at the front, which used to detach and re-attach everything
  const r = transition(x, make(['c', 'd', 'e']), dom);
  assert.equal(r.moved, 0);
  assert.equal(k.document.activeElement, input, 'focus must survive');
  dom.remove();
});

test('moved kids are patched too (text, attributes)', () => {
  check([['a', 0], ['b', 0], ['c', 0], ['d', 0]], [['d', 1], ['c', 2], ['b', 0], ['a', 5]]);
});

test('a moved kid whose tag changes is redrawn in its new spot', () => {
  const x = k.keyed('div', [], [['a', k.node('p', [], [k.text('a')])], ['b', k.node('p', [], [k.text('b')])], ['c', k.node('p', [], [k.text('c')])]]);
  const y = k.keyed('div', [], [['c', k.node('p', [], [k.text('c')])], ['b', k.node('p', [], [k.text('b')])], ['a', k.node('section', [], [k.text('A')])]]);
  transition(x, y, k.render(x));
});

test('nested keyed lists keep patch indexes straight', () => {
  const sub = (key, kids) => k.node('li', [], [k.text(key), k.keyed('ol', [], kids.map(c => [c, k.node('li', [], [k.text(key + c)])]))]);
  const x = k.keyed('ul', [], [['a', sub('a', ['1', '2', '3'])], ['b', sub('b', ['1', '2'])], ['c', sub('c', ['1'])], ['d', sub('d', [])]]);
  const y = k.keyed('ul', [], [['d', sub('d', ['9'])], ['b', sub('b', ['2', '1'])], ['e', sub('e', ['1'])], ['a', sub('a', ['3', '1'])], ['c', sub('c', ['1', '2'])]]);
  transition(x, y, k.render(x));
});

test('lazy and mapped kids can move', () => {
  const view = key => k.node('li', [], [k.text(key)]);
  const kid = key => key.startsWith('m') ? k.map(x => x, view(key)) : k.lazy(view, key);
  const make = keys => k.keyed('ul', [], keys.map(key => [key, kid(key)]));
  const x = make(['a', 'm1', 'b', 'm2', 'c']);
  const dom = k.render(x);
  const r = transition(x, make(['c', 'm2', 'b', 'm1', 'a', 'd']), dom);
  assert.equal(r.moved, minimumMoves(['a', 'm1', 'b', 'm2', 'c'], ['c', 'm2', 'b', 'm1', 'a', 'd']));
});

test('keys that look like Object.prototype members are ordinary keys', () => {
  const keys = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'a'];
  check(keys, [...keys].reverse());
  check(keys, ['a', 'constructor', 'n', '__proto__', 'toString']);
});

test('duplicate keys: regression for [A,C,A] -> [N,A,Z]', () => {
  // the old diff read a stale `yNextKey` here and produced four kids for a view of three
  let view = list(['A', 'C', 'A']);
  let dom = k.render(view);
  for (const next of [['N', 'A', 'Z'], ['A', 'Z'], ['Z', 'A', 'A', 'A'], ['A', 'Z', 'A']]) {
    const y = list(next);
    dom = transition(view, y, dom).dom;
    view = y;
  }
});

test('duplicate keys are matched in order and moves stay minimal', () => {
  check(['a', 'b', 'a', 'c', 'a'], ['a', 'a', 'c', 'b', 'a']);
  check(['x', 'x', 'x'], ['x', 'y', 'x']);
});


// FUZZ

function prng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function edit(rand, kids, freshKey, allowDuplicates) {
  const ys = kids.map(kid => [kid[0], rand() < 0.2 ? kid[1] + 1 : kid[1]]);
  const pick = () => Math.floor(rand() * (ys.length + 1));
  const ops = 1 + Math.floor(rand() * 4);
  for (let n = 0; n < ops; n++) {
    const r = rand();
    if (r < 0.2) ys.splice(pick(), 0, [allowDuplicates && ys.length && rand() < 0.5 ? ys[Math.floor(rand() * ys.length)][0] : freshKey(), 0]);
    else if (r < 0.4) ys.splice(pick(), 1 + Math.floor(rand() * 3));
    else if (r < 0.6 && ys.length) { const [kid] = ys.splice(Math.floor(rand() * ys.length), 1); ys.splice(pick(), 0, kid); }
    else if (r < 0.7) { const a = pick(), b = pick(); ys.splice(Math.min(a, b), Math.abs(a - b), ...ys.slice(Math.min(a, b), Math.max(a, b)).reverse()); }
    else if (r < 0.8) { for (let i = ys.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ys[i], ys[j]] = [ys[j], ys[i]]; } }
    else if (r < 0.9) ys.splice(0, Math.floor(rand() * 3));
    else ys.push(...Array.from({ length: Math.floor(rand() * 4) }, () => [freshKey(), 0]));
  }
  return ys;
}

function fuzz(seed, allowDuplicates) {
  const rand = prng(seed);
  let counter = 0;
  const freshKey = () => allowDuplicates ? 'd' + Math.floor(rand() * 6) : 'f' + counter++;
  let kids = Array.from({ length: Math.floor(rand() * 25) }, () => [freshKey(), 0]);
  let view = list(kids);
  let dom = k.render(view);
  for (let generation = 0; generation < 25; generation++) {
    const next = edit(rand, kids, freshKey, allowDuplicates);
    const nextView = list(next);
    const r = transition(view, nextView, dom);
    // With duplicate keys the optimum depends on which duplicates get paired,
    // so only correctness is checked there (step 1 of every transition).
    if (!allowDuplicates) {
      assert.equal(r.moved, minimumMoves(keysOf(kids), keysOf(next)), `seed ${seed}, generation ${generation}`);
      const nodeOf = new Map(keysOf(kids).map((key, i) => [key, r.before[i]]));
      keysOf(next).forEach((key, j) => {
        if (nodeOf.has(key)) assert.equal(r.dom.childNodes[j], nodeOf.get(key), `seed ${seed}: "${key}" lost its node`);
      });
    }
    kids = next; view = nextView; dom = r.dom;
  }
}

test('fuzz: 400 random histories with unique keys', () => {
  for (let seed = 1; seed <= 400; seed++) fuzz(seed, false);
});

test('fuzz: 400 random histories with duplicate keys', () => {
  for (let seed = 1; seed <= 400; seed++) fuzz(seed, true);
});

test('fuzz: nested keyed lists', () => {
  const rand = prng(99);
  const view = tree => k.keyed('ul', [], tree.map(([key, v, kids]) =>
    [key, k.node('li', [], [k.text(key + v), k.keyed('ol', [], kids.map(([c, cv]) => [c, k.node('li', [], [k.text(c + cv)])]))])]));
  let counter = 0;
  const fresh = () => 'n' + counter++;
  let tree = Array.from({ length: 8 }, () => [fresh(), 0, Array.from({ length: 4 }, () => [fresh(), 0])]);
  let v = view(tree);
  let dom = k.render(v);
  for (let generation = 0; generation < 300; generation++) {
    tree = edit(rand, tree.map(([key, ver]) => [key, ver]), fresh, false).map(([key, ver]) => {
      const old = tree.find(t => t[0] === key);
      return [key, ver, edit(rand, old ? old[2] : [], fresh, false)];
    });
    const next = view(tree);
    dom = transition(v, next, dom).dom;
    v = next;
  }
});
