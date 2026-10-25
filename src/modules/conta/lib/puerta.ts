// src/modules/conta/lib/puerta.ts
//
// V02 · Entrega 1 · LA PUERTA (Inicio › Documentos, tablero 19). Núcleo puro:
// se prueba sin React ni base (tests/unit/modules/conta/v02/puerta.test.ts).
//
//   · «Lo que falta»: de cada fuente (conta_puerta_fuentes) salen las fechas en
//     que se espera algo (su calendario: el día del mes, el 15 y fin de mes, el
//     día de la semana o «cada N días»), y de sus llegadas, cuál ha llegado.
//     Cada llegada cuenta para la fecha esperada más cercana. Lo que no ha
//     llegado: «aún a tiempo» hasta su día más el margen; después, «N días
//     tarde» contados desde su día (como en el tablero: «hacia el 22/10» y «3
//     días tarde» el 25/10). Una fuente cubierta por una recurrente no avisa.
//   · El local (opcional, de cualquier fuente): los alquileres van juntos por
//     su local («Alquiler · Cañaveral 75: falta 1 de 3»), sin nombres de
//     personas; sin local, todos en «Alquileres». Lo demás lleva su local en el aviso.
//   · Lo último: las pestañas (Lo último · Necesita que lo mires · Colocado),
//     qué es cada cosa en palabras y dónde está.
//   · Lo que se sube: qué es cada fichero antes de subirlo (las facturas a
//     Compras, la quincena de Catcher a sus facturas, el extracto a Bancos y lo
//     que no se sabe, a la puerta para «Dime qué es»).

import { queDiceElContenido, queDiceElNombre, type QueEs } from '../../../../supabase/functions/_shared/queEs.ts'

export type { QueEs }

// ── Lo que viene de la base ─────────────────────────────────────────────────

export type TipoFuente = 'proveedor' | 'alquiler' | 'riders' | 'nominas' | 'banco' | 'intermediario' | 'otro'
export type Cadencia = 'mensual' | 'quincenal' | 'semanal' | 'varias'

export interface Fuente {
  id: string
  /** La clave con que se aprendió (nif:…, riders, canal:…, banco:…, nominas), o null si se apuntó a mano. */
  clave?: string | null
  tipo: TipoFuente
  nombre: string
  grupo: string | null
  proveedor_id: string | null
  cadencia: Cadencia
  /** Mensual: el día del mes. Quincenal: los días después del fin de la quincena. */
  dia: number | null
  /** Semanal: 1 lunes … 7 domingo. */
  dia_semana: number | null
  /** «Varias al mes»: cada cuántos días. */
  cada: number | null
  margen: number | null
  activa: boolean
  origen: string | null
  cubierta: boolean
  /** Las fechas en que ha llegado algo de esta fuente ('YYYY-MM-DD', de menor a mayor). */
  llegadas: string[]
  pedida: { periodo: string; estado: string; a: string | null } | null
  /** El local o centro de trabajo de la fuente (opcional). */
  local?: Local | null
}
/** Un local o centro de trabajo de la empresa (locations, unido a la empresa por location_company). */
export interface Local { id: string; nombre: string; direccion: string | null; activo?: boolean }
export interface Ajustes { lo_que_falta: boolean; margen: number }
export interface DatosFuentes { ajustes: Ajustes; fuentes: Fuente[]; /** Los locales de la empresa; con uno o ninguno, no se pide. */ locales?: Local[] }

export type Donde = 'factura' | 'bancos' | 'liquidaciones' | 'laboral' | 'riders' | null
export interface Ultimo {
  id: string
  fuente: 'bandeja' | 'catcher' | 'extracto' | 'liquidacion' | 'nomina'
  cuando: string
  por: 'correo' | 'subido' | 'cocina' | 'conexion'
  que: QueEs | null
  que_por?: 'regla' | 'lectura' | 'persona' | null
  de: string | null
  importe: number | null
  estado: string | null
  motivo?: string | null
  donde: Donde
  factura_id?: string | null
  nombre?: string | null
  facturas?: number | null
}
export interface Direccion { tipo: 'documentos' | 'facturas' | 'liquidaciones'; direccion: string; activa: boolean }
export interface DatosPuerta {
  direcciones: Direccion[]
  conectados: { bancos: { proveedor: string; estado: string; ultima: string | null }[]; uber_por_correo: boolean }
  ultimos: Ultimo[]
}

