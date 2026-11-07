// A cubic-bezier to shape by hand: the curve on an SVG, the page's own curve as a ghost behind it, and two handles to
// drag, click toward or nudge with the arrow keys (Shift for bigger steps). The panel marks the kids of a run on it.

export { curveEditor }

const SVG = 'http://www.w3.org/2000/svg'
const WIDTH = 300
const MARGIN = { top: 8, right: 18, bottom: 8, left: 44 }
const SIZE = WIDTH - MARGIN.left - MARGIN.right // of the unit square

/** onInput while a handle moves, onCommit once it is let go. */
function curveEditor(svg, { onInput, onCommit }) {
  const parts = build()
  let points = [0, 0, 1, 1]
  let ghost = null
  let labels = { x: ['', ''], y: ['', ''] }
  let range = { low: -0.15, high: 1.15 } // of y, which a curve may overshoot
  let dragging = null
  let nudged = 0

  svg.addEventListener('pointerdown', grab)
  svg.addEventListener('pointermove', drag)
  svg.addEventListener('pointerup', drop)
  svg.addEventListener('pointercancel', drop)
  parts.handles.forEach((handle, index) => handle.addEventListener('keydown', event => nudge(event, index)))

  return { show, mark }

  /** What the panel holds. A handle being dragged keeps where the pointer has it. */
  function show(next) {
    if (dragging) return
    points = next.points
    ghost = next.ghost
    labels = next.labels
    range = toRange(points)
    layout()
    draw()
  }

  /** Dots on the curve, ticks beside it at their heights and a line across it, which change with every frame of a run. */
  function mark({ dots = [], ticks = [], sweep = null }) {
    parts.dots.replaceChildren(...dots.map(({ x, y, lit }) => element('circle', { class: lit ? 'dot lit' : 'dot', cx: toX(x), cy: toY(y), r: 3.5 })))
    parts.ticks.replaceChildren(...ticks.map(({ y, lit }) => element('line', { class: lit ? 'tick lit' : 'tick', x1: toX(1) + 3, x2: toX(1) + 11, y1: toY(y), y2: toY(y) })))
    parts.sweep.setAttribute('visibility', sweep === null ? 'hidden' : 'visible')
    sweep !== null && ['y1', 'y2'].forEach(side => parts.sweep.setAttribute(side, toY(sweep)))
  }

  function build() {
    const handles = [1, 2].map(index => {
      const handle = element('g', { class: `handle handle-${index}`, tabindex: 0, 'data-index': index - 1, role: 'slider', 'aria-label': `Handle ${index}, arrow keys move it` })
      handle.append(element('circle', { class: 'hit', r: 15 }), element('circle', { class: 'knob', r: 6.5 }))
      return handle
    })
    const built = {
      square: element('rect', { class: 'square' }),
      grid: element('g', { class: 'grid' }),
      diagonal: element('line', { class: 'diagonal' }),
      ghost: element('path', { class: 'ghost' }),
      arms: [element('line', { class: 'arm arm-1' }), element('line', { class: 'arm arm-2' })],
      line: element('path', { class: 'line' }),
      ticks: element('g', { class: 'ticks' }),
      sweep: element('line', { class: 'sweep', visibility: 'hidden' }),
      dots: element('g', { class: 'dots' }),
      handles,
      labels: { x: [element('text', { 'text-anchor': 'start' }), element('text', { 'text-anchor': 'end' })], y: [element('text', { 'text-anchor': 'end' }), element('text', { 'text-anchor': 'end' })] },
    }
    svg.replaceChildren(built.square, built.grid, built.diagonal, built.ghost, ...built.arms, built.line, built.ticks, built.sweep, built.dots,
      ...built.labels.x, ...built.labels.y, ...handles)
    return built
  }

  /** What depends on the range: the size of the SVG and everything drawn on the unit square. */
  function layout() {
    const height = MARGIN.top + (range.high - range.low) * SIZE + MARGIN.bottom
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${height}`)
    attributes(parts.square, { x: toX(0), y: toY(1), width: SIZE, height: SIZE })
    attributes(parts.diagonal, { x1: toX(0), y1: toY(0), x2: toX(1), y2: toY(1) })
    attributes(parts.sweep, { x1: toX(0), x2: toX(1) })
    parts.grid.replaceChildren(...[0.25, 0.5, 0.75].flatMap(at => [
      element('line', { x1: toX(at), x2: toX(at), y1: toY(0), y2: toY(1) }),
      element('line', { x1: toX(0), x2: toX(1), y1: toY(at), y2: toY(at) }),
    ]))
    const [xStart, xEnd] = parts.labels.x
    const [yStart, yEnd] = parts.labels.y
    attributes(xStart, { x: toX(0) + 4, y: toY(0) + 14 })
    attributes(xEnd, { x: toX(1) - 4, y: toY(0) + 14 })
    attributes(yStart, { x: MARGIN.left - 9, y: toY(0) + 3.5 })
    attributes(yEnd, { x: MARGIN.left - 9, y: toY(1) + 3.5 })
    xStart.textContent = labels.x[0]
    xEnd.textContent = labels.x[1]
    yStart.textContent = labels.y[0]
    yEnd.textContent = labels.y[1]
  }

  function draw() {
    const [x1, y1, x2, y2] = points
    parts.line.setAttribute('d', toPath(points))
    parts.ghost.setAttribute('d', ghost ? toPath(ghost) : '')
    attributes(parts.arms[0], { x1: toX(0), y1: toY(0), x2: toX(x1), y2: toY(y1) })
    attributes(parts.arms[1], { x1: toX(1), y1: toY(1), x2: toX(x2), y2: toY(y2) })
    parts.handles[0].setAttribute('transform', `translate(${toX(x1)} ${toY(y1)})`)
    parts.handles[1].setAttribute('transform', `translate(${toX(x2)} ${toY(y2)})`)
    parts.handles[0].setAttribute('aria-valuetext', `${x1}, ${y1}`)
    parts.handles[1].setAttribute('aria-valuetext', `${x2}, ${y2}`)

    function toPath([x1, y1, x2, y2]) {
      return `M ${toX(0)} ${toY(0)} C ${toX(x1)} ${toY(y1)}, ${toX(x2)} ${toY(y2)}, ${toX(1)} ${toY(1)}`
    }
  }


  // HANDLING

  /** A press on a handle picks it up; one beside the handles brings the nearest one there. */
  function grab(event) {
    if (event.button !== 0) return
    const handle = event.target.closest('.handle')
    const point = toPoint(event)
    const index = handle ? Number(handle.dataset.index) : nearestHandle(point)
    dragging = { index, pointerId: event.pointerId }
    svg.setPointerCapture(event.pointerId)
    parts.handles[index].focus({ preventScroll: true })
    handle || move(index, point, event.shiftKey)
    event.preventDefault()
  }

  function drag(event) {
    dragging?.pointerId === event.pointerId && move(dragging.index, toPoint(event), event.shiftKey)
  }

  function drop(event) {
    if (dragging?.pointerId !== event.pointerId) return
    dragging = null
    range = toRange(points)
    layout()
    draw()
    onCommit(points)
  }

  function nudge(event, index) {
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }
    if (!steps[event.key]) return
    event.preventDefault()
    const by = event.shiftKey ? 0.1 : 0.01
    const [dx, dy] = steps[event.key]
    move(index, { x: points[index * 2] + dx * by, y: points[index * 2 + 1] + dy * by }, false)
    clearTimeout(nudged)
    nudged = setTimeout(() => { // one commit for a run of presses
      range = toRange(points)
      layout()
      draw()
      onCommit(points)
    }, 350)
  }

  /** x stays in [0, 1], as CSS wants; y may overshoot. Shift snaps to a coarser grid. */
  function move(index, { x, y }, coarse) {
    const grid = coarse ? 0.05 : 0.01
    const next = [...points]
    next[index * 2] = Math.min(1, Math.max(0, snap(x, grid)))
    next[index * 2 + 1] = snap(y, grid)
    points = next
    draw()
    onInput(points)

    function snap(value, grid) {
      return Math.round(Math.round(value / grid) * grid * 100) / 100
    }
  }

  function nearestHandle({ x, y }) {
    const distance = index => Math.hypot(points[index * 2] - x, points[index * 2 + 1] - y)
    return distance(0) <= distance(1) ? 0 : 1
  }

  function toPoint({ clientX, clientY }) {
    const { x, y } = new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse())
    return { x: (x - MARGIN.left) / SIZE, y: range.high - (y - MARGIN.top) / SIZE }
  }


  // GEOMETRY

  function toX(x) {
    return MARGIN.left + x * SIZE
  }

  function toY(y) {
    return MARGIN.top + (range.high - y) * SIZE
  }

  /** Room for both handles, so that one past the square is still on the SVG. */
  function toRange([, y1, , y2]) {
    return {
      low: Math.floor(Math.min(-0.08, y1 - 0.08, y2 - 0.08) * 20) / 20,
      high: Math.ceil(Math.max(1.08, y1 + 0.08, y2 + 0.08) * 20) / 20,
    }
  }
}

function element(name, attrs) {
  return attributes(document.createElementNS(SVG, name), attrs)
}

function attributes(target, attrs) {
  Object.entries(attrs).forEach(([name, value]) => target.setAttribute(name, value))
  return target
}
