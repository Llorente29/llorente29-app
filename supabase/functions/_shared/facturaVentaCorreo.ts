// supabase/functions/_shared/facturaVentaCorreo.ts
//
// V01 · Entrega 1 · EL CORREO DE UNA FACTURA DE VENTA. Puro, sin Deno: lo
// prueban las unitarias (tests/unit/modules/conta/facturaVentaCorreo.test.ts).
//
// Sale de sumied.com (verificado en Resend) con el nombre de la empresa que
// factura: «Bar Ejemplo vía Sumied <facturas@sumied.com>». Las respuestas van
// al correo de la empresa si lo tiene. El PDF va adjunto.
//
// Y el freno: el tipo «factura_venta» está cerrado hasta que Julio lo abra en
// CORREO_MARCA_ABIERTOS (cerrojoMarca). El primer envío real va solo a su
// correo de prueba («factura_venta:<correo>») y con su sí.

export const PLANTILLA_FACTURA_VENTA = 'factura_venta'
export const BUZON_FACTURAS = 'facturas@sumied.com'

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Un correo que se puede usar como destino: sin saltos, comas ni ángulos. */
export function correoValido(x: unknown): string | null {
  const c = String(x ?? '').trim().toLowerCase()
  if (!c || !CORREO.test(c) || /[\r\n,;<>"]/.test(c)) return null
  return c
}

/** El nombre de la empresa, limpio para ir en una cabecera. */
function limpio(x: string): string {
  return x.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70)
}

export function remitenteFactura(empresa: string): string {
  const n = limpio(empresa)
  return n ? `"${n} vía Sumied" <${BUZON_FACTURAS}>` : `Sumied <${BUZON_FACTURAS}>`
}

const euros = (x: number) => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions).format(x)
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const html = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface DatosCorreoFactura {
  empresa: string
  numero: string
  rectificativa: boolean
  /** AAAA-MM-DD */
  fecha: string
  total: number
  vence: string | null
  cliente: string
}

export function correoFactura(d: DatosCorreoFactura): { asunto: string; texto: string; html: string } {
  const que = d.rectificativa ? 'Factura rectificativa' : 'Factura'
  const asunto = limpio(`${que} ${d.numero} de ${d.empresa}`)
  const lineas = [
    `Hola, ${d.cliente}:`,
    '',
    `Te enviamos la ${que.toLowerCase()} ${d.numero} del ${fecha(d.fecha)}, por ${euros(d.total)} €.${d.vence ? ` Vence el ${fecha(d.vence)}.` : ''}`,
    'La tienes adjunta en PDF.',
    '',
    'Un saludo,',
    d.empresa,
  ]
  const texto = lineas.join('\n')
  const cuerpo = lineas.map((l) => (l ? `<p style="margin:0 0 4px">${html(l)}</p>` : '<p style="margin:0 0 12px"></p>')).join('')
  return {
    asunto,
    texto,
    html: `<div style="font-family:Inter,Helvetica,Arial,sans-serif;font-size:14px;color:#0B1F3B;line-height:1.5">${cuerpo}</div>`,
  }
}