// ── Fechas (siempre 'YYYY-MM-DD', en UTC para no bailar con la hora) ─────────

const aFecha = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const aIso = (d: Date) => d.toISOString().slice(0, 10)
export const sumarDias = (iso: string, n: number) => { const d = aFecha(iso); d.setUTCDate(d.getUTCDate() + n); return aIso(d) }
export const diasEntre = (desde: string, hasta: string) => Math.round((aFecha(hasta).getTime() - aFecha(desde).getTime()) / 86_400_000)
const ultimoDia = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m: 1–12
const fechaDe = (y: number, m: number, d: number) => aIso(new Date(Date.UTC(y, m - 1, Math.min(d, ultimoDia(y, m)))))
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesDe = (iso: string) => MES[Number(iso.slice(5, 7)) - 1]
const diaDe = (iso: string) => Number(iso.slice(8, 10))
/** «del 16 al 30 de septiembre», «del 26 de octubre al 1 de noviembre». */
export function delAl(desde: string, hasta: string): string {
  return desde.slice(0, 7) === hasta.slice(0, 7)
    ? `del ${diaDe(desde)} al ${diaDe(hasta)} de ${mesDe(hasta)}`
    : `del ${diaDe(desde)} de ${mesDe(desde)} al ${diaDe(hasta)} de ${mesDe(hasta)}`
}
/** «22/10» */
export const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

// ── El calendario de una fuente ─────────────────────────────────────────────

/** Una vez que se espera algo: su día y de qué periodo es. */
export interface Ocurrencia { dia: string; desde: string | null; hasta: string | null }

/**
 * Las fechas esperadas de una fuente entre `desde` y `hasta` (las dos
 * incluidas), en orden. «Varias al mes» no tiene calendario fijo: su siguiente
 * es la última llegada más `cada` días (y sin llegadas, no hay nada que esperar).
 */
export function ocurrencias(f: Pick<Fuente, 'cadencia' | 'dia' | 'dia_semana' | 'cada' | 'llegadas'>, desde: string, hasta: string): Ocurrencia[] {
  const out: Ocurrencia[] = []
  if (f.cadencia === 'mensual') {
    const dia = f.dia ?? 1
    let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7)) - 1
    if (m === 0) { y -= 1; m = 12 }
    for (let i = 0; i < 40; i++) {
      const d = fechaDe(y, m, dia)
      if (d > hasta) break
      if (d >= desde) out.push({ dia: d, desde: null, hasta: null })
      m += 1; if (m > 12) { m = 1; y += 1 }
    }
  } else if (f.cadencia === 'quincenal') {
    const tras = f.dia ?? 0
    let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7)) - 1
    if (m === 0) { y -= 1; m = 12 }
    for (let i = 0; i < 80; i++) {
      const q1 = { desde: fechaDe(y, m, 1), hasta: fechaDe(y, m, 15) }
      const q2 = { desde: fechaDe(y, m, 16), hasta: fechaDe(y, m, 31) }
      let fuera = false
      for (const q of [q1, q2]) {
        const d = sumarDias(q.hasta, tras)
        if (d > hasta) { fuera = true; break }
        if (d >= desde) out.push({ dia: d, ...q })
      }
      if (fuera) break
      m += 1; if (m > 12) { m = 1; y += 1 }
    }
  } else if (f.cadencia === 'semanal') {
    const ds = f.dia_semana ?? 1 // 1 lunes … 7 domingo
    const d0 = aFecha(desde)
    const hoyDs = ((d0.getUTCDay() + 6) % 7) + 1
    let d = sumarDias(desde, (ds - hoyDs + 7) % 7)
    while (d <= hasta) {
      out.push({ dia: d, desde: sumarDias(d, -6), hasta: d })
      d = sumarDias(d, 7)
    }
  } else {
    const cada = Math.max(1, f.cada ?? 10)
    const ult = f.llegadas.length ? f.llegadas[f.llegadas.length - 1] : null
    if (ult) {
      let d = sumarDias(ult, cada)
      while (d <= hasta) { if (d >= desde) out.push({ dia: d, desde: null, hasta: null }); d = sumarDias(d, cada) }
    }
  }
  return out
}

