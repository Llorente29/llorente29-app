// supabase/functions/_shared/cobro/recibo.ts
//
// G05 · Tarea 2 (09/11/2026). EL RECIBO DEL MES de un cliente con una empresa
// que factura, y lo que ha cambiado frente al mes anterior. Puro: sin base, sin
// red y sin la fecha de hoy. El importe sale del cálculo único del G04
// (_shared/tarifa/precio.ts · reciboDelMes); aquí no se vuelve a calcular nada.
//
// Reglas (flujo_recibos_qbo.md, aprobado el 06/11; decisiones de Julio):
//   · Un recibo por cliente, empresa y mes, con CLAVE ÚNICA (claveDelRecibo):
//     la base no deja guardar dos con la misma clave, y la misma clave va a
//     GoCardless como clave de no repetir (allí solo dura unos 30 días: es la
//     segunda red, no la primera).
//   · Si el cliente no se cobra el día 1 (de baja, «solo renta», sin situación)
//     o no tiene nada que cobrar, NO hay recibo, y se dice por qué.
//   · Ninguna cifra se inventa: una línea sin precio no se cobra a cero; el
//     recibo queda parado hasta que alguien le ponga precio.
//   · Altas y bajas a mitad de mes: lo decide el ajuste de la gestoría (QBO,
//     «siempre mes entero»), ya dentro de reciboDelMes.
//   · Cada línea que cambia frente al mes anterior lleva su porqué en palabras
//     de oficina («+1 trabajador: alta el 12/10», «Precio nuevo desde enero»).
//   · Si el total cambia más de un 30 %, no se aprueba en lote: pide un clic y
//     dice por qué.
//
// Importes en céntimos. Lo prueban tests/unit/modules/conta/gestoria/g05/recibo.test.ts.

import {
  euros, reciboDelMes, trabajadoresDelMes,
  type Asignacion, type Catalogo, type LineaDelRecibo, type Mes,
} from '../tarifa/precio.ts'
import { SE_COBRA, type Situacion } from '../tarifa/lista.ts'

/** Más de esto de cambio en el total (en tanto por uno) y el recibo se aprueba uno a uno, con un clic. */
export const UMBRAL_DE_CAMBIO = 0.30

/** La clave única de un recibo: la misma en la base y en GoCardless (menos de 128 caracteres). */
export const claveDelRecibo = (empresaId: string, clienteId: string, mes: Mes): string => `recibo:${empresaId}:${clienteId}:${mes}`

/** El mes anterior y el siguiente de «AAAA-MM». */
export function mesAnterior(mes: Mes): Mes {
  const a = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`
}
export function mesSiguiente(mes: Mes): Mes {
  const a = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «noviembre de 2026». */
export const mesEnPalabras = (mes: Mes) => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`
/** «12/10», de «2026-10-12». */
const diaCorto = (fecha: string) => `${Number(fecha.slice(8, 10))}/${fecha.slice(5, 7)}`

/** Un trabajador que cobra una línea, con su nombre (la factura lo detalla). */
export interface TrabajadorDelRecibo { nombre: string; altaEl: string | null }

/** Una línea del recibo: la del cálculo del G04 y, si va por trabajador, quiénes son. */
export interface LineaDeRecibo {
  asignacionId: string
  texto: string
  /** Null: sin precio (el recibo no se puede enviar así). */
  importeCent: number | null
  /** Cómo sale el importe («18 × 24,20 €»). */
  cuenta: string
  /** Los trabajadores de alta ese mes, por orden alfabético; null si la línea no va por trabajador. */
  trabajadores: TrabajadorDelRecibo[] | null
}

/** Lo que el recibo del mes anterior tenía (el guardado de verdad, o el calculado si no se guardó). */
export interface ReciboAnterior {
  mes: Mes
  totalCent: number
  lineas: LineaDeRecibo[]
}

export type TipoDeCambio = 'primer_recibo' | 'linea_nueva' | 'linea_quitada' | 'alta' | 'baja' | 'precio'
export interface Cambio { tipo: TipoDeCambio; asignacionId: string | null; texto: string }

export interface Recibo {
  clave: string
  clienteId: string
  empresaId: string
  mes: Mes
  lineas: LineaDeRecibo[]
  totalCent: number
  /** El total del mes anterior; null si es el primero. */
  anteriorCent: number | null
  cambios: Cambio[]
  /** Igual que el mes pasado: se aprueba en lote. */
  igualQueElMesPasado: boolean
  /** Si cambia más de un 30 %, el porqué del clic que pide; si no, null. */
  pideClic: string | null
  /** Lo que impide enviarlo (sin precio…), en palabras. Vacío: se puede enviar. */
  parado: string[]
}

export type SinRecibo = { hay: false; porque: string }
export type ConRecibo = { hay: true; recibo: Recibo }

const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, 'es')

