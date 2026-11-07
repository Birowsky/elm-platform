// The tuner's panel, beside the page. It lists the page's lists that stagger their entrance, loops the entrance of the one
// picked, and tunes its spread, its motion and its start pose while it plays. What is tuned lies over the page's CSS
// until the panel closes, and the block's CSS as tuned is at the bottom, to copy into the app's SCSS.

import { curveEditor } from './curve-editor.js'
import { poseEditor } from './pose-editor.js'
import { saveBlock } from './source-folder.js'
import { timeline } from './timeline.js'

const FIELDS = ['span', 'step', 'overscan', 'easing', 'duration', 'timing', 'pose']
const LINEAR = [0, 0, 1, 1]
const PRESETS = {
  'linear': [0, 0, 1, 1],
  'ease': [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  'in-quad': [0.11, 0, 0.5, 0],
  'in-cubic': [0.32, 0, 0.67, 0],
  'out-quad': [0.5, 1, 0.89, 1],
  'out-cubic': [0.33, 1, 0.68, 1],
  'out-quart': [0.25, 1, 0.5, 1],
  'out-quint': [0.22, 1, 0.36, 1],
  'out-expo': [0.16, 1, 0.3, 1],
  'in-out-cubic': [0.65, 0, 0.35, 1],
  'out-back': [0.34, 1.56, 0.64, 1],
}

const state = {
  status: { connected: false, reason: 'Connecting…' },
  lists: [],
  reducedMotion: false,
  chosen: null, // { id, name } of the list being tuned, with no id while the page has none by that name
  page: new Map(), // block name → the values of the page's own CSS
  edits: new Map(), // block name → the values tuned away from those
  runSize: 0, // the kids a replay of the chosen list takes, before any limit
  run: null, // the last run of the chosen list, as the page told it, and when it began here
  stale: false, // whether something was tuned since that run
  looping: false,
  kids: null, // how many kids a replay takes, or null for all of them
  pause: 600,
  speed: 1,
  tab: 'spread',
  saving: false,
  saved: null, // { name, text, pickAgain } of the last save, as its note tells it
}

const page = connectToPage(answer, showStatus)
const view = bindView()
let frame = 0 // of the playhead
let pointed = null // the id of the list the page shows a box over
let shownLists = '' // what the rows of the lists were built from

restorePreferences()
render()


// THE PAGE

/** The tab the panel sits beside, or the one in ?tab= for a panel opened as a page of its own. */
function connectToPage(onMessage, onStatus) {
  const pinned = Number(new URLSearchParams(location.search).get('tab')) || null
  const windowId = chrome.windows.getCurrent().then(({ id }) => id)
  let port = null
  let tabId = null

  pinned || chrome.tabs.onActivated.addListener(async activated => activated.windowId === await windowId && connect())
  chrome.tabs.onUpdated.addListener((updated, { status }) => updated === tabId && status === 'complete' && !port && connect()) // a reload took the page side with it
  connect()

  return { send, reconnect: connect }

  function send(message) {
    port?.postMessage(message)
  }

  async function connect() {
    const target = pinned ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id
    port?.disconnect()
    port = null
    tabId = target
    if (target === undefined) return onStatus({ connected: false, reason: 'There is no tab to tune.' })
    try {
      await chrome.scripting.executeScript({ target: { tabId: target, frameIds: [0] }, files: ['stagger.js', 'content.js'] })
    } catch (error) {
      return tabId === target && onStatus({ connected: false, reason: `This tab can't be tuned: ${error.message}` })
    }
    if (tabId !== target) return // another tab came to the front meanwhile
    const tab = await chrome.tabs.get(target)
    const own = chrome.tabs.connect(target, { name: 'stagger-tuner', frameId: 0 })
    port = own
    own.onMessage.addListener(onMessage)
    own.onDisconnect.addListener(() => {
      if (port !== own) return
      port = null
      onStatus({ connected: false, reason: 'The page is gone. Waiting for it to load…' })
    })
    onStatus({ connected: true, url: tab.url, title: tab.title })
  }
}

function answer(message) {
  const handlers = { lists: onLists, page: onPage, run: onRun, styles: onStyles }
  handlers[message.type]?.(message)
}

/** A new page side counts its lists afresh, and gets what was tuned again. */
function showStatus(status) {
  state.status = status
  if (status.connected) {
    state.lists = []
    state.chosen = state.chosen && { id: null, name: state.chosen.name }
    state.run = null
    pointed = null
    state.edits.forEach((_, name) => sendTune(name))
  }
  render()
}

/** The list being tuned stays, or one by its name takes its place, or else the first one in view is picked. */
function onLists({ lists, reducedMotion }) {
  const before = state.lists.find(list => list.id === state.chosen?.id)
  Object.assign(state, { lists, reducedMotion })
  const kept = lists.find(list => list.id === state.chosen?.id)
  const named = lists.filter(list => list.name === state.chosen?.name)
  const next = kept ?? named.find(list => list.where === 'in view') ?? named[0] ?? (state.chosen ? null : lists.find(list => list.where === 'in view') ?? lists[0])
  !kept && state.chosen && (state.chosen = { id: null, name: state.chosen.name })
  kept && before && kept.kids !== before.kids && page.send({ type: 'read', id: kept.id }) // the kids a replay takes, as a list fills
  next && next !== kept ? choose(next) : render()
}

function onPage({ id, name, values, runSize }) {
  state.page.set(name, values)
  const edits = state.edits.get(name) ?? {}
  const kept = Object.fromEntries(Object.entries(edits).filter(([field, value]) => !sameValue(value, pageValueOf(name, field)))) // the page caught up with these, as after pasting them in
  state.edits.set(name, kept)
  Object.keys(kept).length !== Object.keys(edits).length && sendTune(name)
  id === state.chosen?.id && (state.runSize = runSize)
  render()
}

function onRun(run) {
  if (run.id !== state.chosen?.id) return
  state.run = { ...run, startedAt: performance.now() }
  state.stale = false
  run.by === 'tuner' && (state.runSize = run.whole)
  render()
}

function onStyles() {
  state.chosen?.id && page.send({ type: 'read', id: state.chosen.id })
}

function choose(list) {
  page.send({ type: 'stop' })
  state.chosen = { id: list.id, name: list.name }
  state.run = null
  state.runSize = list.kids
  page.send({ type: 'read', id: list.id })
  state.looping && replay()
  render()
}

function replay() {
  state.chosen?.id && page.send({ type: 'play', id: state.chosen.id, loop: state.looping, kids: state.kids, pause: state.pause, speed: state.speed })
}

function sendTune(name) {
  page.send({ type: 'tune', name, overrides: state.edits.get(name) ?? {} })
}

function pointAt(id) {
  id !== pointed && page.send({ type: 'point', id })
  pointed = id
}


// TUNING

function edit(field, value, committed) {
  const name = state.chosen?.name
  if (!name || !state.page.has(name)) return
  const edits = { ...state.edits.get(name) }
  sameValue(value, pageValueOf(name, field)) ? delete edits[field] : (edits[field] = value)
  state.edits.set(name, edits)
  state.stale = true
  sendTune(name)
  render()
  committed && replay()
}

/** Into the app's own stylesheet. The dev server serves it again, so the page catches up, and what was tuned is the page's. */
async function save(pickAgain) {
  const name = state.chosen?.name
  if (!name || state.saving) return
  state.saving = true
  render()
  const outcome = await saveBlock({ origin: new URL(state.status.url).origin, name, changes: toSavedChanges(name), pickAgain })
    .catch(error => ({ problem: error.message }))
  state.saving = false
  state.saved = outcome.cancelled ? state.saved : { name, text: outcome.saved ? `Saved to ${outcome.saved}.` : outcome.problem, pickAgain: Boolean(outcome.pickAgain) }
  render()
}

/** What is tuned, as the CSS box writes it, and of the start pose only the declarations that changed. */
function toSavedChanges(name) {
  const edits = state.edits.get(name) ?? {}
  const values = valuesOf(name)
  const tuned = (field, property, value) => Object.hasOwn(edits, field) ? [[property, value]] : []
  return {
    block: Object.fromEntries([
      ...tuned('span', '--stagger-span', `${values.span}ms`),
      ...tuned('step', '--stagger-step', `${values.step}ms`),
      ...tuned('easing', '--stagger-easing', toCurveName(values.easing)),
      ...tuned('overscan', '--stagger-overscan', String(values.overscan)),
    ]),
    motion: Object.fromEntries([
      ...tuned('timing', 'transition-timing-function', toCurveName(values.timing)),
      ...tuned('duration', 'transition-duration', `${values.duration}ms`),
    ]),
    pose: Object.hasOwn(edits, 'pose') ? toPoseChanges(pageValueOf(name, 'pose'), values.pose) : {},
  }

  function toPoseChanges(page, pose) {
    const before = toEntries(page)
    const after = toEntries(pose)
    return Object.fromEntries([
      ...Object.entries(after).filter(([property, value]) => before[property] !== value),
      ...Object.keys(before).filter(property => !Object.hasOwn(after, property)).map(property => [property, null]),
    ])
  }

  function toEntries(text) {
    return Object.fromEntries(toDeclarations(text).map(declaration => [declaration.slice(0, declaration.indexOf(':')).trim(), declaration.slice(declaration.indexOf(':') + 1).trim()]))
  }
}

function valuesOf(name) {
  const edits = state.edits.get(name) ?? {}
  return Object.fromEntries(FIELDS.map(field => [field, Object.hasOwn(edits, field) ? edits[field] : pageValueOf(name, field)]))
}

/**
 * Motion is one duration and one curve, the longest and the first of what the page has, since tuning gives every property the same.
 * A curve the editor can't draw, like steps(), starts it from linear, which is also how the kernel reads an easing it doesn't understand.
 * The notes and the CSS say what the page itself has.
 */
function pageValueOf(name, field) {
  const { span, step, overscan, easing, motion, pose } = state.page.get(name)
  return {
    span,
    step,
    overscan,
    easing: easing.curve ?? LINEAR,
    duration: Math.max(0, ...motion.durations),
    timing: Stagger.toCurve(motion.timings[0] ?? '') ?? LINEAR,
    pose: pose.text,
  }[field]
}

function sameValue(a, b) {
  return Array.isArray(a) ? a.every((number, i) => Math.abs(number - b[i]) < 1e-6)
    : typeof a === 'string' ? toDeclarations(a).join('; ') === toDeclarations(b).join('; ')
    : a === b
}

/** The run on the timeline: the last one the page played, or what one would be like with what is tuned since. */
function shownRun(values) {
  if (state.run && !state.stale) return state.run
  const count = state.kids ? Math.min(state.kids, state.runSize) : state.runSize
  return { by: 'preview', delays: Stagger.toDelays(count, values.span, values.step, Stagger.toEasing(values.easing)), motions: Array(count).fill(values.duration) }
}


// DRAWING

function render() {
  renderTop()
  renderLists()
  renderTuner()
  animate()
}

function renderTop() {
  const { connected, reason, url, title } = state.status
  view.status.replaceChildren(...connected ? [h('span', { class: 'host' }, toHost(url)), title ? ` ${title}` : ''] : [reason ?? '', ' ', h('button', { class: 'retry' }, 'Retry')])
  view.status.classList.toggle('error', !connected)
  view.reducedMotion.hidden = !state.reducedMotion
  view.loop.setAttribute('aria-pressed', String(state.looping))
  view.loop.querySelector('span').textContent = state.looping ? 'Looping' : 'Loop'
  view.loop.disabled = view.once.disabled = !state.chosen?.id
  view.speed.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === state.speed)))

  function toHost(url) {
    try { return new URL(url).host || url } catch { return url ?? '' }
  }
}

