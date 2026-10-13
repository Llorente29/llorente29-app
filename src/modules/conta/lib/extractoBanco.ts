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
  /** El concepto tal y como lo da el banco (registros 22 y 23 juntos). */
  conceptoBanco: string
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
  if (c.saldosPorFila) {
    // Excel con columna de saldo: cada fila tiene que salir de la anterior.
    let previo: number | null = null
    c.movimientos.forEach((m, i) => {
      const s = c.saldosPorFila![i]
      if (s === null || s === undefined) return
      if (previo !== null && previo + m.importeCent !== s) {
        motivos.push(`${quien}: en la fila del ${m.fecha} (${eurosCent(m.importeCent)}) el saldo debería ser ${eurosCent(previo + m.importeCent)} y el fichero dice ${eurosCent(s)}.`)
      }
      previo = s
    })
  } else if (c.saldoInicialCent !== null && c.saldoFinalCent !== null) {
    const calculado = c.saldoInicialCent + suma
    if (calculado !== c.saldoFinalCent) {
      motivos.push(`${quien}: saldo inicial ${eurosCent(c.saldoInicialCent)} + movimientos ${eurosCent(suma)} = ${eurosCent(calculado)}, y el banco dice que el saldo final es ${eurosCent(c.saldoFinalCent)} (diferencia ${eurosCent(c.saldoFinalCent - calculado)}).`)
    }
  } else {
    sinComprobar.push(`${quien}: el fichero no trae saldos, así que no puedo comprobar que estén todos los movimientos.`)
  }
  return { ok: motivos.length === 0, motivos, sinComprobar }
}

/** El cuadre del extracto entero: no se importa nada si una sola cuenta no cuadra. */
export function cuadrar(e: ExtractoLeido): Cuadre {
  const partes = e.cuentas.map(cuadrarCuenta)
  return { ok: partes.every((p) => p.ok), motivos: partes.flatMap((p) => p.motivos), sinComprobar: partes.flatMap((p) => p.sinComprobar) }
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
  'RECIBO', 'RECIBOS', 'PAGO', 'PAGOS', 'CON', 'TARJETA', 'COMPRA', 'ADEUDO', 'ADEUDOS', 'DOMICILIACION', 'DOMICILIACIÓN', 'ABONO', 'ABONOS',
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
