// tests/unit/modules/conta/v03/estado.test.ts
//
// V03 · E2 · Lo que se ve de Verifactu, sin pintar (tableros 25, 26 y 27).
// Regla 31: los códigos se atan a su texto en la lista OFICIAL
// (docs/conta/v03/aeat/errores.properties), no a lo que creemos que dicen (en
// la E1, el 1237 existía y significaba otra cosa). Los estados y las horas son
// los de la prueba de staging de la 0146/0218 (una N2 a Suiza, rechazada con el
// 1195 y reenviada).

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CODIGOS_NIF, CODIGOS_TIPO_VENTA, avisoOtrosProgramas, cifrasHacienda, etiquetaHacienda, lineaDeTiempo, obligaDesde, porQueEnviando, porQueRechazo,
  type EstadoFactura,
} from '@/modules/conta/lib/verifactu/estado'

const OFICIAL = new Map(readFileSync('docs/conta/v03/aeat/errores.properties', 'latin1').split('\n')
  .map((l) => /^(\d{4}) ?= ?(.*)$/.exec(l.trim())).filter((m): m is RegExpExecArray => !!m).map((m) => [Number(m[1]), m[2]]))

const E = (o: Partial<EstadoFactura>): EstadoFactura => ({
  invoiceId: 'f', estado: 'correcto', entorno: 'pruebas', codigo: null, descripcion: null, generado: null, respondido: null, intentos: 0, proximoIntento: null, urlQr: null, ...o,
})

describe('los códigos dicen lo que la pantalla dice', () => {
  it('el del tipo de venta habla de OperacionExenta o CalificacionOperacion', () => {
    for (const c of CODIGOS_TIPO_VENTA) expect(OFICIAL.get(c), String(c)).toMatch(/OperacionExenta o CalificacionOperacion/)
  })
  it('los de NIF hablan de un NIF, un ID o los destinatarios', () => {
    for (const c of CODIGOS_NIF) expect(OFICIAL.get(c), String(c)).toMatch(/NIF|\bID\b|Destinatarios/)
  })
  it('el 3000 es el duplicado', () => {
    expect(OFICIAL.get(3000)).toMatch(/duplicado/)
    expect(porQueRechazo(3000, null).titulo).toBe('Hacienda ya la tenía')
  })
  it('el 1195 es el del tablero 27 y se arregla aquí; uno que no conocemos dice lo que dijo Hacienda', () => {
    expect(porQueRechazo(1195, 'x')).toMatchObject({ titulo: 'Falta decir qué tipo de venta es', tipoVenta: true })
    expect(porQueRechazo(1999, 'Algo raro')).toMatchObject({ titulo: 'Hacienda no la ha aceptado', texto: 'Dice: «Algo raro».', tipoVenta: false })
  })
})