/** Built again only when they change, so that the pointer stays over the same row. */
function renderLists() {
  const tuned = new Set([...state.edits].filter(([, edits]) => Object.keys(edits).length > 0).map(([name]) => name))
  const key = JSON.stringify([state.lists, state.chosen, [...tuned]])
  view.noLists.hidden = !state.status.connected || state.lists.length > 0 || Boolean(state.chosen) // which has a note of its own
  if (key === shownLists) return
  shownLists = key
  view.lists.replaceChildren(...state.lists.map(list => {
    const chosen = list.id === state.chosen?.id
    return h('li', { class: chosen ? 'list chosen' : 'list', 'data-id': list.id },
      h('button', { class: 'pick', 'aria-current': chosen ? 'true' : false, title: 'Tune this list' },
        h('span', { class: 'name' }, list.name),
        h('span', { class: 'label' }, list.label),
        h('span', { class: 'meta' },
          h('span', { class: `where ${list.where.replace(/ /g, '-')}` }, list.where),
          ` · ${list.kids} ${list.kids === 1 ? 'kid' : 'kids'}`,
          tuned.has(list.name) ? h('span', { class: 'tuned' }, ' · tuned') : null)),
      h('button', { class: 'reveal', title: 'Scroll the page to it' }, '⌖'))
  }))
  state.chosen && !state.chosen.id && view.lists.prepend(h('li', { class: 'gone' }, `No `, h('code', {}, state.chosen.name), ` list on the page now. It is tuned again once one is back.`))
}

