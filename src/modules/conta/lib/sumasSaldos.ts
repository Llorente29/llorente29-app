// src/modules/conta/lib/sumasSaldos.ts
//
// C05 · Sumas y saldos por niveles con las siete opciones de Diez (encargo
// §5): saldos a cero, periodo, acumulado, saldo inicial, apertura, PyG
// (regularización) y cierre; por rango de cuentas. Regla 5: cada nivel suma
// EXACTAMENTE a sus hijos (la lección del C02), y apertura y cierre entran o
// no según la opción.
//
// La entrada es lo que devuelve conta_saldos_cuentas: por cada cuenta de la
// empresa, Debe y Haber separados en inicial (antes del periodo, dentro del
// ejercicio), apertura, periodo, regularización y cierre.

export type Nivel = 'grupo' | 'subgrupo' | 'cuenta' | 'subcuenta'

export interface SaldoPartido {
  code: string
  name: string
  templateCode: string | null
  inicialDebe: number; inicialHaber: number
  aperturaDebe: number; aperturaHaber: number
  periodoDebe: number; periodoHaber: number
  regularizacionDebe: number; regularizacionHaber: number
  cierreDebe: number; cierreHaber: number
}

export interface OpcionesSumas {
  /** Enseñar también las cuentas con saldo 0. */
  saldosACero: boolean
  /** Solo lo del periodo (true) o acumulado desde el inicio del ejercicio (false). */
  soloPeriodo: boolean
  /** Columna de saldo inicial (lo anterior al periodo y la apertura). */
  saldoInicial: boolean
  /** Incluir el asiento de apertura. */
  apertura: boolean
  /** Incluir la regularización (6 y 7 → 129). */
  pyg: boolean
  /** Incluir el asiento de cierre. */
  cierre: boolean
  /** Rango de cuentas: desde / hasta (prefijos), vacíos = todas. */
  desdeCuenta?: string
  hastaCuenta?: string
}

export const OPCIONES_POR_DEFECTO: OpcionesSumas = {
  saldosACero: false, soloPeriodo: false, saldoInicial: true, apertura: true, pyg: false, cierre: false,
}

export interface FilaSumas {
  nivel: Nivel
  code: string
  name: string
  inicial: number
  debe: number
  haber: number
  saldo: number
  hijos: string[]
}

const c = (n: number) => Math.round(n * 100)
const r2 = (n: number) => c(n) / 100

/** La clave de una cuenta en cada nivel: grupo 1 cifra, subgrupo 2, cuenta 3, subcuenta la de la empresa. */
export function claveNivel(code: string, nivel: Nivel): string {
  if (nivel === 'grupo') return code.slice(0, 1)
  if (nivel === 'subgrupo') return code.slice(0, 2)
  if (nivel === 'cuenta') return code.slice(0, 3)
  return code
}

const enRango = (code: string, o: OpcionesSumas) =>
  (!o.desdeCuenta || code >= o.desdeCuenta) && (!o.hastaCuenta || code.slice(0, o.hastaCuenta.length) <= o.hastaCuenta)

/** Debe, Haber e inicial de una cuenta con las opciones. */
export function importesCuenta(s: SaldoPartido, o: OpcionesSumas): { inicial: number; debe: number; haber: number } {
  const ap = o.apertura ? [s.aperturaDebe, s.aperturaHaber] : [0, 0]
  // Con saldo inicial y solo el periodo, la apertura y lo anterior van al inicial.
  const inicial = o.saldoInicial && o.soloPeriodo ? r2(s.inicialDebe + ap[0] - s.inicialHaber - ap[1]) : 0
  let debe = s.periodoDebe
  let haber = s.periodoHaber
  if (!o.soloPeriodo) { debe += s.inicialDebe + ap[0]; haber += s.inicialHaber + ap[1] }
  if (o.pyg) { debe += s.regularizacionDebe; haber += s.regularizacionHaber }
  if (o.cierre) { debe += s.cierreDebe; haber += s.cierreHaber }
  return { inicial, debe: r2(debe), haber: r2(haber) }
}

