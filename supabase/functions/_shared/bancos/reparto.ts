// src/modules/conta/lib/reparto.ts
//
// S01d · Repartir un movimiento del banco entre varias cuentas (tableros 1 y
// 2): la cuota del préstamo en capital e intereses, la liquidación de una
// póliza. Lo que no es pantalla: las líneas, lo que falta por repartir, si se
// puede casar, y cómo se guarda y se vuelve a proponer desde una regla de
// Bancos («Recordar este reparto»). En céntimos, para no perder ninguno.

/** Una línea del reparto, como la escribe la persona (el importe en texto, «1.303,46»). */
export interface LineaReparto { cuenta: string; importe: string; concepto: string; modelo?: string; periodo?: string }

/** Una línea de una regla con reparto: importe fijo, o null = «lo que falte». */
export interface LineaRegla { cuenta: string; importeCent: number | null; concepto: string | null; modelo?: string | null; periodo?: string | null }

/** «1.303,46», «1303,46», «1303.46» o «1.303» → céntimos; null si no es un importe. */
export function leerImporte(t: string): number | null {
  const s = t.trim().replace(/\s|€/g, '')
  if (!s) return null
  const n = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s.replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(n)) return null
  return Math.round(Number(n) * 100)
}

/** «1.303,46» (sin el símbolo: va en el campo). */
export function textoImporte(cent: number): string {
  const abs = Math.abs(cent)
  const ent = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${cent < 0 ? '-' : ''}${ent},${String(abs % 100).padStart(2, '0')}`
}

/** Lo repartido y lo que falta (el movimiento en positivo). */
export function cuentas(movimientoCent: number, lineas: readonly LineaReparto[]): { repartidoCent: number; faltaCent: number } {
  const repartidoCent = lineas.reduce((t, l) => t + (leerImporte(l.importe) ?? 0), 0)
  return { repartidoCent, faltaCent: Math.abs(movimientoCent) - repartidoCent }
}

/**
 * Por qué no se puede casar aún, en una frase; null si se puede. No valida
 * hasta que cuadra (encargo): cada línea con su cuenta del plan y su importe,
 * y lo repartido igual al movimiento.
 */
export function porQueNoSeCasa(movimientoCent: number, lineas: readonly LineaReparto[], existe: (cuenta: string) => boolean): string | null {
  if (lineas.length === 0) return 'Elige a qué va.'
  for (const [i, l] of lineas.entries()) {
    const n = lineas.length > 1 ? `La línea ${i + 1}` : 'La línea'
    if (!l.cuenta.trim()) return `${n} no tiene cuenta.`
    if (!existe(l.cuenta.trim())) return `${n}: la cuenta ${l.cuenta.trim()} no está en el plan.`
    const c = leerImporte(l.importe)
    if (c === null || c <= 0) return `${n}: el importe tiene que ser mayor que cero.`
    if (l.cuenta.startsWith('4751') && (!l.modelo || !l.periodo)) return `${n} va a la 4751: di el modelo y el periodo que paga.`
  }
  const { faltaCent } = cuentas(movimientoCent, lineas)
  if (faltaCent > 0) return `Falta por repartir ${textoImporte(faltaCent)} €.`
  if (faltaCent < 0) return `Has repartido ${textoImporte(-faltaCent)} € de más.`
  return null
}

/** «+ Repartir en otra cuenta»: una línea nueva con lo que falte (o vacía). */
export function lineaNueva(movimientoCent: number, lineas: readonly LineaReparto[]): LineaReparto {
  const { faltaCent } = cuentas(movimientoCent, lineas)
  return { cuenta: '', importe: faltaCent > 0 ? textoImporte(faltaCent) : '', concepto: '' }
}

/**
 * Las líneas de una regla con reparto para un movimiento: si las fijas suman
 * el movimiento (o hay una «lo que falte» que lo completa), repartido; si no,
 * las mismas cuentas sin cuadrar, para aclarar (respuesta 1 de Julio, 30/10).
 */
export function aplicarRegla(movimientoCent: number, lineas: readonly LineaRegla[]): { cuadra: boolean; lineas: { cuenta: string; importeCent: number | null; concepto: string | null; modelo?: string | null; periodo?: string | null }[] } {
  const total = Math.abs(movimientoCent)
  const fijas = lineas.filter((l) => l.importeCent !== null).reduce((t, l) => t + l.importeCent!, 0)
  const resto = lineas.filter((l) => l.importeCent === null)
  if (resto.length === 1 && total - fijas > 0) {
    return { cuadra: true, lineas: lineas.map((l) => (l.importeCent === null ? { ...l, importeCent: total - fijas } : l)) }
  }
  if (resto.length === 0 && fijas === total) return { cuadra: true, lineas: [...lineas] }
  return { cuadra: false, lineas: lineas.map((l) => ({ ...l, importeCent: l.importeCent })) }
}

/** Lo que guarda «Recordar este reparto»: cada línea con su importe fijo. */
export function lineasParaRegla(lineas: readonly LineaReparto[]): LineaRegla[] {
  return lineas.map((l) => ({ cuenta: l.cuenta.trim(), importeCent: leerImporte(l.importe), concepto: l.concepto.trim() || null,
    ...(l.modelo ? { modelo: l.modelo } : {}), ...(l.periodo ? { periodo: l.periodo } : {}) }))
}