function renderTuner() {
  const name = state.chosen?.name
  view.tuner.hidden = !name || !state.page.has(name)
  if (view.tuner.hidden) return

  const values = valuesOf(name)
  const pageValues = Object.fromEntries(FIELDS.map(field => [field, pageValueOf(name, field)]))
  const edits = state.edits.get(name) ?? {}
  const shown = shownRun(values)
  const count = shown.delays.length
  const spread = Stagger.toSpread(count, values.span, values.step)
  const stepBound = values.step > 0 && (count - 1) * values.step < values.span

  view.kids.max = Math.max(1, state.runSize)
  view.kids.value = state.kids ?? state.runSize
  view.kids.disabled = state.runSize <= 1
  view.kidsValue.textContent = state.runSize === 0 ? 'none in view' : state.kids && state.kids < state.runSize ? `${state.kids} of ${state.runSize}` : `all ${state.runSize}`
  view.pause.value = state.pause
  view.pauseValue.textContent = `${state.pause} ms`
  view.runSummary.textContent = toRunSummary(shown)
  view.timeline.show(shown)

  view.tabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab)))
  view.panes.forEach(pane => pane.classList.toggle('inactive', pane.dataset.pane !== state.tab))

  view.spread.show({ points: values.easing, ghost: pageValues.easing, labels: { x: ['first kid', 'last kid'], y: ['0', `${round(spread)} ms`] } })
  view.curves.easing.show(values.easing, pageValues.easing)
  view.fields.span.show(values.span, pageValues.span, count > 1 && stepBound)
  view.fields.step.show(values.step, pageValues.step, count > 1 && !stepBound)
  view.fields.overscan.show(values.overscan, pageValues.overscan, false)
  view.spreadNote.textContent = [toEasingNote(state.page.get(name).easing, edits), toSpreadNote(count, values)].filter(Boolean).join(' ')

  view.motion.show({ points: values.timing, ghost: pageValues.timing, labels: { x: ['0', `${values.duration} ms`], y: ['start', 'rest'] } })
  view.curves.timing.show(values.timing, pageValues.timing)
  view.fields.duration.show(values.duration, pageValues.duration, false)
  view.motionNote.textContent = toMotionNote(state.page.get(name).motion, edits)
  view.pose.show(toDeclarations(values.pose).map(declaration => `${declaration};`).join('\n'))
  view.poseRevert.hidden = !Object.hasOwn(edits, 'pose')
  view.poseNote.textContent = toPoseNote(state.page.get(name).pose, values.pose)

  const lines = toCssLines(name, values, pageValues, edits)
  view.css.replaceChildren(...lines.map(({ text, changed, was }) => h('span', { class: changed ? 'line changed' : 'line' }, text, was !== null ? h('span', { class: 'was' }, `  // page: ${was}`) : null)))
  view.cssNote.textContent = Object.keys(edits).length > 0 ? 'tuned over the page until this panel closes' : 'as the page has it'
  view.css.dataset.text = lines.map(({ text }) => text).join('\n')
  view.save.disabled = state.saving || !state.status.connected || Object.keys(edits).length === 0
  view.save.textContent = state.saving ? 'Saving…' : 'Save'
  const saved = state.saved?.name === name ? state.saved : null
  view.saveNote.replaceChildren(...saved ? [saved.text, ...saved.pickAgain ? [h('button', { class: 'pick-again' }, 'Pick another folder')] : []] : [])
}

