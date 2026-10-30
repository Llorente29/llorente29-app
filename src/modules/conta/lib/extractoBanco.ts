// src/modules/conta/lib/extractoBanco.ts
//
// B01 · El modelo único de lo que trae un banco, venga de donde venga
// (fichero Norma 43, Excel/CSV, correo o agregador): una lista de cuentas, cada
// una con su saldo inicial y final y sus movimientos. Aquí viven las tres cosas
// que valen para todas las fuentes:
//
//   · el CUADRE: saldo inicial + movimientos = saldo final, y lo que el propio
//     fichero dice de sí mismo (número de apuntes y totales del registro 33 en
//     Norma 43; el saldo de cada fila en un Excel). Si no cuadra, no se importa;
//   · la HUELLA de cada movimiento, para que nunca entre dos veces: cuenta,
//     fecha, importe, referencias del banco y su número de orden dentro del día;
//   · el CONCEPTO LIMPIO, el que se enseña: sin asteriscos ni códigos.
//
// Puro y probado (tests/unit/modules/conta/bancosB01.test.ts). Los importes van
// en CÉNTIMOS enteros: ni una suma con decimales en coma flotante.

/** De dónde viene un extracto. `agregador:<proveedor>` cuando llegue la conexión directa. */
export type Fuente = 'fichero' | 'correo' | `agregador:${string}`

export interface MovimientoLeido {
  /** Fecha de la operación, AAAA-MM-DD. */
  fecha: string
  /** Fecha valor, AAAA-MM-DD (si la fuente no la trae, la de la operación). */
  fechaValor: string
  /** Céntimos con signo: + entra en la cuenta, − sale. */
  importeCent: number
  /**
   * El concepto tal y como lo da el banco: a quién pagas o quién te paga (en
   * Norma 43, los complementarios, registros 23). Vacío si el banco no lo da:
   * nunca se rellena con el tipo (15/10).
   */
  conceptoBanco: string
  /**
   * El tipo de movimiento, aparte del concepto (15/10): en Norma 43, la
   * descripción del concepto común de la AEB («Giros, transferencias…») o la
   * etiqueta del código propio del banco cuando el fichero solo trae eso.
   */
  tipoMovimiento: string | null
  /**
   * A quién pagas o quién te paga, limpio (B02): el comercio o la persona, sin
   * la tarjeta, sin asteriscos, sin códigos («Catcher», «Pago Fact Coheldi»).
   * Null si la fuente no lo dice. El texto del banco sigue en `conceptoBanco`.
   */
  contraparte: string | null
  /** Concepto común AEB (dos cifras) si lo hay. */
  conceptoComun: string | null
  /** Concepto propio de la entidad (tres cifras) si lo hay. */
  conceptoPropio: string | null
  numeroDocumento: string | null
  referencia1: string | null
  referencia2: string | null
  /** Importe y divisa de origen (registro 24), si el movimiento venía en otra moneda. */
  equivalencia: { divisa: string; importeCent: number } | null
}

export interface CuentaLeida {
  /** El IBAN si la fuente permite saberlo (en Norma 43 se reconstruye). */
  iban: string | null
  /** Lo que identifica la cuenta en el fichero cuando no hay IBAN («0182 0937 ···· 4525»). */
  identificacion: string
  titular: string | null
  divisa: string
  desde: string | null
  hasta: string | null
  saldoInicialCent: number | null
  saldoFinalCent: number | null
  movimientos: MovimientoLeido[]
  /** Lo que el fichero dice de sí mismo y se comprueba (Norma 43, registro 33). */
  control: { apuntesDebe: number; totalDebeCent: number; apuntesHaber: number; totalHaberCent: number } | null
  /** Cómo se ha comprobado el saldo fila a fila (Excel con columna de saldo). */
  saldosPorFila: (number | null)[] | null
}

export interface ExtractoLeido {
  formato: string
  cuentas: CuentaLeida[]
  avisos: string[]
}

export interface Cuadre {
  ok: boolean
  /** Por qué no cuadra, en palabras; vacío si cuadra. */
  motivos: string[]
  /** Lo que no se ha podido comprobar (un Excel sin saldo). No impide, pero se dice. */
  sinComprobar: string[]
  /**
   * S01d · Entra, pero se dice: el total cuadra y alguna fila del Excel no sale de
   * la anterior ni reordenando los movimientos de su día. Con sus filas.
   */
  avisos?: string[]
  filasRotas?: FilaRota[]
}

