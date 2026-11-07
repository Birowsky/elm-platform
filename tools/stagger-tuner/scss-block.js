// A block in the app's stylesheet, rewritten with what was tuned. A value goes where it is written, and one that isn't
// written yet goes in after the others of its rule, in the rule's own indent, so that the file reads as if written by
// hand. A value that SCSS works out, like $span or #{…}, is left to whoever wrote it: the save says so instead.

export {
  holdsBlock, // whether a stylesheet has the block, a quick look before reading it through
  toSavedText, // a stylesheet → the same, with values set in the block and in its rules
}

const SHAPE = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|url\([^)]*\)|#\{[^}]*\}|[{};]/g // what may hide a brace or a semicolon, and the braces and semicolons that give a stylesheet its shape
const COMMENTS = /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g
const DECLARATION = /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(--[\w-]+|-?[a-z][\w-]*)\s*:\s*([\s\S]*?)\s*;?\s*$/di
const SCSS = /\$|#\{|@/ // in a value that SCSS works out
const RULES = { // the block's own, as written, and as compared: with no spaces, and no & before them
  pose: { written: '> [stagger-state="init"]', compared: '>[stagger-state="init"]' },
  motion: { written: '> [stagger-state]', compared: '>[stagger-state]' },
}

function holdsBlock(text, name) {
  return new RegExp(`\\[\\s*ef-stagger\\s*=\\s*(["'])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1\\s*\\]`).test(text)
}

/** changes: { block, pose, motion }, each a property → its value, or null to take it out. Gives { text } or { problem }. */
function toSavedText(text, name, changes) {
  const blocks = rulesIn(toTree(text)).filter(rule => selectorOf(text, rule).split(',').some(part => part.endsWith(`[ef-stagger="${name}"]`)))
  if (blocks.length !== 1) return { problem: blocks.length === 0 ? `has no [ef-stagger="${name}"] block` : `has [ef-stagger="${name}"] in ${blocks.length} blocks` }
  const [block] = blocks
  const outer = indentAt(text, selectorStart(text, block))
  const inner = innerIndent(text, block) ?? `${outer}  `
  const unit = inner.length > outer.length ? inner.slice(outer.length) : '  '
  const edits = [
    ...declarationEdits(text, block, changes.block, inner),
    ...ruleEdits(text, block, 'pose', changes.pose, inner, unit),
    ...ruleEdits(text, block, 'motion', changes.motion, inner, unit),
  ]
  const problem = edits.find(edit => edit.problem)
  return problem ? { problem: problem.problem } : { text: applied(text, edits) }
}

/** Each value in place of the one written, a declaration taken out for null, and the new ones after the last that stays. */
function declarationEdits(text, rule, values = {}, indent) {
  const declarations = declarationsOf(text, rule)
  const entries = Object.entries(values)
  const writtenAs = property => declarations.filter(declaration => sameProperty(declaration.property, property))
  const scss = entries.flatMap(([property]) => writtenAs(property)).find(declaration => SCSS.test(declaration.value))
  if (scss) return [{ problem: `writes ${scss.property} with SCSS of its own, ${scss.value}` }]
  const removed = entries.filter(([, value]) => value === null).flatMap(([property]) => writtenAs(property))
  const added = entries.filter(([property, value]) => value !== null && writtenAs(property).length === 0)
  return [
    ...entries.filter(([, value]) => value !== null).flatMap(([property, value]) =>
      writtenAs(property).slice(-1).map(({ valueStart, valueEnd }) => ({ at: valueStart, end: valueEnd, text: value }))), // the last, which wins
    ...removed.map(declaration => removal(text, declaration)),
    ...added.length > 0 ? [insertion(text, rule, declarations.filter(declaration => !removed.includes(declaration)).at(-1), added.map(([property, value]) => `${property}: ${value};`), indent)] : [],
  ]
}

/** In the block's rule for the start pose or for the motion, which is written in when it isn't there yet. */
function ruleEdits(text, block, kind, values = {}, inner, unit) {
  const rule = block.rules.find(child => selectorOf(text, child).replace(/^&/, '') === RULES[kind].compared)
  if (rule) return declarationEdits(text, rule, values, innerIndent(text, rule) ?? inner + unit)
  const lines = Object.entries(values).filter(([, value]) => value !== null).map(([property, value]) => `${property}: ${value};`)
  return lines.length > 0 ? [newRule(text, block, kind, lines, inner, unit)] : []
}

/** At the end of the block, or for the start pose, before the motion, as the CSS box has them. */
function newRule(text, block, kind, lines, inner, unit) {
  const written = [`${inner}${RULES[kind].written} {`, ...lines.map(line => `${inner}${unit}${line}`), `${inner}}`].join('\n')
  const motion = kind === 'pose' ? block.rules.find(child => selectorOf(text, child).replace(/^&/, '') === RULES.motion.compared) : undefined
  const at = lineStartAt(text, motion ? preludeStart(text, motion) : block.close)
  return motion || /^[ \t]*$/.test(text.slice(at, block.close))
    ? { at, end: at, text: `${written}\n` }
    : { at: block.close, end: block.close, text: `${RULES[kind].written} { ${lines.join(' ')} } ` } // a block on one line
}

