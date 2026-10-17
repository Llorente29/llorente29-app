// src/modules/conta/lib/esperan.ts
//
// M01 · «Esperan» (Julio, 16/10). Lo que el usuario todavía no puede hacer no
// cuenta como tarea en «Te toca hoy»: va a una vista «Esperan», cada asiento
// con su motivo en palabras de oficina.
//
// Dos clases de espera, y ninguna se decide aquí con una regla propia:
//   · lo que la validación pararía: lo dice la base (conta_esperan, que lee
//     conta_motivos_para_validar, la misma función con la que para
//     journal_entry_validar). Aquí solo se separa;
//   · lo validado que no llega a Diez (decisión 2 de Julio, cada motivo con su
//     texto): le falta su documento → tarea, «Adjuntar»; el envío falló →
//     tarea, «Reintentar», con el error en palabras de oficina; la plataforma
//     no tiene su factura medida → espera; el local no tiene su grupo en Diez
//     → espera. Los dos últimos salen de lo mismo que usa el envío
//     (supabase/functions/_shared: PATRONES y la correspondencia), no de una
//     copia.

import { estadoDiez, motivoSinPatron, type ConDiez } from '@/modules/conta/lib/conDiez'

/** Un motivo de espera de la base (conta_esperan): su código y su texto. */
export interface MotivoEspera { codigo: string; motivo: string }

/** Lo que pasa con un asiento validado que no está en Diez. */
export type NoLlegaADiez =
  | { tipo: 'tarea'; accion: 'adjuntar' | 'reintentar'; texto: string }
  | { tipo: 'espera'; codigo: 'sin_factura_medida' | 'local_sin_grupo'; motivo: string }

/**
 * Un error del envío, dicho para una oficina: lo que dice el envío ya va en
 * palabras (lo escribe _shared/diezFactura.ts); lo técnico (la red, un código
 * HTTP, Diez sin contestar) se traduce.
 */
export function errorEnPalabras(error: string): string {
  const e = error.trim().replace(/\.$/, '')
  // Los textos técnicos que puede dar el envío (diezCliente.ts y conDiezService.enviarADiez).
  if (/(Conexión con Diez caída|fetch|network|ECONN|ETIMEDOUT|timeout|Edge Function)/i.test(e)) return 'Diez no contestó (la conexión falló o tardó demasiado)'
  if (/(→|contestado)\s*5\d\d\b/.test(e)) return 'Diez estaba caído cuando se envió'
  if (/no deja entrar|(→|contestado)\s*40[13]\b/i.test(e)) return 'Diez no dejó entrar con los datos de acceso de la empresa'
  // Va detrás de «El envío falló:»: la primera letra, en minúscula, salvo que sea una sigla («IVA»).
  // Los nombres propios («Diez», las plataformas) se quedan como están.
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(e) && !/^(Diez|Glovo|Uber|Just Eat)\b/.test(e) ? e.charAt(0).toLowerCase() + e.slice(1) : e
}

/**
 * ¿Por qué no está en Diez este asiento validado? null si está (o si no es
 * un validado). `grupoDe(local)` es el grupo de Diez de ese local, de la
 * correspondencia con la que se envía; undefined si no tiene.
 */
export function porQueNoLlegaADiez(a: { estado: string }, d: ConDiez, local: string | null, grupoDe: (local: string) => string | undefined): NoLlegaADiez | null {
  if (a.estado !== 'validado') return null
  const e = estadoDiez(a, d)
  if (e.enDiez) return null
  const sinPatron = motivoSinPatron(d.canal)
  if (sinPatron) {
    return { tipo: 'espera', codigo: 'sin_factura_medida', motivo: `No va a Diez hasta que ${d.nombreCanal} tenga su factura medida: ${sinPatron}.` }
  }
  if (local && !grupoDe(local)) {
    return { tipo: 'espera', codigo: 'local_sin_grupo', motivo: `El local «${local}» no tiene su grupo en Diez: sin él no se puede numerar la factura.` }
  }
  if (!d.documento) {
    return { tipo: 'tarea', accion: 'adjuntar', texto: `Le falta su documento, el «Resumen de ventas» de ${d.nombreCanal}: sin él no se envía.` }
  }
  const error = d.envio?.error
  if (error && error !== 'enviando') return { tipo: 'tarea', accion: 'reintentar', texto: `El envío falló: ${errorEnPalabras(error)}.` }
  if (error === 'enviando') return { tipo: 'tarea', accion: 'reintentar', texto: 'El envío se cortó a medias: al reintentar, primero se busca en Diez y no se manda otro.' }
  return { tipo: 'tarea', accion: 'reintentar', texto: 'Aún no se ha enviado.' }
}

/** El local de un asiento de ventas: el de sus apuntes, si es uno solo. */
export function localDelAsiento(apuntes: readonly { local: string | null; comun: boolean }[]): string | null {
  const locales = [...new Set(apuntes.filter((l) => !l.comun && l.local).map((l) => l.local!))]
  return locales.length === 1 ? locales[0] : null
}

/** El primer motivo de cada asiento que espera, en su orden (el que dice la validación). */
export function primerMotivo(motivos: readonly MotivoEspera[] | undefined): string | null {
  return motivos && motivos.length ? motivos[0].motivo : null
}
