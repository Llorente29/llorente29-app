// src/services/schedulerService.ts
// Sub-fase 3.1 — CRUD del catálogo de turnos, disponibilidad y schedules

import { supabase } from '../lib/supabase';
import { createNotificationsForEmployees } from './notificationsService';
import type {
  ShiftTemplate,
  EmployeeAvailability,
  Schedule,
  DayOfWeek,
  ShiftPeriod,
  ScheduleCells,
  CoverageOverrides,
} from '../types/scheduler';

/* =====================================================
   SHIFT TEMPLATES
   ===================================================== */

export async function listShiftTemplates(locationId: string): Promise<ShiftTemplate[]> {
  if (!supabase) return [];
  const sb = supabase;
  const { data, error } = await sb
    .from('shift_templates')
    .select('*')
    .eq('location_id', locationId)
    .eq('active', true)
    .order('start_time', { ascending: true });
  if (error) {
    console.error('[scheduler] listShiftTemplates', error);
    return [];
  }
  return (data ?? []) as ShiftTemplate[];
}

export async function createShiftTemplate(
  t: Omit<ShiftTemplate, 'id' | 'created_at' | 'updated_at'>
): Promise<ShiftTemplate | null> {
  if (!supabase) return null;
  const sb = supabase;
  const { data, error } = await sb
    .from('shift_templates')
    .insert(t)
    .select()
    .single();
  if (error) {
    console.error('[scheduler] createShiftTemplate', error);
    return null;
  }
  return data as ShiftTemplate;
}

export async function updateShiftTemplate(
  id: string,
  patch: Partial<ShiftTemplate>
): Promise<boolean> {
  if (!supabase) return false;
  const sb = supabase;
  const { error } = await sb.from('shift_templates').update(patch).eq('id', id);
  if (error) {
    console.error('[scheduler] updateShiftTemplate', error);
    return false;
  }
  return true;
}

export async function deleteShiftTemplate(id: string): Promise<boolean> {
  if (!supabase) return false;
  const sb = supabase;
  // Soft delete: marcamos active=false para no romper schedules pasados
  const { error } = await sb
    .from('shift_templates')
    .update({ active: false })
    .eq('id', id);
  if (error) {
    console.error('[scheduler] deleteShiftTemplate', error);
    return false;
  }
  return true;
}

/* =====================================================
   EMPLOYEE AVAILABILITY
   ===================================================== */

export async function listAvailability(employeeId: string): Promise<EmployeeAvailability[]> {
  if (!supabase) return [];
  const sb = supabase;
  const { data, error } = await sb
    .from('employee_availability')
    .select('*')
    .eq('employee_id', employeeId);
  if (error) {
    console.error('[scheduler] listAvailability', error);
    return [];
  }
  return (data ?? []) as EmployeeAvailability[];
}

export async function listAvailabilityForLocation(
  employeeIds: string[]
): Promise<EmployeeAvailability[]> {
  if (!supabase || employeeIds.length === 0) return [];
  const sb = supabase;
  const { data, error } = await sb
    .from('employee_availability')
    .select('*')
    .in('employee_id', employeeIds);
  if (error) {
    console.error('[scheduler] listAvailabilityForLocation', error);
    return [];
  }
  return (data ?? []) as EmployeeAvailability[];
}

/**
 * Marca una franja como NO disponible (descanso fijo).
 */
export async function setUnavailable(
  employeeId: string,
  day: DayOfWeek,
  period: ShiftPeriod,
  note?: string
): Promise<boolean> {
  if (!supabase) return false;
  const sb = supabase;
  const { error } = await sb
    .from('employee_availability')
    .upsert(
      {
        employee_id: employeeId,
        day_of_week: day,
        shift_period: period,
        available: false,
        note: note ?? null,
      },
      { onConflict: 'employee_id,day_of_week,shift_period' }
    );
  if (error) {
    console.error('[scheduler] setUnavailable', error);
    return false;
  }
  return true;
}

/**
 * Quita la marca de no-disponible (vuelve a estar disponible).
 */