/** Media distancia entre dos esperadas seguidas: hasta ahí, una llegada cuenta para la más cercana. */
function radio(f: Pick<Fuente, 'cadencia' | 'cada'>): number {
  return f.cadencia === 'mensual' ? 15 : f.cadencia === 'quincenal' ? 7 : f.cadencia === 'semanal' ? 3 : Math.max(1, Math.floor((f.cada ?? 10) / 2))
}

export type EstadoFalta =
  | { que: 'a_tiempo'; texto: 'Aún a tiempo' }
  | { que: 'tarde'; dias: number; texto: string; grave: boolean }

export interface FilaFalta {
  /** La fuente, o la primera del grupo. */
  id: string
  ids: string[]
  de: string
  que: string
  hacia: string
  estado: EstadoFalta
  /** Cuántas fuentes en esta fila (un grupo de alquileres: «(3 facturas)»). */
  n: number
  tipo: TipoFuente
  proveedorId: string | null
  pedida: Fuente['pedida']
}

/** Lo que es cada cosa que se espera, en palabras de la calle. */
export function queSeEspera(f: Pick<Fuente, 'tipo' | 'cadencia' | 'dia'>, o: Ocurrencia): string {
  const mes = mesDe(o.dia)
  const mesAnterior = mesDe(sumarDias(`${o.dia.slice(0, 7)}-01`, -1))
  if (f.tipo === 'riders') return `Facturas de los riders ${o.desde && o.hasta ? delAl(o.desde, o.hasta) : `de ${mes}`}`
  if (f.tipo === 'intermediario') return o.desde && o.hasta ? `Liquidación ${delAl(o.desde, o.hasta)}` : `Liquidación de ${f.dia != null && f.dia <= 10 ? mesAnterior : mes}`
  if (f.tipo === 'banco') return o.desde && o.hasta ? `Extracto ${delAl(o.desde, o.hasta)}` : `Extracto de ${f.dia != null && f.dia <= 10 ? mesAnterior : mes}`
  if (f.tipo === 'nominas') return `Nóminas de ${f.dia != null && f.dia <= 10 ? mesAnterior : mes}`
  if (f.tipo === 'alquiler') return `Alquiler de ${mes}`
  if (f.cadencia === 'varias') return 'La siguiente factura'
  return `Factura de ${mes}`
}

/**
 * Lo que falta de una fuente, hoy: la esperada más reciente que no ha llegado
 * y ya pasó su margen («N días tarde») o, si no hay ninguna tarde, la próxima
 * de los siguientes `horizonte` días («Aún a tiempo»). null: nada que decir.
 * Las esperadas de antes de la primera llegada no cuentan (la fuente aún no existía).
 */
export function faltaDe(f: Fuente, hoy: string, margenEmpresa = 5, horizonte = 14): { o: Ocurrencia; estado: EstadoFalta } | null {
  if (!f.activa || f.cubierta) return null
  const margen = f.margen ?? margenEmpresa
  const r = radio(f)
  const primera = f.llegadas.length ? f.llegadas[0] : null
  const desde = sumarDias(hoy, -70)
  const os = ocurrencias(f, desde, sumarDias(hoy, horizonte))
  const llegó = (o: Ocurrencia) => f.llegadas.some((l) => Math.abs(diasEntre(o.dia, l)) <= r)
  const pendientes = os.filter((o) => !llegó(o) && (!primera || diasEntre(primera, o.dia) >= -r))
  const tarde = pendientes.filter((o) => diasEntre(o.dia, hoy) > margen)
  if (tarde.length) {
    // Solo la última que falta: si faltan varias, la más reciente es la que hay que pedir.
    const o = tarde[tarde.length - 1]
    const dias = diasEntre(o.dia, hoy)
    return { o, estado: { que: 'tarde', dias, texto: `${dias} ${dias === 1 ? 'día' : 'días'} tarde`, grave: dias > 7 } }
  }
  const proxima = pendientes.find((o) => diasEntre(hoy, o.dia) >= -margen)
  return proxima ? { o: proxima, estado: { que: 'a_tiempo', texto: 'Aún a tiempo' } } : null
}

