// src/modules/printing/services/printerService.ts
//
// Frontera de sesión (admin/manager) sobre las RPC de impresoras que viven en
// producción y quedaron versionadas en F1 (supabase/migrations/…_impresion_
// versionado_f1.sql): list_printers / upsert_printer / delete_printer.
//
// El cliente NO toca la tabla `printer` directamente: todo pasa por RPC
// SECURITY DEFINER con guarda de tenancy (current_user_is_admin_or_manager_of).
// Este servicio es el mismo para la pantalla del ADMIN web (F2) y para la
// pantalla IN-APP en modo Estación (F3): sesión → RLS, sin token.
//
// Patrón calcado de kdsService: rpc() casteado porque estas RPC no están en los
// tipos autogenerados. camelCase en cliente / snake_case en BBDD.

import { supabase, isSupabaseEnabled } from '@/lib/supabase'

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// rpc() casteado: las RPC de impresión no están en los tipos autogenerados.
// Member-access de `supabase!` para no perder el `this` del cliente.
function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  requireSupabase()
  return (
    supabase!.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args).then(({ data, error }) => {
    if (error) throw new Error(`Impresión · ${fn}: ${error.message}`)
    return data as T
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

/** Documentos que puede sacar una impresora (subconjunto de la tabla printer). */
export type DocType = 'bag' | 'kitchen' | 'labels'

export const DOC_TYPES: { code: DocType; label: string }[] = [
  { code: 'bag',     label: 'Bolsa' },
  { code: 'kitchen', label: 'Cocina' },
  { code: 'labels',  label: 'Etiquetas' },
]

/** Transporte soportado hoy (F1 sólo admite escpos_network; el resto es futuro). */
export const TRANSPORT_ESCPOS = 'escpos_network' as const

/** Espejo de una fila de list_printers (que ya aplana config → ip/port). */
export interface Printer {
  id: string
  name: string
  transport: string
  /** IP de la impresora de red (config->>'ip'). null si aún sin configurar. */
  ip: string | null
  /** Puerto TCP (config->>'port'), por defecto 9100. */
  port: number
  docTypes: DocType[]
  /** Nº de copias por documento que saca esta impresora (1-9). */
  copies: number
  isActive: boolean
}

// La RPC list_printers devuelve el objeto ya aplanado.
type PrinterRow = {
  id: string
  name: string
  transport: string
  ip: string | null
  port: number | null
  doc_types: DocType[] | null
  copies: number | null
  is_active: boolean
}

function rowToPrinter(r: PrinterRow): Printer {
  return {
    id: r.id,
    name: r.name,
    transport: r.transport,
    ip: r.ip ?? null,
    port: r.port ?? 9100,
    docTypes: Array.isArray(r.doc_types) ? r.doc_types : [],
    copies: r.copies ?? 1,
    isActive: Boolean(r.is_active),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RPC
// ─────────────────────────────────────────────────────────────────────────────

/** Impresoras de un local (activas e inactivas), ordenadas por nombre. */
export async function listPrinters(locationId: string): Promise<Printer[]> {
  const rows = await rpc<PrinterRow[] | null>('list_printers', { p_location_id: locationId })
  return (rows ?? []).map(rowToPrinter)
}

export interface UpsertPrinterInput {
  /** null = alta; con id = edición. */
  id?: string | null
  accountId: string
  locationId: string
  name: string
  ip: string
  port: number
  docTypes: DocType[]
  copies: number
  isActive: boolean
}

/** Alta o edición de una impresora de red. Devuelve el id resultante. */
export async function upsertPrinter(input: UpsertPrinterInput): Promise<string> {
  return rpc<string>('upsert_printer', {
    p_id:          input.id ?? null,
    p_account_id:  input.accountId,
    p_location_id: input.locationId,
    p_name:        input.name.trim(),
    p_transport:   TRANSPORT_ESCPOS,
    p_config:      { ip: input.ip.trim(), port: input.port },
    p_doc_types:   input.docTypes,
    p_is_active:   input.isActive,
    p_copies:      input.copies,
  })
}

/** Borra una impresora. La RPC bloquea si tiene print_job pendientes. */
export async function deletePrinter(id: string): Promise<void> {
  await rpc<void>('delete_printer', { p_id: id })
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIANTES BY-TOKEN (Estación / tablet sin sesión — F3)
// ---------------------------------------------------------------------------
// Mismo servicio, misma UI: cuando la pantalla corre en la Estación (por token)
// usa estas RPC, que derivan cuenta+local DEL DISPOSITIVO. La tablet sólo puede
// gestionar impresoras de SU local. Puerta anon, igual que availability_*_by_token.
// ─────────────────────────────────────────────────────────────────────────────

/** Impresoras del local del dispositivo (por token). */
export async function listPrintersByToken(token: string): Promise<Printer[]> {
  const rows = await rpc<PrinterRow[] | null>('list_printers_by_token', { p_device_token: token })
  return (rows ?? []).map(rowToPrinter)
}

/** Alta/edición por token (cuenta+local salen del dispositivo). Devuelve el id. */
export async function upsertPrinterByToken(
  token: string,
  input: { id?: string | null; name: string; ip: string; port: number; docTypes: DocType[]; copies: number; isActive: boolean }
): Promise<string> {
  return rpc<string>('upsert_printer_by_token', {
    p_device_token: token,
    p_id:        input.id ?? null,
    p_name:      input.name.trim(),
    p_config:    { ip: input.ip.trim(), port: input.port },
    p_doc_types: input.docTypes,
    p_is_active: input.isActive,
    p_copies:    input.copies,
  })
}

/** Baja por token. Bloquea si hay print_job pendientes. */
export async function deletePrinterByToken(token: string, id: string): Promise<void> {
  await rpc<void>('delete_printer_by_token', { p_device_token: token, p_id: id })
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPRIMIR PRUEBA (F4) — encolado DIRIGIDO a una impresora concreta
// El payload PRUEBA lo construye el servidor. Devuelve el id del print_job.
// Lo imprimirá el worker de la Estación cuando reclame la cola (tablet encendida).
// ─────────────────────────────────────────────────────────────────────────────

/** Encola una prueba a una impresora (modo admin/sesión). */
export async function printTest(printerId: string): Promise<string> {
  return rpc<string>('enqueue_test_print', { p_printer_id: printerId })
}

/** Encola una prueba a una impresora del local del dispositivo (modo estación). */
export async function printTestByToken(token: string, printerId: string): Promise<string> {
  return rpc<string>('enqueue_test_print_by_token', { p_device_token: token, p_printer_id: printerId })
}

/** Encola un trabajo de impresión a las impresoras del local que saquen ese
 *  doc_type. Reservado para reimpresiones/prueba de fan-out (no usado aún en F2). */
export async function enqueuePrintJob(input: {
  accountId: string
  locationId: string
  saleId: string | null
  docType: DocType
  payload: unknown
  source?: 'manual' | 'reprint'
}): Promise<number> {
  return rpc<number>('enqueue_print_job', {
    p_account_id:  input.accountId,
    p_location_id: input.locationId,
    p_sale_id:     input.saleId,
    p_doc_type:    input.docType,
    p_payload:     input.payload,
    p_source:      input.source ?? 'manual',
  })
}
