// I01b · P4b · «Invitar a mi asesoría»: el token, su huella, el enlace y el
// correo. Todo de mentira (empresa, correos y nombres inventados).
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { enlaceAceptar, huella, leerInvitar, marcaDeCuenta, tokenNuevo, tokenValido } from '../../../supabase/functions/_shared/asesoria'
import { MARCAS } from '../../../supabase/functions/_shared/marcas'
import { invitacionAsesoria, PLANTILLAS_MARCA } from '../../../supabase/functions/send-email/marca'

describe('el token del enlace', () => {
  it('32 bytes al azar en base64url, y la base solo guarda su sha256', async () => {
    const t = tokenNuevo()
    expect(tokenValido(t)).toBe(true)
    expect(tokenNuevo()).not.toBe(t)
    expect(await huella(t)).toBe(createHash('sha256').update(t).digest('hex'))
    expect(tokenValido('corto')).toBe(false)
    expect(tokenValido(`${t}=`)).toBe(false)
  })
})

describe('el enlace de aceptar', () => {
  const t = 'A'.repeat(43)
  it('en producción, por el dominio de la marca de la cuenta que invita', () => {
    expect(enlaceAceptar(MARCAS.folvy, t, true, null)).toBe(`https://app.folvy.app/conta/asesoria?t=${t}`)
  })
  it('fuera de producción, nunca al dominio de producción: por la base de pruebas, o nada', () => {
    expect(enlaceAceptar(MARCAS.folvy, t, false, 'https://pruebas.example.test/')).toBe(`https://pruebas.example.test/conta/asesoria?t=${t}`)
    expect(enlaceAceptar(MARCAS.sumied, t, false, 'https://pruebas.example.test')).toBe(`https://pruebas.example.test/conta/asesoria?t=${t}&marca=sumied`)
    expect(enlaceAceptar(MARCAS.folvy, t, false, null)).toBeNull()
  })
  it('la marca: la de la cuenta; sin marca, Folvy', () => {
    expect(marcaDeCuenta('sumied').id).toBe('sumied')
    expect(marcaDeCuenta(null).id).toBe('folvy')
    expect(marcaDeCuenta('inventada').id).toBe('folvy')
  })
})

describe('lo que pide quien invita', () => {
  const ok = { empresa: '3b34403a-a7d6-4a48-a8d7-737e8cababdc', correo: ' Asesoria@Ejemplo.TEST ', nombre: 'Asesoría de Prueba', base: 'social_collaborator' }
  it('el correo, en minúsculas y sin espacios', () => {
    expect(leerInvitar(ok)).toEqual({ ok: true, p: { ...ok, correo: 'asesoria@ejemplo.test' } })
  })
  it('cada cosa que falta, con su frase', () => {
    expect(leerInvitar({ ...ok, correo: 'no' })).toMatchObject({ ok: false, mensaje: 'Escribe un correo válido.' })
    expect(leerInvitar({ ...ok, nombre: 'A' })).toMatchObject({ ok: false })
    expect(leerInvitar({ ...ok, base: 'otra' })).toMatchObject({ ok: false })
    expect(leerInvitar({ ...ok, empresa: 'x' })).toMatchObject({ ok: false, mensaje: 'Falta la empresa.' })
  })
})

describe('el correo de la invitación', () => {
  it('está registrado, dice quién invita, a qué, cómo y cuándo caduca, y escapa lo que escribe la empresa', () => {
    expect(PLANTILLAS_MARCA.invitacion_asesoria).toBe(invitacionAsesoria)
    const c = invitacionAsesoria(MARCAS.folvy, {
      asesoria: 'Asesoría <b>de Prueba</b>', empresa: 'Empresa de Prueba SL', invita: 'Ana', base: 'power_of_attorney',
      enlace: 'https://app.folvy.app/conta/asesoria?t=x', caduca: '25/10',
    })
    expect(c.subject).toBe('Folvy · Empresa de Prueba SL te invita a llevar sus impuestos')
    expect(c.html).toContain('Asesoría &lt;b&gt;de Prueba&lt;/b&gt;')
    expect(c.html).not.toContain('<b>de Prueba</b>')
    expect(c.text).toContain('Ana, de Empresa de Prueba SL, te invita a llevar sus impuestos en Folvy como Asesoría <b>de Prueba</b>, con el poder que tiene en Hacienda.')
    expect(c.text).toContain('La invitación caduca el 25/10.')
  })
})
