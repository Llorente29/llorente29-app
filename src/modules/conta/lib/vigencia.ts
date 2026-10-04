// src/modules/conta/lib/vigencia.ts
//
// Regla 1 del núcleo del C00 (§5): qué fila aplica en una fecha. Vale para
// impuestos y retenciones: un cambio de porcentaje es una fila nueva con su
// fecha, nunca una edición, así que en una fecha concreta aplica la fila cuyo
// intervalo [desde, hasta] la contiene. Fechas como texto ISO (AAAA-MM-DD).

export interface FilaConVigencia {
  code: string
  validFrom: string
  validTo: string | null
}

const dentro = (f: FilaConVigencia, fecha: string) =>
  f.validFrom <= fecha && (f.validTo === null || f.validTo >= fecha)

/**
 * La fila de `codigo` vigente en `fecha`, o null si no hay ninguna. Si hubiera
 * dos (la base lo impide; esto es la segunda red), NO elige: lanza, porque
 * elegir una en silencio es dar un porcentaje que nadie ha decidido.
 */
export function vigenteEn<T extends FilaConVigencia>(filas: T[], codigo: string, fecha: string): T | null {
  const candidatas = filas.filter((f) => f.code === codigo && dentro(f, fecha))
  if (candidatas.length > 1) {
    throw new Error(`Hay ${candidatas.length} filas de «${codigo}» vigentes el ${fecha}: tienen que cerrarse unas a otras.`)
  }
  return candidatas[0] ?? null
}

/** Los pares de filas del mismo concepto cuyas vigencias se pisan. */
export function solapes<T extends FilaConVigencia>(filas: T[]): [T, T][] {
  const out: [T, T][] = []
  for (let i = 0; i < filas.length; i++) {
    for (let j = i + 1; j < filas.length; j++) {
      const a = filas[i]; const b = filas[j]
      if (a.code !== b.code) continue
      const finA = a.validTo ?? '9999-12-31'; const finB = b.validTo ?? '9999-12-31'
      if (a.validFrom <= finB && b.validFrom <= finA) out.push([a, b])
    }
  }
  return out
}

/** Las filas que valen HOY (o en la fecha dada): una por concepto. */
export function vigentesEn<T extends FilaConVigencia>(filas: T[], fecha: string): T[] {
  const codigos = [...new Set(filas.map((f) => f.code))]
  return codigos.map((c) => vigenteEn(filas, c, fecha)).filter((f): f is T => f !== null)
}
