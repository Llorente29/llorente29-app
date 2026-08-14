// src/modules/multitenancy/services/managerPermissionsService.ts
//
// Service CRUD de manager_permissions. Tabla 1:1 con user_profiles (PK =
// user_profile_id, ON DELETE CASCADE).
//
// REEMPLAZA a src/services/managerPermissionsService.ts (que queda deprecado).
// La migración de imports en App.tsx + StaffPage.tsx + ManagerPermissionsModal.tsx
// se hará en una tarea separada para no avalanchar este bloque.
//
// API pública:
//   Reads:
//     - getPermissions(userProfileId)            → null si no existe (patrón consolidado)
//     - getPermissionsOrDefaults(userProfileId)  → siempre devuelve objeto (compat con viejo)
//     - getPermissionsForUserInAccount(userId, accountId) → resolver desde context
//     - listPermissionsByAccount(accountId)      → todos los managers de una cuenta
//
//   Writes (solo admin de la cuenta, policy manager_permissions_write):
//     - upsertPermissions(userProfileId, patch)  → merge parcial (recomendado)
//     - savePermissions(permissions)             → set total (compat con viejo)
//     - resetPermissions(userProfileId)          → vuelve a defaults
//     - deletePermissions(userProfileId)         → hard delete
//
//   Helpers:
//     - DEFAULT_PERMISSIONS                      → constante con defaults
//     - defaultPermissions()                     → factory que devuelve copia fresca
//
// DIFERENCIAS RESPECTO AL VIEJO (src/services/managerPermissionsService.ts):
//   - Tipos camelCase (ManagerPermissions con userProfileId, showDashboard…) en
//     lugar de snake_case del viejo (user_profile_id, show_dashboard…).
//   - Incluye los 32 booleanos (el viejo solo mapea 27; faltaban showAppccToday,
//     showAppccIncidents, can_manage_employees lo tenía pero algunos callers no;
//     F0.6 sumó canEditSchedule/canApproveVacations).
//   - upsertPermissions admite patch parcial; el viejo saveManagerPermissions
//     exigía el objeto entero.
//   - Errores con throw Error (patrón nuevo) en lugar de { ok, error } (patrón viejo).
//
// Convención de errores: todos los métodos LANZAN Error si falla la query,
// EXCEPTO getPermissionsOrDefaults que tolera errores y devuelve defaults
// (replicando el comportamiento del viejo para no romper UI durante migración).

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'
import type {
  ManagerPermissions,
  ManagerPermissionsPatch,
  RowManagerPermissions,
  RowManagerPermissionsInsert,
  RowManagerPermissionsUpdate,
} from '../../../types/multitenancy'

// ─────────────────────────────────────────────────────────────────────
// Defaults — espejo de los DEFAULT de las columnas en BBDD
// ─────────────────────────────────────────────────────────────────────

/**
 * Defaults para un row de manager_permissions. Coinciden con los DEFAULT
 * de las columnas en BBDD (verificado el 16/05/2026 vía information_schema).
 *
 * Se exporta también como const para compat con código que la importe
 * directamente. Para uso típico, preferir defaultPermissions() que devuelve
 * una copia fresca y evita mutaciones accidentales del singleton.
 */
export const DEFAULT_PERMISSIONS: Omit<ManagerPermissions, 'userProfileId' | 'createdAt' | 'updatedAt'> = {
  showDashboard: true,
  showStaff: true,
  showAhoraMismo: true,
  showFichajesGlobal: true,
  showKioskoFichaje: true,
  showSolicitudesPendientes: true,
  showTurnosAbiertos: true,
  showCambiosPendientes: true,
  showCalendario: true,
  showPlantillaTurnos: true,
  showInformesPersonal: false,
  showBolsaHoras: true,
  showTasks: true,
  showScheduled: true,
  showTemplates: false,
  showIncidents: true,
  showAudits: true,
  showHistory: true,
  showTspoon: true,
  showVentasAnalisis: true,
  showPrediccionPersonal: true,
  showZonasPedido: false,
  showInventory: true,
  showLocations: false,
  showTspoonSettings: false,
  showSalaries: false,
  canManageEmployees: true,
  canEditSchedule: true,
  canApproveVacations: true,
  showAppccToday: false,
  showAppccIncidents: false,
  showRecepcion: true,
  showPedidos: true,
  showProveedores: true,
  showInventarios: true,
  showFacturas: true,
  showCostes: false,
}

