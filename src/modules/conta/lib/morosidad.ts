// src/modules/conta/lib/morosidad.ts
//
// Ley 3/2004, de lucha contra la morosidad en las operaciones comerciales,
// art. 4.3 (texto vigente en docs/conta/fuentes/textos/ley-3-2004.txt): entre
// empresas, el plazo de pago no puede pasar de 60 días naturales.
//
// Respuesta 2 de Julio (C00): un plazo mayor se deja GUARDAR (hay casos y
// pactos que no le toca a Folvy juzgar), pero la pantalla avisa.

export const PLAZO_MAXIMO_ENTRE_EMPRESAS = 60

export const AVISO_PLAZO_MOROSIDAD = 'Supera los 60 días que permite la ley de morosidad entre empresas'

/** El aviso si algún plazo (días desde la factura) pasa de 60; si no, null. */
export function avisoPlazo(dias: readonly number[]): string | null {
  return dias.some((d) => Number.isFinite(d) && d > PLAZO_MAXIMO_ENTRE_EMPRESAS) ? AVISO_PLAZO_MOROSIDAD : null
}
