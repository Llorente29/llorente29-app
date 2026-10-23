// src/modules/conta/lib/inicio.ts
//
// C06 · Lo que el Inicio del producto vendido solo («Estilo nuevo · Inicio»)
// decide sin tocar la base. Núcleo puro, con pruebas en
// tests/unit/modules/conta/inicioC06.test.ts.
//
// La regla del encargo: «con las cifras que hoy se pueden calcular de verdad;
// lo que aún no exista no se enseña». Así que cada tarjeta sale del libro
// (los saldos de las cuentas del PGC a fin de mes), no de una tabla que aún no
// existe:
//   · En el banco   = saldo deudor de la 572 (bancos), del libro; no hay
//                     movimientos del banco todavía (frente B).
//   · Te deben      = saldo deudor de los grupos 43 y 44 (clientes y deudores).
//   · Debes         = saldo acreedor de los grupos 40 y 41 (proveedores y acreedores).
//
// S02 · PR 3 («las cifras»): las tarjetas leen conta_saldo_bancos y
// conta_saldos_terceros (lib/cifrasLibro); las barritas de los seis meses
// siguen saliendo de aquí, con la MISMA regla: «Te deben» suma los saldos
// DEUDORES de cada subcuenta de cliente (no el neto, que restaba los
// anticipos de clientes) y «Debes» los ACREEDORES de cada proveedor y
// acreedor, sin la 407 (el prefijo '40' la atrapaba: es un anticipo, activo)
// ni «facturas por localizar». Y «Pendiente de ti» es la misma lista que el
// «Te toca hoy», con el mismo total que la barra de Inicio.
//   · IVA del trimestre = 477 menos 472 del trimestre, sin la liquidación
//                     del IVA (movimientoIva). Sin fecha de presentación: no
//                     hay calendario de plazos en la serie, y no se inventa.

import { cifrasTerceros, filaDeSaldo, grupoDeCuenta } from '@/modules/conta/lib/cifrasLibro'
import type { CuentasMenu } from '@/modules/conta/marco/useCuentasMenu'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** «Buenos días» hasta las 14:00 de Madrid, «Buenas tardes» hasta las 21:00, después «Buenas noches». */
export function saludo(horaMadrid: number): string {
  if (horaMadrid >= 6 && horaMadrid < 14) return 'Buenos días'
  if (horaMadrid >= 14 && horaMadrid < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

/** La hora de Madrid (regla 4), 0–23. */
export function horaEnMadrid(ahora: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }).format(ahora))
}

/** «Marta Inventada» → «Marta». Sin nombre, null (y el saludo va sin él). */
export function primerNombre(nombre: string | null | undefined): string | null {
  const p = (nombre ?? '').trim().split(/\s+/)[0]
  return p ? p : null
}

/** '2026-10-13' → «Martes 13 de octubre». */
export function diaDeHoy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dia = DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${mayuscula(dia)} ${d} de ${MESES[m - 1]}`
}

/** '2026-10-01' → «Octubre 2026». */
export function mesYAnio(mes: string): string {
  return `${mayuscula(MESES[Number(mes.slice(5, 7)) - 1])} ${mes.slice(0, 4)}`
}

/** El último día del mes 'YYYY-MM-01'. */
export function finDeMes(mes: string): string {
  const y = Number(mes.slice(0, 4)); const m = Number(mes.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** Los n meses que acaban en `mes`, del más antiguo al más nuevo. */
export function mesesHasta(mes: string, n: number): string[] {
  const out: string[] = []
  let y = Number(mes.slice(0, 4)); let m = Number(mes.slice(5, 7))
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}-01`)
    m -= 1; if (m === 0) { m = 12; y -= 1 }
  }
  return out
}

/** El trimestre natural de un mes: desde, hasta y su nombre («3.er trimestre»). */
export function trimestreDe(mes: string): { desde: string; hasta: string; nombre: string } {
  const y = Number(mes.slice(0, 4)); const q = Math.floor((Number(mes.slice(5, 7)) - 1) / 3)
  const desde = `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`
  const ORD = ['1.er', '2.º', '3.er', '4.º']
  return { desde, hasta: finDeMes(`${y}-${String(q * 3 + 3).padStart(2, '0')}-01`), nombre: `${ORD[q]} trimestre` }
}

export interface SaldoSimple { code: string; templateCode: string | null; debe: number; haber: number }

const redondea = (n: number) => Math.round(n * 100) / 100
const empiezaPor = (s: SaldoSimple, prefijos: readonly string[]) => {
  const c = s.templateCode ?? s.code
  return prefijos.some((p) => c.startsWith(p))
}

/** Saldo de un grupo: deudor (debe − haber) o acreedor (haber − debe). */
export function saldoDe(saldos: readonly SaldoSimple[], prefijos: readonly string[], lado: 'deudor' | 'acreedor'): number {
  const s = saldos.filter((x) => empiezaPor(x, prefijos)).reduce((a, x) => a + x.debe - x.haber, 0)
  return redondea(lado === 'deudor' ? s : -s)
}

