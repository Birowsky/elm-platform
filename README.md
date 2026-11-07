# elm-platform

The Elm compiler and patched core libraries, released to apps as one tested version: [`@birowsky/elm-platform`](npm/elm-platform/README.md). It exists so that fixes and features can ship on our schedule. It is **unofficial**, and not affiliated with or endorsed by the Elm project or Evan Czaplicki.

```
compiler/                  elm/compiler, as a git subtree
packages/elm/virtual-dom/  elm/virtual-dom, as a git subtree
npm/elm-platform/          the npm package: the `elm` wrapper
e2e/                       test apps compiled with the packed package and run in real browsers
```

Each patch is its own commit on top of upstream, so `git log -- packages/elm/virtual-dom` lists how we differ.

```bash
npm ci
npm test       # kernel tests, wrapper tests
npm run e2e    # needs: npx playwright install chromium webkit
```

See [AGENTS.md](AGENTS.md) for how to change things and how to release.

## Transitions and animations in the virtual DOM

Elm removes a node the moment a view stops producing it, so there is nothing left to transition. Two patches of `elm/virtual-dom` fix that for keyed nodes. The view only says *what* is shown. The kernel looks at the DOM, the one place that knows what is leaving, what is on screen and what was shown before, and **CSS owns the look**: durations, easings, distances and spreads are all CSS, written in the app's SCSS. Nothing is added to a vnode, so no diff sees any of it, and a view that doesn't opt in pays nothing.

