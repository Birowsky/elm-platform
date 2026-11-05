// Loads src/Elm/Kernel/VirtualDom.js the way the Elm compiler would in
// --optimize mode, with just enough of the rest of the runtime stubbed out
// to build, render, diff and patch views in jsdom.

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const KERNEL = path.join(__dirname, '..', 'src', 'Elm', 'Kernel', 'VirtualDom.js');

const EXPORTS = [
  '_VirtualDom_node', '_VirtualDom_keyedNode', '_VirtualDom_text', '_VirtualDom_attribute',
  '_VirtualDom_map', '_VirtualDom_lazy', '_VirtualDom_render', '_VirtualDom_diff',
  '_VirtualDom_applyPatches',
];

function load() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');

  let src = fs.readFileSync(KERNEL, 'utf8');
  src = src.replace(/^\/\*[\s\S]*?\*\//, '');   // the import header
  src = src.split('/**__PROD/').join('/**/');      // turn on --optimize blocks

  // kernel enums like __2_NODE become distinct constants
  const enums = [...new Set(src.match(/(?<![\w$])__\d_[A-Z_]+/g))];

  const prelude = `
    ${enums.map(e => `var ${e} = '${e}';`).join('\n')}
    function F(arity, fun) {
      function curried(a) { return arity === 1 ? fun(a) : F(arity - 1, function () {
        return fun.apply(null, [a].concat([].slice.call(arguments))); }); }
      curried.a = arity; curried.f = fun; return curried;
    }
    function F2(f) { return F(2, f); } function F3(f) { return F(3, f); } function F4(f) { return F(4, f); }
    function F5(f) { return F(5, f); } function F6(f) { return F(6, f); } function F7(f) { return F(7, f); }
    function F8(f) { return F(8, f); } function F9(f) { return F(9, f); }
    function An(f, args) { return f.a === args.length ? f.f.apply(null, args) : args.reduce(function (g, x) { return g(x); }, f); }
    function A2(f, a, b) { return An(f, [a, b]); } function A3(f, a, b, c) { return An(f, [a, b, c]); }
    function A4(f, a, b, c, d) { return An(f, [a, b, c, d]); }
    var __List_Nil = { $: 0 };
    function __List_Cons(a, b) { return { $: 1, a: a, b: b }; }
    function __Utils_Tuple2(a, b) { return { $: '#2', a: a, b: b }; }
    function __Debug_crash(n) { throw new Error('Debug.crash ' + n); }
    function __Json_unwrap(x) { return x; } function __Json_wrap(x) { return x; }
    var __Json_equality, __Json_map, __Json_map2, __Json_runHelp, __Json_succeed, __Platform_export,
        __Result_isOk, __VirtualDom_toHandlerInt, __Basics_identity = function (x) { return x; };
  `;

  const factory = new Function('window', 'document', 'navigator',
    prelude + src + `\nreturn { ${EXPORTS.map(n => `${n}: ${n}`).join(', ')} };`);
  const k = factory(window, window.document, window.navigator);

  const list = xs => xs.reduceRight((tail, x) => ({ $: 1, a: x, b: tail }), { $: 0 });

  return {
    window,
    document: window.document,
    node: (tag, attrs, kids) => k._VirtualDom_node(tag).f(list(attrs || []), list(kids || [])),
    keyed: (tag, attrs, pairs) =>
      k._VirtualDom_keyedNode(tag).f(list(attrs || []), list(pairs.map(([key, kid]) => ({ $: '#2', a: key, b: kid })))),
    text: s => k._VirtualDom_text(s),
    attr: (key, value) => k._VirtualDom_attribute.f(key, value),
    map: (tagger, node) => k._VirtualDom_map.f(tagger, node),
    lazy: (fn, arg) => k._VirtualDom_lazy.f(fn, arg),
    render: vnode => k._VirtualDom_render(vnode, function () {}),
    diff: k._VirtualDom_diff,
    applyPatches: (dom, old, patches) => k._VirtualDom_applyPatches(dom, old, patches, function () {}),
  };
}

module.exports = { load };
