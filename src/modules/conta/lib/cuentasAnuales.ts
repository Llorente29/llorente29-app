// src/modules/conta/lib/cuentasAnuales.ts
//
// C05 · Balance, pérdidas y ganancias y estado de ingresos y gastos con los
// modelos oficiales. Núcleo puro: recibe las líneas del modelo, el mapeo
// (serie + lo propio de la empresa) y los saldos de las cuentas; devuelve cada
// línea con su importe y sus cuentas. Reglas del encargo C05 (§6):
//
//   1. Balance: activo = patrimonio neto + pasivo al céntimo, en cualquier
//      fecha. Si no cuadra, se dice cuánto y por qué (una cuenta sin sitio).
//   2. Toda cuenta con saldo va a UNA línea de cada estado; sin línea sale en
//      rojo «sin sitio en el modelo». Nunca se omite en silencio.
//   3. Resultado de la PyG = resultado del balance (129 + 6 y 7 sin regularizar).
//   4. Modelo propuesto por los límites de la LSC (arts. 257 y 258) y del RD
//      1515/2007 art. 2 (versión vigente: los mismos que el 257).
//   8. Año anterior: si no hay ejercicio anterior, la columna lo dice y no
//      inventa ceros.
//   9. Mapeo propio con «volver al estándar» (las funciones de la base dejan el
//      historial); aquí, cómo se combina con la serie y qué deja fuera.
//  10. Por local y marca solo si la empresa tiene más de un local o marcas.

export type Modelo = 'normal' | 'abreviado' | 'pymes'
export type Estado = 'balance' | 'pyg' | 'igrpn'

export interface LineaModelo {
  code: string
  parentCode: string | null
  text: string
  level: number
  sortOrder: number
  side: 'activo' | 'pn_pasivo' | null
  isTotal: boolean
  toCreate: boolean
  legalRef: string
}

export interface FilaMapeo {
  lineCode: string
  prefix: string
  sign: 'suma' | 'resta'
  byBalance: 'deudor' | 'acreedor' | null
  origin: 'boe' | 'a_crear' | 'resultado' | 'defecto' | 'empresa'
  excluded?: boolean
  note?: string | null
}

export interface SaldoCuenta {
  /** Código de la cuenta de la empresa (p. ej. 43000001). */
  code: string
  name: string
  /** Código de la plantilla del PGC (p. ej. 4300): manda para colocarla. */
  templateCode: string | null
  debe: number
  haber: number
  companyAccountId?: string
}

export interface CuentaEnLinea extends SaldoCuenta {
  importe: number
  origen: FilaMapeo['origin']
  porDefecto: boolean
  nota: string | null
  /** Saldo con el signo contrario al natural de su lado (cliente acreedor…): ámbar en pantalla. */
  anomalo: boolean
}

export interface LineaCalculada extends LineaModelo {
  importe: number
  cuentas: CuentaEnLinea[]
  /** Partida «a crear» sin saldo: no se enseña. */
  oculta: boolean
}

export interface ResultadoEstado {
  lineas: LineaCalculada[]
  sinSitio: (SaldoCuenta & { saldo: number })[]
  porDefecto: CuentaEnLinea[]
}

export const centimos = (n: number) => Math.round(n * 100)
const r2 = (n: number) => centimos(n) / 100
const saldoDeudor = (s: { debe: number; haber: number }) => r2(s.debe - s.haber)

/** El estado al que va una cuenta por su grupo. */
export const estadoDeCuenta = (code: string): Estado => (/^[12345]/.test(code) ? 'balance' : /^[67]/.test(code) ? 'pyg' : 'igrpn')

/**
 * Regla 9: el mapeo efectivo de una empresa. Lo propio manda sobre la serie
 * para el mismo prefijo (y el mismo signo por saldo); una fila propia
 * «excluded» quita ese prefijo de la serie sin ponerlo en otra línea.
 */
