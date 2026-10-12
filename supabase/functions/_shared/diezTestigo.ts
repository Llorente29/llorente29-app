// supabase/functions/_shared/diezTestigo.ts
//
// C04b · T3 · El testigo de la regla 1: las sumas y saldos de Diez (Excel
// exportado por Julio) contra lo que Folvy calcula con los mismos criterios.
// Núcleo puro: sin red y sin base.
//
// La forma del Excel, medida el 12/10 con los cuatro de la C0008 (T2 §10):
//   · una fila por SUBCUENTA (8 dígitos), sin filas de grupo ni subtotales;
//   · columnas Subcuenta · nombre · (vacía) · Debe · Haber · Deudor · Acreedor,
//     bajo una cabecera «Datos acumulados»;
//   · la APERTURA va sumada dentro de Debe y Haber (no hay columna aparte);
//   · sin regularización ni cierre; salen también las subcuentas con debe =
//     haber (saldo en blanco), e incluso alguna con todo en blanco;
//   · Diez admite importes NEGATIVOS (un haber de −1.024,79 con saldo deudor);
//   · una fila final «TOTALES:» con Debe = Haber y Deudor = Acreedor.
//
// Cómo se compara (respuesta de Julio, 12/10): el SALDO de cada subcuenta,
// al céntimo y sin excepción. Debe y haber también al céntimo, salvo donde
// Folvy haya pasado un negativo al otro lado (convertirAsiento, «negativos»):
// ahí las dos sumas crecen lo mismo, y esa diferencia tiene que ser
// exactamente lo movido. Lo demás es una diferencia y se dice.

export type CuentaTestigo = { debe: number; haber: number; saldo: number } // céntimos; saldo = debe − haber
export type Testigo = { cuentas: Map<string, CuentaTestigo>; totales: { debe: number; haber: number; deudor: number; acreedor: number } | null; problemas: string[] }