/** The playhead, and the marks of the kids on both curves, frame by frame while a run plays. */
function animate() {
  cancelAnimationFrame(frame)
  tick()

  function tick() {
    const name = state.chosen?.name
    if (!name || !state.page.has(name)) return
    const values = valuesOf(name)
    const shown = shownRun(values)
    const elapsed = state.run ? (performance.now() - state.run.startedAt) * state.run.speed : null
    const end = Math.max(0, ...shown.delays.map((delay, kid) => delay + shown.motions[kid]))
    const now = elapsed !== null && elapsed <= end + 120 ? elapsed : null
    view.timeline.at(now)
    view.spread.mark(toSpreadMarks(shown, values, now))
    view.motion.mark(toMotionMarks(shown, values, now))
    frame = now !== null ? requestAnimationFrame(tick) : 0
  }
}

/** A kid's place among them across, its delay up. Lit once it has started. */
function toSpreadMarks({ delays }, values, now) {
  const count = delays.length
  const spread = Stagger.toSpread(count, values.span, values.step)
  const places = delays.map((delay, kid) => ({ x: count > 1 ? kid / (count - 1) : 0, y: spread > 0 ? delay / spread : 0, lit: now !== null && now >= delay }))
  return { dots: places, ticks: places, sweep: now !== null && spread > 0 && now <= spread ? now / spread : null }
}

