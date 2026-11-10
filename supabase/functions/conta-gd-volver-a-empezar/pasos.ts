// supabase/functions/conta-gd-volver-a-empezar/pasos.ts
//
// GD · «Volver a empezar»: los pasos, en orden, y la puerta. Puro: lo usan la
// función y la pantalla (Ajustes › Tu cuenta), y sus pruebas
// (tests/unit/modules/conta/gd/volverAEmpezar.test.ts).
//
// Cada paso es una llamada: así ninguno se acerca al límite de tiempo de una
// función (Bitrix24 deja 2 peticiones por segundo) y la pantalla dice por cuál va.

export const PASOS = [
  { id: 'portal_borrar', que: 'Vaciando el Bitrix24 de pruebas' },
  { id: 'portal_sembrar', que: 'Sembrando los 40 clientes en el Bitrix24 de pruebas' },
  { id: 'sandbox_borrar', que: 'Vaciando el sandbox de GoCardless' },
  { id: 'sandbox_sembrar', que: 'Sembrando clientes, mandatos y suscripciones en el sandbox' },
  { id: 'sumied', que: 'Dejando Sumied como el primer día' },
  { id: 'leer', que: 'Leyendo otra vez el CRM y GoCardless' },
  { id: 'tarifa', que: 'Sembrando la tarifa y los ingresos en el banco' },
  { id: 'cambios', que: 'Dejando los cambios del mes que viene' },
] as const
/** Lo que hace como mucho cada llamada de un paso por tandas (el portal): muy por debajo del tiempo máximo de una función. */
export const PRESUPUESTO_MS = 90_000
/** Cuántas veces se repite como mucho un paso por tandas antes de darlo por atascado. */
export const TANDAS_MAX = 8

export type Paso = (typeof PASOS)[number]['id'] | 'comprobar'
export const esPaso = (x: unknown): x is Paso => x === 'comprobar' || PASOS.some((p) => p.id === x)

export interface Puerta {
  esDemo: boolean
  esAdmin: boolean
  /** El portal de la conexión de CRM de la cuenta, si tiene. */
  portalCrm: string | null
  /** El entorno de cada conexión de GoCardless de la cuenta. */
  entornosGc: string[]
  /** Qué secretos de la función faltan (por nombre, nunca su valor). */
  faltan: string[]
}

/** ¿Se puede volver a empezar? Null si sí; si no, el porqué, dicho para quien pulsa. */
export function porqueNo(p: Puerta, portalDePruebas: string): string | null {
  if (!p.esDemo) return 'Solo una cuenta de demostración puede volver a empezar.'
  if (!p.esAdmin) return 'Solo un administrador de la cuenta puede volver a empezar.'
  if (p.portalCrm !== null && p.portalCrm !== portalDePruebas) return `El CRM de esta cuenta es ${p.portalCrm}, no el portal de pruebas (${portalDePruebas}): no se toca.`
  if (p.entornosGc.some((e) => e !== 'pruebas')) return 'Esta cuenta tiene un GoCardless que no es el de pruebas: no se toca.'
  if (p.faltan.length) return `Faltan los secretos ${p.faltan.join(' y ')} en las funciones: los pega Julio.`
  return null
}

/**
 * Desde cuándo cuentan las cuotas mensuales de la demo (nº63). El sandbox crea las suscripciones nuevas, así que
 * GoCardless las da por empezadas en su primer cargo (el mes que viene) y la lectura crea sus líneas «desde» ese mes:
 * hasta entonces, «Tarifa y paquetes» dice «Ningún cliente» en todo y el cobro no tiene con qué comparar. Los clientes
 * de la demo son de antes: sus cuotas mensuales empiezan en enero del año en curso (hora de Madrid).
 */
export function inicioDeLasCuotas(hoyMadrid: string): string {
  return `${hoyMadrid.slice(0, 4)}-01-01`
}

/**
 * Los cambios que el cobro del mes que viene tiene que enseñar (nº68, como la maqueta). Se hacen con las mismas
 * funciones que la ficha del cliente, con la sesión de quien pulsa:
 *   · Talleres Ruiz: +1 trabajador en Gestión laboral, alta el día 1 del mes que viene (nº76: con la regla del mes
 *     entero, un alta a mitad de este mes ya se cobraría este mes y el cobro del que viene no la enseñaría como cambio).
 *   · Imprenta Rápida Sol: de Básica a Premium desde el mes que viene (sube más de un 30 %: pide «Lo he mirado, aprobar»).
 *   · Reformas Atalaya: baja de un trabajador, que se cobra este mes y ya no el que viene (para «Este mes no»).
 */
export const CAMBIOS_DEL_MES = {
  alta: { cliente: 'Talleres Ruiz, S.L.', trabajador: 'LUCAS FERRER GIL' },
  nivel: { cliente: 'Imprenta Rápida Sol, S.L.', nivel: 'Premium' },
  baja: { cliente: 'Reformas Atalaya, S.L.' },
} as const

/** Las fechas de esos cambios, a partir de hoy (AAAA-MM-DD, en Madrid): el alta y el nivel, el 1 del mes que viene; la baja, este mes. */
export function fechasDeLosCambios(hoyMadrid: string): { altaEl: string; esteMes: string; mesQueViene: string } {
  const [a, m] = hoyMadrid.slice(0, 7).split('-').map(Number)
  const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
  return { altaEl: `${sig}-01`, esteMes: `${hoyMadrid.slice(0, 7)}-01`, mesQueViene: `${sig}-01` }
}
