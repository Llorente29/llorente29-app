// src/modules/conta/lib/documentosMes.ts
//
// V02d · Inicio › Documentos, rehecho para que se venda (tableros 22, 23 y 24,
// Julio 25/10). Núcleo puro, sin React ni base: se prueba con las fuentes
// reales de Foodint (tests/unit/modules/conta/v02/documentosMes.test.ts).
//
//   · La cabecera del mes: «Tienes X de Y documentos que esperas este mes»,
//     con lo que ya está, lo que se retrasa y lo que aún está a tiempo.
//   · Dos columnas, según quién tiene que hacer algo: «Te lo tienen que
//     mandar» (se le puede pedir a alguien: proveedores, gestoría, suministros
//     y alquileres) y «Lo tienes que subir tú» (solo lo puede descargar el
//     usuario: las plataformas y el banco).
//   · Cada fila, en palabras de la calle: el nombre bien escrito (no en
//     mayúsculas), qué falta y su aviso (gris «Aún a tiempo», ámbar «Se
//     retrasa N días», rojo solo «Hace más de un mes»). Los alquileres se
//     nombran por su local, nunca por la persona.
//   · «Qué esperas cada mes» (tablero 23): los grupos, cada uno con su
//     recuento, y cada fila con su ritmo. Las personas solo se ven ahí.

import {
  diasEntre, estadoTarde, faltaDe, haLlegado, nombreDelLocal, ocurrencias, queSeEspera, radio, sumarDias,
  type DatosFuentes, type EstadoFalta, type Familia, type Fuente, type Local, type Ocurrencia, type TipoFuente,
} from './puerta'

// ── Los nombres ─────────────────────────────────────────────────────────────

const CONECTORES = new Set(['y', 'e', 'de', 'del', 'la', 'las', 'los', 'el', 'en', 'a'])
/** Palabras que en el libro llegan sin tilde y en la calle la llevan. */
const TILDES: Record<string, string> = {
  moviles: 'Móviles', movil: 'Móvil', gomez: 'Gómez', fernandez: 'Fernández', maria: 'María', garcia: 'García', martinez: 'Martínez',
  rodriguez: 'Rodríguez', lopez: 'López', sanchez: 'Sánchez', perez: 'Pérez', gonzalez: 'González', hernandez: 'Hernández',
  jimenez: 'Jiménez', ramirez: 'Ramírez', alvarez: 'Álvarez', diaz: 'Díaz', munoz: 'Muñoz', dominguez: 'Domínguez', vazquez: 'Vázquez',
  gutierrez: 'Gutiérrez', ruiz: 'Ruiz', martin: 'Martín', ines: 'Inés', angel: 'Ángel', jose: 'José', ramon: 'Ramón', jesus: 'Jesús',
  asesoria: 'Asesoría', gestoria: 'Gestoría', energia: 'Energía', telefonica: 'Telefónica', panaderia: 'Panadería', carniceria: 'Carnicería',
}
/** La forma jurídica del final («, S.L.», «SAU», «S.A.U.»…), que en la calle no se dice. La comunidad de bienes se queda. */
const FORMA = /[\s,]+(s\.?\s?l\.?\s?u?\.?|s\.?\s?a\.?\s?u?\.?|s\.?\s?l\.?\s?l\.?|s\.?\s?coop\.?)\s*$/i

/**
 * El nombre como se dice: sin la forma jurídica del final y, si viene todo en
 * mayúsculas (como lo deja el libro), con mayúscula solo al principio de cada
 * palabra y sus tildes de siempre. «TSPOONLAB, S.L.» → «Tspoonlab»;
 * «XFERA MOVILES, S.A.U.» → «Xfera Móviles»; «JUAN GRANDE SANCHO Y HERMANAS,
 * C.B.» → «Juan Grande Sancho y Hermanas, C.B.».
 */
export function nombreBonito(nombre: string): string {
  let n = nombre.trim().replace(/\s+/g, ' ')
  for (let i = 0; i < 3 && FORMA.test(n); i++) n = n.replace(FORMA, '').trim()
  n = n.replace(/,\s*$/, '')
  if (/[a-záéíóúñü]/.test(n)) return n
  return n.split(' ').map((p, i) => {
    if (/^c\.?b\.?$/i.test(p)) return 'C.B.'
    const bajo = p.toLowerCase()
    const limpio = bajo.replace(/[^a-záéíóúñü]/g, '')
    if (i > 0 && CONECTORES.has(bajo)) return bajo
    if (TILDES[limpio]) return p.replace(new RegExp(limpio, 'i'), TILDES[limpio])
    return bajo.charAt(0).toUpperCase() + bajo.slice(1)
  }).join(' ')
}

