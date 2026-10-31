// src/modules/conta/documentos/documentos.ts
//
// D01 · N22 «Documentos › Facturas recibidas»: lo que la pantalla decide, sin
// React ni red (lo prueba tests/conta/d01/documentosPantalla.test.ts). Los datos
// salen de conta_documentos_recibidos (0280).
//
// Las reglas que pesan aquí:
//   · Regla 7: «Todas» trae todas; un filtro ordena y etiqueta, no esconde lo
//     que existe. Las cifras cuentan cada estado.
//   · Lo que no funciona no se enseña (R2): «Por correo» sale en la barra solo
//     con el correo de la empresa encendido; «De Cocina», solo si la empresa
//     recibe la mercancía con Folvy y la cuenta no es solo de contabilidad.
//   · Las cuentas, siempre nombre · código.

import { calcularVencimiento } from '@/modules/conta/lib/cifras'
import { MARCA } from '@/modules/conta/cuenta/marca'

/**
 * R6 · 'en_diez': una recepción de antes del corte cuyo papel es una factura. La
 * llevó el programa anterior: sale (en «Todas») enlazada con su asiento traído
 * de Diez si casa, y nunca se apunta otra vez.
 */
/** S01 (0160) · 'descartada': «No es una factura», con su motivo; sale en «Todas» y se deshace. */
/** S01g (0931) · 'soporte': una recepción que es soporte de la liquidación mensual de un socio (CTB): no se apunta como compra. */
export type Estado = 'para_mirar' | 'por_aclarar' | 'apuntada' | 'repetida' | 'en_diez' | 'descartada' | 'soporte'
export type Canal = 'correo' | 'subida' | 'cocina' | 'portal' | 'compras' | 'a_mano'
export type Confianza = 'seguro' | 'probable' | 'duda'

export interface FilaDocumento {
  id: string
  /** R6 · 'recepcion': una recepción cuyo documento es una factura y que no es (o no hace falta que sea) factura en Folvy. */
  tipo: 'factura' | 'llegada' | 'recepcion'
  estado: Estado
  proveedor: { id: string | null; nombre: string | null }
  numero: string | null
  fecha: string | null
  total: number | null
  canal: Canal
  confianza: Confianza | null
  porque: string | null
  /** La cuenta de gasto: del asiento, de su ficha o, sin nada de eso, lo aprendido (`sin_confirmar`). */
  entendido: { cuenta: string; nombre: string; origen: string; sin_confirmar?: boolean } | null
  /** R5 · 6: lo aprendido de sus facturas anteriores, cuando ni el asiento ni la ficha dicen la cuenta. */
  aprendido?: { cuenta: string | null; facturas: number; confianza: string | null; porque: string | null } | null
  /** R5 · 6: cuántas facturas suyas había antes de esta. */
  previas?: number
  /** R5 · 7: el tipo del fichero con que llegó (una foto o un PDF), si llegó con fichero. */
  llegada_tipo?: string | null
  /** R6 · Su asiento traído de Diez, si casa (proveedor, número y total). */
  diez?: { id: string; serie: number; numero: number; fecha: string } | null
  /** R6 · El papel de la recepción (receipt-uploads). */
  papel?: string | null
  recepcion: { fecha: string; local: string | null } | null
  /** S01g · Solo las de soporte: de qué liquidación (proveedor, mes y local) y la liquidación, si ya está. */
  soporte?: Soporte | null
  asiento: { id: string; estado: string; solo: boolean } | null
  llego: string
  archivo?: string | null
}

/** S01g · El soporte de una liquidación mensual (conta_documentos_recibidos, 0931). */
export interface Soporte {
  proveedor_id: string | null; proveedor: string | null
  /** 'AAAA-MM' */
  mes: string
  local: string | null; local_id: string | null
  /** El código de la recepción (ALB-…): así viene en las líneas del cruce de la liquidación. */
  codigo: string | null
  liquidacion: { id: string; desde: string; hasta: string } | null
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «CLOUDTOWN BRANDS, S.L.» → «Cloudtown Brands»: sin la forma jurídica y sin mayúsculas sostenidas. No se inventa una sigla. */
export function nombreCortoProveedor(nombre: string | null | undefined): string {
  const sin = (nombre ?? '').replace(/,?\s*\b(S\.?\s?L\.?(\s?U\.?)?|S\.?\s?A\.?(\s?U\.?)?|S\.?\s?C\.?|S\.?\s?COOP\.?)\s*$/i, '').trim()
  if (!sin) return 'su proveedor'
  return sin === sin.toUpperCase() ? sin.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase()) : sin
}

