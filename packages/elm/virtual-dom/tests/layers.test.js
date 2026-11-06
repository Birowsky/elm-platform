// Tests for keyedLayers, on the real kernel code. jsdom runs no CSS, so anything that
// depends on a transition really running is in e2e/browser/layers.spec.js.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./kernel.js');

const k = load();


// VIEWS

const RESTING = k.attr('transition-state', 'entering');
const SLOW = k.attr('style', 'transition-duration: 0.4s; transition-delay: 0s'); // jsdom has no default for the delay, as browsers do
const history = value => k.attr('history', value);

// a layer that transitions for 400ms
const layer = (kids = [], attrs = []) => k.node('section', [RESTING, SLOW, ...attrs], kids);
const stack = (kids, attrs = []) => k.keyedLayers('view-stack', ['history'], attrs, kids);


// TRANSITIONS

function start(view) {
  const dom = k.render(view);
  k.document.body.replaceChildren(dom); // outside the document, nothing has a computed style
  return { view, dom };
}

function go(app, view) {
  app.dom = k.applyPatches(app.dom, app.view, k.diff(app.view, view));
  app.view = view;
}

const kidsOf = app => [...app.dom.childNodes];
const stateOf = element => element.getAttribute('transition-state');
const isExiting = kid => !!kid.elm_exit;

function useClock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return ms => t.mock.timers.tick(ms);
}


// ENTERING

test('a first render starts no transition', () => {
  const app = start(stack([['a', layer()]]));
  assert.equal(stateOf(kidsOf(app)[0]), 'entering');
});

test('a new layer has its style computed in init, once, and then rests in entering', t => {
  useClock(t);
  const app = start(stack([]));
  const seen = [];
  const original = k.window.getComputedStyle;
  k.window.getComputedStyle = element => ({ getPropertyValue: () => { seen.push(stateOf(element)); return ''; } }); // a method, so this fails if a minifier could drop the read
  go(app, stack([['a', layer()], ['b', layer()]]));
  k.window.getComputedStyle = original;
  assert.deepEqual(seen, ['init']);
  assert.deepEqual(kidsOf(app).map(stateOf), ['entering', 'entering']);
});


// EXITING

test('a dropped layer stays until its transition has ended', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer()], ['b', layer()]]));
  const [a] = kidsOf(app);
  go(app, stack([['b', layer()]]));
  assert.equal(stateOf(a), 'exiting');
  tick(399);
  assert.equal(a.parentNode, app.dom);
  tick(1);
  assert.equal(a.parentNode, null);
});

test('the longest transition counts, with its delay', t => {
  const tick = useClock(t);
  const duration = k.attr('style', 'transition-duration: 0.1s, 0.3s; transition-delay: 0s, 0.1s');
  const app = start(stack([['a', k.node('section', [RESTING, duration])]]));
  const [a] = kidsOf(app);
  go(app, stack([]));
  tick(399);
  assert.equal(a.parentNode, app.dom);
  tick(1);
  assert.equal(a.parentNode, null);
});

test('a layer without transition-state leaves at once, even with a transition of its own', () => {
  const app = start(stack([['a', k.node('section', [SLOW])]]));
  const [a] = kidsOf(app);
  go(app, stack([]));
  assert.equal(a.parentNode, null);
  assert.equal(a.hasAttribute('transition-state'), false);
});

test('a layer with no transition to wait for leaves at once', () => {
  const app = start(stack([['a', k.node('section', [RESTING])]]));
  const [a] = kidsOf(app);
  go(app, stack([]));
  assert.equal(a.parentNode, null);
});

test('a text kid is no problem', () => {
  const app = start(stack([['t', k.text('hi')], ['a', layer()]]));
  go(app, stack([['a', layer([k.text('x')])]]));
  assert.equal(app.dom.textContent, 'x');
});

test('patches reach the right layers while the one before them is exiting', t => {
  useClock(t);
  const app = start(stack([['a', layer([k.text('a')])], ['b', layer([k.text('b')])], ['c', layer([k.text('c')])]]));
  const [a, b, c] = kidsOf(app);
  go(app, stack([['b', layer([k.text('b')])], ['c', layer([k.text('c')])]]));
  go(app, stack([['b', layer([k.text('b2')])], ['c', layer([k.text('c2')])]]));
  assert.deepEqual([a, b, c].map(kid => kid.textContent), ['a', 'b2', 'c2']);
});

