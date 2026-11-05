// elm-explorations/test reads virtual-dom's nodes by their compiled field names,
// which it hard-codes (Test.Internal.KernelConstants). The compiler numbers those
// fields by their first appearance in VirtualDom.js, so a patch that introduces a
// field early breaks Test.Html in every app. The e2e suite proves it end to end;
// this says which line of the kernel did it, in a second.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const KERNEL = path.join(__dirname, '..', 'src', 'Elm', 'Kernel', 'VirtualDom.js');

const PINNED = { text: 'a', descendantsCount: 'b', tag: 'c', facts: 'd', kids: 'e', model: 'g', tagger: 'j', node: 'k', refs: 'l', thunk: 'm' };

test('the fields elm-explorations/test hard-codes keep their letters', () => {
  const source = fs.readFileSync(KERNEL, 'utf8').replace(/^\/\*[\s\S]*?\*\//, '');
  const fields = [...new Set([...source.matchAll(/(?<![\w$])__([a-z]\w*)/g)].map(match => match[1]))];
  const letters = Object.fromEntries(Object.keys(PINNED).map(field => [field, String.fromCharCode(97 + fields.indexOf(field))]));
  assert.deepEqual(letters, PINNED);
});
