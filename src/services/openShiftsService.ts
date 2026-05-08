// src/services/openShiftsService.ts
import { supabase } from '../lib/supabase'

export type OpenShiftStatus = 'abierto' | 'asignado' | 'cancelado'
export type ShiftRequestStatus = 'pendiente' | 'aceptada' | 'rechazada' | 'retirada'

export interface OpenShift {
  id: string
  locationId: string
  date: string                  // YYYY-MM-DD
  startTime: string             // "09:00"
  endTime: string               // "17:00"
  position?: string
  notes?: string
  status: OpenShiftStatus
  assignedTo?: string
  assignedAt?: string
  createdBy?: string
  createdAt: string
  updatedAt: string
}

export interface ShiftRequest {
  id: string
  shiftId: string
  employeeId: string
  status: ShiftRequestStatus
  notes?: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNotes?: string
  createdAt: string
}

interface OpenShiftRow {
  id: string
  location_id: string
  date: string
  start_time: string
  end_time: string
  position: string | null
  notes: string | null
  status: OpenShiftStatus
  assigned_to: string | null
  assigned_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

interface RequestRow {
  id: string
  shift_id: string
  employee_id: string
  status: ShiftRequestStatus
  notes: string | null
  reviewed_at: string | null
  reviewed_by: string | null
  review_notes: string | null
  created_at: string
}

function rowToOpenShift(r: OpenShiftRow): OpenShift {
  return {
    id: r.id,
    locationId: r.location_id,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    position: r.position || undefined,
    notes: r.notes || undefined,
    status: r.status,
    assignedTo: r.assigned_to || undefined,
    assignedAt: r.assigned_at || undefined,
    createdBy: r.created_by || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function rowToRequest(r: RequestRow): ShiftRequest {
  return {
    id: r.id,
    shiftId: r.shift_id,
    employeeId: r.employee_id,
    status: r.status,
    notes: r.notes || undefined,
    reviewedAt: r.reviewed_at || undefined,
    reviewedBy: r.reviewed_by || undefined,
    reviewNotes: r.review_notes || undefined,
    createdAt: r.created_at,
  }
}

// ─── OPEN SHIFTS ──────────────────────────────────────────────────────────

export async function fetchOpenShifts(filter?: 'open' | 'all'): Promise<OpenShift[] | null> {
  if (!supabase) return null
  let query = supabase.from('open_shifts').select('*').order('date', { ascending: true })
  if (filter === 'open') query = query.eq('status', 'abierto')
  const { data, error } = await query
  if (error) { console.error('fetchOpenShifts:', error); return null }
  return (data as OpenShiftRow[]).map(rowToOpenShift)
}

export async function fetchOpenShift(id: string): Promise<OpenShift | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('open_shifts').select('*').eq('id', id).single()
  if (error) { console.error('fetchOpenShift:', error); return null }
  return rowToOpenShift(data as OpenShiftRow)
}

export async function createOpenShift(input: {
  locationId: string; date: string; startTime: string; endTime: string;
  position?: string; notes?: string;
}): Promise<OpenShift | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('open_shifts').insert({
    location_id: input.locationId,
    date: input.date,
    start_time: input.startTime,
    end_time: input.endTime,
    position: input.position || null,
    notes: input.notes || null,
    status: 'abierto',
  }).select().single()
  if (error) { console.error('createOpenShift:', error); throw new Error('Error: ' + error.message) }
  return rowToOpenShift(data as OpenShiftRow)
}

export async function cancelOpenShift(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('open_shifts')
    .update({ status: 'cancelado', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) { console.error('cancelOpenShift:', error); return false }
  return true
}

export async function deleteOpenShift(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('open_shifts').delete().eq('id', id)
  if (error) { console.error('deleteOpenShift:', error); return false }
  return true
}

// ─── REQUESTS ─────────────────────────────────────────────────────────────

export async function fetchRequestsForShift(shiftId: string): Promise<ShiftRequest[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('open_shift_requests')
    .select('*').eq('shift_id', shiftId).order('created_at', { ascending: true })
  if (error) { console.error('fetchRequestsForShift:', error); return null }
  return (data as RequestRow[]).map(rowToRequest)
}

export async function fetchPendingRequests(): Promise<ShiftRequest[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('open_shift_requests')
    .select('*').eq('status', 'pendiente').order('created_at', { ascending: false })
  if (error) { console.error('fetchPendingRequests:', error); return null }
  return (data as RequestRow[]).map(rowToRequest)
}

export async function fetchRequestsForEmployee(employeeId: string): Promise<ShiftRequest[] | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('open_shift_requests')
    .select('*').eq('employee_id', employeeId).order('created_at', { ascending: false })
  if (error) { console.error('fetchRequestsForEmployee:', error); return null }
  return (data as RequestRow[]).map(rowToRequest)
}

export async function requestShift(shiftId: string, employeeId: string, notes?: string): Promise<ShiftRequest | null> {
  if (!supabase) return null
  const { data, error } = await supabase.from('open_shift_requests').insert({
    shift_id: shiftId,
    employee_id: employeeId,
    status: 'pendiente',
    notes: notes || null,
  }).select().single()
  if (error) { console.error('requestShift:', error); throw new Error('Error: ' + error.message) }
  return rowToRequest(data as RequestRow)
}

export async function withdrawRequest(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('open_shift_requests').update({ status: 'retirada' }).eq('id', id)
  if (error) { console.error('withdrawRequest:', error); return false }
  return true
}

/**
 * Acepta a un empleado para el turno: marca su request como 'aceptada',
 * marca el resto como 'rechazada' y el shift como 'asignado'.
 */
export async function acceptRequest(requestId: string, reviewNotes?: string): Promise<boolean> {
  if (!supabase) return false
  const sb = supabase

  // 1. Cargar la request
  const { data: req, error: e1 } = await sb.from('open_shift_requests').select('*').eq('id', requestId).single()
  if (e1 || !req) { console.error('acceptRequest fetch:', e1); return false }
  const r = req as RequestRow

  // 2. Marcar esta como aceptada
  const { error: e2 } = await sb.from('open_shift_requests').update({
    status: 'aceptada',
    reviewed_at: new Date().toISOString(),
    review_notes: reviewNotes || null,
  }).eq('id', requestId)
  if (e2) { console.error('acceptRequest accept:', e2); return false }

  // 3. Marcar otras pendientes del mismo turno como rechazadas
  const { error: e3 } = await sb.from('open_shift_requests').update({
    status: 'rechazada',
    reviewed_at: new Date().toISOString(),
    review_notes: 'Asignado a otro empleado',
  }).eq('shift_id', r.shift_id).eq('status', 'pendiente')
  if (e3) { console.error('acceptRequest reject others:', e3) }

  // 4. Marcar el shift como asignado
  const { error: e4 } = await sb.from('open_shifts').update({
    status: 'asignado',
    assigned_to: r.employee_id,
    assigned_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', r.shift_id)
  if (e4) { console.error('acceptRequest assign:', e4); return false }

  return true
}

export async function rejectRequest(requestId: string, reviewNotes?: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase.from('open_shift_requests').update({
    status: 'rechazada',
    reviewed_at: new Date().toISOString(),
    review_notes: reviewNotes || null,
  }).eq('id', requestId)
  if (error) { console.error('rejectRequest:', error); return false }
  return true
}

// ─── HELPERS ──────────────────────────────────────────────────────────────

export function shiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  return (eh + em / 60) - (sh + sm / 60)
}
