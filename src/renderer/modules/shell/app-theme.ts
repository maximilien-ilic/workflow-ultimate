const storageKey = 'wu.app-theme'
export type AppTheme = 'dark' | 'light'

export function readTheme(): AppTheme {
  try {
    return localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme
}

export function setTheme(theme: AppTheme) {
  applyTheme(theme)
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // Le thème reste appliqué dans cette fenêtre.
  }
}

export function initializeTheme() {
  applyTheme(readTheme())
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey || event.key === null) applyTheme(readTheme())
  })
}
