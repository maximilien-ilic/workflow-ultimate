import { z } from 'zod'
import { normalizeKeybinding, paletteKeybinding, panelCommandBindings } from './keybindings'
import { defaultSettings, maxPanelWidth, minPanelWidth } from './layout-defaults'

const width = z.number().int().min(minPanelWidth).max(maxPanelWidth)
const panel = z.strictObject({ width, visible: z.boolean() })
const layout = z.strictObject({ left: panel, right: panel })
const keybindings = z
  .record(
    z.string().regex(/^[a-z0-9.-]{1,80}$/),
    z
      .string()
      .max(40)
      .refine((value) => normalizeKeybinding(value) === value),
  )
  .refine((overrides) => {
    const effective = [paletteKeybinding, ...Object.values({ ...panelCommandBindings, ...overrides })]
    return new Set(effective).size === effective.length
  }, 'Raccourcis en conflit')
export const settingsSchema = z.strictObject({ layout, keybindings: keybindings.default({}) })
export type Settings = z.output<typeof settingsSchema>

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
    keybindings: keybindings.catch({}).default({}),
  })
  .catch(defaultSettings)

export function decodeSettings(value: unknown): Settings {
  return storedSettings.parse(value)
}