/** Las líneas del recibo de un mes, con los trabajadores por su nombre. */
export function lineasDelMes(c: Catalogo, asignaciones: Asignacion[], clienteId: string, empresaId: string, mes: Mes): LineaDeRecibo[] {
  const r = reciboDelMes(c, asignaciones, clienteId, empresaId, mes)
  const deId = new Map(asignaciones.map((a) => [a.id, a]))
  return r.lineas.map((l: LineaDelRecibo) => {
    const a = deId.get(l.asignacionId)
    const deAlta = a?.trabajadores ? trabajadoresDelMes(a.trabajadores, mes).deAlta : null
    return {
      asignacionId: l.asignacionId, texto: l.texto, importeCent: l.importeCent, cuenta: l.cuenta,
      trabajadores: deAlta ? deAlta.map((t) => ({ nombre: t.nombre, altaEl: t.altaEl ?? null })).sort(porNombre) : null,
    }
  })
}

const sinTrabajadores = (texto: string) => texto.replace(/ · \d+ trabajador(es)?$/, '')

/** Lo que cambia de una línea a otra del mismo servicio, en palabras. */
function cambiosDeLinea(antes: LineaDeRecibo | undefined, ahora: LineaDeRecibo | undefined, mes: Mes): Cambio[] {
  if (!antes && ahora) {
    return [{ tipo: 'linea_nueva', asignacionId: ahora.asignacionId, texto: `Nuevo: ${sinTrabajadores(ahora.texto)}${ahora.importeCent !== null ? ` (${euros(ahora.importeCent)})` : ''}, desde ${mesEnPalabras(mes)}` }]
  }
  if (antes && !ahora) {
    return [{ tipo: 'linea_quitada', asignacionId: antes.asignacionId, texto: `Ya no se cobra: ${sinTrabajadores(antes.texto)}${antes.importeCent !== null ? ` (${euros(antes.importeCent)})` : ''}` }]
  }
  if (!antes || !ahora) return []
  const out: Cambio[] = []
  const nombres = (l: LineaDeRecibo) => new Set((l.trabajadores ?? []).map((t) => t.nombre))
  const eran = nombres(antes); const son = nombres(ahora)
  const altas = (ahora.trabajadores ?? []).filter((t) => !eran.has(t.nombre))
  const bajas = (antes.trabajadores ?? []).filter((t) => !son.has(t.nombre))
  if (altas.length) {
    const quien = altas.map((t) => (t.altaEl ? `${t.nombre}, alta el ${diaCorto(t.altaEl)}` : t.nombre)).join('; ')
    out.push({ tipo: 'alta', asignacionId: ahora.asignacionId, texto: `+${altas.length} ${altas.length === 1 ? 'trabajador' : 'trabajadores'} en ${sinTrabajadores(ahora.texto)}: ${quien}` })
  }
  if (bajas.length) {
    out.push({ tipo: 'baja', asignacionId: ahora.asignacionId, texto: `−${bajas.length} ${bajas.length === 1 ? 'trabajador' : 'trabajadores'} en ${sinTrabajadores(ahora.texto)}: baja de ${bajas.map((t) => t.nombre).join(', ')}` })
  }
  // El importe cambia sin que cambien los trabajadores: es el precio.
  if (!altas.length && !bajas.length && antes.importeCent !== ahora.importeCent && ahora.importeCent !== null && antes.importeCent !== null) {
    out.push({ tipo: 'precio', asignacionId: ahora.asignacionId, texto: `Precio nuevo desde ${mesEnPalabras(mes)} en ${sinTrabajadores(ahora.texto)}: ${euros(antes.importeCent)} → ${euros(ahora.importeCent)}` })
  }
  return out
}