/**
 * Devuelve una copia fresca de los defaults. Preferir sobre DEFAULT_PERMISSIONS
 * cuando vayas a mutar el objeto (e.g., spread + override de algunos campos).
 */
export function defaultPermissions(): typeof DEFAULT_PERMISSIONS {
  return { ...DEFAULT_PERMISSIONS }
}

// ─────────────────────────────────────────────────────────────────────
// Plantillas de permisos (ENCARGO CODE 14/08, feat/f0-responsable-de-local,
// B.3) — sustituyen a la tabla `permission_sets` (eliminada, A.1: código
// muerto que declaraba ~40 claves que no eran columna real). Un objeto
// TypeScript, no una tabla: si una plantilla se equivoca de clave, el
// `Omit<..., 'userProfileId'|'createdAt'|'updatedAt'>` de abajo NO COMPILA
// — no puede inventarse un permiso que no existe. Aplicar una plantilla
// escribe las 37 columnas reales de manager_permissions vía savePermissions;
// las casillas siguen siendo editables una a una después (no es una jaula).
//
// Valores aprobados por Julio (14/08, con una ronda de correcciones).
// show_salaries en false en las dos, sin excepción. show_informes_personal
// (gatea Nóminas, además de los informes de fichaje/gestoría — una sola
// clave para las cuatro pantallas, no hay forma de separarlas hoy) en true
// para "Responsable de local" (edita el cuadrante y aprueba vacaciones; no
// ver las horas de su equipo sería incoherente) y en false para "Oficina".
// Plantilla "Solo lectura" retirada por decisión de Julio: el modelo solo
// gatea visibilidad de pantalla, no acciones dentro de ella, y el nombre
// prometía algo que el sistema de permisos no puede garantizar todavía.
//
// Las 6 claves de Supply/Almacén (show_recepcion, show_pedidos,
// show_proveedores, show_inventarios, show_facturas, show_costes) — ver
// ENCARGO CODE 14/08 "claves de Supply" — en true para las dos salvo
// show_costes, que nace en false en las dos y NO entra en el backfill de
// compatibilidad de la migración, mismo criterio que show_salaries.
type PermissionTemplateValues = Omit<ManagerPermissions, 'userProfileId' | 'createdAt' | 'updatedAt'>

export interface PermissionTemplate {
  key: 'responsable_de_local' | 'oficina'
  label: string
  description: string
  values: PermissionTemplateValues
}

