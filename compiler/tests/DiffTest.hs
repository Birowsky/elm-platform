module Main (main) where

-- Tests for Deps.Diff, the API diff behind `elm diff`, `elm bump`, and the
-- version check in `elm publish`.
--
-- Each case describes one module of a package before and after a change, in
-- the docs.json format, and states the magnitude the change must have.


import Control.Monad (forM)
import qualified Data.ByteString.Char8 as BS
import qualified Data.List as List
import qualified Data.Map as Map
import System.Exit (exitFailure)

import qualified Deps.Diff as Diff
import qualified Elm.Docs as Docs
import qualified Elm.Magnitude as M
import qualified Json.Decode as D



-- DECLARATIONS


data Decl
  = Value String String                 -- name, type
  | Alias String [String] String        -- name, args, type
  | Union String [String] [(String, [String])] -- name, args, constructors
  | Binop String String String Int      -- name, type, associativity, precedence


data Case =
  Case
    { _name :: String
    , _old :: [(String, [Decl])]  -- modules
    , _new :: [(String, [Decl])]
    , _expected :: M.Magnitude
    }


-- a change within a single module "M"
change :: String -> [Decl] -> [Decl] -> M.Magnitude -> Case
change name old new expected =
  Case name [("M", old)] [("M", new)] expected



-- CASES


