// src/modules/conta/services/tpvDiaService.ts
//
// R05 · Validar un día del TPV desde Cierres del día (respuesta R05 · 1, §4):
// se propone y se valida al pulsar, en UNA transacción de la base, con su PDF
// «Resumen de ventas» obligatorio, como un cierre de Folvy.
//
//   1. conta_tpv_dia_para_validar: el día, el asiento que saldría (con el nombre
//      de cada cuenta) y el número de asiento que le tocaría. Si no se puede
//      proponer (falta una cuenta, la empresa envía a Diez…), para con su frase.
//   2. El PDF (lib/resumenVentasTpvPdf.ts) con ese número, y subido a
//      cuenta/asiento/huella.pdf: el id del asiento lo pone aquí la pantalla, y
//      la base crea el asiento con él.
//   3. conta_tpv_dia_validar: propone, valida, guarda el PDF y pone el rango del
//      TPV en el libro de IVA. Si entre el 1 y el 3 se ha validado otro asiento de
//      la serie (40001: el número del PDF ya no es el suyo), se vuelve a empezar
//      UNA vez con el número nuevo, como validarConPdf.
//
// Nombres dentro de cadenas (regla 40): conta_tpv_dia_para_validar y
// conta_tpv_dia_validar los crea la 20261117T1602 (R05); el bucket
// conta-documentos, el C05.

import { jsPDF } from 'jspdf'
import { supabase } from '@/lib/supabase'
import { rpc, hayBase } from '@/modules/conta/services/bd'
import { datosResumenTpv, nombreFicheroTpv, resumenVentasTpvPdf, type ParaValidarTpv } from '@/modules/conta/lib/resumenVentasTpvPdf'

const BUCKET = 'conta-documentos'
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const limpio = (e: unknown) => new Error((e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, ''))
const esCarrera = (e: unknown) => /se ha validado otro asiento de la serie a la vez|vuelve a pulsar/i.test(e instanceof Error ? e.message : String(e))

export interface DiaTpvValidado { numero: number; serie: number; texto: string }

async function unaVez(diaId: string, quien: string | null): Promise<DiaTpvValidado> {
  const p = await rpc<ParaValidarTpv>('conta_tpv_dia_para_validar', { p_dia: diaId })
  const numero = Number(p.numero_previsto)
  let bytes: Uint8Array
  try {
    bytes = resumenVentasTpvPdf(jsPDF, datosResumenTpv(p, numero, new Date()))
  } catch (e) {
    throw new Error(`su PDF no se puede hacer (${limpio(e).message.replace(/\.$/, '')})`, { cause: e })
  }
  const entry = crypto.randomUUID()
  const sha = hex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  const ruta = `${p.account_id}/${entry}/${sha.slice(0, 16)}.pdf`
  hayBase()
  const sub = await supabase!.storage.from(BUCKET).upload(ruta, new Blob([bytes as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`no se ha podido subir su PDF (${sub.error.message})`)
  const r = await rpc<Record<string, unknown>>('conta_tpv_dia_validar', {
    p_dia: diaId, p_entry: entry, p_numero: numero, p_ruta: ruta, p_nombre: nombreFicheroTpv(p.dia.dia, numero),
    p_sha256: sha, p_bytes: bytes.length, p_quien_nombre: quien,
  })
  return { numero: Number(r.numero), serie: Number(r.serie), texto: String(r.texto ?? '') }
}

/** Proponer y validar un día del TPV con su PDF. Dice qué ha hecho (regla 8) o por qué no. */
export async function validarDiaTpv(diaId: string, quien: string | null): Promise<DiaTpvValidado> {
  try {
    return await unaVez(diaId, quien)
  } catch (e) {
    if (!esCarrera(e)) throw limpio(e)
    try { return await unaVez(diaId, quien) } catch (e2) { throw limpio(e2) }
  }
}