/**
 * Cómo se llama un local en los avisos: su dirección, como se dice en la calle
 * («Camichi, 4» → «Camichi 4»); sin dirección, su nombre.
 */
export const nombreDelLocal = (l: Pick<Local, 'nombre' | 'direccion'>): string =>
  l.direccion?.trim() ? l.direccion.trim().replace(/,\s*(\d)/, ' $1') : l.nombre

/**
 * En qué fila va una fuente. Los alquileres van juntos por local («Alquiler ·
 * Cañaveral 75»); sin local, todos en «Alquileres». Lo demás, cada fuente en la
 * suya, salvo que tenga un grupo puesto a mano.
 */
function filaDe(f: Fuente): string | null {
  if (f.tipo === 'alquiler') return f.local ? `Alquiler · ${nombreDelLocal(f.local)}` : 'Alquileres'
  return f.grupo
}

/**
 * Las filas de «Lo que falta», con las fuentes de la misma fila juntas, con lo
 * peor de ellas y cuántas faltan («Alquileres · Alquiler de octubre: falta 1 de
 * 5»). Con local, el aviso lo dice («Factura de octubre · Camichi 4»). Primero
 * lo que va tarde (lo más tarde arriba), luego lo que está aún a tiempo (lo más
 * cercano arriba).
 */
export function loQueFalta(d: DatosFuentes, hoy: string, horizonte = 14): FilaFalta[] {
  if (!d.ajustes.lo_que_falta) return []
  const sueltas: FilaFalta[] = []
  const grupos = new Map<string, { f: Fuente; o: Ocurrencia; estado: EstadoFalta }[]>()
  for (const f of d.fuentes) {
    const x = faltaDe(f, hoy, d.ajustes.margen, horizonte)
    if (!x) continue
    const fila = filaDe(f)
    if (fila) { grupos.set(fila, [...(grupos.get(fila) ?? []), { f, ...x }]); continue }
    const que = queSeEspera(f, x.o) + (f.local ? ` · ${nombreDelLocal(f.local)}` : '')
    sueltas.push({ id: f.id, ids: [f.id], de: f.nombre, que, hacia: x.o.dia, estado: x.estado, n: 1, tipo: f.tipo, proveedorId: f.proveedor_id, pedida: f.pedida })
  }
  for (const [fila, xs] of grupos) {
    const peor = [...xs].sort((a, b) => peso(b.estado) - peso(a.estado) || a.o.dia.localeCompare(b.o.dia))[0]
    const n = d.fuentes.filter((f) => filaDe(f) === fila && f.activa && !f.cubierta).length
    // Cuántas faltan de verdad: las que ya van tarde, o todas si ninguna va tarde todavía.
    const tarde = xs.filter((x) => x.estado.que === 'tarde').length
    const faltan = tarde || xs.length
    const que = queSeEspera(peor.f, peor.o)
    sueltas.push({
      id: peor.f.id, ids: xs.map((x) => x.f.id), de: fila, que: n > 1 ? `${que}: falta${faltan === 1 ? '' : 'n'} ${faltan} de ${n}` : que,
      hacia: peor.o.dia, estado: peor.estado, n, tipo: peor.f.tipo, proveedorId: n === 1 ? peor.f.proveedor_id : null, pedida: n === 1 ? peor.f.pedida : null,
    })
  }
  return sueltas.sort((a, b) => peso(b.estado) - peso(a.estado) || (a.estado.que === 'tarde' ? 0 : a.hacia.localeCompare(b.hacia)))
}
const peso = (e: EstadoFalta) => (e.que === 'tarde' ? 1000 + e.dias : 0)

/** «Por llegar este mes»: lo que se espera de aquí a fin de mes y aún no ha llegado (lo tarde va aparte). */
export function porLlegarEsteMes(d: DatosFuentes, hoy: string): { n: number; de: string[] } {
  if (!d.ajustes.lo_que_falta) return { n: 0, de: [] }
  const fin = fechaDe(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 31)
  const de: string[] = []
  let n = 0
  for (const f of d.fuentes) {
    if (!f.activa || f.cubierta) continue
    const margen = f.margen ?? d.ajustes.margen
    const r = radio(f)
    const os = ocurrencias(f, sumarDias(hoy, -margen), fin)
      .filter((o) => !f.llegadas.some((l) => Math.abs(diasEntre(o.dia, l)) <= r) && diasEntre(o.dia, hoy) <= margen)
    if (!os.length) continue
    n += os.length
    const nombre = filaDe(f) ?? f.nombre
    if (!de.includes(nombre)) de.push(nombre)
  }
  return { n, de }
}

