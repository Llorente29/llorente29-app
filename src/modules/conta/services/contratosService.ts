// src/modules/conta/services/contratosService.ts
//
// S01d · Préstamos y aplazamientos (tablero 3): leer los contratos de la
// empresa y darlos de alta desde «Subir el cuadro» (bank_contrato_guardar,
// que no guarda un cuadro cuyo capital no sume lo aplazado).

import { supabase } from '@/lib/supabase'
import { hayBase, mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { uploadReceiptFiles } from '@/modules/supply/services/goodsReceiptService'
import type { ContratoVista, FilaCuadro, TipoContrato } from '@/modules/conta/lib/contratos'
import type { CargoSinCasar, PagoDeFila } from '@/modules/conta/lib/fichaContrato'

type Fila = Record<string, unknown>
const s = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
const cent = (x: unknown) => Math.round(Number(x) * 100)

const COLUMNAS = 'id, kind, name, concept_contains, amount, principal, installments, schedule, treasury_account_id, capital_account, short_capital_account, long_capital_account, interest_account, document_name, document_uploaded_at, created_at, is_active'

function aVista(c: Fila): ContratoVista {
  return {
    id: String(c.id), tipo: c.kind as TipoContrato, nombre: String(c.name), contiene: String(c.concept_contains),
    importeCent: c.amount === null ? null : cent(c.amount), principalCent: c.principal === null ? null : cent(c.principal), cuotas: c.installments === null ? null : Number(c.installments),
    cuadro: Array.isArray(c.schedule) ? (c.schedule as Fila[]).map((f): FilaCuadro => ({ fecha: String(f.fecha), cuotaCent: cent(f.cuota), capitalCent: cent(f.capital),
      interesesCent: cent(f.intereses), pendienteCent: f.pendiente === undefined || f.pendiente === null ? null : cent(f.pendiente),
      amortizadoAntesCent: f.amortizado_antes === undefined || f.amortizado_antes === null ? null : cent(f.amortizado_antes) })) : null,
    bancoId: s(c.treasury_account_id), cuentaCorto: s(c.short_capital_account) ?? s(c.capital_account), cuentaLargo: s(c.long_capital_account),
    cuentaIntereses: s(c.interest_account), documento: s(c.document_name),
    subidoEl: s(c.document_uploaded_at) ?? s(c.created_at), activo: c.is_active !== false,
  }
}

export async function leerContratos(accountId: string, companyId: string): Promise<ContratoVista[]> {
  const { data, error } = await tabla('recurring_contract').select(COLUMNAS)
    .eq('account_id', accountId).eq('company_id', companyId).eq('is_active', true).order('created_at')
  if (error) throw new Error(mensaje('No se han podido leer los préstamos y aplazamientos', error))
  return ((data ?? []) as Fila[]).map(aVista)
}

/** S01e · La ficha: el contrato (también si está terminado), los cargos casados con cada fila y los del contrato sin casar. */
export async function leerFicha(accountId: string, companyId: string, id: string): Promise<{ contrato: ContratoVista; pagos: PagoDeFila[]; sinCasar: CargoSinCasar[] } | null> {
  const { data, error } = await tabla('recurring_contract').select(COLUMNAS).eq('account_id', accountId).eq('company_id', companyId).eq('id', id).maybeSingle()
  if (error) throw new Error(mensaje('No se ha podido leer el contrato', error))
  if (!data) return null
  const contrato = aVista(data as Fila)
  const m = await tabla('bank_match').select('movement_id, journal_entry_id, contract_due_date, bank_movement(op_date, treasury_account_id), journal_entry(number)')
    .eq('account_id', accountId).eq('contract_id', id).eq('status', 'vivo')
  if (m.error) throw new Error(mensaje('No se han podido leer las cuotas pagadas', m.error))
  const pagos = ((m.data ?? []) as Fila[]).filter((x) => x.contract_due_date).map((x): PagoDeFila => {
    const mov = (x.bank_movement ?? {}) as Fila; const je = (x.journal_entry ?? null) as Fila | null
    return { fecha: String(x.contract_due_date), movimientoId: String(x.movement_id), asientoId: s(x.journal_entry_id),
      asiento: je && je.number !== null && je.number !== undefined ? Number(je.number) : null, mesMovimiento: String(mov.op_date ?? '').slice(0, 7), bancoId: s(mov.treasury_account_id) }
  })
  // Los cargos del contrato que siguen sin casar (el banco cobró otra cifra): por lo que pone el banco, de esta empresa.
  const desde = contrato.cuadro?.[0]?.fecha ?? null
  let q = tabla('bank_movement').select('id, op_date, amount, treasury_account_id')
    .eq('account_id', accountId).eq('company_id', companyId).in('status', ['pendiente', 'propuesto', 'por_aclarar'])
    .ilike('bank_concept', `%${contrato.contiene.replace(/[%_]/g, '')}%`).lt('amount', 0)
  if (desde) q = q.gte('op_date', `${desde.slice(0, 7)}-01`)
  const c = await q
  if (c.error) throw new Error(mensaje('No se han podido leer los cargos del contrato', c.error))
  const sinCasar = ((c.data ?? []) as Fila[]).map((x): CargoSinCasar => ({ movimientoId: String(x.id), fechaCargo: String(x.op_date), importeCent: -cent(x.amount), bancoId: s(x.treasury_account_id) }))
    .filter((x) => !(contrato.cuadro ?? []).some((f) => f.fecha.slice(0, 7) === x.fechaCargo.slice(0, 7) && f.cuotaCent === x.importeCent))
  return { contrato, pagos, sinCasar }
}

/** S01e · «Subir un cuadro nuevo» desde la ficha: añadir las filas del año nuevo (aplazamiento) o sustituir las pendientes (préstamo). */
export async function cambiarCuadro(companyId: string, contratoId: string, modo: 'anadir' | 'sustituir', cuadro: readonly FilaCuadro[], o: { amortizadoCent?: number | null; pendienteCent?: number | null; documento: string }): Promise<string> {
  const r = await rpc<{ id: string; mensaje: string }>('bank_contrato_guardar', {
    p_company: companyId,
    p_datos: {
      contrato: contratoId, modo, documento: o.documento,
      ...(o.amortizadoCent ? { amortizado: o.amortizadoCent / 100 } : {}), ...(o.pendienteCent != null ? { pendiente: o.pendienteCent / 100 } : {}),
      cuadro: cuadro.map((f) => ({ fecha: f.fecha, cuota: f.cuotaCent / 100, capital: f.capitalCent / 100, intereses: f.interesesCent / 100 })),
    },
  })
  return r.mensaje
}

/** S01e · «Más acciones» de la ficha: las cuentas, lo que pone el banco o darlo por terminado. Devuelve la frase de la base. */
export async function cambiarDatosContrato(companyId: string, contratoId: string, datos: { capitalCorto?: string; capitalLargo?: string | null; intereses?: string; contiene?: string; activo?: boolean }): Promise<string> {
  const r = await rpc<{ id: string; mensaje: string }>('bank_contrato_guardar', {
    p_company: companyId,
    p_datos: {
      contrato: contratoId, modo: 'datos',
      ...(datos.capitalCorto !== undefined ? { capital_corto: datos.capitalCorto } : {}),
      ...(datos.capitalLargo !== undefined ? { capital_largo: datos.capitalLargo } : {}),
      ...(datos.intereses !== undefined ? { intereses: datos.intereses } : {}),
      ...(datos.contiene !== undefined ? { contiene: datos.contiene } : {}),
      ...(datos.activo !== undefined ? { activo: datos.activo } : {}),
    },
  })
  return r.mensaje
}

export interface ContratoNuevo {
  /** S01d-b · Si va a un contrato que ya existe: se le añaden las filas del año nuevo. */
  contratoId?: string | null
  /** S01d-b · Las cuotas de todo el contrato y la deuda pendiente al final del cuadro (cuadro parcial). */
  cuotas?: number | null; pendienteCent?: number | null
  tipo: 'prestamo' | 'aplazamiento' | 'poliza'; nombre: string; contiene: string
  importeCent: number | null; cuadro: FilaCuadro[]; bancoId: string | null
  cuentaCorto: string; cuentaLargo: string | null; cuentaIntereses: string
  documento: string | null; documentoTipo: 'excel' | 'pdf' | 'a_mano'
}

/** «Confirmar y crear el contrato»: devuelve la frase de la base (regla 8). */
export async function guardarContrato(companyId: string, c: ContratoNuevo): Promise<string> {
  const r = await rpc<{ id: string; mensaje: string }>('bank_contrato_guardar', {
    p_company: companyId,
    p_datos: {
      ...(c.contratoId ? { contrato: c.contratoId } : {}), cuotas: c.cuotas ?? null, pendiente: c.pendienteCent == null ? null : c.pendienteCent / 100,
      tipo: c.tipo, nombre: c.nombre, contiene: c.contiene, importe: c.importeCent === null ? null : c.importeCent / 100, banco: c.bancoId,
      capital_corto: c.cuentaCorto, capital_largo: c.cuentaLargo, intereses: c.cuentaIntereses, documento: c.documento, documento_tipo: c.documentoTipo,
      cuadro: c.cuadro.map((f) => ({ fecha: f.fecha, cuota: f.cuotaCent / 100, capital: f.capitalCent / 100, intereses: f.interesesCent / 100 })),
    },
  })
  return r.mensaje
}

/** Lo que devuelve ocr-albaran en modo «cuadro» (_shared/lecturaCuadro.ts). */
export interface CuadroDelPdf {
  tipo: 'prestamo' | 'aplazamiento'; organismo: string | null; importeCent: number | null
  cuadro: FilaCuadro[]; sumaCent: number; cuadra: boolean | null
  /** S01d-b · Las cuotas de todo el contrato (del texto) y la deuda pendiente al final del cuadro. */
  cuotas: number; pendienteCent: number | null
}

/** «Subir el cuadro» con un PDF: se sube a receipt-uploads y lo lee ocr-albaran (modo cuadro). Nada se guarda aún. */
export async function leerCuadroPdf(accountId: string, f: File): Promise<CuadroDelPdf> {
  hayBase()
  const [ruta] = await uploadReceiptFiles(accountId, [f])
  const { data, error } = await supabase!.functions.invoke('ocr-albaran', { body: { account_id: accountId, file_paths: [ruta], modo: 'cuadro' } })
  if (error) throw new Error(`No se ha podido leer el PDF (${error.message}).`)
  const c = (data as { cuadro?: Fila } | null)?.cuadro
  if (!c || !Array.isArray(c.filas)) throw new Error('La lectura del PDF no ha devuelto el cuadro.')
  return {
    tipo: c.tipo === 'aplazamiento' ? 'aplazamiento' : 'prestamo', organismo: s(c.organismo),
    importeCent: c.importeAplazado === null || c.importeAplazado === undefined ? null : cent(c.importeAplazado),
    cuadro: (c.filas as Fila[]).map((x) => ({ fecha: String(x.fecha), cuotaCent: cent(x.cuota), capitalCent: cent(x.capital), interesesCent: cent(x.intereses) })),
    sumaCent: cent(c.sumaCapital), cuadra: c.cuadra === null || c.cuadra === undefined ? null : Boolean(c.cuadra),
    cuotas: Number(c.cuotasTotales ?? (c.filas as unknown[]).length), pendienteCent: c.deudaPendiente === null || c.deudaPendiente === undefined ? null : cent(c.deudaPendiente),
  }
}