describe('la columna «Hacienda» (tablero 26)', () => {
  it('cada estado con su texto', () => {
    expect(etiquetaHacienda(E({ estado: 'correcto' }))).toMatchObject({ texto: '✓ Recibida', chip: false })
    expect(etiquetaHacienda(E({ estado: 'aceptado_con_errores' }))).toMatchObject({ texto: 'Recibida con un aviso', tono: 'duda' })
    expect(etiquetaHacienda(E({ estado: 'incorrecto', codigo: 1195 }))).toMatchObject({ texto: 'Rechazada · falta un dato', tono: 'falta' })
    expect(etiquetaHacienda(E({ estado: 'incorrecto', codigo: 3000 }))).toMatchObject({ texto: 'Rechazada' })
    expect(etiquetaHacienda(E({ estado: 'pendiente' })).texto).toBe('Enviando…')
    expect(etiquetaHacienda(E({ estado: 'no_se_envia' })).texto).toBe('No se envía')
    expect(etiquetaHacienda(null).texto).toBe('—')
  })
  it('«Enviando…» explica que Hacienda pide esperar, o que no hay conexión y se reenvía sola', () => {
    const ahora = new Date('2026-10-26T10:00:00Z')
    expect(porQueEnviando(E({ intentos: 0 }), ahora)).toContain('Hacienda pide esperar')
    expect(porQueEnviando(E({ intentos: 2, proximoIntento: '2026-10-26T10:04:00Z' }), ahora)).toBe('sin conexión con Hacienda: se reenvía sola en 4 min')
  })
  it('las cuatro cifras suman las emitidas del mes (regla 7: ninguna se esconde)', () => {
    const fs = [{ id: 'a', total: 100 }, { id: 'b', total: 50.5 }, { id: 'c', total: 2150 }, { id: 'd', total: 10 }]
    const es = new Map([['a', E({ estado: 'correcto' })], ['b', E({ estado: 'aceptado_con_errores' })], ['c', E({ estado: 'incorrecto', codigo: 1195 })], ['d', E({ estado: 'pendiente' })]])
    const c = cifrasHacienda(fs, es, new Date('2026-10-26T10:00:00Z'))
    expect(c).toMatchObject({ emitidas: { n: 4, total: 2310.5 }, laTiene: 2, mirar: 1, enviando: { n: 1 } })
    expect(c.laTiene + c.mirar + c.enviando.n).toBe(c.emitidas.n)
  })
})

describe('«Cómo va con Hacienda» (tablero 27)', () => {
  it('emitida, enviada, rechazada y el reenvío pendiente de ti', () => {
    const p = lineaDeTiempo('2026-10-24T16:01:00Z', [
      { id: 'r1', tipo: 'alta', subsanacion: false, estado: 'incorrecto', generado: '2026-10-24T16:01:05Z', enviado: '2026-10-24T16:01:30Z', respondido: '2026-10-24T16:02:00Z', codigo: 1195, descripcion: null },
    ])
    expect(p.map((x) => [x.texto, x.tono])).toEqual([
      ['Emitida y comprobada por Sumied', 'ok'], ['Enviada a Hacienda', 'ok'], ['Rechazada: falta decir qué tipo de venta es', 'falta'], ['Reenvío', 'espera'],
    ])
    expect(p.at(-1)?.cuando).toBeNull()
  })
  it('reenviada: la subsanación espera su turno y ya no hay nada pendiente de ti', () => {
    const p = lineaDeTiempo('2026-10-24T16:01:00Z', [
      { id: 'r1', tipo: 'alta', subsanacion: false, estado: 'incorrecto', generado: '2026-10-24T16:01:05Z', enviado: null, respondido: '2026-10-24T16:02:00Z', codigo: 1195, descripcion: null },
      { id: 'r2', tipo: 'alta', subsanacion: true, estado: 'pendiente', generado: '2026-10-25T09:00:00Z', enviado: null, respondido: null, codigo: null, descripcion: null },
    ])
    expect(p.map((x) => x.texto)).toEqual(['Emitida y comprobada por Sumied', 'Enviada a Hacienda', 'Rechazada: falta decir qué tipo de venta es', 'Reenvío: esperando su turno'])
  })
})

describe('el alta (tablero 25)', () => {
  it('una sociedad, desde el 1 de enero de 2027; un autónomo, desde el 1 de julio', () => {
    expect(obligaDesde('B28000016')).toMatchObject({ quien: 'sociedad', texto: '1 de enero de 2027' })
    expect(obligaDesde('12345678Z')).toMatchObject({ quien: 'persona', texto: '1 de julio de 2027' })
  })
  it('Excel no cumple; otro programa, que lo compruebe; solo Sumied, nada que avisar', () => {
    expect(avisoOtrosProgramas(['tpv', 'excel'])).toMatchObject({ tono: 'falta' })
    expect(avisoOtrosProgramas(['tienda'])).toMatchObject({ tono: 'duda' })
    expect(avisoOtrosProgramas([])).toBeNull()
  })
})