/** «oct 2026» / «octubre». */
export const mesCorto = (mes: string) => `${MESES_CORTOS[Number(mes.slice(5, 7)) - 1] ?? mes} ${mes.slice(0, 4)}`
export const mesLargoDe = (mes: string) => MESES_LARGOS[Number(mes.slice(5, 7)) - 1] ?? mes

/** La etiqueta de una recepción de soporte: «Soporte · Cloudtown Brands · oct 2026 · Foodint Alcalá». */
export function etiquetaSoporte(s: Soporte): string {
  return ['Soporte', nombreCortoProveedor(s.proveedor), mesCorto(s.mes), s.local].filter(Boolean).join(' · ')
}

export interface Esperada { supplier_id: string; supplier_name: string; label: string | null; periodo: string; ultima: string | null; pedida: string | null }

export interface DatosDocumentos {
  desde: string
  hasta: string
  correo: { activo: boolean; direccion: string | null }
  recibe_mercancia: boolean
  filas: FilaDocumento[]
  esperadas: Esperada[]
  cifras: {
    llegadas: number
    llegadas_por_canal: Partial<Record<Canal, number>>
    apuntadas_solas: number
    apuntadas: number
    para_mirar: number
    por_aclarar: number
    /** S01g · Las recepciones de soporte de una liquidación (en «Otras»). */
    soporte?: number
    esperadas_no_llegadas: number
  }
}

export type Ver = 'para-mirar' | 'por-aclarar' | 'apuntadas' | 'todas'
export const VERES: { id: Ver; nombre: string }[] = [
  { id: 'para-mirar', nombre: 'Para mirar' },
  { id: 'por-aclarar', nombre: 'Por aclarar' },
  { id: 'apuntadas', nombre: 'Apuntadas' },
  { id: 'todas', nombre: 'Todas' },
]
export const verDe = (x: string | null): Ver => (VERES.some((v) => v.id === x) ? (x as Ver) : 'para-mirar')

const ESTADO_DE: Record<Exclude<Ver, 'todas'>, Estado[]> = { 'para-mirar': ['para_mirar'], 'por-aclarar': ['por_aclarar'], apuntadas: ['apuntada'] }

/** Las filas de un filtro. «Todas» son todas, también las repetidas (regla 7). */
export function filtrar(filas: readonly FilaDocumento[], ver: Ver): FilaDocumento[] {
  if (ver === 'todas') return [...filas]
  return filas.filter((f) => ESTADO_DE[ver].includes(f.estado))
}

/**
 * S01c · Las facturas de una vista, en el orden en que se recorren una a una
 * (la última que llegó primero). La base ordena solo por la llegada, y con
 * empates el orden cambia entre dos lecturas: la que abre «Recibida» y la que
 * cuenta «1 de N» no eran la misma. El id desempata, igual en los dos sitios.
 */
export function facturasEnOrden(filas: readonly FilaDocumento[], ver: Ver): string[] {
  return filtrar(filas, ver).filter((x) => x.tipo === 'factura')
    .sort((a, b) => (a.llego === b.llego ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.llego < b.llego ? 1 : -1))
    .map((x) => x.id)
}

const n = (x: number) => new Intl.NumberFormat('es-ES').format(x)
const plural = (k: number, uno: string, varios: string) => `${n(k)} ${k === 1 ? uno : varios}`

/** «Correo 24 · Cocina 9 · subidas 5»: por dónde llegaron, en el orden de la maqueta. Vendido solo, sin la palabra Cocina. */
export function porDonde(c: DatosDocumentos['cifras']['llegadas_por_canal'], solo = false): string {
  const partes: string[] = []
  if (c.correo) partes.push(`correo ${n(c.correo)}`)
  if (c.cocina) partes.push(`${solo ? 'recepciones' : 'Cocina'} ${n(c.cocina)}`)
  if (c.subida) partes.push(`${c.subida === 1 ? 'subida' : 'subidas'} ${n(c.subida)}`)
  if (c.portal) partes.push(`portal ${n(c.portal)}`)
  if (c.compras) partes.push(`${solo ? 'leídas' : 'Compras'} ${n(c.compras)}`)
  if (c.a_mano) partes.push(`a mano ${n(c.a_mano)}`)
  return partes.join(' · ') || 'ninguna'
}

