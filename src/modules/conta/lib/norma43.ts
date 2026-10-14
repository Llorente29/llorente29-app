// src/modules/conta/lib/norma43.ts
//
// B01 · Lector del fichero Norma 43 de la AEB («Información normalizada de
// cuenta corriente», cuaderno 43). Todos los bancos españoles lo dan. Registros
// de 80 posiciones:
//
//   11  cabecera de cuenta: entidad, oficina, cuenta, fechas, saldo inicial,
//       divisa, modalidad y nombre abreviado
//   22  movimiento: oficina de origen, fecha de operación y valor, concepto
//       común y propio, debe/haber, importe, documento, referencias 1 y 2
//   23  complementarios de concepto (hasta 5, dos trozos de 38 cada uno)
//   24  equivalencia de importe (divisa y importe de origen)
//   33  final de cuenta: número de apuntes y totales del debe y del haber,
//       saldo final y divisa
//   88  fin de fichero: dieciocho nueves y el número de registros
//
// Un fichero puede traer varias cuentas (un 11…33 por cada una) y termina con
// un 88. Las posiciones están en `CAMPOS`, una sola vez, y una prueba las
// compara con las longitudes del cuaderno descargado
// (docs/conta/fuentes/textos/aeb-cuaderno-43-cajamar.txt, «Nº 43, Junio 2012»). Puro y probado
// (tests/unit/modules/conta/bancosB01.test.ts).
//
// El IBAN no viene en el fichero: viene entidad, oficina y cuenta (sin los dos
// dígitos de control del CCC). Se reconstruye: dígitos de control del CCC
// (módulo 11, pesos 1 2 4 8 5 10 9 7 3 6) y, con ellos, el IBAN (módulo 97).

import type { CuentaLeida, ExtractoLeido, MovimientoLeido } from '@/modules/conta/lib/extractoBanco'

export class Norma43NoValido extends Error {}

/** Posiciones (desde 1, ambas incluidas) de cada campo, por registro. */
export const CAMPOS = {
  r11: { entidad: [3, 6], oficina: [7, 10], cuenta: [11, 20], fechaInicial: [21, 26], fechaFinal: [27, 32], claveSaldo: [33, 33],
    saldoInicial: [34, 47], divisa: [48, 50], modalidad: [51, 51], nombre: [52, 77] },
  r22: { oficinaOrigen: [7, 10], fechaOperacion: [11, 16], fechaValor: [17, 22], conceptoComun: [23, 24], conceptoPropio: [25, 27],
    claveDebeHaber: [28, 28], importe: [29, 42], documento: [43, 52], referencia1: [53, 64], referencia2: [65, 80] },
  r23: { codigoDato: [3, 4], concepto1: [5, 42], concepto2: [43, 80] },
  r24: { codigoDato: [3, 4], divisaOrigen: [5, 7], importe: [8, 21] },
  r33: { entidad: [3, 6], oficina: [7, 10], cuenta: [11, 20], apuntesDebe: [21, 25], totalDebe: [26, 39], apuntesHaber: [40, 44],
    totalHaber: [45, 58], claveSaldo: [59, 59], saldoFinal: [60, 73], divisa: [74, 76] },
  r88: { nueves: [3, 20], registros: [21, 26] },
} as const

/** Conceptos comunes de la AEB (dos cifras). */
export const CONCEPTOS_COMUNES: Record<string, string> = {
  '01': 'Talones, reintegros',
  '02': 'Abonarés, entregas, ingresos',
  '03': 'Domiciliados, recibos, letras, pagos por su cuenta',
  '04': 'Giros, transferencias, traspasos, cheques',
  '05': 'Amortizaciones de préstamos, créditos, etc.',
  '06': 'Remesas de efectos',
  '07': 'Suscripciones, dividendos pasivos, canje',
  '08': 'Dividendos, cupones, prima junta, amortizaciones',
  '09': 'Operaciones de bolsa y compraventa de valores',
  '10': 'Cheques de gasolina',
  '11': 'Cajero automático',
  '12': 'Tarjetas de crédito y débito',
  '13': 'Operaciones con el extranjero',
  '14': 'Devoluciones e impagados',
  '15': 'Nóminas, seguros sociales',
  '16': 'Timbres, corretaje, póliza',
  '17': 'Intereses, comisiones, custodia, gastos e impuestos',
  '98': 'Anulaciones, correcciones de asiento',
  '99': 'Varios',
}

