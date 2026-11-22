// src/modules/conta/services/asientoGeneralService.ts
//
// K12 · Lo que lee y guarda el asiento general (maqueta nucleo_19, como ERP10). Todo por cuenta y empresa (regla 9).
// Nombres de la base entre comillas (regla 40), comprobados contra el esquema el 22/11: journal_entry (notes,
// party_id, document_ref, document_date), journal_line (brand_id, channel_id), journal_ledger, conta_user_pref
// (reparto_documento), party, sales_channel, brand, journal_entry_document; y las funciones journal_entry_validar,
// conta_asiento_se_puede_modificar, conta_asiento_modificar y conta_documento_justificante_guardar.
//
//   · Uno nuevo se graba como hasta hoy (las filas y journal_entry_validar), con lo que la pantalla añade: las
//     observaciones, «Otros datos» (tercero, documento y fecha del documento) y la marca y la plataforma de cada línea.
//   · Uno validado a mano se cambia con conta_asiento_modificar, en el mismo asiento y con el mismo número.
//   · El justificante, como la expedida: se sube a conta-documentos y se enlaza (conta_documento_justificante_guardar).
//   · El ancho del documento de cada persona, en la base (conta_user_pref.reparto_documento).

import { tabla, rpc, mensaje } from '@/modules/conta/services/bd'
import { supabase } from '@/lib/supabase'
import { ficheroAPdf } from '@/modules/conta/services/documentosService'
import { MAX_BYTES_EXPEDIDA, nombreExpedida, rutaExpedida, tamano } from '@/modules/conta/lib/expedidaPdf'
import { repartoGuardado } from '@/modules/conta/nucleo/piezas/logica'

type Fila = Record<string, unknown>
const s = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null)
const DOCUMENTOS = 'conta-documentos'
/** El motivo de la base sin el nombre de la función delante («journal_entry_validar: No cuadra…» → «No cuadra…»). */
const sinPrefijo = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^[a-z_]+: /, '')

/** La serie del asiento a mano (la de siempre de «Asiento general»; Julio, 22/11: fija, sin casilla). */
export const SERIE_ASIENTO_GENERAL = 4

export interface Opcion { id: string; codigo: string; descripcion: string; comercial?: string | null; nif?: string | null }

/** Las plataformas (canales de venta) de la cuenta. */
export async function plataformasDeLaCuenta(accountId: string): Promise<Opcion[]> {
  const { data, error } = await tabla('sales_channel').select('id, name, slug').eq('account_id', accountId).order('name')
  if (error) throw new Error(mensaje('No se han podido leer las plataformas', error))
  return ((data ?? []) as Fila[]).map((f) => ({ id: String(f.id), codigo: String(f.slug ?? f.name), descripcion: String(f.name) }))
}

/** Las marcas de la cuenta que se pueden poner. */
export async function marcasDeLaCuenta(accountId: string): Promise<Opcion[]> {
  const { data, error } = await tabla('brand').select('id, name, is_active, archived_at').eq('account_id', accountId).order('name')
  if (error) throw new Error(mensaje('No se han podido leer las marcas', error))
  return ((data ?? []) as Fila[]).filter((b) => b.is_active !== false && !b.archived_at)
    .map((b, i) => ({ id: String(b.id), codigo: String(i + 1), descripcion: String(b.name) }))
}

/** Los terceros (clientes, proveedores y acreedores) de la cuenta, para «Otros datos». */
export async function tercerosDeLaCuenta(accountId: string): Promise<Opcion[]> {
  const { data, error } = await tabla('party').select('id, name, tax_id, archived_at').eq('account_id', accountId).is('archived_at', null).order('name').limit(5000)
  if (error) throw new Error(mensaje('No se han podido leer los terceros', error))
  return ((data ?? []) as Fila[]).map((f) => ({ id: String(f.id), codigo: String(f.tax_id ?? ''), descripcion: String(f.name), nif: s(f.tax_id) }))
}

/** El saldo de una cuenta a una fecha (debe − haber de lo validado y los borradores, como el mayor de la ficha). */
export async function saldoALaFecha(accountId: string, companyId: string, cuentaId: string, fecha: string): Promise<number> {
  const { data, error } = await tabla('journal_ledger').select('debit, credit')
    .eq('account_id', accountId).eq('company_id', companyId).eq('company_account_id', cuentaId)
    .in('status', ['borrador', 'validado']).lte('entry_date', fecha).limit(20000)
  if (error) throw new Error(mensaje('No se ha podido leer el saldo de la cuenta', error))
  const c = ((data ?? []) as Fila[]).reduce((t, l) => t + Math.round(Number(l.debit ?? 0) * 100) - Math.round(Number(l.credit ?? 0) * 100), 0)
  return c / 100
}