/** «octubre»: el mes del periodo elegido ('YYYY-MM-DD'). R5 · 8: las cifras y la banda hablan de él, no de «esta semana». */
export const nombreDelMes = (desde: string): string =>
  new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(`${desde.slice(0, 7)}-01T00:00:00Z`))

/** «alquiler de octubre», «Telefonía Norte de septiembre». Sin artículo: de una
 *  etiqueta libre no se sabe el género («la de la luz», «la del alquiler»). */
function laQueFalta(e: Esperada): string {
  const mes = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(`${e.periodo}T00:00:00Z`))
  return `${e.label ? e.label.toLowerCase() : e.supplier_name} de ${mes}`
}

/**
 * La banda de la IA: lo que ha pasado en una frase, y si hay algo que pedir.
 * R5 · 8: del mes elegido. R5 · 5: ámbar si queda algo por mirar o por aclarar;
 * el verde, para cuando todo está apuntado.
 */
export function banda(d: DatosDocumentos): { titulo: string; porque: string | null; pedir: boolean; tono: 'verde' | 'ambar' } {
  const c = d.cifras
  const mes = nombreDelMes(d.desde)
  const llegadas = c.llegadas === 0
    ? `En ${mes} no ha llegado ninguna factura.`
    : `${c.llegadas === 1 ? 'Ha llegado' : 'Han llegado'} ${plural(c.llegadas, 'factura', 'facturas')} en ${mes}.`
  const pendientes = c.para_mirar + c.por_aclarar
  const quedan = pendientes === 0
    ? 'no te queda ninguna por mirar'
    : `te ${pendientes === 1 ? 'queda' : 'quedan'} ${[c.para_mirar ? `${n(c.para_mirar)} por mirar` : '', c.por_aclarar ? `${n(c.por_aclarar)} por aclarar` : ''].filter(Boolean).join(' y ')}`
  const solas = c.apuntadas_solas > 0 ? `${plural(c.apuntadas_solas, 'la he apuntado yo', 'las he apuntado yo')}; ` : ''
  const resto = `${solas}${quedan}.`
  const titulo = `${llegadas} ${resto.charAt(0).toUpperCase()}${resto.slice(1)}`
  const faltan = d.esperadas.filter((e) => !e.pedida)
  const porque = faltan.length === 0 ? null
    : `${faltan.length === 1 ? 'Falta la factura de' : 'Faltan las facturas de'} ${faltan.slice(0, 3).map(laQueFalta).join(faltan.length === 2 ? ' y ' : ', ')}${faltan.length > 3 ? ` y ${faltan.length - 3} más` : ''}: el mes pasado ya ${faltan.length === 1 ? 'había' : 'habían'} llegado.`
  return { titulo, porque, pedir: faltan.length > 0, tono: pendientes > 0 ? 'ambar' : 'verde' }
}

/**
 * Por dónde llegó, como lo dice la fila, en minúscula y lo que pasó de verdad
 * (R5 · 7): «llegó por correo», «foto subida», «PDF subido», «escrita a mano».
 * De una subida se sabe si fue una foto o un PDF, no desde qué aparato: no se
 * dice «desde el móvil». Vendido solo, sin la palabra Cocina ni Compras.
 */
export function comoLlego(canal: Canal | string | null, tipo: string | null | undefined, solo = false): string {
  switch (canal) {
    case 'correo': return 'llegó por correo'
    case 'subida': return /^image\//.test(tipo ?? '') ? 'foto subida' : /pdf/.test(tipo ?? '') ? 'PDF subido' : 'subida'
    case 'cocina': return solo ? 'de su recepción' : 'de su recepción en Cocina'
    case 'portal': return 'llegó del portal'
    case 'compras': return solo ? 'leída de su recepción' : 'leída en Compras'
    case 'a_mano': return 'escrita a mano'
    default: return ''
  }
}