test('a new layer goes below the exiting ones it would land on', t => {
  useClock(t);
  const app = start(stack([['bg', layer()], ['a', layer()], ['b', layer()], ['top', layer()]]));
  const [bg, a, b, top] = kidsOf(app);
  go(app, stack([['bg', layer()], ['n', layer()], ['top', layer()]]));
  const n = kidsOf(app)[1];
  assert.deepEqual(kidsOf(app), [bg, n, a, b, top]);
});

test('a new layer at the end of the list goes above what is exiting', t => {
  useClock(t);
  const app = start(stack([['bg', layer()], ['a', layer()]]));
  const [bg, a] = kidsOf(app);
  go(app, stack([['bg', layer()], ['n', layer()]]));
  const n = kidsOf(app)[2];
  assert.deepEqual(kidsOf(app), [bg, a, n]);
});

test('reordering live layers leaves their state alone', t => {
  useClock(t);
  const app = start(stack([['a', layer()], ['b', layer()]]));
  const [a, b] = kidsOf(app);
  const observer = new k.window.MutationObserver(() => {});
  observer.observe(app.dom, { attributes: true, subtree: true, attributeFilter: ['transition-state'] });
  go(app, stack([['b', layer()], ['a', layer()]]));
  assert.deepEqual(kidsOf(app), [b, a]);
  assert.deepEqual(observer.takeRecords(), []);
  observer.disconnect();
});


// COMING BACK

test('coming back gives the same element, unmoved, diffed to the new view', t => {
  const tick = useClock(t);
  const app = start(stack([
    ['bg', layer()],
    ['a', layer([k.text('old'), k.node('i', [k.attr('data-old', '1')])])],
    ['top', layer()],
  ]));
  const a = kidsOf(app)[1];
  const italic = a.childNodes[1];
  go(app, stack([['bg', layer()], ['top', layer()]]));
  tick(100);

  const inserted = [];
  const original = k.window.Node.prototype.insertBefore;
  k.window.Node.prototype.insertBefore = function (node, before) { inserted.push(node); return original.call(this, node, before); };
  go(app, stack([
    ['bg', layer()],
    ['a', layer([k.text('new'), k.node('i', [k.attr('data-new', '1')]), k.node('b')], [k.attr('data-back', 'yes')])],
    ['top', layer()],
  ]));
  k.window.Node.prototype.insertBefore = original;

  assert.equal(kidsOf(app)[1], a);
  assert.equal(kidsOf(app).length, 3);
  assert.ok(!inserted.includes(a), 'never detached');
  assert.equal(stateOf(a), 'entering');
  assert.equal(a.getAttribute('data-back'), 'yes');
  assert.equal(a.childNodes[0].textContent, 'new');
  assert.equal(a.childNodes[1], italic, 'kids are patched, not rebuilt');
  assert.equal(italic.hasAttribute('data-old'), false);
  assert.equal(italic.getAttribute('data-new'), '1');
  assert.equal(a.childNodes[2].tagName, 'B');
  tick(10000);
  assert.equal(a.parentNode, app.dom, 'the exit it cancelled must not remove it');
});

test('coming back and leaving again, over and over', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer([k.text('1')])]]));
  const [a] = kidsOf(app);
  go(app, stack([]));
  tick(100);
  go(app, stack([['a', layer([k.text('2')])]]));
  tick(100);
  go(app, stack([]));
  tick(100);
  go(app, stack([['a', layer([k.text('3')])]]));
  tick(1000);
  assert.equal(kidsOf(app)[0], a);
  assert.equal(a.textContent, '3');
  go(app, stack([]));
  tick(399);
  assert.equal(a.parentNode, app.dom);
  tick(1);
  assert.equal(a.parentNode, null);
});

test('once the exit has ended, the key gets a new element', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer()]]));
  const [a] = kidsOf(app);
  go(app, stack([]));
  tick(400);
  go(app, stack([['a', layer()]]));
  assert.notEqual(kidsOf(app)[0], a);
  assert.equal(stateOf(kidsOf(app)[0]), 'entering');
});

