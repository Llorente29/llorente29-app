// src/modules/conta/lib/recibidaGuardada.ts
//
// D03 · 0790 («Guardar cambios» de la ficha de la recibida): lo que la
// propuesta del asiento (facturasDeProveedor) hace con lo que la ficha guarda,
// sin red, para probarlo:
//   · el IVA por tipo de supplier_invoice_tax manda SIEMPRE que tenga filas
//     (antes, solo en las liquidaciones): lo que la persona corrigió en la
//     ficha es lo que vale, no la base de las líneas de producto por el tipo;
//   · el gasto repartido (supplier_invoice_expense) manda sobre la cuenta
//     propuesta y el local: cada fila es una línea de gasto con su local;
//   · el asiento tocado a mano (supplier_invoice.entry_overrides) sustituye, por
//     posición, la cuenta y los importes de la propuesta, y se dice.

import type { LineaAsiento, Propuesta } from './libro'
import { cent, deCent } from './libro'
import { eurosExactos } from './formato'

export interface ImpuestoGuardado { porcentaje: number; base: number; cuota: number }
export interface LineaDeFactura { base: number; tipo: { id: string; porcentaje: number } | null; cuentaGasto: string | null }

/**
 * Las líneas con las que se propone y la cuota de cada tipo. Con filas de
 * impuesto y sin cuentas propias en sus líneas, una línea por tipo (su base,
 * la de la fila); si las líneas llevan su cuenta (la comisión de una
 * liquidación), las líneas, con las cuotas de las filas.
 */
export function lineasYCuotas(lineas: readonly LineaDeFactura[], impuestos: readonly ImpuestoGuardado[], gasto: string | null,
  tipoDe: (pct: number) => { id: string; rate: number } | null, cuentasPropias: boolean):
  { lineas: LineaDeFactura[]; cuotas: ImpuestoGuardado[] | undefined } {
  if (impuestos.length === 0) return { lineas: [...lineas], cuotas: undefined }
  if (cuentasPropias) return { lineas: [...lineas], cuotas: [...impuestos] }
  return {
    lineas: impuestos.map((x) => { const t = tipoDe(x.porcentaje); return { base: x.base, tipo: t ? { id: t.id, porcentaje: t.rate } : null, cuentaGasto: gasto } }),
    cuotas: [...impuestos],
  }
}

export interface RepartoGuardado { cuenta: string; local: string | null; comun: boolean; importe: number }

const esGasto = (l: LineaAsiento) => l.debe > 0 && !l.iva && !l.retencion && /^6/.test(l.cuenta)

/** El gasto repartido de la ficha en lugar de las líneas de gasto propuestas. Si no suma lo mismo, no se toca y se avisa. */
export function aplicarReparto(p: Propuesta, reparto: readonly RepartoGuardado[]): Propuesta {
  if (reparto.length === 0) return p
  const propuestas = p.lineas.filter(esGasto)
  if (propuestas.length === 0) return p
  const antes = propuestas.reduce((t, l) => t + cent(l.debe), 0)
  const ahora = reparto.reduce((t, x) => t + cent(x.importe), 0)
  if (antes !== ahora) {
    return { ...p, confianza: 'duda', avisos: [...p.avisos, `El gasto repartido suma ${eurosExactos(deCent(ahora))} y la base es ${eurosExactos(deCent(antes))}: corrígelo en la ficha.`] }
  }
  const molde = propuestas[0]
  const nuevas: LineaAsiento[] = reparto.map((x) => ({ ...molde, cuenta: x.cuenta, debe: deCent(cent(x.importe)), haber: 0, localId: x.comun ? null : x.local, comun: x.comun || !x.local }))
  const i = p.lineas.indexOf(molde)
  const resto = p.lineas.filter((l) => !esGasto(l))
  const lineas = [...resto.slice(0, i), ...nuevas, ...resto.slice(i)]
  return { ...p, lineas, razones: [...p.razones, { decision: 'Gasto repartido', porque: `como se guardó en su ficha: ${reparto.map((x) => `${x.cuenta} ${eurosExactos(x.importe)}`).join(' · ')}` }] }
}

export interface LineaAManoGuardada { posicion?: number; cuenta: string; debe: number; haber: number; local?: string | null }

/** El asiento tocado a mano (entry_overrides): por posición, la cuenta y los importes guardados; lo demás (IVA, retención) se conserva. */
export function aplicarAsientoAMano(p: Propuesta, overrides: unknown): Propuesta {
  if (!Array.isArray(overrides) || overrides.length === 0) return p
  const xs = overrides as LineaAManoGuardada[]
  const d = xs.reduce((t, x) => t + cent(Number(x.debe) || 0), 0), h = xs.reduce((t, x) => t + cent(Number(x.haber) || 0), 0)
  if (d !== h || d === 0) return { ...p, confianza: 'duda', avisos: [...p.avisos, 'El asiento guardado a mano no cuadra: no se usa. Vuelve a tocarlo en la ficha.'] }
  const lineas = xs.map((x, k) => {
    const base = p.lineas[typeof x.posicion === 'number' ? x.posicion : k] ?? p.lineas[p.lineas.length - 1]
    return { ...base, cuenta: String(x.cuenta), debe: Number(x.debe) || 0, haber: Number(x.haber) || 0, ...(x.local !== undefined ? { localId: x.local ?? null, comun: !x.local } : {}) }
  })
  return { ...p, lineas, razones: [...p.razones, { decision: 'A mano', porque: 'el asiento se tocó a mano en su ficha: van sus cuentas e importes' }] }
}

/**
 * S01b · La cuenta de gasto que dice la ficha de la factura (su reparto guardado, 0790), para el
 * proveedor que no tiene tipo de gasto ni historia: la del primer gasto, por su posición. Sin
 * reparto, null.
 */
export function cuentaDelReparto(filas: readonly { position?: unknown; account_code?: unknown }[]): string | null {
  const conCuenta = filas.filter((x) => typeof x.account_code === 'string' && x.account_code.trim() !== '')
  if (conCuenta.length === 0) return null
  const primera = [...conCuenta].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))[0]
  return String(primera.account_code).trim()
}
