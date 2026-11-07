// The tuner replays a list's entrance the way the kernel runs it: the same kids, with the same delays. Each test lets
// the real kernel stagger a list that arrives whole, and then the tuner replay it, in the jsdom of the kernel's tests,
// with what is in view and what the CSS says stubbed as there: a kid's place is its data-top or data-left.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { load } from '../../../packages/elm/virtual-dom/tests/kernel.js'

const k = load()
const panel = loadTuner()


// THE SAME KIDS, WITH THE SAME DELAYS

test('a replay staggers the kids in view, as the kernel does', t => {
  assertSameAsKernel(t, { tops: [0, 10, 20, 30, 40] })
})

test('a replay spreads them with the easing of the list', t => {
  assertSameAsKernel(t, { tops: [0, 10, 20, 30, 40, 50], css: { '--stagger-easing': 'cubic-bezier(0.4, 0, 1, 0.56)' }, port: [0, 70] })
})

test('a replay spreads a few kids over their steps', t => {
  assertSameAsKernel(t, { tops: [0, 10, 20], css: { '--stagger-step': '70ms', '--stagger-easing': 'ease-out' } })
})

test('a replay takes the overscan past what is in view', t => {
  assertSameAsKernel(t, { tops: [0, 10, 20, 30, 40, 50, 60], port: [0, 25], css: { '--stagger-overscan': '2' } })
})

test('a replay takes the overscan before what is in view', t => {
  assertSameAsKernel(t, { tops: [0, 10, 20, 30, 40, 50, 60], port: [40, 65], css: { '--stagger-overscan': '2' } })
})

test('a replay of a row that scrolls sideways takes the kids in view', t => {
  assertSameAsKernel(t, { lefts: [0, 40, 80, 120, 160, 200], css: { '--stagger-overscan': '1', '--stagger-span': '1.2s' } })
})

test('a replay of a list out of view staggers nothing, as the kernel does', t => {
  assertSameAsKernel(t, { tops: [100, 110, 120], port: [0, 25] })
})

function assertSameAsKernel(t, layout) {
  useLayout(t, layout)
  const app = start({ tops: layout.tops && [], lefts: layout.lefts && [] }) // what a patch adds is all the kernel staggers
  go(app, layout)
  const kernel = { states: statesOf(app), delays: delaysOf(app) }
  t.mock.timers.tick(10000)
  assert.deepEqual(statesOf(app), app.kids.map(() => null), 'the kernel is done before the replay')

  const tuner = panel.connect()
  tuner.send({ type: 'play', id: idOf(tuner), loop: false, kids: null, pause: 0, speed: 1 })
  assert.deepEqual({ states: statesOf(app), delays: delaysOf(app) }, kernel)
  assert.deepEqual(tuner.lastRun().delays, kernel.delays.filter(Boolean).map(parseFloat))
  tuner.close()
}


// WHAT A REPLAY LEAVES

test('a replay leaves nothing behind once its last transition has ended', t => {
  const layout = { tops: [0, 10, 20] }
  useLayout(t, layout)
  const app = start(layout)
  const tuner = panel.connect()
  tuner.send({ type: 'play', id: idOf(tuner), loop: false, kids: null, pause: 0, speed: 1 })
  t.mock.timers.tick(999) // 600ms of span and 400ms of transition
  assert.deepEqual(statesOf(app), ['entered', 'entered', 'entered'])
  t.mock.timers.tick(1)
  assert.deepEqual(statesOf(app), [null, null, null])
  assert.deepEqual(delaysOf(app), ['', '', ''])
  tuner.close()
})

test('a loop begins again after the pause', t => {
  const layout = { tops: [0, 10] }
  useLayout(t, layout)
  const app = start(layout)
  const tuner = panel.connect()
  tuner.send({ type: 'play', id: idOf(tuner), loop: true, kids: null, pause: 300, speed: 1 })
  t.mock.timers.tick(1000)
  assert.deepEqual(statesOf(app), [null, null])
  t.mock.timers.tick(300)
  assert.deepEqual(statesOf(app), ['entered', 'entered'])
  assert.equal(tuner.runs().length, 2)
  tuner.close()
})

test('a replay can take fewer kids, which spread over fewer steps', t => {
  const layout = { tops: [0, 10, 20, 30, 40], css: { '--stagger-step': '70ms' } }
  useLayout(t, layout)
  const app = start(layout)
  const tuner = panel.connect()
  tuner.send({ type: 'play', id: idOf(tuner), loop: false, kids: 2, pause: 0, speed: 1 })
  assert.deepEqual(statesOf(app), ['entered', 'entered', null, null, null])
  assert.deepEqual(delaysOf(app).slice(0, 2), ['0ms', '70ms'])
  assert.equal(tuner.lastRun().whole, 5)
  tuner.close()
})

