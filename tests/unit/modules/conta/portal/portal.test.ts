// GP · Tarea 2b · Lo puro del portal del cliente
// (supabase/functions/_shared/portal/portal.ts): los correos, el destino
// enmascarado, el nombre de un fichero y lo que se le pide a GoCardless.
// Respuestas con la forma de la documentación de GoCardless (09/11);
// identificadores, nombres y correos inventados.
import { describe, expect, it } from 'vitest'
import {
  camposPagoTarjeta, claveStripePruebas, leerSesionStripe,
  correoCodigo, correoEnlace, enmascararCorreo, fraseError, leerFlujo, leerPeticion, nombreSeguro, peticionCambiarCuenta,
  peticionFlujo, peticionLeer, peticionPagarAhora, peticionReintento,
} from '../../../../../supabase/functions/_shared/portal/portal'
import { VERSION_GOCARDLESS } from '../../../../../supabase/functions/_shared/cobro/gocardless'

const marca = { empresa: 'Gestoría Ejemplo', color: '#1F5BD8', logo: null }

describe('los correos del portal', () => {
  it('la invitación dice quién invita, a qué cliente y lleva el botón con el enlace', () => {
    const c = correoEnlace({ ...marca, cliente: 'Cliente Ejemplo, S.L.', enlace: 'https://app.sumied.com/portal.html?token_hash=x&type=magiclink', invitacion: true, invita: 'Persona Ejemplo' })
    expect(c.asunto).toBe('Gestoría Ejemplo te invita a tu espacio de cliente')
    expect(c.texto).toContain('Persona Ejemplo, de Gestoría Ejemplo, te ha dado acceso al espacio de Cliente Ejemplo, S.L.')
    expect(c.html).toContain('Entrar en mi espacio')
    expect(c.html).toContain('https://app.sumied.com/portal.html?token_hash=x&amp;type=magiclink')
    expect(c.html).toContain('Funciona con Sumied')
  })
  it('el enlace pedido no dice «invita» y avisa de qué hacer si no lo pidió', () => {
    const c = correoEnlace({ ...marca, cliente: 'Cliente Ejemplo, S.L.', enlace: 'https://app.sumied.com/portal.html?t=1', invitacion: false })
    expect(c.asunto).toBe('Tu enlace para entrar en Gestoría Ejemplo')
    expect(c.texto).toContain('Si no lo has pedido tú, no hagas nada')
  })
  it('ningún correo dice mandato, payment ni SEPA', () => {
    const textos = [
      correoEnlace({ ...marca, cliente: 'C', enlace: 'https://x.example/', invitacion: true }),
      correoCodigo({ ...marca, codigo: '012345', titulo: 'La hoja de encargo', minutos: 10 }),
    ].map((c) => `${c.asunto} ${c.texto} ${c.html}`)
    for (const t of textos) expect(t).not.toMatch(/mandat|payment|sepa/i)
  })
  it('el código: seis cifras en el asunto y en el cuerpo, y nada más', () => {
    const c = correoCodigo({ ...marca, codigo: '004217', titulo: 'La hoja de encargo de 2027', minutos: 10 })
    expect(c.asunto).toBe('004217 es tu código para firmar')
    expect(c.texto).toContain('«La hoja de encargo de 2027»')
    expect(() => correoCodigo({ ...marca, codigo: '42', titulo: 'x', minutos: 10 })).toThrow()
  })
})

describe('lo que se guarda', () => {
  it('el destino del código, enmascarado', () => {
    expect(enmascararCorreo('persona@ejemplo.example')).toBe('p•••@ejemplo.example')
    expect(enmascararCorreo('sin-arroba')).toBe('•••')
  })
  it('el nombre de un fichero: sin carpetas ni raros, con su extensión', () => {
    expect(nombreSeguro('../../etc/Factura nº 12 (copia).pdf')).toBe('Factura n_ 12 _copia_.pdf')
    expect(nombreSeguro('C:\\fotos\\Ticket gasóleo.jpg')).toBe('Ticket gasoleo.jpg')
    expect(nombreSeguro('...')).toBe('documento')
    const largo = nombreSeguro('a'.repeat(200) + '.pdf')
    expect(largo).toHaveLength(80)
    expect(largo.endsWith('.pdf')).toBe(true)
  })
})

