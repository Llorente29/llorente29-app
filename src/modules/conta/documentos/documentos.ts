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

export type Estado = 'para_mirar' | 'por_aclarar' | 'apuntada' | 'repetida'
export type Canal = 'correo' | 'subida' | 'cocina' | 'portal' | 'a_mano'
export type Confianza = 'seguro' | 'probable' | 'duda'

export interface FilaDocumento {
  id: string
  tipo: 'factura' | 'llegada'
  estado: Estado
  proveedor: { id: string | null; nombre: string | null }
  numero: string | null
  fecha: string | null
  total: number | null
  canal: Canal
  confianza: Confianza | null
  porque: string | null
  entendido: { cuenta: string; nombre: string; origen: string } | null
  recepcion: { fecha: string; local: string | null } | null
  asiento: { id: string; estado: string; solo: boolean } | null
  llego: string
  archivo?: string | null
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

const n = (x: number) => new Intl.NumberFormat('es-ES').format(x)
const plural = (k: number, uno: string, varios: string) => `${n(k)} ${k === 1 ? uno : varios}`

/** «Correo 24 · Cocina 9 · subidas 5»: por dónde llegaron, en el orden de la maqueta. Vendido solo, sin la palabra Cocina. */
export function porDonde(c: DatosDocumentos['cifras']['llegadas_por_canal'], solo = false): string {
  const partes: string[] = []
  if (c.correo) partes.push(`correo ${n(c.correo)}`)
  if (c.cocina) partes.push(`${solo ? 'recepciones' : 'Cocina'} ${n(c.cocina)}`)
  if (c.subida) partes.push(`${c.subida === 1 ? 'subida' : 'subidas'} ${n(c.subida)}`)
  if (c.portal) partes.push(`portal ${n(c.portal)}`)
  if (c.a_mano) partes.push(`a mano ${n(c.a_mano)}`)
  return partes.join(' · ') || 'ninguna esta semana'
}

/** «alquiler de octubre», «Telefonía Norte de septiembre». Sin artículo: de una
 *  etiqueta libre no se sabe el género («la de la luz», «la del alquiler»). */
function laQueFalta(e: Esperada): string {
  const mes = new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(`${e.periodo}T00:00:00Z`))
  return `${e.label ? e.label.toLowerCase() : e.supplier_name} de ${mes}`
}

/** La banda de la IA: lo que ha pasado en una frase, y si hay algo que pedir. */
export function banda(d: DatosDocumentos): { titulo: string; porque: string | null; pedir: boolean } {
  const c = d.cifras
  const llegadas = c.llegadas === 0
    ? 'Esta semana no ha llegado ninguna factura.'
    : `Han llegado ${plural(c.llegadas, 'factura', 'facturas')} esta semana.`
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
  return { titulo, porque, pedir: faltan.length > 0 }
}

/** Por dónde llegó, como lo dice la fila: «llegó por Correo». Vendido solo, sin la palabra Cocina. */
export const NOMBRE_CANAL: Record<Canal, string> = { correo: 'Correo', subida: 'Subida', cocina: 'Cocina', portal: 'Portal', a_mano: 'a mano' }
export const nombreCanal = (c: Canal, solo = false): string => (solo && c === 'cocina' ? 'su recepción' : NOMBRE_CANAL[c] ?? c)

/** Lo que Folvy ha entendido, como lo dice la fila. Las cuentas, nombre · código. */
export function entendido(f: FilaDocumento): { titulo: string; porque: string | null } {
  if (f.tipo === 'llegada') return { titulo: f.archivo ? `«${f.archivo}»` : 'Un documento sin leer', porque: f.porque }
  if (!f.proveedor.id) return { titulo: 'No reconozco el emisor', porque: f.porque }
  const cuenta = f.entendido ? `${f.entendido.nombre} · ${f.entendido.cuenta}` : 'Sin cuenta de gasto todavía'
  const casa = f.recepcion ? ` · casa con la recepción del ${diaMes(f.recepcion.fecha)}` : ''
  return { titulo: `${cuenta}${casa}`, porque: f.porque }
}

/** El único botón de la fila. */
export function boton(f: FilaDocumento): { texto: string; principal: boolean } {
  if (f.tipo === 'factura' && !f.proveedor.id) return { texto: 'Decirlo yo', principal: true }
  if (f.estado === 'para_mirar') return { texto: 'Mirar', principal: false }
  if (f.estado === 'por_aclarar') return { texto: f.tipo === 'llegada' ? 'Ver' : 'Aclarar', principal: false }
  return { texto: 'Ver', principal: false }
}

/** El punto de la fila: verde seguro, ámbar probable o para mirar, gris lo que no se sabe. */
export function punto(f: FilaDocumento): 'verde' | 'ambar' | 'gris' | 'rojo' {
  if (f.estado === 'apuntada') return 'verde'
  if (f.estado === 'repetida') return 'gris'
  if (f.confianza === 'duda' || f.tipo === 'llegada') return 'gris'
  return 'ambar'
}

export const diaMes = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—')

/** Las entradas de la barra (tercer nivel), con lo que no funciona fuera. */
export interface EntradaBarra { id: string; nombre: string; dato: string; tono: 'verde' | 'ambar' | 'gris' }
export function barra(d: DatosDocumentos, o: { solo: boolean; producto: string | null }): { etiqueta: string; entradas: EntradaBarra[] }[] {
  const c = d.cifras
  const traer: EntradaBarra[] = [{ id: 'subir', nombre: 'Subir', dato: 'PDF · foto · varios', tono: 'verde' }]
  if (d.correo.activo && d.correo.direccion) traer.push({ id: 'correo', nombre: 'Por correo', dato: d.correo.direccion.replace(/@.*/, '@…'), tono: 'verde' })
  if (d.recibe_mercancia && !o.solo) traer.push({ id: 'cocina', nombre: 'De Cocina', dato: 'recepciones', tono: 'verde' })
  const esperadas: EntradaBarra[] = [{
    id: 'fijas', nombre: 'Fijas del mes',
    dato: d.esperadas.length ? `${d.esperadas.slice(0, 2).map((e) => (e.label ?? e.supplier_name).toLowerCase()).join(', ')}${d.esperadas.length > 2 ? '…' : ''} · ${plural(c.esperadas_no_llegadas, 'falta', 'faltan')}` : 'ninguna falta',
    tono: c.esperadas_no_llegadas ? 'ambar' : 'gris',
  }]
  const leidas: EntradaBarra[] = [{ id: 'hecho', nombre: textos(o.producto).hecho, dato: `${plural(c.apuntadas_solas, 'apuntada sola', 'apuntadas solas')}`, tono: c.apuntadas_solas ? 'verde' : 'gris' }]
  return [{ etiqueta: 'Traer', entradas: traer }, { etiqueta: 'Esperadas', entradas: esperadas }, { etiqueta: 'Leídas', entradas: leidas }]
}

/** Lo que cambia con el producto: con nombre («Folvy») o, vendido solo, en primera persona y sin él. */
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