export const GRUPOS = {
  banco: ['572'],
  teDeben: ['43', '44'],
  // S02 · PR 3: las barritas ya no usan este prefijo (puntoDeMes va subcuenta a subcuenta,
  // sin la 407 ni «por localizar»: lib/cifrasLibro grupoDeCuenta).
  debes: ['40', '41'],
} as const

export interface PuntoMes { mes: string; banco: number; teDeben: number; debes: number }

/**
 * Un punto del mes. Los de terceros, subcuenta a subcuenta y con su lado (la
 * regla de conta_saldos_terceros, lib/cifrasLibro): «Te deben» solo lo deudor
 * de clientes; «Debes» solo lo acreedor de proveedores y acreedores, sin
 * «facturas por localizar». El grupo lo dice el código de la subcuenta (o el
 * de su plantilla, si es otro).
 */
export function puntoDeMes(mes: string, saldos: readonly (SaldoSimple & { name?: string })[]): PuntoMes {
  const filas = saldos.map((x) => {
    const codigo = grupoDeCuenta(x.code, x.name ?? '') ? x.code : x.templateCode ?? x.code
    return filaDeSaldo(codigo, x.name ?? '', x.debe - x.haber)
  })
  const t = cifrasTerceros(filas)
  return { mes, banco: saldoDe(saldos, GRUPOS.banco, 'deudor'), teDeben: t.teDeben, debes: t.debes }
}

/**
 * Las barritas de una tarjeta: de 13 a 40 px de alto, como la maqueta, la
 * última resaltada. Un mes sin dato (sin ejercicio) no tiene barra.
 */
export function barras(valores: readonly (number | null)[]): { alto: number; ultima: boolean }[] {
  const con = valores.filter((v): v is number => v !== null)
  if (con.length === 0) return []
  const min = Math.min(...con); const max = Math.max(...con)
  return valores.flatMap((v, i) => v === null ? [] : [{
    alto: max === min ? 26 : Math.round(13 + ((v - min) / (max - min)) * 27),
    ultima: i === valores.length - 1,
  }])
}

/** «+3.120 € este mes» / «−800 € este mes» / «igual que el mes pasado». */
export function cambio(antes: number | null, ahora: number, formato: (n: number) => string): string | null {
  if (antes === null) return null
  const d = redondea(ahora - antes)
  if (d === 0) return 'igual que el mes pasado'
  return `${d > 0 ? '+' : '−'}${formato(Math.abs(d))} este mes`
}

/** Una línea del IVA del trimestre: qué es, su importe y, si hace falta, por qué. */
export interface LineaIva { etiqueta: string; importe: string; nota?: string }

/**
 * M01 · Debajo del IVA del trimestre, tres líneas cortas (Julio, 16/10):
 *   «IVA de tus ventas 8,99 €»
 *   «IVA de tus compras −5,00 € (más abonos que facturas)»
 *   «A pagar 13,99 €» (o «A devolver», sin signo).
 * El importe de compras va con su signo: un soportado en negativo es lo que
 * hay en el libro, y la nota dice por qué. Lo de abajo es siempre la cifra
 * de la tarjeta (ventas − compras).
 */
export function lineasIva(repercutido: number, soportado: number, formato: (n: number) => string, impuesto = 'IVA'): LineaIva[] {
  // S01e: `impuesto` es IVA, IGIC (Canarias) o IPSI (lib/impuestoIndirecto).
  const resultado = Math.round((repercutido - soportado) * 100) / 100
  return [
    { etiqueta: `${impuesto} de tus ventas`, importe: formato(repercutido) },
    soportado < 0
      ? { etiqueta: `${impuesto} de tus compras`, importe: formato(soportado), nota: '(más abonos que facturas)' }
      : { etiqueta: `${impuesto} de tus compras`, importe: formato(soportado) },
    { etiqueta: resultado < 0 ? 'A devolver' : 'A pagar', importe: formato(Math.abs(resultado)) },
  ]
}

/** Las tres líneas en texto (para el lector y las pruebas). */
export const textoIva = (trimestre: string, l: readonly LineaIva[]): string =>
  `${trimestre}: ${l.map((x) => `${x.etiqueta} ${x.importe}${x.nota ? ` ${x.nota}` : ''}`).join('. ')}.`

/** «Próximo pago el 24 oct» o, si ya pasó, «Vencido desde el 24 oct». */
export function frasePago(fecha: string | null, hoy: string, diaMes: (iso: string) => string): string | null {
  if (!fecha) return null
  return fecha < hoy ? `Vencido desde el ${diaMes(fecha)}` : `Próximo pago el ${diaMes(fecha)}`
}

