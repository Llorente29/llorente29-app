// supabase/functions/_shared/lecturaCuadro.ts
//
// S01d · El modo «cuadro» de ocr-albaran: leer un cuadro de amortización o la
// resolución de un aplazamiento (Seguridad Social, Hacienda) en PDF, y
// comprobar que la suma del capital es lo aplazado (respuesta 1 de Julio,
// 30/10). Puro: sin red ni base, para probarlo con vitest.

export const PROMPT_CUADRO = `Este documento es un cuadro de amortización de un préstamo, o la resolución de un aplazamiento o fraccionamiento de deudas (Seguridad Social, Hacienda).
Devuelve SOLO un JSON, sin texto alrededor, con esta forma:
{
  "tipo": "prestamo" | "aplazamiento",
  "organismo": texto corto de quién concede (el banco, «Seguridad Social», «Hacienda»), o null,
  "importe_aplazado": número, el importe prestado o aplazado (sin recargos ni intereses), o null si no aparece,
  "filas": [ { "fecha": "AAAA-MM-DD", "cuota": número, "capital": número, "intereses": número } ]
}
Una fila por cada plazo, en orden. Los importes con punto decimal y sin separador de miles. Si un plazo no separa capital e intereses, pon todo en capital e intereses 0. No inventes filas que no estén en el documento.`

export interface FilaLeida { fecha: string; cuota: number; capital: number; intereses: number }
export interface CuadroLeido {
  tipo: 'prestamo' | 'aplazamiento'
  organismo: string | null
  importeAplazado: number | null
  filas: FilaLeida[]
  sumaCapital: number
  /** null si el documento no dice lo aplazado: entonces lo dice la persona. */
  cuadra: boolean | null
}

const num = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x.replace(',', '.')) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Lo que devuelve el modelo, comprobado: filas con fecha válida, y si el capital suma lo aplazado. */
export function comprobarCuadro(leido: unknown): CuadroLeido | { error: string } {
  const o = (leido ?? {}) as Record<string, unknown>
  const filasCrudas = Array.isArray(o.filas) ? o.filas as Record<string, unknown>[] : []
  const filas: FilaLeida[] = []
  for (const f of filasCrudas) {
    const fecha = typeof f.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) ? f.fecha : null
    const capital = num(f.capital), intereses = num(f.intereses) ?? 0
    if (!fecha || capital === null) continue
    filas.push({ fecha, capital, intereses, cuota: num(f.cuota) ?? Math.round((capital + intereses) * 100) / 100 })
  }
  if (filas.length === 0) return { error: 'No he encontrado ninguna fila del cuadro (fecha, cuota, capital e intereses) en el documento.' }
  filas.sort((a, b) => a.fecha.localeCompare(b.fecha))
  const sumaCapital = Math.round(filas.reduce((t, f) => t + f.capital * 100, 0)) / 100
  const importeAplazado = num(o.importe_aplazado)
  return {
    tipo: o.tipo === 'aplazamiento' ? 'aplazamiento' : 'prestamo',
    organismo: typeof o.organismo === 'string' && o.organismo.trim() ? o.organismo.trim() : null,
    importeAplazado, filas, sumaCapital,
    cuadra: importeAplazado === null ? null : Math.round(sumaCapital * 100) === Math.round(importeAplazado * 100),
  }
}