test('coming back works through lazy and Html.map at the root of the layer', t => {
  const tick = useClock(t);
  const content = text => layer([k.text(text)]);
  const identity = x => x;
  const view = text => stack([['a', k.map(identity, k.lazy(content, text))]]);
  const app = start(view('1'));
  const [a] = kidsOf(app);
  go(app, stack([]));
  tick(100);
  go(app, view('2'));
  assert.equal(kidsOf(app)[0], a);
  assert.equal(a.textContent, '2');
  assert.equal(stateOf(a), 'entering');
});

test('coming back with another root element gives a new element in its place', t => {
  const tick = useClock(t);
  const app = start(stack([['bg', layer()], ['a', layer()], ['top', layer()]]));
  const a = kidsOf(app)[1];
  go(app, stack([['bg', layer()], ['top', layer()]]));
  tick(100);
  go(app, stack([['bg', layer()], ['a', k.node('article', [RESTING, SLOW])], ['top', layer()]]));
  assert.deepEqual(kidsOf(app).map(kid => kid.tagName), ['SECTION', 'ARTICLE', 'SECTION']);
  assert.equal(stateOf(kidsOf(app)[1]), 'entering');
  assert.equal(a.parentNode, null);
  tick(10000);
  assert.equal(kidsOf(app).length, 3);
});

test('coming back with a new root element under lazy gives a new element too', t => {
  const tick = useClock(t);
  const content = tag => k.node(tag, [RESTING, SLOW]);
  const app = start(stack([['bg', layer()], ['a', k.lazy(content, 'section')]]));
  const a = kidsOf(app)[1];
  go(app, stack([['bg', layer()]]));
  tick(100);
  go(app, stack([['bg', layer()], ['a', k.lazy(content, 'article')]]));
  assert.deepEqual(kidsOf(app).map(kid => kid.tagName), ['SECTION', 'ARTICLE']);
  assert.equal(a.parentNode, null);
});

test('coming back at another place in the stack goes there', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer()], ['b', layer()], ['c', layer()]]));
  const [a, b, c] = kidsOf(app);
  go(app, stack([['b', layer()], ['c', layer()]]));
  tick(100);
  go(app, stack([['b', layer()], ['c', layer()], ['a', layer()]]));
  assert.deepEqual(kidsOf(app), [b, c, a]);
  assert.equal(stateOf(a), 'entering');
  tick(10000);
  assert.deepEqual(kidsOf(app), [b, c, a]);
});

test('coming back past another exiting layer does not move it', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer()], ['b', layer()], ['c', layer()]]));
  const [a, b, c] = kidsOf(app);
  go(app, stack([['c', layer()]]));
  tick(100);
  go(app, stack([['a', layer()], ['c', layer()]]));
  assert.deepEqual(kidsOf(app), [a, b, c]);
  assert.deepEqual([a, b, c].map(isExiting), [false, true, false]);
});

test('nested stacks: what happened inside a layer that comes back is still there', t => {
  const tick = useClock(t);
  const inner = (...keys) => stack(keys.map(key => [key, layer([k.text(key)])]));
  const app = start(stack([['outer', layer([inner('x', 'y')])]]));
  const [outer] = kidsOf(app);
  const innerDom = outer.firstChild;
  const [x, y] = [...innerDom.childNodes];
  go(app, stack([['outer', layer([inner('y')])]]));
  assert.equal(stateOf(x), 'exiting');
  go(app, stack([]));
  tick(100);
  go(app, stack([['outer', layer([inner('x', 'y')])]]));
  assert.equal(kidsOf(app)[0], outer);
  assert.deepEqual([...innerDom.childNodes], [x, y]);
  assert.equal(stateOf(x), 'entering');
});


// FOLLOWED ATTRIBUTES

test('an exiting layer takes the attribute from the stack, and gets its own back on the way in', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer([], [history('back')])]], [history('back')]));
  const [a] = kidsOf(app);
  go(app, stack([], [history('forward')]));
  assert.equal(a.getAttribute('history'), 'forward');
  tick(100);
  go(app, stack([['a', layer([], [history('back')])]], [history('back')]));
  assert.equal(a.getAttribute('history'), 'back'); // no patch says so, as the two vnodes agree
});

test('a followed attribute the layer never had goes away again', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer()]], [history('back')]));
  const [a] = kidsOf(app);
  go(app, stack([], [history('back')]));
  assert.equal(a.getAttribute('history'), 'back');
  tick(100);
  go(app, stack([['a', layer()]], [history('back')]));
  assert.equal(a.hasAttribute('history'), false);
});

