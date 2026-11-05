{-# LANGUAGE ExtendedLiterals #-}
module Deps.Diff
  ( diff
  , PackageChanges(..)
  , ModuleChanges(..)
  , Changes(..)
  , moduleChangeMagnitude
  , toMagnitude
  , bump
  , getDocs
  )
  where


import Control.Monad (foldM, zipWithM)
import Data.Function (on)
import qualified Data.List as List
import qualified Data.Map as Map
import qualified Data.Set as Set
import qualified System.Directory as Dir
import System.FilePath ((</>))

import qualified String as S

import qualified AST.Prim.Module as Module
import qualified AST.Prim.Name as N
import qualified AST.Prim.Operator as Op
import qualified AST.Prim.TypeName as T
import qualified AST.Prim.TypeVar as T
import qualified Deps.Website as Website
import qualified Elm.Compiler.Type as Type
import qualified Elm.Docs as Docs
import qualified Elm.Magnitude as M
import qualified Elm.Package as Pkg
import qualified Elm.Version as V
import qualified File
import qualified Http
import qualified Json.Decode as D
import qualified Reporting.Exit as Exit
import qualified Root as R



-- CHANGES


data PackageChanges =
  PackageChanges
    { _modules_added :: [Module.Name]
    , _modules_changed :: Map.Map Module.Name ModuleChanges
    , _modules_removed :: [Module.Name]
    }


data ModuleChanges =
  ModuleChanges
    { _unions :: Changes T.Name Docs.Union
    , _aliases :: Changes T.Name Docs.Alias
    , _values :: Changes N.Name Docs.Value
    , _binops :: Changes Op.Name Docs.Binop
    }


-- `_changed` breaks existing code (MAJOR) while `_compatible` holds changes
-- that existing code keeps working with, like a value whose type became more
-- general or a type that started exposing its constructors (MINOR).
--
data Changes k v =
  Changes
    { _added :: Map.Map k v
    , _changed :: Map.Map k (v,v)
    , _compatible :: Map.Map k (v,v)
    , _removed :: Map.Map k v
    }


data Verdict
  = Same
  | Compatible
  | Breaking
  deriving (Eq, Ord)


getChanges :: (Ord k) => (v -> v -> Verdict) -> Map.Map k v -> Map.Map k v -> Changes k v
getChanges judge old new =
  let
    judged = Map.intersectionWith (\o n -> (judge o n, (o,n))) old new
    withVerdict v = Map.map snd (Map.filter ((==) v . fst) judged)
  in
    Changes
      (Map.difference new old)
      (withVerdict Breaking)
      (withVerdict Compatible)
      (Map.difference old new)



-- DIFF


diff :: Docs.Documentation -> Docs.Documentation -> PackageChanges
diff oldDocs newDocs =
  let
    env =
      Env (toAliasTable oldDocs) (toAliasTable newDocs)

    filterOutPatches chngs =
      Map.filter (\chng -> moduleChangeMagnitude chng /= M.PATCH) chngs

    (Changes added changed _ removed) =
      getChanges (\_ _ -> Breaking) oldDocs newDocs
  in
    PackageChanges
      (Map.keys added)
      (filterOutPatches (Map.map (diffModule env) changed))
      (Map.keys removed)


diffModule :: Env -> (Docs.Module, Docs.Module) -> ModuleChanges
diffModule env (Docs.Module _ _ u1 a1 v1 b1, Docs.Module _ _ u2 a2 v2 b2) =
  ModuleChanges
    (getChanges (judgeUnion env) u1 u2)
    (getChanges (judgeAlias env) a1 a2)
    (getChanges (judgeValue env) v1 v2)
    (getChanges (judgeBinop env) b1 b2)



-- JUDGE DECLARATIONS


judgeUnion :: Env -> Docs.Union -> Docs.Union -> Verdict
judgeUnion env (Docs.Union _ oldVars oldCtors) (Docs.Union _ newVars newCtors)
  | length oldVars /= length newVars = Breaking
  | null oldCtors =
      -- opaque before, so exposing constructors now only adds things
      max (if null newCtors then Same else Compatible) (judgeRenaming (zip oldVars newVars))
  | null newCtors = Breaking
  | Map.keys oldMap /= Map.keys newMap = Breaking
  | otherwise =
      -- constructor order is irrelevant: Elm has no deriving or enum ordering
      case sequence (Map.elems (Map.intersectionWith diffCtor oldMap newMap)) of
        Nothing ->
          Breaking

        Just renamings ->
          judgeRenaming (zip oldVars newVars ++ concat renamings)
  where
    oldMap = Map.fromList oldCtors
    newMap = Map.fromList newCtors

    diffCtor oldArgs newArgs =
      if length oldArgs /= length newArgs then
        Nothing
      else
        concat <$> zipWithM (\o n -> diffType (expandOld env o) (expandNew env n)) oldArgs newArgs


judgeAlias :: Env -> Docs.Alias -> Docs.Alias -> Verdict
judgeAlias env (Docs.Alias _ oldVars oldType) (Docs.Alias _ newVars newType)
  | length oldVars /= length newVars = Breaking
  | otherwise =
      max (judgeRecordConstructor oldType newType) $
        case diffType (expandOld env oldType) (expandNew env newType) of
          Nothing ->
            Breaking

          Just renamings ->
            judgeRenaming (zip oldVars newVars ++ renamings)


-- An alias of a closed record also defines a constructor function whose
-- arguments follow the field order, so `type alias P = { x : Int, y : Int }`
-- and `{ y : Int, x : Int }` are different APIs even though the types match.
--
judgeRecordConstructor :: Type.Type -> Type.Type -> Verdict
judgeRecordConstructor oldType newType =
  case (recordConstructor oldType, recordConstructor newType) of
    (Just oldFields, Just newFields) -> if oldFields == newFields then Same else Breaking
    (Just _, Nothing)               -> Breaking
    (Nothing, Just _)               -> Compatible
    (Nothing, Nothing)              -> Same
  where
    recordConstructor tipe =
      case tipe of
        Type.Record fields Nothing -> Just (map fst fields)
        _                          -> Nothing


judgeValue :: Env -> Docs.Value -> Docs.Value -> Verdict
judgeValue env (Docs.Value _ oldType) (Docs.Value _ newType) =
  judgeType (expandOld env oldType) (expandNew env newType)


judgeBinop :: Env -> Docs.Binop -> Docs.Binop -> Verdict
judgeBinop env (Docs.Binop _ oldType oldAssoc oldPrec) (Docs.Binop _ newType newAssoc newPrec)
  | oldAssoc /= newAssoc || oldPrec /= newPrec = Breaking
  | otherwise = judgeType (expandOld env oldType) (expandNew env newType)


-- The type of an exposed value can change in two compatible ways: renaming
-- its type variables, or becoming more general. Elm only has rank-1
-- polymorphism, so every use of the old type is still a valid use of a more
-- general one, and that is a MINOR change.
--
judgeType :: Type.Type -> Type.Type -> Verdict
judgeType oldType newType
  | (judgeRenaming <$> diffType oldType newType) == Just Same = Same
  | isInstanceOf oldType newType = Compatible
  | otherwise = Breaking



-- DIFF TYPES


diffType :: Type.Type -> Type.Type -> Maybe [(T.Var,T.Var)]
diffType oldType newType =
  case (oldType, newType) of
    (Type.Var oldName, Type.Var newName) ->
      Just [(oldName, newName)]

    (Type.Lambda a b, Type.Lambda a' b') ->
      (++)
        <$> diffType a a'
        <*> diffType b b'

    (Type.Type oldName oldArgs, Type.Type newName newArgs) ->
      if not (isSameName oldName newName) || length oldArgs /= length newArgs then
        Nothing
      else
        concat <$> zipWithM diffType oldArgs newArgs

    (Type.Record fields maybeExt, Type.Record fields' maybeExt') ->
      case (maybeExt, maybeExt') of
        (Nothing, Just _) ->
          Nothing

        (Just _, Nothing) ->
          Nothing

        (Nothing, Nothing) ->
          diffFields fields fields'

        (Just oldExt, Just newExt) ->
          (:) (oldExt, newExt) <$> diffFields fields fields'

    (Type.Unit, Type.Unit) ->
      Just []

    (Type.Tuple a b cs, Type.Tuple x y zs) ->
      if length cs /= length zs then
        Nothing
      else
        do  aVars <- diffType a x
            bVars <- diffType b y
            cVars <- concat <$> zipWithM diffType cs zs
            return (aVars ++ bVars ++ cVars)

    (_, _) ->
      Nothing


-- handle very old docs that do not use qualified names
isSameName :: T.Name -> T.Name -> Bool
isSameName oldFullName newFullName =
  let
    dedot n = reverse $ S.split 0x2E#Word8 {-.-} $ T.nameToString n
  in
    case ( dedot oldFullName, dedot newFullName ) of
      (oldName:[], newName:_) ->
        oldName == newName

      (oldName:_, newName:[]) ->
        oldName == newName

      _ ->
        oldFullName == newFullName


-- Record types are unordered, so fields are compared by name. (Field order
-- only matters for record constructors, see judgeRecordConstructor.)
--
diffFields :: [(N.Name, Type.Type)] -> [(N.Name, Type.Type)] -> Maybe [(T.Var,T.Var)]
diffFields oldRawFields newRawFields =
  let
    oldFields = sortFields oldRawFields
    newFields = sortFields newRawFields
  in
    if length oldRawFields /= length newRawFields then
      Nothing

    else if or (zipWith ((/=) `on` fst) oldFields newFields) then
      Nothing

    else
      concat <$> zipWithM (diffType `on` snd) oldFields newFields


sortFields :: [(N.Name, a)] -> [(N.Name, a)]
sortFields =
  List.sortBy (compare `on` fst)



-- TYPE VARIABLES


-- The old type variables must map one-to-one onto the new ones. If every
-- variable keeps its constraint, nothing changed. If some constraint got
-- looser (comparable to a, number to comparable, ...) the change is compatible.
--
judgeRenaming :: [(T.Var,T.Var)] -> Verdict
judgeRenaming varPairs =
  let
    renamings =
      Map.toList (foldr insert Map.empty varPairs)

    insert (old,new) dict =
      Map.insertWith (++) old [new] dict

    verify (old, news) =
      case news of
        [] ->
          Nothing

        new : rest ->
          if all (new ==) rest then
            Just (old, new)
          else
            Nothing

    allUnique list =
      length list == Set.size (Set.fromList list)
  in
    case mapM verify renamings of
      Just verifiedRenamings | allUnique (map snd verifiedRenamings) ->
        maximum (Same : map judgeConstraint verifiedRenamings)

      _ ->
        Breaking


judgeConstraint :: (T.Var, T.Var) -> Verdict
judgeConstraint (T.Var _ old, T.Var _ new) =
  case (constraintRank old, constraintRank new) of
    (o, n) | o == n -> Same
    (_, 0)          -> Compatible  -- anything -> a
    (4, 1)          -> Compatible  -- compappend -> comparable
    (4, 2)          -> Compatible  -- compappend -> appendable
    (3, 1)          -> Compatible  -- number -> comparable
    _               -> Breaking


constraintRank :: T.Constraint -> Int
constraintRank constraint =
  case constraint of
    T.Any        -> 0
    T.Comparable -> 1
    T.Appendable -> 2
    T.Number     -> 3
    T.CompAppend -> 4



-- MORE GENERAL TYPES


-- Is `oldType` an instance of `newType`? That is, can the type variables of
-- `newType` be filled in (respecting their constraints) to get `oldType`?
-- Type variables of `oldType` are treated as fixed.
--
isInstanceOf :: Type.Type -> Type.Type -> Bool
isInstanceOf oldType newType =
  case match newType oldType Map.empty of
    Nothing ->
      False

    Just subst ->
      all (\(T.Var _ constraint, tipe) -> satisfies constraint tipe) (Map.toList subst)


type Subst =
  Map.Map T.Var Type.Type


match :: Type.Type -> Type.Type -> Subst -> Maybe Subst
match general specific subst =
  case (general, specific) of
    (Type.Var var, _) ->
      bind var specific subst

    (Type.Lambda a b, Type.Lambda a' b') ->
      match a a' subst >>= match b b'

    (Type.Type name args, Type.Type name' args') ->
      if isSameName name' name && length args == length args' then
        matchAll args args' subst
      else
        Nothing

    (Type.Record fields ext, Type.Record fields' ext') ->
      let
        specificFields = Map.fromList fields'
        rest = Map.toList (Map.difference specificFields (Map.fromList fields))
        bindExt s =
          case (ext, rest, ext') of
            (Nothing, [], Nothing) -> Just s
            (Nothing, _ , _      ) -> Nothing
            (Just r , [], Just v ) -> bind r (Type.Var v) s
            (Just r , _ , _      ) -> bind r (Type.Record rest ext') s
      in
        do  pairs <- traverse (\(field, tipe) -> (,) tipe <$> Map.lookup field specificFields) fields
            s <- matchAll (map fst pairs) (map snd pairs) subst
            bindExt s

    (Type.Unit, Type.Unit) ->
      Just subst

    (Type.Tuple a b cs, Type.Tuple a' b' cs') ->
      if length cs == length cs' then
        matchAll (a:b:cs) (a':b':cs') subst
      else
        Nothing

    (_, _) ->
      Nothing


matchAll :: [Type.Type] -> [Type.Type] -> Subst -> Maybe Subst
matchAll generals specifics subst =
  foldM (\s (g, t) -> match g t s) subst (zip generals specifics)


bind :: T.Var -> Type.Type -> Subst -> Maybe Subst
bind var tipe subst =
  case Map.lookup var subst of
    Nothing ->
      Just (Map.insert var tipe subst)

    Just bound ->
      if sameType bound tipe then Just subst else Nothing


satisfies :: T.Constraint -> Type.Type -> Bool
satisfies constraint tipe =
  case constraint of
    T.Any        -> True
    T.Number     -> isNamed "Basics" "Int" tipe || isNamed "Basics" "Float" tipe || hasVarIn [3] tipe
    T.Comparable -> isComparable tipe
    T.Appendable -> isNamed "String" "String" tipe || isList (const True) tipe || hasVarIn [2,4] tipe
    T.CompAppend -> isNamed "String" "String" tipe || isList isComparable tipe || hasVarIn [4] tipe


isComparable :: Type.Type -> Bool
isComparable tipe =
  case tipe of
    Type.Tuple a b cs -> all isComparable (a:b:cs)
    _ ->
      any (\(home, name) -> isNamed home name tipe)
        [ ("Basics","Int"), ("Basics","Float"), ("Char","Char"), ("String","String") ]
      || isList isComparable tipe
      || hasVarIn [1,3,4] tipe


isList :: (Type.Type -> Bool) -> Type.Type -> Bool
isList isOk tipe =
  case tipe of
    Type.Type name [arg] -> isSameName name (qualified "List" "List") && isOk arg
    _                    -> False


isNamed :: String -> String -> Type.Type -> Bool
isNamed home name tipe =
  case tipe of
    Type.Type n [] -> isSameName n (qualified home name)
    _              -> False


hasVarIn :: [Int] -> Type.Type -> Bool
hasVarIn ranks tipe =
  case tipe of
    Type.Var (T.Var _ constraint) -> elem (constraintRank constraint) ranks
    _                             -> False


qualified :: String -> String -> T.Name
qualified home name =
  T.nameFromString (S.fromChars (home ++ "." ++ name))


sameType :: Type.Type -> Type.Type -> Bool
sameType t1 t2 =
  case (t1, t2) of
    (Type.Var a, Type.Var b) -> a == b
    (Type.Lambda a b, Type.Lambda a' b') -> sameType a a' && sameType b b'
    (Type.Type n as, Type.Type n' as') -> n == n' && sameTypes as as'
    (Type.Record fs e, Type.Record fs' e') ->
      e == e'
      && map fst (sortFields fs) == map fst (sortFields fs')
      && sameTypes (map snd (sortFields fs)) (map snd (sortFields fs'))
    (Type.Unit, Type.Unit) -> True
    (Type.Tuple a b cs, Type.Tuple a' b' cs') -> sameTypes (a:b:cs) (a':b':cs')
    (_, _) -> False


sameTypes :: [Type.Type] -> [Type.Type] -> Bool
sameTypes ts ts' =
  length ts == length ts' && and (zipWith sameType ts ts')



-- ALIASES
--
-- Types are compared after expanding the aliases defined in the package
-- itself, so `f : Int -> Int` and `f : UserId -> Int` are the same API when
-- `type alias UserId = Int`.


data Env =
  Env
    { _old_aliases :: AliasTable
    , _new_aliases :: AliasTable
    }


type AliasTable =
  Map.Map T.Name ([T.Var], Type.Type)


toAliasTable :: Docs.Documentation -> AliasTable
toAliasTable docs =
  Map.fromList
    [ ( T.nameFromString (S.join (Module.toString home) 0x2E#Word8 {-.-} (T.nameToString name))
      , (vars, tipe)
      )
    | (home, Docs.Module _ _ _ aliases _ _) <- Map.toList docs
    , (name, Docs.Alias _ vars tipe) <- Map.toList aliases
    ]


expandOld :: Env -> Type.Type -> Type.Type
expandOld (Env table _) =
  expand table (100 :: Int)


expandNew :: Env -> Type.Type -> Type.Type
expandNew (Env _ table) =
  expand table (100 :: Int)


-- `fuel` guards against cyclic aliases in malformed docs.json files
expand :: AliasTable -> Int -> Type.Type -> Type.Type
expand table fuel tipe =
  let
    go = expand table fuel
  in
  case tipe of
    Type.Lambda a b ->
      Type.Lambda (go a) (go b)

    Type.Var _ ->
      tipe

    Type.Type name args ->
      let
        expandedArgs = map go args
      in
        case Map.lookup name table of
          Just (vars, body) | fuel > 0 && length vars == length args ->
            expand table (fuel - 1) (substitute (Map.fromList (zip vars expandedArgs)) body)

          _ ->
            Type.Type name expandedArgs

    Type.Record fields ext ->
      Type.Record (map (fmap go) fields) ext

    Type.Unit ->
      Type.Unit

    Type.Tuple a b cs ->
      Type.Tuple (go a) (go b) (map go cs)


substitute :: Subst -> Type.Type -> Type.Type
substitute subst tipe =
  let
    go = substitute subst
  in
  case tipe of
    Type.Lambda a b ->
      Type.Lambda (go a) (go b)

    Type.Var var ->
      Map.findWithDefault tipe var subst

    Type.Type name args ->
      Type.Type name (map go args)

    Type.Record fields ext ->
      let
        newFields = map (fmap go) fields
      in
        case ext >>= \var -> Map.lookup var subst of
          Just (Type.Record moreFields moreExt) -> Type.Record (newFields ++ moreFields) moreExt
          Just (Type.Var var)                   -> Type.Record newFields (Just var)
          _                                     -> Type.Record newFields ext

    Type.Unit ->
      Type.Unit

    Type.Tuple a b cs ->
      Type.Tuple (go a) (go b) (map go cs)



-- MAGNITUDE


bump :: PackageChanges -> V.Version -> V.Version
bump changes version =
  case toMagnitude changes of
    M.PATCH ->
      V.bumpPatch version

    M.MINOR ->
      V.bumpMinor version

    M.MAJOR ->
      V.bumpMajor version


toMagnitude :: PackageChanges -> M.Magnitude
toMagnitude (PackageChanges added changed removed) =
  let
    addMag = if null added then M.PATCH else M.MINOR
    removeMag = if null removed then M.PATCH else M.MAJOR
    changeMags = map moduleChangeMagnitude (Map.elems changed)
  in
    maximum (addMag : removeMag : changeMags)


moduleChangeMagnitude :: ModuleChanges -> M.Magnitude
moduleChangeMagnitude (ModuleChanges unions aliases values binops) =
  maximum
    [ changeMagnitude unions
    , changeMagnitude aliases
    , changeMagnitude values
    , changeMagnitude binops
    ]


changeMagnitude :: Changes k v -> M.Magnitude
changeMagnitude (Changes added changed compatible removed) =
  if Map.size removed > 0 || Map.size changed > 0 then
    M.MAJOR

  else if Map.size added > 0 || Map.size compatible > 0 then
    M.MINOR

  else
    M.PATCH



-- GET DOCS


getDocs :: File.Writer R.PACKAGES -> R.PackageCache -> Http.Manager -> Pkg.Name -> V.Version -> IO (Either Exit.DocsProblem Docs.Documentation)
getDocs writer cache manager name version =
  do  let home = R.package cache name version
      let path = home </> "docs.json"
      exists <- File.exists path
      if exists
        then
          do  bytes <- File.readUtf8 path
              result <- D.fromByteString Docs.decoder bytes
              case result of
                Right docs ->
                  return $ Right docs

                Left _ ->
                  do  File.remove path
                      return $ Left Exit.DP_Cache
        else
          do  let url = Website.metadata name version "docs.json"
              Http.get manager url [] Exit.DP_Http $ \body ->
                do  result <- D.fromByteString Docs.decoder body
                    case result of
                      Right docs ->
                        do  Dir.createDirectoryIfMissing True home
                            File.writeUtf8 writer path body
                            return $ Right docs

                      Left _ ->
                        return $ Left $ Exit.DP_Data url body
