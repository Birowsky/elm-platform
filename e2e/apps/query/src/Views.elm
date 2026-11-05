module Views exposing (Msg(..), shallowDeep, keyed, keyedLayers, mapped, shallow)

import Html exposing (Html, button, div, li, text)
import Html.Attributes exposing (class, id)
import Html.Events exposing (onClick)
import Html.Keyed
import Html.Lazy
import VirtualDom


type Msg
    = Clicked
    | Wrapped Msg


shallow : Html Msg
shallow =
    VirtualDom.lazyShallow viewShallow { label = "shallow" }


shallowDeep : Html Msg
shallowDeep =
    VirtualDom.lazyShallowDeep viewShallowDeep { label = "shallow deep" } { deep = "second argument" }


keyed : Html Msg
keyed =
    Html.Keyed.ul [ id "list" ]
        [ ( "a", Html.Lazy.lazy viewKid "a" )
        , ( "b", VirtualDom.lazyShallow viewShallow { label = "b" } )
        ]


keyedLayers : Html Msg
keyedLayers =
    VirtualDom.keyedLayers "ul"
        [ "history" ]
        [ id "layers" ]
        [ ( "a", Html.Lazy.lazy viewKid "a" )
        , ( "b", Html.Lazy.lazy viewKid "b" )
        ]


mapped : Html Msg
mapped =
    Html.map Wrapped shallow


viewShallow : { label : String } -> Html Msg
viewShallow record =
    div [ class "card" ]
        [ text record.label
        , button [ id "button", onClick Clicked ] [ text "click" ]
        ]


viewShallowDeep : { label : String } -> { deep : String } -> Html Msg
viewShallowDeep record { deep } =
    div [ class "card" ]
        [ text record.label
        , text deep
        , button [ id "button", onClick Clicked ] [ text "click" ]
        ]


viewKid : String -> Html Msg
viewKid key =
    li [ class "kid" ] [ text key ]
