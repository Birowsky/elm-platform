// Tests for memoShallowDeep, on the real kernel code.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./kernel.js');

const k = load();


// FUNCTIONS

let calls = 0;

function derive(...values) {
  calls++;
  return { derived: values };
}

const toDerived = shallow => deep => derive(shallow, deep);
const toOther = shallow => deep => derive('other', shallow, deep);

function memo(fn, shallow, deep) {
  calls = 0;
  return k.memoShallowDeep(fn, shallow, deep);
}


// memoShallowDeep

test('memoShallowDeep: calls the function on first use', () => {
  const first = memo(toDerived, { a: 1 }, { n: 0 });
  assert.deepEqual(first, { derived: [{ a: 1 }, { n: 0 }] });
  assert.equal(calls, 1);
});

test('memoShallowDeep: gives back the last result for a new record whose fields are all the same, and an equal second argument', () => {
  const list = [1, 2];
  const first = memo(toDerived, { a: 1, list }, { n: 0, nested: ['x'] });
  const again = memo(toDerived, { list, a: 1 }, { n: 0, nested: ['x'] });
  assert.equal(calls, 0);
  assert.equal(again, first);
});

test('memoShallowDeep: calls the function when a field changes', () => {
  memo(toDerived, { a: 1 }, { n: 0 });
  const next = memo(toDerived, { a: 2 }, { n: 0 });
  assert.equal(calls, 1);
  assert.deepEqual(next, { derived: [{ a: 2 }, { n: 0 }] });
});

test('memoShallowDeep: checks fields by reference, so an equal new list calls the function', () => {
  memo(toDerived, { list: [1, 2] }, { n: 0 });
  memo(toDerived, { list: [1, 2] }, { n: 0 });
  assert.equal(calls, 1);
});

test('memoShallowDeep: calls the function when the second argument changes', () => {
  memo(toDerived, { a: 1 }, { n: 0 });
  const next = memo(toDerived, { a: 1 }, { n: 1 });
  assert.equal(calls, 1);
  assert.deepEqual(next, { derived: [{ a: 1 }, { n: 1 }] });
});

test('memoShallowDeep: anything but a record is checked by reference itself', () => {
  const list = [1, 2];
  memo(toDerived, list, 0);
  memo(toDerived, list, 0);
  assert.equal(calls, 0);
  memo(toDerived, [1, 2], 0);
  assert.equal(calls, 1);
  memo(toDerived, 3, 0);
  memo(toDerived, 3, 0);
  assert.equal(calls, 0);
});

test('memoShallowDeep: each function keeps a result of its own', () => {
  const first = memo(toDerived, { a: 1 }, 0);
  memo(toOther, { a: 2 }, 0);
  const again = memo(toDerived, { a: 1 }, 0);
  assert.equal(calls, 0);
  assert.equal(again, first);
});

test('memoShallowDeep: a function keeps only its last result', () => {
  memo(toDerived, { a: 1 }, 0);
  memo(toDerived, { a: 2 }, 0);
  memo(toDerived, { a: 1 }, 0);
  assert.equal(calls, 1);
});

test('memoShallowDeep: a new function on every call finds no result', () => {
  memo(shallow => deep => derive(shallow, deep), { a: 1 }, 0);
  memo(shallow => deep => derive(shallow, deep), { a: 1 }, 0);
  assert.equal(calls, 1);
});

test('memoShallowDeep: two different functions in the second argument crash, like (==)', () => {
  memo(toDerived, { a: 1 }, { handler: () => 1 });
  assert.throws(() => memo(toDerived, { a: 1 }, { handler: () => 2 }), /Debug.crash 5/);
});