test('an attribute the stack does not have leaves the layer alone', t => {
  useClock(t);
  const app = start(stack([['a', layer([], [history('back')])]]));
  const [a] = kidsOf(app);
  go(app, stack([]));
  assert.equal(a.getAttribute('history'), 'back');
});


// ORDER

const order = value => k.attr('transition-order', String(value));
const ranked = value => layer([], [history('forward'), order(value)]);
const historyOf = element => element.getAttribute('history');

test('a layer of a higher order comes in forward, and pushes the one it replaces out the same way', t => {
  useClock(t);
  const app = start(stack([['10', ranked(10)]], [history('back')]));
  const [ten] = kidsOf(app);
  go(app, stack([['20', ranked(20)]], [history('back')]));
  const twenty = kidsOf(app).find(kid => !isExiting(kid));
  assert.equal(historyOf(twenty), 'forward');
  assert.equal(historyOf(ten), 'forward');
});

test('a layer of a lower order comes in back, and pushes the one it replaces out the same way', t => {
  useClock(t);
  const app = start(stack([['20', ranked(20)]]));
  const [twenty] = kidsOf(app);
  go(app, stack([['10', ranked(10)]]));
  const ten = kidsOf(app).find(kid => !isExiting(kid));
  assert.equal(historyOf(ten), 'back');
  assert.equal(historyOf(twenty), 'back');
});

test('the layer that left last is what an order is compared to', t => {
  const tick = useClock(t);
  const app = start(stack([['10', ranked(10)]]));
  go(app, stack([['30', ranked(30)]]));
  tick(100);
  go(app, stack([['20', ranked(20)]]));
  const live = kidsOf(app).filter(kid => !isExiting(kid));
  assert.equal(historyOf(live[0]), 'back');
});

test('equal orders, and layers with no order, keep the history they were given', t => {
  useClock(t);
  const app = start(stack([['a', ranked(5)], ['plain', layer([], [history('forward')])]], [history('back')]));
  go(app, stack([['b', layer([], [history('back'), order(5)])]], [history('back')]));
  const [b] = kidsOf(app).filter(kid => !isExiting(kid));
  assert.equal(historyOf(b), 'back');
  go(app, stack([['c', layer([], [history('back')])]], [history('back')]));
  const [c] = kidsOf(app).filter(kid => !isExiting(kid));
  assert.equal(historyOf(c), 'back');
});

test('a layer that comes back while it is still leaving is directed by the order too', t => {
  useClock(t);
  const app = start(stack([['10', ranked(10)]]));
  go(app, stack([['20', ranked(20)]]));
  go(app, stack([['10', ranked(10)]])); // 10 returns in the other direction, from where 20 left
  const ten = kidsOf(app).find(kid => !isExiting(kid) && kid.getAttribute('transition-order') === '10');
  assert.equal(historyOf(ten), 'back');
});


// SCROLL

const SCROLLS = k.attr('scrolling-context-selector', '.scroller');
const scrolling = () => stack([['a', layer([k.node('div', [k.attr('class', 'scroller')])], [SCROLLS])]]);

test('a new element gets the scroll position of the last one with its key', t => {
  const tick = useClock(t);
  const app = start(scrolling());
  const scroller = kidsOf(app)[0].querySelector('.scroller');
  scroller.scrollTop = 120;
  scroller.scrollLeft = 7;
  go(app, stack([]));
  tick(400);
  go(app, scrolling());
  const next = kidsOf(app)[0].querySelector('.scroller');
  assert.notEqual(next, scroller);
  tick(0);
  assert.equal(next.scrollTop, 120);
  assert.equal(next.scrollLeft, 7);
});

test('the selector can match the layer itself', t => {
  const tick = useClock(t);
  const view = () => stack([['a', layer([], [k.attr('scrolling-context-selector', 'section')])]]);
  const app = start(view());
  kidsOf(app)[0].scrollTop = 30;
  go(app, stack([]));
  tick(400);
  go(app, view());
  tick(0);
  assert.equal(kidsOf(app)[0].scrollTop, 30);
});

test('a layer without the selector leaves with nothing remembered', t => {
  const tick = useClock(t);
  const app = start(stack([['a', layer()]]));
  go(app, stack([]));
  tick(400);
  assert.equal(app.dom.elm_scrolls, undefined);
});


// WHAT IT IS TO EVERYTHING ELSE

