// src/services/appSettingsService.ts
// Configuración global de la app (redondeo, alertas, visibilidad bolsa de horas)
import { supabase } from '../lib/supabase'

export interface AppSettings {
  id: string
  scope: 'global'
  roundingToleranceMin: number       // tolerancia para redondeo (default 8)
  showHourBankToEmployee: boolean    // ¿trabajador ve bolsa de horas? (default false)
  lateAlertMin: number               // min retraso para alerta (default 15)
  forgotClockoutMin: number          // min tras horario teórico para alerta olvido salida (default 30)
  updatedAt: string
}

interface SettingsRow {
  id: string
  scope: 'global'
  rounding_tolerance_min: number
  show_hour_bank_to_employee: boolean
  late_alert_min: number
  forgot_clockout_min: number
  updated_at: string
}

function rowToSettings(r: SettingsRow): AppSettings {
  return {
    id: r.id,
    scope: r.scope,
    roundingToleranceMin: r.rounding_tolerance_min,
    showHourBankToEmployee: r.show_hour_bank_to_employee,
    lateAlertMin: r.late_alert_min,
    forgotClockoutMin: r.forgot_clockout_min,
    updatedAt: r.updated_at,
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  id: '',
  scope: 'global',
  roundingToleranceMin: 8,
  showHourBankToEmployee: false,
  lateAlertMin: 15,
  forgotClockoutMin: 30,
  updatedAt: new Date().toISOString(),
}

export async function fetchAppSettings(): Promise<AppSettings> {
  if (!supabase) return DEFAULT_SETTINGS
  const { data, error } = await supabase.from('app_settings').select('*').eq('scope', 'global').single()
  if (error || !data) {
    console.error('fetchAppSettings:', error)
    return DEFAULT_SETTINGS
  }
  return rowToSettings(data as SettingsRow)
}

export async function updateAppSettings(patch: Partial<Omit<AppSettings, 'id' | 'scope' | 'updatedAt'>>): Promise<boolean> {
  if (!supabase) return false
  const update: Partial<SettingsRow> = {
    updated_at: new Date().toISOString(),
  }
  if (patch.roundingToleranceMin !== undefined) update.rounding_tolerance_min = patch.roundingToleranceMin
  if (patch.showHourBankToEmployee !== undefined) update.show_hour_bank_to_employee = patch.showHourBankToEmployee
  if (patch.lateAlertMin !== undefined) update.late_alert_min = patch.lateAlertMin
  if (patch.forgotClockoutMin !== undefined) update.forgot_clockout_min = patch.forgotClockoutMin

  const { error } = await supabase.from('app_settings').update(update).eq('scope', 'global')
  if (error) { console.error('updateAppSettings:', error); return false }
  return true
}
