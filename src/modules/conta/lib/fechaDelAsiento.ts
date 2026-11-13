// src/modules/conta/lib/fechaDelAsiento.ts
//
// S01p·18.2 (Julio, 13/11) · La fecha con la que se apunta una factura recibida,
// a la vista y en una frase, ANTES de validar (regla 8): «Se apunta con fecha
// 31/10/2026, la de la factura.» Si va con otra, dice cuál y por qué. Sin React.

const es = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/')

/**
 * La frase de la fecha del asiento. `porque` es el aviso de la propuesta cuando
 * la fecha no es la de la factura (el IVA presentado, el corte con Diez…).
 */
export function fraseFechaDelAsiento(fechaFactura: string | null, fechaAsiento: string | null, porque?: string | null): string | null {
  if (!fechaAsiento) return null
  if (!fechaFactura || fechaFactura.slice(0, 10) === fechaAsiento.slice(0, 10)) {
    return `Se apunta con fecha ${es(fechaAsiento)}${fechaFactura ? ', la de la factura' : ''}.`
  }
  const motivo = (porque ?? '').trim().replace(/\.$/, '')
  return `Se apunta con fecha ${es(fechaAsiento)}, no la de la factura (${es(fechaFactura)})${motivo ? `: ${motivo}` : ''}.`
}