export function mapeoEfectivo(serie: FilaMapeo[], propio: FilaMapeo[]): FilaMapeo[] {
  const clave = (m: FilaMapeo) => `${m.prefix}|${m.byBalance ?? ''}`
  const tapados = new Set(propio.map(clave))
  const tapadosSinSigno = new Set(propio.filter((m) => !m.byBalance).map((m) => m.prefix))
  const base = serie.filter((m) => !tapados.has(clave(m)) && !tapadosSinSigno.has(m.prefix))
  // Las filas «excluded» se quedan: tapan su prefijo aunque la serie lo cubra
  // con uno más corto (dejar fuera la 572 cuando la serie dice 57).
  return [...base, ...propio]
}

/**
 * Dónde va una cuenta: el prefijo más largo que la cubre; si hay dos filas
 * (activo y pasivo) van por el signo de su saldo. null = sin sitio (regla 2).
 */
export function colocar(codigoPlantilla: string, saldo: number, mapeo: FilaMapeo[]): FilaMapeo | null {
  const cubren = mapeo.filter((m) => codigoPlantilla.startsWith(m.prefix))
  if (!cubren.length) return null
  const max = Math.max(...cubren.map((m) => m.prefix.length))
  const top = cubren.filter((m) => m.prefix.length === max)
  if (top.some((m) => m.excluded)) return null
  if (top.length === 1) return top[0]
  const lado = saldo >= 0 ? 'deudor' : 'acreedor'
  return top.find((m) => m.byBalance === lado) ?? top.find((m) => !m.byBalance) ?? top[0]
}

/** Las cuentas de una fórmula de total: «(1 + 2 + … + 11)», «(A.1+A.2)», «(C + 17)». */
export function terminosDeFormula(texto: string): string[] {
  const m = texto.match(/\(([^()]*\+[^()]*)\)\s*\.?\s*$/)
  if (!m) return []
  return m[1].split('+').map((t) => t.trim().replace(/\s+/g, '')).filter(Boolean)
}

/**
 * Calcula un estado. `saldos` son los de las cuentas de la empresa (Debe y
 * Haber acumulados a la fecha o en el periodo, según el estado).
 */
