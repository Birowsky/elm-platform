module VirtualDom exposing
  ( Node
  , text, node, nodeNS
  , Attribute, style, property, attribute, attributeNS
  , on, Handler(..)
  , map, mapAttribute
  , keyedNode, keyedNodeNS, keyedLayers
  , lazy, lazy2, lazy3, lazy4, lazy5, lazy6, lazy7, lazy8
  , lazyShallow, lazyShallowDeep
  )

{-| API to the core diffing algorithm. Can serve as a foundation for libraries
that expose more helper functions for HTML or SVG.

# Create
@docs Node, text, node, nodeNS

# Attributes
@docs Attribute, style, property, attribute, attributeNS

# Events
@docs on, Handler

# Routing Messages
@docs map, mapAttribute

# Keyed Nodes
@docs keyedNode, keyedNodeNS, keyedLayers

# Lazy Nodes
@docs lazy, lazy2, lazy3, lazy4, lazy5, lazy6, lazy7, lazy8
@docs lazyShallow, lazyShallowDeep

-}

import Elm.Kernel.VirtualDom
import Json.Decode as Json


{-| An immutable chunk of data representing a DOM node. This can be HTML or SVG.
-}
type Node msg = Node


{-| Create a DOM node with a tag name, a list of HTML properties that can
include styles and event listeners, a list of CSS properties like `color`, and
a list of child nodes.

    import Json.Encode as Json

    hello : Node msg
    hello =
      node "div" [] [ text "Hello!" ]

    greeting : Node msg
    greeting =
      node "div"
        [ property "id" (Json.string "greeting") ]
        [ text "Hello!" ]
-}
node : String -> List (Attribute msg) -> List (Node msg) -> Node msg
node tag =
  Elm.Kernel.VirtualDom.node (Elm.Kernel.VirtualDom.noScript tag)


{-| Create a namespaced DOM node. For example, an SVG `<path>` node could be
defined like this:

    path : List (Attribute msg) -> List (Node msg) -> Node msg
    path attrubutes children =
      nodeNS "http://www.w3.org/2000/svg" "path" attributes children
-}
nodeNS : String -> String -> List (Attribute msg) -> List (Node msg) -> Node msg
nodeNS namespace tag =
  Elm.Kernel.VirtualDom.nodeNS namespace (Elm.Kernel.VirtualDom.noScript tag)


{-| Just put plain text in the DOM. It will escape the string so that it appears
exactly as you specify.

    text "Hello World!"
-}
text : String -> Node msg
text =
  Elm.Kernel.VirtualDom.text


