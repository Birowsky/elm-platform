// Tests for lazyShallow and lazyFancy, on the real kernel code.
//
// Every transition also checks that the patched DOM is identical to a fresh
// render of the new view, because a wrong skip leaves stale DOM behind silently.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./kernel.js');

const k = load();


// VIEWS

let calls = 0;

function show(...values) {
  calls++;
  return k.node('div', [], [k.text(JSON.stringify(values))]);
}

const viewOne = record => show(record);
const viewOther = record => show('other', record);
const viewTwo = record => deep => show(record, deep);


// TRANSITIONS

function start(view) {
  calls = 0;
  return { view, dom: k.render(view) };
}

function go(state, next) {
  calls = 0;
  const patched = k.applyPatches(state.dom, state.view, k.diff(state.view, next));
  assert.equal(patched.outerHTML, k.render(next).outerHTML, 'patched DOM must match a fresh render');
  return { view: next, dom: patched };
}


// lazyShallow

test('lazyShallow: renders on first use', () => {
  const { dom } = start(k.lazyShallow(viewOne, { a: 1 }));
  assert.equal(dom.outerHTML, '<div>[{"a":1}]</div>');
  assert.equal(calls, 1);
});

test('lazyShallow: skips the view on a new record whose fields are all the same', () => {
  const list = [1, 2];
  const state = start(k.lazyShallow(viewOne, { a: 1, list }));
  const next = go(state, k.lazyShallow(viewOne, { a: 1, list }));
  assert.equal(calls, 0);
  assert.equal(next.dom, state.dom);
});

test('lazyShallow: runs the view when a field changes', () => {
  const next = go(start(k.lazyShallow(viewOne, { a: 1 })), k.lazyShallow(viewOne, { a: 2 }));
  assert.equal(calls, 1);
  assert.equal(next.dom.textContent, '[{"a":2}]');
});

test('lazyShallow: checks fields by reference, so an equal new list runs the view', () => {
  go(start(k.lazyShallow(viewOne, { list: [1] })), k.lazyShallow(viewOne, { list: [1] }));
  assert.equal(calls, 1);
});

test('lazyShallow: runs the view when the view function differs', () => {
  const next = go(start(k.lazyShallow(viewOne, { a: 1 })), k.lazyShallow(viewOther, { a: 1 }));
  assert.equal(calls, 1);
  assert.equal(next.dom.textContent, '["other",{"a":1}]');
});

test('lazyShallow: runs the view when the record has more fields', () => {
  go(start(k.lazyShallow(viewOne, { a: 1 })), k.lazyShallow(viewOne, { a: 1, b: 2 }));
  assert.equal(calls, 1);
});

test('lazyShallow: runs the view when fields trade values', () => {
  go(start(k.lazyShallow(viewOne, { a: 1, b: 2 })), k.lazyShallow(viewOne, { a: 2, b: 1 }));
  assert.equal(calls, 1);
});

test('lazyShallow: the order of the fields in the object does not matter', () => {
  go(start(k.lazyShallow(viewOne, { a: 1, b: 2, c: 3 })), k.lazyShallow(viewOne, { c: 3, a: 1, b: 2 }));
  assert.equal(calls, 0);
});

test('lazyShallow: a skip reuses the node for the next transition too', () => {
  const skipped = go(start(k.lazyShallow(viewOne, { a: 1 })), k.lazyShallow(viewOne, { a: 1 }));
  const next = go(skipped, k.lazyShallow(viewOne, { a: 2 }));
  assert.equal(calls, 1);
  assert.equal(next.dom.textContent, '[{"a":2}]');
});

test('lazyShallow: works from and to other kinds of node', () => {
  const plain = go(start(k.lazyShallow(viewOne, { a: 1 })), k.node('p', [], [k.text('plain')]));
  assert.equal(plain.dom.outerHTML, '<p>plain</p>');
  const back = go(plain, k.lazyShallow(viewOne, { a: 2 }));
  assert.equal(back.dom.textContent, '[{"a":2}]');
});

test('lazyShallow: works under a tagger', () => {
  const tag = x => x;
  go(start(k.map(tag, k.lazyShallow(viewOne, { a: 1 }))), k.map(tag, k.lazyShallow(viewOne, { a: 1 })));
  assert.equal(calls, 0);
});

test('lazyShallow: works inside another lazy node', () => {
  const inner = record => k.lazyShallow(viewOne, record);
  const next = go(start(k.lazyShallow(inner, { a: 1 })), k.lazyShallow(inner, { a: 2 }));
  assert.equal(calls, 1);
  assert.equal(next.dom.textContent, '[{"a":2}]');
});

test('lazyShallow: keyed kids that move keep their skip and their DOM node', () => {
  const kid = key => [key, k.lazyShallow(viewOne, { key })];
  const state = start(k.keyed('ul', [], ['a', 'b', 'c'].map(kid)));
  const [a, b, c] = state.dom.childNodes;
  const next = go(state, k.keyed('ul', [], ['c', 'a', 'b'].map(kid)));
  assert.equal(calls, 0);
  assert.deepEqual([...next.dom.childNodes], [c, a, b]);
});