/** On lines of their own after the last declaration that stays, where it has a line of its own, or first thing in the rule. */
function insertion(text, rule, last, lines, indent) {
  if (!last) return { at: rule.open + 1, end: rule.open + 1, text: lines.map(line => `\n${indent}${line}`).join('') }
  if (!last.terminated) return { at: last.valueEnd, end: last.valueEnd, text: `;${lines.map(line => ` ${line}`).join('')}` } // the last of a rule, which may go without one
  const end = lineEndAt(text, last.end)
  return /^\s*(?:\/\/[^\n]*|\/\*.*\*\/\s*)?$/.test(text.slice(last.end, end))
    ? { at: end, end, text: lines.map(line => `\n${indent}${line}`).join('') }
    : { at: last.end, end: last.end, text: lines.map(line => ` ${line}`).join('') }
}

/** The declaration's line, with its comment, when it has one of its own, or else just the declaration. */
function removal(text, { propertyStart, end }) {
  const start = lineStartAt(text, propertyStart)
  const stop = lineEndAt(text, end)
  return /^[ \t]*$/.test(text.slice(start, propertyStart)) && /^\s*(?:\/\/[^\n]*)?$/.test(text.slice(end, stop))
    ? { at: start, end: Math.min(text.length, stop + 1), text: '' }
    : { at: propertyStart, end: end + /^[ \t]*/.exec(text.slice(end))[0].length, text: '' }
}

/** Later edits first, so that the places of the earlier ones hold. Two at one place keep their order. */
function applied(text, edits) {
  return edits.map((edit, order) => ({ ...edit, order }))
    .sort((a, b) => b.at - a.at || b.order - a.order)
    .reduce((result, { at, end, text: piece }) => result.slice(0, at) + piece + result.slice(end), text)
}


// THE SHAPE OF A STYLESHEET

/** Its rules, each with the rules and the declarations in it: where it starts, its braces, and the stretch of each declaration. */
function toTree(text) {
  const root = { start: 0, open: -1, close: text.length, rules: [], declarations: [] }
  const stack = [{ rule: root, from: 0 }]
  ;[...text.matchAll(SHAPE)].filter(([mark]) => mark === '{' || mark === '}' || mark === ';').forEach(({ 0: mark, index }) => {
    const top = stack.at(-1)
    if (mark === '{') {
      const rule = { start: top.from, open: index, close: text.length, rules: [], declarations: [] }
      top.rule.rules.push(rule)
      stack.push({ rule, from: index + 1 })
    } else if (mark === ';') {
      top.rule.declarations.push({ start: top.from, end: index + 1 })
      top.from = index + 1
    } else if (stack.length > 1) {
      top.rule.declarations.push({ start: top.from, end: index }) // the last, which may go without a semicolon
      top.rule.close = index
      stack.pop()
      stack.at(-1).from = index + 1
    }
  })
  return root
}

function rulesIn(rule) {
  return rule.rules.flatMap(child => [child, ...rulesIn(child)])
}

/** As compared: no comments, no spaces, double quotes. */
function selectorOf(text, rule) {
  return text.slice(rule.start, rule.open).replace(COMMENTS, '').replace(/\s+/g, '').replace(/'/g, '"')
}

function declarationsOf(text, rule) {
  return rule.declarations.map(({ start, end }) => {
    const match = DECLARATION.exec(text.slice(start, end))
    if (!match) return null // a comment, an @include, or nothing
    const [[propertyFrom], [valueFrom, valueTo]] = match.indices.slice(1)
    return { property: match[1], value: match[2], propertyStart: start + propertyFrom, valueStart: start + valueFrom, valueEnd: start + valueTo, end, terminated: text[end - 1] === ';' }
  }).filter(Boolean)
}

function sameProperty(written, property) {
  return written.startsWith('--') ? written === property : written.toLowerCase() === property.toLowerCase()
}

/** The indent of what is in the rule. */
function innerIndent(text, rule) {
  const first = Math.min(...declarationsOf(text, rule).map(({ propertyStart }) => propertyStart), ...rule.rules.map(child => selectorStart(text, child)))
  return Number.isFinite(first) ? indentAt(text, first) : undefined
}

function selectorStart(text, rule) {
  return rule.start + /^(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/.exec(text.slice(rule.start, rule.open))[0].length
}

/** Where the rule begins, a comment above it included. */
function preludeStart(text, rule) {
  return rule.start + /^\s*/.exec(text.slice(rule.start, rule.open))[0].length
}

function indentAt(text, position) {
  return /^[ \t]*/.exec(text.slice(lineStartAt(text, position)))[0]
}

function lineStartAt(text, position) {
  return text.lastIndexOf('\n', position - 1) + 1
}

function lineEndAt(text, position) {
  const end = text.indexOf('\n', position)
  return end === -1 ? text.length : end
}