{-| This function is useful when nesting components with [the Elm
Architecture](https://github.com/evancz/elm-architecture-tutorial/). It lets
you transform the messages produced by a subtree.

Say you have a node named `button` that produces `()` values when it is
clicked. To get your model updating properly, you will probably want to tag
this `()` value like this:

    type Msg = Click | ...

    update msg model =
      case msg of
        Click ->
          ...

    view model =
      map (\_ -> Click) button

So now all the events produced by `button` will be transformed to be of type
`Msg` so they can be handled by your update function!
-}
map : (a -> msg) -> Node a -> Node msg
map =
  Elm.Kernel.VirtualDom.map



-- ATTRIBUTES


{-| When using HTML and JS, there are two ways to specify parts of a DOM node.

  1. Attributes &mdash; You can set things in HTML itself. So the `class`
     in `<div class="greeting"></div>` is called an *attribute*.

  2. Properties &mdash; You can also set things in JS. So the `className`
     in `div.className = 'greeting'` is called a *property*.

So the `class` attribute corresponds to the `className` property. At first
glance, perhaps this distinction is defensible, but it gets much crazier.
*There is not always a one-to-one mapping between attributes and properties!*
Yes, that is a true fact. Sometimes an attribute exists, but there is no
corresponding property. Sometimes changing an attribute does not change the
underlying property. For example, as of this writing, the `webkit-playsinline`
attribute can be used in HTML, but there is no corresponding property!
-}
type Attribute msg = Attribute


{-| Specify a style.

    greeting : Node msg
    greeting =
      node "div"
        [ style "backgroundColor" "red"
        , style "height" "90px"
        , style "width" "100%"
        ]
        [ text "Hello!"
        ]

-}
style : String -> String -> Attribute msg
style =
  Elm.Kernel.VirtualDom.style


{-| Create a property.

    import Json.Encode as Encode

    buttonLabel : Node msg
    buttonLabel =
      node "label" [ property "htmlFor" (Encode.string "button") ] [ text "Label" ]

Notice that you must give the *property* name, so we use `htmlFor` as it
would be in JavaScript, not `for` as it would appear in HTML.
-}
property : String -> Json.Value -> Attribute msg
property key value =
  Elm.Kernel.VirtualDom.property
    (Elm.Kernel.VirtualDom.noInnerHtmlOrFormAction key)
    (Elm.Kernel.VirtualDom.noJavaScriptOrHtmlJson value)


{-| Create an attribute. This uses JavaScript’s `setAttribute` function
behind the scenes.

    buttonLabel : Node msg
    buttonLabel =
      node "label" [ attribute "for" "button" ] [ text "Label" ]

Notice that you must give the *attribute* name, so we use `for` as it would
be in HTML, not `htmlFor` as it would appear in JS.
-}
attribute : String -> String -> Attribute msg
attribute key value =
  Elm.Kernel.VirtualDom.attribute
    (Elm.Kernel.VirtualDom.noOnOrFormAction key)
    (Elm.Kernel.VirtualDom.noJavaScriptOrHtmlUri value)


{-| Would you believe that there is another way to do this?! This uses
JavaScript's `setAttributeNS` function behind the scenes. It is doing pretty
much the same thing as `attribute` but you are able to have namespaced
attributes. As an example, the `elm/svg` package defines an attribute
like this:

    xlinkHref : String -> Attribute msg
    xlinkHref value =
      attributeNS "http://www.w3.org/1999/xlink" "xlink:href" value
-}
attributeNS : String -> String -> String -> Attribute msg
attributeNS namespace key value =
  Elm.Kernel.VirtualDom.attributeNS
    namespace
    (Elm.Kernel.VirtualDom.noOnOrFormAction key)
    (Elm.Kernel.VirtualDom.noJavaScriptOrHtmlUri value)


{-| Transform the messages produced by a `Attribute`.
-}
mapAttribute : (a -> b) -> Attribute a -> Attribute b
mapAttribute =
  Elm.Kernel.VirtualDom.mapAttribute



-- EVENTS


{-| Create custom event handlers.

You can define `onClick` like this:

    import Json.Decode as Decode

    onClick : msg -> Attribute msg
    onClick msg =
      on "click" (Normal (Decode.succeed msg))

**Note:** These event handlers trigger in the bubble phase. You can learn more
about what that means [here][]. There is not support within Elm for doing
tricks with the capture phase. We recommend doing that in JS through ports.

[here]: https://github.com/elm/virtual-dom/blob/master/hints/capture-vs-bubble.md
-}
on : String -> Handler msg -> Attribute msg
on =
  Elm.Kernel.VirtualDom.on


{-| When using `on` you can customize the event behavior
a bit. There are two ways to do this:

  - [`stopPropagation`][sp] means the event stops traveling through the DOM.
  So if propagation of a click is stopped, it will not trigger any other event
  listeners.

  - [`preventDefault`][pd] means any built-in browser behavior related to the
  event is prevented. This can be handy with key presses or touch gestures.

**Note 1:** A [passive][] event listener will be created if you use `Normal`
or `MayStopPropagation`. In both cases `preventDefault` cannot be used, so
we can enable optimizations for touch, scroll, and wheel events in some
browsers.

**Note 2:** Some actions, like uploading and downloading files, are only
allowed when the JavaScript event loop is running because of user input. This
is for security! So when an event occurs, we call `update` and send any `port`
messages immediately, all within the same tick of the event loop. This makes
it possible to handle user-instigated events in ports.

**Note 3:** Normally the `view` is shown in the next `requestAnimationFrame`
call. This allows us to save some work if messages are coming in very quickly.
But if `stopPropagation` is used, we update the DOM immediately, within the
same tick of the event loop. This is useful for DOM nodes that hold their own
state, like `<input type="text">`. If someone types very fast, the state in the
DOM can diverge from the state in your `Model` while waiting on the next
`requestAnimationFrame` call. So updating the DOM synchronously makes this
divergence impossible.

[sp]: https://developer.mozilla.org/en-US/docs/Web/API/Event/stopPropagation
[pd]: https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault
[passive]: https://github.com/WICG/EventListenerOptions/blob/gh-pages/explainer.md
-}
type Handler msg
  = Normal (Json.Decoder msg)
  | MayStopPropagation (Json.Decoder (msg, Bool))
  | MayPreventDefault (Json.Decoder (msg, Bool))
  | Custom (Json.Decoder { message : msg, stopPropagation : Bool, preventDefault : Bool })



-- LAZY NODES


{-| A performance optimization that delays the building of virtual DOM nodes.

Calling `(view model)` will definitely build some virtual DOM, perhaps a lot of
it. Calling `(lazy view model)` delays the call until later. During diffing, we
can check to see if `model` is referentially equal to the previous value used,
and if so, we just stop. No need to build up the tree structure and diff it,
we know if the input to `view` is the same, the output must be the same!
-}
lazy : (a -> Node msg) -> a -> Node msg
lazy =
  Elm.Kernel.VirtualDom.lazy


{-| Same as `lazy` but checks on two arguments.
-}
lazy2 : (a -> b -> Node msg) -> a -> b -> Node msg
lazy2 =
  Elm.Kernel.VirtualDom.lazy2


{-| Same as `lazy` but checks on three arguments.
-}
lazy3 : (a -> b -> c -> Node msg) -> a -> b -> c -> Node msg
lazy3 =
  Elm.Kernel.VirtualDom.lazy3


{-| Same as `lazy` but checks on four arguments.
-}
lazy4 : (a -> b -> c -> d -> Node msg) -> a -> b -> c -> d -> Node msg
lazy4 =
  Elm.Kernel.VirtualDom.lazy4


{-| Same as `lazy` but checks on five arguments.
-}
lazy5 : (a -> b -> c -> d -> e -> Node msg) -> a -> b -> c -> d -> e -> Node msg
lazy5 =
  Elm.Kernel.VirtualDom.lazy5


{-| Same as `lazy` but checks on six arguments.
-}
lazy6 : (a -> b -> c -> d -> e -> f -> Node msg) -> a -> b -> c -> d -> e -> f -> Node msg
lazy6 =
  Elm.Kernel.VirtualDom.lazy6


{-| Same as `lazy` but checks on seven arguments.
-}
lazy7 : (a -> b -> c -> d -> e -> f -> g -> Node msg) -> a -> b -> c -> d -> e -> f -> g -> Node msg
lazy7 =
  Elm.Kernel.VirtualDom.lazy7


{-| Same as `lazy` but checks on eight arguments.
-}
lazy8 : (a -> b -> c -> d -> e -> f -> g -> h -> Node msg) -> a -> b -> c -> d -> e -> f -> g -> h -> Node msg
lazy8 =
  Elm.Kernel.VirtualDom.lazy8


{-| Same as `lazy`, for when eight arguments are not enough: pass one record with
as many fields as you need. Every field is checked by reference, as if it were an
argument of its own, so you can build the record anew on every call.

    lazyShallow viewCard
        { card = model.card
        , zone = model.zone
        }

The fields of a custom type value are checked the same way. Any other value has no
fields, so it is checked by reference itself, as `lazy` does.
-}
lazyShallow : (a -> Node msg) -> a -> Node msg
lazyShallow =
  Elm.Kernel.VirtualDom.lazyShallow


{-| Same as `lazyShallow`, plus a second argument that is checked with `(==)`
instead of by reference. Use it for a value that gets rebuilt on every call but
rarely changes.

`(==)` crashes when it reaches two different functions, so keep functions out of
the second argument.
-}
lazyShallowDeep : (a -> b -> Node msg) -> a -> b -> Node msg
lazyShallowDeep =
  Elm.Kernel.VirtualDom.lazyShallowDeep



-- KEYED NODES


{-| Works just like `node`, but you add a unique identifier to each child
node. You want this when you have a list of nodes that is changing: adding
nodes, removing nodes, etc. In these cases, the unique identifiers help make
the DOM modifications more efficient.
-}
keyedNode : String -> List (Attribute msg) -> List ( String, Node msg ) -> Node msg
keyedNode tag =
  Elm.Kernel.VirtualDom.keyedNode (Elm.Kernel.VirtualDom.noScript tag)


{-| Create a keyed and namespaced DOM node. For example, an SVG `<g>` node
could be defined like this:

    g : List (Attribute msg) -> List ( String, Node msg ) -> Node msg
    g =
      keyedNodeNS "http://www.w3.org/2000/svg" "g"
-}
keyedNodeNS : String -> String -> List (Attribute msg) -> List ( String, Node msg ) -> Node msg
keyedNodeNS namespace tag =
  Elm.Kernel.VirtualDom.keyedNodeNS namespace (Elm.Kernel.VirtualDom.noScript tag)


{-| Works just like `keyedNode`, for a stack of views that come and go with a CSS
transition. A kid takes part by having the attribute `transition-state` with the
value `"entering"`:

    keyedLayers "view-stack"
      [ "history" ]
      [ attribute "history" "back" ]
      [ ( "settings"
        , node "section"
            [ attribute "transition-state" "entering"
            , attribute "scrolling-context-selector" ".content"
            , attribute "class" "slide"
            ]
            [ settings ]
        )
      ]

From then on that attribute says what the kid is doing, and your CSS goes by it:

  - `"init"` is where a kid added to the stack starts its transition from. A kid
  that is there on the first render skips it, as nothing is transitioning yet.

  - `"entering"` is where it goes from there, and where it stays.

  - `"exiting"` is what a kid gets when you drop it. It stays in the DOM until the
  longest transition on the kid itself has ended. To transition something inside it
  for longer, give the kid a `transition-duration` of that length.

If you add the key of an exiting kid again, that same element goes back to
`"entering"`, so CSS turns the running transition around. It is patched to match the
new view, and it keeps its focus, scroll position and everything else. If it comes
back with another root element, or at another place in the stack, it is a new element
to the browser, so it starts from `"init"`.

An exiting kid is out of your view, so nothing you write can change it. The list of
strings names the attributes it copies from this node when it leaves, to let it
transition according to what the rest of the page is doing, like which way the user
is navigating. Coming back gives it its own values again.

If a kid has the attribute `scrolling-context-selector`, its scroll position is
remembered when it leaves, on itself or on the first element in it that the selector
finds. A new element with the same key gets that position back.

A kid without `transition-state` comes and goes at once, as in `keyedNode`.
-}
keyedLayers : String -> List String -> List (Attribute msg) -> List ( String, Node msg ) -> Node msg
keyedLayers tag =
  Elm.Kernel.VirtualDom.keyedLayers (Elm.Kernel.VirtualDom.noScript tag)



-- FOR INTERNAL USE ONLY


toHandlerInt : Handler msg -> Int
toHandlerInt handler =
  case handler of
    Normal _ -> 0
    MayStopPropagation _ -> 1
    MayPreventDefault _ -> 2
    Custom _ -> 3
