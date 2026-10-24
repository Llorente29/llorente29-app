// tests/conta/impuestos/justificanteCsv.test.ts
//
// I01c · P1 definitiva · El núcleo de conta-justificante-csv: el formato antes
// de llamar (cada fallo gasta un intento del día de la AEAT), UNA petición sin
// reintentos, y qué ha pasado en palabras de oficina. Con un «pedir» de mentira:
// ninguna llamada a Hacienda.

import { describe, expect, it, vi } from 'vitest'
import { clasificar, csvValido, enBase64, limpiarCsv, MENSAJES, traerPorCsv, type Respuesta } from '../../../supabase/functions/_shared/hacienda/justificanteCsv'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a])
const html = (t: string): Respuesta => ({ status: 200, tipo: 'text/html; charset=ISO-8859-1', cuerpo: new TextEncoder().encode(`<html><body>${t}</body></html>`) })

describe('antes de llamar: el formato', () => {
  it('un CSV que no tiene la forma NO se pregunta (no gasta un intento del día)', async () => {
    const pedir = vi.fn()
    for (const malo of ['', 'PRUEBA3T2025AAA', 'PRUEBA3T2025AAAA1', 'PRUEBA3T2025AA!A', null, 1234]) {
      expect(await traerPorCsv(malo, pedir)).toEqual({ ok: false, motivo: 'formato', mensaje: MENSAJES.formato })
    }
    expect(pedir).not.toHaveBeenCalled()
  })
  it('se limpia como lo pega una persona: espacios, guiones y minúsculas', async () => {
    const pedir = vi.fn(async () => ({ status: 200, tipo: 'application/pdf', cuerpo: PDF }))
    expect((await traerPorCsv(' prue ba3t-2025aaaa\n', pedir)).ok).toBe(true)
    expect(pedir).toHaveBeenCalledTimes(1)
    expect(pedir).toHaveBeenCalledWith('PRUEBA3T2025AAAA')
    expect([limpiarCsv(' ab-cd '), csvValido('PRUEBA3T2025AAAA'), csvValido('prueba3t2025aaaa')]).toEqual(['ABCD', true, false])
  })
})

describe('una petición, y qué ha pasado', () => {
  it('el PDF: se devuelve tal cual', async () => {
    const t = await traerPorCsv('PRUEBA3T2025AAAA', async () => ({ status: 200, tipo: 'application/pdf', cuerpo: PDF }))
    expect(t).toEqual({ ok: true, pdf: PDF })
  })
  it('la página de «no se ha podido recuperar ningún documento»: no está', () => {
    expect(clasificar(html('No se ha podido recuperar ningún documento con el CSV indicado'))).toMatchObject({ ok: false, motivo: 'no_encontrado' })
    expect(clasificar(html('Código Seguro de Verificación incorrecto'))).toMatchObject({ ok: false, motivo: 'no_encontrado' })
    expect(clasificar({ status: 404, tipo: 'text/html', cuerpo: new Uint8Array() })).toMatchObject({ motivo: 'no_encontrado' })
  })
  it('sin respuesta, un 5xx, una redirección o una página que no es el PDF: Hacienda no responde (no se adivina)', async () => {
    expect(clasificar(null).ok).toBe(false)
    for (const r of [{ status: 503, tipo: 'text/html', cuerpo: new Uint8Array() }, { status: 302, tipo: '', cuerpo: new Uint8Array() }, html('Mantenimiento programado'),
      { status: 200, tipo: 'application/pdf', cuerpo: new TextEncoder().encode('no soy un pdf') }]) {
      expect(clasificar(r)).toEqual({ ok: false, motivo: 'no_responde', mensaje: MENSAJES.no_responde })
    }
    // Si pedir lanza (red caída), tampoco se reintenta.
    const pedir = vi.fn(async () => { throw new Error('ECONNRESET') })
    expect(await traerPorCsv('PRUEBA3T2025AAAA', pedir)).toMatchObject({ motivo: 'no_responde' })
    expect(pedir).toHaveBeenCalledTimes(1)
  })
  it('los mensajes dicen que no se ha guardado nada', () => {
    expect(Object.values(MENSAJES).every((m) => /No se ha (guardado nada|preguntado a Hacienda)/.test(m))).toBe(true)
  })
})

describe('el PDF en base64', () => {
  it('ida y vuelta, también uno grande', () => {
    const grande = new Uint8Array(300_000).map((_, i) => i % 256)
    const vuelta = Uint8Array.from(atob(enBase64(grande)), (c) => c.charCodeAt(0))
    expect(vuelta).toEqual(grande)
  })
})
