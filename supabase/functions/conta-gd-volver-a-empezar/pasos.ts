// supabase/functions/conta-gd-volver-a-empezar/pasos.ts
//
// GD · «Volver a empezar»: los pasos, en orden, y la puerta. Puro: lo usan la
// función y la pantalla (Ajustes › Tu cuenta), y sus pruebas
// (tests/unit/modules/conta/gd/volverAEmpezar.test.ts).
//
// Cada paso es una llamada: así ninguno se acerca al límite de tiempo de una
// función (Bitrix24 deja 2 peticiones por segundo) y la pantalla dice por cuál va.
// Los que van por tandas (el portal y «sumied») dicen «sigue» mientras les quede algo.

export const PASOS = [
  { id: 'portal_borrar', que: 'Vaciando el Bitrix24 de pruebas' },
  { id: 'portal_sembrar', que: 'Sembrando los 40 clientes en el Bitrix24 de pruebas' },
  { id: 'sandbox_borrar', que: 'Vaciando el sandbox de GoCardless' },
  { id: 'sandbox_sembrar', que: 'Sembrando clientes, mandatos y suscripciones en el sandbox' },
  { id: 'sumied', que: 'Dejando Sumied como el primer día' },
  { id: 'leer', que: 'Leyendo otra vez el CRM y GoCardless' },
  { id: 'tarifa', que: 'Sembrando la tarifa y los ingresos en el banco' },
  { id: 'historia', que: 'Sembrando la historia de cobros de Talleres Ruiz' },
  { id: 'cambios', que: 'Dejando los cambios del mes del cobro' },
  { id: 'portal', que: 'Dejando el portal de la demo preparado' },
] as const
/** Lo que hace como mucho cada llamada de un paso por tandas (el portal): muy por debajo del tiempo máximo de una función. */
export const PRESUPUESTO_MS = 90_000
/**
 * Lo que borra como mucho cada tanda del paso «sumied» (nº84). La base corta cualquier llamada de la plataforma a
 * los 8 s (el 10/11, vaciar la demo de una vez tardó más y se cortó): con 4 s, cada tanda queda lejos del corte.
 */
export const SUMIED_MS = 4_000
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
 * Los cambios que tiene que enseñar el cobro de la demo (nº68, como la maqueta). nº100: la demo cobra el MES EN
 * CURSO (antes, el siguiente: el portal decía «Diciembre · cobrado el 10 de noviembre»), así que los cambios son de
 * este mes frente al anterior. Se hacen con las mismas funciones que la ficha del cliente, con la sesión de quien pulsa:
 *   · Talleres Ruiz: +1 trabajador en Gestión laboral, alta el día 1 de este mes (con la regla del mes entero, se
 *     cobra entero este mes y el cobro lo enseña como cambio).
 *   · Imprenta Rápida Sol: de Básica a Premium desde este mes (sube más de un 30 %: pide «Lo he mirado, aprobar»).
 *   · Reformas Atalaya: baja de un trabajador, cobrada por última vez el mes pasado: este mes ya no (y «Este mes no»).
 */
export const CAMBIOS_DEL_MES = {
  alta: { cliente: 'Talleres Ruiz, S.L.', trabajador: 'LUCAS FERRER GIL' },
  nivel: { cliente: 'Imprenta Rápida Sol, S.L.', nivel: 'Premium' },
  baja: { cliente: 'Reformas Atalaya, S.L.' },
} as const

