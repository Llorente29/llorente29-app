// src/modules/conta/lib/lectorCsvBanco.ts
//
// B01 · Lectura de reserva: el Excel o CSV de movimientos que da la banca
// online, para el banco que no saque Norma 43 o para la tarjeta de crédito (que
// nunca viene en Norma 43). Entra como filas de texto (las saca
// `plan/leerFicheros.ts` del .xlsx o del .csv, igual que en el plan) y sale con
// el mismo modelo que el Norma 43 (`extractoBanco.ts`).
//
// Un perfil por banco: cómo se llaman sus columnas, si el importe va en una
// columna con signo o en dos (cargo y abono), y su código de entidad (para
// reconocerlo por el IBAN). Los perfiles se han escrito con la forma habitual de
// cada exportación y se prueban con un ejemplo INVENTADO de cada uno (nada real
// en el repositorio); el primer fichero de verdad de cada banco es el que
// confirma o corrige su perfil, y eso se dice en el informe. Si un banco cambia
// sus columnas, el lector no adivina: dice qué columna no encuentra.
//
// Puro y probado (tests/unit/modules/conta/bancosB01.test.ts).

import type { CuentaLeida, ExtractoLeido, MovimientoLeido } from '@/modules/conta/lib/extractoBanco'
import { validarIban } from '@/modules/conta/lib/iban'

export class CsvBancoNoValido extends Error {}

export type BancoCsv = 'bbva' | 'santander' | 'caixabank' | 'sabadell' | 'bankinter' | 'unicaja' | 'kutxabank' | 'ibercaja'
  | 'abanca' | 'ing' | 'cajamar' | 'tarjeta'

type Patrones = RegExp[]

export interface PerfilBanco {
  nombre: string
  /** Código de entidad del Banco de España (posiciones 5–8 del IBAN). La tarjeta no tiene. */
  entidad: string | null
  fecha: Patrones
  fechaValor?: Patrones
  /** Columnas que forman el concepto, por orden (se unen las que existan). */
  concepto: Patrones[]
  /** Importe con signo (− sale). */
  importe?: Patrones
  /** O en dos columnas: lo que sale y lo que entra, en positivo. */
  cargo?: Patrones
  abono?: Patrones
  saldo?: Patrones
  referencia?: Patrones
  /** El código propio del banco (BBVA: «CÓDIGO», cinco cifras). */
  propio?: Patrones
  /** La tarjeta da los cargos en positivo: se les da la vuelta. */
  cargosEnPositivo?: boolean
}

const r = (s: string) => new RegExp(`^${s}$`, 'i')

