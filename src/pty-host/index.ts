import type { HostRequest } from '../shared/pty-protocol'
import { createHost } from './host'

// Processus utilitaire lancé par le main (utilityProcess.fork) : il garde les PTY en vie
// même si le renderer recharge ou plante.
const port = process.parentPort
const host = createHost((event) => port.postMessage(event))
port.on('message', (message) => host.handle(message.data as HostRequest))
