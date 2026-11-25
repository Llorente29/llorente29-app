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
import { urlQr } from '@/modules/conta/lib/verifactu/qr'
import {
  CODIGOS_NIF, CODIGOS_TIPO_VENTA, OBLIGA_VERIFACTU, avisoOtrosProgramas, cifrasHacienda, textoConexion, textoEnvioPruebas, etiquetaHacienda, lineaDeTiempo, obligaDesde, porQueEnviando, porQueRechazo,
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
  it('V05 · desde el 6 de octubre de 2028 para todos (Real Decreto-ley 43/2026)', () => {
    // V05: el Real Decreto-ley 43/2026 lo aplaza; un solo dato para todas las pantallas.
    expect(obligaDesde('B28000016')).toMatchObject({ quien: 'sociedad', desde: '2028-10-06', texto: '6 de octubre de 2028' })
    expect(obligaDesde('12345678Z')).toMatchObject({ quien: 'persona', desde: '2028-10-06', texto: '6 de octubre de 2028' })
    expect(OBLIGA_VERIFACTU).toMatchObject({ desde: '2028-10-06', norma: 'Real Decreto-ley 43/2026' })
  })
  it('Excel no cumple; otro programa, que lo compruebe; solo Sumied, nada que avisar', () => {
    expect(avisoOtrosProgramas(['tpv', 'excel'])).toMatchObject({ tono: 'falta' })
    expect(avisoOtrosProgramas(['tienda'])).toMatchObject({ tono: 'duda' })
    expect(avisoOtrosProgramas([])).toBeNull()
  })
})

describe('V05 · la prueba de conexión dice de quién es la culpa', () => {
  const c = (o: Partial<{ ok: boolean; codigo: number | null; mensaje: string | null }>) => ({ ok: false, codigo: null, mensaje: null, probada_at: '2026-11-26T09:00:00Z', ...o })
  it('bien, del certificado, de Hacienda o de Sumied', () => {
    expect(textoConexion(c({ ok: true, mensaje: 'respuesta_de_consulta · HTTP 200' }))).toMatchObject({ tono: 'ok', culpa: 'nadie' })
    expect(textoConexion(c({ mensaje: 'http_403 · HTTP 403' }))).toMatchObject({ tono: 'falta', culpa: 'certificado' })
    expect(textoConexion(c({ mensaje: 'fault · HTTP 500 · Codigo[4102] El XML no cumple el esquema', codigo: 4102 })).texto).toContain('4102: «Codigo[4102] El XML no cumple el esquema»')
    expect(textoConexion(c({ mensaje: 'llamada_tiempo' }))).toMatchObject({ culpa: 'sumied' })
    expect(textoConexion(c({ mensaje: 'llamada_destino' })).texto).toMatch(/^Tu certificado está bien; la conexión de Sumied con Hacienda/)
    expect(textoConexion(null)).toMatchObject({ culpa: 'sumied' })
    expect(textoConexion(null).texto).toContain('tu certificado no se ha usado')
  })
})

describe('V05b · «Enviar a Hacienda» dice cuántas y, si alguna se rechaza, su código y su texto', () => {
  const r = (o: Partial<{ total: number; pendientes: number; correctas: number; con_errores: number; rechazadas: number }>, rechazo: { num_serie: string; codigo: number | null; texto: string | null } | null = null, fallo: { error: string } | null = null) =>
    ({ total: 25, pendientes: 0, correctas: 0, con_errores: 0, rechazadas: 0, ultimo_rechazo: rechazo, ultimo_fallo: fallo, ...o })
  it('todas aceptadas, con alguna rechazada, sin respuesta y sin nada pendiente', () => {
    expect(textoEnvioPruebas({ antes: { pendientes: 25 }, despues: r({ correctas: 25 }), termino: true }))
      .toEqual({ tono: 'ok', texto: 'Enviadas al entorno de pruebas de Hacienda: 25 aceptadas, 0 con errores y 0 rechazadas.' })
    expect(textoEnvioPruebas({ antes: { pendientes: 25 }, despues: r({ correctas: 23, con_errores: 1, rechazadas: 1 }, { num_serie: 'PR-07', codigo: 1100, texto: 'Valor incorrecto' }), termino: true }))
      .toEqual({ tono: 'falta', texto: 'Enviadas al entorno de pruebas de Hacienda: 23 aceptadas, 1 con errores y 1 rechazadas. La última rechazada, PR-07: 1100 · Valor incorrecto.' })
    const sin = textoEnvioPruebas({ antes: { pendientes: 25 }, despues: r({ pendientes: 25 }), termino: false })
    expect(sin.tono).toBe('duda')
    expect(sin.texto).toContain('no es cosa de tu certificado')
    expect(textoEnvioPruebas({ antes: { pendientes: 25 }, despues: r({ pendientes: 25 }, null, { error: 'cerrada' }), termino: false }).texto).toContain('Último fallo: cerrada')
    expect(textoEnvioPruebas({ antes: { pendientes: 0 }, despues: r({ correctas: 25 }), termino: true }).texto).toMatch(/^No había nada pendiente de enviar/)
  })
  it('el QR de la e2e es la dirección del cotejo de pruebas', () => {
    expect(urlQr({ nif: 'B12345682', numSerie: 'PR2611260900-01', fecha: '26-11-2026', importe: '121.00' }, 'pruebas'))
      .toBe('https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR?nif=B12345682&numserie=PR2611260900-01&fecha=26-11-2026&importe=121.00')
  })
})
