// VirtualDom.keyedLayers, compiled by the real compiler, with CSS transitions running in real browsers, both compile modes.

import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { built } from '../paths.js'

const transitionMs = 1000 // long enough for a layer to still be exiting when a test brings it back, on a busy machine

const css = `
  .fade { transition: opacity ${transitionMs}ms linear; opacity: 0; }
  .fade[transition-state="entering"] { opacity: 1; }
  .own-transition { transition: opacity 5s; }
  .scroller { height: 50px; overflow: auto; }
  .tall { height: 1000px; }
`

const withPanel = 'layers:below,panel,plain,above'
const withoutPanel = 'layers:below,plain,above'

;['dev', 'optimize'].forEach(mode => {
  test.describe(mode, () => {
    let pageErrors

    test.beforeEach(async ({ page }) => {
      pageErrors = toPageErrors(page)
      await open(page, mode)
    })

    test.afterEach(() => expect(pageErrors).toEqual([]))

    test.describe('a layer the view drops', () => {
      test('stays, exiting, until its transition has ended', async ({ page }) => {
        const started = Date.now()
        await send(page, withoutPanel)
        await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'exiting')
        await expect(page.locator('#panel')).toHaveCount(0)
        expect(Date.now() - started).toBeGreaterThanOrEqual(transitionMs)
      })

      test('leaves at once without transition-state, whatever transition it has of its own', async ({ page }) => {
        await send(page, 'layers:below,panel,above')
        await expect(page.locator('#plain')).toHaveCount(0, { timeout: 2000 })
      })

      test('leaves the layers after it reachable by patches', async ({ page }) => {
        await send(page, 'layers:panel,plain,above')
        await expect(page.locator('#below')).toHaveAttribute('transition-state', 'exiting')
        await send(page, 'shape:second')
        await expect(page.locator('#panel')).toHaveAttribute('data-shape', 'second')
        await expect(page.locator('#above')).toHaveAttribute('data-shape', 'second')
        await expect(page.locator('#below')).toHaveAttribute('data-shape', 'first')
      })
    })

    test.describe('a layer the view adds', () => {
      test('runs no transition on the first render', async ({ page }) => {
        expect(await toRunningTransitions(page, 'below')).toBe(0)
        expect(await toOpacity(page, 'below')).toBe(1)
      })

      test('transitions in', async ({ page }) => {
        await send(page, 'layers:below,panel,plain,above,added')
        await expect(page.locator('#added')).toHaveAttribute('transition-state', 'entering')
        expect(await toRunningTransitions(page, 'added')).toBe(1)
      })

      test('transitions in along with others added in the same render', async ({ page }) => {
        await send(page, 'layers:first,below,panel,second,plain,above,third')
        await expect(page.locator('#third')).toHaveAttribute('transition-state', 'entering')
        expect(await Promise.all(['first', 'second', 'third'].map(id => toRunningTransitions(page, id)))).toEqual([1, 1, 1])
      })

      test('goes below an exiting layer in its way', async ({ page }) => {
        await send(page, 'layers:below,added,plain,above')
        await expect.poll(() => toStack(page)).toEqual(['below', 'added', 'panel', 'plain', 'above'])
      })

      test('goes above what is exiting at the end of the list', async ({ page }) => {
        await send(page, 'layers:below,panel,plain,added')
        await expect.poll(() => toStack(page)).toEqual(['below', 'panel', 'plain', 'above', 'added'])
      })
    })

    test.describe('a layer coming back while it exits', () => {
      test.beforeEach(async ({ page }) => {
        await page.evaluate(() => {
          window.panel = document.getElementById('panel')
          window.action = window.panel.querySelector('.action')
        })
      })

      test('is the same element, patched to the new view', async ({ page }) => {
        await expect(page.locator('#panel .shape')).toHaveJSProperty('tagName', 'SPAN')
        await exit(page)
        await send(page, withPanel, 'shape:second')
        await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'entering')
        await expect(page.locator('#panel')).toHaveAttribute('data-shape', 'second')
        await expect(page.locator('#panel .shape')).toHaveJSProperty('tagName', 'DIV') // a kid replaced
        await expect(page.locator('#panel .extra')).toHaveCount(1) // a kid added
        await expect(page.locator('#panel .action')).toHaveText('second') // a kid patched
        expect(await page.evaluate(() => [window.panel.isConnected, window.action.isConnected, document.querySelectorAll('#panel').length])).toEqual([true, true, 1])
      })

      test('turns its transition around from where it is', async ({ page }) => {
        const started = await page.evaluate(async transitionMs => {
          window.app.ports.command.send('layers:below,plain,above')
          await until(() => window.panel.getAttribute('transition-state') === 'exiting')
          await new Promise(resolve => setTimeout(resolve, transitionMs / 4))
          window.app.ports.command.send('layers:below,panel,plain,above')
          await until(() => window.panel.getAttribute('transition-state') === 'entering')
          const [transition] = window.panel.getAnimations()
          return { opacity: Number(transition.effect.getKeyframes()[0].opacity), duration: transition.effect.getTiming().duration }

          function until(isDone) {
            return new Promise(resolve => {
              requestAnimationFrame(function check() { isDone() ? resolve() : requestAnimationFrame(check) })
            })
          }
        }, transitionMs)
        expect(started.opacity).toBeGreaterThan(0.1) // starting over would be from 0
        expect(started.opacity).toBeLessThan(1)
        expect(started.duration).toBeLessThan(transitionMs) // CSS shortens a transition that reverses
      })

      test('is not removed by the exit it cancelled', async ({ page }) => {
        await exit(page)
        await send(page, withPanel)
        await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'entering')
        await page.waitForTimeout(transitionMs * 1.2)
        expect(await page.evaluate(() => window.panel.isConnected)).toBe(true)
        await expect.poll(() => toOpacity(page, 'panel')).toBe(1)
      })

      test('keeps focus, typed text and scroll position', async ({ page }) => {
        await page.evaluate(() => {
          const field = window.panel.querySelector('.field')
          field.focus()
          field.value = 'typed'
          window.panel.querySelector('.scroller').scrollTop = 120
        })
        await exit(page)
        await send(page, withPanel, 'shape:second')
        await expect(page.locator('#panel')).toHaveAttribute('data-shape', 'second')
        await expect(page.locator('#panel .field')).toBeFocused()
        await expect(page.locator('#panel .field')).toHaveValue('typed')
        expect(await page.evaluate(() => window.panel.querySelector('.scroller').scrollTop)).toBe(120)
      })

      test('sends the messages of the new view, through Html.map', async ({ page }) => {
        await exit(page)
        await send(page, withPanel, 'shape:second')
        await expect(page.locator('#panel')).toHaveAttribute('data-shape', 'second')
        await page.evaluate(() => window.action.click())
        await expect(page.locator('#clicks')).toHaveText('second')
      })

      test('with another root element, is a new element that transitions in', async ({ page }) => {
        await exit(page)
        await send(page, withPanel, 'shape:retagged')
        await expect(page.locator('#panel')).toHaveJSProperty('tagName', 'SECTION')
        await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'entering')
        expect(await toRunningTransitions(page, 'panel')).toBe(1)
        expect(await page.evaluate(() => window.panel.isConnected)).toBe(false)
        expect(await toStack(page)).toEqual(['below', 'panel', 'plain', 'above'])
      })

      test('at another place in the stack, goes there, transitions in and keeps its scroll position', async ({ page }) => {
        await page.evaluate(() => { window.panel.querySelector('.scroller').scrollTop = 120 })
        await exit(page)
        await send(page, 'layers:below,plain,above,panel')
        await expect.poll(() => toStack(page)).toEqual(['below', 'plain', 'above', 'panel'])
        await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'entering')
        expect(await toRunningTransitions(page, 'panel')).toBe(1)
        expect(await page.evaluate(() => window.panel.isConnected)).toBe(true)
        await expect.poll(() => page.evaluate(() => window.panel.querySelector('.scroller').scrollTop)).toBe(120)
      })

      test('many times over, never makes a second element', async ({ page }) => {
        await page.evaluate(async ([withPanel, withoutPanel]) => {
          await Array.from({ length: 20 }).reduce(
            (previous, _, i) => previous.then(() => new Promise(resolve => {
              window.app.ports.command.send(i % 2 ? withPanel : withoutPanel)
              requestAnimationFrame(() => setTimeout(resolve, 15))
            })),
            Promise.resolve()
          )
        }, [withPanel, withoutPanel])
        await expect.poll(() => toOpacity(page, 'panel')).toBe(1)
        expect(await page.evaluate(() => [window.panel.isConnected, document.querySelectorAll('#panel').length])).toEqual([true, 1])
        expect(await toStack(page)).toEqual(['below', 'panel', 'plain', 'above'])
      })

      test('gives back an attribute it took from the stack on its way out', async ({ page }) => {
        await send(page, withoutPanel, 'history:back')
        await expect(page.locator('#panel')).toHaveAttribute('history', 'back')
        await send(page, withPanel, 'history:forward')
        await expect(page.locator('#panel')).toHaveAttribute('history', 'forward') // no patch says so, as the old and the new view agree
        expect(await page.evaluate(() => window.panel.isConnected)).toBe(true)
      })
    })

    test.describe('a layer coming back after its exit has ended', () => {
      test('is a new element that transitions in with the old scroll position', async ({ page }) => {
        await page.evaluate(() => {
          window.panel = document.getElementById('panel')
          window.panel.querySelector('.scroller').scrollTop = 77
        })
        await send(page, withoutPanel)
        await expect(page.locator('#panel')).toHaveCount(0)
        await send(page, withPanel)
        await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'entering')
        expect(await toRunningTransitions(page, 'panel')).toBe(1)
        expect(await page.evaluate(() => document.getElementById('panel') === window.panel)).toBe(false)
        await expect.poll(() => page.evaluate(() => document.querySelector('#panel .scroller').scrollTop)).toBe(77)
      })
    })
  })
})


async function open(page, mode) {
  await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body><div id="app"></div></body></html>`)
  await page.addScriptTag({ path: join(built('layers', mode), 'main.js') })
  await page.evaluate(() => {
    window.app = window.Elm.Main.init({ node: document.getElementById('app') })
  })
  await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'entering')
}

function send(page, ...commands) {
  return page.evaluate(commands => commands.forEach(command => window.app.ports.command.send(command)), commands)
}

async function exit(page) {
  await send(page, withoutPanel)
  await expect(page.locator('#panel')).toHaveAttribute('transition-state', 'exiting')
}

function toStack(page) {
  return page.evaluate(() => [...document.getElementById('stack').children].map(layer => layer.id))
}

function toRunningTransitions(page, id) {
  return page.evaluate(id => document.getElementById(id).getAnimations().length, id)
}

function toOpacity(page, id) {
  return page.evaluate(id => Number(getComputedStyle(document.getElementById(id)).opacity), id)
}

function toPageErrors(page) {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return errors
}