/** The kids on their way, each where its own time has it on the curve. */
function toMotionMarks({ delays, motions }, values, now) {
  if (now === null) return { dots: [] }
  const timing = Stagger.toEasing(values.timing)
  const moving = delays.map((delay, kid) => motions[kid] > 0 ? (now - delay) / motions[kid] : -1).filter(progress => progress > 0 && progress < 1)
  return { dots: moving.map(progress => ({ x: progress, y: timing(progress), lit: true })) }
}

function toRunSummary(shown) {
  const count = shown.delays.length
  if (count === 0) return 'Nothing in view to stagger. Scroll the list into view, or open it.'
  const lastStart = Math.max(...shown.delays)
  const end = Math.max(...shown.delays.map((delay, kid) => delay + shown.motions[kid]))
  const whose = shown.by === 'kernel' ? 'The app\'s own last run: ' : ''
  return `${whose}${count} ${count === 1 ? 'kid' : 'kids'}, starting over ${round(lastStart)} ms, all at rest by ${round(end)} ms.`
}

/** Which of span and step decides, since only one of them does for a given count. */
function toSpreadNote(count, { span, step }) {
  const gaps = count - 1
  return count === 0 ? ''
    : count === 1 ? 'A lone kid starts at once.'
    : step <= 0 ? `No step, so ${count} kids start over the whole ${span} ms span.`
    : gaps * step < span ? `${count} kids start over ${gaps * step} ms: ${gaps} ${gaps === 1 ? 'step' : 'steps'} of ${step} ms, which is short of the ${span} ms span.`
    : `${count} kids start over the ${span} ms span, which ${gaps} ${gaps === 1 ? 'step' : 'steps'} of ${step} ms would pass.`
}

