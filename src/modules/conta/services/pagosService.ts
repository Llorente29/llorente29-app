// src/modules/conta/services/pagosService.ts
//
// PC01 · Entrega 2 · Compras › Pagos: lo que se lee y se escribe, todo por las
// funciones conta_* de la 0915 (dueño único, N8). Cada escritura devuelve la
// frase de lo que ha pasado (regla 8), escrita en la base.

import { rpc, tabla } from '@/modules/conta/services/bd'
import { filaPago, type EstadoRemesa, type FilaPago } from '@/modules/conta/lib/pagos'
import type { DatosRemesaSepa } from '@/modules/conta/lib/sepa'

type Fila = Record<string, unknown>
const num = (x: unknown) => (x === null || x === undefined || x === '' ? 0 : Number(x))
const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))

export interface DatosPagos { filas: FilaPago[]; pagadoMes: number; pagadasMes: number; sinPlazo: { id: string; nombre: string }[] }

export async function leerPagos(companyId: string, mes: string): Promise<DatosPagos> {
  const d = await rpc<Fila>('conta_pagos_lista', { p_company: companyId, p_mes: mes })
  return {
    filas: ((d?.filas as Fila[] | null) ?? []).map(filaPago),
    pagadoMes: num(d?.pagado_mes), pagadasMes: num(d?.pagadas_mes),
    sinPlazo: ((d?.sin_plazo as Fila[] | null) ?? []).map((s) => ({ id: String(s.id), nombre: String(s.nombre) })),
  }
}

interface Frase { frase: string }

export const crearRemesa = (companyId: string, bancoId: string, fecha: string, facturas: readonly { id: string; importe?: number }[]) =>
  rpc<Frase & { remesa: string; codigo: string; por_confirmar: number }>('conta_remesa_pagos_crear', { p_company: companyId, p_treasury: bancoId, p_fecha: fecha, p_facturas: facturas })

export const pagoAMano = (companyId: string, facturaId: string, bancoId: string, fecha: string, importe: number) =>
  rpc<Frase & { remesa: string; codigo: string }>('conta_pago_a_mano', { p_company: companyId, p_invoice: facturaId, p_treasury: bancoId, p_fecha: fecha, p_importe: importe })

export const confirmarIban = (lineaId: string) => rpc<Frase>('conta_remesa_iban_confirmar', { p_linea: lineaId })
export const sacarDeRemesa = (lineaId: string) => rpc<Frase>('conta_remesa_linea_sacar', { p_linea: lineaId })
export const pagoRechazado = (lineaId: string, motivo: string) => rpc<Frase>('conta_remesa_linea_rechazada', { p_linea: lineaId, p_motivo: motivo })
export const ficheroDescargado = (remesaId: string, sha256: string, pagos: number) =>
  rpc<Frase>('conta_remesa_descargada', { p_remesa: remesaId, p_sha256: sha256, p_pagos: pagos })
export const casarRemesa = (movimientoId: string, remesaId: string, lineas: string[] | null) =>
  rpc<Frase & { casado: string; pagos: number; pagadas: number; validado_solo: boolean }>('conta_remesa_casar', { p_movement: movimientoId, p_remesa: remesaId, p_lineas: lineas })
/** PC01 · E2b · «Poner IBAN» desde la barra: lo comprueba la base (módulo 97, que no sea nuestro) y apunta quién y cuándo. */
export const ponerIban = (proveedorId: string, iban: string) =>
  rpc<Frase & { iban4: string }>('conta_proveedor_iban_poner', { p_supplier: proveedorId, p_iban: iban })
export const ponerVencimiento = (companyId: string, plazos: readonly { proveedor: string; dias: number }[]) =>
  rpc<Frase & { facturas: number; quedan: number }>('conta_recibidas_poner_vencimiento', { p_company: companyId, p_plazos: plazos })

/** Los datos del fichero para el banco (lib/sepa.ts). */
export async function datosFichero(remesaId: string): Promise<DatosRemesaSepa> {
  const d = await rpc<Fila>('conta_remesa_fichero_datos', { p_remesa: remesaId })
  const o = d.ordenante as Fila
  return {
    codigo: String(d.codigo), fechaPago: String(d.fecha_pago), creado: new Date().toISOString(),
    ordenante: { nombre: String(o.nombre ?? ''), nif: str(o.nif), iban: String(o.iban ?? ''), bic: str(o.bic) },
    // Respuesta 7 · El sufijo del banco, de Ajustes › Bancos y cajas (sin poner, «000»).
    sufijo: str(o.sufijo) ?? '000',
    pagos: ((d.pagos as Fila[] | null) ?? []).map((p) => ({
      id: String(p.id), importe: num(p.importe), iban: String(p.iban), bic: str(p.bic), nombre: String(p.nombre ?? ''), factura: str(p.factura), fechaFactura: str(p.fecha_factura),
    })),
  }
}

export interface PagoRemesa {
  id: string; facturaId: string; numero: string | null; vence: string | null; importe: number; proveedor: string
  iban4: string | null; ibanPais: string | null; ibanEstado: 'comprobado' | 'primer_pago' | 'cambiado' | 'sin_fichero'; ibanNota: string | null
  confirmadoPor: string | null; confirmadoAt: string | null; estado: 'pendiente' | 'por_confirmar' | 'pagada' | 'rechazada' | 'sacada'; motivo: string | null; cuenta: string | null
}
/**
 * B01 · 2c-2 · Las remesas que son un pago mandado por la API del banco (tipo «banco», la 1614):
 * sin fichero SEPA. Las funciones de las remesas dicen solo si son «a mano», así que el tipo se lee
 * de la tabla (con su RLS de lectura). Antes de la 1614 en un entorno, ninguna lo es.
 */
