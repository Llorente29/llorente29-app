// C06b · Respuesta 8, tarea 1b · «Validar y enviar a Diez» con varios a la vez.
//
// Con la empresa autorizada en C0008 desde el 01/10, el diálogo del Libro
// ofrece de golpe todo lo propuesto del mes (56 asientos el 15/10). Validar no
// se deshace: cada asiento toma su número y su PDF. Por eso:
//   · van por FECHA, para que los números sigan el calendario;
//   · si uno no se puede validar (no cuadra, falta el NIF…), se dice y se sigue:
//     es cosa de ese asiento y no ha salido nada;
//   · si uno se valida y NO llega a Diez, se PARA: lo que falla en Diez (cerrado,
//     sin conexión, Diez caído) suele fallar igual en el siguiente, y seguir
//     dejaría decenas de asientos validados y fuera de Diez. Los siguientes se
//     quedan como estaban, y la pantalla lo dice.
// Lo que está validado y no llegó (de una vez anterior) no se vuelve a validar:
// solo se envía.
import { noSeValida } from './validarConPdf'
import type { PasoEnvio } from './conDiez'

/** `fecha` ordena el lote; uno solo (el botón del asiento) no la necesita. */
export interface AsientoParaEnviar { id: string; concepto: string; fecha?: string; estado: string }
export interface ResultadoEnvioVarios { estado: string; texto: string; pdfPendiente?: boolean }
export interface PuertoEnviarVarios {
  /** Validar con su PDF, en una sola transacción (respuesta 8). Lanza con el motivo si no se valida. */
  validarConDocumento(id: string, quien: string | null): Promise<unknown>
  /** El PDF de lo validado antes de que fueran juntos. */
  guardarDocumento(id: string, quien: string | null): Promise<unknown>
  /** El envío por la función; nunca lanza: dice qué ha pasado. */
  enviarADiez(id: string): Promise<ResultadoEnvioVarios>
}

/** El paso de un asiento, y si se ha quedado sin tocar porque se paró antes. */
export type PasoVarios = PasoEnvio & { sinTocar?: boolean }

export const ordenEnvio = <T extends { fecha?: string; concepto: string }>(xs: readonly T[]): T[] =>
  [...xs].sort((a, b) => (a.fecha ?? '').localeCompare(b.fecha ?? '') || a.concepto.localeCompare(b.concepto))

export async function validarYEnviarVarios(xs: readonly AsientoParaEnviar[], quien: string | null, p: PuertoEnviarVarios, alPaso?: (i: number) => void): Promise<PasoVarios[]> {
  const orden = ordenEnvio(xs)
  const pasos: PasoVarios[] = []
  for (const [i, a] of orden.entries()) {
    alPaso?.(i)
    const paso: PasoVarios = { concepto: a.concepto, validado: a.estado === 'validado', documento: false, enDiez: false, texto: '' }
    try {
      if (!paso.validado) { await p.validarConDocumento(a.id, quien); paso.validado = true } else await p.guardarDocumento(a.id, quien)
      paso.documento = true
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      paso.texto = !paso.validado ? noSeValida(m) : `Validado, pero no ha llegado a Diez: falta el documento (${m}).`
      pasos.push(paso)
      // Sin validar, no ha salido nada: es cosa de este asiento y se sigue.
      if (!paso.validado) continue
      break
    }
    const r = await p.enviarADiez(a.id)
    paso.enDiez = r.estado === 'en_diez'
    paso.pdfPendiente = paso.enDiez && r.pdfPendiente === true
    paso.texto = r.texto
    pasos.push(paso)
    if (!paso.enDiez) break
  }
  // Lo que queda, sin tocar: como estaba antes de pulsar.
  for (const a of orden.slice(pasos.length)) {
    pasos.push({ concepto: a.concepto, validado: a.estado === 'validado', documento: false, enDiez: false, sinTocar: true,
      texto: a.estado === 'validado' ? 'Sin tocar: sigue validado y sin enviar.' : 'Sin tocar: sigue propuesto.' })
  }
  return pasos
}

/** El resultado, con contenido (regla 8): cuántos en Diez, dónde y por qué paró, y cuántos sin tocar. */
export function textoVarios(pasos: readonly PasoVarios[]): string {
  const tocados = pasos.filter((p) => !p.sinTocar)
  const en = tocados.filter((p) => p.enDiez).length
  const pend = tocados.filter((p) => p.enDiez && p.pdfPendiente).length
  const sinValidar = tocados.filter((p) => !p.validado).length
  const sinTocar = pasos.length - tocados.length
  const partes = [en ? `${en} de ${pasos.length} en Diez${pend ? ` (${pend} con el PDF pendiente de adjuntar allí)` : ''}` : `ninguno de ${pasos.length} en Diez`]
  if (sinValidar) partes.push(`${sinValidar} sin validar (debajo, por qué)`)
  const paro = tocados.find((p) => p.validado && !p.enDiez)
  if (paro) partes.push(`parado en «${paro.concepto}», que se ha validado y no ha llegado a Diez`)
  if (sinTocar) partes.push(`${sinTocar} sin tocar: siguen como estaban`)
  return `${partes.join(' · ')}.`
}
