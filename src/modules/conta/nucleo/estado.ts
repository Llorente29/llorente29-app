// src/modules/conta/nucleo/estado.ts
//
// K02 · La línea de estado, abajo (maqueta nucleo_1): frases cortas con su
// punto de color. Decisión 8 de Julio (17/11): SOLO lo que hoy ya se cuenta
// (useCuentasMenu, conta_pendientes): las facturas recibidas por revisar, los
// movimientos del banco y los asientos por revisar. Lo que no se sabe todavía
// no se pinta, ni «…» ni verde: «Bancos cuadrados» y «el IVA del trimestre»
// esperan a que algo los cuente. Un número que no se ha podido contar (null)
// tampoco sale. Cero, contado, sí: en verde, «al día». Cada una se lee como
// una frase (respuesta K02 · 1, arreglo 3): «14 movimientos del banco por
// revisar», «Bancos al día». Núcleo puro.

import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'

export interface FraseEstado { id: string; tono: 'bien' | 'mira'; fuerte: string; resto: string; ruta: string }

const n = (c: CuentasMenu, k: string): number | null => (typeof c[k] === 'number' ? (c[k] as number) : null)
const plural = (x: number, uno: string, varios: string) => (x === 1 ? uno : varios)

export function frasesDeEstado(c: CuentasMenu, rutas: { recibidas: string; bancos: string; asientos: string }): FraseEstado[] {
  const fuera: FraseEstado[] = []
  const bancos = n(c, 'bancos')
  if (bancos !== null) {
    fuera.push(bancos > 0
      ? { id: 'bancos', tono: 'mira', fuerte: `${bancos} ${plural(bancos, 'movimiento', 'movimientos')}`, resto: 'del banco por revisar', ruta: rutas.bancos }
      : { id: 'bancos', tono: 'bien', fuerte: 'Bancos', resto: 'al día', ruta: rutas.bancos })
  }
  const asientos = n(c, 'libros')
  if (asientos !== null) {
    fuera.push(asientos > 0
      ? { id: 'asientos', tono: 'mira', fuerte: `${asientos} ${plural(asientos, 'asiento', 'asientos')}`, resto: 'por revisar', ruta: rutas.asientos }
      : { id: 'asientos', tono: 'bien', fuerte: 'Asientos', resto: 'al día', ruta: rutas.asientos })
  }
  const recibidas = n(c, 'recibidas')
  if (recibidas !== null) {
    fuera.push(recibidas > 0
      ? { id: 'recibidas', tono: 'mira', fuerte: `${recibidas} ${plural(recibidas, 'factura', 'facturas')}`, resto: 'por revisar', ruta: rutas.recibidas }
      : { id: 'recibidas', tono: 'bien', fuerte: 'Facturas', resto: 'al día', ruta: rutas.recibidas })
  }
  return fuera
}