test('when the panel lets go, the replay ends and what was tuned goes', t => {
  const layout = { tops: [0, 10] }
  useLayout(t, layout)
  const app = start(layout)
  const tuner = panel.connect()
  tuner.send({ type: 'tune', name: 'slideUpFade', overrides: { span: 1200 } })
  tuner.send({ type: 'play', id: idOf(tuner), loop: true, kids: null, pause: 0, speed: 1 })
  assert.match(tunedCss(), /\[ef-stagger="slideUpFade"\] \{ --stagger-span: 1200ms !important; \}/)
  tuner.close()
  assert.deepEqual(statesOf(app), [null, null])
  assert.equal(tunedCss(), null)
})


// WHAT IS TUNED

test('what is tuned is laid over the page with its own selectors, motion on entered only', t => {
  useLayout(t, { tops: [] })
  const tuner = panel.connect()
  tuner.send({ type: 'tune', name: 'slideUpFade', overrides: { easing: [0.2, 0.7, 0.3, 1], duration: 900, timing: [0.2, 0.8, 0.2, 1], pose: 'opacity: 0' } })
  assert.equal(tunedCss(), [
    '[ef-stagger="slideUpFade"] { --stagger-easing: cubic-bezier(0.2, 0.7, 0.3, 1) !important; }',
    '[ef-stagger="slideUpFade"] > [stagger-state="entered"] { transition-duration: 900ms !important; transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1) !important; }',
    '[ef-stagger="slideUpFade"] > [stagger-state="init"] { opacity: 0 !important; }',
  ].join('\n'))
  tuner.send({ type: 'tune', name: 'slideUpFade', overrides: {} })
  assert.equal(tunedCss(), '')
  tuner.close()
})

test('a start pose that leaves out what the page has unsets it', t => {
  useLayout(t, { tops: [] })
  const style = k.document.createElement('style')
  style.textContent = '[ef-stagger="slideUpFade"] > [stagger-state="init"] { opacity: 0; transform: translateY(20%); transition: none; }'
  k.document.head.append(style)
  t.after(() => style.remove())
  const tuner = panel.connect()
  tuner.send({ type: 'tune', name: 'slideUpFade', overrides: { pose: 'opacity: 0.5' } })
  assert.match(tunedCss(), /> \[stagger-state="init"\] \{ opacity: 0.5 !important; transform: unset !important; \}/)
  tuner.close()
})


// RUNS OF THE KERNEL

test('a run of the kernel is reported with its delays', async t => {
  const layout = { tops: [0, 10, 20] }
  useLayout(t, layout)
  const app = start({ tops: [] })
  const tuner = panel.connect()
  go(app, layout)
  await new Promise(setImmediate) // the observer hears of it after the patch
  assert.deepEqual(tuner.lastRun(), { type: 'run', id: idOf(tuner), by: 'kernel', whole: 3, delays: [0, 300, 600], motions: [400, 400, 400], speed: 1 })
  tuner.close()
})


// THE LIST

test('the lists of the page are listed, by the name of their block', t => {
  const layout = { tops: [0, 10] }
  useLayout(t, layout)
  start(layout)
  const tuner = panel.connect()
  const [list] = tuner.messages().find(message => message.type === 'lists').lists
  assert.deepEqual({ name: list.name, kids: list.kids, where: list.where }, { name: 'slideUpFade', kids: 2, where: 'in view' })
  tuner.close()
})

test('the motion of a block is read while its list has no kids yet, as while its first page loads', t => {
  useLayout(t)
  start({ tops: [] })
  const tuner = panel.connect()
  tuner.send({ type: 'read', id: idOf(tuner) })
  const { values } = tuner.messages().find(message => message.type === 'page')
  assert.deepEqual(values.motion, { properties: ['transform', 'opacity'], durations: [400], timings: ['cubic-bezier(0.2, 0.8, 0.33, 1)'] })
  tuner.close()
})

test('reading the page leaves the list and its kids alone, as a list may fetch a page when they change', async t => {
  useLayout(t)
  const app = start({ tops: [0, 10] })
  const changes = []
  const watcher = new k.window.MutationObserver(records => changes.push(...records))
  watcher.observe(app.dom, { subtree: true, childList: true, attributes: true })
  const tuner = panel.connect()
  tuner.send({ type: 'read', id: idOf(tuner) })
  await new Promise(setImmediate)
  watcher.disconnect()
  assert.deepEqual(changes, [])
  tuner.close()
})

test('the page is read under what is tuned', t => {
  const layout = { tops: [0, 10], css: { '--stagger-span': '1.6s', '--stagger-step': '70ms', '--stagger-easing': 'ease-out', '--stagger-overscan': '3' } }
  useLayout(t, layout)
  start(layout)
  const tuner = panel.connect()
  tuner.send({ type: 'read', id: idOf(tuner) })
  const { values, runSize } = tuner.messages().find(message => message.type === 'page')
  assert.deepEqual({ span: values.span, step: values.step, easing: values.easing, overscan: values.overscan, runSize },
    { span: 1600, step: 70, easing: { text: 'ease-out', curve: [0, 0, 0.58, 1] }, overscan: 3, runSize: 2 })
  tuner.close()
})


