// src/modules/conta/laboral/ficha/fichaService.ts
//
// N1 · PR 2 · Paso 1 (02/11/2026) · La ficha nueva de la persona: lo que lee
// (lab_ficha, 0830) y lo que escribe (la categoría del convenio, la cuenta donde
// cobra y el permiso de Laboral). Todo pasa por funciones de servidor: nadie
// escribe directo en las tablas de Laboral.

import { supabase } from '@/lib/supabase'

/** Un código de un catálogo oficial, ya resuelto: su palabra de la calle y su texto oficial. */
export interface Catalogado {
  codigo: string
  calle: string | null
  oficial: string | null
  vigente?: boolean
  desconocido?: boolean
}

export interface Concepto { codigo: string; nombre: string | null; importe: number; periodicidad: 'mes' | 'paga'; origen: 'convenio' | 'pactado' }
export interface NominaCegid { periodo: string; bruto: number | null; liquido: number | null; coste: number | null; retencion: number | null; base_irpf: number | null }

export interface Ficha {
  privado: boolean
  persona: {
    id: string; nombre: string; foto: string | null; puesto: string | null; activa: boolean
    local: { id: string; nombre: string } | null
    movil: string | null; correo: string | null; portal: boolean
    usuario_id: string | null; con_permiso_laboral: boolean | null
    documento: string | null; nacimiento: string | null; naf: string | null; iban: string | null; domicilio: string | null
    nacionalidad: Catalogado | null; nivel_formativo: null; discapacidad: string | null; de_cegid: boolean
  }
  contrato: null | {
    id: string; numero: string; tipo: Catalogado | null; desde: string | null; hasta: string | null; baja: string | null
    prueba_dias: number | null; antiguedad: string | null; puesto: string | null
    centro: { id: string; nombre: string } | null; cuenta_cotizacion: string | null
    grupo: Catalogado | null; ocupacion: Catalogado | null
    categoria: string | null; categoria_nombre: string | null
    jornada: 'completa' | 'parcial' | null; coef_parcial: number | null; horas_semana: number | null
    bonificaciones: unknown[]
    convenio: null | { codigo: string; nombre: string | null; horas_anuales: number | null; horas_dia: number | null; vacaciones: string | null; paga_13: string | null; paga_14: string | null; cargado: boolean }
    categorias: { categoria: string; nombre: string | null }[]
  }
  salario: null | {
    conceptos: Concepto[]; bruto_mes: number | null; pagas: number
    minimo_convenio: number | null; minimo_porque: 'sin_categoria' | 'sin_convenio' | 'sin_tablas' | null
    nomina_cegid: NominaCegid | null
  }
  irpf: null | {
    pct: number | null; nomina_cegid: NominaCegid | null
    modelo_145: null | { efecto_desde: string; situacion: Catalogado | null; discapacidad: Catalogado | null; firmado_at: string | null; hijos: number; ascendientes: number; tipo_voluntario: number | null }
  }
}

const MENSAJES: Record<string, string> = {
  NO_AUTORIZADO: 'No tienes permiso para esto.',
  SIN_CONVENIO: 'Su contrato no tiene convenio: no hay lista de categorías.',
  CATEGORIA_DESCONOCIDA: 'Esa categoría no está en las tablas de su convenio.',
  IBAN_NO_VALIDO: 'Ese IBAN no es válido: revisa las cifras.',
  NO_ES_DE_LA_CUENTA: 'Solo se da a alguien que entra en esta cuenta.',
}
function mensaje(e: { message?: string } | null): string {
  const m = e?.message ?? ''
  const k = Object.keys(MENSAJES).find((x) => m.includes(x))
  return k ? MENSAJES[k] : `No se ha podido: ${m || 'error sin mensaje'}.`
}

// Las funciones son de la 0830/1937 y aún no están en database.ts. Se llaman como
// método de supabase (con su «this»): suelto, rpc falla antes de salir a la red.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (nombre: string, args: object) => (supabase!.rpc as any)(nombre, args) as Promise<{ data: unknown; error: { message?: string } | null }>

export async function leerFicha(employeeId: string): Promise<Ficha> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await rpc('lab_ficha', { p_employee_id: employeeId })
  if (error) throw new Error(mensaje(error))
  return data as Ficha
}

export async function ponerCategoria(contratoId: string, categoria: string): Promise<{ categoria: string; nombre: string | null; cambia: boolean }> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await rpc('lab_poner_categoria', { p_contrato_id: contratoId, p_categoria: categoria, p_motivo: 'Categoría del convenio, puesta en la ficha' })
  if (error) throw new Error(mensaje(error))
  return data as { categoria: string; nombre: string | null; cambia: boolean }
}

export async function ponerIban(employeeId: string, iban: string): Promise<{ iban: string | null; cambia: boolean }> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await rpc('lab_poner_iban', { p_employee_id: employeeId, p_iban: iban })
  if (error) throw new Error(mensaje(error))
  return data as { iban: string | null; cambia: boolean }
}

export async function cambiarPermisoLaboral(accountId: string, userId: string, dar: boolean): Promise<number> {
  if (!supabase) throw new Error('Sin conexión con la base.')
  const { data, error } = await rpc(dar ? 'lab_dar_permiso' : 'lab_quitar_permiso', { p_account_id: accountId, p_user_id: userId })
  if (error) throw new Error(mensaje(error))
  return Number((data as { con_permiso?: number })?.con_permiso ?? 0)
}
