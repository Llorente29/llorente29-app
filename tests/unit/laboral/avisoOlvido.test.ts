// tests/unit/laboral/avisoOlvido.test.ts
//
// L1a · PR 3: lo puro del aviso de olvido por WhatsApp
// (supabase/functions/_shared/avisoOlvido.ts). La firma de Meta, los botones y
// lo que llega al webhook, con la forma de los avisos de Meta tal cual los
// documenta (Cloud API, webhook «messages»).
/* eslint-disable @typescript-eslint/no-explicit-any -- los mensajes de Meta, leídos como llegan */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  cargaBoton, correoAviso, finTelefono, firmaDeMeta, leerCarga, leerWebhook, mensajePlantilla, telefonoMeta,
} from '../../../supabase/functions/_shared/avisoOlvido'

const SECRETO = 'secreto-de-la-prueba'
const firmar = (cuerpo: string | Uint8Array, secreto = SECRETO) => 'sha256=' + createHmac('sha256', secreto).update(cuerpo).digest('hex')
const ID = '7f1c2b8e-3d4a-4f6b-9c0d-1e2f3a4b5c6d'

describe('la firma de Meta', () => {
  const cuerpo = '{"object":"whatsapp_business_account","entry":[]}'

  it('vale con la firma del secreto, sobre el cuerpo tal cual', async () => {
    expect(await firmaDeMeta(cuerpo, firmar(cuerpo), SECRETO)).toBe('valida')
    expect(await firmaDeMeta(new TextEncoder().encode(cuerpo), firmar(cuerpo).toUpperCase().replace('SHA256=', 'sha256='), SECRETO)).toBe('valida')
  })

  it('los bytes, no el texto releído: «á» escapada y sin escapar firman distinto', async () => {
    const escapado = '{"t":"\\u00e1"}'
    const tal = '{"t":"á"}'
    expect(await firmaDeMeta(escapado, firmar(escapado), SECRETO)).toBe('valida')
    expect(await firmaDeMeta(tal, firmar(escapado), SECRETO)).toBe('firma_mala')
  })

  it('sin firma, con otra o sin secreto: no es de Meta', async () => {
    expect(await firmaDeMeta(cuerpo, null, SECRETO)).toBe('sin_firma')
    expect(await firmaDeMeta(cuerpo, 'sha1=abc', SECRETO)).toBe('sin_firma')
    expect(await firmaDeMeta(cuerpo, firmar(cuerpo, 'otro'), SECRETO)).toBe('firma_mala')
    expect(await firmaDeMeta(cuerpo + ' ', firmar(cuerpo), SECRETO)).toBe('firma_mala')
    expect(await firmaDeMeta(cuerpo, firmar(cuerpo), '')).toBe('sin_secreto')
  })

  it('durante un cambio de secreto vale también el anterior (el _PREV), y solo ése', async () => {
    expect(await firmaDeMeta(cuerpo, firmar(cuerpo, 'viejo'), SECRETO, 'viejo')).toBe('valida')
    expect(await firmaDeMeta(cuerpo, firmar(cuerpo, 'otro'), SECRETO, 'viejo')).toBe('firma_mala')
  })
})