/** S01d · Una fila cuyo saldo no sale de la anterior (ni reordenando su día). */
export interface FilaRota { cuenta: string; fecha: string; fechaValor: string | null; concepto: string; importeCent: number; saldoCent: number; esperadoCent: number }

/**
 * S01d · BBVA ordena a su manera los movimientos de un mismo día: el saldo de
 * cada fila no siempre sale de la anterior. Dentro de cada día, se pone primero
 * el que sale del saldo anterior, y así hasta acabar el día; lo que no encadena
 * se queda donde estaba. Devuelve el orden (índices del fichero). Pura.
 */
export function encadenarPorDia(movs: readonly Pick<MovimientoLeido, 'fecha' | 'importeCent'>[], saldos: readonly (number | null)[]): number[] {
  const orden: number[] = []
  let previo: number | null = null
  let i = 0
  while (i < movs.length) {
    let j = i
    while (j < movs.length && movs[j].fecha === movs[i].fecha) j++
    const resto = Array.from({ length: j - i }, (_, k) => i + k)
    while (resto.length) {
      const k: number = previo === null ? -1 : resto.findIndex((x) => saldos[x] !== null && saldos[x] !== undefined && previo! + movs[x].importeCent === saldos[x])
      const elegido: number = resto.splice(k < 0 ? 0 : k, 1)[0]
      orden.push(elegido)
      const s: number | null | undefined = saldos[elegido]
      previo = s === null || s === undefined ? (previo === null ? null : previo + movs[elegido].importeCent) : s
    }
    i = j
  }
  return orden
}

export const cent = (euros: number) => Math.round(euros * 100)
export const aEuros = (c: number) => c / 100

