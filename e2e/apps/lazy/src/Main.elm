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


type Counted
    = Counted Value Int


type Position
    = ShowLazy
    | ShowShallowDeep
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

        Command "show-shallow-deep" ->
            { model | position = ShowShallowDeep }

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
            { external = model.external
            , field = model.field
            , items = model.items
            }
        , VirtualDom.lazyShallow viewInt model.field
        , VirtualDom.lazyShallow viewBool (model.field > 0)
        , VirtualDom.lazyShallow viewCounted (Counted model.external model.field)
        , VirtualDom.lazyShallowDeep viewShallowDeep
            { external = model.external
            , field = model.field
            }
            model.deep
        , VirtualDom.lazyShallowDeep viewHandler
            { external = model.external
            }
            { handler = model.handler }
        , viewPosition model
        , Html.Keyed.ul [ id "keyed" ] (List.map viewKeyedKid model.keys)
        , Html.map Mapped
            (VirtualDom.lazyShallow viewMapped
                { external = model.external
                }
            )
        ]


viewShallow : { external : Value, field : Int, items : List Int } -> Html Msg
viewShallow record =
    div [ id "shallow" ]
        [ span [ id "shallow-stamp" ] [ text (toStamp record.external) ]
        , span [ id "shallow-field" ] [ text (String.fromInt record.field) ]
        , button [ id "shallow-button", onClick Clicked ] [ text "click" ]
        ]


viewInt : Int -> Html Msg
viewInt n =
    span [ id "int" ] [ text (String.fromInt n) ]


viewBool : Bool -> Html Msg
viewBool isOn =
    span [ id "bool" ]
        [ text
            (if isOn then
                "on"

             else
                "off"
            )
        ]


viewCounted : Counted -> Html Msg
viewCounted (Counted external n) =
    div [ id "counted" ]
        [ span [ id "counted-stamp" ] [ text (toStamp external) ]
        , span [ id "counted-field" ] [ text (String.fromInt n) ]
        ]


viewShallowDeep : { external : Value, field : Int } -> Deep -> Html Msg
viewShallowDeep record deep =
    div [ id "shallow-deep" ]
        [ span [ id "shallow-deep-stamp" ] [ text (toStamp record.external) ]
        , span [ id "shallow-deep-field" ] [ text (String.fromInt record.field) ]
        , span [ id "shallow-deep-value" ] [ text (String.fromInt deep.n) ]
        , button [ id "shallow-deep-button", onClick Clicked ] [ text "click" ]
        ]


viewHandler : { external : Value } -> { handler : Int -> Int } -> Html Msg
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

        ShowShallowDeep ->
            VirtualDom.lazyShallowDeep viewPositionShallowDeep { field = model.field } model.deep

        ShowShallow ->
            VirtualDom.lazyShallow viewPositionShallow { field = model.field }

        ShowPlain ->
            p [ id "position" ] [ text "plain" ]


viewPositionLazy : Int -> Html Msg
viewPositionLazy field =
    div [ id "position" ] [ text ("lazy " ++ String.fromInt field) ]


viewPositionShallowDeep : { field : Int } -> Deep -> Html Msg
viewPositionShallowDeep record deep =
    div [ id "position" ] [ text ("shallow-deep " ++ String.fromInt record.field ++ " " ++ String.fromInt deep.n) ]


viewPositionShallow : { field : Int } -> Html Msg
viewPositionShallow record =
    div [ id "position" ] [ text ("shallow " ++ String.fromInt record.field) ]


viewKeyedKid : String -> ( String, Html Msg )
viewKeyedKid key =
    ( key, Html.Lazy.lazy viewKid key )


viewKid : String -> Html Msg
viewKid key =
    li [ id ("item-" ++ key) ] [ input [ id ("input-" ++ key) ] [] ]


viewMapped : { external : Value } -> Html MappedMsg
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
