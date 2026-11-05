// The compiler's real output in real browsers, both compile modes. See apps/lazy/src/Main.elm for how a skip is observed.

import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { built } from '../paths.js'

['dev', 'optimize'].forEach(mode => {
  test.describe(mode, () => {
    test.beforeEach(({ page }) => open(page, mode))

    test.describe('lazyShallow', () => {
      test('skips the view on a new record whose fields are the same', async ({ page }) => {
        await setStamp(page, 1)
        await tick(page)
        await expect(page.locator('#shallow-stamp')).toHaveText('0')
      })

      test('runs the view when a field changes', async ({ page }) => {
        await setStamp(page, 1)
        await send(page, 'change-field')
        await expect(page.locator('#shallow-field')).toHaveText('1')
        await expect(page.locator('#shallow-stamp')).toHaveText('1')
      })

      test('checks fields by reference, so an equal new list runs the view', async ({ page }) => {
        await setStamp(page, 1)
        await send(page, 'new-equal-items')
        await expect(page.locator('#shallow-stamp')).toHaveText('1')
      })
    })

    test.describe('lazyShallowDeep', () => {
      test('renders a real element on first use', async ({ page }) => {
        await expect(page.locator('div#shallow-deep')).toBeVisible()
        await expect(page.locator('undefined')).toHaveCount(0)
      })

      test('skips the view when nothing changed', async ({ page }) => {
        await setStamp(page, 1)
        await tick(page)
        await expect(page.locator('#shallow-deep-stamp')).toHaveText('0')
      })

      test('skips the view when the second argument is rebuilt but equal', async ({ page }) => {
        await setStamp(page, 1)
        await send(page, 'new-equal-deep')
        await tick(page)
        await expect(page.locator('#shallow-deep-stamp')).toHaveText('0')
      })

      test('runs the view when the second argument changes', async ({ page }) => {
        await setStamp(page, 1)
        await send(page, 'change-deep')
        await expect(page.locator('#shallow-deep-value')).toHaveText('1')
        await expect(page.locator('#shallow-deep-stamp')).toHaveText('1')
      })

      test('runs the view when a field of the record changes', async ({ page }) => {
        await setStamp(page, 1)
        await send(page, 'change-field')
        await expect(page.locator('#shallow-deep-field')).toHaveText('1')
        await expect(page.locator('#shallow-deep-stamp')).toHaveText('1')
      })

      test('the same function in the second argument is fine', async ({ page }) => {
        const errors = toPageErrors(page)
        await setStamp(page, 1)
        await tick(page)
        await expect(page.locator('#handler-stamp')).toHaveText('0')
        expect(errors).toEqual([])
      })

      test('two different functions in the second argument crash, like (==)', async ({ page }) => {
        const errors = toPageErrors(page)
        await send(page, 'change-handler')
        await expect.poll(() => errors.length).toBeGreaterThan(0)
        expect(errors[0]).toMatch(mode === 'dev' ? /on functions/ : /hints\/5\.md/)
      })
    })

    test('the lazy nodes swap with each other and with plain nodes in the same position', async ({ page }) => {
      const position = page.locator('#position')
      await expect(position).toHaveText('lazy 0')
      await send(page, 'show-shallow-deep')
      await expect(position).toHaveText('shallow-deep 0 0')
      await send(page, 'show-shallow')
      await expect(position).toHaveText('shallow 0')
      await send(page, 'show-plain')
      await expect(page.locator('p#position')).toHaveText('plain')
      await send(page, 'show-shallow-deep')
      await expect(page.locator('div#position')).toHaveText('shallow-deep 0 0')
      await send(page, 'show-lazy')
      await expect(position).toHaveText('lazy 0')
    })

    test('events still arrive after a skip', async ({ page }) => {
      await tick(page)
      await page.click('#shallow-button')
      await expect(page.locator('#clicks')).toHaveText('1')
      await tick(page)
      await page.click('#shallow-deep-button')
      await expect(page.locator('#clicks')).toHaveText('2')
    })

    test('events pass through Html.map from a skipped node', async ({ page }) => {
      await setStamp(page, 1)
      await tick(page)
      await expect(page.locator('#mapped-stamp')).toHaveText('0')
      await page.click('#mapped-button')
      await expect(page.locator('#mapped-clicks')).toHaveText('1')
    })

    test.describe('Html.Keyed', () => {
      test('a kid that stays in place keeps its focus while another moves', async ({ page }) => {
        await page.focus('#input-b')
        await send(page, 'keys:d,a,b,c')
        await expect.poll(() => toKeyedIds(page)).toEqual(['item-d', 'item-a', 'item-b', 'item-c'])
        await expect(page.locator('#input-b')).toBeFocused()
      })

      test('only the kid that has to move is touched', async ({ page }) => {
        const touched = await page.evaluate(() => new Promise(resolve => {
          const seen = new Set()
          const observer = new MutationObserver(records => {
            records.forEach(record => [...record.addedNodes, ...record.removedNodes].forEach(node => seen.add(node.id)))
            observer.disconnect()
            resolve([...seen])
          })
          observer.observe(document.getElementById('keyed'), { childList: true })
          window.app.ports.command.send('keys:d,a,b,c')
        }))
        expect(touched).toEqual(['item-d'])
      })

      test('kids keep their own DOM nodes through a reorder, an add and a remove', async ({ page }) => {
        await page.evaluate(() => document.querySelectorAll('#keyed li').forEach(li => { li.mark = li.id }))
        await send(page, 'keys:c,e,a')
        await expect.poll(() => toKeyedIds(page)).toEqual(['item-c', 'item-e', 'item-a'])
        const marks = await page.evaluate(() => [...document.querySelectorAll('#keyed li')].map(li => li.mark ?? null))
        expect(marks).toEqual(['item-c', null, 'item-a'])
      })
    })
  })
})


async function open(page, mode) {
  await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>')
  await page.addScriptTag({ path: join(built('lazy', mode), 'main.js') })
  await page.evaluate(() => {
    window.external = { stamp: 0 }
    window.app = window.Elm.Main.init({ node: document.getElementById('app'), flags: window.external })
  })
  await expect(page.locator('#ticks')).toHaveText('0')
}

function send(page, command) {
  return page.evaluate(command => window.app.ports.command.send(command), command)
}

function setStamp(page, stamp) {
  return page.evaluate(stamp => { window.external.stamp = stamp }, stamp)
}

/** Returns once the view has run: Elm patches the whole page in one frame, so #ticks changing means the lazy nodes have had their chance. */
async function tick(page) {
  const ticks = Number(await page.textContent('#ticks'))
  await send(page, 'tick')
  await expect(page.locator('#ticks')).toHaveText(String(ticks + 1))
}

function toKeyedIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('#keyed li')].map(li => li.id))
}

function toPageErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return errors
}
