// src/modules/conta/lib/cuentasParaMover.ts
//
// X21b / X23 (Julio, 19/11 y 21/11) · El pago y el cobro se indican con la cuenta contable, porque no solo van por
// el banco: también por caja, por la 430 de una plataforma, por un socio o por un vale. La lista de «Cómo se paga»
// (recibida) y de «Cómo se cobra» (emitida) es la MISMA pieza: el plan entero, todas las subcuentas abiertas, con
// las tesorerías (banco, tarjeta, caja) primero, después el resto del grupo 5 y lo que cada ficha ponga delante (las
// 430 de las plataformas en el pago), y después las demás. «No está» solo si no existe (regla 30). Puro.

export function cuentasParaMover<T extends Record<string, unknown>>(
  plan: readonly T[], o: { tesorerias: ReadonlySet<string>; delante?: (c: T) => boolean },
): T[] {
  const orden = (c: T) => {
    const code = String(c.code)
    if (o.tesorerias.has(code)) return 0
    return /^5/.test(code) || o.delante?.(c) ? 1 : 2
  }
  return plan
    .filter((c) => c.kind !== 'group' && String(c.code).length >= 8 && c.status !== 'cerrada')
    .slice()
    .sort((a, b) => orden(a) - orden(b) || String(a.code).localeCompare(String(b.code)))
}
