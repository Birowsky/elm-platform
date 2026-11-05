module Views exposing (Msg(..), fancy, keyed, mapped, shallow)

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
    VirtualDom.lazyShallow viewShallow { lazyDummy = (), label = "shallow" }


fancy : Html Msg
fancy =
    VirtualDom.lazyFancy viewFancy { lazyDummy = (), label = "fancy" } { deep = "second argument" }


keyed : Html Msg
keyed =
    Html.Keyed.ul [ id "list" ]
        [ ( "a", Html.Lazy.lazy viewKid "a" )
        , ( "b", VirtualDom.lazyShallow viewShallow { lazyDummy = (), label = "b" } )
        ]


mapped : Html Msg
mapped =
    Html.map Wrapped shallow


viewShallow : { lazyDummy : (), label : String } -> Html Msg
viewShallow record =
    div [ class "card" ]
        [ text record.label
        , button [ id "button", onClick Clicked ] [ text "click" ]
        ]


viewFancy : { lazyDummy : (), label : String } -> { deep : String } -> Html Msg
viewFancy record { deep } =
    div [ class "card" ]
        [ text record.label
        , text deep
        , button [ id "button", onClick Clicked ] [ text "click" ]
        ]


viewKid : String -> Html Msg
viewKid key =
    li [ class "kid" ] [ text key ]
