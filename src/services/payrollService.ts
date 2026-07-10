// src/services/payrollService.ts
// Cabina de nóminas (Folvy Team): sube el PDF a la ficha (documentsService),
// llama al extractor payroll-extract y lee los costes reales de payroll_cost.
//
// DEUDA DECLARADA (disparador: regenerar database.ts): payroll_cost aún no está
// en los tipos generados → cliente laxo local db(). Se retira al regenerar.

import { supabase } from '../lib/supabase'
import { uploadDocument } from './documentsService'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export type PayrollStatus = 'borrador' | 'definitiva'
export type PayrollSource = 'manual' | 'nomina_upload' | 'gmail'

export interface PayrollCostRow {
  id: string
  employeeId: string
  employeeName: string
  periodYear: number
  periodMonth: number
  status: PayrollStatus
  gross: number | null
  employerSs: number | null
  totalCost: number | null
  net: number | null
  source: PayrollSource
  needsReview: boolean
  documentId?: string
  createdAt: string
}

export interface ExtractResult {
  status: 'ok' | 'needs_review' | string
  matchedEmployeeId: string | null
  payrollCostId: string | null
  period: { year: number; month: number } | null
  isDraft: boolean
  gross: number | null
  employerSs: number | null
  totalCost: number | null
  net: number | null
  checks: { earnings: boolean | null; net: boolean | null; employer_ss: boolean | null }
  reasons: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapResult(d: any): ExtractResult {
  return {
    status: d?.status ?? 'error',
    matchedEmployeeId: d?.matched_employee_id ?? null,
    payrollCostId: d?.payroll_cost_id ?? null,
    period: d?.period ?? null,
    isDraft: !!d?.is_draft,
    gross: d?.gross ?? null,
    employerSs: d?.employer_ss ?? null,
    totalCost: d?.total_cost ?? null,
    net: d?.net ?? null,
    checks: d?.checks ?? { earnings: null, net: null, employer_ss: null },
    reasons: d?.reasons ?? [],
  }
}

/** Sube el PDF a la ficha del empleado y lo pasa por el extractor. */
export async function uploadAndExtractNomina(
  accountId: string, employeeId: string, file: File, uploadedBy: string | null = null,
): Promise<ExtractResult> {
  const doc = await uploadDocument(employeeId, file, 'nomina', uploadedBy, 'gestor')
  if (!doc) throw new Error('No se pudo subir el PDF')
  const { data, error } = await db().functions.invoke('payroll-extract', {
    body: { account_id: accountId, file_paths: [doc.filePath], document_id: doc.id, source: 'nomina_upload' },
  })
  if (error) throw new Error(error.message || 'Error extrayendo la nómina')
  return mapResult(data)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPayroll(r: any): PayrollCostRow {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employees?.name ?? '—',
    periodYear: r.period_year,
    periodMonth: r.period_month,
    status: r.status,
    gross: r.gross != null ? Number(r.gross) : null,
    employerSs: r.employer_ss != null ? Number(r.employer_ss) : null,
    totalCost: r.total_cost != null ? Number(r.total_cost) : null,
    net: r.net != null ? Number(r.net) : null,
    source: r.source,
    needsReview: !!r.needs_review,
    documentId: r.document_id ?? undefined,
    createdAt: r.created_at,
  }
}

export interface PayrollInboxRow {
  id: string
  status: 'matched' | 'unmatched' | 'error' | 'resolved'
  source: PayrollSource
  readName?: string
  readDni?: string
  periodYear?: number
  periodMonth?: number
  gross: number | null
  employerSs: number | null
  totalCost: number | null
  reason?: string
  createdAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToInbox(r: any): PayrollInboxRow {
  return {
    id: r.id,
    status: r.status,
    source: r.source,
    readName: r.read_name ?? undefined,
    readDni: r.read_dni ?? undefined,
    periodYear: r.period_year ?? undefined,
    periodMonth: r.period_month ?? undefined,
    gross: r.gross != null ? Number(r.gross) : null,
    employerSs: r.employer_ss != null ? Number(r.employer_ss) : null,
    totalCost: r.total_cost != null ? Number(r.total_cost) : null,
    reason: r.reason ?? undefined,
    createdAt: r.created_at,
  }
}

/** Nóminas que NO entraron (sin casar o con error) — la bandeja de la cabina. */
export async function fetchPayrollInbox(accountId: string): Promise<PayrollInboxRow[]> {
  const { data, error } = await db().from('payroll_inbox')
    .select('*')
    .eq('account_id', accountId)
    .in('status', ['unmatched', 'error'])
    .order('created_at', { ascending: false })
  if (error) { console.error('fetchPayrollInbox:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(rowToInbox)
}

/** Asigna una nómina sin casar a un empleado: escribe el coste y rellena su DNI. */
export async function resolvePayrollInbox(inboxId: string, employeeId: string): Promise<void> {
  const { error } = await db().rpc('resolve_payroll_inbox', { p_inbox_id: inboxId, p_employee_id: employeeId })
  if (error) throw new Error(error.message || 'No se pudo asignar la nómina')
}

/** Lee los costes de nómina de la cuenta (con nombre del empleado). */
export async function fetchPayrollCosts(accountId: string, year?: number): Promise<PayrollCostRow[]> {
  let q = db().from('payroll_cost')
    .select('*, employees(name)')
    .eq('account_id', accountId)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
  if (year) q = q.eq('period_year', year)
  const { data, error } = await q
  if (error) { console.error('fetchPayrollCosts:', error); return [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(rowToPayroll)
}