/** «JustEat» → «Just Eat»; «Glovo» se queda. */
const separar = (n: string) => n.replace(/([a-z])([A-Z])/g, '$1 $2').trim()

/**
 * Las letras del círculo: una sigla si el nombre la tiene («Asesoría QBO» →
 * «QBO», «BBVA ···4417» → «BB»); si no, la primera de las dos primeras
 * palabras que cuentan («Last Systems» → «LS»; «Iberdrola» → «I»).
 */
export function iniciales(nombre: string): string {
  const palabras = nombre.split(/\s+/).filter((p) => /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(p))
  const sigla = palabras.find((p) => /^[A-ZÁÉÍÓÚÑ]{2,}$/.test(p))
  if (sigla) return sigla.length <= 3 ? sigla : sigla.slice(0, 2)
  const cuentan = palabras.filter((p, i) => i === 0 || !CONECTORES.has(p.toLowerCase()))
  return cuentan.slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('') || '·'
}

/** El nombre de una fila de Documentos (tablero 22): nunca una persona en los alquileres. */
function nombreDeFila(f: Fuente): string {
  if (f.familia === 'alquiler') return f.local ? `Alquiler de ${nombreDelLocal(f.local)}` : 'Alquileres'
  return nombreDeFuente(f)
}

/** El nombre de una fuente, bien escrito (en «Qué esperas cada mes» sí salen las personas). */
export function nombreDeFuente(f: Fuente): string {
  if (f.familia === 'plataforma' && f.tipo !== 'riders' && f.canal) return separar(f.canal.nombre)
  if (f.tipo === 'intermediario') return separar(f.nombre.replace(/\s*·\s*liquidaciones$/i, ''))
  if (f.tipo === 'banco') return f.nombre.replace(/^Extracto\s*·\s*/i, '')
  if (f.tipo === 'nominas') return f.nombre.includes('·') ? f.nombre.split('·').slice(1).join('·').trim() : 'Gestoría'
  if (f.tipo === 'riders') return f.nombre
  return nombreBonito(f.nombre)
}

// ── Las familias y las columnas ─────────────────────────────────────────────

/** La familia de una fuente: la que diga la base o, si no la dice, la de su tipo. */
export function familiaDe(f: Pick<Fuente, 'familia' | 'tipo'>): Familia {
  if (f.familia) return f.familia
  return f.tipo === 'alquiler' ? 'alquiler' : f.tipo === 'nominas' ? 'gestoria' : f.tipo === 'banco' ? 'banco'
    : f.tipo === 'intermediario' || f.tipo === 'riders' ? 'plataforma' : 'proveedor'
}

export type Columna = 'mandar' | 'subir'
/**
 * «Te lo tienen que mandar»: lo que se le puede pedir a alguien (proveedores,
 * gestoría, suministros y alquileres). «Lo tienes que subir tú»: lo que solo
 * puede descargar el usuario (las plataformas, desde su portal, y el banco).
 */
export const columnaDe = (f: Pick<Fuente, 'familia' | 'tipo'>): Columna => {
  const x = familiaDe(f)
  return x === 'plataforma' || x === 'banco' ? 'subir' : 'mandar'
}

export const GRUPOS: { familia: Familia; titulo: string }[] = [
  { familia: 'alquiler', titulo: 'Alquileres' },
  { familia: 'suministro', titulo: 'Luz, agua y teléfono' },
  { familia: 'proveedor', titulo: 'Proveedores' },
  { familia: 'plataforma', titulo: 'Plataformas y reparto' },
  { familia: 'gestoria', titulo: 'Gestoría y nóminas' },
  { familia: 'banco', titulo: 'Banco' },
]

// ── Los avisos ──────────────────────────────────────────────────────────────

export type Tono = 'gris' | 'ambar' | 'rojo'
export interface Aviso { tono: Tono; texto: string }
/** Gris «Aún a tiempo»; ámbar «Se retrasa N días»; rojo solo «Hace más de un mes». */
export const avisoDe = (e: EstadoFalta): Aviso =>
  e.que === 'a_tiempo' ? { tono: 'gris', texto: e.texto } : { tono: e.grave ? 'rojo' : 'ambar', texto: e.texto }

// ── Documentos (tablero 22): las filas de cada columna ──────────────────────

