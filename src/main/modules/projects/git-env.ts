// Environnement des appels git de l'appli. On retire toutes les variables GIT_* héritées
// (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE…) : lancée depuis un hook ou un terminal d'agent,
// l'appli lirait sinon un autre dépôt que celui demandé.
export function gitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')))
  // Pas de verrou optionnel : ne jamais gêner un agent qui travaille dans le même dépôt.
  return { ...clean, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
}