describe('GoCardless', () => {
  it('pagar ahora: el importe en céntimos, en euros, del cliente que ya existe y con su clave', () => {
    const p = peticionPagarAhora({ clienteGc: 'CU000EJEMPLO', importeCent: 18150, descripcion: 'Recibo de noviembre', clave: 'portal:pagar:r1' })
    expect(p).toEqual({
      metodo: 'POST', ruta: '/billing_requests',
      cabeceras: { 'GoCardless-Version': VERSION_GOCARDLESS, 'Idempotency-Key': 'portal:pagar:r1' },
      cuerpo: { billing_requests: { payment_request: { amount: 18150, currency: 'EUR', description: 'Recibo de noviembre' }, links: { customer: 'CU000EJEMPLO' } } },
    })
    expect(() => peticionPagarAhora({ clienteGc: 'CU000EJEMPLO', importeCent: 181.5, descripcion: 'x', clave: 'k' })).toThrow()
    expect(() => peticionPagarAhora({ clienteGc: 'otro', importeCent: 100, descripcion: 'x', clave: 'k' })).toThrow()
  })
  it('cambiar de cuenta: una domiciliación sepa_core del mismo cliente', () => {
    expect(peticionCambiarCuenta({ clienteGc: 'CU000EJEMPLO', clave: 'k' }).cuerpo)
      .toEqual({ billing_requests: { mandate_request: { scheme: 'sepa_core' }, links: { customer: 'CU000EJEMPLO' } } })
  })
  it('la página para completarlo vuelve solo a una dirección https', () => {
    const p = peticionFlujo({ brq: 'BRQ000EJEMPLO', vuelta: 'https://app.sumied.com/portal.html?vuelta=1', salida: 'https://app.sumied.com/portal.html', clave: 'k' })
    expect(p.cuerpo).toEqual({ billing_request_flows: { redirect_uri: 'https://app.sumied.com/portal.html?vuelta=1', exit_uri: 'https://app.sumied.com/portal.html', links: { billing_request: 'BRQ000EJEMPLO' } } })
    expect(() => peticionFlujo({ brq: 'BRQ000EJEMPLO', vuelta: 'http://x', salida: 'https://x', clave: 'k' })).toThrow()
  })
  it('el reintento y la lectura, solo con identificadores de GoCardless', () => {
    expect(peticionReintento('PM000EJEMPLO', 'k').ruta).toBe('/payments/PM000EJEMPLO/actions/retry')
    expect(() => peticionReintento('PM000/../mandates', 'k')).toThrow()
    expect(peticionLeer('BRQ000EJEMPLO')).toEqual({ metodo: 'GET', ruta: '/billing_requests/BRQ000EJEMPLO', cabeceras: { 'GoCardless-Version': VERSION_GOCARDLESS } })
  })
  it('lee en qué ha quedado: hecha con su pago o su domiciliación, esperando, fallida o caducada', () => {
    expect(leerPeticion({ billing_requests: { id: 'BRQ000EJEMPLO', status: 'fulfilled', links: { payment_request_payment: 'PM000NUEVO' } } }))
      .toEqual({ id: 'BRQ000EJEMPLO', estado: 'hecha', pago: 'PM000NUEVO', mandato: null })
    expect(leerPeticion({ billing_requests: { id: 'BRQ000EJEMPLO', status: 'fulfilled', links: { mandate_request_mandate: 'MD000NUEVO' } } }).mandato).toBe('MD000NUEVO')
    expect(leerPeticion({ billing_requests: { id: 'BRQ000EJEMPLO', status: 'pending', links: {} } }).estado).toBe('esperando')
    expect(leerPeticion({ billing_requests: { id: 'BRQ000EJEMPLO', status: 'ready_to_fulfil', links: {} } }).estado).toBe('esperando')
    expect(leerPeticion({ billing_requests: { id: 'BRQ000EJEMPLO', status: 'cancelled', links: {} } }).estado).toBe('caducada')
    expect(leerPeticion({ billing_requests: { id: 'BRQ000EJEMPLO', status: 'failed', links: {} } }).estado).toBe('fallida')
    expect(() => leerPeticion({})).toThrow()
    expect(leerFlujo({ billing_request_flows: { authorisation_url: 'https://pay-sandbox.gocardless.com/billing/static/flow?id=BRF000' } })).toMatch(/^https:/)
    expect(() => leerFlujo({ billing_request_flows: {} })).toThrow()
  })
  it('los errores, en palabras del cliente', () => {
    expect(fraseError(422, { error: { errors: [{ reason: 'not_retryable' }] } }, 'reintentar')).toMatch(/ya no se puede pasar de nuevo/)
    expect(fraseError(422, { error: { errors: [{ reason: 'scheme_not_supported' }] } }, 'pagar')).toMatch(/no deja pagar al momento/)
    expect(fraseError(403, {}, 'cambiar')).toMatch(/aún no tiene encendido/)
    expect(fraseError(503, {}, 'pagar')).toMatch(/no contesta ahora/)
    for (const f of [fraseError(422, {}, 'pagar'), fraseError(500, {}, 'cambiar')]) expect(f).not.toMatch(/mandat|payment|sepa|billing/i)
  })
})