/** «1.234,56 €» para los mensajes del cuadre (sin Intl: mismo motivo que formato.ts). */
export function eurosCent(c: number): string {
  const neg = c < 0
  const abs = Math.abs(c)
  const ent = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '−' : ''}${ent},${String(abs % 100).padStart(2, '0')} €`
}

/** El cuadre de UNA cuenta. */
export function cuadrarCuenta(c: CuentaLeida): Cuadre {
  const motivos: string[] = []
  const sinComprobar: string[] = []
  const quien = c.identificacion
  const suma = c.movimientos.reduce((a, m) => a + m.importeCent, 0)
  if (c.control) {
    const debe = c.movimientos.filter((m) => m.importeCent < 0)
    const haber = c.movimientos.filter((m) => m.importeCent > 0)
    const tDebe = -debe.reduce((a, m) => a + m.importeCent, 0)
    const tHaber = haber.reduce((a, m) => a + m.importeCent, 0)
    if (debe.length !== c.control.apuntesDebe) motivos.push(`${quien}: el final de cuenta dice ${c.control.apuntesDebe} cargos y hay ${debe.length}.`)
    if (haber.length !== c.control.apuntesHaber) motivos.push(`${quien}: el final de cuenta dice ${c.control.apuntesHaber} abonos y hay ${haber.length}.`)
    if (tDebe !== c.control.totalDebeCent) motivos.push(`${quien}: los cargos suman ${eurosCent(tDebe)} y el final de cuenta dice ${eurosCent(c.control.totalDebeCent)}.`)
    if (tHaber !== c.control.totalHaberCent) motivos.push(`${quien}: los abonos suman ${eurosCent(tHaber)} y el final de cuenta dice ${eurosCent(c.control.totalHaberCent)}.`)
  }
  const filasRotas: FilaRota[] = []
  if (c.saldosPorFila) {
    // Excel con columna de saldo: cada fila sale de la anterior, una vez puestos en orden
    // los movimientos de cada día (S01d). Lo que sigue roto se dice; lo que manda es el total.
    const orden = encadenarPorDia(c.movimientos, c.saldosPorFila)
    let previo: number | null = null
    let primero: number | null = null
    let ultimo: number | null = null
    for (const i of orden) {
      const m = c.movimientos[i]
      const s = c.saldosPorFila[i]
      if (s === null || s === undefined) { if (previo !== null) previo += m.importeCent; continue }
      if (primero === null) primero = s - m.importeCent
      if (previo !== null && previo + m.importeCent !== s) {
        filasRotas.push({ cuenta: quien, fecha: m.fecha, fechaValor: m.fechaValor ?? null, concepto: m.conceptoBanco, importeCent: m.importeCent, saldoCent: s, esperadoCent: previo + m.importeCent })
      }
      previo = s
      ultimo = s
    }
    const inicial = c.saldoInicialCent ?? primero
    const final = c.saldoFinalCent ?? ultimo
    if (inicial !== null && final !== null && inicial + suma !== final) {
      motivos.push(`${quien}: saldo inicial ${eurosCent(inicial)} + movimientos ${eurosCent(suma)} = ${eurosCent(inicial + suma)}, y el banco dice que el saldo final es ${eurosCent(final)} (diferencia ${eurosCent(final - inicial - suma)}).`)
    }
  } else if (c.saldoInicialCent !== null && c.saldoFinalCent !== null) {
    const calculado = c.saldoInicialCent + suma
    if (calculado !== c.saldoFinalCent) {
      motivos.push(`${quien}: saldo inicial ${eurosCent(c.saldoInicialCent)} + movimientos ${eurosCent(suma)} = ${eurosCent(calculado)}, y el banco dice que el saldo final es ${eurosCent(c.saldoFinalCent)} (diferencia ${eurosCent(c.saldoFinalCent - calculado)}).`)
    }
  } else {
    sinComprobar.push(`${quien}: el fichero no trae saldos, así que no puedo comprobar que estén todos los movimientos.`)
  }
  const avisos = filasRotas.length === 0 ? [] : [filasRotas.length === 1
    ? `${quien}: en 1 fila el saldo del banco no sale de la anterior; el total cuadra.`
    : `${quien}: en ${filasRotas.length} filas el saldo del banco no sale de la anterior; el total cuadra.`]
  return { ok: motivos.length === 0, motivos, sinComprobar, avisos, filasRotas }
}

/** El cuadre del extracto entero: no se importa nada si una sola cuenta no cuadra. */
export function cuadrar(e: ExtractoLeido): Cuadre {
  const partes = e.cuentas.map(cuadrarCuenta)
  return { ok: partes.every((p) => p.ok), motivos: partes.flatMap((p) => p.motivos), sinComprobar: partes.flatMap((p) => p.sinComprobar),
    avisos: partes.flatMap((p) => p.avisos ?? []), filasRotas: partes.flatMap((p) => p.filasRotas ?? []) }
}

/**
 * La huella de cada movimiento de una cuenta, en el mismo orden, como pide el
 * encargo: fecha, importe, referencias del banco (documento, referencia 1 y 2)
 * y el número de orden dentro del día entre los movimientos con esos mismos
 * datos (el segundo café de 1,20 € del mismo día no es el primero). Volver a
 * subir el mismo extracto, o uno que se solapa con el anterior, da las mismas
 * huellas y no entra nada dos veces. La cuenta la pone la base (índice único
 * por cuenta y huella).
 */
export function huellas(movs: readonly MovimientoLeido[]): string[] {
  return conOrden(movs, (m) => [m.fecha, m.importeCent, m.numeroDocumento ?? '', m.referencia1 ?? '', m.referencia2 ?? ''].join('|'))
}

// ── Nunca una tarjeta entera (15/10) ──────────────────────────────────────────
// Una tira de 15 a 19 cifras, sin cifras pegadas a los lados, que empieza como
// una tarjeta (Visa 4, Mastercard 51–55 o 2221–2720, Amex 34/37) y pasa Luhn,
// se guarda solo con sus 4 últimas: «····1234». Lo demás se queda: las
// referencias de recibos y transferencias (en el Excel de BBVA hay de 14 a 16
// cifras, y alguna pasa Luhn por casualidad) sirven para casar (Julio, 15/10,
// opción a). La base hace lo mismo con un disparador (20261101T0190, criterio
// de 20261101T0192), para lo que llegue por otro camino.

/** ¿Pasa el control de Luhn? (solo cifras, de 13 a 19). */
export function pasaLuhn(cifras: string): boolean {
  if (!/^\d{13,19}$/.test(cifras)) return false
  let suma = 0
  for (let i = 0; i < cifras.length; i++) {
    let d = Number(cifras[cifras.length - 1 - i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    suma += d
  }
  return suma % 10 === 0
}

/** ¿Es una tarjeta entera? 15 a 19 cifras, el comienzo de Visa, Mastercard o Amex, y Luhn. */
export function pareceTarjeta(cifras: string): boolean {
  if (!/^\d{15,19}$/.test(cifras)) return false
  const iin4 = Number(cifras.slice(0, 4))
  const marca = /^4/.test(cifras) || /^5[1-5]/.test(cifras) || (iin4 >= 2221 && iin4 <= 2720) || /^3[47]/.test(cifras)
  return marca && pasaLuhn(cifras)
}

/** El texto con cada tarjeta entera reducida a «····» y sus 4 últimas. */
export function ocultarTarjetas(texto: string): string
export function ocultarTarjetas(texto: string | null): string | null
export function ocultarTarjetas(texto: string | null): string | null {
  if (texto === null) return null
  return texto.replace(/(?<!\d)\d{15,19}(?!\d)/g, (t) => (pareceTarjeta(t) ? `····${t.slice(-4)}` : t))
}

/** El movimiento tal y como se guarda: sin tarjetas enteras en el concepto, el documento ni las referencias. */
export function movimientoSinTarjetas(m: MovimientoLeido): MovimientoLeido {
  return { ...m, conceptoBanco: ocultarTarjetas(m.conceptoBanco), numeroDocumento: ocultarTarjetas(m.numeroDocumento),
    referencia1: ocultarTarjetas(m.referencia1), referencia2: ocultarTarjetas(m.referencia2), contraparte: ocultarTarjetas(m.contraparte) }
}

// ── La contraparte limpia (B02) ──────────────────────────────────────────────
// La MISMA regla que la base (_bank_contraparte_limpia, 20261101T0200), para lo
// que se rellena de lo ya guardado: los ejemplos de su prueba de staging
// (supabase/staging/sql/20261101_b02_entrada_prueba.sql) los pasa también una
// prueba unitaria contra esta función.
//   1. fuera la tarjeta enmascarada («************1234», «XXXX 1234»);
//   2. fuera las referencias tipo IBAN («ES0182…») y toda tira de 5 o más cifras;
//   3. fuera lo que no es letra, cifra, espacio, «&», «.» o «-»;
//   4. con mayúscula inicial en cada palabra; «de», «del», «la», «las», «los»,
//      «el», «y», «en» en minúscula (salvo al principio) y las formas jurídicas
//      (SL, SA, SLU, SC, CB) en mayúsculas.
const CONECTORES = ['De', 'Del', 'La', 'Las', 'Los', 'El', 'Y', 'En']
const FORMAS = ['Sl', 'Sa', 'Slu', 'Sc', 'Cb']

/** El nombre de quien paga o cobra, limpio. Null si no queda nada. */
export function limpiarContraparte(texto: string | null): string | null {
  if (!texto) return null
  let s = texto.toUpperCase()
    .replace(/[*X•·]{3,} ?[0-9]{4}/g, ' ')
    .replace(/[A-Z]{2}[0-9]{2}[A-Z0-9]{10,}/g, ' ')
    .replace(/[0-9]{5,}/g, ' ')
    .replace(/[^\p{L}\p{N} &.-]/gu, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^[ -]+|[ -]+$/g, '')
  if (!s) return null
  s = s.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
  for (const c of CONECTORES) s = s.replace(new RegExp(` ${c}(?= )`, 'g'), ` ${c.toLowerCase()}`)
  for (const f of FORMAS) s = s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${f}(?![\\p{L}\\p{N}])`, 'gu'), f.toUpperCase())
  return s
}