export interface FilaDoc {
  clave: string
  columna: Columna
  /** Las fuentes de la fila y el día que se espera de cada una («Ya lo tengo»). */
  fuentes: { id: string; dia: string }[]
  familia: Familia
  tipo: TipoFuente
  inicial: string
  nombre: string
  que: string
  aviso: Aviso
  /** Días de retraso (0 si aún está a tiempo). */
  dias: number
  hacia: string
  correo: string | null
  proveedorId: string | null
  pedida: Fuente['pedida']
}

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const mesDe = (iso: string) => MES[Number(iso.slice(5, 7)) - 1]
const peso = (e: EstadoFalta) => (e.que === 'tarde' ? 1000 + e.dias : 0)

/** En qué fila va una fuente: los alquileres juntos por local, cada plataforma junta con su factura de comisiones. */
function claveDeFila(f: Fuente): string {
  const x = familiaDe(f)
  if (x === 'alquiler') return `alquiler:${f.local?.id ?? 'sin'}`
  if (x === 'plataforma' && f.canal) return `canal:${f.canal.id}`
  return f.id
}

/**
 * Las filas de Documentos, en sus dos columnas: lo que va tarde primero (lo más
 * tarde arriba) y luego lo que aún está a tiempo (lo más cercano arriba). Nada
 * se esconde: la pantalla enseña tres y «Ver todo» enseña el resto.
 */
export function filasDocumentos(d: DatosFuentes, hoy: string, horizonte = 14): { mandar: FilaDoc[]; subir: FilaDoc[] } {
  if (!d.ajustes.lo_que_falta) return { mandar: [], subir: [] }
  const grupos = new Map<string, { f: Fuente; o: Ocurrencia; estado: EstadoFalta }[]>()
  for (const f of d.fuentes) {
    const x = faltaDe({ ...f, familia: familiaDe(f) }, hoy, d.ajustes.margen, horizonte, d.corte ?? null)
    if (!x) continue
    const k = claveDeFila(f)
    grupos.set(k, [...(grupos.get(k) ?? []), { f: { ...f, familia: familiaDe(f) }, ...x }])
  }
  const filas: FilaDoc[] = []
  for (const [clave, xs] of grupos) {
    const orden = [...xs].sort((a, b) => peso(b.estado) - peso(a.estado) || a.o.dia.localeCompare(b.o.dia))
    const peor = orden[0]
    const f = peor.f
    const familia = familiaDe(f)
    let que = queSeEspera(f, peor.o)
    if (familia === 'alquiler') {
      const n = d.fuentes.filter((y) => y.activa && !y.cubierta && claveDeFila(y) === clave).length
      const tarde = xs.filter((x) => x.estado.que === 'tarde').length
      const faltan = tarde || xs.length
      const mes = mesDe(peor.o.dia)
      que = n <= 1 ? `El de ${mes}` : faltan === n ? `Los ${n} de ${mes}` : `Falta${faltan === 1 ? '' : 'n'} ${faltan} de ${n} de ${mes}`
    } else if (familia === 'plataforma' && xs.length > 1) {
      const liq = orden.find((x) => x.f.tipo === 'intermediario')
      if (liq) que = `${queSeEspera(liq.f, liq.o)} y su factura de comisiones`
    } else if (f.local && familia !== 'plataforma') {
      que = `${que} · ${nombreDelLocal(f.local)}`
    }
    const nombre = nombreDeFila(f)
    filas.push({
      clave, columna: columnaDe(f), familia, tipo: f.tipo,
      fuentes: xs.map((x) => ({ id: x.f.id, dia: x.o.dia })),
      inicial: iniciales(nombre), nombre, que, aviso: avisoDe(peor.estado),
      dias: peor.estado.que === 'tarde' ? peor.estado.dias : 0, hacia: peor.o.dia,
      correo: xs.length === 1 || familia !== 'alquiler' ? f.correo ?? null : xs.map((x) => x.f.correo).find(Boolean) ?? null,
      proveedorId: xs.length === 1 ? f.proveedor_id : null, pedida: xs.length === 1 ? f.pedida : null,
    })
  }
  const ordenar = (a: FilaDoc, b: FilaDoc) => (b.dias - a.dias) || (a.dias === 0 && b.dias === 0 ? a.hacia.localeCompare(b.hacia) : 0) || a.nombre.localeCompare(b.nombre)
  return {
    mandar: filas.filter((x) => x.columna === 'mandar').sort(ordenar),
    subir: filas.filter((x) => x.columna === 'subir').sort(ordenar),
  }
}