test('it is a keyed node to everything that looks at the node', () => {
  assert.equal(stack([]).$, k.keyed('view-stack', [], []).$);
});

test('swapping it for a plain or keyed node of the same tag rebuilds, so neither gets the other kind of DOM', t => {
  useClock(t);
  const app = start(stack([['a', layer()]]));
  const steps = [k.keyed('view-stack', [], [['a', layer()]]), stack([['a', layer()]]), k.node('view-stack', [], [layer()]), stack([['a', layer()]])];
  steps.forEach(view => {
    const before = app.dom;
    go(app, view);
    assert.notEqual(app.dom, before);
    assert.equal(app.dom.childNodes.length, 1);
  });
});


// EVERYTHING AT ONCE

// a seeded generator, so that a failure can be replayed
function toRandom(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function randomContent(random, depth) {
  const roll = random();
  if (depth <= 0 || roll < 0.25) return k.text('t' + Math.floor(random() * 4));
  const count = Math.floor(random() * 4);
  const kids = () => Array.from({ length: count }, () => randomContent(random, depth - 1));
  const attrs = random() < 0.5 ? [k.attr('data-x', String(Math.floor(random() * 3)))] : [];
  if (roll < 0.5) return k.node(random() < 0.5 ? 'div' : 'span', attrs, kids());
  if (roll < 0.65) return k.keyed('ul', attrs, kids().map((kid, i) => ['k' + Math.floor(random() * 5) + '-' + i, kid]));
  if (roll < 0.8) return randomStack(random, depth - 1);
  const kid = randomContent(random, depth - 1);
  return roll < 0.9 ? k.map(x => x, kid) : k.lazy(x => x, kid);
}

function randomLayer(random, depth) {
  const attrs = [];
  if (random() < 0.85) {
    attrs.push(RESTING);
    if (random() < 0.85) attrs.push(k.attr('style', 'transition-delay: 0s; transition-duration: ' + (0.05 + random() * 0.4).toFixed(2) + 's'));
  }
  if (random() < 0.5) attrs.push(history(random() < 0.5 ? 'back' : 'forward'));
  const kids = Array.from({ length: Math.floor(random() * 3) }, () => randomContent(random, depth));
  const node = k.node(random() < 0.05 ? 'article' : 'section', attrs, kids);
  const wrap = random();
  return wrap < 0.1 ? k.map(x => x, node) : wrap < 0.2 ? k.lazy(x => x, node) : node;
}

function randomStack(random, depth) {
  const keys = ['a', 'b', 'c', 'd', 'e', 'f'].filter(() => random() < 0.5);
  keys.forEach((key, i) => {
    if (random() < 0.2) {
      const j = Math.floor(random() * keys.length);
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
  });
  const attrs = random() < 0.5 ? [history(random() < 0.5 ? 'back' : 'forward')] : [];
  return stack(keys.map(key => [key, randomLayer(random, depth)]), attrs);
}

// the DOM as the view knows it: what is exiting isn't there
function toVisible(node) {
  if (node.nodeType === 3) return node.data;
  const attrs = [...node.attributes].map(attr => attr.name + '=' + attr.value).sort().join(' ');
  return '<' + node.tagName + ' ' + attrs + '>' + [...node.childNodes].filter(kid => !isExiting(kid)).map(toVisible).join('') + '</>';
}

test('in random views, what is live equals a fresh render, and all that exits ends up gone', t => {
  const tick = useClock(t);
  let cameBack = 0;

  for (let seed = 1; seed <= 150; seed++) {
    const random = toRandom(seed);
    const app = start(randomStack(random, 2));

    for (let step = 0; step < 40; step++) {
      const exitingBefore = kidsOf(app).filter(isExiting);
      const view = randomStack(random, 2);
      go(app, view);
      assert.equal(toVisible(app.dom), toVisible(k.render(view)), `seed ${seed}, step ${step}`);
      cameBack += exitingBefore.filter(kid => kid.parentNode === app.dom && !isExiting(kid)).length;
      tick(Math.floor(random() * 250));
    }

    tick(100000);
    assert.equal(kidsOf(app).filter(isExiting).length, 0, `seed ${seed}`);
    assert.equal(toVisible(app.dom), toVisible(k.render(app.view)), `seed ${seed}`);
  }

  assert.ok(cameBack > 1000, `only ${cameBack} layers came back, so the run hardly tested that`);
});
