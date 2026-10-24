// src/modules/conta/lib/validarBanco.ts
//
// S02 · PR 2 (Julio, 22/10): Bancos › Movimientos valida el asiento propuesto
// de lo casado («Por validar»), porque Contabilidad › Asientos ya no lo enseña
// (lib/diario.ts, SE_DECIDE_EN) y no puede quedarse sin sitio (regla 7).
//
// El veredicto de cada uno, con su porqué (regla 3 del patrón: nunca solo
// «Propuesto» ni un porcentaje), sale de lo que ya se guarda:
//   · lo que la base pararía al validar (conta_esperan): «Aún no se puede»;
//   · quién lo casó: tú (lo decidiste al confirmar) o yo con seguridad →
//     «Lista para contabilizar»; yo sin seguridad → «Revisa esto».
// «Validar los N» en bloque lleva solo los «Lista para contabilizar».
// Núcleo puro: se prueba sin React (tests/unit/modules/conta/s02/pr2-bancos-validar.test.ts).

import type { TipoVeredicto } from '@/modules/conta/diseno/plantillas'
import type { MovimientoBanco } from '@/modules/conta/lib/bancosVista'
import { porValidar } from '@/modules/conta/lib/conciliarVista'

export interface VeredictoBanco { tipo: Extract<TipoVeredicto, 'lista' | 'revisa'>; titulo: string; porque: string }

const frase = (x: string) => { const t = x.trim().replace(/^casado solo\s*[:·]\s*/i, ''); return /[.!?…]$/.test(t) ? t : `${t}.` }
const primeraMayuscula = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/** El veredicto del asiento propuesto de un movimiento casado. `espera`: el motivo por el que la base no lo validaría, o null. */
export function veredictoBanco(m: MovimientoBanco, espera: string | null): VeredictoBanco {
  if (espera) return { tipo: 'revisa', titulo: 'Aún no se puede validar', porque: frase(espera) }
  const c = m.casado
  const porque = c?.porque ? frase(primeraMayuscula(c.porque.replace(/^casado solo\s*[:·]\s*/i, ''))) : ''
  if (c?.porQuien === 'persona') {
    return { tipo: 'lista', titulo: 'Lista para contabilizar', porque: `Lo casaste tú al confirmarlo${porque ? `: ${porque.charAt(0).toLowerCase()}${porque.slice(1)}` : '.'}` }
  }
  if (m.confianza === 'seguro') {
    return { tipo: 'lista', titulo: 'Lista para contabilizar', porque: `Lo casé solo y estoy seguro${porque ? `: ${porque.charAt(0).toLowerCase()}${porque.slice(1)}` : '.'}` }
  }
  return { tipo: 'revisa', titulo: 'Revisa esto', porque: `Lo casé sin estar seguro${porque ? ` (${porque.replace(/\.$/, '')})` : ''}: míralo antes de validar.` }
}

/** Los movimientos de «Por validar» con su veredicto, en el orden de la lista. */
export function conVeredicto(movs: readonly MovimientoBanco[], esperan: ReadonlyMap<string, string>): { m: MovimientoBanco; v: VeredictoBanco }[] {
  return movs.filter(porValidar).map((m) => ({ m, v: veredictoBanco(m, esperan.get(m.casado!.asientoId!) ?? null) }))
}

/** Los que entran en «Validar los N»: solo «Lista para contabilizar». */
export const listosParaValidar = (xs: readonly { m: MovimientoBanco; v: VeredictoBanco }[]): MovimientoBanco[] =>
  xs.filter((x) => x.v.tipo === 'lista').map((x) => x.m)

/** Tras validar uno, a cuál se pasa: el siguiente de la lista; si era el último, el anterior; si no queda ninguno, null. */
export function siguienteTras(ids: readonly string[], hecho: string): string | null {
  const i = ids.indexOf(hecho)
  if (i < 0) return ids[0] ?? null
  return ids[i + 1] ?? ids[i - 1] ?? null
}

/** Lo que dice la pantalla tras validar en bloque (regla 8: con contenido). */
export function textoValidados(numeros: readonly number[], fallos: readonly string[], total: number): { tipo: 'ok' | 'error'; texto: string } {
  const bien = numeros.length
  const n = [...numeros].sort((a, b) => a - b)
  const seguidos = bien > 1 && n[bien - 1] - n[0] === bien - 1
  const cuales = bien === 0 ? '' : bien === 1 ? ` (el asiento ${n[0]})` : seguidos ? ` (asientos ${n[0]} a ${n[bien - 1]})` : ` (asientos ${n.join(', ')})`
  if (fallos.length) return { tipo: 'error', texto: `Validados ${bien} de ${total}${cuales}. No he podido: ${fallos.join(' · ')}` }
  return { tipo: 'ok', texto: bien === 1 ? `Validado el 1${cuales}: ya está en el libro diario.` : `Validados los ${bien}${cuales}: ya están en el libro diario.` }
}
