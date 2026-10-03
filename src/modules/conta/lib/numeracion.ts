// src/modules/conta/lib/numeracion.ts
//
// Regla 5 del núcleo del C00 (§5): una serie de facturas no admite saltos ni
// repeticiones. Prepara Verifactu; en el C00 es solo la regla y sus pruebas:
// el contador llega con las facturas emitidas.

export interface ProblemaSerie { tipo: 'repetido' | 'salto' | 'antes_de_empezar'; numero: number; texto: string }

/**
 * Comprueba los números de una serie (en el orden en que se emitieron).
 * `empiezaEn` = primer número de la serie (por defecto 1).
 */
export function problemasDeSerie(numeros: number[], empiezaEn = 1): ProblemaSerie[] {
  const out: ProblemaSerie[] = []
  const vistos = new Set<number>()
  for (const n of numeros) {
    if (vistos.has(n)) out.push({ tipo: 'repetido', numero: n, texto: `El número ${n} está repetido.` })
    if (n < empiezaEn) out.push({ tipo: 'antes_de_empezar', numero: n, texto: `El número ${n} es anterior al primero de la serie (${empiezaEn}).` })
    vistos.add(n)
  }
  const orden = [...vistos].filter((n) => n >= empiezaEn).sort((a, b) => a - b)
  let esperado = empiezaEn
  for (const n of orden) {
    if (n > esperado) out.push({ tipo: 'salto', numero: esperado, texto: n - esperado === 1 ? `Falta el número ${esperado}.` : `Faltan del ${esperado} al ${n - 1}.` })
    esperado = n + 1
  }
  return out
}

/** El siguiente número de la serie: el mayor emitido + 1, o el primero. */
export function siguienteNumero(numeros: number[], empiezaEn = 1): number {
  return numeros.length === 0 ? empiezaEn : Math.max(empiezaEn - 1, ...numeros) + 1
}

/** El número formateado con su serie: «F-000123». */
export function numeroConSerie(serie: string, numero: number, digitos: number): string {
  return `${serie}-${String(numero).padStart(digitos, '0')}`
}
