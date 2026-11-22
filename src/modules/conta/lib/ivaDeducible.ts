// src/modules/conta/lib/ivaDeducible.ts
//
// K11a · El % de IVA deducible de una recibida («Otros datos» de ERP10; el coche al 50 %). Puro, en céntimos.
//   · De la cuota y la base de cada tipo, la parte deducible va a la 472 (al libro de recibidas, deducible) y la
//     no deducible a la cuenta de gasto de sus líneas (al libro como no deducible: no entra en el 303, D07).
//   · Lo no deducible se reparte entre las cuentas de gasto de ese tipo según su base; lo que sobra de redondear,
//     a la última.
//   · Sin % (null) o 100: todo deducible, como siempre.

/** La parte deducible y la no deducible de una cuota y su base, en céntimos. */
export function partirIvaDeducible(cuotaCent: number, baseCent: number, pct: number | null | undefined):
  { cuota: number; base: number; cuotaNo: number; baseNo: number } {
  const p = pct === null || pct === undefined ? 100 : Math.min(100, Math.max(0, pct))
  if (p >= 100) return { cuota: cuotaCent, base: baseCent, cuotaNo: 0, baseNo: 0 }
  const cuota = Math.round((cuotaCent * p) / 100)
  const base = Math.round((baseCent * p) / 100)
  return { cuota, base, cuotaNo: cuotaCent - cuota, baseNo: baseCent - base }
}

/** Un importe en céntimos repartido según unos pesos (la base de cada cuenta); lo que sobra de redondear, a la última. */
export function repartirPorPeso<K>(totalCent: number, pesos: readonly (readonly [K, number])[]): [K, number][] {
  const suma = pesos.reduce((t, [, w]) => t + w, 0)
  if (pesos.length === 0) return []
  if (suma === 0) return pesos.map(([k], i) => [k, i === pesos.length - 1 ? totalCent : 0])
  let puesto = 0
  return pesos.map(([k, w], i) => {
    const x = i === pesos.length - 1 ? totalCent - puesto : Math.round((totalCent * w) / suma)
    puesto += x
    return [k, x]
  })
}
