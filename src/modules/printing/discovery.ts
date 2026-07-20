// src/modules/printing/discovery.ts
//
// Autodescubrimiento de impresoras en la LAN (F4). Envuelve el plugin nativo
// EscposPrinter.discover, que escanea el puerto 9100 de la subred /24. SÓLO
// funciona en la app nativa (Capacitor): en el navegador web no hay sockets
// crudos, así que canDiscover() = false y el llamador oculta el botón. El
// fallback (paridad Last, nunca falla) es la entrada manual de IP, siempre visible.

import { Capacitor } from '@capacitor/core'
import { EscposPrinter, type DiscoveredPrinter } from '../../native/print/EscposPrinter'

export type { DiscoveredPrinter }

/** ¿Se puede autodescubrir en este dispositivo? (sólo app nativa). */
export function canDiscover(): boolean {
  return Capacitor.isNativePlatform()
}

/** Escanea la red buscando impresoras de red (puerto 9100). [] si ninguna. */
export async function discoverPrinters(opts?: { port?: number; timeoutMs?: number }): Promise<DiscoveredPrinter[]> {
  if (!canDiscover()) return []
  const { printers } = await EscposPrinter.discover({
    port: opts?.port ?? 9100,
    timeoutMs: opts?.timeoutMs ?? 300,
  })
  return printers ?? []
}