/** El mes del cobro de la demo (AAAA-MM): el mes en curso, en Madrid (nº100). */
export const mesDelCobro = (hoyMadrid: string): string => hoyMadrid.slice(0, 7)
/** El mes siguiente (AAAA-MM): el del recibo que queda preparado, sin enviar, para «Tu próximo recibo» (nº100). */
export function mesSiguiente(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

/** Las fechas de esos cambios (AAAA-MM-DD, en Madrid): el alta y el nivel, el 1 de este mes; la baja, el mes pasado. */
export function fechasDeLosCambios(hoyMadrid: string): { altaEl: string; nivelDesde: string; bajaHasta: string } {
  const [a, m] = hoyMadrid.slice(0, 7).split('-').map(Number)
  const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
  const este = `${hoyMadrid.slice(0, 7)}-01`
  return { altaEl: este, nivelDesde: este, bajaHasta: `${ant}-01` }
}

/**
 * nº94 y nº98 · El portal de la demo después de «Volver a empezar»: lo que deja «Preparar el portal de la demo»
 * (conta_portal_demo_preparar, de Code 3: el acceso de Tomás Ruiz para Talleres Ruiz) y, además, el de Felipe Herrera
 * para Electricidad Voltio, que sale devuelto en cada cobro: así el portal enseña un devuelto que se paga (escena 11 del
 * vídeo). Cada uno, listo para entrar con su usuario. Datos inventados (correos de .example).
 */
export const PORTAL_DE_LA_DEMO = { cliente: 'Talleres Ruiz, S.L.', persona: 'Tomás Ruiz', correo: 'tomas.ruiz@talleresruiz.example' } as const
export const PORTAL_DEL_DEVUELTO = { cliente: 'Electricidad Voltio, S.L.', persona: 'Felipe Herrera', correo: 'felipe.herrera@electricidadvoltio.example' } as const
export const ACCESOS_DE_LA_DEMO = [PORTAL_DE_LA_DEMO, PORTAL_DEL_DEVUELTO] as const

/**
 * nº101 · La historia de Talleres Ruiz: los cuatro meses antes del cobro en curso (de julio a octubre, si se cobra
 * noviembre), cada uno con la cadena entera: el recibo, su factura (la misma función que un cobro confirmado), el cobro,
 * su liquidación y el ingreso en el banco, casado y validado. Así su 430 queda saldada y la 57200002 solo con la
 * comisión. El mes en curso no: ése es el cobro que se hace en vivo. Su recibo, el de entonces: la gestoría mensual
 * Premium (150 €) y la gestión laboral de sus tres trabajadores (25 € cada uno), 225,00 € con IVA, como en GoCardless.
 */
export const HISTORIA = { cliente: 'Talleres Ruiz, S.L.', meses: 4, mensual: { concepto: 'Gestoría mensual · Premium', cent: 15000 }, porTrabajadorCent: 2500, ivaPct: 21 } as const

export interface MesDeHistoria {
  mes: string; cargoEl: string; llegada: string; cobroGc: string; payoutGc: string; referencia: string
  totalCent: number; comisionCent: number; netoCent: number
  factura: { lineas: unknown[]; baseCent: number; ivaCent: number; totalCent: number; retencionCent: 0; cuotaAjustada: null; hoja: [] }
}

/** La línea de un recibo con IVA incluido: su base por unidad redondeada y el IVA, lo que falta hasta el total. */
function lineaConIva(concepto: string, cantidad: number, unidadCent: number, ivaPct: number, trabajadores: string[] | null) {
  const precioCent = Math.round(unidadCent / (1 + ivaPct / 100))
  const baseCent = precioCent * cantidad
  const ivaCent = unidadCent * cantidad - baseCent
  return { concepto, cantidad, precioCent, baseCent, ivaPct, ivaCent,
    trabajadores: trabajadores ? trabajadores.map((nombre) => ({ nombre, desde: null })) : null, trabajadoresEn: trabajadores ? 'linea' : null }
}

/** Los meses de la historia, en orden, con su recibo, su cargo (día 5), su liquidación (día 7) y la comisión (1 % + 0,25 €). */
export function historiaDeTalleres(hoyMadrid: string, trabajadores: string[]): MesDeHistoria[] {
  const [a, m] = hoyMadrid.slice(0, 7).split('-').map(Number)
  const out: MesDeHistoria[] = []
  for (let k = HISTORIA.meses; k >= 1; k--) {
    const d = new Date(Date.UTC(a, m - 1 - k, 1))
    const mes = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const lineas = [
      lineaConIva(`Gestión laboral · ${trabajadores.length} trabajadores`, trabajadores.length, HISTORIA.porTrabajadorCent, HISTORIA.ivaPct, trabajadores),
      lineaConIva(HISTORIA.mensual.concepto, 1, HISTORIA.mensual.cent, HISTORIA.ivaPct, null),
    ]
    const baseCent = lineas.reduce((t, l) => t + l.baseCent, 0)
    const ivaCent = lineas.reduce((t, l) => t + l.ivaCent, 0)
    const totalCent = baseCent + ivaCent
    const comisionCent = Math.round(totalCent / 100) + 25
    const id = mes.replace('-', '')
    out.push({ mes, cargoEl: `${mes}-05`, llegada: `${mes}-07`, cobroGc: `PM00GDHIST${id}`, payoutGc: `PO00GDHIST${id}`, referencia: `GD-HIST-${id}`,
      totalCent, comisionCent, netoCent: totalCent - comisionCent,
      factura: { lineas, baseCent, ivaCent, totalCent, retencionCent: 0, cuotaAjustada: null, hoja: [] } })
  }
  return out
}
