// src/modules/conta/gestoria/alDia.ts
//
// GD · Clientes y cuotas, al día sin recargar (Julio, nº71; opción (a): Realtime). Cada lectura del CRM o de
// GoCardless —también la que lanza un aviso «al instante»— deja su fila en conta_gestoria_lectura y la cierra
// al acabar. La pantalla escucha solo esa tabla, solo de su cuenta, y cuando una lectura acaba bien vuelve a
// pedir sus datos con sus permisos de siempre: una señal por lectura, no un cambio por cliente.
//
// La seguridad por cuenta va en dos capas: el filtro de la suscripción (account_id de la cuenta abierta) y la
// RLS de la tabla (conta_gestoria_lectura_leer: belongs_to_account), que Realtime aplica a cada suscriptor con
// su sesión. La prueba de staging (20261110_gd_al_dia_prueba.sql) mide la segunda: nadie lee una lectura de
// otra cuenta. Puro: sin red.

export const TABLA_DE_LECTURAS = 'conta_gestoria_lectura'

/** El filtro de la suscripción: solo las lecturas de esta cuenta. */
export const filtroDeLaCuenta = (cuenta: string) => `account_id=eq.${cuenta}`

/** ¿Esta fila (la nueva, de un cambio de conta_gestoria_lectura) pide volver a pedir los datos? */
export function pideRecargar(fila: Record<string, unknown> | null | undefined, cuenta: string): boolean {
  if (!fila || fila.account_id !== cuenta) return false
  return fila.acabada_at != null && fila.estado === 'bien'
}

/** Cuánto se espera a que acaben las lecturas que vienen juntas (CRM y después GoCardless) antes de recargar. */
export const JUNTAR_MS = 1500