export interface LineaGeneral {
  cuentaId: string; codigo: string; concepto: string; debe: number; haber: number
  /** El local: su id, 'comun' o null. */
  local: string | null; marca: string | null; plataforma: string | null
}
export interface CabeceraGeneral { fecha: string; concepto: string; notas: string; tercero: string | null; documento: string; fechaDocumento: string | null }

export interface AsientoGeneral {
  id: string; estado: string; origen: string; serie: number; numero: number | null; ejercicioId: string
  cabecera: CabeceraGeneral; lineas: LineaGeneral[]
}

/** Un asiento con todo lo que la pantalla enseña (las observaciones, «Otros datos», y local, marca y plataforma de cada línea). */
export async function leerAsientoGeneral(accountId: string, companyId: string, entryId: string): Promise<AsientoGeneral | null> {
  const { data, error } = await tabla('journal_entry')
    .select('id, status, source_type, series, number, fiscal_year_id, entry_date, concept, notes, party_id, document_ref, document_date, journal_line(position, company_account_id, debit, credit, concept, location_id, is_common, brand_id, channel_id, company_account(code))')
    .eq('account_id', accountId).eq('company_id', companyId).eq('id', entryId).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer el asiento', error))
  const e = data as Fila | null
  if (!e) return null
  const lineas = ((e.journal_line ?? []) as Fila[]).sort((a, b) => Number(a.position) - Number(b.position)).map((l) => ({
    cuentaId: String(l.company_account_id), codigo: String(((l.company_account ?? {}) as Fila).code ?? ''), concepto: String(l.concept ?? ''),
    debe: Number(l.debit ?? 0), haber: Number(l.credit ?? 0),
    local: l.is_common === true ? 'comun' : s(l.location_id), marca: s(l.brand_id), plataforma: s(l.channel_id),
  }))
  return {
    id: String(e.id), estado: String(e.status), origen: String(e.source_type), serie: Number(e.series), numero: e.number == null ? null : Number(e.number),
    ejercicioId: String(e.fiscal_year_id),
    cabecera: { fecha: String(e.entry_date), concepto: String(e.concept ?? ''), notas: String(e.notes ?? ''), tercero: s(e.party_id), documento: String(e.document_ref ?? ''), fechaDocumento: s(e.document_date) },
    lineas,
  }
}

/** Las filas de las líneas como las guarda la base (las mismas columnas que el asiento a mano de hoy, más marca y plataforma). */
const filasDeLineas = (accountId: string, companyId: string, entryId: string, lineas: readonly LineaGeneral[]) => lineas.map((l, i) => ({
  account_id: accountId, company_id: companyId, entry_id: entryId, position: i + 1, company_account_id: l.cuentaId,
  debit: l.debe, credit: l.haber, concept: l.concepto.trim() || null,
  location_id: l.local && l.local !== 'comun' ? l.local : null, is_common: l.local === 'comun',
  brand_id: l.marca, channel_id: l.plataforma,
}))

/**
 * Uno nuevo: el asiento y sus líneas (como el de hoy, guardarAMano), y se valida (journal_entry_validar). Si no se
 * valida, se queda en borrador y se dice por qué.
 */
export async function grabarNuevo(accountId: string, companyId: string, ejercicioId: string, c: CabeceraGeneral, lineas: readonly LineaGeneral[], quien: string | null):
  Promise<{ id: string; validado: boolean; serie: number; numero: number | null; porque: string | null }> {
  const { data, error } = await tabla('journal_entry').insert({
    account_id: accountId, company_id: companyId, fiscal_year_id: ejercicioId, series: SERIE_ASIENTO_GENERAL, entry_date: c.fecha, concept: c.concepto.trim(),
    source_type: 'manual', status: 'borrador', created_by_name: quien,
    notes: c.notas.trim() || null, party_id: c.tercero, document_ref: c.documento.trim() || null, document_date: c.fechaDocumento,
  }).select('id').single()
  if (error) throw new Error(mensaje('No se ha guardado el asiento', error))
  const id = String((data as Fila).id)
  const r = await tabla('journal_line').insert(filasDeLineas(accountId, companyId, id, lineas))
  if (r.error) {
    await tabla('journal_entry').delete().eq('id', id)
    throw new Error(mensaje('No se ha guardado el asiento', r.error))
  }
  try {
    const v = (await rpc('journal_entry_validar', { p_entry: id, p_quien_nombre: quien })) as Fila
    return { id, validado: true, serie: Number(v.serie), numero: Number(v.numero), porque: null }
  } catch (e) {
    return { id, validado: false, serie: SERIE_ASIENTO_GENERAL, numero: null, porque: sinPrefijo(e) || 'no ha contestado' }
  }
}