cases :: [Case]
cases =
  [ -- basics
    change "nothing changed" [value "Int -> Int"] [value "Int -> Int"] M.PATCH
  , change "type variables renamed" [value "a -> b -> a"] [value "x -> y -> x"] M.PATCH
  , change "type variables swapped" [value "a -> b -> a"] [value "b -> a -> b"] M.PATCH
  , change "type changed" [value "Int -> Int"] [value "String -> Int"] M.MAJOR
  , change "value added" [value "Int"] [value "Int", Value "g" "Basics.Int"] M.MINOR
  , change "value removed" [value "Int", Value "g" "Basics.Int"] [value "Int"] M.MAJOR
  , Case "module added" [("M", [value "Int"])] [("M", [value "Int"]), ("N", [])] M.MINOR
  , Case "module removed" [("M", [value "Int"]), ("N", [])] [("M", [value "Int"])] M.MAJOR
  , change "very old docs without qualified names" [Value "f" "Int -> Int"] [value "Int -> Int"] M.PATCH

    -- #1 record aliases define a constructor whose argument order matters
  , change "record alias fields reordered"
      [Alias "P" [] "{ name : String.String, age : Basics.Int }"]
      [Alias "P" [] "{ age : Basics.Int, name : String.String }"] M.MAJOR
  , change "record alias with same-typed fields reordered (silently swaps arguments)"
      [Alias "P" [] "{ x : Basics.Float, y : Basics.Float }"]
      [Alias "P" [] "{ y : Basics.Float, x : Basics.Float }"] M.MAJOR
  , change "record types in values are unordered"
      [value "{ a : Int, b : String } -> Int"] [value "{ b : String, a : Int } -> Int"] M.PATCH
  , change "extensible record alias fields reordered (no constructor)"
      [Alias "R" ["r"] "{ r | x : Basics.Int, y : Basics.Int }"]
      [Alias "R" ["r"] "{ r | y : Basics.Int, x : Basics.Int }"] M.PATCH
  , change "record alias loses its constructor"
      [Alias "B" [] "{ x : Basics.Int }", Alias "A" [] "{ x : Basics.Int }"]
      [Alias "B" [] "{ x : Basics.Int }", Alias "A" [] "M.B"] M.MAJOR
  , change "record alias gains a constructor"
      [Alias "B" [] "{ x : Basics.Int }", Alias "A" [] "M.B"]
      [Alias "B" [] "{ x : Basics.Int }", Alias "A" [] "{ x : Basics.Int }"] M.MINOR

    -- #2 the number of type variables matters even with nothing to compare
  , change "opaque type gains a type variable"
      [Union "T" ["a"] []] [Union "T" ["a", "b"] []] M.MAJOR
  , change "opaque type loses a type variable"
      [Union "T" ["a"] []] [Union "T" [] []] M.MAJOR
  , change "phantom type variable removed"
      [Union "T" ["a"] [("T", [])]] [Union "T" [] [("T", [])]] M.MAJOR
  , change "opaque type variable renamed"
      [Union "T" ["a"] []] [Union "T" ["x"] []] M.PATCH

    -- #3 exposing constructors only adds things
  , change "constructors exposed"
      [Union "T" [] []] [Union "T" [] [("A", []), ("B", [])]] M.MINOR
  , change "constructors hidden"
      [Union "T" [] [("A", []), ("B", [])]] [Union "T" [] []] M.MAJOR

    -- #4 constructor order does not matter, everything else does
  , change "constructors reordered"
      [Union "T" ["a"] [("A", ["a"]), ("B", ["Basics.Int"])]]
      [Union "T" ["a"] [("B", ["Basics.Int"]), ("A", ["a"])]] M.PATCH
  , change "constructor added" [Union "T" [] [("A", [])]] [Union "T" [] [("A", []), ("B", [])]] M.MAJOR
  , change "constructor argument changed" [Union "T" [] [("A", ["Basics.Int"])]] [Union "T" [] [("A", ["Basics.Float"])]] M.MAJOR
  , change "constructor arguments swapped by type variable"
      [Union "T" ["a", "b"] [("T", ["a", "b"])]] [Union "T" ["a", "b"] [("T", ["b", "a"])]] M.MAJOR

    -- #5 values: becoming more general is MINOR, anything else is MAJOR
  , change "constraint loosened: comparable -> a" [value "comparable -> comparable"] [value "a -> a"] M.MINOR
  , change "constraint loosened: number -> comparable" [value "number -> number"] [value "comparable -> comparable"] M.MINOR
  , change "constraint loosened: compappend -> appendable" [value "compappend -> compappend"] [value "appendable -> appendable"] M.MINOR
  , change "constraint tightened: a -> comparable" [value "a -> a"] [value "comparable -> comparable"] M.MAJOR
  , change "concrete type generalized: Int -> a" [value "Int -> Int"] [value "a -> a"] M.MINOR
  , change "concrete type generalized: Int -> number" [value "Int -> Int"] [value "number -> number"] M.MINOR
  , change "String is not a number" [value "String -> String"] [value "number -> number"] M.MAJOR
  , change "List Int is appendable" [value "List Int -> Int"] [value "appendable -> Int"] M.MINOR
  , change "tuples of comparables are comparable" [value "( Int, String ) -> Bool"] [value "comparable -> Bool"] M.MINOR
  , change "functions are not comparable" [value "(Int -> Int) -> Bool"] [value "comparable -> Bool"] M.MAJOR
  , change "variables split apart: a -> a -> a to a -> b -> a" [value "a -> a -> a"] [value "a -> b -> a"] M.MINOR
  , change "variables merged: a -> b -> a to a -> a -> a" [value "a -> b -> a"] [value "a -> a -> a"] M.MAJOR
  , change "a variable cannot be two types" [value "Int -> String"] [value "a -> a"] M.MAJOR
  , change "a function type is an instance of b" [value "Int -> Int -> Int"] [value "a -> b"] M.MINOR
  , change "specialized: a -> Int" [value "a -> a"] [value "Int -> Int"] M.MAJOR
  , change "record generalized to extensible record"
      [value "{ x : Int, y : Int } -> Int"] [value "{ r | x : Int } -> Int"] M.MINOR
  , change "extensible record specialized"
      [value "{ r | x : Int } -> Int"] [value "{ x : Int, y : Int } -> Int"] M.MAJOR
  , change "extensible record keeps the same row"
      [value "{ r | x : Int } -> { r | x : Int }"] [value "{ s | x : Int } -> { s | x : Int }"] M.PATCH
  , change "union parameter constraint loosened"
      [Union "Box" ["comparable"] [("Box", ["comparable"])]] [Union "Box" ["a"] [("Box", ["a"])]] M.MINOR
  , change "union parameter constraint tightened"
      [Union "Box" ["a"] [("Box", ["a"])]] [Union "Box" ["comparable"] [("Box", ["comparable"])]] M.MAJOR

    -- #6 aliases defined in the package are expanded before comparing
  , change "value switches to an alias of the same type"
      [Alias "UserId" [] "Basics.Int", value "Int -> Int"]
      [Alias "UserId" [] "Basics.Int", Value "f" "M.UserId -> Basics.Int"] M.PATCH
  , change "alias with arguments expanded"
      [Alias "Pair" ["a"] "( a, a )", value "( Int, Int ) -> Int"]
      [Alias "Pair" ["a"] "( a, a )", Value "f" "M.Pair Basics.Int -> Basics.Int"] M.PATCH
  , change "extensible record alias expanded"
      [Alias "Named" ["r"] "{ r | name : String.String }", value "{ name : String, age : Int } -> String"]
      [Alias "Named" ["r"] "{ r | name : String.String }", Value "f" "M.Named { age : Basics.Int } -> String.String"] M.PATCH
  , change "aliased type changed"
      [Alias "UserId" [] "Basics.Int", Value "f" "M.UserId -> Basics.Int"]
      [Alias "UserId" [] "String.String", Value "f" "M.UserId -> Basics.Int"] M.MAJOR
  , Case "alias from another module of the package"
      [("A", [Alias "Id" [] "Basics.Int"]), ("M", [value "Int -> Int"])]
      [("A", [Alias "Id" [] "Basics.Int"]), ("M", [Value "f" "A.Id -> Basics.Int"])] M.PATCH

  , change "type moved to another module under the same name"
      [Value "f" "Foo.Thing -> Basics.Int"] [Value "f" "Bar.Thing -> Basics.Int"] M.MAJOR

    -- binary operators
  , change "operator type variables renamed"
      [Binop "+++" "a -> a -> a" "left" 5] [Binop "+++" "b -> b -> b" "left" 5] M.PATCH
  , change "operator precedence changed"
      [Binop "+++" "a -> a -> a" "left" 5] [Binop "+++" "a -> a -> a" "left" 6] M.MAJOR
  , change "operator associativity changed"
      [Binop "+++" "a -> a -> a" "left" 5] [Binop "+++" "a -> a -> a" "right" 5] M.MAJOR
  ]


