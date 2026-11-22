import { z } from 'zod'
import { defaultSettings, maxPanelWidth, minPanelWidth } from './layout-defaults'

const width = z.number().int().min(minPanelWidth).max(maxPanelWidth)
const panel = z.strictObject({ width, visible: z.boolean() })
const layout = z.strictObject({ left: panel, right: panel })
export const settingsSchema = z.strictObject({ layout })
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
  })
  .catch(defaultSettings)

export function decodeSettings(value: unknown): Settings {
  return storedSettings.parse(value)
}