| | For | Opt in with |
|---|---|---|
| [Layers](#layers-keyed-kids-that-leave-with-a-transition) | a stack of views that come and go: pages, panels, modals, tooltips | `VirtualDom.keyedLayers` |
| [Staggered entrance](#staggered-entrance-kids-that-come-in-one-after-another) | the items a list gets later, coming in one after another | the attribute `ef-stagger` on a keyed node |

Both go by an attribute on the DOM that the kernel writes and removes, so the SCSS is a set of selectors on those attributes.

### Layers: keyed kids that leave with a transition

```elm
VirtualDom.keyedLayers "div"                          -- the tag of the stack
    [ "history" ]                                     -- attributes an exiting kid copies from the stack
    [ attribute "ef-drama" "slideFade"                -- the stack's own attributes
    , attribute "history" "forward"
    ]
    [ ( "settings"                                    -- the key
      , Html.node "section"
            [ attribute "transition-state" "entering" -- takes part in transitions
            , attribute "ef-drama" "slideFade"
            , attribute "scrolling-context-selector" ".content"
            ]
            [ settings ]
      )
    ]
```

A kid takes part by having `transition-state="entering"`. A kid without it comes and goes at once, as in `keyedNode`. The kernel then moves the attribute through three values, and the SCSS goes by them:

| `transition-state` | When | Your CSS says |
|---|---|---|
| `init` | A kid *added* to the stack. A kid there on the first render skips it. | where the transition starts from |
| `entering` | Right after `init`, and where it stays. | where it rests |
| `exiting` | The view dropped the kid. It stays in the DOM until the longest transition on the kid itself has ended, and is then removed. | where it goes |

The view never writes `init` or `exiting`, so no diff sees them. An exiting kid doesn't count as part of the stack: it is skipped wherever a kid is found by position.

Behavior you get for it:

- **Turning around.** If the key of an exiting kid comes back, that same element goes back to `entering`, patched to the new view, and CSS turns the running transition around. It keeps its focus, scroll position and inner state. If it comes back with another root element, or at another place in the stack, it is a new element and starts from `init`.
- **Direction.** An exiting kid can't be changed by the view, so the list of attribute names (`[ "history" ]` above) names what it copies from the stack when it leaves, like which way the user is navigating. Coming back gives it its own values again.
- **`transition-order`.** A kid with a number in `transition-order` comes in from the forward side when its number is higher than that of the kid that left last, and from the other side when it is lower, and that kid leaves the same way. The view never knows what was shown before, so the kernel decides, and sets `history` on both on the DOM only. Kids with equal numbers, or none, go by the `history` of the stack.
- **Scroll position.** A kid with `scrolling-context-selector` has the scroll position of itself, or of the first element in it that the selector finds, remembered when it leaves. A new element with the same key gets it back.
- **Longer transitions inside a kid.** The kid stays for the longest transition on *itself*. To transition something inside it for longer, give the kid a `transition-duration` of that length.

#### In SCSS

Name a block with an attribute on the kid, and write the three states in it. This one slides a page in from the side it is going to, and out the side it came from:

```scss
[ef-drama="slideFade"] {
  transition:
    transform 0.8s ease,
    opacity 0.5s linear;
  will-change: transform, opacity;

  &[transition-state="init"] {
    opacity: 0;

    &[history="forward"] { transform: translateX(100%); }
    &[history="back"]    { transform: translateX(-100%); }
  }

  &[transition-state="entering"] {
    transform: translateX(0);
    opacity: 1;
  }

  &[transition-state="exiting"] {
    opacity: 0;

    &[history="forward"] { transform: translateX(-100%); }
    &[history="back"]    { transform: translateX(100%); }
  }
}
```

Things to know when writing them:

- **Rest at `entering`, start from `init`, leave to `exiting`.** The base rule (no `transition-state`) holds the transition and what is shared. A block that has no `init` rule of its own can start from its base rule, as `scaleFade` does:

  ```scss
  [ef-drama="scaleFade"] {
    opacity: 0;
    transform: scale(.8);
    transition: transform 0.8s ease, opacity 0.5s linear;

    &[transition-state="entering"] { opacity: 1; transform: none; }
  }
  ```

- **Different timing on the way out** goes in the `exiting` rule, which can also set `transition-duration` to keep the kid for longer:

  ```scss
  [ef-drama="simpleModalTransition"] {
    .modalContentWrap {
      opacity: 0;
      transform: rotateX(-7deg) scale(.92);
      transition: transform 1.3s cubic-bezier(0.25, 1.4, 0.2, 1), opacity 0.2s linear;
    }

    &[transition-state="entering"] .modalContentWrap { opacity: 1; transform: none; }

    &[transition-state="exiting"] {
      transition-duration: 3s; // the kid stays this long, for whatever inside it is slower
      .modalContentWrap {
        opacity: 0;
        transform: rotateX(30deg) scale(.9);
        transition: transform .5s cubic-bezier(0.5, 0, .9, 1), opacity .5s ease-out;
      }
    }
  }
  ```

- **Nothing may react to an exiting kid.** It is out of your view, so a click would reach a handler of a view that is gone. Switch it off for the stack, once:

  ```scss
  [ef-drama] > [transition-state="exiting"] { pointer-events: none; }
  ```

- **No transition at all** is a kid without `transition-state`, or a stack whose CSS has no transition on it.

### Staggered entrance: kids that come in one after another

Put `ef-stagger="name"` on a keyed node, and the kids that a patch adds to it later come in one after another instead of all at once. What the view kept from before, like the items of an earlier load, is there on the first render, which adds nothing through a patch, so it stays still.

```elm
Html.Keyed.node "div"
    [ attribute "ef-stagger" "slideUpFade" ]
    (List.map toKeyedItem items)
```

Only the kids on screen take part: those in view of the scrolling ancestor, and `--stagger-overscan` more on each side, which is as far as the kernel measures. The rest come at once, so the work is bounded by what is on screen, not by the length of the list.

The delay of the kid at place *i* of *n* is

```
total = min(--stagger-span, (n - 1) * --stagger-step)      // without a step: --stagger-span
delay = total * --stagger-easing(i / (n - 1))
```

so two kids don't wait the whole span, and a long run is spread over the span with the easing. The kernel gives each kid `--stagger-delay` and a `stagger-state` of `init`, then `entered`, on the DOM only, and removes both when the last transition has ended.

#### In SCSS

The block's own values are custom properties on the node. Your CSS says how a kid starts and how it moves, and uses `--stagger-delay` as the delay of its transition:

```scss
// The base of every [ef-stagger] block, written once.
[ef-stagger] {
  --stagger-span: 500ms;       // the most the delay of the last kid can be
  --stagger-step: 70ms;        // the gap between kids; a few kids spread over fewer gaps than the span
  --stagger-easing: ease-out;  // how delays spread between 0 and the span (any CSS easing)
  --stagger-overscan: 3;       // kids past the visible ones that are staggered too

  > [stagger-state] {
    transition:
      transform .5s ease var(--stagger-delay, 0ms),
      opacity .5s ease var(--stagger-delay, 0ms);
    will-change: transform, opacity;
  }

  // the kernel measures a kid at rest and then sends it to init, which must not transition
  > [stagger-state="init"] { transition: none; }

  @media (prefers-reduced-motion: reduce) {
    > [stagger-state] { transition: none; }
  }
}

// A named block says only what differs.
[ef-stagger="slideUpFade"] {
  --stagger-span: 1600ms;
  --stagger-easing: cubic-bezier(0.4, 0, 1, 0.56);

  > [stagger-state="init"] {
    opacity: 0;
    transform: translateY(20%) scale(.8, .9);
  }
  > [stagger-state] {
    transition-timing-function: cubic-bezier(.2, .8, .2, 1);
    transition-duration: 2s;
  }
}
```

A kid rests with no `stagger-state` at all, so what it is at rest is its normal style, and the `init` rule is the only place that says where it comes from. `init` must have `transition: none`, because the kernel puts the kid there after measuring it.

### Rules for both

- **Opt in on the node, in the view's own words**: an attribute or a constructor, no global switch.
- **The kernel writes DOM-only state** (`transition-state`, `history`, `stagger-state`, `--stagger-delay`), never in a vnode, and removes it when the feature is done.
- **CSS owns the design.** The kernel reads `--stagger-*` once per patch, from a style flush it needs anyway.
- **Respect reduced motion** in the SCSS, as above.

The apps' Elm side is a thin wrapper over these, like `transitionableViewLayers` (which writes `transition-state`, `history` and the `ef-drama` name) and `staggeredEntrance "slideUpFade"` (which is `attribute "ef-stagger"`). The e2e app `e2e/apps/layers` shows the raw use of layers, and `packages/elm/virtual-dom/tests/layers.test.js` and `stagger.test.js` hold the behavior.

## License

BSD-3-Clause, like everything it is built from. `compiler/LICENSE` and each package's `LICENSE` keep their upstream notices.