const frase = (x: string) => (/[.!?…:]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`)

/**
 * Lo que Folvy ha entendido, como lo dice la fila. Las cuentas, nombre · código.
 * R5 · 6: cada fila dice su porqué y qué hacer, también la que no tiene lectura
 * (escrita a mano) o no tiene cuenta todavía. Nunca solo «Sin cuenta».
 */
export function entendido(f: FilaDocumento, solo = false): { titulo: string; porque: string | null } {
  if (f.tipo === 'llegada') return { titulo: f.archivo ? `«${f.archivo}»` : 'Un documento sin leer', porque: f.porque ?? 'Ha llegado y aún no la he leído.' }
  if (f.tipo === 'recepcion' && f.estado === 'soporte') {
    return { titulo: 'Soporte de la liquidación · no se apunta como compra', porque: f.porque ?? null }
  }
  if (f.tipo === 'recepcion') {
    const titulo = f.estado === 'en_diez' ? (f.diez ? `Ya en Diez · asiento ${f.diez.serie}/${f.diez.numero}` : 'De antes del corte · la llevó Diez') : 'Leída por la recepción · aún no es factura'
    return { titulo, porque: f.porque ?? 'La leyó la recepción.' }
  }
  if (!f.proveedor.id) return { titulo: 'No reconozco el emisor', porque: f.porque ?? 'No reconozco el emisor: dime quién es.' }
  const e = f.entendido
  const cuenta = e ? `${e.nombre} · ${e.cuenta}${e.sin_confirmar ? ' · sin confirmar' : ''}` : 'Sin cuenta de gasto todavía'
  const casa = f.recepcion ? ` · casa con la recepción del ${diaMes(f.recepcion.fecha)}` : ''
  const partes: string[] = []
  if (f.porque) partes.push(frase(f.porque))
  if (f.estado !== 'apuntada') {
    if (!e) {
      const previas = f.previas ?? null
      partes.push(previas === 0 ? 'Es la primera factura de este proveedor: elige dónde se apunta y lo recuerdo.'
        : previas ? `${previas === 1 ? 'Hay una factura suya anterior' : `Hay ${n(previas)} facturas suyas anteriores`}, pero ${previas === 1 ? 'no está apuntada' : 'ninguna está apuntada'}: elige dónde se apunta y lo recuerdo.`
          : 'Su ficha no dice dónde se apunta: elígelo y lo recuerdo.')
    } else if (e.sin_confirmar) {
      partes.push(`${frase(f.aprendido?.porque ?? `Lo he aprendido de sus facturas anteriores (${e.origen})`)} Confírmalo y lo recuerdo.`)
    } else if (!f.porque) {
      const como = f.canal === 'a_mano' ? 'La escribieron a mano y no la he leído: comprueba los importes con la factura.'
        : f.canal === 'compras' ? `La leyeron en ${solo ? 'otra pantalla' : 'Compras'}: comprueba los importes con la factura.`
          : 'Comprueba los importes con la factura.'
      const va = e.origen === 'de su ficha' ? 'Va a su cuenta de siempre, la de su ficha.'
        : e.origen === 'del asiento' ? 'Va a la cuenta de su asiento, ya propuesto.' : `Va a esta cuenta (${e.origen}).`
      partes.push(`${va} ${como}`)
    }
  }
  return { titulo: `${cuenta}${casa}`, porque: partes.length ? partes.join(' ') : null }
}

/** El único botón de la fila. */
export function boton(f: FilaDocumento): { texto: string; principal: boolean } {
  // R6 · Una recepción no se apunta desde aquí: se ve lo que leyó (Julio, 21/10: por lo que es, nunca «papel»).
  if (f.tipo === 'recepcion' && f.estado === 'soporte') return { texto: 'Ver con qué cuadra', principal: false }
  // S01g · Ninguna fila de «Por aclarar» se abre sin una acción que la resuelva (regla 8).
  if (f.tipo === 'recepcion' && f.estado === 'por_aclarar') return { texto: 'Aclarar', principal: true }
  if (f.tipo === 'recepcion') return { texto: 'Ver la factura', principal: false }
  if (f.tipo === 'llegada' && f.estado === 'por_aclarar') return { texto: faltaElPdf(f) ? 'Subir el PDF' : 'Leerla', principal: true }
  if (f.tipo === 'factura' && !f.proveedor.id) return { texto: 'Decirlo yo', principal: true }
  if (f.estado === 'para_mirar') return { texto: 'Mirar', principal: false }
  if (f.estado === 'por_aclarar') return { texto: f.tipo === 'llegada' ? 'Ver' : 'Aclarar', principal: false }
  return { texto: 'Ver', principal: false }
}

/** S01g · Una llegada a la que le falta el PDF (el correo traía un enlace). */
export const faltaElPdf = (f: Pick<FilaDocumento, 'tipo' | 'porque'>) => f.tipo === 'llegada' && /pdf/i.test(f.porque ?? '')

/** El punto de la fila: verde seguro, ámbar probable o para mirar, gris lo que no se sabe. */
export function punto(f: FilaDocumento): 'verde' | 'ambar' | 'gris' | 'rojo' {
  if (f.estado === 'apuntada') return 'verde'
  if (f.estado === 'en_diez') return f.diez ? 'verde' : 'gris'
  if (f.estado === 'repetida' || f.estado === 'descartada') return 'gris'
  if (f.confianza === 'duda' || f.tipo === 'llegada') return 'gris'
  return 'ambar'
}

export const diaMes = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')

/** Las entradas de la barra (tercer nivel), con lo que no funciona fuera. */
export interface EntradaBarra { id: string; nombre: string; dato: string; tono: 'verde' | 'ambar' | 'gris' }
export function barra(d: DatosDocumentos, o: { solo: boolean; producto: string | null }): { etiqueta: string; entradas: EntradaBarra[] }[] {
  const c = d.cifras
  // S01e: «Subir varias a la vez» (en lote), para no confundirlo con «Subir una factura» de Por revisar.
  const traer: EntradaBarra[] = [{ id: 'subir', nombre: 'Subir varias a la vez', dato: 'PDF o foto', tono: 'verde' }]
  if (d.correo.activo && d.correo.direccion) traer.push({ id: 'correo', nombre: 'Por correo', dato: d.correo.direccion.replace(/@.*/, '@…'), tono: 'verde' })
  if (d.recibe_mercancia && !o.solo) traer.push({ id: 'cocina', nombre: 'De Cocina', dato: 'recepciones', tono: 'verde' })
  const esperadas: EntradaBarra[] = [{
    id: 'fijas', nombre: 'Fijas del mes',
    dato: d.esperadas.length ? `${d.esperadas.slice(0, 2).map((e) => (e.label ?? e.supplier_name).toLowerCase()).join(', ')}${d.esperadas.length > 2 ? '…' : ''} · ${plural(c.esperadas_no_llegadas, 'falta', 'faltan')}` : 'ninguna falta',
    tono: c.esperadas_no_llegadas ? 'ambar' : 'gris',
  }]
  const leidas: EntradaBarra[] = [{ id: 'hecho', nombre: textos(o.producto).hecho, dato: `${plural(c.apuntadas_solas, 'apuntada sola', 'apuntadas solas')}`, tono: c.apuntadas_solas ? 'verde' : 'gris' }]
  return [{ etiqueta: 'Cómo llegan', entradas: traer }, { etiqueta: 'Las que faltan', entradas: esperadas }, { etiqueta: 'Apuntadas solas', entradas: leidas }]
}

/** Lo que cambia con el producto: con nombre («Folvy») o, vendido solo, en primera persona y sin él. */
/**
 * Documentos dentro de Folvy o como producto vendido solo (C06): vendido solo,
 * sin Cocina y sin nombre de producto (la pantalla habla en primera persona,
 * como la maqueta). `solo` es useProductoSolo(): la cuenta solo de
 * contabilidad (useCuentaConta().soloContabilidad) o una marca propia.
 */
export interface Producto { solo: boolean; nombre: string | null }
export function productoDeDocumentos(solo: boolean, nombreDeLaMarca: string): Producto {
  return { solo, nombre: solo ? null : nombreDeLaMarca }
}

export function textos(producto: string | null) {
  return producto
    ? { hecho: `Lo que ha hecho ${producto}`, entendido: `Lo que ${producto} ha entendido`, repetida: `Una factura repetida nunca entra dos veces: ${producto} la reconoce por su número y su total, venga por donde venga.` }
    : { hecho: 'Lo que he hecho yo', entendido: 'Lo que he entendido', repetida: 'Una factura repetida nunca entra dos veces: la reconozco por su número y su total, venga por donde venga.' }
}

/** Los doce meses hasta el de hoy, para el selector ('YYYY-MM'). */
export function meses(hoy: string): { valor: string; nombre: string }[] {
  const out: { valor: string; nombre: string }[] = []
  let y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7))
  for (let i = 0; i < 12; i++) {
    const valor = `${y}-${String(m).padStart(2, '0')}`
    const nombre = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${valor}-01T00:00:00Z`))
    out.push({ valor, nombre: nombre.charAt(0).toUpperCase() + nombre.slice(1).replace(' de ', ' ') })
    m -= 1; if (m === 0) { m = 12; y -= 1 }
  }
  return out
}

