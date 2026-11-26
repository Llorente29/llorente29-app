// supabase/functions/conta-cegid-ver/ver.ts
//
// Q10 · respuesta 5 (26/11) · Lo que se puede enseñar de lo leído de Cegid, puro. El resumen del workflow es público
// (el repositorio lo es): de la incidencia, todos sus campos (no lleva ni nombre ni NIF del cliente); de la ficha, solo
// los NOMBRES de sus campos y, de cada concepto fijo, sus números, fechas y códigos cortos: nunca el nombre, el NIF, el
// correo ni un texto largo.

export type Fila = Record<string, unknown>
export interface Par { cliente: number; incidencia: number }

/** Los pares «9/2 10/1» (cliente/incidencia), como mucho 5. Null si alguno no es de esa forma. */
export function leerPares(texto: unknown): Par[] | null {
  const xs = String(texto ?? '').trim().split(/[\s,;]+/).filter(Boolean)
  if (!xs.length || xs.length > 5) return null
  const r: Par[] = []
  for (const x of xs) {
    const m = /^(\d{1,7})\/(\d{1,7})$/.exec(x)
    if (!m) return null
    r.push({ cliente: Number(m[1]), incidencia: Number(m[2]) })
  }
  return r
}

/** Un valor de un concepto fijo que se puede enseñar: números, booleanos, nulos y textos de hasta 10 caracteres. */
export const ensenable = (v: unknown): boolean => v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 10)

/** La ficha, sin lo personal: los nombres de sus campos y sus conceptos fijos con lo enseñable. */
export function fichaSinPersonales(raw: unknown): { campos: string[]; conceptos: Fila[] } {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Fila
  const det = Array.isArray(f.detalleConceptos) ? (f.detalleConceptos as unknown[]) : []
  const conceptos = det.map((c) => {
    const o = (c && typeof c === 'object' ? c : {}) as Fila
    const r: Fila = {}
    for (const [k, v] of Object.entries(o)) r[k] = ensenable(v) ? v : `(texto de ${String(v).length} caracteres)`
    return r
  })
  return { campos: Object.keys(f).sort(), conceptos }
}
