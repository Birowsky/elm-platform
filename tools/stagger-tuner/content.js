// The tuner's side of a page: it lists the lists there that stagger their entrance ([ef-stagger]), replays the entrance
// of one the way the kernel runs it, as often as the panel asks, and lays what the panel tunes over the page's CSS. When
// the panel lets go, all of it goes, and the page is as it was.
//
// The kernel staggers the kids that a patch adds to a list. A replay takes every kid of the list as new, so the ones in
// view and the overscan come in as they would if the list arrived now: the same kids and the same delays, from the same
// CSS, which what is tuned is part of. Runs of the kernel itself are reported too, so that the panel can show them.
//
// Injected with stagger.js, by the panel, into the page's isolated world. Never writes into the body, which Elm owns.

(() => {
  window.staggerTuner?.release() // a copy injected earlier, maybe by the extension before it was reloaded
  window.staggerTuner = { release }

  let session = null
  chrome.runtime.onConnect.addListener(connect)

  function connect(port) {
    if (port.name !== 'stagger-tuner') return
    session?.end()
    session = startSession(port)
  }

  function release() {
    session?.end()
    try { chrome.runtime.onConnect.removeListener(connect) } catch {} // the extension that injected it may be gone
  }

  /** Everything done for one panel, which end() undoes. */
  function startSession(port) {
    const lists = new Map() // id → the element of a list
    const ids = new WeakMap() // the element of a list → id
    const labels = new WeakMap() // the element of a list → what it is about
    const tunings = new Map() // block name → what the panel tuned in it
    const replayed = new WeakSet() // kids in a replay, which the runs of the kernel are told apart from
    const timers = {}
    const sheet = document.createElement('style') // what is tuned, over the page's CSS
    const observer = new window.MutationObserver(notice)
    const self = { end }
    let replay = null // the list being replayed, and how
    let pointer = null // the box over the list that the panel points at
    let nextId = 1
    let sentLists = ''
    let ended = false

    sheet.setAttribute('data-stagger-tuner', '')
    document.documentElement.append(sheet)
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['ef-stagger', 'stagger-state'] })
    port.onMessage.addListener(answer)
    port.onDisconnect.addListener(end)
    sendLists()
    return self

    function send(message) {
      ended || port.postMessage(message) // a stylesheet may load after the panel has gone
    }

    function answer(message) {
      if (ended) return
      const handlers = { tune, read: sendPage, play, loop: setLooping, pause: setPause, stop: stopReplay, point: pointAt, reveal }
      handlers[message.type]?.(message)
    }

    function end() {
      if (ended) return
      ended = true
      stopReplay()
      pointAt({ id: null })
      observer.disconnect()
      Object.values(timers).forEach(clearTimeout)
      sheet.remove()
      try { port.disconnect() } catch {}
      session === self && (session = null)
    }


    // THE LISTS

    /** Sent when they change. What is in view changes without a mutation, so this runs every second too. */
    function sendLists() {
      const found = [...document.querySelectorAll('[ef-stagger]')]
      const summary = found.map(list => ({ id: idOf(list), name: list.getAttribute('ef-stagger'), label: labelOf(list), kids: list.childElementCount, where: whereIs(list) }))
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      const text = JSON.stringify({ summary, reducedMotion })
      lists.forEach((list, id) => found.includes(list) || lists.delete(id))
      text !== sentLists && send({ type: 'lists', lists: summary, reducedMotion })
      sentLists = text
      later('lists', sendLists, 1000)
    }

    function idOf(list) {
      if (!ids.has(list)) {
        ids.set(list, nextId)
        nextId += 1
      }
      lists.set(ids.get(list), list)
      return ids.get(list)
    }

    /** What the list is about, like the title of the panel it is in: the first words before it, in the closest part of the page that has some. */
    function labelOf(list) {
      labels.has(list) || labels.set(list, wordsBefore(list.parentElement, 6) ?? [list.localName, ...[...list.classList].slice(0, 2)].join('.'))
      return labels.get(list)

      function wordsBefore(ancestor, levels) {
        if (!ancestor || levels === 0 || ancestor === document.body || ancestor === document.documentElement) return null
        const first = firstWords(document.createTreeWalker(ancestor, window.NodeFilter.SHOW_TEXT))
        const before = first && !list.contains(first) && first.compareDocumentPosition(list) & window.Node.DOCUMENT_POSITION_FOLLOWING
        return before ? first.textContent.trim().replace(/\s+/g, ' ').slice(0, 48) : wordsBefore(ancestor.parentElement, levels - 1)
      }

      function firstWords(walker) {
        const text = walker.nextNode()
        return !text || (text.textContent.trim() && !text.parentElement.closest('script, style')) ? text : firstWords(walker)
      }
    }

    function whereIs(list) {
      const { top, left, bottom, right, width, height } = list.getBoundingClientRect()
      return width === 0 && height === 0 ? 'hidden'
        : bottom <= 0 || right <= 0 || top >= window.innerHeight || left >= window.innerWidth ? 'out of view'
        : 'in view'
    }

    function notice(records) {
      const kernelKids = new Set(records
        .filter(({ attributeName, target }) => attributeName === 'stagger-state' && !replayed.has(target) && target.getAttribute('stagger-state') === 'entered')
        .map(({ target }) => target))
      const styles = records.flatMap(({ type, target, addedNodes, removedNodes }) => type === 'childList' ? [target, ...addedNodes, ...removedNodes].filter(isStyle) : [])

      kernelKids.size > 0 && sendKernelRuns([...kernelKids])
      records.some(({ type, attributeName }) => type === 'childList' || attributeName === 'ef-stagger') && later('lists', sendLists, 250)
      styles.length > 0 && later('styles', sendStylesChanged, 300)
      styles.filter(node => node.localName === 'link').forEach(link => link.addEventListener('load', () => later('styles', sendStylesChanged, 50), { once: true })) // its rules come later than it does

      function isStyle(node) {
        return node !== sheet && (node.localName === 'style' || (node.localName === 'link' && /stylesheet/i.test(node.rel)))
      }
    }

    /** The kernel sets init and then entered, all in one go, so by now its kids are entered. */
    function sendKernelRuns(kids) {
      const runs = Map.groupBy(kids.filter(kid => kid.parentElement?.hasAttribute('ef-stagger')), kid => kid.parentElement)
      runs.forEach((run, list) => send({ type: 'run', id: idOf(list), by: 'kernel', whole: run.length, delays: run.map(delayOf), motions: run.map(motionOf), speed: 1 }))
    }

    function sendStylesChanged() {
      send({ type: 'styles' })
    }

    function later(key, task, ms) {
      clearTimeout(timers[key])
      timers[key] = setTimeout(task, ms)
    }


    // WHAT THE PAGE'S CSS SAYS

    function sendPage({ id }) {
      const list = lists.get(id)
      list?.isConnected && send({ type: 'page', id, name: list.getAttribute('ef-stagger'), values: readPage(list), runSize: toRun(list).whole.length })
    }

    /** The page's own values, under what is tuned. */
    function readPage(list) {
      sheet.disabled = true
      const style = window.getComputedStyle(list)
      const easing = style.getPropertyValue('--stagger-easing').trim()
      const values = {
        span: Stagger.toMilliseconds(style.getPropertyValue('--stagger-span')),
        step: Stagger.toMilliseconds(style.getPropertyValue('--stagger-step')),
        easing: { text: easing, curve: Stagger.toCurve(easing) },
        overscan: parseInt(style.getPropertyValue('--stagger-overscan'), 10) || 0,
        motion: readMotion(list),
        pose: readPose(list.getAttribute('ef-stagger')),
      }
      sheet.disabled = false
      return values
    }

    /**
     * How a kid of the block moves: the computed transition of an entered kid in a stand-in for the list, with its name and classes.
     * Never one of the list's own kids, since it may have none yet, as while its first page loads, and never in the list itself,
     * which may watch its children and fetch a page when they change. So the stand-in goes outside the body, for as long as the read takes.
     */
    function readMotion(list) {
      const standIn = document.createElement('div')
      const kid = document.createElement('div')
      standIn.hidden = true
      standIn.setAttribute('class', list.getAttribute('class') ?? '')
      standIn.setAttribute('ef-stagger', list.getAttribute('ef-stagger'))
      standIn.setAttribute('data-stagger-tuner', '')
      kid.setAttribute('stagger-state', 'entered')
      standIn.append(kid)
      document.documentElement.append(standIn)
      const style = window.getComputedStyle(kid)
      const motion = {
        properties: toItems(style.getPropertyValue('transition-property')),
        durations: toItems(style.getPropertyValue('transition-duration')).map(Stagger.toMilliseconds),
        timings: toItems(style.getPropertyValue('transition-timing-function')),
      }
      standIn.remove()
      return motion
    }

    /** The start pose as the page's stylesheets write it: the init rules of every block and of this one, transitions aside. */
    function readPose(name) {
      const selectors = ['[ef-stagger] > [stagger-state="init"]', `[ef-stagger="${toCssString(name)}"] > [stagger-state="init"]`]
      const found = { texts: [], unreadable: false }
      ;[...document.styleSheets].filter(styleSheet => styleSheet.ownerNode !== sheet).forEach(styleSheet => collect(rulesOf(styleSheet)))
      const pose = document.createElement('div').style
      pose.cssText = found.texts.join(' ')
      pose.removeProperty('transition')
      return { text: pose.cssText, unreadable: found.unreadable }

      function rulesOf(styleSheet) {
        try { return [...styleSheet.cssRules] } catch { found.unreadable = true; return [] } // another origin's
      }

      function collect(rules) {
        rules.forEach(rule => rule.selectorText !== undefined
          ? isPoseRule(rule) && found.texts.push(rule.style.cssText)
          : rule.cssRules && (!rule.media || window.matchMedia?.(rule.media.mediaText).matches) && collect([...rule.cssRules]))
      }

      function isPoseRule(rule) {
        return rule.selectorText.split(/\s*,\s*(?![^(]*\))/).some(selector => selectors.includes(selector))
      }
    }


    // WHAT IS TUNED

    function tune({ name, overrides }) {
      Object.keys(overrides).length > 0 ? tunings.set(name, overrides) : tunings.delete(name)
      sheet.textContent = [...tunings].map(([name, tuned]) => toOverrides(name, tuned)).filter(Boolean).join('\n')
    }

    /** The page's own selectors, made to win. Motion goes on entered only, since init must not transition. */
    function toOverrides(name, tuned) {
      const block = `[ef-stagger="${toCssString(name)}"]`
      return [
        toRule(block, [
          tuned.span !== undefined && `--stagger-span: ${tuned.span}ms`,
          tuned.step !== undefined && `--stagger-step: ${tuned.step}ms`,
          tuned.easing && `--stagger-easing: ${Stagger.toCurveText(tuned.easing)}`,
          tuned.overscan !== undefined && `--stagger-overscan: ${tuned.overscan}`,
        ]),
        toRule(`${block} > [stagger-state="entered"]`, [
          tuned.duration !== undefined && `transition-duration: ${tuned.duration}ms`,
          tuned.timing && `transition-timing-function: ${Stagger.toCurveText(tuned.timing)}`,
        ]),
        toRule(`${block} > [stagger-state="init"]`, tuned.pose !== undefined ? toPoseDeclarations(name, tuned.pose) : []),
      ].filter(Boolean).join('\n')

      function toRule(selector, declarations) {
        const kept = declarations.filter(Boolean)
        return kept.length > 0 ? `${selector} { ${kept.map(declaration => `${declaration} !important;`).join(' ')} }` : ''
      }
    }

    /** What the panel wrote, and unset for what the page's pose has that it left out. */
    function toPoseDeclarations(name, text) {
      const tuned = toDeclarations(text)
      const page = toDeclarations(readPose(name).text)
      return [
        ...Object.entries(tuned).map(([property, value]) => `${property}: ${value}`),
        ...Object.keys(page).filter(property => !Object.hasOwn(tuned, property)).map(property => `${property}: unset`),
      ]

      function toDeclarations(text) { // longhand → value, as the browser reads them
        const style = document.createElement('div').style
        style.cssText = text
        return Object.fromEntries(Array.from({ length: style.length }, (_, i) => style.item(i)).map(property => [property, style.getPropertyValue(property)]))
      }
    }


    // REPLAYS

    function play({ id, loop, kids, pause, speed }) {
      stopReplay()
      const list = lists.get(id)
      if (!list?.isConnected) return
      replay = { list, loop, kids, pause, speed, run: [], timer: 0, instant: false }
      begin()
    }

    function begin() {
      if (!replay.list.isConnected) return stopReplay()
      const { run, whole, delays, motions, longest } = stagger(replay.list, replay.kids, replay.speed)
      Object.assign(replay, { run, instant: run.length === 0 || longest === 0 })
      send({ type: 'run', id: idOf(replay.list), by: 'tuner', whole, delays, motions, speed: replay.speed })
      replay.timer = setTimeout(finish, longest / replay.speed)
    }

    function finish() {
      settle(replay.run)
      replay.run = []
      replay.timer = replay.loop ? setTimeout(begin, Math.max(replay.pause, replay.instant ? 500 : 0)) : 0 // a loop of nothing would spin
    }

    function setLooping({ on }) {
      if (!replay) return
      replay.loop = on
      on && replay.timer === 0 && begin()
    }

    function setPause({ pause }) {
      replay && (replay.pause = pause)
    }

    function stopReplay() {
      if (!replay) return
      clearTimeout(replay.timer)
      settle(replay.run)
      replay = null
    }

    /** The kernel's staggered entrance, with every kid of the list taken as new. */
    function stagger(list, limit, speed) {
      const { whole, span, step, easing } = toRun(list)
      const run = limit ? whole.slice(0, limit) : whole
      const delays = Stagger.toDelays(run.length, span, step, easing)

      run.forEach((kid, place) => {
        replayed.add(kid)
        kid.style.setProperty('--stagger-delay', `${delays[place]}ms`)
        kid.setAttribute('stagger-state', 'init')
      })
      run.length > 0 && window.getComputedStyle(run[0]).getPropertyValue('opacity') // a call, as in the kernel, so that the kids are at init before they move
      run.forEach(kid => kid.setAttribute('stagger-state', 'entered'))
      const ends = run.map(endOf)
      speed !== 1 && run.forEach(kid => kid.getAnimations({ subtree: true }).forEach(animation => { animation.playbackRate = speed }))
      return { run, whole: whole.length, delays, motions: run.map(motionOf), longest: Math.max(0, ...ends) }
    }

    function settle(run) {
      run.forEach(kid => {
        kid.removeAttribute('stagger-state')
        kid.style.removeProperty('--stagger-delay')
        replayed.delete(kid)
      })
    }

    /** The kids the kernel would stagger if they all came now, and what spreads them, from the list's CSS. */
    function toRun(list) {
      const style = window.getComputedStyle(list)
      return {
        whole: toStaggeredRun(list, [...list.children], parseInt(style.getPropertyValue('--stagger-overscan'), 10) || 0),
        span: Stagger.toMilliseconds(style.getPropertyValue('--stagger-span')),
        step: Stagger.toMilliseconds(style.getPropertyValue('--stagger-step')),
        easing: Stagger.toEasing(Stagger.toCurve(style.getPropertyValue('--stagger-easing'))),
      }
    }

    /** The kids in view, and the overscan before and after them, in order. As in the kernel, a kid past the view ends the measuring. */
    function toStaggeredRun(list, kids, overscan) {
      const scrollport = toScrollport(list)
      const places = []
      kids.find(kid => {
        places.push(toPlaceInPort(kid, scrollport))
        return places.at(-1) > 0
      })
      const first = places.indexOf(0)
      const last = places.lastIndexOf(0)
      if (first >= 0) return kids.slice(Math.max(0, first - overscan), last + overscan + 1)

      const before = kids[0]?.previousElementSibling // none in view, but next to what is, so the user is about to scroll to them
      const after = kids.at(-1)?.nextElementSibling
      return before && toPlaceInPort(before, scrollport) === 0 ? kids.slice(0, overscan)
        : after && toPlaceInPort(after, scrollport) === 0 ? kids.slice(kids.length - overscan)
        : []
    }

    /** The first ancestor that scrolls or clips, or else the window. */
    function toScrollport(list) {
      const clipping = toAncestry(list).find(element => {
        const style = window.getComputedStyle(element)
        return /auto|scroll|hidden|clip/.test(style.getPropertyValue('overflow-x') + style.getPropertyValue('overflow-y'))
      })
      return clipping ? clipping.getBoundingClientRect() : { top: 0, left: 0, bottom: window.innerHeight, right: window.innerWidth }

      function toAncestry(element) { // the element and its ancestors, short of the root
        return !element || element === document.documentElement ? [] : [element, ...toAncestry(element.parentElement)]
      }
    }

    /** -1 before the scrollport, 0 in it, 1 after it. */
    function toPlaceInPort(element, scrollport) {
      const rect = element.getBoundingClientRect()
      return rect.top >= scrollport.bottom || rect.left >= scrollport.right ? 1
        : rect.bottom <= scrollport.top || rect.right <= scrollport.left ? -1
        : 0
    }

    /** When the last transition of a kid has ended, its delay included, as the kernel reckons it. */
    function endOf(kid) {
      const style = window.getComputedStyle(kid)
      const durations = style.getPropertyValue('transition-duration').split(',')
      const delays = style.getPropertyValue('transition-delay').split(',')
      const ends = Array.from({ length: Math.max(durations.length, delays.length) }, (_, i) => parseFloat(durations[i % durations.length]) + parseFloat(delays[i % delays.length]))
      return Math.max(0, ...ends.filter(isFinite)) * 1000
    }

    function motionOf(kid) {
      return Math.max(0, ...toItems(window.getComputedStyle(kid).getPropertyValue('transition-duration')).map(Stagger.toMilliseconds))
    }

    function delayOf(kid) {
      return Stagger.toMilliseconds(kid.style.getPropertyValue('--stagger-delay'))
    }


    // POINTING AT A LIST

    function pointAt({ id }) {
      pointer?.box.remove()
      const list = lists.get(id)
      pointer = list?.isConnected ? { list, box: toBox(list) } : null
      pointer && follow(pointer)

      function follow(current) {
        if (pointer !== current) return
        const { top, left, width, height } = current.list.getBoundingClientRect()
        Object.assign(current.box.style, { top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` })
        window.requestAnimationFrame(() => follow(current))
      }

      function toBox(list) {
        const box = document.createElement('div')
        const tag = document.createElement('span')
        box.setAttribute('data-stagger-tuner', '')
        box.style.cssText = 'position: fixed; z-index: 2147483647; pointer-events: none; box-sizing: border-box; background: rgb(111 168 220 / 0.3); outline: 2px solid rgb(66 133 244 / 0.9); transition: none;'
        tag.textContent = list.getAttribute('ef-stagger')
        tag.style.cssText = 'position: absolute; top: 0; left: 0; padding: 0 6px; font: 600 11px/18px system-ui, sans-serif; color: white; background: rgb(66 133 244); white-space: nowrap;'
        box.append(tag)
        document.documentElement.append(box)
        return box
      }
    }

    function reveal({ id }) {
      lists.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }

  function toItems(text) { // a CSS list, commas inside parentheses aside
    return text.split(/,(?![^(]*\))/).map(item => item.trim()).filter(Boolean)
  }

  function toCssString(text) {
    return text.replace(/["\\]/g, '\\$&')
  }
})()
