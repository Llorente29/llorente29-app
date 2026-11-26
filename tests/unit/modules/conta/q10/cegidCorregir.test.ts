// tests/unit/modules/conta/q10/cegidCorregir.test.ts
//
// Q10 · respuesta 6 (26/11) · Las incidencias como las quiere Cegid para facturar, sacado de la 9/2 que corrigió Julio
// a mano (run 45901138694): la descripción en RTF (textoIncidencia), el tipo de IVA de Cegid (ivaConcepto «1» con el
// 21 %) y el total igual a la base. Y la guarda de las cuotas fijas sin «Facturar hasta».
//   · El RTF de referencia es el de la 9/2, copiado tal cual de la API: solo lleva «GESTORIA MENSUAL».
//   · Las incidencias de las pruebas son como la 33/2 sin corregir (la misma forma que devuelve la API), con clientes de
//     prueba; nada sale a Cegid.

import { describe, expect, it } from 'vitest'
import {
  corregirIncidencia, cuadreCegid, cuotasSinHasta, faltaTrasCorregir, FRASE_CUOTA_SIN_HASTA, planMandar, textoRtf, tipoIvaCegid, totalIncidenciaCent,
  type CobroParaMandar,
} from '../../../../../supabase/functions/_shared/cegidMandar'
import { ClienteDiezRec } from '../../../../../supabase/functions/_shared/diezRec'

// La 9/2, tal cual la devolvió GetIncidence después de que Julio la corrigiera.
const RTF_9_2 = '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Verdana;}}\r\n{\\colortbl ;\\red0\\green0\\blue0;}\r\n\\viewkind4\\uc1\\pard\\cf1\\lang3082\\f0\\fs18 GESTORIA MENSUAL\\par\r\n\\par\r\n}\r\n\u0000'
const corregida = { cliente: 9, incidencia: 2, concepto: '00001', titulo: 'GESTORIA MENSUAL', importe: 70, ivaConcepto: '1', porcentajeIva: 21, textoConcepto: 'GESTORIA MENSUAL',
  unidades: 1, llevaRetencion: false, esSuplido: false, estaFacturado: false, fecha: 0, mes: 11, ano: 2026, numeroFactura: null, total: 70, serieFactura: '', anoFactura: null,
  textoIncidencia: RTF_9_2, incluyeIva: false }
const sinCorregir = { ...corregida, cliente: 900033, ivaConcepto: null, fecha: null, total: 84.7, serieFactura: null, textoIncidencia: null }

describe('Q10 · respuesta 6 · la descripción en RTF, como la 9/2', () => {
  it('con «GESTORIA MENSUAL» sale el RTF de la 9/2, byte a byte (con su nulo del final)', () => {
    expect(textoRtf('GESTORIA MENSUAL')).toBe(RTF_9_2)
    expect(textoRtf('  GESTORIA   MENSUAL ')).toBe(RTF_9_2)
  })
  it('las tildes, la ñ y el euro, en la página 1252; las llaves y la barra, escapadas; solo cambia el texto', () => {
    const r = textoRtf('GESTIÓN LABORAL AÑO {1} \\ 5€')
    expect(r).toContain("\\fs18 GESTI\\'d3N LABORAL A\\'d1O \\{1\\} \\\\ 5\\'80\\par")
    expect(r.replace(/\\fs18 .*?\\par/, '\\fs18 X\\par')).toBe(RTF_9_2.replace('GESTORIA MENSUAL', 'X'))
  })
})

describe('Q10 · respuesta 6 · el tipo de IVA de Cegid, por su porcentaje', () => {
  it('el 21 % es el «1» (I.V.A. GENERAL); con otro, ninguno: no se inventa', () => {
    expect([21, '21', 10, 4, 0, null, undefined].map(tipoIvaCegid)).toEqual(['1', '1', null, null, null, null, null])
  })
})

describe('Q10 · respuesta 6 · corregir una incidencia ya mandada (PUT)', () => {
  it('la 33/2 sin corregir: la misma, con la descripción, el tipo 1 y el total igual a la base; fecha y serie, como estaban', () => {
    const c = corregirIncidencia(sinCorregir, 70)
    expect(c.que).toBe('corregir')
    if (c.que !== 'corregir') return
    expect(c.cuerpo).toEqual({ ...sinCorregir, ivaConcepto: '1', total: 70, textoIncidencia: RTF_9_2 })
    expect(c.cuerpo.fecha).toBeNull()
    expect(c.cuerpo.serieFactura).toBeNull()
  })
  it('la 9/2, ya corregida por Julio: no se toca', () => {
    expect(corregirIncidencia(corregida, 70)).toEqual({ que: 'ya_bien' })
  })
  it('para, con su porqué: facturada, otro IVA, base distinta de la mandada, sin texto, IVA incluido', () => {
    const porque = (x: Record<string, unknown>, base = 70) => { const c = corregirIncidencia(x, base); return c.que === 'parar' ? c.porque : c.que }
    expect(porque({ ...sinCorregir, estaFacturado: true })).toBe('La 900033/2 ya está facturada en Cegid: no se toca.')
    expect(porque({ ...sinCorregir, porcentajeIva: 10 })).toBe('La 900033/2 lleva el 10 % de IVA y no se sabe su tipo de IVA en Cegid: la API no da la tabla. Dime su código.')
    expect(porque(sinCorregir, 80)).toBe('La 900033/2 tiene en Cegid una base de 70,00 € y Sumied mandó 80,00 €: míralo antes.')
    expect(porque({ ...sinCorregir, textoConcepto: null, titulo: null })).toBe('La 900033/2 no tiene texto en Cegid para la descripción.')
    expect(porque({ ...sinCorregir, incluyeIva: true })).toBe('La 900033/2 dice que su importe incluye el IVA: no se sabe corregir.')
  })
  it('después del PUT, se mira lo leído otra vez: los tres campos, o qué falta', () => {
    expect(faltaTrasCorregir(corregida, { tipoIva: '1', baseCent: 7000 })).toBeNull()
    expect(faltaTrasCorregir(sinCorregir, { tipoIva: '1', baseCent: 7000 })).toBe('Cegid no ha guardado la descripción, el tipo de IVA, el total igual a la base')
  })
})