/** Si un asiento validado se puede cambiar aquí y, si no, por qué (conta_asiento_se_puede_modificar). */
export async function sePuedeCambiar(entryId: string): Promise<{ puede: boolean; porque: string | null }> {
  const r = (await rpc('conta_asiento_se_puede_modificar', { p_entry: entryId })) as Fila
  return { puede: r.puede === true, porque: s(r.porque) }
}

/** Cambiar uno validado a mano: en el mismo asiento, con el mismo número (conta_asiento_modificar). Devuelve su frase. */
export async function cambiarValidado(entryId: string, c: CabeceraGeneral, lineas: readonly LineaGeneral[], quien: string | null): Promise<{ texto: string; cambiado: boolean }> {
  const r = (await rpc('conta_asiento_modificar', {
    p_entry: entryId,
    p_cabecera: { fecha: c.fecha, concepto: c.concepto, notas: c.notas, tercero: c.tercero ?? '', documento: c.documento, fecha_documento: c.fechaDocumento ?? '' },
    p_lineas: lineas.map((l) => ({ cuenta: l.codigo, concepto: l.concepto, debe: l.debe || null, haber: l.haber || null, local: l.local ?? '', marca: l.marca ?? '', plataforma: l.plataforma ?? '' })),
    p_quien_nombre: quien,
  }).catch((e: unknown) => { throw new Error(sinPrefijo(e)) })) as Fila
  return { texto: String(r.texto ?? 'Cambiado.'), cambiado: Number(r.apuntes ?? 0) > 0 }
}

/** El justificante de un asiento a mano validado: se sube como PDF (una foto se convierte) y se enlaza. */
export async function guardarJustificante(accountId: string, entryId: string, fichero: File, quien: string | null): Promise<{ nombre: string; yaEstaba: boolean }> {
  if (!supabase) throw new Error('Sin conexión con la base')
  const pdf = await ficheroAPdf(fichero)
  if (pdf.length > MAX_BYTES_EXPEDIDA) throw new Error(`el PDF pesa ${tamano(pdf.length)} y caben ${tamano(MAX_BYTES_EXPEDIDA)}`)
  const huella = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pdf.slice().buffer))).map((b) => b.toString(16).padStart(2, '0')).join('')
  const destino = rutaExpedida(accountId, entryId, huella)
  const sub = await supabase.storage.from(DOCUMENTOS).upload(destino, new Blob([pdf as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false })
  if (sub.error && !/exists|duplicate/i.test(sub.error.message)) throw new Error(`no se ha podido subir el PDF (${sub.error.message})`)
  const r = (await rpc('conta_documento_justificante_guardar', {
    p_entry: entryId, p_ruta: destino, p_nombre: nombreExpedida(fichero.name), p_sha256: huella, p_bytes: pdf.length, p_quien_nombre: quien,
  }).catch((e: unknown) => { throw new Error(sinPrefijo(e)) })) as Fila
  return { nombre: String(r.nombre ?? nombreExpedida(fichero.name)), yaEstaba: r.ya_estaba === true }
}

// ── El ancho del documento de cada persona, en la base ──────────────────────────────────────────────────────────
/** Lo que dejó esta persona (0–1; 1 = la pantalla plegada), o null (la de siempre). Si no se puede leer, null: no falla nada. */
export async function leerRepartoDocumento(accountId: string, userId: string): Promise<number | null> {
  const { data, error } = await tabla('conta_user_pref').select('reparto_documento').eq('account_id', accountId).eq('user_id', userId).maybeSingle()
  if (error) return null
  return repartoGuardado((data as Fila | null)?.reparto_documento)
}

export async function guardarRepartoDocumento(accountId: string, userId: string, parte: number): Promise<void> {
  const x = Math.round(Math.min(1, Math.max(0.0001, parte)) * 10000) / 10000
  const { error } = await tabla('conta_user_pref').upsert({ account_id: accountId, user_id: userId, reparto_documento: x }, { onConflict: 'account_id,user_id' })
  if (error) throw new Error(mensaje('No se ha podido guardar el ancho del documento', error))
}
