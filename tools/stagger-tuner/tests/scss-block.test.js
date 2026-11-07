// Save writes what was tuned into the block of the app's stylesheet, as a person would: each value in its place, what is
// new after its kind, and nothing else of the file touched.

import test from 'node:test'
import assert from 'node:assert/strict'
import { holdsBlock, toSavedText } from '../scss-block.js'

const STYLESHEET = lines(
  '@use "themes";',
  '',
  '[ef-stagger="slideUpFade"] {',
  '  --stagger-span: 1710ms;',
  '  --stagger-step: 120ms; // the gap between items',
  '  --stagger-easing: cubic-bezier(0.93, 0.45, 1, 0.79);',
  '',
  '  > [stagger-state="init"] {',
  '    opacity: 0;',
  '    transform: translateX(20%) scale(0.9, 1);',
  '  }',
  '  > [stagger-state] {',
  '    transition-timing-function: cubic-bezier(0.2, 0.8, 0.33, 1);',
  '    transition-duration: 2000ms;',
  '  }',
  '}',
  '',
  '[ef-drama="scaleFade"] {',
  '  opacity: 0;',
  '}',
  '',
)


// IN PLACE

test('a tuned value takes the place of the one written, and a new one goes after the others of its rule', () => {
  const changes = {
    block: { '--stagger-span': '1600ms', '--stagger-easing': 'ease-out', '--stagger-overscan': '2' },
    pose: { transform: 'translateX(10%) scale(0.9, 1)' },
    motion: { 'transition-duration': '1200ms' },
  }
  assert.equal(toSavedText(STYLESHEET, 'slideUpFade', changes).text, STYLESHEET
    .replace('1710ms', '1600ms')
    .replace('cubic-bezier(0.93, 0.45, 1, 0.79);', 'ease-out;\n  --stagger-overscan: 2;')
    .replace('translateX(20%)', 'translateX(10%)')
    .replace('2000ms', '1200ms'))
})

test('a declaration goes in after a line with a comment, below the comment', () => {
  const text = lines(
    '[ef-stagger="x"] {',
    '  --stagger-span: 500ms; // the most the delay can be',
    '  > [stagger-state] {',
    '    transition: transform .5s ease;',
    '  }',
    '}',
  )
  assert.equal(toSavedText(text, 'x', { block: { '--stagger-step': '70ms' }, motion: { 'transition-duration': '300ms' } }).text, lines(
    '[ef-stagger="x"] {',
    '  --stagger-span: 500ms; // the most the delay can be',
    '  --stagger-step: 70ms;',
    '  > [stagger-state] {',
    '    transition: transform .5s ease;',
    '    transition-duration: 300ms;', // after the shorthand, which it would lose to before it
    '  }',
    '}',
  ))
})

test('a rule the block has yet goes in, the start pose before the motion, in the indent of the block', () => {
  const text = lines(
    '.list {',
    '    &[ef-stagger=\'x\'] {',
    '        --stagger-span: 1s;',
    '        // how they move',
    '        > [stagger-state] { transition-duration: 1s; }',
    '    }',
    '}',
  )
  assert.equal(toSavedText(text, 'x', { pose: { opacity: '0', translate: '0 8px' } }).text, lines(
    '.list {',
    '    &[ef-stagger=\'x\'] {',
    '        --stagger-span: 1s;',
    '        > [stagger-state="init"] {',
    '            opacity: 0;',
    '            translate: 0 8px;',
    '        }',
    '        // how they move',
    '        > [stagger-state] { transition-duration: 1s; }',
    '    }',
    '}',
  ))
  assert.equal(toSavedText(lines('[ef-stagger="x"] {', '  --stagger-span: 1s;', '}'), 'x', { pose: { opacity: '0' }, motion: { 'transition-duration': '1s' } }).text, lines(
    '[ef-stagger="x"] {',
    '  --stagger-span: 1s;',
    '  > [stagger-state="init"] {',
    '    opacity: 0;',
    '  }',
    '  > [stagger-state] {',
    '    transition-duration: 1s;',
    '  }',
    '}',
  ))
})

test('what the start pose no longer has goes, with its comment, and what it gains goes after what stays', () => {
  const text = lines(
    '[ef-stagger="x"] {',
    '  > [stagger-state="init"] {',
    '    opacity: 0;',
    '    filter: blur(4px); // soft',
    '  }',
    '}',
  )
  assert.equal(toSavedText(text, 'x', { pose: { filter: null, transform: 'translateY(12px)' } }).text, lines(
    '[ef-stagger="x"] {',
    '  > [stagger-state="init"] {',
    '    opacity: 0;',
    '    transform: translateY(12px);',
    '  }',
    '}',
  ))
})

test('a block on one line stays on one line', () => {
  const text = '[ef-stagger="x"] { --stagger-span: 1s; }\n'
  assert.equal(toSavedText(text, 'x', { block: { '--stagger-span': '2s', '--stagger-step': '70ms' }, motion: { 'transition-duration': '1s' } }).text,
    '[ef-stagger="x"] { --stagger-span: 2s; --stagger-step: 70ms; > [stagger-state] { transition-duration: 1s; } }\n')
})


// WHAT IT LEAVES ALONE

test('braces in comments, strings and interpolation are no rules', () => {
  const text = lines(
    '/* [ef-stagger="x"] { --stagger-span: 9s; } */',
    '.quote::before { content: "}"; }',
    '.icon { background: url(data:image/svg+xml;utf8,<svg/>); }',
    '[ef-stagger="x"] {',
    '  --stagger-span: 1s; // a } in a comment',
    '}',
    '.#{$theme} { color: red; }',
  )
  assert.equal(toSavedText(text, 'x', { block: { '--stagger-span': '2s' } }).text, text.replace('--stagger-span: 1s', '--stagger-span: 2s'))
})

test('a value that SCSS works out is left to whoever wrote it, and the save says so', () => {
  const text = lines('[ef-stagger="x"] {', '  --stagger-span: #{$span};', '  --stagger-step: 70ms;', '}')
  assert.deepEqual(toSavedText(text, 'x', { block: { '--stagger-span': '1s' } }), { problem: 'writes --stagger-span with SCSS of its own, #{$span}' })
  assert.equal(toSavedText(text, 'x', { block: { '--stagger-step': '80ms' } }).text, text.replace('70ms', '80ms')) // what isn't saved may be SCSS
})

test('a stylesheet without the block, or with it twice, is no place to save it', () => {
  assert.deepEqual(toSavedText('.a { color: red; }', 'x', { block: { '--stagger-span': '1s' } }), { problem: 'has no [ef-stagger="x"] block' })
  assert.deepEqual(toSavedText('[ef-stagger="x"] { } @media print { [ef-stagger="x"] { } }', 'x', {}), { problem: 'has [ef-stagger="x"] in 2 blocks' })
})

test('a quick look finds the block by its name, in either quotes', () => {
  assert.deepEqual(['[ef-stagger="a.b"] {', "&[ ef-stagger = 'a.b' ] {", '[ef-stagger="aXb"] {', '[ef-stagger=a.b] {'].map(text => holdsBlock(text, 'a.b')), [true, true, false, false])
})

function lines(...each) {
  return each.join('\n')
}