export function calcularEstado(estado: Estado, lineas: LineaModelo[], mapeo: FilaMapeo[], saldos: SaldoCuenta[]): ResultadoEstado {
  const porCodigo = new Map<string, LineaCalculada>()
  const calc: LineaCalculada[] = [...lineas].sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({ ...l, importe: 0, cuentas: [], oculta: false }))
  for (const l of calc) porCodigo.set(l.code, l)
  const sinSitio: ResultadoEstado['sinSitio'] = []
  const porDefecto: CuentaEnLinea[] = []

  for (const s of saldos) {
    const plantilla = s.templateCode ?? s.code
    const deudor = saldoDeudor(s)
    if (deudor === 0 && centimos(s.debe) === 0 && centimos(s.haber) === 0) continue
    if (estado === 'balance' && !/^[1-7]/.test(plantilla)) continue
    if (estado === 'pyg' && !/^[67]/.test(plantilla)) continue
    if (estado === 'igrpn' && !/^[89]/.test(plantilla)) continue
    const m = colocar(plantilla, deudor, mapeo)
    const linea = m ? porCodigo.get(m.lineCode) : undefined
    if (!m || !linea) {
      if (deudor !== 0) sinSitio.push({ ...s, saldo: deudor })
      continue
    }
    const natural = linea.side === 'activo' ? deudor : -deudor
    const anomalo = natural < 0 && m.origin !== 'resultado' && m.sign === 'suma' && estado === 'balance'
    const c: CuentaEnLinea = { ...s, importe: r2(natural), origen: m.origin, porDefecto: m.origin === 'defecto', nota: m.note ?? null, anomalo }
    linea.cuentas.push(c)
    linea.importe = r2(linea.importe + natural)
    if (c.porDefecto && deudor !== 0) porDefecto.push(c)
  }

  // Los padres suman a sus hijos (regla 5 también aquí); de abajo arriba.
  const hijos = (code: string) => calc.filter((l) => l.parentCode === code && !l.isTotal)
  const sumar = (l: LineaCalculada): number => {
    const hs = hijos(l.code)
    if (!hs.length) return l.importe
    const propio = l.cuentas.reduce((a, c) => a + c.importe, 0)
    l.importe = r2(propio + hs.reduce((a, h) => a + sumar(h), 0))
    return l.importe
  }
  for (const l of calc.filter((x) => !x.parentCode && !x.isTotal)) sumar(l)

  // Totales.
  if (estado === 'balance') {
    for (const t of calc.filter((l) => l.isTotal)) {
      const lado = t.code.startsWith('=ACT') ? 'activo' : 'pn_pasivo'
      t.importe = r2(calc.filter((l) => l.side === lado && l.level === 1 && !l.isTotal).reduce((a, l) => a + l.importe, 0))
    }
  } else {
    // PyG e ingresos y gastos: cada total con su fórmula; las partidas a crear
    // que quedan antes de él (forman parte del resultado de explotación) también.
    let anterior = -1
    for (const t of calc.filter((l) => l.isTotal)) {
      const terminos = terminosDeFormula(t.text)
      let suma = 0
      for (const term of terminos) {
        const l = porCodigo.get(term) ?? porCodigo.get('=' + term)
        if (l) suma += l.importe
      }
      if (!terminos.length) {
        // Sin fórmula legible: lo que haya desde el total anterior.
        suma = calc.filter((l) => !l.isTotal && l.level === Math.min(...calc.filter((x) => !x.isTotal).map((x) => x.level)) && l.sortOrder > anterior && l.sortOrder < t.sortOrder).reduce((a, l) => a + l.importe, 0)
      }
      for (const l of calc) if (l.toCreate && l.sortOrder > anterior && l.sortOrder < t.sortOrder && terminos.some((x) => /^\d+$/.test(x))) suma += l.importe
      t.importe = r2(suma)
      anterior = t.sortOrder
    }
  }
  for (const l of calc) l.oculta = l.toCreate && l.cuentas.length === 0
  return { lineas: calc, sinSitio, porDefecto }
}

/** Regla 1: activo = patrimonio neto + pasivo, al céntimo. */
export function cuadreBalance(r: ResultadoEstado): { activo: number; pnPasivo: number; diferencia: number; cuadra: boolean; porque: string | null } {
  const activo = r2(r.lineas.filter((l) => l.side === 'activo' && l.level === 1 && !l.isTotal).reduce((a, l) => a + l.importe, 0))
  const pnPasivo = r2(r.lineas.filter((l) => l.side === 'pn_pasivo' && l.level === 1 && !l.isTotal).reduce((a, l) => a + l.importe, 0))
  const diferencia = r2(activo - pnPasivo)
  const cuadra = centimos(diferencia) === 0
  const sin = r.sinSitio.reduce((a, s) => a + s.saldo, 0)
  const porque = cuadra ? null
    : r.sinSitio.length
      ? `No cuadra por ${fmt(Math.abs(diferencia))}: ${r.sinSitio.length === 1 ? 'una cuenta no tiene' : `${r.sinSitio.length} cuentas no tienen`} sitio en el modelo (${r.sinSitio.map((s) => s.code).join(', ')}, ${fmt(sin)}).`
      : `No cuadra por ${fmt(Math.abs(diferencia))}. Un asiento descuadrado no puede haber: revisa el mapeo propio de la empresa.`
  return { activo, pnPasivo, diferencia, cuadra, porque }
}

/** Regla 3: las tres cifras del resultado. */
export function resultadoTresCifras(pyg: ResultadoEstado, balance: ResultadoEstado, saldo129: number): {
  pyg: number; balance: number; cuenta129: number; iguales: boolean
} {
  const totalPyg = pyg.lineas.filter((l) => l.isTotal).sort((a, b) => b.sortOrder - a.sortOrder)[0]?.importe ?? 0
  const lineaResultado = balance.lineas.find((l) => /Resultado del ejercicio/i.test(l.text) && l.side === 'pn_pasivo')
  const enBalance = lineaResultado?.importe ?? 0
  return { pyg: totalPyg, balance: enBalance, cuenta129: r2(saldo129), iguales: centimos(totalPyg) === centimos(enBalance) }
}

