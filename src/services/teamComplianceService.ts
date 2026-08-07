// src/services/teamComplianceService.ts
// F4.1/F6 — team_compliance_scan: infracciones de convenio detectadas sobre
// fichajes reales (jornada continua sin pausa, descanso 12h, etc.), con base
// legal. Motor en producción desde F1.5/F6 (ver ENCARGO_CODE_team_F4_arranque.md).
// db() laxo por la deuda de database.ts (función nueva aún no tipada).

import { supabase } from '../lib/supabase'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  if (!supabase) throw new Error('Sin conexión con el servidor.')
  return supabase as any
}

export type ComplianceSeverity = 'info' | 'warning' | 'critical'

export interface ComplianceIssue {
  employeeId: string
  employeeName: string
  locationId: string
  startedAt: string
  endedAt: string
  workedMinutes: number
  nightMinutes: number
  issueCode: string
  issueSeverity: ComplianceSeverity
  issueDetail: string
  legalRef: string
}

export async function fetchComplianceScan(
  accountId: string,
  fromISO: string,
  toISO: string
): Promise<ComplianceIssue[]> {
  const { data, error } = await db().rpc('team_compliance_scan', {
    p_account: accountId,
    p_from: fromISO,
    p_to: toISO,
  })
  if (error) {
    console.error('[teamCompliance] team_compliance_scan:', error)
    return []
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map(r => ({
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    locationId: r.location_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    workedMinutes: Number(r.worked_minutes) || 0,
    nightMinutes: Number(r.night_minutes) || 0,
    issueCode: r.issue_code,
    issueSeverity: (r.issue_severity as ComplianceSeverity) || 'info',
    issueDetail: r.issue_detail,
    legalRef: r.legal_ref,
  }))
}
