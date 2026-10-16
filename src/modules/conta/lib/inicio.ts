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
//   · IVA del trimestre = 477 menos 472 del trimestre, sin la liquidación
//                     del IVA (movimientoIva). Sin fecha de presentación: no
//                     hay calendario de plazos en la serie, y no se inventa.

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
  debes: ['40', '41'],
} as const

export interface PuntoMes { mes: string; banco: number; teDeben: number; debes: number }

export function puntoDeMes(mes: string, saldos: readonly SaldoSimple[]): PuntoMes {
  return {
    mes,
    banco: saldoDe(saldos, GRUPOS.banco, 'deudor'),
    teDeben: saldoDe(saldos, GRUPOS.teDeben, 'deudor'),
    debes: saldoDe(saldos, GRUPOS.debes, 'acreedor'),
  }
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

/** Un trozo de la frase del IVA: texto, o un importe (que se pinta en mono). */
export interface TrozoIva { texto: string; cifra?: boolean }

/**
 * M01 · Lo de debajo del IVA del trimestre, como una cuenta que se lee entera
 * (Julio, 16/10): «4.º trimestre: repercutido 8,99 € − soportado 5,00 € =
 * 3,99 € a pagar», o «a devolver» si sale negativo. Los importes, con sus
 * decimales y en mono.
 *
 * El soportado en negativo (más abonos de proveedores que facturas) no se
 * escribe «− −5,00 €», que se leía como una errata, ni «− 5,00 €», que haría
 * mal la cuenta: se SUMA y se dice por qué («+ 5,00 € de soportado en
 * negativo»). El resultado es siempre el de la tarjeta (repercutido − soportado).
 */
export function fraseIva(trimestre: string, repercutido: number, soportado: number, formato: (n: number) => string): TrozoIva[] {
  const resultado = Math.round((repercutido - soportado) * 100) / 100
  const t: TrozoIva[] = [{ texto: `${trimestre}: repercutido ` }, { texto: formato(repercutido), cifra: true }]
  if (soportado < 0) t.push({ texto: ' + ' }, { texto: formato(-soportado), cifra: true }, { texto: ' de soportado en negativo' })
  else t.push({ texto: ' − soportado ' }, { texto: formato(soportado), cifra: true })
  t.push({ texto: ' = ' }, { texto: formato(Math.abs(resultado)), cifra: true }, { texto: resultado < 0 ? ' a devolver' : ' a pagar' })
  return t
}

/** La frase del IVA en una línea de texto (para el lector y las pruebas). */
export const textoIva = (t: readonly TrozoIva[]): string => t.map((x) => x.texto).join('')

/** «Próximo pago el 24 oct» o, si ya pasó, «Vencido desde el 24 oct». */
export function frasePago(fecha: string | null, hoy: string, diaMes: (iso: string) => string): string | null {
  if (!fecha) return null
  return fecha < hoy ? `Vencido desde el ${diaMes(fecha)}` : `Próximo pago el ${diaMes(fecha)}`
}

/** Lo que tiene que decir la persona: las sugerencias, los papeles de compras y los asientos por revisar. */
export interface Duda { id: string; inicial: string; titulo: string; apoyo: string; tipo: 'sugerencia' | 'compras' | 'revisar' | 'sinNombre' }

export function dudas(sugerencias: readonly { id: string; title: string; why: string }[], comprasPorMirar: number, asientosPorRevisar: number, sinNombre = 0): Duda[] {
  const out: Duda[] = sugerencias.map((s) => ({ id: s.id, inicial: 'IA', titulo: s.title, apoyo: s.why, tipo: 'sugerencia' }))
  if (comprasPorMirar > 0) {
    out.push({ id: 'compras', inicial: 'C', tipo: 'compras', titulo: `${comprasPorMirar} ${comprasPorMirar === 1 ? 'papel de compras por mirar' : 'papeles de compras por mirar'}`, apoyo: 'No sé qué hacer con ellos sin ti.' })
  }
  if (asientosPorRevisar > 0) {
    out.push({ id: 'revisar', inicial: 'L', tipo: 'revisar', titulo: `${asientosPorRevisar} ${asientosPorRevisar === 1 ? 'asiento propuesto' : 'asientos propuestos'} para revisar`, apoyo: 'Los he preparado yo; los validas tú.' })
  }
  // C06, respuesta 3: lo que llegó de Diez sin nombre no se inventa: se pide.
  if (sinNombre > 0) {
    out.push({ id: 'sin-nombre', inicial: 'P', tipo: 'sinNombre', titulo: `${sinNombre} ${sinNombre === 1 ? 'subcuenta' : 'subcuentas'} sin nombre en Diez · pónselo`, apoyo: 'Llegaron de Diez sin nombre: llevan el de su cuenta del plan hasta que les pongas el suyo.' })
  }
  return out
}

/** «3 dudas · 1 minuto»: un minuto por cada tres, por lo alto. */
export function resumenDudas(n: number): string {
  if (n === 0) return 'nada pendiente'
  const min = Math.max(1, Math.ceil(n / 3))
  return `${n} ${n === 1 ? 'duda' : 'dudas'} · ${min} ${min === 1 ? 'minuto' : 'minutos'}`
}