// THE TUNER, IN THE KERNEL'S JSDOM

function loadTuner() {
  const source = ['stagger.js', 'content.js'].map(file => fs.readFileSync(path.join(import.meta.dirname, '..', file), 'utf8')).join(';\n') // two scripts in the page
  const listeners = []
  const chrome = { runtime: { onConnect: { addListener: listener => listeners.push(listener), removeListener: () => {} } } }
  new Function('window', 'document', 'chrome', source)(k.window, k.document, chrome)

  return { connect }

  function connect() { // a panel, as content.js sees one
    const sent = []
    const handlers = { message: [], disconnect: [] }
    const port = {
      name: 'stagger-tuner',
      postMessage: message => sent.push(JSON.parse(JSON.stringify(message))),
      onMessage: { addListener: handler => handlers.message.push(handler) },
      onDisconnect: { addListener: handler => handlers.disconnect.push(handler) },
      disconnect: () => {},
    }
    listeners.forEach(listener => listener(port))
    return {
      send: message => handlers.message.forEach(handler => handler(message)),
      close: () => handlers.disconnect.forEach(handler => handler()),
      messages: () => sent,
      runs: () => sent.filter(message => message.type === 'run'),
      lastRun: () => sent.filter(message => message.type === 'run').at(-1),
    }
  }
}

function idOf(tuner) {
  return tuner.messages().find(message => message.type === 'lists').lists[0].id
}

function tunedCss() {
  return k.document.querySelector('style[data-stagger-tuner]')?.textContent ?? null
}


// A LIST TO STAGGER, AND A LAYOUT TO MEASURE IT BY

const SIZE = 10
const MOTION = { 'transition-property': 'transform, opacity', 'transition-duration': '0.4s', 'transition-timing-function': 'cubic-bezier(0.2, 0.8, 0.33, 1)' } // of [ef-stagger] > [stagger-state]

function start({ tops, lefts }) {
  const view = toView({ tops, lefts })
  const dom = k.render(view)
  k.document.body.replaceChildren(dom)
  return { view, dom, kids: (tops ?? lefts).map(() => null) }
}

function go(app, { tops, lefts }) {
  const view = toView({ tops, lefts })
  app.dom = k.applyPatches(app.dom, app.view, k.diff(app.view, view))
  app.view = view
  app.kids = [...app.dom.childNodes]
}

function toView({ tops, lefts }) {
  const kids = tops ? tops.map(top => [String(top), k.node('li', [k.attr('data-top', String(top))])])
    : lefts.map(left => [String(left), k.node('li', [k.attr('data-left', String(left))])])
  return k.keyed('ul', [k.attr('data-port', ''), k.attr('ef-stagger', 'slideUpFade')], kids)
}

const statesOf = app => [...app.dom.childNodes].map(kid => kid.getAttribute('stagger-state'))
const delaysOf = app => [...app.dom.childNodes].map(kid => kid.style.getPropertyValue('--stagger-delay'))

function useLayout(t, { css = {}, port = [0, 50], portX = [0, 100] } = {}) {
  const defaults = { '--stagger-span': '600ms', '--stagger-easing': 'linear', '--stagger-overscan': '0' }
  const proto = k.window.Element.prototype
  const original = { getComputedStyle: k.window.getComputedStyle, getBoundingClientRect: proto.getBoundingClientRect }

  k.window.getComputedStyle = element => ({
    getPropertyValue: name => element.hasAttribute('data-port') ? { ...defaults, ...css, 'overflow-x': 'visible', 'overflow-y': 'auto' }[name] ?? ''
      : element.hasAttribute('stagger-state') ? { ...MOTION, 'transition-delay': `${(parseFloat(element.style.getPropertyValue('--stagger-delay')) || 0) / 1000}s` }[name] ?? '' // as var(--stagger-delay) computes
      : { 'transition-property': 'all', 'transition-duration': '0s', 'transition-timing-function': 'ease', 'transition-delay': '0s' }[name] ?? '', // a kid at rest
  })
  proto.getBoundingClientRect = function () {
    if (this.hasAttribute('data-port')) return { top: port[0], bottom: port[1], left: portX[0], right: portX[1], width: portX[1] - portX[0], height: port[1] - port[0] }
    const top = Number(this.getAttribute('data-top'))
    const left = Number(this.getAttribute('data-left'))
    return { top, bottom: top + SIZE, left, right: left + SIZE, width: SIZE, height: SIZE }
  }
  t.mock.timers.enable({ apis: ['setTimeout'] })

  t.after(() => {
    k.window.getComputedStyle = original.getComputedStyle
    proto.getBoundingClientRect = original.getBoundingClientRect
    k.document.body.replaceChildren()
  })
}
