// src/modules/conta/bancos/acciones.ts
//
// S02 · PR 2 · Las acciones de cada página de Bancos, con la regla del patrón
// (marco/acciones.ts): UN principal azul, «Subir extracto»; como mucho dos
// blancos; lo demás en «Más acciones ▾». En el móvil, el principal va abajo,
// bajo el pulgar, y los blancos dentro de «Más acciones» (como la fila de
// serie del marco). Antes eran la cinta de Bancos (esqueleto/ordenes.ts:
// Traer movimientos · Automático · Revisar).
//
//   · Una página no se ofrece a sí misma (en Reglas no sale «Reglas»).
//   · En Movimientos no sale «Casados solos»: allí es una de sus bandejas, y
//     contaría otra cosa (el banco elegido, no todos): dos cifras distintas con
//     el mismo nombre en la misma pantalla (S01e).
//   · En «Subir extracto» no hay principal: la página entera es esa acción.
//   · En Cuentas y extractos, primero «+ Nuevo banco o tarjeta» (antes, un
//     segundo botón azul dentro de la página).
// Núcleo puro: se prueba sin React (tests/unit/modules/conta/s02/pr2-bancos-*).

import { BLANCOS } from '@/modules/conta/marco/acciones'
import type { VistaBancos } from '@/modules/conta/bancos/navegacion'

export type AccionBancos = 'nuevo-banco' | 'casados' | 'reglas' | 'hecho'

export interface RepartoBancos {
  /** Si lleva el principal, «Subir extracto». */
  principal: boolean
  blancos: AccionBancos[]
  mas: AccionBancos[]
}

export function accionesDeLaPagina(v: VistaBancos, movil: boolean): RepartoBancos {
  const todas: AccionBancos[] = [...(v === 'cuentas' ? ['nuevo-banco' as const] : []), 'casados', 'reglas', 'hecho']
  const fuera = new Set<AccionBancos>([
    ...(v === 'movimientos' ? ['casados' as const] : []),
    ...(v === 'reglas' ? ['reglas' as const] : []),
    ...(v === 'hecho' ? ['hecho' as const] : []),
  ])
  const lista = todas.filter((a) => !fuera.has(a))
  const blancos = movil ? [] : lista.slice(0, BLANCOS)
  return { principal: v !== 'subir', blancos, mas: lista.filter((a) => !blancos.includes(a)) }
}
