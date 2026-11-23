import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type Page } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-term-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

const launch = () =>
  _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })

// Côté page : collecte la sortie d'un terminal dans window.__out et accuse réception.
const listen = (page: Page, id: string) =>
  page.evaluate((id) => {
    const w = window as unknown as { __out: string }
    w.__out = ''
    window.wu.onTerminalEvent((e) => {
      if (e.type !== 'data' || e.id !== id) return
      w.__out += e.data
      void window.wu.invoke('terminal:ack', { id, chars: e.data.length })
    })
  }, id)
const output = (page: Page) => page.evaluate(() => (window as unknown as { __out: string }).__out)

test('un terminal tourne dans le pty-host et survit au rechargement du renderer', async () => {
  const app = await launch()
  const page = await app.firstWindow()
  const id = crypto.randomUUID()
  await listen(page, id)
  await page.evaluate(({ id, cwd }) => window.wu.invoke('terminal:create', { id, cwd, cols: 80, rows: 24 }), {
    id,
    cwd: dir,
  })
  await page.evaluate(
    (id) => window.wu.invoke('terminal:write', { id, data: 'echo resultat-$((6*7))\n' }),
    id,
  )
  await expect.poll(() => output(page)).toContain('resultat-42')

  await page.reload()
  const replay = await page.evaluate((id) => window.wu.invoke('terminal:attach', { id }), id)
  expect(replay).toContain('resultat-42')

  await listen(page, id)
  await page.evaluate((id) => window.wu.invoke('terminal:write', { id, data: 'echo encore-$((1+1))\n' }), id)
  await expect.poll(() => output(page)).toContain('encore-2')
  await app.close()
})

test('un shell survit au plantage forcé du renderer et sa sortie est réaffichée', async () => {
  const app = await launch()
  const page = await app.firstWindow()
  const id = crypto.randomUUID()
  await page.evaluate(({ id, cwd }) => window.wu.invoke('terminal:create', { id, cwd, cols: 80, rows: 24 }), {
    id,
    cwd: dir,
  })
  // Le shell attend une saisie : seul le MÊME shell, encore vivant après le plantage, pourra y répondre.
  // Les marqueurs attendus (pret-7, repris-42) n'apparaissent pas dans ce qui est tapé (écho du TTY).
  await page.evaluate(
    (id) =>
      window.wu.invoke('terminal:write', { id, data: 'echo pret-$((3+4)); read x; echo repris-$((x*2))\n' }),
    id,
  )
  await expect
    .poll(() => page.evaluate((id) => window.wu.invoke('terminal:attach', { id }), id))
    .toContain('pret-7')

  // Plantage puis rechargement pilotés depuis le main : la page Playwright plantée n'est plus utilisable,
  // on interroge donc directement le nouveau renderer.
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0]!.webContents
    return new Promise((resolve) => {
      contents.once('render-process-gone', () => {
        contents.once('did-finish-load', resolve)
        contents.reload()
      })
      contents.forcefullyCrashRenderer()
    })
  })
  const inRenderer = (code: string) =>
    app.evaluate(
      ({ BrowserWindow }, code) =>
        BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(code) as Promise<string>,
      code,
    )
  const attach = `window.wu.invoke('terminal:attach', { id: ${JSON.stringify(id)} })`
  expect(await inRenderer(attach)).not.toContain('repris-42')
  await inRenderer(`window.wu.invoke('terminal:write', { id: ${JSON.stringify(id)}, data: '21\\n' })`)
  await expect.poll(() => inRenderer(attach), { timeout: 10_000 }).toContain('repris-42')
  await app.close()
})

test('un terminal inconnu ou un dossier invalide est refusé clairement', async () => {
  const app = await launch()
  const page = await app.firstWindow()
  const unknown = await page.evaluate(() =>
    window.wu.invoke('terminal:write', { id: crypto.randomUUID(), data: 'x' }).then(
      () => 'accepté',
      (e: Error) => e.message,
    ),
  )
  expect(unknown).toContain('inconnu')
  const relative = await page.evaluate(() =>
    window.wu.invoke('terminal:create', { id: crypto.randomUUID(), cwd: 'relatif', cols: 80, rows: 24 }).then(
      () => 'accepté',
      (e: Error) => e.message,
    ),
  )
  expect(relative).toContain('chemin absolu')
  // Un dossier absolu inexistant : le lancement échoue dans le pty-host, et create le dit (pas de faux succès).
  const missing = await page.evaluate(() =>
    window.wu
      .invoke('terminal:create', { id: crypto.randomUUID(), cwd: '/nexiste/pas', cols: 80, rows: 24 })
      .then(
        () => 'accepté',
        (e: Error) => e.message,
      ),
  )
  expect(missing).toContain('introuvable')
  await app.close()
})
