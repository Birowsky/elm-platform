{-# LANGUAGE BangPatterns, ExtendedLiterals, OverloadedStrings #-}
module Deps.Registry
  ( Registry(..)
  , KnownVersions(..)
  , read
  , fetch
  , update
  , latest
  , withLocalVersions
  , getVersions
  , getVersions'
  --
  , eRegistry, dRegistry
  )
  where


import Prelude hiding (read)
import Control.Monad (filterM, liftM2)
import qualified Data.ByteString.UTF8 as BS_UTF8
import qualified Data.List as List
import qualified Data.Map.Strict as Map
import qualified Data.Maybe as Maybe
import qualified System.Directory as Dir
import System.FilePath ((</>))

import qualified Bytes.Decode as D
import qualified Bytes.Encode as E

import qualified Deps.Website as Website
import qualified Elm.Package as Pkg
import qualified Elm.Version as V
import qualified File
import qualified Http
import qualified Json.Decode as JD
import qualified Parse.Primitives as P
import qualified Reporting.Exit as Exit
import qualified Root as R



-- REGISTRY


data Registry =
  Registry
    { _count :: !Int
    , _versions :: !(Map.Map Pkg.Name KnownVersions)
    }


data KnownVersions =
  KnownVersions
    { _newest :: V.Version
    , _previous :: ![V.Version]
    }



-- READ


read :: R.PackageCache -> IO (Maybe Registry)
read cache =
  File.readBytes dRegistry (R.registry cache)



-- FETCH


fetch :: File.Writer R.PACKAGES -> Http.Manager -> R.PackageCache -> IO (Either Exit.RegistryProblem Registry)
fetch writer manager cache =
  post manager "/all-packages" allPkgsDecoder $
    \versions ->
      do  let size = Map.foldr' addEntry 0 versions
          let registry = Registry size versions
          let path = R.registry cache
          File.writeBytes writer path eRegistry registry
          return registry


addEntry :: KnownVersions -> Int -> Int
addEntry (KnownVersions _ vs) count =
  count + 1 + length vs


allPkgsDecoder :: JD.Decoder () (Map.Map Pkg.Name KnownVersions)
allPkgsDecoder =
  let
    keyDecoder =
      Pkg.keyDecoder bail

    versionsDecoder =
      JD.list (JD.mapError (\_ -> ()) V.decoder)

    toKnownVersions versions =
      case List.sortBy (flip compare) versions of
        v:vs -> return (KnownVersions v vs)
        []   -> JD.failure ()
  in
  JD.dict keyDecoder (toKnownVersions =<< versionsDecoder)



-- UPDATE


update :: File.Writer R.PACKAGES -> Http.Manager -> R.PackageCache -> Registry -> IO (Either Exit.RegistryProblem Registry)
update writer manager cache oldRegistry@(Registry size packages) =
  post manager ("/all-packages/since/" ++ show size) (JD.list newPkgDecoder) $
    \news ->
      case news of
        [] ->
          return oldRegistry

        _:_ ->
          let
            newSize = size + length news
            newPkgs = foldr addNew packages news
            newRegistry = Registry newSize newPkgs
          in
          do  File.writeBytes writer (R.registry cache) eRegistry newRegistry
              return newRegistry


addNew :: (Pkg.Name, V.Version) -> Map.Map Pkg.Name KnownVersions -> Map.Map Pkg.Name KnownVersions
addNew (name, version) versions =
  let
    add maybeKnowns =
      case maybeKnowns of
        Just (KnownVersions v vs) ->
          KnownVersions version (v:vs)

        Nothing ->
          KnownVersions version []
  in
  Map.alter (Just . add) name versions



-- NEW PACKAGE DECODER


newPkgDecoder :: JD.Decoder () (Pkg.Name, V.Version)
newPkgDecoder =
  JD.customString newPkgParser bail


newPkgParser :: P.Parser () (Pkg.Name, V.Version)
newPkgParser =
  do  pkg <- P.specialize (\_ _ -> ()) Pkg.parser
      P.word1 0x40#Word8 {-@-} bail
      vsn <- P.specialize (\_ _ -> ()) V.parser
      return (pkg, vsn)


bail :: P.Cursor -> ()
bail _ =
  ()



-- LATEST


latest :: File.Writer R.PACKAGES -> Http.Manager -> R.PackageCache -> IO (Either Exit.RegistryProblem Registry)
latest writer manager cache =
  do  maybeOldRegistry <- read cache
      case maybeOldRegistry of
        Just oldRegistry ->
          update writer manager cache oldRegistry

        Nothing ->
          fetch writer manager cache



-- LOCAL VERSIONS


-- A package in the Elm home counts as known even when the Elm website does not
-- list it, so that a patched package can have a version of its own. Only the
-- Registry in memory gets these. The one on disk stays a copy of what the website
-- said, because `_count` is how `update` asks the website what is new.
--
withLocalVersions :: R.PackageCache -> Registry -> IO Registry
withLocalVersions cache (Registry size versions) =
  do  locals <- readLocalVersions (R.packages cache)
      return $ Registry size (foldr addLocal versions locals)


addLocal :: (Pkg.Name, V.Version) -> Map.Map Pkg.Name KnownVersions -> Map.Map Pkg.Name KnownVersions
addLocal (name, version) versions =
  let
    add maybeKnowns =
      case maybeKnowns of
        Just knowns@(KnownVersions v vs)
          | version == v || elem version vs -> knowns
          | version > v                     -> KnownVersions version (v:vs)
          | otherwise                       -> KnownVersions v (List.insertBy (flip compare) version vs)

        Nothing ->
          KnownVersions version []
  in
  Map.alter (Just . add) name versions


readLocalVersions :: FilePath -> IO [(Pkg.Name, V.Version)]
readLocalVersions root =
  do  authors <- listFolders root
      names <- concat <$> traverse (\author -> map (author </>) <$> listFolders (root </> author)) authors
      concat <$> traverse (readVersionsOf root) names


readVersionsOf :: FilePath -> FilePath -> IO [(Pkg.Name, V.Version)]
readVersionsOf root name =
  do  folders <- listFolders (root </> name)
      versions <- filterM (isPackage . (\version -> root </> name </> version)) folders
      Maybe.catMaybes <$> traverse (parseLocal name) versions


-- Solving leaves an `elm.json` alone in the folder of every version it looked at,
-- and only a version with its source can be used without going online.
--
isPackage :: FilePath -> IO Bool
isPackage dir =
  (&&) <$> File.exists (dir </> "elm.json") <*> Dir.doesDirectoryExist (dir </> "src")


parseLocal :: FilePath -> FilePath -> IO (Maybe (Pkg.Name, V.Version))
parseLocal name version =
  either (const Nothing) Just <$>
    P.fromByteString newPkgParser bail (BS_UTF8.fromString (name ++ "@" ++ version))


listFolders :: FilePath -> IO [FilePath]
listFolders dir =
  filterM (Dir.doesDirectoryExist . (dir </>)) =<< Dir.listDirectory dir



-- GET VERSIONS


getVersions :: Pkg.Name -> Registry -> Maybe KnownVersions
getVersions name (Registry _ versions) =
  Map.lookup name versions


getVersions' :: Pkg.Name -> Registry -> Either [Pkg.Name] KnownVersions
getVersions' name (Registry _ versions) =
  case Map.lookup name versions of
    Just kvs -> Right kvs
    Nothing -> Left $ Pkg.nearbyNames name (Map.keys versions)



-- POST


post :: Http.Manager -> String -> JD.Decoder x a -> (a -> IO b) -> IO (Either Exit.RegistryProblem b)
post manager path decoder callback =
  let
    url = Website.route path []
  in
  Http.post manager url [] Exit.RP_Http $
    \body ->
      do  result <- JD.fromByteString decoder body
          case result of
            Right a -> Right <$> callback a
            Left _ -> return $ Left $ Exit.RP_Data url body



-- BINARY


eRegistry :: Registry -> E.Builder
eRegistry (Registry c vs) =
  E.int c <> E.dict32 Pkg.eName eKnownVersions vs


dRegistry :: D.Decoder Registry
dRegistry =
  liftM2 Registry D.int (D.dict32 Pkg.dName dKnownVersions)


eKnownVersions :: KnownVersions -> E.Builder
eKnownVersions (KnownVersions n p) =
  V.eVersion n <> E.list32 V.eVersion p


dKnownVersions :: D.Decoder KnownVersions
dKnownVersions =
  liftM2 KnownVersions V.dVersion (D.list32 V.dVersion)

