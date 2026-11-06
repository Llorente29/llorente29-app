// supabase/functions/conta-gocardless-leer/conversion.ts
//
// G01 · Tarea 2 (06/11/2026). Las suscripciones de GoCardless de hoy se
// importan UNA vez y se convierten en lo que Sumied guarda de cada cliente:
//
//   · el SERVICIO (catálogo por emisor): cada concepto es un servicio, con su
//     forma de cobrarse. «GESTORIA MENSUAL…» es la gestoría mensual; «GESTION
//     LABORAL <empleado>», la laboral por empleado; cualquier otro concepto
//     («SERVICIOS MENSUALES…», «VIGILANCIA DE…») es un servicio con su nombre
//     literal, fijo al mes (o al año, si la suscripción es anual), hasta que
//     la gestoría diga qué es.
//   · la LÍNEA del cliente: una por suscripción (servicio y detalle: la
//     sociedad o el empleado). Las de laboral son las líneas de empleado, con
//     origen «gocardless» y el hueco para el empleado de Laboral (fase 2).
//   · la TARIFA propia del cliente por servicio y emisor: el importe que más
//     se repite entre sus líneas de ese servicio. Una línea con otro importe
//     lleva su importe propio, para que la suma sea la de hoy.
//
// Lo que no se convierte sale en la lista con su porqué (regla 7).
// Puro: lo prueban las unitarias (tests/unit/modules/conta/gestoria/conversion.test.ts).

import { alMesCent, type SuscripcionGc } from './lector.ts'

export type FormaDeCobrarse = 'fijo_mes' | 'fijo_anio' | 'por_empleado'
export type OrigenLinea = 'manual' | 'gocardless' | 'laboral'

export interface ServicioImportado {
  /** Clave estable dentro del emisor: «gestoria_mensual», «gestion_laboral» o el nombre literal en minúsculas. */
  clave: string
  nombre: string
  forma: FormaDeCobrarse
  /** Lo dice la gestoría: mientras no lo diga, un concepto suelto va «por_confirmar». */
  porConfirmar: boolean
}

export interface LineaImportada {
  suscripcionId: string
  clienteGcId: string
  emisor: string
  servicio: string
  /** La sociedad («GESTORIA MENSUAL <sociedad>») o el empleado («GESTION LABORAL <empleado>»). */
  detalle: string | null
  /** Solo en laboral: el empleado, por su nombre. El id de Laboral llega en la fase 2. */
  empleado: string | null
  origen: OrigenLinea
  /** El importe de la suscripción, en céntimos y en su periodo. */
  importeCent: number
  periodo: 'mes' | 'anio'
  /** Si no es el de la tarifa: el de la línea. */
  importePropioCent: number | null
  desde: string | null
}

export interface TarifaImportada {
  clienteGcId: string
  emisor: string
  servicio: string
  importeCent: number
  periodo: 'mes' | 'anio'
}

export type PorqueNoConvertida =
  | 'sin_cliente' | 'otra_moneda' | 'importe_cero' | 'semanal' | 'intervalo_desconocido' | 'cada_varios' | 'sin_nombre' | 'laboral_sin_empleado'

export interface NoConvertida {
  /** El porqué, como dato (conta_gc_importacion.porque_codigo). */
  codigo: PorqueNoConvertida
  suscripcionId: string
  clienteGcId: string | null
  emisor: string
  nombre: string
  porque: string
}

export interface ResultadoConversion {
  servicios: ServicioImportado[]
  lineas: LineaImportada[]
  tarifas: TarifaImportada[]
  noConvertidas: NoConvertida[]
}

/** «Gestión Laboral   ana pérez» → «GESTION LABORAL ANA PEREZ»: para comparar, sin tildes ni espacios de más. */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()
}

/** Lo que va detrás de las dos primeras palabras, tal cual se escribió, sin separadores delante. */
const detrasDeDosPalabras = (nombre: string): string | null => {
  const resto = nombre.trim().split(/\s+/).slice(2).join(' ').replace(/^[-:·,\s]+/, '').trim()
  return resto === '' ? null : resto
}

/** Qué es una suscripción por su nombre. */
export function clasificar(nombre: string): { tipo: 'gestoria' | 'laboral' | 'otro'; detalle: string | null } {
  const n = normalizar(nombre)
  if (/^GESTORIA MENSUAL(\s|$|[-:·,])/.test(n)) return { tipo: 'gestoria', detalle: detrasDeDosPalabras(nombre) }
  if (/^GESTION LABORAL(\s|$|[-:·,])/.test(n)) return { tipo: 'laboral', detalle: detrasDeDosPalabras(nombre) }
  return { tipo: 'otro', detalle: null }
}

const claveLiteral = (nombre: string) => normalizar(nombre).toLowerCase()