export async function clearUnavailable(
  employeeId: string,
  day: DayOfWeek,
  period: ShiftPeriod
): Promise<boolean> {
  if (!supabase) return false;
  const sb = supabase;
  const { error } = await sb
    .from('employee_availability')
    .delete()
    .eq('employee_id', employeeId)
    .eq('day_of_week', day)
    .eq('shift_period', period);
  if (error) {
    console.error('[scheduler] clearUnavailable', error);
    return false;
  }
  return true;
}

/* =====================================================
   SCHEDULES (matriz semanal)
   ===================================================== */

export async function getSchedule(
  locationId: string,
  weekStart: string
): Promise<Schedule | null> {
  if (!supabase) return null;
  const sb = supabase;
  const { data, error } = await sb
    .from('schedules')
    .select('*')
    .eq('location_id', locationId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) {
    console.error('[scheduler] getSchedule', error);
    return null;
  }
  return (data as Schedule) ?? null;
}

export async function upsertSchedule(s: {
  location_id: string;
  week_start: string;
  cells: ScheduleCells;
  coverage_overrides?: CoverageOverrides;
  status?: 'draft' | 'published';
  generated_at?: string | null;
  published_at?: string | null;
}): Promise<Schedule | null> {
  if (!supabase) return null;
  const sb = supabase;
  const { data, error } = await sb
    .from('schedules')
    .upsert(
      {
        location_id: s.location_id,
        week_start: s.week_start,
        cells: s.cells,
        coverage_overrides: s.coverage_overrides ?? {},
        status: s.status ?? 'draft',
        generated_at: s.generated_at ?? null,
        published_at: s.published_at ?? null,
      },
      { onConflict: 'location_id,week_start' }
    )
    .select()
    .single();
  if (error) {
    console.error('[scheduler] upsertSchedule', error);
    return null;
  }
  return data as Schedule;
}

export async function publishSchedule(id: string): Promise<boolean> {
  if (!supabase) return false;
  const sb = supabase;
  const { error } = await sb
    .from('schedules')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[scheduler] publishSchedule', error);
    return false;
  }

  // Notificar a todos los empleados con turnos en este schedule (sin bloquear si falla)
  try {
    const { data: scheduleRow } = await sb
      .from('schedules')
      .select('cells, week_start')
      .eq('id', id)
      .maybeSingle();

    if (scheduleRow) {
      const cells = (scheduleRow.cells as ScheduleCells) || {};
      const week_start = scheduleRow.week_start as string;

      // Extraer todos los IDs de empleados únicos con al menos 1 turno
      const employeeIds = new Set<string>();
      for (const tid of Object.keys(cells)) {
        for (const dayKey of Object.keys(cells[tid])) {
          for (const empId of cells[tid][dayKey]) {
            employeeIds.add(empId);
          }
        }
      }

      if (employeeIds.size > 0) {
        // Formatear fecha de inicio de semana en español
        const [y, m, d] = week_start.split('-').map(Number);
        const startDate = new Date(y, m - 1, d);
        const fechaLegible = startDate.toLocaleDateString('es-ES', {
          day: '2-digit',
          month: 'short',
        });

        await createNotificationsForEmployees(
          Array.from(employeeIds),
          'schedule_published',
          '📅 Nuevo horario disponible',
          `Tu horario para la semana del ${fechaLegible} ya está publicado. Consulta tus turnos en la app.`,
          { scheduleId: id, weekStart: week_start }
        );
      }
    }
  } catch (e) {
    console.warn('[scheduler] publishSchedule: error creando notificaciones:', e);
  }

  return true;
}

export async function listRecentSchedules(
  locationId: string,
  limit = 8
): Promise<Schedule[]> {
  if (!supabase) return [];
  const sb = supabase;
  const { data, error } = await sb
    .from('schedules')
    .select('*')
    .eq('location_id', locationId)
    .order('week_start', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[scheduler] listRecentSchedules', error);
    return [];
  }
  return (data ?? []) as Schedule[];
}
