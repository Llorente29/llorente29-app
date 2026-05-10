// src/services/formationsService.ts
// Gestión de formaciones de empleados (cumplimiento legal hostelería).
// CRUD básico + detección de caducidades para alertas.

import { supabase } from '../lib/supabase'
import type { Formation, FormationType } from '../types/personal'

interface FormationRow {
  id: string
  employee_id: string
  type: string
  name: string
  issuer: string | null
  issue_date: string
  expiry_date: string | null
  document_url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

function rowToFormation(r: FormationRow): Formation {
  return {
    id: r.id,
    employeeId: r.employee_id,
    type: r.type as FormationType,
    name: r.name,
    issuer: r.issuer || undefined,
    issueDate: r.issue_date,
    expiryDate: r.expiry_date || undefined,
    documentUrl: r.document_url || undefined,
    notes: r.notes || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/* =====================================================
   CRUD
   ===================================================== */

/**
 * Listar formaciones de un empleado (más recientes primero por fecha emisión).
 */
export async function fetchFormations(employeeId: string): Promise<Formation[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('employee_formations')
    .select('*')
    .eq('employee_id', employeeId)
    .order('issue_date', { ascending: false })
  if (error) {
    console.error('[formations] fetchFormations:', error)
    return []
  }
  return (data || []).map(r => rowToFormation(r as FormationRow))
}

/**
 * Listar TODAS las formaciones de TODOS los empleados (para Insights).
 */
export async function fetchAllFormations(): Promise<Formation[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('employee_formations')
    .select('*')
    .order('expiry_date', { ascending: true, nullsFirst: false })
  if (error) {
    console.error('[formations] fetchAllFormations:', error)
    return []
  }
  return (data || []).map(r => rowToFormation(r as FormationRow))
}

/**
 * Crear una formación nueva.
 */
export async function createFormation(
  employeeId: string,
  data: {
    type: FormationType
    name: string
    issuer?: string
    issueDate: string
    expiryDate?: string
    documentUrl?: string
    notes?: string
  }
): Promise<Formation | null> {
  if (!supabase) return null
  const { data: row, error } = await supabase
    .from('employee_formations')
    .insert({
      employee_id: employeeId,
      type: data.type,
      name: data.name,
      issuer: data.issuer || null,
      issue_date: data.issueDate,
      expiry_date: data.expiryDate || null,
      document_url: data.documentUrl || null,
      notes: data.notes || null,
    })
    .select()
    .single()
  if (error) {
    console.error('[formations] createFormation:', error)
    return null
  }
  return rowToFormation(row as FormationRow)
}

/**
 * Actualizar una formación existente.
 */
export async function updateFormation(
  id: string,
  patch: Partial<{
    type: FormationType
    name: string
    issuer: string
    issueDate: string
    expiryDate: string
    documentUrl: string
    notes: string
  }>
): Promise<boolean> {
  if (!supabase) return false
  const updateData: Record<string, unknown> = {}
  if (patch.type !== undefined) updateData.type = patch.type
  if (patch.name !== undefined) updateData.name = patch.name
  if (patch.issuer !== undefined) updateData.issuer = patch.issuer || null
  if (patch.issueDate !== undefined) updateData.issue_date = patch.issueDate
  if (patch.expiryDate !== undefined) updateData.expiry_date = patch.expiryDate || null
  if (patch.documentUrl !== undefined) updateData.document_url = patch.documentUrl || null
  if (patch.notes !== undefined) updateData.notes = patch.notes || null

  const { error } = await supabase
    .from('employee_formations')
    .update(updateData)
    .eq('id', id)
  if (error) {
    console.error('[formations] updateFormation:', error)
    return false
  }
  return true
}

/**
 * Borrar una formación.
 */
export async function deleteFormation(id: string): Promise<boolean> {
  if (!supabase) return false
  const { error } = await supabase
    .from('employee_formations')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('[formations] deleteFormation:', error)
    return false
  }
  return true
}

/* =====================================================
   ALERTAS DE CADUCIDAD
   ===================================================== */

export type FormationStatus =
  | 'no_expira'      // sin fecha de caducidad
  | 'vigente'        // caducidad >30 días
  | 'caduca_pronto'  // caducidad 16-30 días
  | 'caduca_critico' // caducidad 8-15 días
  | 'caduca_urgente' // caducidad 0-7 días
  | 'caducada'       // ya caducó

export interface FormationStatusInfo {
  status: FormationStatus
  daysLeft: number          // negativo si caducada
  label: string             // texto legible
  color: 'gray' | 'green' | 'yellow' | 'orange' | 'red'
}

/**
 * Calcula el estado de una formación según su fecha de caducidad.
 */
export function getFormationStatus(formation: Formation): FormationStatusInfo {
  if (!formation.expiryDate) {
    return {
      status: 'no_expira',
      daysLeft: Infinity,
      label: 'No caduca',
      color: 'gray',
    }
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expiry = new Date(formation.expiryDate + 'T00:00:00')
  const daysLeft = Math.floor((expiry.getTime() - today.getTime()) / 86400000)

  if (daysLeft < 0) {
    return {
      status: 'caducada',
      daysLeft,
      label: `Caducada hace ${Math.abs(daysLeft)} día${Math.abs(daysLeft) === 1 ? '' : 's'}`,
      color: 'red',
    }
  }
  if (daysLeft <= 7) {
    return {
      status: 'caduca_urgente',
      daysLeft,
      label: daysLeft === 0 ? 'Caduca HOY' : `Caduca en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`,
      color: 'red',
    }
  }
  if (daysLeft <= 15) {
    return {
      status: 'caduca_critico',
      daysLeft,
      label: `Caduca en ${daysLeft} días`,
      color: 'orange',
    }
  }
  if (daysLeft <= 30) {
    return {
      status: 'caduca_pronto',
      daysLeft,
      label: `Caduca en ${daysLeft} días`,
      color: 'yellow',
    }
  }
  return {
    status: 'vigente',
    daysLeft,
    label: 'Vigente',
    color: 'green',
  }
}

/**
 * Obtiene la formación con peor estado del empleado.
 * Útil para mostrar el estado "general" en listados.
 */
export function getWorstFormationStatus(formations: Formation[]): FormationStatusInfo | null {
  if (formations.length === 0) return null
  const order: FormationStatus[] = ['caducada', 'caduca_urgente', 'caduca_critico', 'caduca_pronto', 'vigente', 'no_expira']
  let worst: FormationStatusInfo | null = null
  let worstIdx = order.length
  for (const f of formations) {
    const info = getFormationStatus(f)
    const idx = order.indexOf(info.status)
    if (idx < worstIdx) {
      worstIdx = idx
      worst = info
    }
  }
  return worst
}