/** Lo que se enseña de una columna (3) y lo que queda detrás de «Ver todo», dicho como en el tablero. */
export function primeras(filas: readonly FilaDoc[], n = 3): { vistas: FilaDoc[]; resto: number; texto: string | null } {
  const vistas = filas.slice(0, n)
  const resto = filas.length - vistas.length
  if (resto <= 0) return { vistas, resto: 0, texto: null }
  const atiempo = filas.slice(n).every((x) => x.aviso.tono === 'gris')
  return { vistas, resto, texto: `Y ${resto} ${resto === 1 ? 'más' : 'más'}${atiempo ? ` que aún ${resto === 1 ? 'está' : 'están'} a tiempo` : ''}` }
}

// ── La cabecera del mes ─────────────────────────────────────────────────────

const finDeMes = (iso: string) => {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

export interface CabeceraMes { mes: string; total: number; ya: number; retrasan: number; aTiempo: number }

/**
 * «Tienes X de Y documentos que esperas este mes»: cada cosa que se espera
 * este mes (desde el corte de la empresa) de lo que está encendido; ya está si
 * ha llegado, se retrasa si pasó su día más el margen, y si no, aún a tiempo.
 */
export function cabeceraMes(d: DatosFuentes, hoy: string): CabeceraMes {
  const inicio = `${hoy.slice(0, 7)}-01`
  const desde = d.corte && d.corte > inicio ? d.corte : inicio
  const hasta = finDeMes(hoy)
  let ya = 0, retrasan = 0, aTiempo = 0
  if (d.ajustes.lo_que_falta) {
    for (const f of d.fuentes) {
      if (!f.activa || f.cubierta) continue
      const margen = f.margen ?? d.ajustes.margen
      const primera = f.llegadas[0] ?? null
      for (const o of ocurrencias(f, desde, hasta)) {
        if (primera && diasEntre(primera, o.dia) < -radio(f)) continue
        if (haLlegado(f, o)) ya++
        else if (diasEntre(o.dia, hoy) > margen) retrasan++
        else aTiempo++
      }
    }
  }
  return { mes: mesDe(hoy), total: ya + retrasan + aTiempo, ya, retrasan, aTiempo }
}

// ── «Qué esperas cada mes» (tablero 23) ─────────────────────────────────────

export interface FilaEsperas {
  clave: string
  ids: string[]
  familia: Familia
  inicial: string
  nombre: string
  detalle: string
  activa: boolean
  /** «sin facturas desde julio» si lleva meses sin llegar (y no está encendida). */
  dormida: string | null
  local: Local | null
  /** El selector de local: solo alquileres y suministros, y solo si la empresa tiene más de uno. */
  pideLocal: boolean
}
export interface GrupoEsperas { familia: Familia; titulo: string; recuento: string; filas: FilaEsperas[] }

const DIA_SEMANA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** «cada mes, hacia el día 5», «cada mes, a fin de mes», «cada quincena», «cada semana, el domingo». */
export function ritmo(f: Pick<Fuente, 'cadencia' | 'dia' | 'dia_semana' | 'cada' | 'tipo'>): string {
  if (f.cadencia === 'mensual') {
    const dia = f.dia ?? 1
    return dia >= 28 ? 'cada mes, a fin de mes' : dia <= 1 ? 'cada mes, el día 1' : `cada mes, hacia el día ${dia}`
  }
  if (f.cadencia === 'quincenal') return f.tipo === 'riders' ? 'cada quincena, el 15 y a fin de mes' : 'cada quincena'
  if (f.cadencia === 'semanal') return f.dia_semana ? `cada semana, el ${DIA_SEMANA[f.dia_semana]}` : 'cada semana'
  return `varias al mes · avisar si pasan ${f.cada ?? 10} días sin ninguna`
}

const QUE_ES: Partial<Record<Familia, string>> = { alquiler: 'Alquiler', suministro: 'Suministro', gestoria: 'Nóminas', banco: 'Movimientos' }

/** ¿Lleva meses sin llegar? Tres periodos sin nada (lo mismo que apaga la base sola). */
function dormidaDesde(f: Fuente, hoy: string): string | null {
  const ultima = f.llegadas.length ? f.llegadas[f.llegadas.length - 1] : null
  const periodo = f.cadencia === 'mensual' ? 31 : f.cadencia === 'quincenal' ? 16 : f.cadencia === 'semanal' ? 7 : f.cada ?? 10
  if (ultima && diasEntre(ultima, hoy) <= 3 * periodo + (f.margen ?? 5)) return null
  return ultima ? `sin facturas desde ${mesDe(ultima)}` : 'sin facturas en los últimos meses'
}

/** Las palabras finales que comparten varios nombres («Gómez Antonio»), si las hay. */
function apellidosComunes(nombres: readonly string[]): string | null {
  const partes = nombres.map((n) => nombreBonito(n).split(' '))
  const comun: string[] = []
  for (let i = 1; i <= Math.min(...partes.map((p) => p.length)); i++) {
    const w = partes[0][partes[0].length - i]
    if (partes.every((p) => p[p.length - i] === w)) comun.unshift(w); else break
  }
  return comun.length ? comun.join(' ') : null
}

export function gruposEsperas(d: DatosFuentes, hoy: string): GrupoEsperas[] {
  const variosLocales = (d.locales ?? []).length > 1
  const porClave = new Map<string, Fuente[]>()
  for (const f0 of d.fuentes) {
    const f = { ...f0, familia: familiaDe(f0) }
    // En «Qué esperas», los alquileres van juntos solo si comparten local; las plataformas, con su factura.
    const k = f.familia === 'alquiler' ? (f.local ? `alquiler:${f.local.id}` : f.id) : f.familia === 'plataforma' && f.canal ? `canal:${f.canal.id}` : f.id
    porClave.set(k, [...(porClave.get(k) ?? []), f])
  }
  const filas: FilaEsperas[] = []
  for (const [clave, fs] of porClave) {
    const f = fs.find((x) => x.tipo === 'intermediario') ?? fs[0]
    const familia = familiaDe(f)
    let nombre = nombreDeFuente(f)
    let detalle = `${QUE_ES[familia] ? `${QUE_ES[familia]} · ` : ''}${ritmo(f)}`
    if (familia === 'alquiler' && fs.length > 1) {
      const comunes = apellidosComunes(fs.map((x) => x.nombre))
      nombre = comunes ? `${comunes} (${fs.length} personas)` : `${fs.length} personas`
      detalle = `Alquiler · ${fs.length} facturas ${ritmo(f)}`
    } else if (familia === 'plataforma' && fs.length > 1) {
      detalle = `Liquidación ${ritmo(f)} · y su factura de comisiones`
    } else if (f.tipo === 'intermediario') {
      detalle = `Liquidación ${ritmo(f)}`
    } else if (f.tipo === 'riders') {
      detalle = `Facturas de los riders ${ritmo(f)}`
    }
    const activa = fs.some((x) => x.activa)
    filas.push({
      clave, ids: fs.map((x) => x.id), familia, inicial: iniciales(nombre), nombre, detalle, activa,
      dormida: activa ? null : dormidaDesde(f, hoy), local: f.local ?? null,
      pideLocal: variosLocales && (familia === 'alquiler' || familia === 'suministro'),
    })
  }
  return GRUPOS.map(({ familia, titulo }) => {
    const xs = filas.filter((x) => x.familia === familia).sort((a, b) => Number(b.activa) - Number(a.activa) || a.nombre.localeCompare(b.nombre))
    const apagadas = xs.filter((x) => !x.activa).length
    let recuento = `${xs.length}${apagadas ? ` · ${apagadas} ${apagadas === 1 ? 'apagado' : 'apagados'}` : ''}`
    if (familia === 'alquiler') {
      const fuentes = d.fuentes.filter((f) => familiaDe(f) === 'alquiler' && f.activa)
      const locales = new Set(fuentes.map((f) => f.local?.id).filter(Boolean)).size
      recuento = `${locales ? `${locales} ${locales === 1 ? 'local' : 'locales'} · ` : ''}${fuentes.length} ${fuentes.length === 1 ? 'factura' : 'facturas'} al mes`
    }
    return { familia, titulo, recuento, filas: xs }
  }).filter((g) => g.filas.length > 0)
}

/** Para «Ya lo tengo»: el día que se espera de cada fuente de la fila (si no lo hay, hoy). */
export const diasDeFila = (x: FilaDoc, hoy: string) => x.fuentes.map((y) => ({ id: y.id, dia: y.dia || hoy }))

/** «Lo de octubre ya está en su sitio»: lo que se dice cuando no falta nada en una columna. */
export const nadaEnColumna = (c: Columna) => (c === 'mandar' ? 'Nadie te debe nada este mes.' : 'No tienes nada que subir.')

export { sumarDias, estadoTarde }
