// supabase/functions/conta-bitrix-pestana/escribir.ts
//
// GB · Segunda parte (nº 9) · Lo que se decide sin llamar a nadie al guardar un
// cambio desde la pestaña (lo prueban las unitarias: tests/unit/modules/conta/gb/escribir.test.ts).
//
//   · El recibo del mes que viene de un cliente con una empresa, con la MISMA
//     cuenta que la ficha del G04 (catalogoYAsignaciones y reciboDelMes de
//     _shared): es lo que se escribe en la «Cuota mensual» de Bitrix24.
//   · Qué hacer con ese campo de Bitrix24 sin pisar nada: si lo que hay allí es
//     lo que Sumied conocía (lo leído cada noche o lo último que escribió la
//     pestaña), se escribe; si alguien lo ha cambiado en Bitrix24, no se toca y
//     va a «Pendiente de revisar».
//   · nº 13 · También «Trabajadores» y «Estado del cobro», con la misma regla.

import { catalogoYAsignaciones } from '../_shared/cobro/datos.ts'
import { reciboDelMes } from '../_shared/tarifa/precio.ts'

type Fila = Record<string, unknown>
const filas = (x: unknown): Fila[] => (Array.isArray(x) ? (x as Fila[]) : [])

/** El mes que viene, «AAAA-MM». */
export function mesSiguiente(hoy: string): string {
  const a = Number(hoy.slice(0, 4)); const m = Number(hoy.slice(5, 7))
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`
}

/** El recibo de un mes, con la MISMA cuenta que la ficha del G04, de lo que lee la pantalla de Clientes (conta_pantalla_clientes). */
function reciboDe(clientes: unknown, clienteId: string, empresaId: string, mes: string) {
  const d = (clientes && typeof clientes === 'object' ? clientes : {}) as Fila
  const { catalogo, asignaciones } = catalogoYAsignaciones({
    servicios: filas(d.servicios), precios: filas(d.precios), asignaciones: filas(d.asignaciones), niveles: filas(d.niveles),
    paquetes: filas(d.paquetes), lineasDePaquete: filas(d.lineas_de_paquete), ajustes: filas(d.ajustes),
  })
  return reciboDelMes(catalogo, asignaciones, clienteId, empresaId, mes)
}

/** El total del recibo de un mes (céntimos). */
export function totalDelRecibo(clientes: unknown, clienteId: string, empresaId: string, mes: string): number {
  return reciboDe(clientes, clienteId, empresaId, mes).totalCent
}

/** nº 13 · Cuántos trabajadores se cobran ese mes (el mayor de sus líneas por trabajador); null si no tiene ninguna. */
export function trabajadoresDelRecibo(clientes: unknown, clienteId: string, empresaId: string, mes: string): number | null {
  const n = reciboDe(clientes, clienteId, empresaId, mes).lineas.map((l) => l.trabajadores).filter((x): x is number => x !== null)
  return n.length ? Math.max(...n) : null
}

/** El estado de un cobro de GoCardless, en palabras de oficina (las mismas que la ficha del G04). */
const ESTADO_DEL_COBRO: Record<string, string> = {
  paid_out: 'Cobrado', confirmed: 'Cobrado', failed: 'Devuelto', charged_back: 'Retrocedido', cancelled: 'Cancelado',
  pending_submission: 'En curso', submitted: 'En curso', pending_customer_approval: 'Pendiente de aprobar', customer_approval_denied: 'Rechazado',
}
const MANDATO_VIVO = ['active', 'submitted', 'pending_submission']

/**
 * nº 13 · El «Estado del cobro» de la ficha de Bitrix24: el del último cobro de
 * GoCardless del cliente en esa empresa; sin cobros, lo que dice su mandato.
 * De lo que lee la ficha (conta_pantalla_ficha): mandatos y cobros.
 */
export function estadoDelCobro(ficha: unknown, empresaId: string): string {
  const d = (ficha && typeof ficha === 'object' ? ficha : {}) as Fila
  const deLaEmpresa = (x: Fila) => String(x.company_id ?? '') === empresaId
  const cobros = filas(d.cobros).filter(deLaEmpresa).sort((a, b) => String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')) || String(b.gc_id ?? '').localeCompare(String(a.gc_id ?? '')))
  if (cobros.length) return ESTADO_DEL_COBRO[String(cobros[0].estado)] ?? 'En curso'
  const mandatos = filas(d.mandatos).filter(deLaEmpresa)
  if (mandatos.some((m) => MANDATO_VIVO.includes(String(m.estado)))) return 'Mandato firmado, sin cobros'
  if (mandatos.some((m) => m.estado === 'pending_customer_approval')) return 'Mandato por firmar'
  return 'Sin mandato'
}

/** Un importe como lo guarda Bitrix24 en la cuota («250,00»). */
export const cuotaEnBitrix = (cent: number) => `${Math.floor(cent / 100)},${String(Math.abs(cent) % 100).padStart(2, '0')}`

/** De lo escrito en Bitrix24 («250,00», «250», «1.250,5 €», «250|EUR») a céntimos; null si está vacío o no es un importe. */
export function centDeTexto(x: unknown): number | null {
  if (x === null || x === undefined) return null
  let t = String(x).split('|')[0].replace(/[€\s]/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

/** nº 13 · Un texto de Bitrix24, para comparar: sin «|moneda», sin espacios de más, en minúsculas; los números, como número. */
export function textoParaComparar(x: unknown): string {
  const t = x === null || x === undefined ? '' : String(Array.isArray(x) ? x[0] ?? '' : x).split('|')[0].trim().toLowerCase()
  return /^-?[0-9]+([.,][0-9]+)?$/.test(t) ? String(Number(t.replace(',', '.'))) : t
}

/**
 * nº 13 · Qué hacer con un campo de texto que rellena Sumied («Trabajadores»,
 * «Estado del cobro»). Es de Sumied: se escribe si está vacío o tiene lo
 * último que escribió Sumied; si alguien lo ha cambiado en Bitrix24, no se
 * pisa (choque).
 */
export function queHacerConElTexto(o: { campo: string | null; actual: unknown; escrita: string | null; nuevo: string }): QueHacer {
  if (!o.campo) return { hacer: 'nada', porque: 'el mapa de Bitrix24 no tiene ese campo' }
  const actual = textoParaComparar(o.actual)
  if (actual === textoParaComparar(o.nuevo)) return { hacer: 'nada', porque: 'Bitrix24 ya lo tiene' }
  if (actual === '' || (o.escrita !== null && actual === textoParaComparar(o.escrita))) return { hacer: 'escribir', valor: o.nuevo }
  return { hacer: 'choque', enBitrix: String(Array.isArray(o.actual) ? o.actual[0] : o.actual).trim(), sumied: o.nuevo }
}

export type QueHacer =
  | { hacer: 'escribir'; valor: string }
  | { hacer: 'nada'; porque: string }
  | { hacer: 'choque'; enBitrix: string; sumied: string }

/**
 * Qué hacer con el campo de la cuota. «actual» es lo que hay ahora en Bitrix24;
 * «conocida», lo que Sumied leyó; «escrita», lo último que escribió la pestaña.
 * Nunca se pisa un dato cambiado en Bitrix24.
 */
export function queHacerConLaCuota(o: { campo: string | null; actual: unknown; conocida: string | null; escrita: string | null; nuevoCent: number }): QueHacer {
  if (!o.campo) return { hacer: 'nada', porque: 'el mapa de Bitrix24 no tiene la «Cuota mensual»' }
  const valor = cuotaEnBitrix(o.nuevoCent)
  const actual = centDeTexto(o.actual)
  if (actual === o.nuevoCent) return { hacer: 'nada', porque: 'Bitrix24 ya tiene esa cuota' }
  const sabidas = [o.conocida, o.escrita].map(centDeTexto)
  const vacioYSabidoVacio = actual === null && sabidas.every((x) => x === null)
  if (vacioYSabidoVacio || (actual !== null && sabidas.includes(actual))) return { hacer: 'escribir', valor }
  return { hacer: 'choque', enBitrix: actual === null ? 'vacío' : cuotaEnBitrix(actual), sumied: valor }
}

/** nº 13 · El nombre de cada campo de la ficha, como sale en «Pendiente de revisar». */
export const NOMBRE_EN_LA_FICHA: Record<string, string> = { cuota: 'Cuota mensual', trabajadores: 'Trabajadores', estado_cobro: 'Estado del cobro' }

/**
 * nº 13, punto 2 · De lo que pasó en Bitrix24 al guardar (fichaEnBitrix): los
 * choques, que van a «Pendiente de revisar», y los campos escritos sin choque,
 * que quitan el suyo si lo había.
 */
export function choquesDe(r: Record<string, unknown>): { choques: { campo: string; en_bitrix: string; sumied: string }[]; escritos: string[] } {
  const choques: { campo: string; en_bitrix: string; sumied: string }[] = []
  const escritos: string[] = []
  if (r.en_bitrix !== undefined && r.sumied !== undefined) choques.push({ campo: NOMBRE_EN_LA_FICHA.cuota, en_bitrix: String(r.en_bitrix), sumied: String(r.sumied) })
  else if (typeof r.escrito === 'string') escritos.push(NOMBRE_EN_LA_FICHA.cuota)
  const campos = (r.campos && typeof r.campos === 'object' ? r.campos : {}) as Record<string, Record<string, unknown>>
  for (const [clave, c] of Object.entries(campos)) {
    const nombre = NOMBRE_EN_LA_FICHA[clave] ?? clave
    if (c.hecho === 'choque') choques.push({ campo: nombre, en_bitrix: String(c.en_bitrix ?? ''), sumied: String(c.sumied ?? '') })
    else if (c.hecho === 'escrito') escritos.push(nombre)
  }
  return { choques, escritos }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** «2026-12-01» o «2026-12» → «diciembre»; si no es una fecha, null. */
export function mesEnPalabras(x: unknown): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(x ?? ''))
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? MESES[Number(m[2]) - 1] : null
}

/**
 * nº 13, punto 3 · La nota corta que va al historial de la ficha de Bitrix24
 * por cada cambio de Sumied: «Sumied · alta de X desde diciembre». Una por
 * cambio, sin flujos: lo largo está en la pestaña.
 */
export function notaDelCambio(accion: string, datos: Record<string, unknown>, frase: string): string {
  const nombre = typeof datos.nombre === 'string' && datos.nombre.trim() ? datos.nombre.trim() : null
  const corta = (t: string) => (t.length > 240 ? `${t.slice(0, 239)}…` : t)
  // nº 17, D · Con el día exacto, el día (nunca el DNI o NIE: es un dato personal y la nota la ve todo Bitrix24).
  const dia = typeof datos.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(datos.dia) ? `${datos.dia.slice(8, 10)}/${datos.dia.slice(5, 7)}/${datos.dia.slice(0, 4)}` : null
  if (accion === 'alta') {
    const mes = mesEnPalabras(datos.desde)
    return corta(`Sumied · alta de ${nombre ?? 'un trabajador'}${dia ? ` el ${dia}` : mes ? ` desde ${mes}` : ''}`)
  }
  if (accion === 'baja') {
    const mes = mesEnPalabras(typeof datos.mes === 'string' ? mesSiguiente(datos.mes) : null)
    return corta(`Sumied · baja de ${nombre ?? 'un trabajador'}${dia ? ` el ${dia}` : ''}${mes ? `: se deja de cobrar desde ${mes}` : ''}`)
  }
  if (accion === 'solicitud') {
    const que = datos.tipo === 'baja' ? 'baja' : 'alta'
    const mes = mesEnPalabras(datos.desde)
    return corta(`Sumied · ${que} de ${nombre ?? 'un trabajador'}${mes ? ` desde ${mes}` : ''}, que pidió el cliente en su portal`)
  }
  if (accion === 'tarifa') {
    const mes = mesEnPalabras(datos.desde)
    if (typeof datos.precio === 'number') {
      const precio = `${cuotaEnBitrix(Math.round(datos.precio * 100))} €`
      return corta(`Sumied · precio especial de ${precio}${mes ? ` desde ${mes}` : ''}${typeof datos.motivo === 'string' && datos.motivo.trim() ? `. Por qué: ${datos.motivo.trim()}` : ''}`)
    }
    return corta(`Sumied · ${frase.trim().replace(/\.$/, '') || 'cambio de nivel'}`)
  }
  if (accion === 'deshacer') return corta(`Sumied · deshecho: ${frase.trim().replace(/^Deshecho:\s*/, '').replace(/\.$/, '')}`)
  return corta(`Sumied · ${frase.trim().replace(/\.$/, '')}`)
}
