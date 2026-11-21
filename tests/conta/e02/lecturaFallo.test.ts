// tests/conta/e02/lecturaFallo.test.ts
//
// E02 · La clasificación de un fallo de lectura (supabase/functions/_shared/lecturaFallo.ts).
//
// Los cuerpos de error son los del proveedor de la lectura con el formato que
// publica ({"type":"error","error":{"type":…,"message":…}}) y los mensajes que
// devuelve para cada caso. **El del tope de gasto NO es el del 17/11**: no lo
// tengo (se saca de los registros de producción del 17/11, 18:17–18:19 UTC).
// Van los dos mensajes que el proveedor usa para eso (el saldo y el límite de
// gasto); si el del 17/11 es otro, se añade aquí y la expresión se ajusta.
// Las respuestas buenas, cortadas y con frase delante tienen la forma de una
// respuesta real del modelo (content, stop_reason, usage).

import { describe, expect, it } from 'vitest'
import {
  falloDeContenido, falloDeExcepcion, falloDeLlamada, falloDeRespuesta, fraseDe, MAX_TROZO, paraGuardar, trozos,
  FRASE_CAIDA, FRASE_DOCUMENTO,
} from '../../../supabase/functions/_shared/lecturaFallo'
import { extractJson } from '../../../supabase/functions/_shared/ocrAlbaranNucleo'

const error = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } })
const respuesta = (texto: string, stop_reason = 'end_turn', usage = { input_tokens: 7111, output_tokens: 1505 }) => ({
  id: 'msg_000000000000000000000000', type: 'message', role: 'assistant', model: 'modelo-de-prueba',
  content: [{ type: 'text', text: texto }], stop_reason, stop_sequence: null, usage,
})
const lecturaBuena = JSON.stringify({ document: { type: 'factura', number: 'F-0001', date: '2026-11-17', total: 121 }, lines: [] })

