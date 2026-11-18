// src/modules/conta/nucleo/bancos/conciliar.ts
//
// E05 · Bancos del núcleo: confirmar y deshacer, LO MISMO que la pantalla de hoy
// (regla 31; encargo E05 · 2). La pantalla de hoy lo hace dentro de su componente
// (bancos/Movimientos.tsx: confirmarPropuesta, confirmarVarios y deshacer) y las
// reglas comunes no dejan tocarla; aquí está, para la pantalla nueva, con las
// MISMAS llamadas al motor (services/bancosService · nucleo: confirmar, deshacer,
// conciliarPendientes) y en el mismo orden:
//   · una propuesta calculada con otro motor no se acepta: se vuelve a calcular
//     y se dice (PROPUESTA_RECALCULADA);
//   · confirmar: nucleo.confirmar(id, porqué, destino, confianza, regla);
//   · en bloque: uno a uno, igual que si fuera solo, y lo que falle se dice uno a uno;
//   · deshacer: nucleo.deshacer(casado, motivo).
// La única diferencia es el texto del motivo al deshacer, que dice desde dónde
// («Deshecho desde Bancos (pantallas nuevas)»): queda en el historial del casado.
// Lo que confirma y lo que deshace lo mide la e2e contra la base (mismo casado y
// mismo asiento que desde la pantalla de hoy).

import { bancos as nucleo } from '@/modules/conta/services/bancosService'
import { MOTOR_BANCOS, type Destino } from '@/modules/conta/lib/conciliacion'
import { PROPUESTA_RECALCULADA, type MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { confirmable } from '@/modules/conta/lib/conciliarVista'

export const MOTIVO_DESHACER = 'Deshecho desde Bancos (pantallas nuevas)'

export interface Contexto { accountId: string; companyId: string; hoy: string }

/** Confirmar la propuesta de un movimiento (Intro, «Sí, es ese pago»). */
export async function confirmarPropuesta(c: Contexto, m: MovimientoBanco): Promise<void> {
  const p = m.propuesta!
  if (p.motor !== MOTOR_BANCOS) {
    await nucleo.conciliarPendientes(c.accountId, c.companyId, c.hoy)
    throw new Error(PROPUESTA_RECALCULADA)
  }
  await nucleo.confirmar(m.id, m.porque ?? p.que ?? 'Confirmado', p.destino as unknown as Destino, (m.confianza ?? 'probable'), p.reglaId ?? null)
}

/** Confirmar varios («Confirmar los N»): cada uno igual que si fuera solo; lo que falle se dice uno a uno. */
export async function confirmarVarios(c: Contexto, ms: readonly MovimientoBanco[], quien: (m: MovimientoBanco) => string): Promise<{ bien: number; de: number; mal: string[]; recalculado: boolean }> {
  const lista = ms.filter(confirmable)
  if (lista.some((m) => m.propuesta?.motor !== MOTOR_BANCOS)) {
    await nucleo.conciliarPendientes(c.accountId, c.companyId, c.hoy)
    return { bien: 0, de: lista.length, mal: [], recalculado: true }
  }
  let bien = 0
  const mal: string[] = []
  for (const m of lista) {
    try { await confirmarPropuesta(c, m); bien++ } catch (e) { mal.push(`${quien(m)}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  return { bien, de: lista.length, mal, recalculado: false }
}

/** Deshacer lo casado: vuelve a estar sin casar y su asiento se quita (o se anula, si estaba validado). */
export async function deshacerCasado(m: MovimientoBanco): Promise<void> {
  if (!m.casado) throw new Error('Este movimiento no está casado: no hay nada que deshacer.')
  await nucleo.deshacer(m.casado.id, MOTIVO_DESHACER)
}
