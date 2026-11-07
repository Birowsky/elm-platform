# Stagger Tuner

A Chrome extension for designing the staggered entrance of a list (`ef-stagger`, see the main README). It replays a list's entrance in a loop, and gives you the curves, durations and start pose to shape while you watch it play on the page.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked**, and pick this folder.
3. Pin **Stagger Tuner** in the toolbar. Its button opens the panel beside the page.

After a `git pull`, press the reload arrow on its card in `chrome://extensions`. Nothing runs in a page until the panel is open for it.

## Use

Open the app, open the view with the list (Notifications, say), and open the panel.

- **Lists on this page**: every `[ef-stagger]` element, by its block name and the first words before it, like the title of its panel. Hover over one to outline it on the page, ⌖ scrolls to it, a click tunes it.
- **Loop** replays the entrance over and over (Space toggles it), **Once** plays it once. Speed slows everything down, delays included.
- **Kids** is how many kids a replay takes. All of them is what the kernel would take if the list arrived now: the ones in view, and the overscan. Fewer shows a small page arriving, which a step spreads over less time.
- **The timeline** has a bar per kid: it waits for its delay, then moves for its duration.
- **Spread** is when each kid starts: `--stagger-easing` as a curve, with a dot per kid (its place among them across, its delay up), and `--stagger-span`, `--stagger-step` and `--stagger-overscan`. The line under them says which of span and step decides the spread for this many kids, and the other one is dimmed.
- **Motion** is how each kid moves: `transition-timing-function` as a curve, with a dot per kid on its way, `transition-duration`, and the start pose, which is the `[stagger-state="init"]` rule.
- **CSS** is the block as your SCSS would write it, with what you changed highlighted. **Save** writes what you tuned into the app's stylesheet, Copy copies the block, and Reset goes back to the page's own CSS.

Every change you let go of plays the entrance again. Drag a handle, click beside the handles to bring the nearest one there, or move a focused handle with the arrow keys (Shift for bigger steps; Shift while dragging snaps to 0.05). A tuned value shows ↺, which takes it back to the page's.

The start pose is CSS in colors, and the number at the caret is marked. ⌘ or ⌥ with ↑ and ↓ (Ctrl or Alt off a Mac) step it by 1 in a unit counted in ones, like `%`, `px`, `deg` or `vh`, and by 0.01 in any other, like `em`, or with none. ⇧ with ↑ and ↓ steps ten times as far, and ⌘Z takes a step back. Opacity stays between 0 and 1, a number the browser takes no negative of, like `blur()`'s, stops at 0, and a bare `0` where a length goes isn't marked: write `0px` or `0%` to step it.

What you tune lies over the page's CSS until the panel closes, so the app's own staggers use it too: load more items, and the timeline shows the kernel's run. A reload keeps it. Once the page's CSS has a tuned value itself, as after a save, the value counts as the page's again.

Save changes only what you tuned, in the stylesheet that has `[ef-stagger="…"]`, as you would by hand: a value where it is written, a new one after the others of its rule, and of the start pose only the declarations that changed. Chrome lets an extension write only to a folder you pick, so the first save for an app asks for the folder of its sources, any folder above the stylesheet will do, and the tuner remembers it for that app. A new browser session may ask you to allow it again. The dev server then serves the stylesheet anew, and the page has your values.

## How it works

The panel injects `stagger.js` and `content.js` into the tab when it opens. A replay is the kernel's staggered entrance with every kid of the list taken as new: the same choice of kids, the same delays from the same `--stagger-*` values, and the same `stagger-state` and `--stagger-delay` on the DOM, removed when the last transition ends. `tests/replay.test.js` runs the kernel and the tuner on the same lists and expects the same result, so a change to the stagger in the kernel fails it until the tuner follows.

The page's own values are read with what is tuned switched off: the spread from the list's computed style, the start pose from the stylesheets, and the motion from a hidden stand-in, a list with the block's name and the list's classes holding one entered kid. The stand-in is there only for the read, in `<html>`, so the motion is known before the list has kids, as while its first page loads, and the app's list never sees a child come and go. An endless list fetches its next page when its children change.

What is tuned is a `<style>` with the block's own selectors and `!important`, put in `<html>`, outside the `<body>` that Elm owns. Motion goes on `[stagger-state="entered"]` only, since `init` must not transition.

## Limits

- The top frame of a tab only.
- The start pose is read from the page's stylesheets, so one that comes from another origin can't be read. What you write in the panel still wins over it.
- Motion is one duration and one curve for every property that transitions. When the page gives them different ones, the panel says so, and the CSS keeps them until you change them.
- The motion shown is the block's. A rule that depends on where the list is, like an ancestor's class, doesn't reach the stand-in, though a replay, which uses the real kids, follows it.
- Save needs the block in one stylesheet of the folder, and looks past `node_modules`, `elm-stuff` and folders whose names start with a dot. A block in SCSS wins over one in CSS, which is taken for built. A value that SCSS works out, like `$span` or `#{…}`, is left to you, and the panel says which.
