export function App() {
  const { electron, node } = window.wu.versions
  return (
    <main>
      <h1>Workflow Ultimate</h1>
      <p>
        Electron {electron} · Node {node}
      </p>
    </main>
  )
}
