// Tests for the staggered entrance of a keyed node with ef-stagger, on the real kernel
// code. jsdom has no layout and runs no CSS, so what is in view and what the CSS of the
// node says are stubbed: a kid's place is its data-top, and the node's custom
// properties are the ones in `css`. What really happens on screen is in e2e.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./kernel.js');

const k = load();


// VIEWS

const STAGGER = k.attr('ef-stagger', 'slideUpFade');
const SIZE = 10;

const item = (top, attrs = []) => k.node('li', [k.attr('data-top', String(top)), ...attrs]);
const list = (tops, attrs = [STAGGER]) => k.keyed('ul', [k.attr('data-port', ''), ...attrs], tops.map(top => [String(top), item(top)]));
const cell = left => k.node('li', [k.attr('data-left', String(left))]);
const row = lefts => k.keyed('ul', [k.attr('data-port', ''), STAGGER], lefts.map(left => [String(left), cell(left)]));


// A LAYOUT TO MEASURE

function useLayout(t, { css = {}, port = [0, 50], portX = [0, 100], transition = '0.4s' } = {}) {
  const defaults = { '--stagger-span': '600ms', '--stagger-easing': 'linear', '--stagger-overscan': '0' };
  const original = k.window.getComputedStyle;
  const proto = k.window.Element.prototype;
  const originalRect = proto.getBoundingClientRect;

  k.window.getComputedStyle = element => ({
    getPropertyValue: name => element.hasAttribute('data-port')
      ? { ...defaults, ...css, 'overflow-x': 'visible', 'overflow-y': 'auto' }[name] ?? ''
      : { 'transition-duration': transition, 'transition-delay': '0s' }[name] ?? '',
  });
  proto.getBoundingClientRect = function () {
    if (this.hasAttribute('data-port')) return { top: port[0], bottom: port[1], left: portX[0], right: portX[1] };
    const top = Number(this.getAttribute('data-top'));
    const left = Number(this.getAttribute('data-left'));
    return { top, bottom: top + SIZE, left, right: left + SIZE };
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });

  t.after(() => {
    k.window.getComputedStyle = original;
    proto.getBoundingClientRect = originalRect;
  });
  return ms => t.mock.timers.tick(ms);
}


// TRANSITIONS

function start(view) {
  const dom = k.render(view);
  k.document.body.replaceChildren(dom);
  return { view, dom };
}

function go(app, view) {
  app.dom = k.applyPatches(app.dom, app.view, k.diff(app.view, view));
  app.view = view;
}

const kidsOf = app => [...app.dom.childNodes];
const stateOf = element => element.nodeType === 1 ? element.getAttribute('stagger-state') : null;
const delaysOf = app => kidsOf(app).map(kid => kid.nodeType === 1 ? kid.style.getPropertyValue('--stagger-delay') : '');
const statesOf = app => kidsOf(app).map(stateOf);


// WHAT STAGGERS

test('a first render staggers nothing', t => {
  useLayout(t);
  const app = start(list([0, 10, 20]));
  assert.deepEqual(statesOf(app), [null, null, null]);
});

test('kids that arrive later in view come in staggered, in order', t => {
  useLayout(t);
  const app = start(list([]));
  go(app, list([0, 10, 20, 30, 40]));
  assert.deepEqual(statesOf(app), ['entered', 'entered', 'entered', 'entered', 'entered']);
  assert.deepEqual(delaysOf(app), ['0ms', '150ms', '300ms', '450ms', '600ms']);
});

test('what a view kept from before comes at once, when a page arrives', t => {
  useLayout(t);
  const app = start(list([0, 10]));
  go(app, list([0, 10, 20, 30]));
  assert.deepEqual(statesOf(app), [null, null, 'entered', 'entered']);
  assert.deepEqual(delaysOf(app).slice(2), ['0ms', '600ms']);
});

test('a lone kid has no delay', t => {
  useLayout(t);
  const app = start(list([]));
  go(app, list([0]));
  assert.deepEqual(delaysOf(app), ['0ms']);
});

test('a node without ef-stagger comes in untouched', t => {
  useLayout(t);
  const app = start(list([], []));
  go(app, list([0, 10, 20], []));
  assert.deepEqual(statesOf(app), [null, null, null]);
});

test('kids that only move are not new', t => {
  useLayout(t);
  const app = start(list([0, 10, 20]));
  go(app, list([20, 0, 10]));
  assert.deepEqual(statesOf(app), [null, null, null]);
});

test('a text kid among them is no problem', t => {
  useLayout(t);
  const app = start(list([]));
  go(app, k.keyed('ul', [k.attr('data-port', ''), STAGGER], [['t', k.text('hi')], ['0', item(0)]]));
  assert.deepEqual(statesOf(app).slice(1), ['entered']);
});


// WHAT IS IN VIEW

test('kids out of view come at once, and are not measured past the first one out', t => {
  useLayout(t, { port: [0, 25] });
  const app = start(list([]));
  const measured = [];
  const rect = k.window.Element.prototype.getBoundingClientRect;
  k.window.Element.prototype.getBoundingClientRect = function () {
    measured.push(this.getAttribute('data-top'));
    return rect.call(this);
  };
  go(app, list([0, 10, 20, 30, 40, 50, 60]));
  k.window.Element.prototype.getBoundingClientRect = rect;
  assert.deepEqual(statesOf(app), ['entered', 'entered', 'entered', null, null, null, null]);
  assert.deepEqual(measured.filter(Boolean), ['0', '10', '20', '30']);
});

