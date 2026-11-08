// tests/unit/modules/conta/g01d/alInstante.test.ts
//
// G01d · «Al instante» en palabras (Diseño del G01d): el estado, el aviso de
// que no llegan, la dirección que se copia, los pasos y la línea «Al día» de
// Clientes. Ids inventados (T11).

import { describe, expect, it } from 'vitest'
import { direccionDelAviso, estadoAlInstante, hace, lineaAlDia, pasosParaActivar, SIN_AVISOS_MS } from '../../../../../src/modules/conta/avisos/alInstante'

const AHORA = Date.parse('2026-11-08T12:00:00Z')
const antes = (min: number) => new Date(AHORA - min * 60_000).toISOString()

describe('el estado en palabras', () => {
  it('apagado (con o sin el código guardado)', () => {
    expect(estadoAlInstante({ encendido: false, tieneCodigo: false, ultimoAviso: null, encendidoAt: null }, 'Bitrix24', AHORA)).toEqual({ tono: 'apagado', frase: 'Apagado.' })
    expect(estadoAlInstante({ encendido: false, tieneCodigo: true, ultimoAviso: null, encendidoAt: null }, 'Bitrix24', AHORA).frase).toBe('Apagado. El código está guardado: enciéndelo cuando quieras.')
  })
  it('encendido y sin avisos aún: esperando el primero', () => {
    expect(estadoAlInstante({ encendido: true, tieneCodigo: true, ultimoAviso: null, encendidoAt: antes(5) }, 'Bitrix24', AHORA)).toEqual({ tono: 'espera', frase: 'Esperando el primer aviso.' })
  })
  it('funciona: el último aviso, hace cuánto', () => {
    expect(estadoAlInstante({ encendido: true, tieneCodigo: true, ultimoAviso: antes(2), encendidoAt: antes(600) }, 'Bitrix24', AHORA)).toEqual({ tono: 'bien', frase: 'Funciona: último aviso hace 2 min.' })
  })
  it('encendido y 24 horas sin avisos: lo dice, con dónde mirarlo', () => {
    expect(estadoAlInstante({ encendido: true, tieneCodigo: true, ultimoAviso: antes(25 * 60), encendidoAt: antes(3000) }, 'Bitrix24', AHORA))
      .toEqual({ tono: 'falta', frase: 'No llegan avisos desde ayer. Mira que siga dado de alta en Bitrix24.' })
    expect(estadoAlInstante({ encendido: true, tieneCodigo: true, ultimoAviso: null, encendidoAt: antes(SIN_AVISOS_MS / 60_000) }, 'GoCardless', AHORA).frase)
      .toBe('No llegan avisos desde ayer. Mira que siga dado de alta en GoCardless.')
  })
  it('«hace»: un momento, minutos, horas, ayer, días', () => {
    expect([hace(antes(0.5), AHORA), hace(antes(59), AHORA), hace(antes(61), AHORA), hace(antes(24 * 60), AHORA), hace(antes(3 * 24 * 60), AHORA)])
      .toEqual(['hace un momento', 'hace 59 min', 'hace 1 h', 'ayer', 'hace 3 días'])
  })
})

describe('la dirección que se pega, una por conexión', () => {
  it('el CRM, con la cuenta y el CRM; GoCardless, con la empresa', () => {
    expect(direccionDelAviso('https://proyecto.supabase.co/', { origen: 'crm', cuenta: '00000000-0000-4000-8000-000000000001', crm: 'bitrix24' }))
      .toBe('https://proyecto.supabase.co/functions/v1/conta-crm-aviso?cuenta=00000000-0000-4000-8000-000000000001&crm=bitrix24')
    expect(direccionDelAviso('https://proyecto.supabase.co', { origen: 'gocardless', empresa: '00000000-0000-4000-8000-000000000002' }))
      .toBe('https://proyecto.supabase.co/functions/v1/conta-gocardless-aviso?empresa=00000000-0000-4000-8000-000000000002')
  })
})

describe('las palabras: aviso, al instante, al día', () => {
  const frases = [
    ...['Apagado.', 'Esperando el primer aviso.'],
    estadoAlInstante({ encendido: true, tieneCodigo: true, ultimoAviso: antes(2), encendidoAt: null }, 'Bitrix24', AHORA).frase,
    estadoAlInstante({ encendido: true, tieneCodigo: true, ultimoAviso: antes(3000), encendidoAt: null }, 'Bitrix24', AHORA).frase,
    lineaAlDia({ ultimoAplicado: antes(2), ultimaLectura: null, ahora: AHORA }),
  ]
  it('en pantalla, nunca «webhook», «endpoint», «evento», «payload» ni «HMAC»', () => {
    for (const f of frases) expect(f).not.toMatch(/webhook|endpoint|evento|payload|hmac/i)
  })
  it('en los pasos, solo el nombre del menú de cada uno, dicho como tal', () => {
    const crm = pasosParaActivar('crm', 'Bitrix24')
    expect(crm[0]).toBe('En Bitrix24, ve a Recursos para desarrolladores › Otros › Webhook saliente (así lo llama Bitrix24).')
    expect(crm.join(' ')).toContain('ONCRMCOMPANYADD, ONCRMCOMPANYUPDATE, ONCRMCOMPANYDELETE, ONCRMCONTACTADD, ONCRMCONTACTUPDATE y ONCRMCONTACTDELETE')
    expect(crm.join(' ')).toContain('No lo mandes por correo ni por chat.')
    const gc = pasosParaActivar('gocardless', 'GoCardless')
    expect(gc[0]).toContain('Endpoint de webhook (así lo llama GoCardless)')
    for (const t of [...crm, ...gc]) expect(t.replace(/Webhook saliente|Endpoint de webhook/g, '')).not.toMatch(/webhook|endpoint|payload|hmac/i)
  })
})

describe('la línea «Al día» de Clientes (se pone cuando fusione el G04)', () => {
  it('con avisos recientes: al día, hace cuánto', () => {
    expect(lineaAlDia({ ultimoAplicado: antes(2), ultimaLectura: antes(600), ahora: AHORA })).toBe('Al día: actualizado hace 2 min.')
  })
  it('sin avisos: la última lectura entera, con su día y su hora de Madrid', () => {
    expect(lineaAlDia({ ultimoAplicado: null, ultimaLectura: '2026-11-08T03:00:00Z', ahora: AHORA })).toBe('Última lectura: hoy a las 4:00.')
    expect(lineaAlDia({ ultimoAplicado: null, ultimaLectura: '2026-11-07T03:00:00Z', ahora: AHORA })).toBe('Última lectura: ayer a las 4:00.')
    expect(lineaAlDia({ ultimoAplicado: antes(3000), ultimaLectura: '2026-11-05T03:00:00Z', ahora: AHORA })).toBe('Última lectura: el 5/11 a las 4:00.')
    expect(lineaAlDia({ ultimoAplicado: null, ultimaLectura: null, ahora: AHORA })).toBe('Aún no se ha leído.')
  })
})
