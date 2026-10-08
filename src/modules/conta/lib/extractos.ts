// src/modules/conta/lib/extractos.ts
//
// C05 · Lo que hacen con los apuntes del Mayor el diario resumido y el libro
// mayor: agrupar por mes y cuenta, y el extracto de una cuenta con su saldo
// inicial y su arrastre. Puro, con pruebas en librosC05.test.ts.

export interface ApunteMayor {
  entryId: string; fecha: string; cuenta: string; nombreCuenta: string; debe: number; haber: number
  localId: string | null; marcaId: string | null; comun: boolean
}

const c = (n: number) => Math.round(n * 100)

export interface MesResumido { mes: string; filas: { cuenta: string; nombre: string; debe: number; haber: number }[]; debe: number; haber: number; asientos: number }

/** El diario resumido: por mes, una fila por cuenta (o por nivel: 2 subgrupo, 3 cuenta). */
export function resumir(ms: ApunteMayor[], nivel: number | null): MesResumido[] {
  const meses = new Map<string, { filas: Map<string, { cuenta: string; nombre: string; d: number; h: number }>; asientos: Set<string> }>()
  for (const m of ms) {
    const k = m.fecha.slice(0, 7)
    const mes = meses.get(k) ?? { filas: new Map(), asientos: new Set<string>() }
    const cuenta = nivel ? m.cuenta.slice(0, nivel) : m.cuenta
    const f = mes.filas.get(cuenta) ?? { cuenta, nombre: nivel ? cuenta : m.nombreCuenta, d: 0, h: 0 }
    f.d += c(m.debe); f.h += c(m.haber)
    mes.filas.set(cuenta, f); mes.asientos.add(m.entryId); meses.set(k, mes)
  }
  return [...meses.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, x]) => {
    const filas = [...x.filas.values()].sort((a, b) => a.cuenta.localeCompare(b.cuenta)).map((f) => ({ cuenta: f.cuenta, nombre: f.nombre, debe: f.d / 100, haber: f.h / 100 }))
    return { mes, filas, debe: filas.reduce((a, f) => a + c(f.debe), 0) / 100, haber: filas.reduce((a, f) => a + c(f.haber), 0) / 100, asientos: x.asientos.size }
  })
}

export interface FiltroMayor { desde: string; hasta: string; localId?: string | null; marcaId?: string | null; soloComun?: boolean }

export interface Extracto<T extends ApunteMayor> {
  inicial: number
  filas: (T & { saldo: number })[]
  debe: number
  haber: number
  final: number
}

/**
 * El extracto de una cuenta: el saldo inicial es lo de antes de `desde`
 * (apertura incluida); cada fila arrastra el saldo (Debe − Haber). Con filtro
 * de local o marca, el saldo inicial también se filtra: si no, el arrastre
 * mezclaría lo de todos los locales con las filas de uno.
 */
export function extracto<T extends ApunteMayor>(ms: T[], f: FiltroMayor): Extracto<T> {
  const pasa = (m: T) => (f.localId === undefined || m.localId === f.localId) && (f.marcaId === undefined || m.marcaId === f.marcaId) && (!f.soloComun || m.comun)
  const vale = ms.filter(pasa)
  const inicial = vale.filter((m) => m.fecha < f.desde).reduce((a, m) => a + c(m.debe) - c(m.haber), 0)
  let s = inicial
  const filas = vale.filter((m) => m.fecha >= f.desde && m.fecha <= f.hasta).map((m) => { s += c(m.debe) - c(m.haber); return { ...m, saldo: s / 100 } })
  return {
    inicial: inicial / 100, filas,
    debe: filas.reduce((a, m) => a + c(m.debe), 0) / 100, haber: filas.reduce((a, m) => a + c(m.haber), 0) / 100, final: s / 100,
  }
}