export const PERFILES: Record<BancoCsv, PerfilBanco> = {
  // BBVA «Histórico» (15/10, el primer fichero de verdad de Foodint): hoja
  // «Historico», datos desde la columna C, cabecera en pares etiqueta/valor
  // (Titular, Cuenta…) y títulos en la fila 16: F. CONTABLE · F. VALOR ·
  // CÓDIGO · CONCEPTO · BENEFICIARIO/ORDENANTE · OBSERVACIONES · IMPORTE ·
  // SALDO · DIVISA · OFICINA · REMESA. El concepto es la etiqueta del banco; a
  // quién pagas va en BENEFICIARIO/ORDENANTE (19 de 47) u OBSERVACIONES (en
  // tarjeta, con la tarjeta ya enmascarada por el banco). REMESA, una por
  // movimiento: a la huella.
  bbva: { nombre: 'BBVA', entidad: '0182', fecha: [r('fecha'), r('f\\. ?contable'), r('fecha contable')], fechaValor: [r('f\\.? ?valor')],
    concepto: [[r('concepto')], [r('movimiento')], [r('beneficiario ?/ ?ordenante')], [r('observaciones')]], importe: [r('importe')], saldo: [r('disponible'), r('saldo')],
    referencia: [r('remesa')], propio: [r('c[oó]digo')] },
  santander: { nombre: 'Santander', entidad: '0049', fecha: [r('fecha operaci[oó]n'), r('fecha')], fechaValor: [r('fecha valor')],
    concepto: [[r('concepto')]], importe: [r('importe')], saldo: [r('saldo')] },
  caixabank: { nombre: 'CaixaBank', entidad: '2100', fecha: [r('fecha')], fechaValor: [r('fecha valor')],
    concepto: [[r('movimiento'), r('concepto')], [r('m[aá]s datos')]], importe: [r('importe')], saldo: [r('saldo')] },
  sabadell: { nombre: 'Banco Sabadell', entidad: '0081', fecha: [r('f\\. ?operativa'), r('fecha operaci[oó]n'), r('fecha')], fechaValor: [r('f\\. ?valor'), r('fecha valor')],
    concepto: [[r('concepto')]], importe: [r('importe')], saldo: [r('saldo')], referencia: [r('referencia 1')] },
  bankinter: { nombre: 'Bankinter', entidad: '0128', fecha: [r('fecha contable'), r('fecha')], fechaValor: [r('fecha valor')],
    concepto: [[r('descripci[oó]n'), r('concepto')]], importe: [r('importe')], saldo: [r('saldo')] },
  unicaja: { nombre: 'Unicaja', entidad: '2103', fecha: [r('fecha'), r('fecha operaci[oó]n')], fechaValor: [r('fecha valor')],
    concepto: [[r('concepto')]], importe: [r('importe')], saldo: [r('saldo')] },
  kutxabank: { nombre: 'Kutxabank', entidad: '2095', fecha: [r('fecha')], fechaValor: [r('fecha valor')],
    concepto: [[r('concepto')]], importe: [r('importe')], saldo: [r('saldo')] },
  ibercaja: { nombre: 'Ibercaja', entidad: '2085', fecha: [r('fecha oper\\.?'), r('fecha')], fechaValor: [r('fecha valor')],
    concepto: [[r('concepto')], [r('descripci[oó]n')]], importe: [r('importe')], saldo: [r('saldo')] },
  abanca: { nombre: 'Abanca', entidad: '2080', fecha: [r('fecha ctble\\.?'), r('fecha contable'), r('fecha')], fechaValor: [r('fecha valor')],
    concepto: [[r('concepto')]], importe: [r('importe')], saldo: [r('saldo')] },
  ing: { nombre: 'ING', entidad: '1465', fecha: [r('f\\. ?valor'), r('fecha')],
    concepto: [[r('descripci[oó]n')], [r('comentario')]], importe: [r('importe \\(€\\)'), r('importe')], saldo: [r('saldo \\(€\\)'), r('saldo')] },
  cajamar: { nombre: 'Cajamar', entidad: '3058', fecha: [r('fecha')], fechaValor: [r('fecha valor')],
    concepto: [[r('concepto')]], cargo: [r('cargo'), r('debe')], abono: [r('abono'), r('haber')], saldo: [r('saldo')] },
  tarjeta: { nombre: 'Tarjeta de crédito', entidad: null, fecha: [r('fecha( operaci[oó]n)?')],
    concepto: [[r('comercio'), r('establecimiento'), r('concepto'), r('descripci[oó]n')]], importe: [r('importe')], cargosEnPositivo: true },
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

function buscar(cabecera: string[], ps: Patrones | undefined): number {
  if (!ps) return -1
  for (const p of ps) {
    const i = cabecera.findIndex((c) => p.test(norm(c)))
    if (i >= 0) return i
  }
  return -1
}

/** «1.234,56», «-1.234,56», «1,234.56», «1234.56», «12,5 €», «(12,50)» → céntimos. Null si no es un importe. */
export function leerImporte(bruto: string): number | null {
  let s = bruto.replace(/[€\s]|EUR/gi, '').replace(/−/g, '-')
  if (s === '') return null
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
  else if (s.startsWith('+')) s = s.slice(1)
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1) }
  if (!/^[\d.,]+$/.test(s)) return null
  const ultComa = s.lastIndexOf(','), ultPunto = s.lastIndexOf('.')
  let entero: string, dec: string
  if (ultComa >= 0 && ultPunto >= 0) {
    const sep = ultComa > ultPunto ? ',' : '.'
    const i = s.lastIndexOf(sep)
    entero = s.slice(0, i).replace(/[.,]/g, ''); dec = s.slice(i + 1)
  } else if (ultComa >= 0) {
    if ((s.match(/,/g) ?? []).length > 1) { entero = s.replace(/,/g, ''); dec = '' }
    else { entero = s.slice(0, ultComa); dec = s.slice(ultComa + 1) }
  } else if (ultPunto >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) { entero = s.replace(/\./g, ''); dec = '' }
    else { entero = s.slice(0, ultPunto).replace(/\./g, ''); dec = s.slice(ultPunto + 1) }
  } else { entero = s; dec = '' }
  if (dec.length > 2) {
    // Un número de Excel con más decimales (1234.5600001): se redondea al céntimo.
    const v = Math.round(Number(`${entero || '0'}.${dec}`) * 100)
    return neg ? -v : v
  }
  const v = Number(entero || '0') * 100 + Number(dec.padEnd(2, '0') || '0')
  if (!Number.isFinite(v)) return null
  return neg ? -v : v
}

