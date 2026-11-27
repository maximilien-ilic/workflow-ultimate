import { z } from 'zod'
import { normalizeKeybinding, paletteKeybinding, panelCommandBindings } from './keybindings'
import { defaultSettings, maxPanelWidth, minPanelWidth } from './layout-defaults'

const width = z.number().int().min(minPanelWidth).max(maxPanelWidth)
const panel = z.strictObject({ width, visible: z.boolean() })
const layout = z.strictObject({ left: panel, right: panel })
const keybindingOverrides = z.record(
  z.string().regex(/^[a-z0-9.-]{1,80}$/),
  z
    .string()
    .max(40)
    .refine((value) => normalizeKeybinding(value) === value),
)
const keybindings = keybindingOverrides.refine((overrides) => {
  const effective = [paletteKeybinding, ...Object.values({ ...panelCommandBindings, ...overrides })]
  return new Set(effective).size === effective.length
}, 'Raccourcis en conflit')

const panelDefaults = new Map<string, string>(Object.entries(panelCommandBindings))
const storedKeybindings = keybindingOverrides
  .transform((overrides) => {
    const compatible = { ...overrides }
    let reserved = new Set([paletteKeybinding])
    while (reserved.size > 0) {
      const restoredDefaults = new Set<string>()
      for (const [command, binding] of Object.entries(compatible)) {
        if (!reserved.has(binding)) continue
        delete compatible[command]
        // Un raccourci par défaut restauré peut déjà être utilisé par une autre action.
        const fallback = panelDefaults.get(command)
        if (fallback) restoredDefaults.add(fallback)
      }
      reserved = restoredDefaults
    }
    return compatible
  })
  .pipe(keybindings)

const orcaImport = z.strictObject({
  seen: z.boolean(),
  workspaces: z
    .string()
    .startsWith('/')
    .max(4096)
    .refine((path) => !path.includes('\0'))
    .optional(),
})
export const settingsSchema = z.strictObject({
  layout,
  keybindings: keybindings.default({}),
  orcaImport: orcaImport.optional(),
})
export type Settings = z.output<typeof settingsSchema>
export const DEFAULT_AGENT_CONCURRENCY = 3
export const agentConcurrency = z.int().positive()
export type StoredSettings = Settings & { notificationSound?: boolean; maxConcurrentAgents?: number }

function storedPanel(defaults: Settings['layout']['left']) {
  return z
    .object({ width: width.catch(defaults.width), visible: z.boolean().catch(defaults.visible) })
    .catch(defaults)
}

const storedSettings = z
  .object({
    layout: z
      .object({
        left: storedPanel(defaultSettings.layout.left),
        right: storedPanel(defaultSettings.layout.right),
      })
      .catch(defaultSettings.layout),
    keybindings: storedKeybindings.catch({}).default({}),
    orcaImport: orcaImport.optional().catch(undefined),
    notificationSound: z.boolean().optional().catch(undefined),
    maxConcurrentAgents: agentConcurrency.optional().catch(undefined),
  })
  .catch(defaultSettings)

export function decodeSettings(value: unknown): StoredSettings {
  return storedSettings.parse(value)
}
