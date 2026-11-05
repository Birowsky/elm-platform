/** The npm version of this install, like `0.19.3-1`. */
export const version: string

/** The Elm home the `elm` command uses: `ELM_HOME` if the caller set it, otherwise `~/.elm`, like stock Elm. With `ELM_PLATFORM_DEV`, one of its own. */
export function elmHome(): string

/** The files that decide what the compiler produces. A cache of its output should depend on them. */
export function platformInputs(): string[]