// ── Lo último ───────────────────────────────────────────────────────────────

export const ETIQUETA_QUE: Record<QueEs, string> = {
  factura: 'Factura recibida', ticket: 'Ticket', liquidacion: 'Liquidación', extracto: 'Extracto', nomina: 'Nómina', riders: 'Quincena de riders', otro: 'Otra cosa',
}
/** El chip de cada tipo, como en el tablero: liquidación en verde, factura en azul, extracto en morado. */
export const TONO_QUE: Record<QueEs, 'seguro' | 'accion' | 'neutro' | 'propuesto' | 'oscuro'> = {
  factura: 'accion', ticket: 'neutro', liquidacion: 'seguro', extracto: 'propuesto', nomina: 'neutro', riders: 'seguro', otro: 'neutro',
}
export const POR: Record<Ultimo['por'], string> = { correo: 'Correo', subido: 'Subido', cocina: 'Cocina', conexion: 'Conexión' }
export const DONDE: Record<Exclude<Donde, null>, string> = {
  factura: 'Facturas recibidas', bancos: 'Movimientos', liquidaciones: 'Liquidaciones', laboral: 'Laboral', riders: 'Quincenas de Catcher',
}

/** ¿Necesita que lo mires? Lo de la bandeja que nadie sabe qué es (ni la regla, ni la lectura, ni una persona). */
export const necesitaMirarse = (u: Ultimo) => u.fuente === 'bandeja' && !u.que && u.estado !== 'repetida' && u.estado !== 'descartado'
/** ¿Colocado? Lo que ya está en su sitio. */
export const colocado = (u: Ultimo) => u.donde !== null

export type PestanaPuerta = 'ultimo' | 'mirar' | 'colocado'
export function deLaPestana(us: readonly Ultimo[], p: PestanaPuerta): Ultimo[] {
  return p === 'mirar' ? us.filter(necesitaMirarse) : p === 'colocado' ? us.filter(colocado) : [...us]
}

/** «hoy 09:12», «ayer 19:05», «22/10 10:02» (hora de Madrid). */
export function cuandoLlego(ts: string, hoy: string): string {
  const d = new Date(ts)
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  if (dia === hoy) return `hoy ${hora}`
  if (dia === sumarDias(hoy, -1)) return `ayer ${hora}`
  return `${ddmm(dia)} ${hora}`
}

/** Las cifras de arriba del tablero. */
export function cifrasPuerta(p: DatosPuerta, d: DatosFuentes | null, hoy: string) {
  const semana = sumarDias(hoy, -6)
  const deLaSemana = p.ultimos.filter((u) => u.cuando.slice(0, 10) >= semana)
  const enSuSitio = deLaSemana.filter(colocado).length
  const mirar = p.ultimos.filter(necesitaMirarse)
  const falta = d ? loQueFalta(d, hoy).filter((x) => x.estado.que === 'tarde') : []
  const llegar = d ? porLlegarEsteMes(d, hoy) : { n: 0, de: [] }
  return {
    llegado: { n: deLaSemana.length, apoyo: deLaSemana.length === 0 ? 'nada todavía' : enSuSitio === deLaSemana.length ? `${deLaSemana.length === 1 ? 'documento, en su sitio' : 'documentos, todos en su sitio'}` : `${enSuSitio} en su sitio` },
    mirar: { n: mirar.length, apoyo: mirar.length === 0 ? 'nada' : mirar.length === 1 ? 'un documento que no reconozco' : `${mirar.length} documentos que no reconozco` },
    falta: { n: falta.length, apoyo: falta.length === 0 ? (d?.ajustes.lo_que_falta === false ? 'aviso apagado' : 'todo a tiempo') : listaCorta(falta.map((x) => x.de)) },
    porLlegar: { n: llegar.n, apoyo: llegar.n === 0 ? 'nada más este mes' : listaCorta(llegar.de) },
  }
}
function listaCorta(xs: readonly string[]): string {
  if (xs.length <= 2) return xs.join(' y ')
  return `${xs.slice(0, 3).join(', ')}${xs.length > 3 ? '…' : ''}`
}