/** ISO 4217 numérico → alfabético (las que se ven en España). */
// La tabla del anexo 2 del cuaderno («y cualquier otra divisa, de acuerdo con el
// código numérico que tenga establecido en la tabla del estándar ISO 4217»).
export const DIVISAS: Record<string, string> = {
  '036': 'AUD', '124': 'CAD', '208': 'DKK', '392': 'JPY', '554': 'NZD', '578': 'NOK', '752': 'SEK', '756': 'CHF', '826': 'GBP', '840': 'USD', '978': 'EUR',
}

const campo = (linea: string, [d, h]: readonly [number, number]) => linea.slice(d - 1, h)

function fecha(aammdd: string, donde: string): string {
  if (!/^\d{6}$/.test(aammdd)) throw new Norma43NoValido(`${donde}: la fecha «${aammdd}» no es AAMMDD.`)
  const aa = Number(aammdd.slice(0, 2)), mm = Number(aammdd.slice(2, 4)), dd = Number(aammdd.slice(4, 6))
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) throw new Norma43NoValido(`${donde}: la fecha «${aammdd}» no existe.`)
  // Dos cifras de año: el cuaderno no dice siglo. 70–99 → 19xx; el resto → 20xx.
  const anio = aa >= 70 ? 1900 + aa : 2000 + aa
  const iso = `${anio}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
  const d = new Date(`${iso}T00:00:00Z`)
  if (d.getUTCDate() !== dd) throw new Norma43NoValido(`${donde}: la fecha «${aammdd}» no existe.`)
  return iso
}

function importe(txt: string, donde: string): number {
  if (!/^\d+$/.test(txt)) throw new Norma43NoValido(`${donde}: el importe «${txt.trim()}» no son cifras.`)
  return Number(txt) // ya en céntimos: catorce posiciones, las dos últimas son los decimales
}

function entero(txt: string, donde: string): number {
  if (!/^\d+$/.test(txt)) throw new Norma43NoValido(`${donde}: «${txt.trim()}» no es un número.`)
  return Number(txt)
}

/** Clave debe/haber: 1 = debe (cargo, sale), 2 = haber (abono, entra). En saldos: 1 deudor, 2 acreedor. */
function signo(clave: string, donde: string): 1 | -1 {
  if (clave === '1') return -1
  if (clave === '2') return 1
  throw new Norma43NoValido(`${donde}: la clave debe/haber es «${clave}» y solo puede ser 1 o 2.`)
}

const texto = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t === '' ? null : t
}

/** Dígitos de control de un CCC (entidad + oficina + cuenta de 10). */
export function digitosControlCcc(entidad: string, oficina: string, cuenta: string): string {
  const pesos = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6]
  const dc = (diez: string) => {
    const r = 11 - (diez.split('').reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11)
    return r === 11 ? 0 : r === 10 ? 1 : r
  }
  return `${dc(`00${entidad}${oficina}`)}${dc(cuenta)}`
}

/** IBAN español a partir de entidad, oficina y cuenta (los dígitos de control del CCC se calculan). */
export function ibanDesdeCcc(entidad: string, oficina: string, cuenta: string): string {
  const bban = `${entidad}${oficina}${digitosControlCcc(entidad, oficina, cuenta)}${cuenta}`
  // «ES00» al final, letras a números (E=14, S=28): 98 − (número mod 97).
  const numerico = `${bban}142800`
  let resto = 0
  for (let i = 0; i < numerico.length; i += 7) resto = Number(String(resto) + numerico.slice(i, i + 7)) % 97
  return `ES${String(98 - resto).padStart(2, '0')}${bban}`
}

/** Lee un fichero Norma 43. Lanza `Norma43NoValido` con el motivo y la línea si algo no es del formato. */
export function leerNorma43(contenido: string): ExtractoLeido {
  const lineas = contenido.replace(/^\uFEFF/, '').split(/\r?\n|\r/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0)
  if (lineas.length === 0) throw new Norma43NoValido('El fichero está vacío.')
  if (!lineas[0].startsWith('11')) throw new Norma43NoValido('No es un Norma 43: la primera línea tiene que ser una cabecera de cuenta (empieza por 11).')

  const cuentas: CuentaLeida[] = []
  const avisos: string[] = []
  let actual: (CuentaLeida & { _entidad: string; _oficina: string; _cuenta: string }) | null = null
  let ultimo: MovimientoLeido | null = null
  let complementos: string[] = []
  let fin88: { registros: number; linea: number } | null = null

  const cerrarMovimiento = () => {
    if (ultimo && complementos.length) ultimo.conceptoBanco = [ultimo.conceptoBanco, ...complementos].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    complementos = []
  }

  lineas.forEach((bruta, i) => {
    const n = i + 1
    const donde = `Línea ${n}`
    if (fin88) throw new Norma43NoValido(`${donde}: hay registros después del fin de fichero (88).`)
    const l = bruta.padEnd(80, ' ')
    if (bruta.length > 80) throw new Norma43NoValido(`${donde}: tiene ${bruta.length} posiciones y un registro Norma 43 tiene 80.`)
    const tipo = l.slice(0, 2)
    switch (tipo) {
      case '11': {
        if (actual) throw new Norma43NoValido(`${donde}: empieza otra cuenta sin haber cerrado la anterior (falta su 33).`)
        const c = CAMPOS.r11
        const entidad = campo(l, c.entidad), oficina = campo(l, c.oficina), cuentaN = campo(l, c.cuenta)
        if (!/^\d{4}$/.test(entidad) || !/^\d{4}$/.test(oficina) || !/^\d{10}$/.test(cuentaN)) {
          throw new Norma43NoValido(`${donde}: la cabecera de cuenta no trae entidad, oficina y cuenta en cifras.`)
        }
        const divisaNum = campo(l, c.divisa)
        actual = {
          _entidad: entidad, _oficina: oficina, _cuenta: cuentaN,
          iban: ibanDesdeCcc(entidad, oficina, cuentaN),
          identificacion: `${entidad} ${oficina} ···· ${cuentaN.slice(-4)}`,
          titular: texto(campo(l, c.nombre)),
          divisa: DIVISAS[divisaNum] ?? divisaNum,
          desde: fecha(campo(l, c.fechaInicial), donde),
          hasta: fecha(campo(l, c.fechaFinal), donde),
          saldoInicialCent: signo(campo(l, c.claveSaldo), donde) * importe(campo(l, c.saldoInicial), donde),
          saldoFinalCent: null,
          movimientos: [],
          control: null,
          saldosPorFila: null,
        }
        if (!DIVISAS[divisaNum]) avisos.push(`${donde}: divisa «${divisaNum}» que no conozco; la dejo tal cual.`)
        ultimo = null
        break
      }
      case '22': {
        if (!actual) throw new Norma43NoValido(`${donde}: hay un movimiento antes de la cabecera de cuenta (11).`)
        cerrarMovimiento()
        const c = CAMPOS.r22
        const comun = campo(l, c.conceptoComun)
        const m: MovimientoLeido = {
          fecha: fecha(campo(l, c.fechaOperacion), donde),
          fechaValor: fecha(campo(l, c.fechaValor), donde),
          importeCent: signo(campo(l, c.claveDebeHaber), donde) * importe(campo(l, c.importe), donde),
          conceptoBanco: '',
          conceptoComun: /^\d{2}$/.test(comun) ? comun : null,
          conceptoPropio: texto(campo(l, c.conceptoPropio)),
          numeroDocumento: texto(campo(l, c.documento).replace(/^0+$/, '')),
          referencia1: texto(campo(l, c.referencia1).replace(/^0+$/, '')),
          referencia2: texto(campo(l, c.referencia2)),
          equivalencia: null,
        }
        if (m.conceptoComun && !CONCEPTOS_COMUNES[m.conceptoComun]) avisos.push(`${donde}: concepto común «${m.conceptoComun}» que no está en la lista de la AEB.`)
        actual.movimientos.push(m)
        ultimo = m
        break
      }
      case '23': {
        if (!ultimo) throw new Norma43NoValido(`${donde}: un complementario de concepto (23) sin movimiento (22) delante.`)
        const c = CAMPOS.r23
        if (complementos.length >= 10) throw new Norma43NoValido(`${donde}: más de cinco complementarios de concepto para un movimiento.`)
        complementos.push(campo(l, c.concepto1).trim(), campo(l, c.concepto2).trim())
        break
      }
      case '24': {
        if (!ultimo) throw new Norma43NoValido(`${donde}: una equivalencia de importe (24) sin movimiento (22) delante.`)
        const c = CAMPOS.r24
        const d = campo(l, c.divisaOrigen)
        ultimo.equivalencia = { divisa: DIVISAS[d] ?? d, importeCent: importe(campo(l, c.importe), donde) }
        break
      }
      case '33': {
        if (!actual) throw new Norma43NoValido(`${donde}: un final de cuenta (33) sin cabecera (11).`)
        cerrarMovimiento()
        const c = CAMPOS.r33
        if (campo(l, c.entidad) !== actual._entidad || campo(l, c.oficina) !== actual._oficina || campo(l, c.cuenta) !== actual._cuenta) {
          throw new Norma43NoValido(`${donde}: el final de cuenta es de otra cuenta que la cabecera (${actual.identificacion}).`)
        }
        actual.control = {
          apuntesDebe: entero(campo(l, c.apuntesDebe), donde),
          totalDebeCent: importe(campo(l, c.totalDebe), donde),
          apuntesHaber: entero(campo(l, c.apuntesHaber), donde),
          totalHaberCent: importe(campo(l, c.totalHaber), donde),
        }
        actual.saldoFinalCent = signo(campo(l, c.claveSaldo), donde) * importe(campo(l, c.saldoFinal), donde)
        for (const m of actual.movimientos) if (!m.conceptoBanco) m.conceptoBanco = m.conceptoComun ? CONCEPTOS_COMUNES[m.conceptoComun] ?? '' : ''
        const { _entidad, _oficina, _cuenta, ...limpia } = actual
        void _entidad; void _oficina; void _cuenta
        cuentas.push(limpia)
        actual = null
        ultimo = null
        break
      }
      case '88': {
        if (actual) throw new Norma43NoValido(`${donde}: el fin de fichero llega con la cuenta ${actual.identificacion} sin cerrar (falta su 33).`)
        const c = CAMPOS.r88
        if (campo(l, c.nueves) !== '9'.repeat(18)) avisos.push(`${donde}: el fin de fichero no trae los dieciocho nueves.`)
        fin88 = { registros: entero(campo(l, c.registros), donde), linea: n }
        break
      }
      default:
        throw new Norma43NoValido(`${donde}: el registro «${tipo}» no es de Norma 43 (11, 22, 23, 24, 33 u 88).`)
    }
  })

  if (actual) throw new Norma43NoValido(`La cuenta ${(actual as CuentaLeida).identificacion} no tiene final de cuenta (33): el fichero está cortado.`)
  const f88 = fin88 as { registros: number; linea: number } | null
  if (!f88) {
    avisos.push('El fichero no termina con el registro de fin de fichero (88).')
  } else if (f88.registros !== f88.linea - 1) {
    throw new Norma43NoValido(`El fin de fichero dice ${f88.registros} registros y hay ${f88.linea - 1}: el fichero está incompleto o tiene líneas de más.`)
  }
  if (cuentas.length === 0) throw new Norma43NoValido('El fichero no trae ninguna cuenta.')
  return { formato: 'norma43', cuentas, avisos }
}

/** ¿Parece Norma 43? (para elegir lector al soltar un fichero) */
export function pareceNorma43(contenido: string): boolean {
  const primera = contenido.replace(/^\uFEFF/, '').split(/\r?\n|\r/, 1)[0] ?? ''
  return /^11\d{18}\d{12}[12]\d{14}/.test(primera)
}

// ── Escritura (para las pruebas y la semilla de staging, con datos inventados) ──

export interface CuentaAEscribir {
  entidad: string; oficina: string; cuenta: string; nombre: string
  desde: string; hasta: string; saldoInicialCent: number
  movimientos: { fecha: string; fechaValor?: string; importeCent: number; comun: string; propio?: string; documento?: string; ref1?: string; ref2?: string; concepto: string }[]
}

const aammdd = (iso: string) => `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`
const num = (n: number, ancho: number) => String(Math.abs(n)).padStart(ancho, '0')
const txt = (s: string, ancho: number) => s.slice(0, ancho).padEnd(ancho, ' ')
const clave = (c: number) => (c < 0 ? '1' : '2')

/** Parte un concepto en trozos de 38 sin cortar palabras (como lo mandan los bancos). */
function trozosDe38(s: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const w of s.split(' ')) {
    if (cur && (cur + ' ' + w).length > 38) { out.push(cur); cur = w } else cur = cur ? `${cur} ${w}` : w
  }
  out.push(cur)
  return out
}

/** Escribe un Norma 43 que cuadra: saldo final, apuntes y totales salen de los movimientos. */
export function escribirNorma43(cuentas: CuentaAEscribir[]): string {
  const ls: string[] = []
  for (const c of cuentas) {
    ls.push(`11${c.entidad}${c.oficina}${c.cuenta}${aammdd(c.desde)}${aammdd(c.hasta)}${clave(c.saldoInicialCent)}${num(c.saldoInicialCent, 14)}9783${txt(c.nombre, 26)}   `)
    let debe = 0, haber = 0, nDebe = 0, nHaber = 0
    for (const m of c.movimientos) {
      ls.push(`22    ${c.oficina}${aammdd(m.fecha)}${aammdd(m.fechaValor ?? m.fecha)}${m.comun}${txt(m.propio ?? '000', 3)}${clave(m.importeCent)}${num(m.importeCent, 14)}${num(Number(m.documento ?? '0'), 10)}${txt(m.ref1 ?? '', 12)}${txt(m.ref2 ?? '', 16)}`)
      const trozos = trozosDe38(m.concepto)
      for (let i = 0; i < trozos.length; i += 2) ls.push(`23${String(i / 2 + 1).padStart(2, '0')}${txt(trozos[i], 38)}${txt(trozos[i + 1] ?? '', 38)}`)
      if (m.importeCent < 0) { debe -= m.importeCent; nDebe++ } else { haber += m.importeCent; nHaber++ }
    }
    const final = c.saldoInicialCent + haber - debe
    ls.push(`33${c.entidad}${c.oficina}${c.cuenta}${num(nDebe, 5)}${num(debe, 14)}${num(nHaber, 5)}${num(haber, 14)}${clave(final)}${num(final, 14)}978    `)
  }
  ls.push(`88${'9'.repeat(18)}${num(ls.length, 6)}${' '.repeat(54)}`)
  return ls.join('\r\n') + '\r\n'
}