function toEasingNote({ text, curve }, edits) {
  return curve || Object.hasOwn(edits, 'easing') ? ''
    : text ? `The kernel can't read the page's --stagger-easing, ${text}, so it spreads the kids evenly.`
    : 'The page sets no --stagger-easing, so the kids spread evenly.'
}

function toMotionNote(motion, edits) {
  const drawable = Object.hasOwn(edits, 'timing') || motion.timings.every(timing => Stagger.toCurve(timing))
  const differs = new Set(motion.durations).size > 1 || new Set(motion.timings).size > 1
  return [
    drawable ? '' : `The page's timing, ${toCssList(motion.timings)}, is no cubic-bezier, so the curve starts from linear until you shape it.`,
    differs ? `The page moves ${motion.properties.map((property, i) => `${property} over ${motion.durations[i % motion.durations.length]} ms`).join(', ')}. Tuning gives them all one duration and one curve.` : '', // CSS repeats a shorter list
  ].filter(Boolean).join(' ')
}

function toPoseNote(pose, tuned) {
  return pose.unreadable ? 'Some of the page\'s stylesheets come from another origin, so the start pose can\'t be read from them. What is written here wins over it.'
    : !tuned.trim() ? 'The page gives no start pose, so the kids come in from where they rest.'
    : ''
}

/** The block as the app's SCSS would write it, with what is tuned in it. What isn't tuned is as the page has it, word for word. */
function toCssLines(name, values, pageValues, edits) {
  const { easing, motion } = state.page.get(name)
  const pose = toDeclarations(values.pose)
  const page = {
    easing: easing.text || 'linear',
    timing: toCssList(motion.timings),
    duration: toCssList(motion.durations.map(ms => `${ms}ms`)),
  }
  return [
    line(`[ef-stagger="${name}"] {`),
    line(`  --stagger-span: ${values.span}ms;`, 'span', `${pageValues.span}ms`),
    line(`  --stagger-step: ${values.step}ms;`, 'step', `${pageValues.step}ms`),
    line(`  --stagger-easing: ${Object.hasOwn(edits, 'easing') ? toCurveName(values.easing) : page.easing};`, 'easing', page.easing),
    ...Object.hasOwn(edits, 'overscan') ? [line(`  --stagger-overscan: ${values.overscan};`, 'overscan', pageValues.overscan)] : [],
    line(''),
    ...pose.length > 0 ? [line('  > [stagger-state="init"] {'), ...pose.map(declaration => line(`    ${declaration};`, 'pose', null)), line('  }')] : [],
    line('  > [stagger-state] {'),
    line(`    transition-timing-function: ${Object.hasOwn(edits, 'timing') ? toCurveName(values.timing) : page.timing};`, 'timing', page.timing),
    line(`    transition-duration: ${Object.hasOwn(edits, 'duration') ? `${values.duration}ms` : page.duration};`, 'duration', page.duration),
    line('  }'),
    line('}'),
  ]

  function line(text, field, was) {
    const changed = field !== undefined && Object.hasOwn(edits, field)
    return { text, changed, was: changed && was !== null ? was : null }
  }
}


// THE CONTROLS