export const PERMISSION_TEMPLATES: readonly PermissionTemplate[] = [
  {
    key: 'responsable_de_local',
    label: 'Responsable de local',
    description: 'Operativa diaria de su local: fichajes, cuadrante, tareas, incidencias, inventario. Sin salarios, sin configuración de cuenta.',
    values: {
      showDashboard: true, showStaff: true, showAhoraMismo: true,
      showFichajesGlobal: true, showKioskoFichaje: true, showSolicitudesPendientes: true,
      showTurnosAbiertos: true, showCambiosPendientes: true, showCalendario: true,
      showPlantillaTurnos: true, showInformesPersonal: true, showBolsaHoras: true,
      showTasks: true, showScheduled: true, showTemplates: false,
      showIncidents: true, showAudits: true, showHistory: true,
      showTspoon: false, showVentasAnalisis: false, showPrediccionPersonal: false,
      showZonasPedido: false, showInventory: true, showLocations: false,
      showTspoonSettings: false, showSalaries: false,
      canManageEmployees: false, canEditSchedule: true, canApproveVacations: true,
      showAppccToday: true, showAppccIncidents: true,
      showRecepcion: true, showPedidos: true, showProveedores: true,
      showInventarios: true, showFacturas: true, showCostes: false,
    },
  },
  {
    key: 'oficina',
    label: 'Oficina',
    description: 'Recepción, almacén, informes, análisis de ventas. Sin gestión de personal.',
    values: {
      showDashboard: true, showStaff: false, showAhoraMismo: false,
      showFichajesGlobal: false, showKioskoFichaje: false, showSolicitudesPendientes: false,
      showTurnosAbiertos: false, showCambiosPendientes: false, showCalendario: false,
      showPlantillaTurnos: false, showInformesPersonal: false, showBolsaHoras: false,
      showTasks: false, showScheduled: false, showTemplates: false,
      showIncidents: false, showAudits: false, showHistory: false,
      showTspoon: true, showVentasAnalisis: true, showPrediccionPersonal: false,
      showZonasPedido: true, showInventory: true, showLocations: false,
      showTspoonSettings: false, showSalaries: false,
      canManageEmployees: false, canEditSchedule: false, canApproveVacations: false,
      showAppccToday: false, showAppccIncidents: false,
      showRecepcion: true, showPedidos: true, showProveedores: true,
      showInventarios: true, showFacturas: true, showCostes: false,
    },
  },
] as const

/**
 * Convierte los valores de una plantilla (camelCase, tipo cliente) a las
 * columnas reales de manager_permissions (snake_case) — lo que espera la
 * Edge Function `manage-employee` para escribirlas en el alta atómica de un
 * responsable de local (§4.bis: mismo paso que crear el usuario, no uno
 * aparte). Mismo mapeo campo a campo que managerPermissionsToInsertRow, sin
 * el envoltorio de user_profile_id (el server lo añade él mismo al insertar).
 */
