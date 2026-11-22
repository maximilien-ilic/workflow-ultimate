const js = require('@eslint/js')
const { defineConfig, globalIgnores } = require('eslint/config')
const prettier = require('eslint-config-prettier/flat')
const reactHooks = require('eslint-plugin-react-hooks')
const tseslint = require('typescript-eslint')

module.exports = defineConfig(
  globalIgnores(['out/', 'dist/', 'node_modules/']),
  js.configs.recommended,
  {
    files: ['eslint.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    // shortcut: le parseur utilise l’API TypeScript 6, supprimer l’alias quand il prend en charge TypeScript 7.
    extends: [tseslint.configs.recommended],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  prettier,
)
