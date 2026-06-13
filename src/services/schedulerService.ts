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

/* =====================================================
   COPIAR HORARIO A OTRAS SEMANAS
   ===================================================== */

export interface CopyScheduleResult {
  copied: string[]; // week_starts copiados (lunes ISO)
  skipped: string[]; // week_starts omitidos por estar ya publicados
  removedForVacation: number; // asignaciones quitadas por vacaciones aprobadas
}

// Suma dias a una fecha ISO (YYYY-MM-DD) en horario local, sin desfase de zona.
function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Copia el horario (cells + coverage_overrides) de una semana origen a una o
 * varias semanas destino.
 * - Siempre escribe como BORRADOR (status='draft'): nunca publica el futuro; el
 *   trabajador no ve nada hasta que el gestor publique cada semana.
 * - skipPublished (default true): no pisa semanas destino ya publicadas (las
 *   omite y las reporta). Las que esten en borrador se sobrescriben.
 * - removeApprovedVacations (default true): al copiar, quita de cada celda a los
 *   empleados con vacaciones APROBADAS que cubran la fecha real de ese dia en la
 *   semana destino (cells guarda dia 0-6; la fecha real = lunes destino + dia).
 */
export async function copyScheduleToWeeks(
  locationId: string,
  sourceWeekStart: string,
  targetWeekStarts: string[],
  opts?: { skipPublished?: boolean; removeApprovedVacations?: boolean }
): Promise<CopyScheduleResult | null> {
  if (!supabase) return null;
  const sb = supabase;
  const skipPublished = opts?.skipPublished ?? true;
  const removeVac = opts?.removeApprovedVacations ?? true;

  const source = await getSchedule(locationId, sourceWeekStart);
  if (!source || Object.keys(source.cells || {}).length === 0) {
    return { copied: [], skipped: [], removedForVacation: 0 };
  }
  const sourceCells = source.cells as ScheduleCells;
  const sourceOverrides = (source.coverage_overrides || {}) as CoverageOverrides;

  // Vacaciones aprobadas de los empleados que aparecen en el horario origen,
  // acotadas al rango que cubren las semanas destino.
  const vacByEmp = new Map<string, Array<{ start: string; end: string }>>();
  if (removeVac && targetWeekStarts.length > 0) {
    const empIds = new Set<string>();
    for (const tid of Object.keys(sourceCells)) {
      for (const dk of Object.keys(sourceCells[tid])) {
        for (const id of sourceCells[tid][dk]) empIds.add(id);
      }
    }
    if (empIds.size > 0) {
      const sorted = [...targetWeekStarts].sort();
      const rangeStart = sorted[0];
      const rangeEnd = addDaysISO(sorted[sorted.length - 1], 6);
      const { data: vac } = await sb
        .from('vacations')
        .select('employee_id, start_date, end_date')
        .eq('status', 'aprobada')
        .in('employee_id', Array.from(empIds))
        .lte('start_date', rangeEnd)
        .gte('end_date', rangeStart);
      for (const v of (vac || []) as Array<{ employee_id: string; start_date: string; end_date: string }>) {
        const arr = vacByEmp.get(v.employee_id) || [];
        arr.push({ start: v.start_date, end: v.end_date });
        vacByEmp.set(v.employee_id, arr);
      }
    }
  }

  function onVacation(empId: string, dateISO: string): boolean {
    const ranges = vacByEmp.get(empId);
    if (!ranges) return false;
    return ranges.some((r) => r.start <= dateISO && dateISO <= r.end);
  }

  const result: CopyScheduleResult = { copied: [], skipped: [], removedForVacation: 0 };

  for (const target of targetWeekStarts) {
    if (target === sourceWeekStart) continue; // nunca se copia sobre si misma
    const existing = await getSchedule(locationId, target);
    if (existing && existing.status === 'published' && skipPublished) {
      result.skipped.push(target);
      continue;
    }

    // Construir cells destino, descontando vacaciones por fecha real.
    const newCells: ScheduleCells = {};
    for (const tid of Object.keys(sourceCells)) {
      newCells[tid] = {};
      for (const dk of Object.keys(sourceCells[tid])) {
        const dateISO = addDaysISO(target, Number(dk));
        const ids = sourceCells[tid][dk].filter((id) => {
          if (removeVac && onVacation(id, dateISO)) {
            result.removedForVacation++;
            return false;
          }
          return true;
        });
        newCells[tid][dk] = ids;
      }
    }

    const saved = await upsertSchedule({
      location_id: locationId,
      week_start: target,
      cells: newCells,
      coverage_overrides: sourceOverrides,
      status: 'draft',
      generated_at: new Date().toISOString(),
      published_at: null,
    });
    if (saved) result.copied.push(target);
  }

  return result;
}
