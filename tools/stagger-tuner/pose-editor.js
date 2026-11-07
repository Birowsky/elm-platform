// The start pose, as CSS to write by hand: a textarea, with a copy of its text behind it in colors, which shows through.
// The number at the caret is marked, and the keys step it in its own unit: Cmd, Ctrl or Alt with ↑ or ↓ by 1 in %, px or
// deg and by 0.01 with no unit, Shift with them by ten times that. A step goes through the browser's editing, so that its
// undo takes the step back.

export {
  poseEditor, // the textarea of a start pose, in colors, stepping the number at its caret
  toTokens, // CSS declarations → their pieces, each knowing what it is
  toStepped, // a number with its unit → one step up or down
}

const PIECES = { // what declarations are made of, tried in this order
  comment: /\/\*[\s\S]*?(?:\*\/|$)/,
  string: /"(?:[^"\\\n]|\\[\s\S])*"?|'(?:[^'\\\n]|\\[\s\S])*'?/,
  important: /!\s*important\b/,
  hash: /#[\w-]*/,
  number: /[-+]?\d*\.?\d+(?:%|[a-z]+)?/,
  name: /(?:--|-?[a-z_])[\w-]*/,
  space: /\s+/,
  mark: /[\s\S]/,
}
const KINDS = Object.keys(PIECES)
const PATTERN = new RegExp(Object.values(PIECES).map(piece => `(${piece.source})`).join('|'), 'giy')
const WHOLE_UNITS = /^(?:%|px|deg|grad|ms|[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))$/i // stepped by 1, like a percentage; any other unit, or none, by 0.01, like a ratio
const RANGES = new Map([['opacity', [0, 1]]]) // what the browser reads past an end as that end, so a step stops there; a percentage's ends are a hundred times these
const NUMBER = /^[-+]?\d*\.?\d+/ // of a number with its unit

/** onInput with each step, and onCommit once the typing or stepping pauses, the text is left, or on Cmd+Enter. */
function poseEditor(box, { onInput, onCommit }) {
  const textarea = box.querySelector('textarea')
  const colors = box.querySelector('pre')
  let stepping = false
  let pause = 0

  textarea.addEventListener('input', () => {
    paint()
    stepping && onInput(textarea.value)
    clearTimeout(pause)
    pause = setTimeout(commit, stepping ? 350 : 600) // a step is whole at once, as a nudge of a curve's handle is, while typing may not be done
  })
  textarea.addEventListener('change', commit)
  textarea.addEventListener('keydown', press)
  textarea.addEventListener('focus', paint)
  textarea.addEventListener('blur', paint)
  textarea.addEventListener('scroll', () => { colors.scrollTop = textarea.scrollTop })
  document.addEventListener('selectionchange', () => document.activeElement === textarea && paint())

  return { show }

  /** What the panel holds, unless it is being written. */
  function show(text) {
    if (document.activeElement === textarea || textarea.value === text) return
    textarea.value = text
    paint()
  }

  function commit() {
    clearTimeout(pause)
    onCommit(textarea.value)
  }

  /** The text in colors, with the number at the caret marked when the keys can step it. */
  function paint() {
    const tokens = toTokens(textarea.value)
    const marked = numberAtCaret(tokens)
    colors.replaceChildren(...tokens.map(token => token.kind === 'space' ? token.text : toSpan(token, token === marked)))

    function toSpan({ kind, text }, isMarked) {
      const span = document.createElement('span')
      span.className = isMarked ? `${kind} at-caret` : kind
      span.textContent = text
      return span
    }
  }

  function press(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') return commit()
    const direction = { ArrowUp: 1, ArrowDown: -1 }[event.key]
    const asked = direction && (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey)
    const number = asked ? numberAtCaret(toTokens(textarea.value)) : undefined
    if (!number) return // the keys move the caret, as they do anywhere else
    event.preventDefault()
    const stepped = toNext(number, direction, event.shiftKey)
    stepped !== undefined && step(number, stepped)
  }

  /** What a step makes of the number, if it changes it into something the browser takes. One that the browser takes no negative of, like blur()'s, stops at 0. */
  function toNext(number, direction, coarse) {
    const stepped = toStepped(number.text, direction, coarse, number.property)
    const belowZero = parseFloat(stepped) < 0 && parseFloat(number.text) >= 0
    return [stepped, ...belowZero ? [stepped.replace(NUMBER, '0')] : []]
      .find(text => parseFloat(text) !== parseFloat(number.text) && takes(withText(number, text), number.property))
  }

  /** Through the browser's editing, so that its undo takes the step back. A caret keeps its distance from the number's end. */
  function step(number, stepped) {
    const { selectionStart, selectionEnd } = textarea
    const end = number.start + stepped.length
    const caret = Math.max(number.start, end - (number.end - selectionEnd))
    textarea.setSelectionRange(number.start, number.end)
    stepping = true
    document.execCommand('insertText', false, stepped)
    stepping = false
    selectionStart === selectionEnd ? textarea.setSelectionRange(caret, caret) : textarea.setSelectionRange(number.start, end)
  }

  /** The number in a value that the caret is on, while the text has the focus, if a step either way can change it. */
  function numberAtCaret(tokens) {
    if (document.activeElement !== textarea) return undefined
    const { selectionStart, selectionEnd } = textarea
    const number = tokens.find(token => token.property && token.start <= selectionStart && selectionEnd <= token.end)
    return number && [1, -1].some(direction => toNext(number, direction, false) !== undefined) ? number : undefined
  }

  function withText(token, text) {
    return textarea.value.slice(0, token.start) + text + textarea.value.slice(token.end)
  }

  /** Whether the browser takes the property's declaration in the text, as it takes neither blur(-1px) nor translate: 0.01 8px. */
  function takes(text, property) {
    const style = document.createElement('div').style
    style.cssText = text
    return style.getPropertyValue(property) !== ''
  }
}

