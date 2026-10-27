// tests/unit/modules/conta/pc01/stripeSumied.test.ts
//
// PC01 · Entrega 4 · El cobro con tarjeta y Bizum por Stripe
// (supabase/functions/_shared/stripeSumied.ts y lib/cobros.ts):
//   · la versión de la API, una y sin «preview» (Respuesta 10);
//   · el estado de cada método en palabras, con la cuenta REAL que creó la
//     sonda el 27/10 (docs/conta/pc01/e4/sonda-bizum.json): le faltaba el alta,
//     y Bizum pedido salía «inactive»;
//   · la firma de los avisos de Stripe: buena, vieja, manipulada, sin firma;
//   · el alta: panel completo, comisiones y pérdidas para Stripe, España, y
//     Bizum NO en el alta (la v2 no lo conoce ahí: lo dijo la sonda);
//   · lo que ve el restaurante: estado, el único botón y el aviso de Bizum,
//     sin palabras de técnico.

import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import sonda from '../../../../../docs/conta/pc01/e4/sonda-bizum.json'
import { STRIPE_VERSION, centimos, clavePrueba, cuerpoAlta, estadoMetodo, firmaValida, fraseEstado } from '../../../../../supabase/functions/_shared/stripeSumied'
import { avisoBizum, botonAltaStripe, textoMetodoPago, type CobroStripe } from '@/modules/conta/lib/cobros'

const TECNICAS = /\b(capacidad|capability|v2|Connect|account|preview|API)\b/i

describe('la versión de la API de Stripe', () => {
  it('una sola, la de la cuenta que contestó a la sonda, y sin preview', () => {
    expect(STRIPE_VERSION).toBe('2026-06-24.dahlia')
    expect(STRIPE_VERSION).not.toMatch(/preview/)
    expect((sonda as { alta?: { version?: string } }).alta?.version).toBe(STRIPE_VERSION)
  })
})

describe('el estado de cada método, en palabras', () => {
  it('con la cuenta REAL de la sonda: a la tarjeta y a Bizum les falta el alta', () => {
    const s = sonda as { capacidades: { todas: Record<string, string>; pendiente: string[] }; pedir_bizum: { estado: string; le_falta: string[] } }
    const cuenta = { capabilities: { ...s.capacidades.todas, bizum_payments: s.pedir_bizum.estado }, requirements: { currently_due: s.pedir_bizum.le_falta, past_due: [] }, details_submitted: false }
    expect(estadoMetodo(cuenta, 'card_payments')).toBe('falta_alta')
    expect(estadoMetodo(cuenta, 'bizum_payments')).toBe('falta_alta')
  })
  it('activo, revisando, y sin cuenta', () => {
    expect(estadoMetodo({ capabilities: { card_payments: 'active' } }, 'card_payments')).toBe('activo')
    expect(estadoMetodo({ capabilities: { bizum_payments: 'pending' } }, 'bizum_payments')).toBe('revisando')
    expect(estadoMetodo({ capabilities: { bizum_payments: 'inactive' }, requirements: { currently_due: [] }, details_submitted: true }, 'bizum_payments')).toBe('revisando')
    expect(estadoMetodo(null, 'card_payments')).toBe('sin_alta')
    expect(fraseEstado('activo', 'falta_alta')).toBe('Tarjeta: activo. Bizum: falta terminar tu alta en Stripe.')
  })
})

describe('la firma de los avisos de Stripe', () => {
  const secreto = 'whsec_prueba'
  const cuerpo = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' })
  const t = 1_800_000_000
  const firma = (c: string, tt = t) => `t=${tt},v1=${createHmac('sha256', secreto).update(`${tt}.${c}`).digest('hex')}`
  it('la buena pasa', async () => {
    expect(await firmaValida(cuerpo, firma(cuerpo), secreto, t + 10)).toBe(true)
  })
  it('vieja (más de 5 minutos), manipulada, de otro secreto o sin firma, no', async () => {
    expect(await firmaValida(cuerpo, firma(cuerpo), secreto, t + 301)).toBe(false)
    expect(await firmaValida(cuerpo.replace('evt_1', 'evt_2'), firma(cuerpo), secreto, t)).toBe(false)
    expect(await firmaValida(cuerpo, firma(cuerpo), 'whsec_otro', t)).toBe(false)
    expect(await firmaValida(cuerpo, null, secreto, t)).toBe(false)
    expect(await firmaValida(cuerpo, 't=abc,v1=00', secreto, t)).toBe(false)
  })
})

describe('el alta del restaurante', () => {
  it('la de la sonda: panel completo, España, comisiones y pérdidas para Stripe, tarjeta; Bizum, aparte', () => {
    const a = cuerpoAlta({ correo: 'admin@ejemplo.es', nombre: 'Foodint' })
    expect(a).toMatchObject({ dashboard: 'full', identity: { country: 'es' }, contact_email: 'admin@ejemplo.es',
      defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } } })
    expect(JSON.stringify(a)).not.toContain('bizum')
    expect(cuerpoAlta({ correo: null, nombre: 'X' })).not.toHaveProperty('contact_email')
  })
  it('las claves de prueba y los céntimos', () => {
    expect(clavePrueba('sk_test_abc')).toBe(true)
    expect(clavePrueba('rk_test_abc')).toBe(true)
    expect(clavePrueba('sk_live_abc')).toBe(false)
    expect(centimos(1452)).toBe(145200)
    expect(centimos(0.1 + 0.2)).toBe(30)
    expect(centimos(780.5)).toBe(78050)
  })
})

describe('«Cómo te pagan»', () => {
  const c = (x: Partial<CobroStripe>): CobroStripe => ({ tarjeta: 'falta_alta', bizum: 'falta_alta', bizumEncendido: false, pendiente: 19, modo: 'prueba', ...x })
  it('el estado en palabras', () => {
    expect(textoMetodoPago('activo')).toBe('Activo')
    expect(textoMetodoPago('falta_alta')).toBe('Falta tu alta en Stripe')
    expect(textoMetodoPago('revisando')).toBe('Stripe está revisando')
    expect(textoMetodoPago(null)).toBe('Falta tu alta en Stripe')
  })
  it('un solo botón, al alta de Stripe; con todo activo, ninguno', () => {
    expect(botonAltaStripe(null)).toBe('Darte de alta en Stripe')
    expect(botonAltaStripe(c({}))).toBe('Terminar tu alta en Stripe')
    expect(botonAltaStripe(c({ tarjeta: 'activo', bizum: 'revisando' }))).toBe('Ver tu alta en Stripe')
    expect(botonAltaStripe(c({ tarjeta: 'activo', bizum: 'activo' }))).toBeNull()
  })
  it('el aviso de Bizum en la ficha de Cobros, mientras no esté activo', () => {
    expect(avisoBizum(null)).toBe('Bizum: falta terminar el alta en Stripe.')
    expect(avisoBizum(c({ tarjeta: 'activo' }))).toBe('Bizum: falta terminar el alta en Stripe.')
    expect(avisoBizum(c({ bizum: 'revisando' }))).toBe('Bizum: Stripe está revisando tu alta.')
    expect(avisoBizum(c({ bizum: 'activo' }))).toBeNull()
  })
  it('sin palabras de técnico', () => {
    const todo = [textoMetodoPago('activo'), textoMetodoPago('falta_alta'), textoMetodoPago('revisando'), botonAltaStripe(null), botonAltaStripe(c({})), avisoBizum(null), avisoBizum(c({ bizum: 'revisando' }))].join(' ')
    expect(todo).not.toMatch(TECNICAS)
  })
})