/** Un importe del Excel en céntimos: número, «3,000.00», «-1,024.79», «3.000,00» o vacío. */
export function centimosDe(v: unknown): number | null {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null
  const s = String(v).trim().replace(/\s/g, '')
  if (s === '') return 0
  let n: number
  if (/^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(s) || /^-?\d+(\.\d{1,2})?$/.test(s)) n = Number(s.replace(/,/g, ''))
  else if (/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'))
  else return null
  return Math.round(n * 100)
}

/**
 * Lee las filas de un Excel de sumas y saldos de Diez (como las da
 * sheet_to_json con header: 1). Busca la cabecera por sus nombres, no por la
 * posición. Cada fila se comprueba sola (deudor − acreedor = debe − haber) y
 * la fila TOTALES contra la suma de todas. Lo que no cuadra va a problemas.
 */
export function leerTestigo(filas: unknown[][]): Testigo {
  const problemas: string[] = []
  const norm = (x: unknown) => String(x ?? '').trim().toLowerCase()
  const iCab = filas.findIndex((f) => ['debe', 'haber', 'deudor', 'acreedor'].every((k) => f.some((c) => norm(c) === k)))
  if (iCab < 0) return { cuentas: new Map(), totales: null, problemas: ['no hay cabecera con Debe, Haber, Deudor y Acreedor'] }
  const cab = filas[iCab].map(norm)
  const col = { debe: cab.indexOf('debe'), haber: cab.indexOf('haber'), deudor: cab.indexOf('deudor'), acreedor: cab.indexOf('acreedor') }
  const cuentas = new Map<string, CuentaTestigo>()
  let totales: Testigo['totales'] = null
  for (const f of filas.slice(iCab + 1)) {
    const v = (i: number) => centimosDe(f[i])
    const [debe, haber, deudor, acreedor] = [v(col.debe), v(col.haber), v(col.deudor), v(col.acreedor)]
    const codigo = String(f[0] ?? '').trim()
    if (f.some((c) => /^totales:?$/i.test(String(c ?? '').trim()))) {
      if ([debe, haber, deudor, acreedor].some((x) => x == null)) problemas.push('fila TOTALES con un importe que no se entiende')
      else totales = { debe: debe!, haber: haber!, deudor: deudor!, acreedor: acreedor! }
      continue
    }
    if (!/^\d{3,12}$/.test(codigo)) continue
    if ([debe, haber, deudor, acreedor].some((x) => x == null)) { problemas.push(`${codigo}: un importe que no se entiende`); continue }
    if (cuentas.has(codigo)) problemas.push(`${codigo}: sale dos veces`)
    if (deudor! - acreedor! !== debe! - haber!) problemas.push(`${codigo}: el saldo no es debe − haber`)
    cuentas.set(codigo, { debe: debe!, haber: haber!, saldo: debe! - haber! })
  }
  if (!totales) problemas.push('no hay fila TOTALES')
  else {
    const s = [...cuentas.values()].reduce((a, c) => ({ debe: a.debe + c.debe, haber: a.haber + c.haber, deudor: a.deudor + Math.max(c.saldo, 0), acreedor: a.acreedor + Math.max(-c.saldo, 0) }), { debe: 0, haber: 0, deudor: 0, acreedor: 0 })
    if (s.debe !== totales.debe || s.haber !== totales.haber) problemas.push('las filas no suman el debe y el haber de TOTALES')
    if (s.deudor !== totales.deudor || s.acreedor !== totales.acreedor) problemas.push('las filas no suman los saldos de TOTALES')
    if (totales.debe !== totales.haber) problemas.push('TOTALES: el debe no es igual al haber')
  }
  return { cuentas, totales, problemas }
}

/** Lo que Folvy tiene por subcuenta, en céntimos. `negativos`: lo pasado al otro lado al convertir. */
export type CuentaFolvy = { debe: number; haber: number; negativos: number }

export type EstadoCuenta =
  | 'igual' // saldo, debe y haber al céntimo
  | 'igual_con_negativos' // saldo igual; debe y haber crecen exactamente lo movido
  | 'saldo_distinto'
  | 'sumas_distintas' // saldo igual, pero debe/haber difieren sin que lo explique lo movido
  | 'solo_testigo' // con importe en Diez y sin nada en Folvy
  | 'solo_folvy'

export type ComparacionCuenta = { cuenta: string; estado: EstadoCuenta; testigo: CuentaTestigo | null; folvy: CuentaFolvy | null }

export function compararTestigo(testigo: Map<string, CuentaTestigo>, folvy: Map<string, CuentaFolvy>) {
  const cuentas = [...new Set([...testigo.keys(), ...folvy.keys()])].sort()
  const filas: ComparacionCuenta[] = cuentas.map((cuenta) => {
    const t = testigo.get(cuenta) ?? null
    const f = folvy.get(cuenta) ?? null
    const vacioT = !t || (t.debe === 0 && t.haber === 0)
    const vacioF = !f || (f.debe === 0 && f.haber === 0)
    let estado: EstadoCuenta
    if (vacioT && vacioF) estado = 'igual'
    else if (vacioF) estado = 'solo_testigo'
    else if (vacioT) estado = 'solo_folvy'
    else if (f!.debe - f!.haber !== t!.saldo) estado = 'saldo_distinto'
    else if (f!.debe === t!.debe && f!.haber === t!.haber) estado = 'igual'
    else if (f!.debe - t!.debe === f!.negativos && f!.haber - t!.haber === f!.negativos) estado = 'igual_con_negativos'
    else estado = 'sumas_distintas'
    return { cuenta, estado, testigo: t, folvy: f }
  })
  const resumen = filas.reduce((r, x) => { r[x.estado] = (r[x.estado] ?? 0) + 1; return r }, {} as Partial<Record<EstadoCuenta, number>>)
  const cuadra = filas.every((x) => x.estado === 'igual' || x.estado === 'igual_con_negativos')
  return { filas, resumen, cuadra }
}
