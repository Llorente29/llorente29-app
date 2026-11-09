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
] as const
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
