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
//     «siempre mes entero»), ya dentro de reciboDelMes; aquí solo se dice.
//   · Cada cambio frente al mes anterior lleva su porqué en palabras de
//     oficina, con los textos de la maqueta (Cobro.dc.html, 09/11):
//       «+1 trabajador: Persona Prueba 3, alta el 12 de noviembre. Se cobra el mes entero.»
//       «−2 trabajadores: A y B, de baja en noviembre (noviembre se cobró entero).»
//       «Precio nuevo desde diciembre: Gestoría Estándar pasa de 60,50 € a 72,60 €.»
//       «Cambia de tarifa: de Autónomos a Estándar desde diciembre.»
//       «Cliente nuevo: Gestoría Estándar desde el 1 de diciembre.»
//   · Si el total sube o baja más de un 30 %, no se aprueba en lote: pide «Lo
//     he mirado, aprobar», con «Sube un 33 %» o «Baja un 33 %».
//
// Importes en céntimos. Lo prueban tests/unit/modules/conta/gestoria/g05/recibo.test.ts.

import {
  AJUSTES_DE_SIEMPRE, euros, reciboDelMes, trabajadoresDelMes,
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
/** «diciembre». */
export const nombreDelMes = (mes: Mes) => MESES[Number(mes.slice(5, 7)) - 1]
/** «diciembre de 2026». */
export const mesEnPalabras = (mes: Mes) => `${nombreDelMes(mes)} de ${mes.slice(0, 4)}`
/** «12 de noviembre», de «2026-11-12». */
export const diaEnPalabras = (fecha: string) => `${Number(fecha.slice(8, 10))} de ${MESES[Number(fecha.slice(5, 7)) - 1]}`

/** Un trabajador que cobra una línea, con su nombre (la factura lo detalla). */
export interface TrabajadorDelRecibo { nombre: string; altaEl: string | null }

/** Una línea del recibo: la del cálculo del G04 y, si va por trabajador, quiénes son. */
export interface LineaDeRecibo {
  asignacionId: string
  /** El servicio (o el paquete) y, si tiene, el nivel: para decir «Cambia de tarifa». */
  servicioId: string | null
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

export type TipoDeCambio = 'cliente_nuevo' | 'linea_nueva' | 'linea_quitada' | 'nivel' | 'alta' | 'baja' | 'precio'
export interface Cambio { tipo: TipoDeCambio; asignacionId: string | null; texto: string; altas?: number; bajas?: number }

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
  /** Si cambia más de un 30 %: «Sube un 33 %» o «Baja un 33 %». Si no, null. */
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
      asignacionId: l.asignacionId, servicioId: l.objetivo.tipo === 'paquete' ? null : l.objetivo.servicioId,
      texto: l.texto, importeCent: l.importeCent, cuenta: l.cuenta,
      trabajadores: deAlta ? deAlta.map((t) => ({ nombre: t.nombre, altaEl: t.altaEl ?? null })).sort(porNombre) : null,
    }
  })
}