/** Lo que ha cambiado de un mes a otro, línea a línea, en el orden de las líneas de este mes (y después las que ya no están). */
export function cambiosFrenteA(anterior: ReciboAnterior | null, lineas: LineaDeRecibo[], mes: Mes): Cambio[] {
  if (!anterior) return [{ tipo: 'primer_recibo', asignacionId: null, texto: 'Es su primer recibo en Sumied' }]
  const antes = new Map(anterior.lineas.map((l) => [l.asignacionId, l]))
  const ahora = new Set(lineas.map((l) => l.asignacionId))
  return [
    ...lineas.flatMap((l) => cambiosDeLinea(antes.get(l.asignacionId), l, mes)),
    ...anterior.lineas.filter((l) => !ahora.has(l.asignacionId)).flatMap((l) => cambiosDeLinea(l, undefined, mes)),
  ]
}

/** «El total pasa de 145,20 € a 217,80 € (+50 %)» si cambia más del umbral; si no, null. */
export function porqueDelClic(anteriorCent: number | null, totalCent: number): string | null {
  if (anteriorCent === null || anteriorCent <= 0) return null
  const cambio = (totalCent - anteriorCent) / anteriorCent
  if (Math.abs(cambio) <= UMBRAL_DE_CAMBIO) return null
  const pct = Math.round(cambio * 100)
  return `El total pasa de ${euros(anteriorCent)} a ${euros(totalCent)} (${pct > 0 ? '+' : '−'}${Math.abs(pct)} %): revísalo antes de enviarlo`
}

export interface DatosDelRecibo {
  catalogo: Catalogo
  asignaciones: Asignacion[]
  clienteId: string
  empresaId: string
  mes: Mes
  /** La situación del cliente el día 1 del mes (en su ficha). */
  situacionElDia1: Situacion
  /** El recibo del mes anterior (el guardado); null si no hubo. */
  anterior: ReciboAnterior | null
}

const SITUACION_EN_PALABRAS: Record<string, string> = { baja: 'está de baja', solo_renta: 'es «solo renta»' }

/** El recibo del mes de un cliente con una empresa, o por qué no hay. */
export function prepararRecibo(d: DatosDelRecibo): SinRecibo | ConRecibo {
  if (!SE_COBRA.includes(d.situacionElDia1)) {
    return { hay: false, porque: `No se le cobra: el día 1 ${SITUACION_EN_PALABRAS[d.situacionElDia1 ?? ''] ?? 'no tiene situación'}` }
  }
  const lineas = lineasDelMes(d.catalogo, d.asignaciones, d.clienteId, d.empresaId, d.mes)
  if (!lineas.length) return { hay: false, porque: `No tiene nada que cobrar en ${mesEnPalabras(d.mes)}` }
  const totalCent = lineas.reduce((s, l) => s + (l.importeCent ?? 0), 0)
  const sinPrecio = lineas.filter((l) => l.importeCent === null)
  const parado: string[] = []
  if (sinPrecio.length) parado.push(`${sinPrecio.length === 1 ? 'Una línea' : `${sinPrecio.length} líneas`} sin precio: ${sinPrecio.map((l) => sinTrabajadores(l.texto)).join(', ')}`)
  if (!sinPrecio.length && totalCent <= 0) parado.push('El total es 0 €: no hay nada que cobrar')
  const cambios = cambiosFrenteA(d.anterior, lineas, d.mes)
  const anteriorCent = d.anterior ? d.anterior.totalCent : null
  return {
    hay: true,
    recibo: {
      clave: claveDelRecibo(d.empresaId, d.clienteId, d.mes), clienteId: d.clienteId, empresaId: d.empresaId, mes: d.mes,
      lineas, totalCent, anteriorCent, cambios,
      igualQueElMesPasado: cambios.length === 0 && anteriorCent === totalCent,
      pideClic: porqueDelClic(anteriorCent, totalCent),
      parado,
    },
  }
}
