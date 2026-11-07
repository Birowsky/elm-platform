// Saving a block into the app's own stylesheet. Chrome lets an extension write only to a folder picked in its picker, so the
// first save of an app asks for the folder of its sources, and later ones find that folder again, one for each app by the
// origin it is served from. A folder without the block, or with it in two files, can be swapped for another.

import { holdsBlock, toSavedText } from './scss-block.js'

export { saveBlock }

const SKIPPED = /^(?:\.|node_modules$|elm-stuff$)/ // folders that hold no stylesheet of the app's own
const STYLESHEETS = [/\.scss$/i, /\.css$/i] // in this order, as a block in SCSS is where one in built CSS comes from

/** { saved: path } once written, { problem, pickAgain } where it can't be, and { cancelled } when no folder was picked. */
async function saveBlock({ origin, name, changes, pickAgain }) {
  if (!window.showDirectoryPicker) return { problem: 'This Chrome can\'t open folders.' }
  const folder = (!pickAgain && await remembered(origin)) || await pick()
  if (!folder) return { cancelled: true }
  if (!await mayWrite(folder)) return { problem: `Writing to ${folder.name} wasn't allowed.`, pickAgain: true }
  await remember(origin, folder)

  const files = await filesHolding(folder, name)
  if (files.length !== 1) {
    return { problem: files.length === 0 ? `No stylesheet in ${folder.name} has [ef-stagger="${name}"].` : `[ef-stagger="${name}"] is in ${files.map(file => file.path).join(' and ')}.`, pickAgain: true }
  }
  const [file] = files
  const saved = toSavedText(file.text, name, changes)
  if (saved.problem) return { problem: `${file.path} ${saved.problem}.` }
  const writable = await file.handle.createWritable()
  await writable.write(saved.text)
  await writable.close()
  return { saved: file.path }
}

async function pick() {
  try {
    return await window.showDirectoryPicker({ id: 'stagger-tuner', mode: 'readwrite' }) // the id has it open where it was last time
  } catch (error) {
    if (error.name === 'AbortError') return null
    throw error
  }
}

/** Asked again in a new session, for a folder picked in an earlier one. */
async function mayWrite(folder) {
  return await folder.queryPermission({ mode: 'readwrite' }) === 'granted' || await folder.requestPermission({ mode: 'readwrite' }) === 'granted'
}

/** The stylesheets that have the block, of the first kind that does, with their text and their path from the folder. */
async function filesHolding(folder, name) {
  const holding = (await stylesheetsIn(folder, folder.name)).filter(file => holdsBlock(file.text, name))
  return STYLESHEETS.map(kind => holding.filter(file => kind.test(file.path))).find(found => found.length > 0) ?? []

  async function stylesheetsIn(directory, path) {
    const entries = await Array.fromAsync(directory.values())
    const found = await Promise.all(entries.map(async entry => entry.kind === 'directory'
      ? SKIPPED.test(entry.name) ? [] : stylesheetsIn(entry, `${path}/${entry.name}`)
      : STYLESHEETS.some(kind => kind.test(entry.name)) ? [{ handle: entry, path: `${path}/${entry.name}`, text: await (await entry.getFile()).text() }] : []))
    return found.flat()
  }
}


// THE FOLDER OF EACH APP

function remembered(origin) {
  return withFolders('readonly', folders => folders.get(origin))
}

function remember(origin, folder) {
  return withFolders('readwrite', folders => folders.put(folder, origin))
}

/** A folder is no JSON, so it is kept where the browser can keep one: IndexedDB. */
function withFolders(mode, use) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('stagger-tuner', 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore('folders')
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const database = opening.result
      const transaction = database.transaction('folders', mode)
      const request = use(transaction.objectStore('folders'))
      transaction.oncomplete = () => {
        database.close()
        resolve(request.result)
      }
      transaction.onerror = () => reject(transaction.error)
    }
  })
}
