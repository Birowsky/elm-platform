// The kids of a run as bars in time, one row each: a kid waits for its delay, then moves for its motion. While the run
// plays, a playhead crosses them and fills each bar as far as its kid has come.

export { timeline }

const SVG = 'http://www.w3.org/2000/svg'
const MARGIN = { top: 4, right: 12, bottom: 18, left: 12 }

/** Drawn at the width it has on screen, so that its text keeps its size in a wide panel. */
function timeline(svg) {
  let rows = []
  let end = 1
  let width = 300
  const playhead = element('line', { class: 'playhead', visibility: 'hidden' })

  return { show, at }

  function show({ delays, motions }) {
    width = Math.round(svg.getBoundingClientRect().width) || width
    end = Math.max(1, ...delays.map((delay, kid) => delay + motions[kid]))
    const height = Math.max(3, Math.min(8, Math.floor(96 / Math.max(1, delays.length))))
    const gap = height >= 5 ? 2 : 1
    const plot = Math.max(height, delays.length * (height + gap) - gap)
    svg.setAttribute('viewBox', `0 0 ${width} ${MARGIN.top + plot + MARGIN.bottom}`)

    rows = delays.map((delay, kid) => {
      const y = MARGIN.top + kid * (height + gap)
      const bar = { x: toX(delay), width: Math.max(1, toX(delay + motions[kid]) - toX(delay)) }
      return {
        delay,
        motion: motions[kid],
        bar,
        wait: element('line', { class: 'wait', x1: toX(0), x2: bar.x, y1: y + height / 2, y2: y + height / 2 }),
        track: element('rect', { class: 'track', x: bar.x, y, width: bar.width, height, rx: Math.min(2, height / 2) }),
        fill: element('rect', { class: 'fill', x: bar.x, y, width: 0, height, rx: Math.min(2, height / 2) }),
      }
    })
    const bottom = MARGIN.top + plot
    attributes(playhead, { y1: MARGIN.top - 2, y2: bottom + 2 })
    svg.replaceChildren(...toAxis(bottom), ...rows.flatMap(({ wait, track, fill }) => [wait, track, fill]), playhead)
  }

  /** Where the run is, in milliseconds since it began, or null when it is not playing. */
  function at(elapsed) {
    playhead.setAttribute('visibility', elapsed === null ? 'hidden' : 'visible')
    elapsed !== null && ['x1', 'x2'].forEach(side => playhead.setAttribute(side, toX(Math.min(elapsed, end))))
    rows.forEach(({ delay, motion, bar, fill }) => {
      const progress = elapsed === null ? 0 : motion > 0 ? Math.min(1, Math.max(0, (elapsed - delay) / motion)) : elapsed >= delay ? 1 : 0
      fill.setAttribute('width', bar.width * progress)
    })
  }

  function toAxis(bottom) {
    const step = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find(step => end / step <= 5) ?? 10000
    const marks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step)
    return [
      element('line', { class: 'axis', x1: toX(0), x2: toX(end), y1: bottom + 3, y2: bottom + 3 }),
      ...marks.flatMap(at => [
        element('line', { class: 'axis', x1: toX(at), x2: toX(at), y1: bottom + 3, y2: bottom + 6 }),
        text(toX(at), bottom + 15, at === 0 ? '0' : at === marks.at(-1) ? `${at} ms` : String(at), at === 0 ? 'start' : toX(at) > width - MARGIN.right - 24 ? 'end' : 'middle'),
      ]),
    ]
  }

  function toX(ms) {
    return MARGIN.left + (ms / end) * (width - MARGIN.left - MARGIN.right)
  }
}

function text(x, y, content, anchor) {
  const label = element('text', { x, y, 'text-anchor': anchor })
  label.textContent = content
  return label
}

function element(name, attrs) {
  return attributes(document.createElementNS(SVG, name), attrs)
}

function attributes(target, attrs) {
  Object.entries(attrs).forEach(([name, value]) => target.setAttribute(name, value))
  return target
}