// ── Regla 4: qué modelo le toca ─────────────────────────────────────────────

export interface Magnitudes { activo: number; cifraNegocios: number; plantillaMedia: number }

/** LSC art. 257.1 (balance y ECPN abreviados) = RD 1515/2007 art. 2.1 (pymes), versión vigente. */
export const LIMITES_ABREVIADO = { activo: 4_000_000, cifraNegocios: 8_000_000, plantillaMedia: 50 }
/** LSC art. 258.1 (PyG abreviada). */
export const LIMITES_PYG_ABREVIADA = { activo: 11_400_000, cifraNegocios: 22_800_000, plantillaMedia: 250 }

const dosDeTres = (m: Magnitudes, l: typeof LIMITES_ABREVIADO) =>
  [m.activo <= l.activo, m.cifraNegocios <= l.cifraNegocios, m.plantillaMedia <= l.plantillaMedia].filter(Boolean).length >= 2

/**
 * El modelo que corresponde: dos de tres límites durante DOS ejercicios
 * seguidos (en el primero, basta ese). `anterior` null = primer ejercicio.
 */
export function modeloPropuesto(actual: Magnitudes, anterior: Magnitudes | null): { modelo: Modelo; pygAbreviada: boolean; frase: string; permitidos: Modelo[] } {
  const cumple = (l: typeof LIMITES_ABREVIADO) => dosDeTres(actual, l) && (anterior === null || dosDeTres(anterior, l))
  const abreviado = cumple(LIMITES_ABREVIADO)
  const pygAbreviada = cumple(LIMITES_PYG_ABREVIADA)
  const modelo: Modelo = abreviado ? 'pymes' : 'normal'
  const permitidos: Modelo[] = abreviado ? ['pymes', 'abreviado', 'normal'] : ['normal']
  const cifras = `activo ${fmt(actual.activo)}, cifra de negocios ${fmt(actual.cifraNegocios)}, plantilla media ${actual.plantillaMedia}`
  const frase = abreviado
    ? `Te corresponde el modelo de pymes (o el abreviado): ${cifras}, dentro de dos de los tres límites (4 M de activo, 8 M de cifra de negocios, 50 personas) ${anterior ? 'también el ejercicio anterior' : 'en tu primer ejercicio'} (LSC art. 257.1; RD 1515/2007 art. 2.1). Puedes elegir el normal, que es más completo.`
    : `Te corresponde el modelo normal: ${cifras} superan dos de los tres límites del abreviado (LSC art. 257.1)${anterior ? ' en alguno de los dos últimos ejercicios' : ''}.${pygAbreviada ? ' La cuenta de pérdidas y ganancias sí puede ser abreviada (LSC art. 258.1).' : ''}`
  return { modelo, pygAbreviada, frase, permitidos }
}

/** La empresa puede elegir un modelo más completo, nunca uno que no le corresponda. */
export function puedeElegir(propuesto: { permitidos: Modelo[] }, elegido: Modelo): boolean {
  return propuesto.permitidos.includes(elegido)
}

// ── Regla 8: la columna del año anterior ────────────────────────────────────

export type EjercicioAnterior = { estado: 'cerrado' | 'traido' | 'abierto' } | null
export function columnaAnterior(anterior: EjercicioAnterior): { sale: boolean; texto: string | null } {
  if (!anterior) return { sale: false, texto: 'sin ejercicio anterior' }
  return { sale: true, texto: anterior.estado === 'traido' ? 'traído' : anterior.estado === 'abierto' ? 'sin cerrar' : null }
}

// ── Regla 10: ¿por local o por marca? ───────────────────────────────────────

export function vistasDeResultado(locales: number, marcas: number): { porLocal: boolean; porMarca: boolean } {
  return { porLocal: locales > 1, porMarca: marcas > 0 }
}

function fmt(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}
