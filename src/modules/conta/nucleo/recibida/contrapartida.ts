// src/modules/conta/nucleo/recibida/contrapartida.ts
//
// K10 · La contrapartida de una recibida, con cualquier subcuenta (como en ERP10).
// Si va a una del 21x (el inmovilizado material), solo un aviso: hay que darlo de
// alta después en la ficha de bienes (para su amortización). No impide nada.

export const AVISO_INMOVILIZADO = 'Va a inmovilizado: después dalo de alta en la ficha de bienes.'

/** El aviso, si alguna línea va a una cuenta del 21x; null si no. */
export function avisoInmovilizado(cuentas: readonly string[]): string | null {
  return cuentas.some((c) => /^21\d/.test(c.trim())) ? AVISO_INMOVILIZADO : null
}