function bindView() {
  const $ = selector => document.querySelector(selector)
  const built = {
    status: $('#status'),
    reducedMotion: $('#reduced-motion'),
    loop: $('#loop'),
    once: $('#once'),
    speed: $('#speed'),
    lists: $('#lists'),
    noLists: $('#no-lists'),
    tuner: $('#tuner'),
    kids: $('#kids'),
    kidsValue: $('#kids-value'),
    pause: $('#pause'),
    pauseValue: $('#pause-value'),
    runSummary: $('#run-summary'),
    tabs: [...document.querySelectorAll('[role="tab"]')],
    panes: [...document.querySelectorAll('.pane')],
    spreadNote: $('#spread-note'),
    motionNote: $('#motion-note'),
    pose: poseEditor($('.pose-box'), { onInput: text => edit('pose', text, false), onCommit: text => edit('pose', text, true) }),
    poseRevert: $('[data-field="pose"] .revert'),
    poseNote: $('#pose-note'),
    css: $('#css'),
    cssNote: $('#css-note'),
    copy: $('#copy'),
    reset: $('#reset'),
    save: $('#save'),
    saveNote: $('#save-note'),
    timeline: timeline($('#timeline')),
    spread: curveEditor($('#spread-curve'), { onInput: points => edit('easing', points, false), onCommit: points => edit('easing', points, true) }),
    motion: curveEditor($('#motion-curve'), { onInput: points => edit('timing', points, false), onCommit: points => edit('timing', points, true) }),
    fields: Object.fromEntries(['span', 'step', 'overscan', 'duration'].map(field => [field, numberField(field)])),
    curves: Object.fromEntries(['easing', 'timing'].map(field => [field, curveField(field)])),
  }

  built.loop.addEventListener('click', toggleLoop)
  built.once.addEventListener('click', () => {
    state.looping = false
    replay()
    render()
  })
  built.speed.addEventListener('click', ({ target }) => {
    const speed = Number(target.closest('[data-speed]')?.dataset.speed)
    if (!speed) return
    state.speed = speed
    savePreferences()
    state.looping && replay()
    render()
  })
  built.status.addEventListener('click', ({ target }) => target.closest('.retry') && page.reconnect())
  built.kids.addEventListener('input', () => {
    state.kids = Number(built.kids.value) >= state.runSize ? null : Number(built.kids.value)
    state.stale = true
    render()
  })
  built.kids.addEventListener('change', replay)
  built.pause.addEventListener('input', () => {
    state.pause = Number(built.pause.value)
    page.send({ type: 'pause', pause: state.pause })
    savePreferences()
    render()
  })
  built.tabs.forEach(tab => tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab
    savePreferences()
    render()
  }))
  built.poseRevert.addEventListener('click', () => edit('pose', pageValueOf(state.chosen.name, 'pose'), true))
  built.copy.addEventListener('click', copyCss)
  built.save.addEventListener('click', () => save(false))
  built.saveNote.addEventListener('click', ({ target }) => target.closest('.pick-again') && save(true))
  built.reset.addEventListener('click', () => {
    state.edits.delete(state.chosen.name)
    sendTune(state.chosen.name)
    state.stale = true
    render()
    replay()
  })
  built.lists.addEventListener('click', ({ target }) => {
    const id = Number(target.closest('[data-id]')?.dataset.id)
    const list = state.lists.find(list => list.id === id)
    list && (target.closest('.reveal') ? page.send({ type: 'reveal', id }) : list.id !== state.chosen?.id && choose(list))
  })
  built.lists.addEventListener('pointerover', ({ target }) => {
    const row = target.closest('[data-id]')
    row && pointAt(Number(row.dataset.id))
  })
  built.lists.addEventListener('pointerleave', () => pointAt(null))
  window.addEventListener('resize', render) // the timeline is drawn at its width
  document.addEventListener('keydown', event => {
    if (event.key !== ' ' || event.target.closest('input, textarea, select, button, [tabindex]')) return
    event.preventDefault()
    toggleLoop()
  })
  return built

  function toggleLoop() {
    if (!state.chosen?.id) return
    state.looping = !state.looping
    state.looping ? replay() : page.send({ type: 'loop', on: false })
    render()
  }

  async function copyCss() {
    try {
      await navigator.clipboard.writeText(built.css.dataset.text)
      built.copy.textContent = 'Copied'
    } catch {
      getSelection().selectAllChildren(built.css) // for a copy by hand, when the clipboard is out of reach
      built.copy.textContent = 'Selected'
    }
    setTimeout(() => { built.copy.textContent = 'Copy' }, 1200)
  }
}

