import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron, expect, test, type Page } from '@playwright/test'

let dir: string
test.beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'wu-e2e-view-')))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

// xterm dessine en WebGL (canvas) : on lit le texte affiché via l'accesseur en lecture seule du renderer.
const screenOf = (page: Page, id: string) =>
  page.evaluate(
    (id) => (window as unknown as { __wuTerminalText?: (id: string) => string }).__wuTerminalText?.(id) ?? '',
    id,
  )

test('restaure les volets, leur historique borné et le dossier courant après arrêt complet', async () => {
  const repo = join(dir, 'projet')
  const subfolder = join(repo, 'sous-dossier')
  mkdirSync(subfolder, { recursive: true })
  execFileSync('git', ['init', '-q', repo])
  const launch = () =>
    _electron.launch({
      args: ['out/main/index.js'],
      env: {
        ...process.env,
        HOME: dir,
        SHELL: '/bin/bash',
        INPUTRC: '/dev/null',
        XDG_DATA_HOME: join(dir, 'data'),
        XDG_CONFIG_HOME: join(dir, 'config'),
      },
    })
  const snapshots = join(dir, 'data', 'workflow-ultimate', 'terminal-history')
  let first: string
  let second: string
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    await page.reload()
    const openTerminal = page.getByRole('button', { name: 'Terminal dans projet' })
    await expect(openTerminal).toBeVisible()
    expect(await page.evaluate(() => '__wuTerminalText' in window)).toBe(false)
    await openTerminal.click()
    const hosts = page.locator('.terminal-host')
    first = (await hosts.first().getAttribute('data-terminal-id'))!
    await hosts.first().click()
    await page.keyboard.type('cd sous-dossier; seq 1 10100; export WU_OLD_SHELL=yes\n')
    await expect.poll(() => screenOf(page, first)).toMatch(/^10100$/m)

    const snapshot = join(snapshots, `${first}.json`)
    await expect
      .poll(() => (existsSync(snapshot) ? readFileSync(snapshot, 'utf8') : ''), { timeout: 12_000 })
      .toContain('10100')
    expect(statSync(snapshot).mode & 0o777).toBe(0o600)

    await page.keyboard.press('Control+Shift+D')
    await expect(hosts).toHaveCount(2)
    second = (await hosts.last().getAttribute('data-terminal-id'))!
    await hosts.last().click()
    await page.keyboard.type('echo sortie-$((7*6))\n')
    await expect.poll(() => screenOf(page, second)).toMatch(/^sortie-42$/m)
  } finally {
    await app.close()
  }

  const restarted = await launch()
  try {
    const page = await restarted.firstWindow()
    await expect(page.locator('.terminal-host')).toHaveCount(2)
    await expect.poll(() => screenOf(page, first)).toContain('session restaurée')
    const history = await screenOf(page, first)
    expect(history).toMatch(/^10100$/m)
    expect(history).not.toMatch(/^1$/m)
    expect(history.match(/^\d+$/gm)!.length).toBeLessThanOrEqual(10_000)
    await expect.poll(() => screenOf(page, second)).toMatch(/^sortie-42$/m)
    await page.locator(`[data-terminal-id="${first}"]`).click()
    await page.keyboard.type('pwd; echo nouveau-${WU_OLD_SHELL:-shell}\n')
    await expect.poll(() => screenOf(page, first)).toMatch(/^nouveau-shell$/m)
    expect((await screenOf(page, first)).split('\n')).toContain(subfolder)
    await page.reload()
    await expect.poll(() => screenOf(page, first)).toMatch(/^nouveau-shell$/m)
    expect((await screenOf(page, first)).match(/session restaurée/g)).toHaveLength(1)
    expect((await screenOf(page, first)).match(/^10100$/gm)).toHaveLength(1)
    await page.locator(`[data-terminal-id="${first}"]`).click()
    await page.keyboard.press('Control+Shift+W')
    await expect.poll(() => existsSync(join(snapshots, `${first}.json`))).toBe(false)
    await expect(page.locator('.terminal-host')).toHaveCount(1)
  } finally {
    await restarted.close()
  }
})

