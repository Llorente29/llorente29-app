// src/modules/conta/lib/cierre.ts
//
// C05 · regla 7. Cierre del ejercicio: Folvy PREPARA tres asientos y la
// persona los valida como cualquier otro.
//
//   1. Regularización (PGC, quinta parte, grupo 129): cada cuenta de los
//      grupos 6 y 7 con saldo se salda contra la 129. Debe = Haber.
//   2. Cierre: cada cuenta de los grupos 1 a 5 con saldo (ya con la 129) se
//      salda. Después del cierre, todo el balance queda a cero.
//   3. Apertura del ejercicio siguiente: el cierre al revés, el primer día.
//
// Los tres van a la serie General (4). Lo traído de otro programa ya cerrado
// no se recalcula (la base lo impide: conta_cierre_enlazar). Reabrir anula
// apertura y cierre con su motivo (conta_cierre_reabrir).

export interface SaldoACerrar {
  code: string
  name: string
  templateCode: string | null
  debe: number
  haber: number
  locationId?: string | null
  brandId?: string | null
}

export interface ApunteCierre {
  cuenta: string
  debe: number
  haber: number
  concepto: string
  localId: string | null
  marcaId: string | null
  comun: boolean
}

export interface AsientoCierre {
  tipo: 'regularizacion' | 'cierre' | 'apertura'
  fecha: string
  concepto: string
  sourceType: 'closing' | 'opening'
  serie: 4
  apuntes: ApunteCierre[]
}

const c = (n: number) => Math.round(n * 100)
const plantilla = (s: SaldoACerrar) => s.templateCode ?? s.code

/** El apunte que deja una cuenta a cero. */
function saldar(s: SaldoACerrar, concepto: string): ApunteCierre | null {
  const saldo = c(s.debe) - c(s.haber)
  if (saldo === 0) return null
  return {
    cuenta: s.code, debe: saldo < 0 ? -saldo / 100 : 0, haber: saldo > 0 ? saldo / 100 : 0, concepto,
    localId: s.locationId ?? null, marcaId: s.brandId ?? null, comun: !s.locationId,
  }
}

/** Debe y Haber de un asiento, en céntimos. */
export function sumas(a: Pick<AsientoCierre, 'apuntes'>): { debe: number; haber: number; cuadra: boolean } {
  const d = a.apuntes.reduce((x, p) => x + c(p.debe), 0)
  const h = a.apuntes.reduce((x, p) => x + c(p.haber), 0)
  return { debe: d / 100, haber: h / 100, cuadra: d === h }
}

/**
 * Regularización: 6 y 7 contra la 129. El resultado (Haber − Debe de 6 y 7)
 * es lo que va a la 129: beneficio al Haber, pérdida al Debe.
 */
export function regularizacion(saldos: SaldoACerrar[], cuenta129: string, fecha: string, ejercicio: string): AsientoCierre | null {
  const apuntes = saldos.filter((s) => /^[67]/.test(plantilla(s))).map((s) => saldar(s, `Regularización ${ejercicio}`)).filter((x): x is ApunteCierre => !!x)
  if (!apuntes.length) return null
  const resultado = apuntes.reduce((x, p) => x + c(p.debe) - c(p.haber), 0)
  // Lo que se lleva al Debe de las cuentas de ingreso es resultado positivo.
  apuntes.push({ cuenta: cuenta129, debe: resultado < 0 ? -resultado / 100 : 0, haber: resultado > 0 ? resultado / 100 : 0, concepto: `Resultado del ejercicio ${ejercicio}`, localId: null, marcaId: null, comun: true })
  return { tipo: 'regularizacion', fecha, concepto: `Regularización del ejercicio ${ejercicio}: gastos e ingresos a resultados`, sourceType: 'closing', serie: 4, apuntes: apuntes.filter((p) => c(p.debe) + c(p.haber) > 0) }
}

/** Los saldos después de un asiento (para encadenar regularización → cierre). */
export function aplicar(saldos: SaldoACerrar[], a: AsientoCierre | null): SaldoACerrar[] {
  if (!a) return saldos
  const m = new Map(saldos.map((s) => [s.code, { ...s }]))
  for (const p of a.apuntes) {
    const s = m.get(p.cuenta) ?? { code: p.cuenta, name: p.cuenta, templateCode: p.cuenta.slice(0, 3), debe: 0, haber: 0 }
    s.debe = (c(s.debe) + c(p.debe)) / 100
    s.haber = (c(s.haber) + c(p.haber)) / 100
    m.set(p.cuenta, s)
  }
  return [...m.values()]
}

/** Cierre: cada cuenta de balance (1–5) con saldo, a cero. Antes, la regularización. */
export function cierre(saldosTrasRegularizar: SaldoACerrar[], fecha: string, ejercicio: string): AsientoCierre | null {
  const quedan6y7 = saldosTrasRegularizar.filter((s) => /^[67]/.test(plantilla(s)) && c(s.debe) !== c(s.haber))
  if (quedan6y7.length) throw new Error(`Antes del cierre hay que regularizar: quedan ${quedan6y7.length} cuentas de gastos o ingresos con saldo (${quedan6y7.slice(0, 3).map((s) => s.code).join(', ')}…).`)
  const apuntes = saldosTrasRegularizar.filter((s) => /^[1-5]/.test(plantilla(s))).map((s) => saldar(s, `Cierre ${ejercicio}`)).filter((x): x is ApunteCierre => !!x)
  if (!apuntes.length) return null
  return { tipo: 'cierre', fecha, concepto: `Cierre del ejercicio ${ejercicio}`, sourceType: 'closing', serie: 4, apuntes }
}

/** Apertura: el cierre al revés, el primer día del ejercicio siguiente. */
export function apertura(asientoCierre: AsientoCierre, fecha: string, ejercicioSiguiente: string): AsientoCierre {
  return {
    tipo: 'apertura', fecha, concepto: `Apertura del ejercicio ${ejercicioSiguiente}`, sourceType: 'opening', serie: 4,
    apuntes: asientoCierre.apuntes.map((p) => ({ ...p, debe: p.haber, haber: p.debe, concepto: `Apertura ${ejercicioSiguiente}` })),
  }
}

/** Los tres, en orden, comprobados: cada uno cuadra y el balance queda a cero. */
export function prepararCierre(saldos: SaldoACerrar[], o: { cuenta129: string; finEjercicio: string; inicioSiguiente: string; ejercicio: string; siguiente: string }): {
  regularizacion: AsientoCierre | null; cierre: AsientoCierre | null; apertura: AsientoCierre | null; resultado: number
} {
  const reg = regularizacion(saldos, o.cuenta129, o.finEjercicio, o.ejercicio)
  const tras = aplicar(saldos, reg)
  const cie = cierre(tras, o.finEjercicio, o.ejercicio)
  const ape = cie ? apertura(cie, o.inicioSiguiente, o.siguiente) : null
  for (const a of [reg, cie, ape]) if (a && !sumas(a).cuadra) throw new Error(`El asiento de ${a.tipo} no cuadra: Debe ${sumas(a).debe} y Haber ${sumas(a).haber}.`)
  const resultado = reg ? (() => { const p = reg.apuntes.find((x) => x.cuenta === o.cuenta129); return p ? p.haber - p.debe : 0 })() : 0
  return { regularizacion: reg, cierre: cie, apertura: ape, resultado }
}