async function porBancoDe(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { data, error } = await tabla('conta_pago_remesa').select('id, kind').in('id', ids)
  if (error) throw new Error(`No se ha podido leer de qué tipo son las remesas: ${error.message}`)
  return new Set(((data ?? []) as unknown as { id: string; kind: string }[]).filter((r) => r.kind === 'banco').map((r) => r.id))
}

export interface Remesa {
  id: string; codigo: string; aMano: boolean
  /** B01 · 2c-2 · Un pago mandado por la API del banco (Revolut): sin fichero. */
  porBanco: boolean; fechaPago: string; estado: EstadoRemesa; total: number; porCargar: number
  vivas: number; pagadas: number; porConfirmar: number; rechazadas: number
  ficheroAt: string | null; ficheroPor: string | null; creada: string; creadaPor: string | null
  /** Respuesta 7 · El asiento del cargo se validó solo (el cargo cuadra con la remesa). */
  validadoSolo: boolean
  banco: { id: string; nombre: string; iban4: string | null; cuenta: string | null }
  pagos: PagoRemesa[]
  historial: { at: string; por: string | null; texto: string }[]
}

export async function leerRemesa(remesaId: string): Promise<Remesa> {
  const d = await rpc<Fila>('conta_remesa_ficha', { p_remesa: remesaId })
  if (!d) throw new Error('Esa remesa no existe o no es de tu cuenta.')
  const b = d.banco as Fila
  const porBanco = (await porBancoDe([String(d.id)])).has(String(d.id))
  return {
    id: String(d.id), codigo: String(d.codigo), aMano: d.a_mano === true, porBanco, fechaPago: String(d.fecha_pago), estado: String(d.estado) as EstadoRemesa,
    total: num(d.total), porCargar: num(d.por_cargar), vivas: num(d.vivas), pagadas: num(d.pagadas), porConfirmar: num(d.por_confirmar), rechazadas: num(d.rechazadas),
    ficheroAt: str(d.fichero_at), ficheroPor: str(d.fichero_por), creada: String(d.creada), creadaPor: str(d.creada_por), validadoSolo: d.validado_solo === true,
    banco: { id: String(b.id), nombre: String(b.nombre), iban4: str(b.iban4), cuenta: str(b.cuenta) },
    pagos: ((d.pagos as Fila[] | null) ?? []).map((p) => ({
      id: String(p.id), facturaId: String(p.factura_id), numero: str(p.numero), vence: str(p.vence), importe: num(p.importe), proveedor: String(p.proveedor ?? '—'),
      iban4: str(p.iban4), ibanPais: str(p.iban_pais), ibanEstado: String(p.iban_estado) as PagoRemesa['ibanEstado'], ibanNota: str(p.iban_nota),
      confirmadoPor: str(p.confirmado_por), confirmadoAt: str(p.confirmado_at), estado: String(p.estado) as PagoRemesa['estado'], motivo: str(p.motivo), cuenta: str(p.cuenta),
    })),
    historial: ((d.historial as Fila[] | null) ?? []).map((h) => ({ at: String(h.at), por: str(h.por), texto: String(h.texto) })),
  }
}

export interface RemesaResumen { id: string; codigo: string; aMano: boolean; porBanco: boolean; fechaPago: string; estado: EstadoRemesa; total: number; vivas: number; pagadas: number; porConfirmar: number; banco: string }
export async function leerRemesas(companyId: string): Promise<RemesaResumen[]> {
  const d = await rpc<Fila[]>('conta_remesas_lista', { p_company: companyId })
  const banco = await porBancoDe((d ?? []).map((r) => String(r.id)))
  return (d ?? []).map((r) => ({
    id: String(r.id), codigo: String(r.codigo), aMano: r.a_mano === true, porBanco: banco.has(String(r.id)), fechaPago: String(r.fecha_pago), estado: String(r.estado) as EstadoRemesa,
    total: num(r.total), vivas: num(r.vivas), pagadas: num(r.pagadas), porConfirmar: num(r.por_confirmar), banco: String(r.banco ?? ''),
  }))
}

/** Bancos: las remesas que esperan su cargo, con cada pago (para casar un cargo). */
export interface RemesaParaCasar { id: string; codigo: string; fecha: string; aMano: boolean; porBanco: boolean; porCargarCent: number; pagos: { id: string; importeCent: number; proveedor: string; factura: string | null }[] }
export async function remesasParaCasar(companyId: string): Promise<RemesaParaCasar[]> {
  const d = await rpc<Fila[]>('conta_remesas_para_casar', { p_company: companyId })
  const cent = (x: unknown) => Math.round(num(x) * 100)
  const banco = await porBancoDe((d ?? []).map((r) => String(r.id)))
  return (d ?? []).map((r) => ({
    id: String(r.id), codigo: String(r.codigo), fecha: String(r.fecha), aMano: r.a_mano === true, porBanco: banco.has(String(r.id)), porCargarCent: cent(r.por_cargar),
    pagos: ((r.pagos as Fila[] | null) ?? []).map((p) => ({ id: String(p.id), importeCent: cent(p.importe), proveedor: String(p.proveedor ?? ''), factura: str(p.factura) })),
  }))
}

/** La huella del fichero (SHA-256 en hexadecimal), la que queda en el historial. */
export async function huellaFichero(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