/** El nombre de la línea sin «· N trabajadores». */
export const sinTrabajadores = (texto: string) => texto.replace(/ · \d+ trabajador(es)?$/, '')
/** «A, B y C». */
const enLista = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`)
const deTrabajadores = (n: number) => `${n} ${n === 1 ? 'trabajador' : 'trabajadores'}`

/** Lo que cambia de una línea a la misma línea del mes anterior, en palabras. */
function cambiosDeLinea(antes: LineaDeRecibo, ahora: LineaDeRecibo, mes: Mes, mesEntero: boolean): Cambio[] {
  const out: Cambio[] = []
  const eran = new Set((antes.trabajadores ?? []).map((t) => t.nombre))
  const son = new Set((ahora.trabajadores ?? []).map((t) => t.nombre))
  const altas = (ahora.trabajadores ?? []).filter((t) => !eran.has(t.nombre))
  const bajas = (antes.trabajadores ?? []).filter((t) => !son.has(t.nombre))
  if (altas.length) {
    const quien = altas.map((t) => (t.altaEl ? `${t.nombre}, alta el ${diaEnPalabras(t.altaEl)}` : t.nombre))
    const entero = mesEntero && altas.some((t) => t.altaEl && t.altaEl.slice(8, 10) !== '01') ? ' Se cobra el mes entero.' : ''
    out.push({ tipo: 'alta', asignacionId: ahora.asignacionId, altas: altas.length, texto: `+${deTrabajadores(altas.length)}: ${quien.join('; ')}.${entero}` })
  }
  if (bajas.length) {
    const delMes = nombreDelMes(mesAnterior(mes))
    out.push({ tipo: 'baja', asignacionId: ahora.asignacionId, bajas: bajas.length,
      texto: `−${deTrabajadores(bajas.length)}: ${enLista(bajas.map((t) => t.nombre))}, de baja en ${delMes}${mesEntero ? ` (${delMes} se cobró entero)` : ''}.` })
  }
  // El importe cambia sin que cambien los trabajadores: es el precio.
  if (!altas.length && !bajas.length && antes.importeCent !== ahora.importeCent && ahora.importeCent !== null && antes.importeCent !== null) {
    out.push({ tipo: 'precio', asignacionId: ahora.asignacionId,
      texto: `Precio nuevo desde ${nombreDelMes(mes)}: ${sinTrabajadores(ahora.texto)} pasa de ${euros(antes.importeCent)} a ${euros(ahora.importeCent)}.` })
  }
  return out
}

const importeEntre = (l: LineaDeRecibo) => (l.importeCent !== null ? ` (${euros(l.importeCent)})` : '')
/** El nivel de una línea «Servicio · Nivel»; null si no tiene. */
const nivelDe = (texto: string) => { const p = sinTrabajadores(texto).split(' · '); return p.length > 1 ? p.slice(1).join(' · ') : null }

/**
 * Lo que ha cambiado de un mes a otro, en el orden de las líneas de este mes y
 * después las que ya no están. Un mismo servicio que deja un nivel por otro es
 * «Cambia de tarifa», no una baja y un alta.
 */
export function cambiosFrenteA(anterior: ReciboAnterior | null, lineas: LineaDeRecibo[], mes: Mes, mesEntero = true): Cambio[] {
  if (!anterior) {
    return [{ tipo: 'cliente_nuevo', asignacionId: null, texto: `Cliente nuevo: ${enLista(lineas.map((l) => sinTrabajadores(l.texto)))} desde el 1 de ${nombreDelMes(mes)}.` }]
  }
  const antes = new Map(anterior.lineas.map((l) => [l.asignacionId, l]))
  const ahora = new Set(lineas.map((l) => l.asignacionId))
  const quitadas = anterior.lineas.filter((l) => !ahora.has(l.asignacionId))
  const emparejadas = new Set<string>()
  const out: Cambio[] = []
  for (const l of lineas) {
    const a = antes.get(l.asignacionId)
    if (a) { out.push(...cambiosDeLinea(a, l, mes, mesEntero)); continue }
    const otroNivel = quitadas.find((q) => !emparejadas.has(q.asignacionId) && q.servicioId !== null && q.servicioId === l.servicioId && nivelDe(q.texto) && nivelDe(l.texto))
    if (otroNivel) {
      emparejadas.add(otroNivel.asignacionId)
      out.push({ tipo: 'nivel', asignacionId: l.asignacionId, texto: `Cambia de tarifa: de ${nivelDe(otroNivel.texto)} a ${nivelDe(l.texto)} desde ${nombreDelMes(mes)}.` })
      continue
    }
    out.push({ tipo: 'linea_nueva', asignacionId: l.asignacionId, texto: `Nuevo: ${sinTrabajadores(l.texto)}${importeEntre(l)} desde ${nombreDelMes(mes)}.` })
  }
  for (const q of quitadas) {
    if (!emparejadas.has(q.asignacionId)) out.push({ tipo: 'linea_quitada', asignacionId: q.asignacionId, texto: `Ya no se cobra: ${sinTrabajadores(q.texto)}${importeEntre(q)}.` })
  }
  return out
}

/** «Sube un 33 %» o «Baja un 33 %» si cambia más del umbral; si no (o es el primero), null. */
export function porqueDelClic(anteriorCent: number | null, totalCent: number): string | null {
  if (anteriorCent === null || anteriorCent <= 0) return null
  const cambio = (totalCent - anteriorCent) / anteriorCent
  if (Math.abs(cambio) <= UMBRAL_DE_CAMBIO) return null
  return `${cambio > 0 ? 'Sube' : 'Baja'} un ${Math.abs(Math.round(cambio * 100))} %`
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
  const mesEntero = (d.catalogo.ajustes ?? AJUSTES_DE_SIEMPRE).mitadDeMes === 'mes_entero'
  const cambios = cambiosFrenteA(d.anterior, lineas, d.mes, mesEntero)
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
