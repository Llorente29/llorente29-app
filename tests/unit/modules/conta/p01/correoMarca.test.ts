// tests/unit/modules/conta/p01/correoMarca.test.ts
//
// P01 · El correo de Sumied: remitente propio, «responder a» por envío y el
// freno por tipo (todo cerrado salvo lo que abra Julio). Sin marca, Folvy
// sigue exactamente igual.

import { MARCAS } from '../../../../../supabase/functions/_shared/marcas'
import { cerrojoMarca, cuerpoResend, remitenteDe } from '../../../../../supabase/functions/send-email/marca'

describe('P01 · remitente de Sumied', () => {
  it('Sumied manda desde impuestos@sumied.com, sin «responder a» propio', () => {
    expect(MARCAS.sumied.remitente).toBe('Sumied <impuestos@sumied.com>')
    expect(remitenteDe('sumied')).toMatchObject({ ok: true, from: 'Sumied <impuestos@sumied.com>', replyTo: null })
  })
  it('el «responder a» de un envío: el de la asesoría, limpio', () => {
    const r = remitenteDe('sumied', ' Despacho@Asesoria-Ejemplo.test ')
    expect(r).toMatchObject({ ok: true, replyTo: 'despacho@asesoria-ejemplo.test' })
    if (!r.ok) throw new Error('tenía que valer')
    expect(JSON.parse(cuerpoResend(r, 'c@cliente.test', 'S', 'h', 't')).reply_to).toBe('despacho@asesoria-ejemplo.test')
  })
  it('un «responder a» que no es un correo, o que mete otra cabecera, no se manda', () => {
    for (const malo of ['no es un correo', 'a@b.test\r\nBcc: x@y.test', 'a@b.test, otro@c.test']) {
      const r = remitenteDe('sumied', malo)
      expect(r.ok).toBe(false)
    }
  })
  it('sin marca no cambia nada, aunque llegue un «responder a»', () => {
    expect(remitenteDe(undefined, 'otro@x.test')).toEqual({ ok: true, from: 'Folvy <no-reply@folvy.app>', replyTo: 'jgcolon@idasal.com', marca: null })
  })
})

describe('P01 · el freno por tipo', () => {
  const s = MARCAS.sumied
  it('sin marca (Folvy) no se frena nada', () => {
    expect(cerrojoMarca(null, 'welcome', 'a@b.test', undefined)).toEqual({ abierto: true })
  })
  it('con marca, sin nada abierto, todo cerrado y dice por qué', () => {
    for (const abiertos of [undefined, null, '', '  ']) {
      const c = cerrojoMarca(s, 'resumen_trimestre', 'cliente@x.test', abiertos)
      expect(c.abierto).toBe(false)
      if (!c.abierto) expect(c.motivo).toBe('Los correos «resumen_trimestre» de Sumied están cerrados hasta que Julio los abra. No se ha mandado nada.')
    }
    // Las invitaciones y contraseñas de Sumied, también cerradas.
    for (const t of ['invitacion_asesoria', 'invitacion_conta', 'contrasena_conta']) expect(cerrojoMarca(s, t, 'a@b.test', 'resumen_trimestre').abierto).toBe(false)
  })
  it('el correo de prueba: abierto solo a ese destinatario', () => {
    const abiertos = 'resumen_trimestre:Julio.Prueba@ejemplo.test'
    expect(cerrojoMarca(s, 'resumen_trimestre', 'julio.prueba@ejemplo.test', abiertos)).toEqual({ abierto: true })
    const otro = cerrojoMarca(s, 'resumen_trimestre', 'cliente@x.test', abiertos)
    expect(otro.abierto).toBe(false)
    if (!otro.abierto) expect(otro.motivo).toMatch(/solo están abiertos para la prueba/)
  })
  it('abierto a todos, tipo a tipo', () => {
    expect(cerrojoMarca(s, 'resumen_trimestre', 'cliente@x.test', 'invitacion_asesoria, resumen_trimestre')).toEqual({ abierto: true })
    expect(cerrojoMarca(s, 'contrasena_conta', 'cliente@x.test', 'invitacion_asesoria, resumen_trimestre').abierto).toBe(false)
  })
})
