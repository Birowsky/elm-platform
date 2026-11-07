// The arithmetic of the kernel's staggered entrance, as in packages/elm/virtual-dom/src/Elm/Kernel/VirtualDom.js, for
// both sides of the tuner: the page, where a list's entrance is replayed, and the panel, where it is drawn.
// tests/replay.test.js holds the replay to what the kernel does. A classic script, since the page side can't import.

var Stagger = (() => { // var, so that the page side can be injected again
  const namedCurves = {
    'linear': [0, 0, 1, 1],
    'ease': [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1],
  }

  return {
    namedCurves,
    toMilliseconds, // '1.6s' or '1600ms' → 1600
    toCurve, // a CSS easing → its four numbers, or null where the kernel goes linear
    toEasing, // four numbers → a function from the progress of time to the progress of the value
    toSpread, // the time the delays of a run spread over
    toDelays, // the delay of each kid of a run
    toCurveText, // four numbers → cubic-bezier(…)
  }

  /** A custom property keeps the text it was written with. */
  function toMilliseconds(text) {
    const number = parseFloat(text)
    return isNaN(number) ? 0 : /ms\s*$/.test(text) ? number : number * 1000
  }

  /** A keyword, or cubic-bezier() with both x in [0, 1]. */
  function toCurve(text) {
    const name = String(text).trim()
    const match = /^cubic-bezier\(([^)]*)\)$/.exec(name)
    const points = match ? match[1].split(',').map(parseFloat) : Object.hasOwn(namedCurves, name) ? namedCurves[name] : null
    const valid = points && points.length === 4 && points.every(isFinite) && points[0] >= 0 && points[0] <= 1 && points[2] >= 0 && points[2] <= 1
    return valid ? points : null
  }

  function toEasing(curve) {
    const [x1, y1, x2, y2] = curve || namedCurves.linear

    return progress => {
      if (progress <= 0 || progress >= 1) return Math.max(0, Math.min(1, progress))
      const { t } = Array.from({ length: 24 }).reduce(halve, { low: 0, high: 1, t: progress }) // x(t) rises with t, so find the t of this progress by halving, as often as the kernel does
      return bezierAt(t, y1, y2)

      function halve({ low, high }) {
        const t = (low + high) / 2
        return bezierAt(t, x1, x2) < progress ? { low: t, high, t } : { low, high: t, t }
      }
    }

    function bezierAt(t, a, b) {
      const u = 1 - t
      return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
    }
  }

  /** A few kids have no use for the whole span: with a step, they spread over a step per gap. */
  function toSpread(count, span, step) {
    return step > 0 ? Math.min(span, (count - 1) * step) : span
  }

  function toDelays(count, span, step, easing) {
    const spread = toSpread(count, span, step)
    return Array.from({ length: count }, (_, place) =>
      Math.round(spread * easing(count > 1 ? place / (count - 1) : 0) * 10) / 10) // to a tenth of a millisecond, as the halving is not exact
  }

  function toCurveText(points) {
    return `cubic-bezier(${points.map(number => String(Math.round(number * 1000) / 1000)).join(', ')})`
  }
})()