/** Primer y último día de un mes 'YYYY-MM'. */
export function limites(mes: string): { desde: string; hasta: string } {
  const y = Number(mes.slice(0, 4)), m = Number(mes.slice(5, 7))
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

/** El plazo de pago de la ficha del proveedor (supplier.payment_terms_days y payment_fixed_days). */
export interface PlazoFicha { dias: number | null; fijos: number[] }

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * R5 · 1 · El vencimiento de N23. Si la factura lo trae, manda el de la factura;
 * si además su ficha da otro día, se dice en ámbar. Sin vencimiento en la
 * factura, el de la ficha (que es el que se pondrá al aprobarla). Sin ninguno
 * de los dos, se dice que no hay, y por qué.
 */
export function vencimientoAEnsenar(vence: string | null, fecha: string | null, plazo: PlazoFicha | null):
  { valor: string; apoyo: string; aviso: boolean } {
  const deFicha = fecha && plazo && plazo.dias !== null ? calcularVencimiento(fecha, plazo.dias, plazo.fijos) : null
  const plazoTexto = plazo && plazo.dias !== null ? `${plazo.dias} días${plazo.fijos.length ? `, los días ${plazo.fijos.join(' y ')}` : ''}` : null
  if (vence) {
    if (deFicha && deFicha !== vence) return { valor: ddmm(vence), apoyo: `lo dice la factura; su ficha (${plazoTexto}) daría el ${ddmm(deFicha)}`, aviso: true }
    if (deFicha) return { valor: ddmm(vence), apoyo: `lo dice la factura, igual que su ficha (${plazoTexto})`, aviso: false }
    return { valor: ddmm(vence), apoyo: 'lo dice la factura', aviso: false }
  }
  if (deFicha) return { valor: ddmm(deFicha), apoyo: `la factura no lo trae: el de su ficha (${plazoTexto})`, aviso: false }
  return { valor: 'sin vencimiento', apoyo: 'ni la factura ni su ficha lo dicen', aviso: true }
}

/**
 * R5 · 2 · La línea de debajo de «Cómo se apunta». Diez no guarda documentos
 * (Cegid aún no ha activado su almacén): no se promete que irá «con su PDF».
 */
export const lineaDiez = (solo = false): string =>
  `Se apunta ${solo ? 'aquí' : `en ${MARCA.nombre}`} · a Diez irá sin el PDF, porque Diez aún no guarda documentos`

/** R5 · 5 · El tono de la banda de N23: verde solo si ya está apuntada; si no, ámbar, como su fila en la bandeja. */
export const tonoDeLaFactura = (asiento: { estado: string } | null): 'verde' | 'ambar' => (asiento?.estado === 'validado' ? 'verde' : 'ambar')

/**
 * R5 · 3 · «Cómo se apunta» en dos columnas con su título: «Gasto e IVA» (lo
 * que va al debe) y «A pagar» (al haber).
 */
export function columnasDelApunte(lineas: readonly { cuenta: string; debe: number; haber: number }[]): {
  gasto: { cuenta: string; importe: number }[]; pagar: { cuenta: string; importe: number }[]
} {
  return {
    gasto: lineas.filter((l) => l.debe).map((l) => ({ cuenta: l.cuenta, importe: l.debe })),
    pagar: lineas.filter((l) => l.haber).map((l) => ({ cuenta: l.cuenta, importe: l.haber })),
  }
}

/**
 * S01 · Desde Contabilidad › Asientos, «para revisar» no va por mes: todas las
 * que esperan de los últimos 12 meses (este incluido), en el orden de N22.
 */
export function ventanaParaRevisar(hoy: string): { desde: string; hasta: string } {
  const y = Number(hoy.slice(0, 4)), m = Number(hoy.slice(5, 7))
  const ini = new Date(Date.UTC(y, m - 12, 1))
  const desde = `${ini.getUTCFullYear()}-${String(ini.getUTCMonth() + 1).padStart(2, '0')}-01`
  return { desde, hasta: limites(hoy.slice(0, 7)).hasta }
}
