// src/modules/conta/libro/palabrasLlanas.ts
//
// S01e · Lo que se lee en el libro y en el asiento, sin jerga. Los «porqués»
// y los motivos vienen guardados (de la base, de la conciliación, de la
// lectura) y alguno trae palabras de dentro: «regla 9 del libro», «(concepto
// 17)», «tercero», «eje», o una cuenta en bruto («57200001») sin su nombre.
// Aquí se dicen en palabras normales al pintarlos; lo guardado no se toca.
// (Lo ideal es que nazcan así: esto cubre lo ya guardado y lo que llegue.)

const CODIGO = /\b\d{6,10}\b/g

/**
 * El texto en palabras normales. `cuentas` (código → nombre) pone el nombre
 * junto a cada cuenta en bruto que conozca: «57200001 (Banco)».
 */
export function palabrasLlanas(texto: string, cuentas?: ReadonlyMap<string, string>): string {
  let t = texto
    // «(regla 9 del libro)», «(regla 9)»: es nuestra, no del que lo lee.
    .replace(/\s*\([^()]*\breglas? \d+\b[^()]*\)/gi, '')
    // «, según la regla 9 del libro», «por la regla 5», «regla 9 del libro:»
    .replace(/[,;·]?\s*(?:según|por|con)?\s*(?:la\s+)?reglas? \d+(?:\s+del libro(?: diario)?)?\s*:?/gi, ' ')
    // «(concepto 17)»: el código de la norma del banco; el texto ya dice qué es.
    .replace(/\s*\(concepto \d+\)/gi, '')
    .replace(/\bterceros\b/g, 'proveedores o clientes').replace(/\btercero\b/g, 'proveedor o cliente')
    .replace(/\beje «?(local|marca)»?/g, 'reparto por $1')
    .replace(/\bejes analíticos\b/gi, 'repartos').replace(/\beje analítico\b/gi, 'reparto')
    .replace(/\bejes\b/g, 'repartos').replace(/\beje\b/g, 'reparto')
  if (cuentas && cuentas.size) {
    t = t.replace(CODIGO, (codigo, pos: number, todo: string) => {
      const nombre = cuentas.get(codigo)
      if (!nombre) return codigo
      // Si el nombre ya va justo delante, no se repite.
      if (todo.slice(Math.max(0, pos - nombre.length - 4), pos).includes(nombre)) return codigo
      // «(57200001)» → «(Banco Norte · 57200001)»; suelto, «57200001 (Banco Norte)».
      return todo[pos - 1] === '(' && todo[pos + codigo.length] === ')' ? `${nombre} · ${codigo}` : `${codigo} (${nombre})`
    })
  }
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:)])/g, '$1').replace(/\(\s+/g, '(').trim()
}

/** Código → nombre de las cuentas que salen en unos apuntes (para `palabrasLlanas`). */
export function nombresDeCuentas(apuntes: Iterable<{ cuenta: string; nombreCuenta: string }>): Map<string, string> {
  const m = new Map<string, string>()
  for (const l of apuntes) if (l.cuenta && l.nombreCuenta && l.nombreCuenta !== l.cuenta && !m.has(l.cuenta)) m.set(l.cuenta, l.nombreCuenta)
  return m
}