-- `f : <type>`, with Int, String, etc. qualified the way docs.json has them
value :: String -> Decl
value tipe =
  Value "f" (qualify tipe)


qualify :: String -> String
qualify =
  unwords . map q . words . spaced
  where
    spaced = concatMap (\c -> if c `elem` ("(),{}" :: String) then [' ', c, ' '] else [c])
    q w = maybe w id (lookup w qualified)
    qualified =
      [ ("Int", "Basics.Int"), ("Float", "Basics.Float"), ("Bool", "Basics.Bool")
      , ("String", "String.String"), ("Char", "Char.Char"), ("List", "List.List")
      ]



-- DOCS.JSON


toJson :: [(String, [Decl])] -> String
toJson modules =
  arr (map moduleJson modules)
  where
    moduleJson (name, decls) =
      let
        entries = map declJson decls
        category c = arr [ json | (c', json) <- entries, c' == c ]
      in
        obj
          [ ("name", str name), ("comment", str "")
          , ("unions", category "unions"), ("aliases", category "aliases")
          , ("values", category "values"), ("binops", category "binops")
          ]

    declJson decl =
      case decl of
        Union n args ctors ->
          ( "unions"
          , obj [("name", str n), ("comment", str ""), ("args", arr (map str args)),
                 ("cases", arr [ arr [str c, arr (map str ts)] | (c, ts) <- ctors ])]
          )

        Alias n args t ->
          ("aliases", obj [("name", str n), ("comment", str ""), ("args", arr (map str args)), ("type", str t)])

        Value n t ->
          ("values", obj [("name", str n), ("comment", str ""), ("type", str t)])

        Binop n t assoc prec ->
          ( "binops"
          , obj [("name", str n), ("comment", str ""), ("type", str t),
                 ("associativity", str assoc), ("precedence", show prec)]
          )


obj :: [(String, String)] -> String
obj fields =
  "{" ++ List.intercalate "," [ str k ++ ":" ++ v | (k, v) <- fields ] ++ "}"


arr :: [String] -> String
arr xs =
  "[" ++ List.intercalate "," xs ++ "]"


str :: String -> String
str =
  show


decode :: [(String, [Decl])] -> IO Docs.Documentation
decode modules =
  do  result <- D.fromByteString Docs.decoder (BS.pack (toJson modules))
      case result of
        Right docs -> return docs
        Left _     -> fail ("could not decode test docs: " ++ toJson modules)



-- RUN


main :: IO ()
main =
  do  results <- forM cases $ \(Case name old new expected) ->
        do  changes <- Diff.diff <$> decode old <*> decode new
            let actual = Diff.toMagnitude changes
            let reported = not (Map.null (Diff._modules_changed changes)) || actual /= M.PATCH
            if actual == expected && reported == (expected /= M.PATCH)
              then return True
              else
                do  putStrLn ("FAIL: " ++ name ++ "\n  expected " ++ M.toChars expected ++ ", got " ++ M.toChars actual)
                    return False

      let failures = length (filter not results)
      putStrLn (show (length results - failures) ++ " passed, " ++ show failures ++ " failed")
      if failures > 0 then exitFailure else return ()
