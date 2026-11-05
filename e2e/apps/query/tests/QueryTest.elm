module QueryTest exposing (suite)

{-| elm-explorations/test reads virtual-dom's nodes by field names it hard-codes, so these fail
if a patch to the kernel moves one of them. Each query goes through a different one: kids, facts,
tags, text, refs, thunks, taggers.
-}

import Expect
import Html.Attributes
import Test exposing (Test, describe, test)
import Test.Html.Event as Event
import Test.Html.Query as Query
import Test.Html.Selector as Selector
import Views exposing (Msg(..))


suite : Test
suite =
    describe "Test.Html sees through the patched virtual-dom"
        [ test "text inside lazyShallow" <|
            \_ ->
                Views.shallow
                    |> Query.fromHtml
                    |> Query.has [ Selector.text "shallow" ]
        , test "text and the second argument inside lazyShallowDeep" <|
            \_ ->
                Views.shallowDeep
                    |> Query.fromHtml
                    |> Query.has [ Selector.text "shallow deep", Selector.text "second argument" ]
        , test "tags and classes inside a lazy node" <|
            \_ ->
                Views.shallowDeep
                    |> Query.fromHtml
                    |> Query.has [ Selector.tag "div", Selector.class "card" ]
        , test "keyed kids that are lazy" <|
            \_ ->
                Views.keyed
                    |> Query.fromHtml
                    |> Query.findAll [ Selector.tag "li" ]
                    |> Query.count (Expect.equal 1)
        , test "attributes of a keyed parent" <|
            \_ ->
                Views.keyed
                    |> Query.fromHtml
                    |> Query.has [ Selector.attribute (Html.Attributes.id "list") ]
        , test "kids of keyed layers" <|
            \_ ->
                Views.keyedLayers
                    |> Query.fromHtml
                    |> Query.findAll [ Selector.class "kid" ]
                    |> Query.count (Expect.equal 2)
        , test "attributes of keyed layers" <|
            \_ ->
                Views.keyedLayers
                    |> Query.fromHtml
                    |> Query.has [ Selector.attribute (Html.Attributes.id "layers") ]
        , test "an event inside lazyShallow" <|
            \_ ->
                Views.shallow
                    |> Query.fromHtml
                    |> Query.find [ Selector.tag "button" ]
                    |> Event.simulate Event.click
                    |> Event.expect Clicked
        , test "an event inside lazyShallowDeep" <|
            \_ ->
                Views.shallowDeep
                    |> Query.fromHtml
                    |> Query.find [ Selector.tag "button" ]
                    |> Event.simulate Event.click
                    |> Event.expect Clicked
        , test "an event through Html.map" <|
            \_ ->
                Views.mapped
                    |> Query.fromHtml
                    |> Query.find [ Selector.tag "button" ]
                    |> Event.simulate Event.click
                    |> Event.expect (Wrapped Clicked)
        ]