export function permissionTemplateValuesToRow(values: PermissionTemplateValues): Record<string, boolean> {
  return {
    show_dashboard: values.showDashboard,
    show_staff: values.showStaff,
    show_ahora_mismo: values.showAhoraMismo,
    show_fichajes_global: values.showFichajesGlobal,
    show_kiosko_fichaje: values.showKioskoFichaje,
    show_solicitudes_pendientes: values.showSolicitudesPendientes,
    show_turnos_abiertos: values.showTurnosAbiertos,
    show_cambios_pendientes: values.showCambiosPendientes,
    show_calendario: values.showCalendario,
    show_plantilla_turnos: values.showPlantillaTurnos,
    show_informes_personal: values.showInformesPersonal,
    show_bolsa_horas: values.showBolsaHoras,
    show_tasks: values.showTasks,
    show_scheduled: values.showScheduled,
    show_templates: values.showTemplates,
    show_incidents: values.showIncidents,
    show_audits: values.showAudits,
    show_history: values.showHistory,
    show_tspoon: values.showTspoon,
    show_ventas_analisis: values.showVentasAnalisis,
    show_prediccion_personal: values.showPrediccionPersonal,
    show_zonas_pedido: values.showZonasPedido,
    show_inventory: values.showInventory,
    show_locations: values.showLocations,
    show_tspoon_settings: values.showTspoonSettings,
    show_salaries: values.showSalaries,
    can_manage_employees: values.canManageEmployees,
    can_edit_schedule: values.canEditSchedule,
    can_approve_vacations: values.canApproveVacations,
    show_appcc_today: values.showAppccToday,
    show_appcc_incidents: values.showAppccIncidents,
    show_recepcion: values.showRecepcion,
    show_pedidos: values.showPedidos,
    show_proveedores: values.showProveedores,
    show_inventarios: values.showInventarios,
    show_facturas: values.showFacturas,
    show_costes: values.showCostes,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Mappers (BBDD snake_case ↔ dominio camelCase)
// ─────────────────────────────────────────────────────────────────────

// NOTA: rowToManagerPermissions exportado para tests.
//
// Normalización: showAppccToday y showAppccIncidents son nullable en BBDD
// (default false). En cliente los tratamos como boolean no nullable: null → false.
export function rowToManagerPermissions(row: RowManagerPermissions): ManagerPermissions {
  return {
    userProfileId: row.user_profile_id,
    showDashboard: row.show_dashboard,
    showStaff: row.show_staff,
    showAhoraMismo: row.show_ahora_mismo,
    showFichajesGlobal: row.show_fichajes_global,
    showKioskoFichaje: row.show_kiosko_fichaje,
    showSolicitudesPendientes: row.show_solicitudes_pendientes,
    showTurnosAbiertos: row.show_turnos_abiertos,
    showCambiosPendientes: row.show_cambios_pendientes,
    showCalendario: row.show_calendario,
    showPlantillaTurnos: row.show_plantilla_turnos,
    showInformesPersonal: row.show_informes_personal,
    showBolsaHoras: row.show_bolsa_horas,
    showTasks: row.show_tasks,
    showScheduled: row.show_scheduled,
    showTemplates: row.show_templates,
    showIncidents: row.show_incidents,
    showAudits: row.show_audits,
    showHistory: row.show_history,
    showTspoon: row.show_tspoon,
    showVentasAnalisis: row.show_ventas_analisis,
    showPrediccionPersonal: row.show_prediccion_personal,
    showZonasPedido: row.show_zonas_pedido,
    showInventory: row.show_inventory,
    showLocations: row.show_locations,
    showTspoonSettings: row.show_tspoon_settings,
    showSalaries: row.show_salaries,
    canManageEmployees: row.can_manage_employees,
    canEditSchedule: row.can_edit_schedule,
    canApproveVacations: row.can_approve_vacations,
    showAppccToday: row.show_appcc_today ?? false,
    showAppccIncidents: row.show_appcc_incidents ?? false,
    showRecepcion: row.show_recepcion,
    showPedidos: row.show_pedidos,
    showProveedores: row.show_proveedores,
    showInventarios: row.show_inventarios,
    showFacturas: row.show_facturas,
    showCostes: row.show_costes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Construye un row Insert/Update completo a partir de un ManagerPermissions
 * en memoria. Usado por savePermissions (set total) y upsertPermissions
 * tras hacer el merge con defaults/existente.
 */
function managerPermissionsToInsertRow(
  userProfileId: string,
  perms: Omit<ManagerPermissions, 'userProfileId' | 'createdAt' | 'updatedAt'>
): RowManagerPermissionsInsert {
  return {
    user_profile_id: userProfileId,
    show_dashboard: perms.showDashboard,
    show_staff: perms.showStaff,
    show_ahora_mismo: perms.showAhoraMismo,
    show_fichajes_global: perms.showFichajesGlobal,
    show_kiosko_fichaje: perms.showKioskoFichaje,
    show_solicitudes_pendientes: perms.showSolicitudesPendientes,
    show_turnos_abiertos: perms.showTurnosAbiertos,
    show_cambios_pendientes: perms.showCambiosPendientes,
    show_calendario: perms.showCalendario,
    show_plantilla_turnos: perms.showPlantillaTurnos,
    show_informes_personal: perms.showInformesPersonal,
    show_bolsa_horas: perms.showBolsaHoras,
    show_tasks: perms.showTasks,
    show_scheduled: perms.showScheduled,
    show_templates: perms.showTemplates,
    show_incidents: perms.showIncidents,
    show_audits: perms.showAudits,
    show_history: perms.showHistory,
    show_tspoon: perms.showTspoon,
    show_ventas_analisis: perms.showVentasAnalisis,
    show_prediccion_personal: perms.showPrediccionPersonal,
    show_zonas_pedido: perms.showZonasPedido,
    show_inventory: perms.showInventory,
    show_locations: perms.showLocations,
    show_tspoon_settings: perms.showTspoonSettings,
    show_salaries: perms.showSalaries,
    can_manage_employees: perms.canManageEmployees,
    can_edit_schedule: perms.canEditSchedule,
    can_approve_vacations: perms.canApproveVacations,
    show_appcc_today: perms.showAppccToday,
    show_appcc_incidents: perms.showAppccIncidents,
    show_recepcion: perms.showRecepcion,
    show_pedidos: perms.showPedidos,
    show_proveedores: perms.showProveedores,
    show_inventarios: perms.showInventarios,
    show_facturas: perms.showFacturas,
    show_costes: perms.showCostes,
  }
}

/**
 * Convierte un patch parcial camelCase a snake_case para .update().
 * Solo incluye los campos presentes en el patch.
 */
function patchToUpdateRow(patch: ManagerPermissionsPatch): RowManagerPermissionsUpdate {
  const row: RowManagerPermissionsUpdate = {}
  if (patch.showDashboard !== undefined) row.show_dashboard = patch.showDashboard
  if (patch.showStaff !== undefined) row.show_staff = patch.showStaff
  if (patch.showAhoraMismo !== undefined) row.show_ahora_mismo = patch.showAhoraMismo
  if (patch.showFichajesGlobal !== undefined) row.show_fichajes_global = patch.showFichajesGlobal
  if (patch.showKioskoFichaje !== undefined) row.show_kiosko_fichaje = patch.showKioskoFichaje
  if (patch.showSolicitudesPendientes !== undefined) row.show_solicitudes_pendientes = patch.showSolicitudesPendientes
  if (patch.showTurnosAbiertos !== undefined) row.show_turnos_abiertos = patch.showTurnosAbiertos
  if (patch.showCambiosPendientes !== undefined) row.show_cambios_pendientes = patch.showCambiosPendientes
  if (patch.showCalendario !== undefined) row.show_calendario = patch.showCalendario
  if (patch.showPlantillaTurnos !== undefined) row.show_plantilla_turnos = patch.showPlantillaTurnos
  if (patch.showInformesPersonal !== undefined) row.show_informes_personal = patch.showInformesPersonal
  if (patch.showBolsaHoras !== undefined) row.show_bolsa_horas = patch.showBolsaHoras
  if (patch.showTasks !== undefined) row.show_tasks = patch.showTasks
  if (patch.showScheduled !== undefined) row.show_scheduled = patch.showScheduled
  if (patch.showTemplates !== undefined) row.show_templates = patch.showTemplates
  if (patch.showIncidents !== undefined) row.show_incidents = patch.showIncidents
  if (patch.showAudits !== undefined) row.show_audits = patch.showAudits
  if (patch.showHistory !== undefined) row.show_history = patch.showHistory
  if (patch.showTspoon !== undefined) row.show_tspoon = patch.showTspoon
  if (patch.showVentasAnalisis !== undefined) row.show_ventas_analisis = patch.showVentasAnalisis
  if (patch.showPrediccionPersonal !== undefined) row.show_prediccion_personal = patch.showPrediccionPersonal
  if (patch.showZonasPedido !== undefined) row.show_zonas_pedido = patch.showZonasPedido
  if (patch.showInventory !== undefined) row.show_inventory = patch.showInventory
  if (patch.showLocations !== undefined) row.show_locations = patch.showLocations
  if (patch.showTspoonSettings !== undefined) row.show_tspoon_settings = patch.showTspoonSettings
  if (patch.showSalaries !== undefined) row.show_salaries = patch.showSalaries
  if (patch.canManageEmployees !== undefined) row.can_manage_employees = patch.canManageEmployees
  if (patch.canEditSchedule !== undefined) row.can_edit_schedule = patch.canEditSchedule
  if (patch.canApproveVacations !== undefined) row.can_approve_vacations = patch.canApproveVacations
  if (patch.showAppccToday !== undefined) row.show_appcc_today = patch.showAppccToday
  if (patch.showAppccIncidents !== undefined) row.show_appcc_incidents = patch.showAppccIncidents
  if (patch.showRecepcion !== undefined) row.show_recepcion = patch.showRecepcion
  if (patch.showPedidos !== undefined) row.show_pedidos = patch.showPedidos
  if (patch.showProveedores !== undefined) row.show_proveedores = patch.showProveedores
  if (patch.showInventarios !== undefined) row.show_inventarios = patch.showInventarios
  if (patch.showFacturas !== undefined) row.show_facturas = patch.showFacturas
  if (patch.showCostes !== undefined) row.show_costes = patch.showCostes
  return row
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function requireSupabase(): void {
  if (!isSupabaseEnabled || !supabase) {
    throw new Error(
      'Supabase no está configurado. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en .env.'
    )
  }
}

// ─────────────────────────────────────────────────────────────────────
// READS
// ─────────────────────────────────────────────────────────────────────

/**
 * Obtiene los permisos de un user_profile. Devuelve null si no existe o RLS lo oculta.
 *
 * Para casos donde necesitas "siempre un objeto" (UI legacy), usa
 * getPermissionsOrDefaults en su lugar.
 */
export async function getPermissions(
  userProfileId: string
): Promise<ManagerPermissions | null> {
  requireSupabase()
  const { data, error } = await supabase!
    .from('manager_permissions')
    .select('*')
    .eq('user_profile_id', userProfileId)
    .maybeSingle()

  if (error) {
    throw new Error(`Error obteniendo permisos de ${userProfileId}: ${error.message}`)
  }
  return data ? rowToManagerPermissions(data) : null
}

/**
 * Obtiene los permisos de un user_profile, devolviendo defaults si no existe
 * o si la query falla. Compatibilidad con el patrón del service viejo.
 *
 * Usar SOLO cuando la UI no pueda manejar `null`. Para código nuevo, preferir
 * getPermissions + manejar el null explícitamente.
 */
export async function getPermissionsOrDefaults(
  userProfileId: string
): Promise<ManagerPermissions> {
  const fallback: ManagerPermissions = {
    userProfileId,
    ...defaultPermissions(),
    createdAt: null,
    updatedAt: null,
  }

  if (!isSupabaseEnabled || !supabase) {
    return fallback
  }

  try {
    const result = await getPermissions(userProfileId)
    return result ?? fallback
  } catch (err) {
    console.error('[managerPermissionsService] getPermissionsOrDefaults fallback:', err)
    return fallback
  }
}

/**
 * Resuelve los permisos del user logueado en una cuenta concreta.
 *
 * Caso de uso: AppContext al cambiar de cuenta activa.
 * Hace 2 queries (resolver user_profile + leer permisos) porque RLS sobre
 * manager_permissions ya valida el join contra user_profiles.
 *
 * Devuelve null si:
 *   - El user no tiene perfil en esa cuenta, o
 *   - No tiene fila en manager_permissions (perfil sin permisos seedeados aún)
 */
export async function getPermissionsForUserInAccount(
  userId: string,
  accountId: string
): Promise<ManagerPermissions | null> {
  requireSupabase()

  const { data: profile, error: profileError } = await supabase!
    .from('user_profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (profileError) {
    throw new Error(
      `Error resolviendo perfil de user ${userId} en cuenta ${accountId}: ${profileError.message}`
    )
  }
  if (!profile) return null

  return getPermissions(profile.id)
}

/**
 * Lista todos los manager_permissions de una cuenta (join con user_profiles).
 *
 * Caso de uso: pantalla admin "Permisos de managers" de una cuenta.
 */
export async function listPermissionsByAccount(
  accountId: string
): Promise<ManagerPermissions[]> {
  requireSupabase()

  const { data: profiles, error: profilesError } = await supabase!
    .from('user_profiles')
    .select('id')
    .eq('account_id', accountId)

  if (profilesError) {
    throw new Error(
      `Error listando perfiles de cuenta ${accountId}: ${profilesError.message}`
    )
  }
  if (!profiles || profiles.length === 0) return []

  const profileIds = profiles.map((p) => p.id)

  const { data, error } = await supabase!
    .from('manager_permissions')
    .select('*')
    .in('user_profile_id', profileIds)

  if (error) {
    throw new Error(`Error listando permisos de cuenta ${accountId}: ${error.message}`)
  }
  return (data ?? []).map(rowToManagerPermissions)
}

// ─────────────────────────────────────────────────────────────────────
// WRITES
// ─────────────────────────────────────────────────────────────────────

/**
 * Upsert con patch parcial. Comportamiento:
 *   - Si NO existe fila para user_profile_id: la crea con defaults + patch aplicado.
 *   - Si existe: aplica solo los campos del patch (preserva el resto).
 *
 * Esta es la operación recomendada para la mayoría de casos. Conserva los
 * permisos no tocados sin necesidad de leer + escribir desde la UI.
 */
export async function upsertPermissions(
  userProfileId: string,
  patch: ManagerPermissionsPatch
): Promise<ManagerPermissions> {
  requireSupabase()

  const existing = await getPermissions(userProfileId)

  // Caso 1: ya existe — UPDATE solo de los campos del patch.
  if (existing) {
    const updateRow = patchToUpdateRow(patch)
    if (Object.keys(updateRow).length === 0) {
      return existing
    }
    const { data, error } = await supabase!
      .from('manager_permissions')
      .update(updateRow)
      .eq('user_profile_id', userProfileId)
      .select('*')
      .single()

    if (error) {
      throw new Error(`Error actualizando permisos de ${userProfileId}: ${error.message}`)
    }
    return rowToManagerPermissions(data)
  }

  // Caso 2: no existe — INSERT con defaults + patch superpuesto.
  const merged = { ...defaultPermissions(), ...patch }
  const insertRow = managerPermissionsToInsertRow(userProfileId, merged)

  const { data, error } = await supabase!
    .from('manager_permissions')
    .insert(insertRow)
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error creando permisos de ${userProfileId}: ${error.message}`)
  }
  return rowToManagerPermissions(data)
}

/**
 * Guarda los permisos completos (set total). Compat con saveManagerPermissions del viejo.
 *
 * Sobrescribe TODOS los campos. Útil cuando la UI tiene el objeto entero
 * en memoria (e.g., ManagerPermissionsModal del viejo).
 *
 * Para actualizaciones parciales preferir upsertPermissions.
 */
export async function savePermissions(
  permissions: Omit<ManagerPermissions, 'createdAt' | 'updatedAt'>
): Promise<ManagerPermissions> {
  requireSupabase()

  const { userProfileId, ...perms } = permissions
  const insertRow = managerPermissionsToInsertRow(userProfileId, perms)

  const { data, error } = await supabase!
    .from('manager_permissions')
    .upsert(insertRow, { onConflict: 'user_profile_id' })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Error guardando permisos de ${userProfileId}: ${error.message}`)
  }
  return rowToManagerPermissions(data)
}

/**
 * Restaura los permisos a sus valores por defecto.
 */
export async function resetPermissions(
  userProfileId: string
): Promise<ManagerPermissions> {
  return savePermissions({
    userProfileId,
    ...defaultPermissions(),
  })
}

/**
 * Elimina el row de permisos. HARD DELETE.
 *
 * No es estrictamente necesario llamarlo: si se borra el user_profile,
 * el row de permisos se va con él por ON DELETE CASCADE. Existe por
 * simetría con el resto de services y para casos administrativos.
 */
export async function deletePermissions(userProfileId: string): Promise<void> {
  requireSupabase()
  const { error } = await supabase!
    .from('manager_permissions')
    .delete()
    .eq('user_profile_id', userProfileId)

  if (error) {
    throw new Error(`Error eliminando permisos de ${userProfileId}: ${error.message}`)
  }
}