/**
 * La huella SUAVE: solo fecha, importe y orden. Sirve para cazar el mismo
 * movimiento traído por dos caminos que no dan las mismas referencias (un Excel
 * una semana y el Norma 43 la siguiente): no se importa como nuevo, se enseña
 * como «posible repetido» y decide la persona.
 */
export function huellasSuaves(movs: readonly MovimientoLeido[]): string[] {
  return conOrden(movs, (m) => `${m.fecha}|${m.importeCent}`)
}

function conOrden(movs: readonly MovimientoLeido[], clave: (m: MovimientoLeido) => string): string[] {
  const vistos = new Map<string, number>()
  return movs.map((m) => {
    const base = clave(m)
    const n = (vistos.get(base) ?? 0) + 1
    vistos.set(base, n)
    return `${base}|${n}`
  })
}

/**
 * Palabras de la OPERACIÓN (lo que pone el banco), que se bajan a minúscula.
 * Todo lo demás —el nombre del tercero, sobre todo— se queda como viene: así lo
 * enseña N17 («Pago con tarjeta MERCADO CENTRAL 0937», «Recibo SUMINISTROS
 * ELÉCTRICOS DEL NORTE»).
 */
const OPERACION = new Set([
  'TRANSFERENCIA', 'TRANSFERENCIAS', 'TRANSF', 'TRANSF.', 'RECIBIDA', 'RECIBIDO', 'REALIZADA', 'EMITIDA', 'ORDENANTE', 'BENEFICIARIO',
  'RECIBO', 'RECIBOS', 'PAGO', 'PAGOS', 'CON', 'TARJETA', 'TARJ', 'TARJ.', 'COMPRA', 'ADEUDO', 'ADEUDOS', 'DOMICILIACION', 'DOMICILIACIÓN', 'ABONO', 'ABONOS',
  'INGRESO', 'INGRESOS', 'EFECTIVO', 'REINTEGRO', 'CAJERO', 'COMISION', 'COMISIÓN', 'COMISIONES', 'MANTENIMIENTO', 'CUOTA', 'CUOTAS',
  'TRASPASO', 'TRASPASOS', 'LIQUIDACION', 'LIQUIDACIÓN', 'INTERESES', 'PRESTAMO', 'PRÉSTAMO', 'AMORTIZACION', 'AMORTIZACIÓN',
  'DEVOLUCION', 'DEVOLUCIÓN', 'NOMINA', 'NÓMINA', 'IMPUESTO', 'IMPUESTOS', 'SEGUROS', 'SOCIALES', 'BIZUM', 'CUENTA', 'A', 'DE', 'AL',
  'EN', 'POR', 'PARA', 'SU', 'REF', 'REF.', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE',
  'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'SEPT', 'OCT', 'NOV', 'DIC',
])