test('ouvrir un terminal, y taper, le découper, survivre au rechargement, fermer un volet', async () => {
  const repo = join(dir, 'mon-projet')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      HOME: dir,
      SHELL: '/bin/bash',
      INPUTRC: '/dev/null',
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CONFIG_HOME: join(dir, 'config'),
    },
  })
  const page = await app.firstWindow()
  await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()

  await page.getByRole('button', { name: 'Terminal dans mon-projet' }).click()
  const hosts = page.locator('.terminal-host')
  await expect(hosts).toHaveCount(1)
  const first = (await hosts.first().getAttribute('data-terminal-id'))!
  await hosts.first().click()
  await page.keyboard.type('echo texte à effacer')
  await page.keyboard.press('Home')
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Palette de commandes' })
  await expect(palette).toBeHidden()
  await page.keyboard.type('echo coupe-$((3*7))\n')
  await expect.poll(() => screenOf(page, first)).toMatch(/^coupe-21$/m)
  await page.keyboard.press('Control+Shift+p')
  await expect(palette).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(hosts.first().getByRole('textbox', { name: 'Terminal input' })).toBeFocused()
  await page.keyboard.type('echo clavier-$((2*21))\n')
  await expect.poll(() => screenOf(page, first)).toContain('clavier-42')

  // Le split remonte le premier volet : il doit garder son historique et son shell (pas de second create).
  await page.keyboard.press('Control+Shift+D')
  await expect(hosts).toHaveCount(2)
  await expect.poll(() => screenOf(page, first)).toContain('clavier-42')
  await page.locator(`[data-terminal-id="${first}"]`).click()
  await page.keyboard.type('echo encore-$((5*5))\n')
  await expect.poll(() => screenOf(page, first)).toContain('encore-25')
  expect(await screenOf(page, first)).not.toContain('déjà ouvert')

  // Rechargement en plein flux : chaque ligne apparaît une fois, dans l'ordre.
  await page.keyboard.type('for i in $(seq 1 300); do echo ligne-$i; sleep 0.004; done; echo fin-$((2+2))\n')
  await expect.poll(() => screenOf(page, first)).toContain('ligne-40')
  await page.reload()
  await expect(hosts).toHaveCount(2)
  await expect.poll(() => screenOf(page, first), { timeout: 10_000 }).toContain('fin-4')
  const numbers = [...(await screenOf(page, first)).matchAll(/^ligne-(\d+)$/gm)].map((m) => Number(m[1]))
  expect(numbers).toEqual(Array.from({ length: 300 }, (_, i) => i + 1))

  // Fermer un volet termine son shell et libère tout : il devient inconnu pour le main.
  await page.locator(`[data-terminal-id="${first}"]`).click()
  await page.keyboard.press('Control+Shift+W')
  await expect(hosts).toHaveCount(1)
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.wu.invoke('terminal:attach', { id }).then(
            () => 'présent',
            (e: Error) => e.message,
          ),
        first,
      ),
    )
    .toContain('inconnu')
  await app.close()
})

test('un collage plus long que la borne du canal arrive entier, dans l’ordre', async () => {
  const repo = join(dir, 'collage')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })
  const page = await app.firstWindow()
  await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
  await page.reload()
  await page.getByRole('button', { name: 'Terminal dans collage' }).click()
  const host = page.locator('.terminal-host').first()
  const id = (await host.getAttribute('data-terminal-id'))!
  await host.click()
  // Mode non canonique : sinon le TTY Linux tronque toute ligne au-delà de 4 096 caractères.
  await page.keyboard.type('stty -icanon -echo; echo pret-$((1+1)); head -c 70000 | wc -c; stty sane\n')
  // Coller seulement quand head lit déjà : sinon le collage arrive dans l'éditeur de ligne du shell.
  await expect.poll(() => screenOf(page, id)).toMatch(/^pret-2$/m)
  // 70 000 caractères : au-delà de la borne de 65 536 du canal terminal:write, il faut découper.
  await app.evaluate(({ clipboard }) => clipboard.writeText('x'.repeat(70000)), undefined)
  await page.keyboard.press('Control+Shift+V')
  await expect.poll(() => screenOf(page, id), { timeout: 15_000 }).toMatch(/^70000$/m)
  await app.close()
})

test('un split pendant un collage ne laisse pas la frappe suivante doubler le collage', async () => {
  const repo = join(dir, 'split-collage')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  const app = await _electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, XDG_DATA_HOME: join(dir, 'data'), XDG_CONFIG_HOME: join(dir, 'config') },
  })
  try {
    const page = await app.firstWindow()
    await page.evaluate((path) => window.wu.invoke('projects:add', { path }), repo)
    await page.reload()
    await page.getByRole('button', { name: 'Terminal dans split-collage' }).click()

    const hosts = page.locator('.terminal-host')
    const id = (await hosts.first().getAttribute('data-terminal-id'))!
    const originalHost = page.locator(`[data-terminal-id="${id}"]`)
    const input = originalHost.getByRole('textbox', { name: 'Terminal input' })
    const originalInput = await input.elementHandle()

    const writes = await app.evaluateHandle(({ BrowserWindow }, terminalId) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents
      const received: string[] = []
      const firstWrite = Promise.withResolvers<void>()
      contents.ipc.handle('terminal:write', async (_event, request: { id: string; data: string }) => {
        if (request.id === terminalId && (request.data.includes('x') || request.data === 'y')) {
          received.push(request.data === 'y' ? 'frappe' : 'collage')
          if (received.length === 1) await firstWrite.promise
        }
        return null
      })
      return { received, release: firstWrite.resolve }
    }, id)
    const writeOrder = () => writes.evaluate(({ received }) => received)

    const pasteLength = 70_000
    await input.evaluate((element, text) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', text)
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
    }, 'x'.repeat(pasteLength))
    await expect.poll(writeOrder).toEqual(['collage'])
    await input.press('Control+Shift+D')
    await expect(hosts).toHaveCount(2)
    await expect.poll(() => originalInput.evaluate((element) => element.isConnected)).toBe(false)

    await input.press('y')
    // Ce tour IPC s'assure que toute frappe déjà transmise a atteint le main avant de le débloquer.
    await page.evaluate(() => window.wu.invoke('app:info', {}))
    await writes.evaluate(({ release }) => release())
    await expect.poll(writeOrder).toEqual(['collage', 'collage', 'frappe'])
  } finally {
    await app.close()
  }
})