// lazyFancy

test('lazyFancy: renders a real element on first use', () => {
  const { dom } = start(k.lazyFancy(viewTwo, { a: 1 }, { b: 2 }));
  assert.equal(dom.outerHTML, '<div>[{"a":1},{"b":2}]</div>');
  assert.equal(calls, 1);
});

test('lazyFancy: is drawn when it replaces another kind of node, and replaced in turn', () => {
  const fancy = go(start(k.node('p', [], [k.text('plain')])), k.lazyFancy(viewTwo, { a: 1 }, { b: 2 }));
  assert.equal(fancy.dom.outerHTML, '<div>[{"a":1},{"b":2}]</div>');
  const plain = go(fancy, k.node('p', [], [k.text('plain')]));
  assert.equal(plain.dom.outerHTML, '<p>plain</p>');
});

test('lazyFancy: skips the view when the second argument is equal but not the same', () => {
  const state = start(k.lazyFancy(viewTwo, { a: 1 }, { b: [1, { c: 2 }] }));
  const next = go(state, k.lazyFancy(viewTwo, { a: 1 }, { b: [1, { c: 2 }] }));
  assert.equal(calls, 0);
  assert.equal(next.dom, state.dom);
});

test('lazyFancy: runs the view when the second argument changes', () => {
  const next = go(start(k.lazyFancy(viewTwo, { a: 1 }, { b: { c: 1 } })), k.lazyFancy(viewTwo, { a: 1 }, { b: { c: 2 } }));
  assert.equal(calls, 1);
  assert.equal(next.dom.textContent, '[{"a":1},{"b":{"c":2}}]');
});

test('lazyFancy: runs the view when a field of the record changes', () => {
  go(start(k.lazyFancy(viewTwo, { a: 1 }, { b: 2 })), k.lazyFancy(viewTwo, { a: 2 }, { b: 2 }));
  assert.equal(calls, 1);
});

test('lazyFancy: checks the record by reference even when the second argument is equal', () => {
  go(start(k.lazyFancy(viewTwo, { list: [1] }, 1)), k.lazyFancy(viewTwo, { list: [1] }, 1));
  assert.equal(calls, 1);
});

test('lazyFancy: takes a primitive as the second argument', () => {
  const same = go(start(k.lazyFancy(viewTwo, { a: 1 }, 'x')), k.lazyFancy(viewTwo, { a: 1 }, 'x'));
  assert.equal(calls, 0);
  go(same, k.lazyFancy(viewTwo, { a: 1 }, 'y'));
  assert.equal(calls, 1);
});

test('lazyFancy: a skip keeps the second argument for the next comparison', () => {
  const skipped = go(start(k.lazyFancy(viewTwo, { a: 1 }, { b: 1 })), k.lazyFancy(viewTwo, { a: 1 }, { b: 1 }));
  go(skipped, k.lazyFancy(viewTwo, { a: 1 }, { b: 2 }));
  assert.equal(calls, 1);
});

test('lazyFancy: swaps with the other lazy nodes in the same position', () => {
  const view = viewTwo;
  const lazy = go(start(k.lazyFancy(view, { a: 1 }, 1)), k.lazy(viewOne, 'x'));
  assert.equal(lazy.dom.textContent, '["x"]');
  const fancy = go(lazy, k.lazyFancy(view, { a: 1 }, 1));
  assert.equal(fancy.dom.textContent, '[{"a":1},1]');
  const shallow = go(fancy, k.lazyShallow(viewOne, { a: 1 }));
  assert.equal(shallow.dom.textContent, '[{"a":1}]');
});

test('lazyFancy: the same function in the second argument does not crash', () => {
  const f = () => 1;
  go(start(k.lazyFancy(viewTwo, { a: 1 }, { f })), k.lazyFancy(viewTwo, { a: 1 }, { f }));
  assert.equal(calls, 0);
});

test('lazyFancy: two different functions in the second argument crash, like (==)', () => {
  const state = start(k.lazyFancy(viewTwo, { a: 1 }, { f: () => 1 }));
  assert.throws(() => k.diff(state.view, k.lazyFancy(viewTwo, { a: 1 }, { f: () => 1 })), /Debug\.crash 5/);
});

test('lazyFancy: is a plain thunk to everything that looks at the node', () => {
  assert.equal(k.lazyFancy(viewTwo, { a: 1 }, 1).$, k.lazy(viewOne, 1).$);
  assert.equal(k.lazyShallow(viewOne, { a: 1 }).$, k.lazy(viewOne, 1).$);
});


// lazy, which shares the diff with them

test('lazy: still skips on the same argument and runs on another', () => {
  const same = go(start(k.lazy(viewOne, 1)), k.lazy(viewOne, 1));
  assert.equal(calls, 0);
  go(same, k.lazy(viewOne, 2));
  assert.equal(calls, 1);
});
