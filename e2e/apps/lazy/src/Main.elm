port module Main exposing (main)

{-| Everything the browser tests exercise.

A skipped view leaves no trace in the DOM, so views read `external`, a JavaScript object the
test can change without Elm noticing. Elm holds the same reference throughout, so the lazy
nodes see no change: a view that really ran shows the new value, a skipped one the old value.

-}

import Browser
import Html exposing (Html, button, div, input, li, p, span, text)
import Html.Attributes exposing (id)
import Html.Events exposing (onClick)
import Html.Keyed
import Html.Lazy
import Json.Decode as Decode exposing (Value)
import VirtualDom


port command : (String -> msg) -> Sub msg


type alias Model =
    { external : Value
    , ticks : Int
    , field : Int
    , items : List Int
    , deep : Deep
    , position : Position
    , clicks : Int
    , mappedClicks : Int
    , keys : List String
    , handler : Int -> Int
    }


type alias Deep =
    { n : Int
    , nested : List String
    }


type Position
    = ShowLazy
    | ShowFancy
    | ShowShallow
    | ShowPlain


type Msg
    = Command String
    | Clicked
    | Mapped MappedMsg


type MappedMsg
    = MappedClicked


main : Program Value Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = \_ -> command Command
        }


init : Value -> ( Model, Cmd Msg )
init external =
    ( { external = external
      , ticks = 0
      , field = 0
      , items = [ 1, 2, 3 ]
      , deep = { n = 0, nested = [ "a", "b" ] }
      , position = ShowLazy
      , clicks = 0
      , mappedClicks = 0
      , keys = [ "a", "b", "c", "d" ]
      , handler = increment
      }
    , Cmd.none
    )


increment : Int -> Int
increment n =
    n + 1


decrement : Int -> Int
decrement n =
    n - 1


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    ( updateModel msg model, Cmd.none )


updateModel : Msg -> Model -> Model
updateModel msg model =
    case msg of
        Clicked ->
            { model | clicks = model.clicks + 1 }

        Mapped MappedClicked ->
            { model | mappedClicks = model.mappedClicks + 1 }

        Command "tick" ->
            { model | ticks = model.ticks + 1 }

        Command "change-field" ->
            { model | field = model.field + 1 }

        Command "new-equal-items" ->
            { model | items = List.map identity model.items }

        Command "new-equal-deep" ->
            { model | deep = { n = model.deep.n, nested = List.map identity model.deep.nested } }

        Command "change-deep" ->
            { model | deep = { n = model.deep.n + 1, nested = model.deep.nested } }

        Command "show-lazy" ->
            { model | position = ShowLazy }

        Command "show-fancy" ->
            { model | position = ShowFancy }

        Command "show-shallow" ->
            { model | position = ShowShallow }

        Command "show-plain" ->
            { model | position = ShowPlain }

        Command "change-handler" ->
            { model | handler = decrement }

        Command other ->
            if String.startsWith "keys:" other then
                { model | keys = String.split "," (String.dropLeft 5 other) }

            else
                model


view : Model -> Html Msg
view model =
    div []
        [ span [ id "ticks" ] [ text (String.fromInt model.ticks) ]
        , span [ id "clicks" ] [ text (String.fromInt model.clicks) ]
        , span [ id "mapped-clicks" ] [ text (String.fromInt model.mappedClicks) ]
        , VirtualDom.lazyShallow viewShallow
            { lazyDummy = ()
            , external = model.external
            , field = model.field
            , items = model.items
            }
        , VirtualDom.lazyFancy viewFancy
            { lazyDummy = ()
            , external = model.external
            , field = model.field
            }
            model.deep
        , VirtualDom.lazyFancy viewHandler
            { lazyDummy = ()
            , external = model.external
            }
            { handler = model.handler }
        , viewPosition model
        , Html.Keyed.ul [ id "keyed" ] (List.map viewKeyedKid model.keys)
        , Html.map Mapped
            (VirtualDom.lazyShallow viewMapped
                { lazyDummy = ()
                , external = model.external
                }
            )
        ]


viewShallow : { lazyDummy : (), external : Value, field : Int, items : List Int } -> Html Msg
viewShallow record =
    div [ id "shallow" ]
        [ span [ id "shallow-stamp" ] [ text (toStamp record.external) ]
        , span [ id "shallow-field" ] [ text (String.fromInt record.field) ]
        , button [ id "shallow-button", onClick Clicked ] [ text "click" ]
        ]


viewFancy : { lazyDummy : (), external : Value, field : Int } -> Deep -> Html Msg
viewFancy record deep =
    div [ id "fancy" ]
        [ span [ id "fancy-stamp" ] [ text (toStamp record.external) ]
        , span [ id "fancy-field" ] [ text (String.fromInt record.field) ]
        , span [ id "fancy-deep" ] [ text (String.fromInt deep.n) ]
        , button [ id "fancy-button", onClick Clicked ] [ text "click" ]
        ]


viewHandler : { lazyDummy : (), external : Value } -> { handler : Int -> Int } -> Html Msg
viewHandler record { handler } =
    div [ id "handler" ]
        [ span [ id "handler-stamp" ] [ text (toStamp record.external) ]
        , span [ id "handler-result" ] [ text (String.fromInt (handler 1)) ]
        ]


viewPosition : Model -> Html Msg
viewPosition model =
    case model.position of
        ShowLazy ->
            Html.Lazy.lazy viewPositionLazy model.field

        ShowFancy ->
            VirtualDom.lazyFancy viewPositionFancy { lazyDummy = (), field = model.field } model.deep

        ShowShallow ->
            VirtualDom.lazyShallow viewPositionShallow { lazyDummy = (), field = model.field }

        ShowPlain ->
            p [ id "position" ] [ text "plain" ]


viewPositionLazy : Int -> Html Msg
viewPositionLazy field =
    div [ id "position" ] [ text ("lazy " ++ String.fromInt field) ]


viewPositionFancy : { lazyDummy : (), field : Int } -> Deep -> Html Msg
viewPositionFancy record deep =
    div [ id "position" ] [ text ("fancy " ++ String.fromInt record.field ++ " " ++ String.fromInt deep.n) ]


viewPositionShallow : { lazyDummy : (), field : Int } -> Html Msg
viewPositionShallow record =
    div [ id "position" ] [ text ("shallow " ++ String.fromInt record.field) ]


viewKeyedKid : String -> ( String, Html Msg )
viewKeyedKid key =
    ( key, Html.Lazy.lazy viewKid key )


viewKid : String -> Html Msg
viewKid key =
    li [ id ("item-" ++ key) ] [ input [ id ("input-" ++ key) ] [] ]


viewMapped : { lazyDummy : (), external : Value } -> Html MappedMsg
viewMapped record =
    div [ id "mapped" ]
        [ span [ id "mapped-stamp" ] [ text (toStamp record.external) ]
        , button [ id "mapped-button", onClick MappedClicked ] [ text "click" ]
        ]


toStamp : Value -> String
toStamp external =
    Decode.decodeValue (Decode.field "stamp" Decode.int) external
        |> Result.map String.fromInt
        |> Result.withDefault "?"
