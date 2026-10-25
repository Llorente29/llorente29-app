// src/modules/conta/lib/validarConPdf.ts
//
// C06b · Respuesta 8 de Julio, pregunta 1: «validar y generar el PDF van
// juntos; si falla el PDF, el asiento no se valida y se dice por qué».
//
// Un asiento de ventas de una plataforma se valida así (la base, 0720):
//   1. el número que le tocaría (conta_numero_previsto);
//   2. su «Resumen de ventas» con ese número, hecho aquí, y subido;
//   3. validar y guardar el PDF en UNA transacción
//      (journal_entry_validar_con_documento).
// Si el PDF no se puede hacer, no se llega al paso 3: no se valida. Si otro
// asiento de la serie se valida entre el 1 y el 3, la base no valida (el PDF
// diría otro número) y se vuelve a empezar UNA vez con el número nuevo.
//
// Núcleo sin red: todo lo de fuera entra por el puerto (conDiezService pone
// Supabase y jsPDF; las pruebas, dobles).

import type { ResumenBD } from '../../../../supabase/functions/_shared/resumenDeAsiento.ts'

export interface PuertoValidarConPdf {
  resumen(entryId: string): Promise<ResumenBD>
  numeroPrevisto(entryId: string): Promise<number>
  /**
   * V01 · Entrega 2: la factura resumen que le tocaría (la de la serie del
   * canal), para un cierre del día. Sin ella, el PDF lleva el número de antes.
   */
  facturaPrevista?(entryId: string): Promise<string>
  /** El PDF del asiento como quedará validado con ese número (y esa factura). Lanza si no se puede hacer. */
  hacerPdf(r: ResumenBD, factura?: string | null): Promise<{ bytes: Uint8Array; nombre: string }>
  /** Lo sube a su sitio (cuenta/asiento/huella.pdf) y devuelve la ruta y la huella. */
  subir(r: ResumenBD, pdf: Uint8Array): Promise<{ ruta: string; sha256: string }>
  /** Valida y guarda el PDF en una transacción. Lanza si no (y entonces no se ha validado). */
  validarConDocumento(a: { entryId: string; numero: number; factura?: string | null; ruta: string; nombre: string; sha256: string; bytes: number; quien: string | null }): Promise<{ serie: number; numero: number; factura?: string | null }>
  /** Solo para lo validado antes de la 0720 sin su PDF: guardarlo ahora. */
  guardarDocumento(entryId: string, quien: string | null): Promise<unknown>
}

export type ValidadoConPdf = { serie: number; numero: number; yaEstaba: boolean; factura?: string | null }

/** La base no ha validado porque el número ha cambiado entre medias: se puede volver a intentar. */
export const esNumeroCambiado = (m: string) => /se ha validado otro asiento de la serie a la vez/.test(m)

/** Lo que dice la pantalla cuando no se valida. */
export const noSeValida = (motivo: string) => `No se ha validado: ${motivo.replace(/\.$/, '')}. Validar y guardar su PDF van juntos: sin su PDF, el asiento sigue sin validar.`

export async function validarConPdf(entryId: string, quien: string | null, p: PuertoValidarConPdf): Promise<ValidadoConPdf> {
  const r0 = await p.resumen(entryId)
  if (r0.estado === 'validado') {
    if (!r0.documento) await p.guardarDocumento(entryId, quien)
    return { serie: r0.serie, numero: Number(r0.numero), yaEstaba: true }
  }
  for (let intento = 1; ; intento++) {
    const numero = await p.numeroPrevisto(entryId)
    const factura = p.facturaPrevista ? await p.facturaPrevista(entryId) : null
    // El resumen como quedará: validado y con su número. Si no se puede hacer, se para aquí.
    const r: ResumenBD = { ...r0, estado: 'validado', numero }
    const pdf = await p.hacerPdf(r, factura)
    const sub = await p.subir(r, pdf.bytes)
    try {
      const v = await p.validarConDocumento({ entryId, numero, factura, ruta: sub.ruta, nombre: pdf.nombre, sha256: sub.sha256, bytes: pdf.bytes.length, quien })
      return { ...v, yaEstaba: false }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      if (intento < 2 && esNumeroCambiado(m)) continue
      throw e
    }
  }
}