/** «13/10/2026», «13-10-26», «2026-10-13», o el número de serie de Excel → AAAA-MM-DD. Null si no es una fecha. */
export function leerFecha(bruto: string): string | null {
  const s = bruto.trim()
  let d: number, m: number, a: number
  let x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/)
  if (x) { d = Number(x[1]); m = Number(x[2]); a = Number(x[3]); if (a < 100) a += a >= 70 ? 1900 : 2000 }
  else if ((x = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/))) { a = Number(x[1]); m = Number(x[2]); d = Number(x[3]) }
  else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Número de serie de Excel (días desde el 30/12/1899).
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000)
    a = f.getUTCFullYear(); m = f.getUTCMonth() + 1; d = f.getUTCDate()
  } else return null
  const iso = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const f = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(f.getTime()) || f.getUTCDate() !== d || f.getUTCMonth() + 1 !== m) return null
  return iso
}

const RE_IBAN = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){4,7}(?:[ ]?[A-Z0-9]{1,3})?)\b/

/** El IBAN que traiga la parte de arriba del fichero («Cuenta: ES12 0182 …»), si es válido. */
function ibanEnCabecera(filas: string[][]): string | null {
  for (const f of filas) {
    for (const c of f) {
      const m = c.toUpperCase().match(RE_IBAN)
      if (m) {
        const v = validarIban(m[1])
        if (v.ok) return v.normalizado
      }
    }
  }
  return null
}

/** Qué perfil encaja con unas filas: el de la entidad del IBAN de la cabecera si lo hay; si no, el primero cuyas columnas estén todas. */
export function reconocerBanco(filas: string[][]): BancoCsv | null {
  const iban = ibanEnCabecera(filas.slice(0, 15))
  if (iban?.startsWith('ES')) {
    const ent = iban.slice(4, 8)
    const b = (Object.keys(PERFILES) as BancoCsv[]).find((k) => PERFILES[k].entidad === ent)
    if (b) return b
  }
  for (const k of Object.keys(PERFILES) as BancoCsv[]) if (k !== 'tarjeta' && filaDeCabecera(filas, PERFILES[k]) >= 0) return k
  return null
}

function filaDeCabecera(filas: string[][], p: PerfilBanco): number {
  for (let i = 0; i < Math.min(filas.length, 30); i++) {
    const f = filas[i]
    const tieneImporte = buscar(f, p.importe) >= 0 || (buscar(f, p.cargo) >= 0 && buscar(f, p.abono) >= 0)
    if (buscar(f, p.fecha) >= 0 && p.concepto.some((c) => buscar(f, c) >= 0) && tieneImporte) return i
  }
  return -1
}

/** ¿Vienen del más reciente al más antiguo? Por la cadena de saldos si la hay; si no, por las fechas. */
function masRecienteArriba(fs: { m: MovimientoLeido; saldo: number | null }[]): boolean {
  let subiendo = 0, bajando = 0
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1], b = fs[i]
    if (a.saldo === null || b.saldo === null) continue
    if (b.saldo === a.saldo + b.m.importeCent) subiendo++
    if (a.saldo === b.saldo + a.m.importeCent) bajando++
  }
  if (subiendo !== bajando) return bajando > subiendo
  return fs[0].m.fecha > fs[fs.length - 1].m.fecha
}

/** El valor de una etiqueta de la cabecera en pares («Titular» … «EMPRESA SL »): la siguiente celda no vacía de su fila. */
function valorDeCabecera(filas: string[][], etiqueta: RegExp): string | null {
  for (const f of filas) {
    const i = f.findIndex((c) => etiqueta.test(norm(c)))
    if (i >= 0) { const v = f.slice(i + 1).map(norm).find((c) => c !== ''); if (v) return v }
  }
  return null
}