function numberField(field) {
  const root = document.querySelector(`[data-field="${field}"]`)
  const [range, number] = root.querySelectorAll('input')
  const revert = root.querySelector('.revert')
  range.addEventListener('input', () => edit(field, Number(range.value), false))
  range.addEventListener('change', () => edit(field, Number(range.value), true))
  number.addEventListener('change', () => edit(field, Math.max(0, Math.round(Number(number.value)) || 0), true))
  revert.addEventListener('click', () => edit(field, pageValueOf(state.chosen.name, field), true))
  return { show }

  /** An idle field is one that the spread doesn't come from, for this many kids. */
  function show(value, pageValue, idle) {
    range.max = Math.max(Number(range.dataset.max), value, pageValue) // a value past the slider widens it
    range.value = value
    document.activeElement === number || (number.value = value)
    revert.hidden = value === pageValue
    revert.title = `Back to the page's ${pageValue}`
    root.classList.toggle('tuned', value !== pageValue)
    root.classList.toggle('idle', idle)
  }
}

function curveField(field) {
  const root = document.querySelector(`[data-field="${field}"]`)
  const text = root.querySelector('.curve-text')
  const presets = root.querySelector('.presets')
  const revert = root.querySelector('.revert')
  presets.append(new Option('Presets…', ''), ...Object.keys(PRESETS).map(name => new Option(name, name)))
  text.addEventListener('change', () => {
    const curve = Stagger.toCurve(text.value) ?? Stagger.toCurve(`cubic-bezier(${text.value})`) // four bare numbers will do
    text.classList.toggle('invalid', !curve)
    curve && edit(field, curve, true)
  })
  presets.addEventListener('change', () => {
    presets.value && edit(field, PRESETS[presets.value], true)
    presets.value = ''
  })
  revert.addEventListener('click', () => edit(field, pageValueOf(state.chosen.name, field), true))
  return { show }

  function show(curve, pageCurve) {
    if (document.activeElement !== text) {
      text.value = toCurveName(curve)
      text.classList.remove('invalid')
    }
    revert.hidden = sameValue(curve, pageCurve)
    revert.title = `Back to the page's ${toCurveName(pageCurve)}`
    root.classList.toggle('tuned', !sameValue(curve, pageCurve))
  }
}

function restorePreferences() {
  try {
    const { pause, speed, tab } = JSON.parse(localStorage.getItem('stagger-tuner') ?? '{}')
    Object.assign(state, Number.isFinite(pause) ? { pause } : {}, Number.isFinite(speed) ? { speed } : {}, tab ? { tab } : {})
  } catch {}
}

function savePreferences() {
  try { localStorage.setItem('stagger-tuner', JSON.stringify({ pause: state.pause, speed: state.speed, tab: state.tab })) } catch {}
}


// TEXT

/** A CSS keyword where one says it, cubic-bezier() otherwise. */
function toCurveName(points) {
  return Object.keys(Stagger.namedCurves).find(name => sameValue(points, Stagger.namedCurves[name])) ?? Stagger.toCurveText(points)
}

/** A computed list as a person writes it: one item when they are all the same. */
function toCssList(items) {
  return new Set(items).size === 1 ? items[0] : items.join(', ')
}

/** The declarations of a start pose, one by one, as a person reads them. */
function toDeclarations(pose) {
  return pose.split(/;(?![^(]*\))/).map(declaration => declaration.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/, ': ')).filter(Boolean)
}

function round(ms) {
  return Math.round(ms)
}

function h(tag, attrs, ...children) {
  const node = document.createElement(tag)
  Object.entries(attrs).forEach(([name, value]) => value !== false && node.setAttribute(name, value))
  node.append(...children.filter(child => child !== null && child !== undefined && child !== false))
  return node
}
