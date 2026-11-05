port module Main exposing (main)

{-| Everything the browser tests exercise.

The test decides what the view shows, through commands. Commands sent in one go reach the same
render, which is how a layer comes back with a new shape in a single step.

-}

import Browser
import Html exposing (Html, button, div, input, span, text)
import Html.Attributes exposing (attribute, class, id)
import Html.Events exposing (onClick)
import Html.Lazy
import VirtualDom


port command : (String -> msg) -> Sub msg


type alias Model =
    { layers : List String
    , shape : String
    , history : String
    , clicks : List String
    }


type Msg
    = Command String
    | Clicked String


main : Program () Model Msg
main =
    Browser.element
        { init = \_ -> ( init, Cmd.none )
        , update = \msg model -> ( update msg model, Cmd.none )
        , view = view
        , subscriptions = \_ -> command Command
        }


init : Model
init =
    { layers = [ "below", "panel", "plain", "above" ]
    , shape = "first"
    , history = "forward"
    , clicks = []
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        Clicked shape ->
            { model | clicks = shape :: model.clicks }

        Command other ->
            case String.split ":" other of
                [ "layers", names ] ->
                    { model | layers = String.split "," names }

                [ "shape", shape ] ->
                    { model | shape = shape }

                [ "history", history ] ->
                    { model | history = history }

                _ ->
                    model


view : Model -> Html Msg
view model =
    div []
        [ span [ id "clicks" ] [ text (String.join "," model.clicks) ]
        , VirtualDom.keyedLayers "view-stack"
            [ "history" ]
            [ id "stack", attribute "history" model.history ]
            (List.map (viewKeyed model) model.layers)
        ]


viewKeyed : Model -> String -> ( String, Html Msg )
viewKeyed model name =
    ( name
    , if name == "plain" then
        div [ id name, class "own-transition" ] [ text name ]

      else
        Html.map identity (Html.Lazy.lazy3 viewLayer model.shape model.history name)
    )


viewLayer : String -> String -> String -> Html Msg
viewLayer shape history name =
    Html.node (toRootTag shape)
        [ id name
        , class "fade"
        , attribute "transition-state" "entering"
        , attribute "scrolling-context-selector" ".scroller"
        , attribute "history" history
        , attribute "data-shape" shape
        ]
        ([ input [ class "field" ] []
         , button [ class "action", onClick (Clicked shape) ] [ text shape ]
         , div [ class "scroller" ] [ div [ class "tall" ] [] ]
         ]
            ++ viewShape shape
        )


toRootTag : String -> String
toRootTag shape =
    if shape == "retagged" then
        "section"

    else
        "div"


viewShape : String -> List (Html Msg)
viewShape shape =
    if shape == "first" then
        [ span [ class "shape" ] [ text shape ] ]

    else
        [ div [ class "shape" ] [ text shape ]
        , span [ class "extra" ] []
        ]
