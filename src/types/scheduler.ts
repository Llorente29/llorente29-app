// src/types/scheduler.ts
// Sub-fase 3.1 — tipos del módulo de calendario de horarios

/* =====================================================
   Catálogo de turnos del local
   ===================================================== */

export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0=lun ... 6=dom

export interface ShiftTemplate {
  id: string;
  location_id: string;
  label: string;
  start_time: string; // "HH:MM"
  end_time: string;   // "HH:MM"  (puede ser < start_time si cruza medianoche)
  coverage_mon: number;
  coverage_tue: number;
  coverage_wed: number;
  coverage_thu: number;
  coverage_fri: number;
  coverage_sat: number;
  coverage_sun: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

/* =====================================================
   Disponibilidad / descansos del empleado
   ===================================================== */

export type ShiftPeriod = 'morning' | 'evening' | 'any';

export interface EmployeeAvailability {
  id: string;
  employee_id: string;
  day_of_week: DayOfWeek;
  shift_period: ShiftPeriod;
  available: boolean; // false = NO entra esa franja ese día
  note?: string;
  created_at?: string;
}

/* =====================================================
   Matriz de turnos de la semana
   ===================================================== */

// Por cada turno, por cada día (0..6), lista de empleados asignados
export type ScheduleCells = {
  [templateId: string]: {
    [dayOfWeek: string]: string[]; // employee_ids
  };
};

// Sobrescritura puntual del nº de personas necesarias para esta semana
export type CoverageOverrides = {
  [templateId: string]: {
    [dayOfWeek: string]: number;
  };
};

export type ScheduleStatus = 'draft' | 'published';

export interface Schedule {
  id: string;
  location_id: string;
  week_start: string;          // "YYYY-MM-DD" (siempre lunes)
  cells: ScheduleCells;
  coverage_overrides: CoverageOverrides;
  status: ScheduleStatus;
  generated_at?: string | null;
  published_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/* =====================================================
   Resultado del generador (no se persiste tal cual)
   ===================================================== */

export interface UncoveredSlot {
  template_id: string;
  template_label: string;
  day_of_week: DayOfWeek;
  needed: number;
  assigned: number;
  reason: string; // "sin empleados disponibles", "todos al máximo de horas", etc.
}

export interface EmployeeWorkload {
  employee_id: string;
  employee_name: string;
  shift_code?: string;
  contracted_hours: number;
  assigned_hours: number;
  delta: number; // assigned - contracted
}

export interface GeneratorResult {
  cells: ScheduleCells;
  uncovered: UncoveredSlot[];
  workloads: EmployeeWorkload[];
  warnings: string[];
}

/* =====================================================
   Helpers de cálculo de horas
   ===================================================== */

/**
 * Devuelve la duración en horas de un turno, manejando cruce de medianoche.
 * "12:30" → "16:45"  = 4.25
 * "19:45" → "00:15"  = 4.5  (cruce)
 * "19:45" → "02:45"  = 7    (cruce)
 */
export function shiftDurationHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60; // cruce de medianoche
  return Math.round(((endMin - startMin) / 60) * 100) / 100;
}

/**
 * Determina si un turno es "morning" o "evening" según su entrada.
 */
export function periodOfShift(start: string): ShiftPeriod {
  const [h] = start.split(':').map(Number);
  return h < 17 ? 'morning' : 'evening';
}

/**
 * Lunes de la semana ISO de una fecha (local time).
 */
export function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=dom, 1=lun ... 6=sab
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Acceso tipado a la cobertura del template para un día concreto.
 */
export function coverageForDay(t: ShiftTemplate, day: DayOfWeek): number {
  switch (day) {
    case 0: return t.coverage_mon;
    case 1: return t.coverage_tue;
    case 2: return t.coverage_wed;
    case 3: return t.coverage_thu;
    case 4: return t.coverage_fri;
    case 5: return t.coverage_sat;
    case 6: return t.coverage_sun;
  }
}

export const DAY_LABELS: Record<DayOfWeek, string> = {
  0: 'Lunes',
  1: 'Martes',
  2: 'Miércoles',
  3: 'Jueves',
  4: 'Viernes',
  5: 'Sábado',
  6: 'Domingo',
};

export const DAY_LABELS_SHORT: Record<DayOfWeek, string> = {
  0: 'Lun',
  1: 'Mar',
  2: 'Mié',
  3: 'Jue',
  4: 'Vie',
  5: 'Sáb',
  6: 'Dom',
};