/** Lee las filas de un Excel/CSV con el perfil de su banco. */
export function leerCsvBanco(filas: string[][], banco: BancoCsv): ExtractoLeido {
  const p = PERFILES[banco]
  const ic = filaDeCabecera(filas, p)
  if (ic < 0) {
    const falta = [p.importe ? 'Importe' : 'Cargo y Abono', 'Fecha', 'Concepto'].join(', ')
    throw new CsvBancoNoValido(`No encuentro la fila de títulos de ${p.nombre} (busco columnas como ${falta}). ¿Es la exportación de movimientos de ${p.nombre}?`)
  }
  const cab = filas[ic]
  const col = {
    fecha: buscar(cab, p.fecha), valor: buscar(cab, p.fechaValor),
    concepto: p.concepto.map((c) => buscar(cab, c)).filter((i) => i >= 0),
    importe: buscar(cab, p.importe), cargo: buscar(cab, p.cargo), abono: buscar(cab, p.abono),
    saldo: buscar(cab, p.saldo), ref: buscar(cab, p.referencia), propio: buscar(cab, p.propio),
  }
  const avisos: string[] = []
  const filasMov: { m: MovimientoLeido; saldo: number | null }[] = []
  for (let i = ic + 1; i < filas.length; i++) {
    const f = filas[i]
    const fecha = leerFecha(f[col.fecha] ?? '')
    if (!fecha) {
      if (f.some((c) => c.trim() !== '')) avisos.push(`Fila ${i + 1}: sin fecha; no es un movimiento («${norm(f.join(' ')).slice(0, 40)}»).`)
      continue
    }
    let imp: number | null
    if (col.importe >= 0) imp = leerImporte(f[col.importe] ?? '')
    else {
      const c = leerImporte(f[col.cargo] ?? '') ?? 0
      const a = leerImporte(f[col.abono] ?? '') ?? 0
      imp = a - Math.abs(c)
    }
    if (imp === null) throw new CsvBancoNoValido(`Fila ${i + 1}: el importe «${f[col.importe] ?? ''}» no es un número.`)
    if (p.cargosEnPositivo) imp = -imp
    // Las columnas del concepto, sin vacías ni repetidas (el beneficiario a veces se repite en las observaciones).
    const partes = col.concepto.map((j) => norm(f[j] ?? '')).filter((x, k, xs) => x !== '' && xs.indexOf(x) === k)
    const concepto = partes.join(' · ')
    filasMov.push({
      m: {
        fecha, fechaValor: (col.valor >= 0 ? leerFecha(f[col.valor] ?? '') : null) ?? fecha, importeCent: imp,
        conceptoBanco: concepto, conceptoComun: null, conceptoPropio: col.propio >= 0 ? (norm(f[col.propio] ?? '') || null) : null, numeroDocumento: null,
        referencia1: col.ref >= 0 ? (norm(f[col.ref] ?? '') || null) : null, referencia2: null, equivalencia: null,
      },
      saldo: col.saldo >= 0 ? leerImporte(f[col.saldo] ?? '') : null,
    })
  }
  if (filasMov.length === 0) throw new CsvBancoNoValido(`El fichero de ${p.nombre} no trae ningún movimiento.`)
  // Las bancas online suelen dar lo más reciente arriba: se pone en orden. Lo
  // dice la cadena de saldos (el saldo de cada fila es el de después de ese
  // movimiento), que vale también dentro de un mismo día; sin saldos, las fechas.
  if (masRecienteArriba(filasMov)) filasMov.reverse()
  const movimientos = filasMov.map((x) => x.m)
  const saldos = col.saldo >= 0 ? filasMov.map((x) => x.saldo) : null
  const conSaldo = saldos?.filter((s): s is number => s !== null) ?? []
  const iban = ibanEnCabecera(filas.slice(0, ic))
  const cuenta: CuentaLeida = {
    iban,
    identificacion: iban ? `${p.nombre} ···· ${iban.slice(-4)}` : p.nombre,
    titular: valorDeCabecera(filas.slice(0, ic), /^titular:?$/i), divisa: 'EUR',
    desde: movimientos[0].fecha, hasta: movimientos[movimientos.length - 1].fecha,
    saldoInicialCent: saldos && saldos[0] !== null ? saldos[0] - movimientos[0].importeCent : null,
    saldoFinalCent: conSaldo.length ? conSaldo[conSaldo.length - 1] : null,
    movimientos, control: null, saldosPorFila: saldos,
  }
  if (!iban) avisos.push('El fichero no dice de qué cuenta es: elige la cuenta al subirlo.')
  return { formato: `csv:${banco}`, cuentas: [cuenta], avisos }
}
