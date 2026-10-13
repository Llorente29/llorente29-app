// tests/unit/modules/conta/correoC06.test.ts
//
// C06 · El correo con marca y el alta de una cuenta solo de contabilidad: lo
// que se decide sin red. Y el antes = después de lo que ya se manda: sin marca,
// el remitente y el cuerpo que se envía a Resend son los mismos que antes.

import { MARCAS } from '../../../../supabase/functions/_shared/marcas'
import { REMITENTE_FOLVY, contrasena, cuerpoResend, invitacion, remitenteDe } from '../../../../supabase/functions/send-email/marca'
import { baseDelEnlace, leerPedido, slugDe } from '../../../../supabase/functions/conta-crear-cuenta/pedido'

describe('send-email: sin marca, lo de siempre', () => {
  it('el remitente y la respuesta son los de antes del C06', () => {
    // Los valores que tenía index.ts (FROM y REPLY_TO) en origin/main.
    expect(REMITENTE_FOLVY).toEqual({ from: 'Folvy <no-reply@folvy.app>', replyTo: 'jgcolon@idasal.com' })
    for (const sin of [undefined, null, '']) {
      expect(remitenteDe(sin)).toEqual({ ok: true, from: 'Folvy <no-reply@folvy.app>', replyTo: 'jgcolon@idasal.com', marca: null })
    }
  })
  it('el cuerpo para Resend es el mismo JSON, con las mismas claves en el mismo orden', () => {
    const r = remitenteDe(undefined)
    if (!r.ok) throw new Error('sin marca tiene que poder mandar')
    // Lo que escribía index.ts antes: JSON.stringify({ from: FROM, to, reply_to: REPLY_TO, subject, html, text }).
    const antes = JSON.stringify({ from: 'Folvy <no-reply@folvy.app>', to: 'a@b.es', reply_to: 'jgcolon@idasal.com', subject: 'S', html: '<p>h</p>', text: 't' })
    expect(cuerpoResend(r, 'a@b.es', 'S', '<p>h</p>', 't')).toBe(antes)
  })
})

describe('send-email: con marca', () => {
  it('una marca sin remitente no manda, y dice por qué', () => {
    const r = remitenteDe('contabilidad')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toMatch(/no tiene remitente/)
    expect(remitenteDe('inventada')).toEqual({ ok: false, motivo: 'Marca desconocida: inventada' })
  })
  it('la invitación: una sola acción, la marca y ni rastro de Folvy', () => {
    const c = invitacion(MARCAS.contabilidad, { nombre: 'Ana', empresa: 'Ferretería Ejemplo, S.L.', enlace: 'https://vista.example/welcome?token_hash=x&marca=contabilidad' })
    expect(c.subject).toBe('Contabilidad · Entra en tu contabilidad')
    expect(c.html.match(/<a href=/g)?.length).toBe(1)
    expect(c.html).toContain('Entrar en tu contabilidad')
    expect(c.html).toContain('#2F5BFF')
    expect(c.html).toContain('Ferretería Ejemplo, S.L.')
    for (const t of [c.subject, c.html, c.text]) expect(t).not.toMatch(/folvy/i)
  })
  it('lo que viene de fuera se escapa, y un enlace que no es http no se pinta', () => {
    const c = invitacion(MARCAS.contabilidad, { nombre: '<script>', empresa: 'A & B', enlace: 'javascript:alert(1)' })
    expect(c.html).not.toContain('<script>')
    expect(c.html).toContain('A &amp; B')
    expect(c.html).not.toContain('javascript:')
    expect(c.html).toContain('El enlace no está disponible')
  })
  it('contraseña nueva: con la marca, sin Folvy', () => {
    const c = contrasena(MARCAS.contabilidad, { enlace: 'https://vista.example/reset-password/confirm?token_hash=x' })
    expect(c.subject).toBe('Contabilidad · Contraseña nueva')
    for (const t of [c.subject, c.html, c.text]) expect(t).not.toMatch(/folvy/i)
  })
})

describe('conta-crear-cuenta: el pedido', () => {
  const bien = { empresa: ' Ferretería Ejemplo, S.L. ', correo: 'Ana@Empresa-Ejemplo.es', nombre: '', marca: 'contabilidad', motivo: 'Viene de Diez' }
  it('lee y limpia lo que llega', () => {
    const r = leerPedido(bien)
    expect(r.ok).toBe(true)
    if (r.ok) expect({ ...r.pedido, marca: r.pedido.marca.id }).toEqual({ empresa: 'Ferretería Ejemplo, S.L.', correo: 'ana@empresa-ejemplo.es', nombre: null, marca: 'contabilidad', motivo: 'Viene de Diez' })
  })
  it('para lo que falta o no vale, con su frase', () => {
    expect(leerPedido(null)).toEqual({ ok: false, error: 'Body JSON inválido.' })
    expect(leerPedido({ ...bien, empresa: ' ' })).toMatchObject({ ok: false, error: 'Falta el nombre de la empresa.' })
    expect(leerPedido({ ...bien, correo: 'ana' })).toMatchObject({ ok: false })
    expect(leerPedido({ ...bien, marca: 'folvy' })).toMatchObject({ ok: false, error: 'Elige una marca de solo contabilidad.' })
    expect(leerPedido({ ...bien, motivo: '' })).toMatchObject({ ok: false, error: 'Falta por qué se da de alta: queda en el registro.' })
  })
  it('el slug cumple accounts_slug_format', () => {
    const formato = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/
    for (const e of ['Ferretería Ejemplo, S.L.', 'Ñandú & Cía', '  ', 'A'.repeat(90)]) {
      const s = slugDe(e, 'AB12')
      expect(s).toMatch(formato)
    }
    expect(slugDe('Ferretería Ejemplo, S.L.', 'ab12')).toBe('ferreteria-ejemplo-s-l-ab12')
  })
  it('en producción, una marca sin dominio no se invita (el cliente vería Folvy)', () => {
    expect(baseDelEnlace(MARCAS.contabilidad, true, 'https://vista.example')).toMatchObject({ ok: false })
    expect(baseDelEnlace(MARCAS.contabilidad, false, 'https://vista.example')).toEqual({ ok: true, base: 'https://vista.example' })
    expect(baseDelEnlace(MARCAS.contabilidad, false, null)).toMatchObject({ ok: false })
  })
})
