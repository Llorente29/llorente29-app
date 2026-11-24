// src/modules/conta/nucleo/bancos/cadena.ts
//
// R08 · La cadena de extractos de un banco (encargo R08, 3.3), sin pantalla. Lo mismo que hace
// la base (bank_saldo_extracto y _bank_cargos_anulados, 1945 y 2120), para que la pantalla lo
// explique y para probarlo con los casos reales (tests/conta/r08-bancos):
//   · el saldo del banco es el cierre del ÚLTIMO extracto: la fecha final y, a igual fecha, el que
//     llegó el último (Revolut trajo cuatro el 19/11 y la pantalla cogía uno del medio);
//   · el hueco de un extracto se mide contra el cierre del ANTERIOR de la cadena más lo nuevo que
//     trae, no contra la apertura que guarda la lectura (el lector se la inventa: cierre − lo nuevo);
//   · un hueco positivo, sin su contrario en la misma cuenta, que suman de UNA sola forma de 1 a 4
//     cargos del mismo día: ésos son los que el banco no cobró.

export interface EslabonExtracto { id: string; hasta: string; subido: string; saldoInicialCent: number | null; saldoFinalCent: number | null }
export interface CargoDelExtracto { id: string; extractoId: string; fecha: string; importeCent: number; apartado?: boolean; esBueno?: boolean }

const enOrden = <T extends EslabonExtracto>(xs: readonly T[]): T[] =>
  [...xs].filter((e) => e.saldoFinalCent !== null).sort((a, b) => a.hasta.localeCompare(b.hasta) || a.subido.localeCompare(b.subido) || a.id.localeCompare(b.id))

/** El extracto que da el saldo del banco hasta una fecha: el último de la cadena. */
export function ultimoExtracto<T extends EslabonExtracto>(xs: readonly T[], hasta?: string): T | null {
  const lista = enOrden(xs).filter((e) => !hasta || e.hasta <= hasta)
  return lista[lista.length - 1] ?? null
}

export interface Eslabon<T extends EslabonExtracto> { extracto: T; anterior: T | null; nuevoCent: number; huecoCent: number | null }

/** Cada extracto con su anterior en la cadena, lo nuevo que trae y su hueco (cierre − (cierre anterior + lo nuevo)). */
export function cadena<T extends EslabonExtracto>(xs: readonly T[], movs: readonly Pick<CargoDelExtracto, 'extractoId' | 'importeCent'>[]): Eslabon<T>[] {
  const lista = enOrden(xs)
  return lista.map((e, i) => {
    const anterior = i > 0 ? lista[i - 1] : null
    const nuevoCent = movs.filter((m) => m.extractoId === e.id).reduce((t, m) => t + m.importeCent, 0)
    return { extracto: e, anterior, nuevoCent, huecoCent: anterior ? e.saldoFinalCent! - (anterior.saldoFinalCent! + nuevoCent) : null }
  })
}

/** Los cargos que el banco no cobró, por extracto: los que suman su hueco de una sola forma. */
export function cargosNoCobrados<T extends EslabonExtracto>(xs: readonly T[], movs: readonly CargoDelExtracto[]): { extracto: T; anterior: T; huecoCent: number; cargos: CargoDelExtracto[] }[] {
  const eslabones = cadena(xs, movs)
  const out: { extracto: T; anterior: T; huecoCent: number; cargos: CargoDelExtracto[] }[] = []
  for (const s of eslabones) {
    const g = s.huecoCent
    if (g === null || g <= 0 || !s.anterior) continue
    if (eslabones.some((o) => o !== s && o.huecoCent === -g)) continue
    const candidatos = movs.filter((m) => m.extractoId === s.extracto.id && m.importeCent < 0 && !m.apartado && !m.esBueno)
    const porDia = new Map<string, CargoDelExtracto[]>()
    for (const m of candidatos) porDia.set(m.fecha, [...(porDia.get(m.fecha) ?? []), m])
    const formas: CargoDelExtracto[][] = []
    for (const lista of porDia.values()) {
      const dia = [...lista].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 15)
      const buscar = (desde: number, elegidos: CargoDelExtracto[], total: number) => {
        if (total === g && elegidos.length) { formas.push(elegidos); return }
        if (elegidos.length === 4) return
        for (let i = desde; i < dia.length; i++) {
          const t = total - dia[i].importeCent
          if (t <= g) buscar(i + 1, [...elegidos, dia[i]], t)
        }
      }
      buscar(0, [], 0)
    }
    if (formas.length === 1) out.push({ extracto: s.extracto, anterior: s.anterior, huecoCent: g, cargos: formas[0] })
  }
  return out
}