describe('los botones', () => {
  it('la carga dice qué aviso y qué respuesta, y nada más', () => {
    expect(leerCarga(cargaBoton(ID, 'a_su_hora'))).toEqual({ avisoId: ID, respuesta: 'a_su_hora' })
    expect(leerCarga(`olvido:${ID}:sigo`)).toEqual({ avisoId: ID, respuesta: 'sigo' })
    expect(leerCarga(`olvido:${ID}:borrar`)).toBeNull()
    expect(leerCarga(`olvido:no-es-un-id:sigo`)).toBeNull()
    expect(leerCarga(`otra:${ID}:sigo`)).toBeNull()
    expect(leerCarga(`olvido:${ID}:sigo:mas`)).toBeNull()
    expect(leerCarga(null)).toBeNull()
  })

  it('el teléfono como lo quiere Meta', () => {
    expect(telefonoMeta('+34 600 000 001')).toBe('34600000001')
    expect(telefonoMeta('600-000-001')).toBe('34600000001')
    expect(telefonoMeta('0034600000001')).toBe('34600000001')
    expect(telefonoMeta('')).toBe('')
    expect(telefonoMeta('abc')).toBe('')
    expect(finTelefono('34600000001')).toBe('0001')
  })

  it('con turno: el mensaje de la maqueta y tres botones', () => {
    const m = mensajePlantilla(
      { id: ID, nombre: 'Marcos', localNombre: 'Alcalá', finHora: '00:00', entradaHora: '16:58', conTurno: true },
      { conTurno: 'aviso_olvido_salida', sinTurno: 'aviso_olvido_salida_sin_turno' }, 'es') as any
    expect(m.name).toBe('aviso_olvido_salida')
    expect(m.components[0].parameters.map((p: any) => p.text)).toEqual(['Marcos', 'Alcalá', '00:00'])
    expect(m.components.slice(1).map((c: any) => [c.sub_type, c.index, c.parameters[0].payload])).toEqual([
      ['quick_reply', '0', `olvido:${ID}:a_su_hora`],
      ['quick_reply', '1', `olvido:${ID}:otra_hora`],
      ['quick_reply', '2', `olvido:${ID}:sigo`],
    ])
  })

  it('sin turno: la hora de la entrada y dos botones (no hay «a esa hora»)', () => {
    const m = mensajePlantilla(
      { id: ID, nombre: 'Ana', localNombre: 'Carabanchel', finHora: null, entradaHora: '06:00', conTurno: false },
      { conTurno: 'aviso_olvido_salida', sinTurno: 'aviso_olvido_salida_sin_turno' }, 'es') as any
    expect(m.name).toBe('aviso_olvido_salida_sin_turno')
    expect(m.components[0].parameters.map((p: any) => p.text)).toEqual(['Ana', 'Carabanchel', '06:00'])
    expect(m.components.slice(1).map((c: any) => c.parameters[0].payload)).toEqual([`olvido:${ID}:otra_hora`, `olvido:${ID}:sigo`])
  })

  it('sin la plantilla nueva puesta: null (se manda la de antes)', () => {
    expect(mensajePlantilla({ id: ID, nombre: 'A', localNombre: 'B', finHora: '17:00', entradaHora: '10:00', conTurno: true }, { conTurno: '', sinTurno: '' }, 'es')).toBeNull()
  })
})

describe('lo que llega al webhook', () => {
  it('un botón, con el mensaje al que contesta', () => {
    const e = leerWebhook({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: '9' },
      contacts: [{ wa_id: '34600000001', profile: { name: 'Marcos' } }],
      messages: [{ from: '34600000001', id: 'wamid.R', timestamp: '1761062400', type: 'button',
        context: { from: '34911111111', id: 'wamid.AVISO' },
        button: { payload: `olvido:${ID}:a_su_hora`, text: 'Salí a esa hora' } }],
    } }] }] })
    expect(e).toEqual([{ tipo: 'boton', de: '34600000001', wamid: 'wamid.R', contexto: 'wamid.AVISO', carga: `olvido:${ID}:a_su_hora`, texto: 'Salí a esa hora' }])
  })

  it('los estados, con el error en código y título', () => {
    const e = leerWebhook({ entry: [{ changes: [{ value: { statuses: [
      { id: 'wamid.A', status: 'delivered', timestamp: '1761062400', recipient_id: '34600000001' },
      { id: 'wamid.B', status: 'failed', timestamp: '1761062401', errors: [{ code: 131026, title: 'Message undeliverable' }] },
    ] } }] }] })
    expect(e[0]).toEqual({ tipo: 'estado', wamid: 'wamid.A', estado: 'delivered', at: '2025-10-21T16:00:00.000Z', error: null })
    expect(e[1]).toMatchObject({ tipo: 'estado', wamid: 'wamid.B', estado: 'failed' })
    expect(JSON.parse((e[1] as any).error)).toEqual({ code: 131026, message: 'Message undeliverable' })
  })

  it('un texto o algo raro: se reconoce y no se responde', () => {
    const e = leerWebhook({ entry: [{ changes: [{ value: { messages: [
      { from: '34600000001', id: 'wamid.T', type: 'text', text: { body: 'hola' } },
      { from: '34600000001', id: 'wamid.I', type: 'image' },
    ] } }] }] })
    expect(e.map((x) => x.tipo)).toEqual(['texto', 'otro'])
    expect(leerWebhook(null)).toEqual([])
    expect(leerWebhook({ entry: 'x' })).toEqual([])
  })
})

describe('el correo a la empresa', () => {
  it('lleva el texto y el enlace a Equipo, escapado', () => {
    const c = correoAviso('Ana fichó fuera del radio de Alcalá', 'Ana fichó <la entrada> a 670 m.', 'https://app.folvy.app/personal')
    expect(c.asunto).toBe('Ana fichó fuera del radio de Alcalá')
    expect(c.html).toContain('&lt;la entrada&gt;')
    expect(c.html).toContain('href="https://app.folvy.app/personal"')
    expect(c.texto).toContain('Equipo: https://app.folvy.app/personal')
  })
})