/**
 * Las filas de un nivel, de mayor a menor, con sus hijos. Cada fila de un
 * nivel es la suma exacta de las del nivel de abajo (se suma en céntimos).
 */
export function sumasYSaldos(saldos: SaldoPartido[], niveles: Nivel[], o: OpcionesSumas): FilaSumas[] {
  const orden: Nivel[] = ['grupo', 'subgrupo', 'cuenta', 'subcuenta']
  const pedidos = orden.filter((n) => niveles.includes(n))
  const hojas = saldos.filter((s) => enRango(s.code, o)).map((s) => ({ s, ...importesCuenta(s, o) }))
  const filas = new Map<string, FilaSumas & { ci: number; cd: number; ch: number }>()
  for (const h of hojas) {
    for (const nivel of pedidos) {
      const k = claveNivel(nivel === 'subcuenta' ? h.s.code : (h.s.templateCode ?? h.s.code), nivel)
      const id = `${nivel}:${k}`
      const f = filas.get(id) ?? { nivel, code: k, name: nivel === 'subcuenta' ? h.s.name : '', inicial: 0, debe: 0, haber: 0, saldo: 0, hijos: [], ci: 0, cd: 0, ch: 0 }
      f.ci += c(h.inicial); f.cd += c(h.debe); f.ch += c(h.haber)
      filas.set(id, f)
    }
  }
  // Hijos: la fila del nivel siguiente pedido cuyo código empieza por el suyo.
  const lista = [...filas.values()].map((f) => ({ ...f, inicial: f.ci / 100, debe: f.cd / 100, haber: f.ch / 100, saldo: (f.ci + f.cd - f.ch) / 100 }))
  for (const f of lista) {
    const i = pedidos.indexOf(f.nivel)
    const sig = pedidos[i + 1]
    if (sig) f.hijos = lista.filter((x) => x.nivel === sig && x.code.startsWith(f.code)).map((x) => `${sig}:${x.code}`)
  }
  return lista
    .filter((f) => o.saldosACero || c(f.saldo) !== 0 || c(f.debe) !== 0 || c(f.haber) !== 0)
    .map((f) => ({ nivel: f.nivel, code: f.code, name: f.name, inicial: f.inicial, debe: f.debe, haber: f.haber, saldo: f.saldo, hijos: f.hijos }))
    .sort((a, b) => a.code.localeCompare(b.code) || pedidos.indexOf(a.nivel) - pedidos.indexOf(b.nivel))
}

/** Totales de un nivel: Debe = Haber siempre que el libro cuadre y entren todas las cuentas. */
export function totales(filas: FilaSumas[], nivel: Nivel): { inicial: number; debe: number; haber: number; saldo: number; cuadra: boolean } {
  const fs = filas.filter((f) => f.nivel === nivel)
  const s = (k: 'inicial' | 'debe' | 'haber' | 'saldo') => fs.reduce((a, f) => a + c(f[k]), 0) / 100
  const t = { inicial: s('inicial'), debe: s('debe'), haber: s('haber'), saldo: s('saldo') }
  return { ...t, cuadra: c(t.debe) === c(t.haber) && c(t.saldo) === c(t.inicial) }
}

/** Regla 5, comprobada: cada fila suma exactamente a sus hijos. Devuelve las que no. */
export function filasQueNoSuman(filas: FilaSumas[]): string[] {
  const por = new Map(filas.map((f) => [`${f.nivel}:${f.code}`, f]))
  const mal: string[] = []
  for (const f of filas) {
    if (!f.hijos.length) continue
    const hs = f.hijos.map((h) => por.get(h)).filter((x): x is FilaSumas => !!x)
    for (const k of ['debe', 'haber', 'inicial'] as const) {
      if (hs.reduce((a, h) => a + c(h[k]), 0) !== c(f[k])) mal.push(`${f.nivel} ${f.code} (${k})`)
    }
  }
  return mal
}
