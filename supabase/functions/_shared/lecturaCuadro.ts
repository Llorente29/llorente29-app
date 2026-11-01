// supabase/functions/_shared/lecturaCuadro.ts
//
// S01d · El modo «cuadro» de ocr-albaran: leer un cuadro de amortización o la
// resolución de un aplazamiento (Seguridad Social, Hacienda) en PDF, y
// comprobarlo (respuesta 1 de Julio, 30/10). Puro: sin red ni base, para
// probarlo con vitest.
//
// S01d-b (respuesta 3): la resolución de la TGSS trae solo las cuotas del año
// en curso (las de cada año siguiente llegan cuando se fija su interés), y su
// «Deuda Amortizada» es ACUMULADA. Así que:
//   · el número total de cuotas sale del texto («en el plazo de 36 cuotas»);
//   · si la columna de capital crece fila a fila y la última cuadra con lo
//     aplazado menos lo pendiente, es acumulada: el capital de cada cuota es
//     la diferencia con la anterior, y sus intereses, la cuota menos el
//     capital;
//   · con un cuadro parcial la comprobación es «lo aplazado menos el capital
//     de las filas leídas da la deuda pendiente del cuadro»;
//   · una fila de «Formalización» nunca es una cuota.

export const PROMPT_CUADRO = `Este documento es un cuadro de amortización de un préstamo, o la resolución de un aplazamiento o fraccionamiento de deudas (Seguridad Social, Hacienda).
Devuelve SOLO un JSON, sin texto alrededor, con esta forma:
{
  "tipo": "prestamo" | "aplazamiento",
  "organismo": texto corto de quién concede (el banco, «Seguridad Social», «Hacienda»), o null,
  "importe_aplazado": número, el importe prestado o aplazado (sin recargos ni intereses), o null si no aparece,
  "cuotas_totales": número total de cuotas o plazos que dice el TEXTO (p. ej. «en el plazo de 36 cuotas»), aunque el cuadro traiga menos filas, o null si no lo dice,
  "deuda_pendiente": número, la deuda que queda pendiente al final del cuadro si el documento la da (p. ej. «Deuda pendiente al final del ejercicio»), o null,
  "filas": [ { "fecha": "AAAA-MM-DD", "concepto": texto de la fila si lo tiene o null, "cuota": número, "capital": número, "intereses": número o null } ]
}
Una fila por cada plazo del cuadro, en orden. Copia los números de cada columna TAL CUAL aparecen, sin recalcular: si la columna de capital o de deuda amortizada es acumulada, pon el acumulado. Si el cuadro no tiene columna de intereses, pon null. Si el día del vencimiento no aparece, usa el último día del mes. Los importes con punto decimal y sin separador de miles. No inventes filas que no estén en el documento.`

export interface FilaLeida { fecha: string; cuota: number; capital: number; intereses: number }
export interface CuadroLeido {
  tipo: 'prestamo' | 'aplazamiento'
  organismo: string | null
  importeAplazado: number | null
  filas: FilaLeida[]
  sumaCapital: number
  /** Las cuotas de todo el contrato (las del texto si son más que las filas). */
  cuotasTotales: number
  /** La deuda pendiente al final del cuadro, si el documento la da. */
  deudaPendiente: number | null
  /** El cuadro trae menos filas que cuotas: las que faltan llegan con el cuadro de otro año. */
  parcial: boolean
  /** La columna de capital venía acumulada y se ha pasado a capital por cuota. */
  acumulada: boolean
  /** null si no se puede comprobar (el documento no dice lo aplazado, o, si es parcial, lo pendiente): entonces lo dice la persona. */
  cuadra: boolean | null
}

const num = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x.replace(',', '.')) : NaN
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}
const cent = (x: number) => Math.round(x * 100)

/**
 * Si la columna de capital es acumulada: crece fila a fila y la última es lo
 * aplazado menos lo pendiente (o, sin pendiente, lo aplazado en un cuadro
 * completo). Así lo distingue de un capital por cuota que va subiendo.
 */
export function esAcumulada(capitales: readonly number[], aplazado: number | null, pendiente: number | null): boolean {
  if (capitales.length < 2 || aplazado === null) return false
  for (let i = 1; i < capitales.length; i++) if (cent(capitales[i]) <= cent(capitales[i - 1])) return false
  const ultima = cent(capitales[capitales.length - 1])
  if (pendiente !== null) return ultima === cent(aplazado) - cent(pendiente)
  return ultima === cent(aplazado) && capitales.reduce((t, c) => t + cent(c), 0) !== cent(aplazado)
}

/** Lo que devuelve el modelo, comprobado. */
export function comprobarCuadro(leido: unknown): CuadroLeido | { error: string } {
  const o = (leido ?? {}) as Record<string, unknown>
  const filasCrudas = Array.isArray(o.filas) ? o.filas as Record<string, unknown>[] : []
  const crudas: { fecha: string; cuota: number | null; capital: number; intereses: number | null }[] = []
  for (const f of filasCrudas) {
    const fecha = typeof f.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha) ? f.fecha : null
    const capital = num(f.capital)
    if (!fecha || capital === null) continue
    // Una formalización (la firma del préstamo) nunca es una cuota.
    if (typeof f.concepto === 'string' && /formaliz/i.test(f.concepto)) continue
    crudas.push({ fecha, capital, cuota: num(f.cuota), intereses: num(f.intereses) })
  }
  if (crudas.length === 0) return { error: 'No he encontrado ninguna fila del cuadro (fecha, cuota, capital e intereses) en el documento.' }
  crudas.sort((a, b) => a.fecha.localeCompare(b.fecha))
  const importeAplazado = num(o.importe_aplazado)
  const deudaPendiente = num(o.deuda_pendiente)
  const acumulada = esAcumulada(crudas.map((f) => f.capital), importeAplazado, deudaPendiente)
  const filas: FilaLeida[] = crudas.map((f, i) => {
    const capital = acumulada ? Math.round((f.capital - (i === 0 ? 0 : crudas[i - 1].capital)) * 100) / 100 : f.capital
    // Con la amortizada acumulada, los intereses que trae la fila no son los de la cuota: la cuota menos el capital.
    const intereses = f.cuota !== null && (acumulada || f.intereses === null) ? Math.round((f.cuota - capital) * 100) / 100 : (f.intereses ?? 0)
    return { fecha: f.fecha, capital, intereses, cuota: f.cuota ?? Math.round((capital + intereses) * 100) / 100 }
  })
  const sumaCapital = Math.round(filas.reduce((t, f) => t + cent(f.capital), 0)) / 100
  const delTexto = typeof o.cuotas_totales === 'number' && Number.isInteger(o.cuotas_totales) && o.cuotas_totales > 0 ? o.cuotas_totales : null
  const cuotasTotales = Math.max(delTexto ?? 0, filas.length)
  const parcial = cuotasTotales > filas.length
  const cuadra = importeAplazado === null ? null
    : parcial ? (deudaPendiente === null ? null : cent(importeAplazado) - cent(sumaCapital) === cent(deudaPendiente))
    : cent(sumaCapital) === cent(importeAplazado)
  return {
    tipo: o.tipo === 'aplazamiento' ? 'aplazamiento' : 'prestamo',
    organismo: typeof o.organismo === 'string' && o.organismo.trim() ? o.organismo.trim() : null,
    importeAplazado, filas, sumaCapital, cuotasTotales, deudaPendiente, parcial, acumulada, cuadra,
  }
}