describe('falloDeRespuesta: el proveedor contesta con un código que no es 2xx', () => {
  it('el tope de gasto (saldo agotado, 400) es una caída «tope_gasto»', () => {
    const f = falloDeRespuesta(400, error('invalid_request_error', 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'))
    expect([f.clase, f.causa, f.http]).toEqual(['caida', 'tope_gasto', 400])
  })
  it('el tope de gasto (límite de uso, 400) también', () => {
    const f = falloDeRespuesta(400, error('invalid_request_error', 'You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'))
    expect([f.clase, f.causa]).toEqual(['caida', 'tope_gasto'])
  })
  it('el tope de gasto gana aunque venga con 429 o 403', () => {
    expect(falloDeRespuesta(429, error('rate_limit_error', 'You have reached your specified API usage limits.')).causa).toBe('tope_gasto')
    expect(falloDeRespuesta(403, error('permission_error', 'Your credit balance is too low.')).causa).toBe('tope_gasto')
  })
  it('401 y 403 son la clave', () => {
    expect(falloDeRespuesta(401, error('authentication_error', 'invalid x-api-key'))).toMatchObject({ clase: 'caida', causa: 'clave' })
    expect(falloDeRespuesta(403, error('permission_error', 'Your API key does not have permission to use the specified resource.'))).toMatchObject({ clase: 'caida', causa: 'clave' })
  })
  it('un 429 es «limite»', () => {
    const f = falloDeRespuesta(429, error('rate_limit_error', 'This request would exceed the rate limit for your organization of 50,000 input tokens per minute.'))
    expect([f.clase, f.causa]).toEqual(['caida', 'limite'])
  })
  it('un 529 y un 500 son el proveedor', () => {
    expect(falloDeRespuesta(529, error('overloaded_error', 'Overloaded'))).toMatchObject({ clase: 'caida', causa: 'proveedor', http: 529 })
    expect(falloDeRespuesta(500, error('api_error', 'Internal server error'))).toMatchObject({ clase: 'caida', causa: 'proveedor', http: 500 })
    expect(falloDeRespuesta(503, '<html>Service Unavailable</html>')).toMatchObject({ clase: 'caida', causa: 'proveedor' })
  })
  it('un 504 o un 408 es tiempo', () => {
    expect(falloDeRespuesta(504, 'upstream request timeout').causa).toBe('tiempo')
    expect(falloDeRespuesta(408, '').causa).toBe('tiempo')
  })
  it('otro 4xx (el PDF no vale, demasiado grande) es de este documento', () => {
    expect(falloDeRespuesta(400, error('invalid_request_error', 'The PDF specified was not valid.'))).toMatchObject({ clase: 'documento', causa: 'fichero' })
    expect(falloDeRespuesta(413, error('request_too_large', 'Request exceeds the maximum allowed number of bytes.'))).toMatchObject({ clase: 'documento', causa: 'fichero' })
  })
  it('guarda el mensaje del proveedor, no el JSON entero', () => {
    expect(falloDeRespuesta(529, error('overloaded_error', 'Overloaded')).inicio).toBe('overloaded_error: Overloaded')
  })
})

describe('falloDeExcepcion: no llega respuesta', () => {
  it('un tiempo agotado o la red es una caída «tiempo», sin código', () => {
    const e = new DOMException('The signal has been aborted', 'TimeoutError')
    expect(falloDeExcepcion(e)).toMatchObject({ clase: 'caida', causa: 'tiempo', http: null })
    expect(falloDeExcepcion(new TypeError('error sending request for url: connection reset')).inicio).toContain('connection reset')
  })
})

describe('falloDeContenido: contesta 2xx pero no vale como lectura', () => {
  it('una lectura buena no es un fallo', () => {
    const raw = respuesta(lecturaBuena)
    expect(falloDeContenido(raw, extractJson(lecturaBuena))).toBeNull()
  })
  it('solo con las marcas ```json delante se lee igual (no es un fallo)', () => {
    const texto = `\`\`\`json\n${lecturaBuena}\n\`\`\``
    expect(falloDeContenido(respuesta(texto), extractJson(texto))).toBeNull()
  })
  it('un texto con FRASE delante no se lee hoy: es «no_json» y el principio guardado enseña la frase', () => {
    // Hallazgo del E02: extractJson solo quita las marcas ```, no lo que va antes del JSON.
    // Arreglarlo es el camino bueno de la lectura: no entra aquí; queda apuntado.
    const texto = `Aquí tienes la factura en JSON:\n\`\`\`json\n${lecturaBuena}\n\`\`\``
    const f = falloDeContenido(respuesta(texto), extractJson(texto))
    expect(f).toMatchObject({ clase: 'documento', causa: 'no_json', stop_reason: 'end_turn' })
    expect(f?.inicio).toMatch(/^Aquí tienes la factura/)
  })
  it('un JSON cortado por el tope de salida es «cortada», con su uso', () => {
    const texto = lecturaBuena.slice(0, 60)
    const f = falloDeContenido(respuesta(texto, 'max_tokens', { input_tokens: 7300, output_tokens: 8192 }), extractJson(texto))
    expect(f).toMatchObject({ clase: 'documento', causa: 'cortada', stop_reason: 'max_tokens', usage: { output_tokens: 8192 } })
  })
  it('cortada gana aunque lo cortado se pudiera leer', () => {
    expect(falloDeContenido(respuesta(lecturaBuena, 'max_tokens'), extractJson(lecturaBuena))?.causa).toBe('cortada')
  })
  it('sin JSON es «no_json»; un JSON sin documento, «sin_minimo»; un rechazo, «rechazo»', () => {
    expect(falloDeContenido(respuesta('No puedo leer este documento.'), null)?.causa).toBe('no_json')
    expect(falloDeContenido(respuesta('{"lines": []}'), { lines: [] } as never)?.causa).toBe('sin_minimo')
    expect(falloDeContenido(respuesta('', 'refusal'), null)?.causa).toBe('rechazo')
  })
})

describe('falloDeLlamada: quien llama a la lectura', () => {
  it('usa la clase que trae la respuesta', () => {
    expect(falloDeLlamada(502, { error: 'Error del servicio de IA', clase: 'caida', causa: 'tope_gasto' })).toEqual({ clase: 'caida', causa: 'tope_gasto' })
    expect(falloDeLlamada(422, { error: 'x', clase: 'documento', causa: 'cortada' })).toEqual({ clase: 'documento', causa: 'cortada' })
  })
  it('no se fía de una clase y una causa que no casan', () => {
    expect(falloDeLlamada(422, { clase: 'documento', causa: 'tope_gasto' })).toEqual({ clase: 'documento', causa: 'no_json' })
  })
  it('sin respuesta, la plataforma cortando (546, 504) o un 5xx sin clase: caída', () => {
    expect(falloDeLlamada(null, null).clase).toBe('caida')
    expect(falloDeLlamada(546, {}).clase).toBe('caida')
    expect(falloDeLlamada(504, 'no es json').clase).toBe('caida')
  })
  it('un 4xx sin clase es de este documento', () => {
    expect(falloDeLlamada(400, { error: 'file_paths requerido' }).clase).toBe('documento')
  })
})

describe('lo que se guarda y lo que se dice', () => {
  it('el principio y el final, cada uno de MAX_TROZO, sin la mitad', () => {
    const largo = 'a'.repeat(MAX_TROZO) + 'MITAD'.repeat(200) + 'z'.repeat(MAX_TROZO)
    const t = trozos(largo)
    expect(t.inicio).toBe('a'.repeat(MAX_TROZO))
    expect(t.fin).toBe('z'.repeat(MAX_TROZO))
    expect(`${t.inicio}${t.fin}`).not.toContain('MITAD')
    expect(trozos('corto')).toEqual({ inicio: 'corto', fin: null })
  })
  it('paraGuardar solo lleva clase, causa, código, parada, uso y los trozos', () => {
    const g = paraGuardar(falloDeContenido(respuesta('{"a":', 'max_tokens', { input_tokens: 1, output_tokens: 8192 }), null)!)
    expect(Object.keys(g).sort()).toEqual(['causa', 'clase', 'fin', 'http', 'inicio', 'stop_reason', 'usage'])
    expect(g.usage).toEqual({ input_tokens: 1, output_tokens: 8192 })
  })
  it('las frases no dicen «IA», ni «servicio», ni «cuota», ni «albarán»', () => {
    for (const f of [FRASE_CAIDA, FRASE_DOCUMENTO]) expect(f).not.toMatch(/\bIA\b|servicio|cuota|albar|edge|non-2xx/i)
    expect(fraseDe('caida')).toBe(FRASE_CAIDA)
    expect(fraseDe('documento')).toBe(FRASE_DOCUMENTO)
    expect(fraseDe(null)).toBe(FRASE_DOCUMENTO)
  })
})