/**
 * El concepto que se enseña: sin asteriscos, sin códigos sueltos ni rellenos de
 * ceros, sin espacios dobles. Si el banco lo manda todo en mayúsculas (casi
 * siempre), las palabras de la operación se escriben en minúscula y la primera
 * con mayúscula; el nombre del tercero y las siglas (TGSS, SL) se quedan. Lo que
 * ya viene con mayúsculas y minúsculas no se toca.
 */
export function limpiarConcepto(bruto: string): string {
  let s = bruto
    .replace(/\*+/g, ' ')
    .replace(/\b0{4,}\d*\b/g, ' ')          // rellenos de ceros
    .replace(/\b[A-Z]{0,2}\d{8,}\b/g, ' ')  // números largos de operación
    .replace(/[_#|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  s = s.replace(/^[-·,:;\s]+|[-·,:;\s]+$/g, '')
  if (s !== s.toUpperCase() || !/[A-ZÁÉÍÓÚÑ]/.test(s)) return s
  // «DEL», «LA» o «Y» no están en la lista: casi siempre son del nombre.
  return s.split(' ').map((p, i) => {
    const bajar = OPERACION.has(p)
    const bajo = bajar ? p.toLowerCase() : p
    return i === 0 ? bajo.charAt(0).toUpperCase() + bajo.slice(1) : bajo
  }).join(' ')
}

/**
 * Qué movimientos de una cuenta son nuevos frente a lo que ya hay: los de huella
 * conocida son repetidos (no cambian nada); los de huella nueva pero huella suave
 * conocida, posibles repetidos traídos por otro camino (los decide la persona).
 */
export function separarNuevos(yaEstan: { huellas: ReadonlySet<string>; suaves: ReadonlySet<string> }, movs: readonly MovimientoLeido[]):
  { nuevos: number[]; repetidos: number[]; posiblesRepetidos: number[] } {
  const hs = huellas(movs)
  const ss = huellasSuaves(movs)
  const r = { nuevos: [] as number[], repetidos: [] as number[], posiblesRepetidos: [] as number[] }
  movs.forEach((_, i) => {
    if (yaEstan.huellas.has(hs[i])) r.repetidos.push(i)
    else if (yaEstan.suaves.has(ss[i])) r.posiblesRepetidos.push(i)
    else r.nuevos.push(i)
  })
  return r
}

/** «He leído 2 cuentas, 158 movimientos, del 01/10 al 13/10; cuadra con el saldo del banco.» */
export function resumenLectura(e: ExtractoLeido, c: Cuadre): string {
  const movs = e.cuentas.reduce((a, x) => a + x.movimientos.length, 0)
  const fechas = e.cuentas.flatMap((x) => x.movimientos.map((m) => m.fecha)).sort()
  const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  const n = e.cuentas.length
  const cuentas = `${n} ${n === 1 ? 'cuenta' : 'cuentas'}`
  const movTxt = `${movs} ${movs === 1 ? 'movimiento' : 'movimientos'}`
  const rango = fechas.length ? `, del ${ddmm(fechas[0])} al ${ddmm(fechas[fechas.length - 1])}` : ''
  const cola = !c.ok ? '; NO cuadra: no lo importo.'
    : c.sinComprobar.length ? '; el fichero no trae saldos para comprobarlo.'
    : '; cuadra con el saldo del banco.'
  return `He leído ${cuentas}, ${movTxt}${rango}${cola}`
}