describe('Q10 · respuesta 6 · el cuadre, con el total igual a la base', () => {
  const cobro = (o: Partial<CobroParaMandar> & { gcId: string }): CobroParaMandar => ({
    estado: 'paid_out', fecha: '2026-11-05', importe: 84.7, concepto: 'GESTORIA MENSUAL', partyId: 'p1', nombre: 'Cliente de Prueba SL', codigoCegid: 900033, ...o,
  })
  const inc = (importe: number | null, total: number | null) => ({ cliente: 900033, incidencia: 2, concepto: '00001', titulo: null, texto: null, importe, total, facturada: false, serieFactura: null, numeroFactura: null })
  it('una incidencia de 70 (corregida o no) es lo que cobró GoCardless: 84,70', () => {
    expect(totalIncidenciaCent(inc(70, 70))).toBe(8470)
    expect(totalIncidenciaCent(inc(70, 84.7))).toBe(8470)
    expect(totalIncidenciaCent(inc(null, 84.7))).toBe(8470)
    expect(cuadreCegid('2026-11', [cobro({ gcId: 'A' })], [inc(70, 70)], [{ gcCobroId: 'A', cliente: 900033, incidencia: 2, estado: 'mandada' }], new Map()).cuadra).toBe(true)
  })
})

describe('Q10 · respuesta 6 · la guarda: cuota fija en Cegid sin «Facturar hasta»', () => {
  const clientes = [{ codigo: 900001, conceptos: [{ codigoConcepto: '00001' }] }, { codigo: 900002, conceptos: [{ codigoConcepto: '00001' }] }, { codigo: 900003, conceptos: [] },
    { codigo: 900004, conceptos: null }]
  it('con cuotas fijas y sin estar entre los revisados: solo esos', () => {
    expect([...cuotasSinHasta(clientes, [900001])]).toEqual([900002])
  })
  it('a ellos no se les manda nada, con la frase; a los revisados y a los que no tienen cuotas, sí', () => {
    const c = (gcId: string, codigoCegid: number): CobroParaMandar => ({ gcId, estado: 'paid_out', fecha: '2026-11-05', importe: 84.7, concepto: 'GESTORIA MENSUAL', partyId: gcId, nombre: gcId, codigoCegid })
    const p = planMandar('2026-11', [c('A', 900001), c('B', 900002), c('C', 900003)], new Set(), cuotasSinHasta(clientes, [900001]))
    expect(p.vueltas['1'].listos.map((x) => x.codigo)).toEqual([900001, 900003])
    expect(p.noSalen.map((x) => [x.gcId, x.porque, x.frase])).toEqual([['B', 'cuota_sin_hasta', 'Cliente nuevo con cuota fija en Cegid: ponle el Facturar hasta.']])
    expect(FRASE_CUOTA_SIN_HASTA).toBe('Cliente nuevo con cuota fija en Cegid: ponle el Facturar hasta.')
  })
})

describe('Q10 · respuesta 6 · DiezREC: cambiar incidencias, y nada de clientes', () => {
  const claves = { client_id: 'id', client_secret: 's', username: 'u', password: 'p' }
  const red = () => {
    const llamadas: string[] = []
    const fetch = async (url: string, init: { method: string }) => {
      llamadas.push(`${init.method} ${url.replace('https://apirec.diezsoftware.com', '')}`)
      return { status: 200, text: async () => (url.endsWith('/api/Auth/login') ? JSON.stringify({ auth_token: 'tok' }) : JSON.stringify({ cliente: 900033, incidencia: 2 })) }
    }
    return { llamadas, fetch }
  }
  it('sin «escribe», el PUT no sale a la red', async () => {
    const n = red()
    await expect(new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch }).modificarIncidencia({ cliente: 900033, incidencia: 2 })).rejects.toThrow(/solo lee/)
    expect(n.llamadas.filter((x) => x.includes('Incidences'))).toEqual([])
  })
  it('con «escribe: incidencias», cambia una incidencia por PUT; sin su número, no', async () => {
    const n = red()
    const c = new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch, escribe: 'incidencias' })
    expect(await c.modificarIncidencia({ cliente: 900033, incidencia: 2 })).toEqual({ cliente: 900033, incidencia: 2 })
    await expect(c.modificarIncidencia({ cliente: 900033, incidencia: 0 })).rejects.toThrow(/su cliente y su número/)
    expect(n.llamadas).toEqual(['POST /api/Auth/login', 'PUT /api/Incidences/incidence'])
  })
  it('Sumied no da de alta ni cambia clientes en Cegid: ninguno sale con cuotas fijas', async () => {
    const n = red()
    const c = new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch, escribe: 'incidencias' }) as unknown as { llamar(m: string, r: string, b?: unknown): Promise<unknown> }
    for (const m of ['POST', 'PUT']) await expect(c.llamar(m, '/api/Customers/customer', {})).rejects.toThrow(/solo escribe incidencias/)
    expect(n.llamadas).toEqual([])
  })
})
