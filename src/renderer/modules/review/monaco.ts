// Chargé à la demande (import dynamique) : Monaco ne pèse rien au démarrage de l'appli.
// Éditeur de base + coloration syntaxique ; pas de services de langage, inutiles pour lire un diff.
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/basic-languages/monaco.contribution'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

export { monaco }
