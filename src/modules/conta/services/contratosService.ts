// src/modules/conta/services/contratosService.ts
//
// S01d · Préstamos y aplazamientos (tablero 3): leer los contratos de la
// empresa y darlos de alta desde «Subir el cuadro» (bank_contrato_guardar,
// que no guarda un cuadro cuyo capital no sume lo aplazado).

import { supabase } from '@/lib/supabase'
import { hayBase, mensaje, rpc, tabla } from '@/modules/conta/services/bd'
import { uploadReceiptFiles } from '@/modules/supply/services/goodsReceiptService'
import type { ContratoVista, FilaCuadro, TipoContrato } from '@/modules/conta/lib/contratos'

type Fila = Record<string, unknown>
const s = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
const cent = (x: unknown) => Math.round(Number(x) * 100)

export async function leerContratos(accountId: string, companyId: string): Promise<ContratoVista[]> {
  const { data, error } = await tabla('recurring_contract')
    .select('id, kind, name, concept_contains, amount, principal, installments, schedule, treasury_account_id, capital_account, short_capital_account, long_capital_account, interest_account, document_name')
    .eq('account_id', accountId).eq('company_id', companyId).eq('is_active', true).order('created_at')
  if (error) throw new Error(mensaje('No se han podido leer los préstamos y aplazamientos', error))
  return ((data ?? []) as Fila[]).map((c) => ({
    id: String(c.id), tipo: c.kind as TipoContrato, nombre: String(c.name), contiene: String(c.concept_contains),
    importeCent: c.amount === null ? null : cent(c.amount), principalCent: c.principal === null ? null : cent(c.principal), cuotas: c.installments === null ? null : Number(c.installments),
    cuadro: Array.isArray(c.schedule) ? (c.schedule as Fila[]).map((f): FilaCuadro => ({ fecha: String(f.fecha), cuotaCent: cent(f.cuota), capitalCent: cent(f.capital),
      interesesCent: cent(f.intereses), pendienteCent: f.pendiente === undefined || f.pendiente === null ? null : cent(f.pendiente) })) : null,
    bancoId: s(c.treasury_account_id), cuentaCorto: s(c.short_capital_account) ?? s(c.capital_account), cuentaLargo: s(c.long_capital_account),
    cuentaIntereses: s(c.interest_account), documento: s(c.document_name),
  }))
}

export interface ContratoNuevo {
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
  }
}