/**
 * Convierte las suscripciones de una cuenta de GoCardless (un emisor). Solo
 * las activas: una cancelada o terminada no es nada de hoy y no se importa.
 * «clienteDeMandato» dice de qué cliente de GoCardless es cada mandato.
 */
export function convertir(
  emisor: string,
  suscripciones: SuscripcionGc[],
  clienteDeMandato: Map<string, string>,
): ResultadoConversion {
  const servicios = new Map<string, ServicioImportado>()
  const lineas: LineaImportada[] = []
  const noConvertidas: NoConvertida[] = []

  for (const s of suscripciones) {
    if (s.estado !== 'active') continue
    const cliente = s.mandatoId ? clienteDeMandato.get(s.mandatoId) ?? null : null
    const fuera = (codigo: PorqueNoConvertida, porque: string) => noConvertidas.push({ codigo, suscripcionId: s.id, clienteGcId: cliente, emisor, nombre: s.nombre, porque })
    if (!cliente) { fuera('sin_cliente', 'Su mandato no es de ningún cliente leído de esta cuenta.'); continue }
    if (s.moneda !== 'EUR') { fuera('otra_moneda', `Cobra en ${s.moneda || 'una moneda sin decir'}, no en euros.`); continue }
    if (s.importeCent <= 0) { fuera('importe_cero', 'Su importe es cero.'); continue }
    if (s.intervalo !== 'monthly' && s.intervalo !== 'yearly') {
      fuera(s.intervalo === 'weekly' ? 'semanal' : 'intervalo_desconocido', s.intervalo === 'weekly' ? 'Se cobra cada semana: la gestoría dice cómo se pasa a una tarifa.' : `Se cobra «${s.intervalo}», que Sumied no sabe pasar a una tarifa.`)
      continue
    }
    if (s.cada !== 1) { fuera('cada_varios', `Se cobra cada ${s.cada} ${s.intervalo === 'monthly' ? 'meses' : 'años'}: la gestoría dice cómo se pasa a una tarifa.`); continue }
    const periodo = s.intervalo === 'yearly' ? 'anio' : 'mes'
    const { tipo, detalle } = clasificar(s.nombre)
    if (!s.nombre.trim()) { fuera('sin_nombre', 'No tiene nombre: no se sabe qué servicio es.'); continue }

    let servicio: ServicioImportado
    if (tipo === 'gestoria') servicio = { clave: 'gestoria_mensual', nombre: 'Gestoría mensual', forma: 'fijo_mes', porConfirmar: false }
    else if (tipo === 'laboral') {
      if (!detalle) { fuera('laboral_sin_empleado', 'Es gestión laboral sin el nombre del empleado: no se sabe de quién es la línea.'); continue }
      servicio = { clave: 'gestion_laboral', nombre: 'Gestión laboral', forma: 'por_empleado', porConfirmar: false }
    } else {
      servicio = { clave: claveLiteral(s.nombre), nombre: s.nombre.trim(), forma: periodo === 'anio' ? 'fijo_anio' : 'fijo_mes', porConfirmar: true }
    }
    if (!servicios.has(servicio.clave)) servicios.set(servicio.clave, servicio)
    lineas.push({
      suscripcionId: s.id, clienteGcId: cliente, emisor, servicio: servicio.clave,
      detalle: tipo === 'otro' ? null : detalle,
      empleado: tipo === 'laboral' ? detalle : null,
      origen: 'gocardless', importeCent: s.importeCent, periodo, importePropioCent: null, desde: s.inicio,
    })
  }

  // La tarifa propia de cada cliente y servicio: el importe que más se repite
  // (si empatan, el más bajo); las líneas con otro importe llevan el suyo.
  const tarifas: TarifaImportada[] = []
  const grupos = new Map<string, LineaImportada[]>()
  for (const l of lineas) {
    const k = `${l.clienteGcId}|${l.servicio}|${l.periodo}`
    if (!grupos.has(k)) grupos.set(k, [])
    grupos.get(k)!.push(l)
  }
  for (const g of grupos.values()) {
    const cuenta = new Map<number, number>()
    for (const l of g) cuenta.set(l.importeCent, (cuenta.get(l.importeCent) ?? 0) + 1)
    const importe = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]
    tarifas.push({ clienteGcId: g[0].clienteGcId, emisor, servicio: g[0].servicio, importeCent: importe, periodo: g[0].periodo })
    for (const l of g) if (l.importeCent !== importe) l.importePropioCent = l.importeCent
  }

  return { servicios: [...servicios.values()], lineas, tarifas, noConvertidas }
}

/** Lo que suma al mes lo convertido de un cliente (para cuadrar con GoCardless antes de guardar). */
export function alMesDeLasLineas(lineas: LineaImportada[]): number {
  return lineas.reduce((t, l) => t + (alMesCent({ importeCent: l.importeCent, intervalo: l.periodo === 'anio' ? 'yearly' : 'monthly', cada: 1 }) ?? 0), 0)
}