describe('Stripe, solo en pruebas', () => {
  it('la clave tiene que ser de pruebas: con otra, no se cobra nada', () => {
    expect(claveStripePruebas('sk_test_000')).toEqual({ clave: 'sk_test_000' })
    expect(claveStripePruebas('sk_live_000')).toEqual({ porque: expect.stringMatching(/solo funciona con la clave de pruebas/) })
    expect(claveStripePruebas('rk_live_000')).toHaveProperty('porque')
    expect(claveStripePruebas(undefined)).toEqual({ porque: 'El pago con tarjeta aún no está conectado.' })
  })
  it('la sesión: el importe en céntimos, tarjeta y, si se pide, Bizum, y la vuelta con su sesión', () => {
    const c = camposPagoTarjeta({ importeCent: 18150, concepto: 'Recibo de noviembre devuelto', operacion: 'op1', vuelta: 'https://app.sumied.com/portal.html?vuelta=op1', salida: 'https://app.sumied.com/portal.html', correo: null, bizum: true })
    expect(c['line_items[0][price_data][unit_amount]']).toBe('18150')
    expect(c['line_items[0][price_data][currency]']).toBe('eur')
    expect(c['payment_method_types[0]']).toBe('card')
    expect(c['payment_method_types[1]']).toBe('bizum')
    expect(c.success_url).toBe('https://app.sumied.com/portal.html?vuelta=op1&sesion={CHECKOUT_SESSION_ID}')
    expect(c).not.toHaveProperty('customer_email')
    expect(camposPagoTarjeta({ importeCent: 100, concepto: 'x', operacion: 'o', vuelta: 'https://x.example/p', salida: 'https://x.example/', correo: 'c@x.example', bizum: false }))
      .not.toHaveProperty('payment_method_types[1]')
    expect(() => camposPagoTarjeta({ importeCent: 1.5, concepto: 'x', operacion: 'o', vuelta: 'https://x', salida: 'https://x', correo: null, bizum: false })).toThrow()
  })
  it('lee la sesión: pagada, esperando o caducada', () => {
    expect(leerSesionStripe({ id: 'cs_test_1', status: 'complete', payment_status: 'paid' }).estado).toBe('hecha')
    expect(leerSesionStripe({ id: 'cs_test_1', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/x' })).toEqual({ id: 'cs_test_1', estado: 'esperando', url: 'https://checkout.stripe.com/c/pay/x' })
    expect(leerSesionStripe({ id: 'cs_test_1', status: 'expired', payment_status: 'unpaid' }).estado).toBe('caducada')
    expect(() => leerSesionStripe({})).toThrow()
  })
})