/** The pieces of declarations, which make up their whole text. A name is a property before its colon and a function before a parenthesis, and a number after the colon knows its property. */
function toTokens(text) {
  const pieces = [...text.matchAll(PATTERN)].map(match => ({ kind: KINDS[match.slice(1).findIndex(Boolean)], text: match[0], start: match.index, end: match.index + match[0].length }))
  return pieces.reduce(read, { tokens: [], name: null, property: null }).tokens

  function read({ tokens, name, property }, piece, i) {
    const token = piece.kind === 'name' ? { ...piece, kind: pieces[i + 1]?.text === '(' ? 'function' : property === null ? 'property' : 'word' }
      : piece.kind === 'number' && property !== null ? { ...piece, property }
      : piece
    return {
      tokens: [...tokens, token],
      name: piece.text === ';' ? null : token.kind === 'property' ? token.text : name,
      property: piece.text === ';' ? null : piece.text === ':' && property === null ? toPropertyName(name) : property,
    }
  }

  function toPropertyName(name) { // as the browser looks one up: a custom property as written, any other in any case
    return name === null ? '' : name.startsWith('--') ? name : name.toLowerCase()
  }
}

/** One step up or down in the number's own unit: by 1 in a whole unit like %, px or deg, by 0.01 in any other or none, and by ten times that when coarse. It stops at the ends of the property's range. */
function toStepped(text, direction, coarse, property) {
  const digits = NUMBER.exec(text)[0]
  const unit = text.slice(digits.length)
  const size = WHOLE_UNITS.test(unit) ? (coarse ? 10 : 1) : (coarse ? 0.1 : 0.01)
  const decimals = Math.max(decimalsOf(digits), decimalsOf(String(size))) // the finer of the two, so that 0.125 steps to 0.135, and 0.9 to 0.91
  const [low, high] = (RANGES.get(property) ?? [-Infinity, Infinity]).map(end => unit === '%' ? end * 100 : end)
  return `${Number(Math.min(high, Math.max(low, parseFloat(digits) + direction * size)).toFixed(decimals))}${unit}`

  function decimalsOf(number) {
    return number.split('.')[1]?.length ?? 0
  }
}
