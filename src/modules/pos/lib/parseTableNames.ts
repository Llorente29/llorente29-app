// src/modules/pos/lib/parseTableNames.ts
//
// TPV · Sala (S1), oficina. Lo que un administrativo escribe para crear mesas
// de golpe: «1-6», «1, 2, 3», «T1-T4», «Barra 1, Barra 2» o una mezcla.
// Devuelve los nombres en orden, sin repetidos, o un error que se pueda leer.

const MAX_TABLES = 200

export function parseTableNames(input: string): { names: string[]; error: string | null } {
  const parts = input.split(/[,;\n]+/).map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return { names: [], error: 'Escribe qué mesas añadir: «1-6» o «1, 2, 3».' }
  const out: string[] = []
  for (const part of parts) {
    // Un rango: mismo prefijo a los dos lados («T1-T4») o sin prefijo («1-6»).
    const m = part.match(/^(.*?)(\d+)\s*-\s*(.*?)(\d+)$/)
    if (m && m[1].trim() === m[3].trim()) {
      const prefix = m[1]
      const from = parseInt(m[2], 10)
      const to = parseInt(m[4], 10)
      if (to < from) return { names: [], error: `El rango «${part}» va al revés.` }
      if (to - from + 1 > MAX_TABLES) return { names: [], error: `«${part}» son demasiadas mesas de una vez (máximo ${MAX_TABLES}).` }
      for (let n = from; n <= to; n++) out.push(`${prefix}${n}`)
    } else {
      out.push(part)
    }
  }
  const seen = new Set<string>()
  const names = out.filter(n => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  if (names.length > MAX_TABLES) return { names: [], error: `Son demasiadas mesas de una vez (máximo ${MAX_TABLES}).` }
  return { names, error: null }
}
