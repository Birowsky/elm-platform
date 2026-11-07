// The start pose is CSS written by hand, colored by what each piece of it is, and the number at the caret steps in its own
// unit. What the browser takes as a declaration, and the keys, are left to Chromium.

import test from 'node:test'
import assert from 'node:assert/strict'
import { toTokens, toStepped } from '../pose-editor.js'


// THE COLORS

test('a start pose is colored by what each piece of it is', () => {
  const pose = 'opacity: 0;\ntransform: translateX(10%) scale(.9, 1) !important; /* from the left */\ntransition: none'
  assert.deepEqual(toTokens(pose).filter(({ kind }) => kind !== 'space').map(({ kind, text }) => `${kind} ${text}`), [
    'property opacity', 'mark :', 'number 0', 'mark ;',
    'property transform', 'mark :', 'function translateX', 'mark (', 'number 10%', 'mark )',
    'function scale', 'mark (', 'number .9', 'mark ,', 'number 1', 'mark )', 'important !important', 'mark ;',
    'comment /* from the left */',
    'property transition', 'mark :', 'word none',
  ])
})

test('the pieces make up the whole text, however it is written', () => {
  const texts = ['', 'opacity:0', 'transform: translateY(20%', 'content: "a;b', '/* half a comment', 'ä: ¿?', '--x: { 1 }']
  texts.forEach(text => {
    const tokens = toTokens(text)
    assert.equal(tokens.map(token => token.text).join(''), text)
    assert.ok(tokens.every((token, i) => token.start === (tokens[i - 1]?.end ?? 0) && token.end === token.start + token.text.length), text)
  })
})

test('a number in a name is part of the name, and a color is no number', () => {
  const numbers = toTokens('transform: translate3d(0, -4px, 0); --gap-2: 3px; color: #12a4b6; background: rgb(0 0 0 / 50%)')
    .filter(({ kind }) => kind === 'number')
  assert.deepEqual(numbers.map(({ text, property }) => `${property} ${text}`), [
    'transform 0', 'transform -4px', 'transform 0', '--gap-2 3px', 'background 0', 'background 0', 'background 0', 'background 50%',
  ])
})

test('a number knows the property of its declaration, which is looked up in any case but a custom one\'s', () => {
  const properties = toTokens('Opacity: 0; --Gap: 2px; 5: 1').filter(({ kind }) => kind === 'number').map(({ property }) => property)
  assert.deepEqual(properties, ['opacity', '--Gap', undefined, '']) // a number before a colon is no value, and neither is one after a colon with no name
})


// THE STEPS

test('a number steps by 1 in %, px or deg and by 0.01 with no unit, and by ten times that when coarse', () => {
  assert.deepEqual(['10%', '10%', '0.9', '0.9', '-3deg', '12px'].map((number, i) => toStepped(number, 1, i % 2 === 1)),
    ['11%', '20%', '0.91', '1', '-2deg', '22px'])
  assert.deepEqual(['10%', '0', '0.05', '1vh'].map(number => toStepped(number, -1, true)), ['0%', '-0.1', '-0.05', '-9vh'])
})

test('a unit counted in ones steps like a percentage, and any other like a ratio', () => {
  assert.deepEqual(['2ms', '5dvh', '3cqi', '0.5em', '0.25turn', '1.2s', '0.5rem'].map(number => toStepped(number, 1, false)),
    ['3ms', '6dvh', '4cqi', '0.51em', '0.26turn', '1.21s', '0.51rem'])
})

test('opacity stops at 0 and at 1, or at 0% and 100%, while a number that means something below 0 goes there', () => {
  const steps = [['0', -1, false], ['0.05', -1, true], ['0.95', 1, true], ['1', 1, false], ['5%', -1, true], ['95%', 1, true]]
  assert.deepEqual(steps.map(([number, direction, coarse]) => toStepped(number, direction, coarse, 'opacity')), ['0', '0', '1', '1', '0%', '100%'])
  assert.deepEqual([['scale', '0'], ['translate', '0.5%'], ['constructor', '0']].map(([property, number]) => toStepped(number, -1, false, property)), ['-0.01', '-0.5%', '-0.01'])
})

test('a step keeps the decimals the number was written with', () => {
  assert.deepEqual(['.9', '0.125', '12.5%', '0.99', '-0.01', '+4px'].map(number => toStepped(number, 1, false)),
    ['0.91', '0.135', '13.5%', '1', '0', '5px'])
})