/**
 * Lo que tiene que decir la persona. S02 · PR 3: la MISMA lista que el «Te
 * toca hoy» (marco/nuevo/teTocaHoy, de conta_pendientes): compras, facturas
 * para mirar y por aclarar, asientos, bancos y contactos (antes no llevaba ni
 * bancos ni contactos), más lo que solo pregunta el Inicio: las sugerencias de
 * la IA y las subcuentas sin nombre.
 */
export interface Duda {
  id: string; inicial: string; titulo: string; apoyo: string
  tipo: 'sugerencia' | 'compras' | 'recibidas' | 'aclarar' | 'revisar' | 'bancos' | 'terceros' | 'sinNombre'
}

const veces = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Las claves del menú que son también dudas, en el orden del «Te toca hoy». */
export const CLAVES_DE_DUDAS = ['compras', 'recibidas', 'aclarar', 'libros', 'bancos', 'terceros'] as const

export function dudas(sugerencias: readonly { id: string; title: string; why: string }[], cuentas: CuentasMenu, sinNombre = 0): Duda[] {
  const out: Duda[] = sugerencias.map((s) => ({ id: s.id, inicial: 'IA', titulo: s.title, apoyo: s.why, tipo: 'sugerencia' }))
  const n = (k: string) => { const v = cuentas[k]; return typeof v === 'number' ? v : 0 }
  if (n('compras') > 0) {
    out.push({ id: 'compras', inicial: 'C', tipo: 'compras', titulo: veces(n('compras'), 'cosa de compras por mirar', 'cosas de compras por mirar'), apoyo: 'No sé qué hacer con ellos sin ti.' })
  }
  // S01 (paso 4): las facturas recibidas, una detrás de otra («Validar y siguiente»).
  if (n('recibidas') > 0) {
    out.push({ id: 'recibidas', inicial: 'R', tipo: 'recibidas', titulo: `${veces(n('recibidas'), 'factura recibida', 'facturas recibidas')} para revisar`, apoyo: 'Una detrás de otra: «Validar y siguiente» y pasas a la próxima.' })
  }
  if (n('aclarar') > 0) {
    out.push({ id: 'aclarar', inicial: 'R', tipo: 'aclarar', titulo: `${veces(n('aclarar'), 'factura recibida', 'facturas recibidas')} por aclarar`, apoyo: 'Les falta algo para apuntarlas: el proveedor, un dato que no he leído bien o una diferencia.' })
  }
  if (n('libros') > 0) {
    out.push({ id: 'revisar', inicial: 'L', tipo: 'revisar', titulo: `${veces(n('libros'), 'asiento propuesto', 'asientos propuestos')} para revisar`, apoyo: 'Los he preparado yo; los validas tú.' })
  }
  if (n('bancos') > 0) {
    const partes = [['bancosConfirmar', 'para confirmar'], ['bancosAclarar', 'por aclarar'], ['bancosValidar', 'por validar']]
      .flatMap(([k, t]) => (n(k) > 0 ? [`${n(k)} ${t}`] : []))
    out.push({ id: 'bancos', inicial: 'B', tipo: 'bancos', titulo: `${veces(n('bancos'), 'movimiento del banco', 'movimientos del banco')} por decidir`, apoyo: partes.length ? `${partes.join(', ')}.` : 'Para confirmar, aclarar o validar.' })
  }
  if (n('terceros') > 0) {
    out.push({ id: 'terceros', inicial: 'T', tipo: 'terceros', titulo: `${veces(n('terceros'), 'cliente o proveedor', 'clientes o proveedores')} por revisar`, apoyo: 'Cuentas traídas sin revisar o acuerdos sin su socio.' })
  }
  // C06, respuesta 3: lo que llegó de Diez sin nombre no se inventa: se pide.
  if (sinNombre > 0) {
    out.push({ id: 'sin-nombre', inicial: 'P', tipo: 'sinNombre', titulo: `${veces(sinNombre, 'subcuenta', 'subcuentas')} sin nombre en Diez · pónselo`, apoyo: 'Llegaron de Diez sin nombre: llevan el de su cuenta del plan hasta que les pongas el suyo.' })
  }
  return out
}

/**
 * El resumen de «Pendiente de ti». S02 · PR 3: ya no cuenta filas («9
 * facturas» valía 1): `total` es la suma de lo pendiente, el mismo número que
 * la barra de Inicio (cuentasDeLaBarra); `preguntas`, las sugerencias y las
 * subcuentas sin nombre, que solo pregunta el Inicio y se dicen aparte. Un
 * total que no se ha podido contar (null) nunca es «nada pendiente».
 */
export function resumenDudas(total: number | null, preguntas = 0): string {
  const p = preguntas > 0 ? veces(preguntas, 'pregunta mía', 'preguntas mías') : null
  if (total === null) return ['no he podido contarlo todo', p].filter(Boolean).join(' · ')
  if (total === 0 && !p) return 'nada pendiente'
  return [total > 0 ? veces(total, 'cosa pendiente', 'cosas pendientes') : null, p].filter(Boolean).join(' · ')
}