// ── Lo que se sube ──────────────────────────────────────────────────────────

export type CaminoSubida = 'facturas' | 'catcher' | 'extracto' | 'sin_saber'
export interface GrupoSubida { camino: CaminoSubida; ficheros: { nombre: string; i: number }[]; texto: string }

const esPdfOFoto = (nombre: string, tipo: string) => /^(application\/pdf|image\/)/.test(tipo) || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(nombre)
const esHoja = (nombre: string) => /\.(xlsx|xls|csv)$/i.test(nombre)

/**
 * Qué es cada fichero que se suelta en la puerta, antes de subir nada, y por
 * qué camino va (el de siempre de cada apartado):
 *   · un zip con las facturas de los riders (y las hojas que vengan con él):
 *     la quincena de Catcher;
 *   · un extracto (Norma 43, o una hoja cuyo nombre lo dice): Bancos;
 *   · un PDF o una foto: Compras › Facturas recibidas (se lee como siempre);
 *   · lo demás: a la puerta, sin saber qué es, para «Dime qué es».
 */
export function clasificarSubida(fs: readonly { nombre: string; tipo: string; bytes?: Uint8Array | null }[]): GrupoSubida[] {
  const camino: CaminoSubida[] = fs.map((f) => {
    if (f.bytes && queDiceElContenido(f.nombre, f.bytes) === 'riders') return 'catcher'
    const n = queDiceElNombre(f.nombre)
    if (n === 'riders') return 'catcher'
    if (n === 'extracto') return 'extracto'
    if (esPdfOFoto(f.nombre, f.tipo)) return 'facturas'
    return 'sin_saber'
  })
  // La quincena llega junta: con el zip de los riders, sus dos hojas van con él.
  if (camino.includes('catcher')) fs.forEach((f, i) => { if (camino[i] === 'sin_saber' && esHoja(f.nombre)) camino[i] = 'catcher' })
  const textos: Record<CaminoSubida, (n: number) => string> = {
    facturas: (n) => `${n === 1 ? 'Una factura o ticket' : `${n} facturas o tickets`}: ${n === 1 ? 'se lee' : 'se leen'} y ${n === 1 ? 'va' : 'van'} a Compras › Facturas recibidas.`,
    catcher: () => 'La quincena de Catcher: se reparte en las facturas de cada rider.',
    extracto: (n) => `${n === 1 ? 'Un extracto del banco' : `${n} extractos del banco`}: se ${n === 1 ? 'importa' : 'importan'} en Bancos.`,
    sin_saber: (n) => `${n === 1 ? 'Uno que no sé qué es' : `${n} que no sé qué son`}: se ${n === 1 ? 'guarda' : 'guardan'} aquí y me lo dices.`,
  }
  const orden: CaminoSubida[] = ['catcher', 'facturas', 'extracto', 'sin_saber']
  return orden.flatMap((c) => {
    const ficheros = fs.map((f, i) => ({ nombre: f.nombre, i })).filter((x) => camino[x.i] === c)
    return ficheros.length ? [{ camino: c, ficheros, texto: textos[c](ficheros.length) }] : []
  })
}

// ── «Pedírsela» ─────────────────────────────────────────────────────────────

/** El correo que se propone (se revisa antes de enviar: lo manda la persona desde el suyo). */
export function correoPedirla(x: { empresa: string; que: string; hacia: string; direccion: string | null }): { asunto: string; cuerpo: string } {
  const asunto = `${x.que} · ${x.empresa}`
  const cuerpo = [
    'Hola:',
    '',
    `No nos ha llegado todavía: ${x.que.charAt(0).toLowerCase()}${x.que.slice(1)} (solía llegar hacia el ${ddmm(x.hacia)}).`,
    x.direccion ? `¿Nos la podéis mandar a ${x.direccion}? Así entra sola en la contabilidad.` : '¿Nos la podéis mandar por correo?',
    '',
    'Gracias.',
    x.empresa,
  ].join('\n')
  return { asunto, cuerpo }
}
