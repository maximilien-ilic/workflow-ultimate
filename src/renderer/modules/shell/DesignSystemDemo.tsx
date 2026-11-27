import { useEffect, useRef, useState } from 'react'
import { registerCommand } from '../palette/commands'
import { Button, Input, Panel, Tabs } from './design-primitives'

export default function DesignSystemDemo() {
  const dialog = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState('')
  useEffect(() => registerCommand({
    id: 'shell.design-system',
    title: 'Design system',
    run: () => { if (!dialog.current?.open) dialog.current?.showModal() },
  }), [])

  return (
    <dialog ref={dialog} aria-labelledby="design-system-title">
      <h2 id="design-system-title">Design system</h2>
      <Tabs.Root defaultValue="form">
        <Tabs.List aria-label="Composants" className="mb-3 flex gap-1">
          <Tabs.Tab value="form">Formulaire</Tabs.Tab>
          <Tabs.Tab value="tokens">Couleurs</Tabs.Tab>
        </Tabs.List>
        <Tabs.Content value="form">
          <Panel>
            <form onSubmit={(event) => {
              event.preventDefault()
              setName(String(new FormData(event.currentTarget).get('name')))
            }}>
              <label>Nom <Input name="name" required /></label>{' '}
              <Button type="submit">Afficher</Button>
            </form>
            {name && <p role="status">Bonjour {name}</p>}
          </Panel>
        </Tabs.Content>
        <Tabs.Content value="tokens">
          <Panel>
            <ul className="m-0 space-y-1">
              <li className="text-app-accent">Accent</li>
              <li className="text-app-muted">Texte secondaire</li>
              <li className="text-app-ok">Terminé</li>
              <li className="text-app-warn">En attente</li>
              <li className="text-app-danger">Erreur</li>
            </ul>
          </Panel>
        </Tabs.Content>
      </Tabs.Root>
      <Button className="mt-3" onClick={() => dialog.current?.close()}>Fermer</Button>
    </dialog>
  )
}