test('the overscan after the kids in view comes in too', t => {
  useLayout(t, { port: [0, 25], css: { '--stagger-overscan': '2' } });
  const app = start(list([]));
  go(app, list([0, 10, 20, 30, 40, 50, 60]));
  assert.deepEqual(statesOf(app), ['entered', 'entered', 'entered', 'entered', 'entered', null, null]);
  assert.deepEqual(delaysOf(app).slice(0, 5), ['0ms', '150ms', '300ms', '450ms', '600ms']); // the count is of the kids that take part
});

test('the overscan before the kids in view comes in too', t => {
  useLayout(t, { port: [40, 65], css: { '--stagger-overscan': '2' } });
  const app = start(list([]));
  go(app, list([0, 10, 20, 30, 40, 50, 60]));
  assert.deepEqual(statesOf(app), [null, null, 'entered', 'entered', 'entered', 'entered', 'entered']);
});

test('kids that all arrive out of view stay still', t => {
  useLayout(t, { port: [0, 25] });
  const app = start(list([]));
  go(app, list([100, 110, 120]));
  assert.deepEqual(statesOf(app), [null, null, null]);
});

test('a page that starts right after what is in view takes the overscan', t => {
  useLayout(t, { port: [0, 25], css: { '--stagger-overscan': '2' } });
  const app = start(list([0, 10, 20]));
  go(app, list([0, 10, 20, 30, 40, 50, 60]));
  assert.deepEqual(statesOf(app), [null, null, null, 'entered', 'entered', null, null]);
});

test('a page that ends right before what is in view takes the overscan', t => {
  useLayout(t, { port: [40, 65], css: { '--stagger-overscan': '2' } });
  const app = start(list([40, 50, 60]));
  go(app, list([0, 10, 20, 30, 40, 50, 60]));
  assert.deepEqual(statesOf(app), [null, null, 'entered', 'entered', null, null, null]);
});


// A ROW

test('in a row that scrolls sideways, the kids in view and the overscan come in', t => {
  useLayout(t, { portX: [0, 100], css: { '--stagger-overscan': '1' } });
  const app = start(row([]));
  go(app, row([0, 40, 80, 120, 160, 200]));
  assert.deepEqual(statesOf(app), ['entered', 'entered', 'entered', 'entered', null, null]);
});

test('a page of a row that starts right after what is in view takes the overscan', t => {
  useLayout(t, { portX: [0, 100], css: { '--stagger-overscan': '2' } });
  const app = start(row([0, 40, 80]));
  go(app, row([0, 40, 80, 120, 160, 200]));
  assert.deepEqual(statesOf(app), [null, null, null, 'entered', 'entered', null]);
});


// THE SPACING

test('the easing of the node spreads the delays', t => {
  useLayout(t, { css: { '--stagger-easing': 'cubic-bezier(0, 0, 0.58, 1)' } });
  const app = start(list([]));
  go(app, list([0, 10, 20, 30, 40]));
  const delays = delaysOf(app).map(parseFloat);
  assert.equal(delays[0], 0);
  assert.equal(delays[4], 600);
  assert.ok(delays[2] > 300, 'ease-out is ahead of linear in the middle');
  assert.ok(delays.every((delay, i) => i === 0 || delay > delays[i - 1]));
});

test('keywords work as easings', t => {
  useLayout(t, { css: { '--stagger-easing': 'ease-in' } });
  const app = start(list([]));
  go(app, list([0, 10, 20]));
  assert.ok(parseFloat(delaysOf(app)[1]) < 300, 'ease-in is behind linear in the middle');
});

test('a span in seconds works', t => {
  useLayout(t, { css: { '--stagger-span': ' 0.5s' } });
  const app = start(list([]));
  go(app, list([0, 10]));
  assert.deepEqual(delaysOf(app), ['0ms', '500ms']);
});

test('a few kids spread over their steps, not the whole span', t => {
  useLayout(t, { css: { '--stagger-step': '70ms' } });
  const app = start(list([]));
  go(app, list([0, 10, 20]));
  assert.deepEqual(delaysOf(app), ['0ms', '70ms', '140ms']);
});

test('a lone kid has no delay even with a step', t => {
  useLayout(t, { css: { '--stagger-step': '70ms' } });
  const app = start(list([]));
  go(app, list([0]));
  assert.deepEqual(delaysOf(app), ['0ms']);
});

test('five kids with a 70ms step spread over four gaps', t => {
  useLayout(t, { css: { '--stagger-step': '70ms' } });
  const app = start(list([]));
  go(app, list([0, 10, 20, 30, 40]));
  assert.deepEqual(delaysOf(app), ['0ms', '70ms', '140ms', '210ms', '280ms']);
});

test('with a step of 200ms the span still caps the spread', t => {
  useLayout(t, { css: { '--stagger-step': '200ms' } });
  const app = start(list([]));
  go(app, list([0, 10, 20, 30, 40]));
  assert.deepEqual(delaysOf(app), ['0ms', '150ms', '300ms', '450ms', '600ms']);
});

test('an easing nobody understands is linear', t => {
  useLayout(t, { css: { '--stagger-easing': 'steps(4)' } });
  const app = start(list([]));
  go(app, list([0, 10, 20]));
  assert.deepEqual(delaysOf(app), ['0ms', '300ms', '600ms']);
});


// LEAVING NOTHING BEHIND

test('the kids lose what they were given when the last transition has ended', t => {
  const tick = useLayout(t);
  const app = start(list([]));
  go(app, list([0, 10]));
  tick(399);
  assert.deepEqual(statesOf(app), ['entered', 'entered']);
  tick(1);
  assert.deepEqual(statesOf(app), [null, null]);
  assert.deepEqual(delaysOf(app), ['', '']);
});

test('with no transition to wait for, they lose it at once', t => {
  useLayout(t, { transition: '0s' });
  const app = start(list([]));
  go(app, list([0, 10]));
  assert.deepEqual(statesOf(app), [null, null]);
});
