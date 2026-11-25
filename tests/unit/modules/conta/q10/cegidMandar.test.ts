// tests/unit/modules/conta/q10/cegidMandar.test.ts
//
// Q10 · respuesta 3 · Mandar a Cegid lo cobrado: solo lo confirmado; un cliente con conceptos fijos en Cegid no sale;
// una línea por cobro, agrupadas por cliente (y su serie, por concepto); nada dos veces; y la API solo escribe
// incidencias si se le pide, y solo crear y borrar. Datos inventados (T11); nunca contra el Cegid de QBO.

import { describe, expect, it } from 'vitest'
import { baseDelCobro, conceptoAprobado, cuerpoIncidencia, planMandar, type CobroParaMandar } from '../../../../../supabase/functions/_shared/cegidMandar'
import { ClienteDiezRec } from '../../../../../supabase/functions/_shared/diezRec'

const cobro = (o: Partial<CobroParaMandar> & { gcId: string }): CobroParaMandar => ({
  estado: 'confirmed', fecha: '2026-11-05', importe: 60.5, concepto: 'GESTION MENSUAL', partyId: 'p1', nombre: 'Cliente Uno SL', codigoCegid: 101, ...o,
})
const sinFijos = [{ codigo: 101, conceptos: [] }, { codigo: 102, conceptos: null }]

describe('Q10 · mandar · qué sale', () => {
  it('solo lo cobrado: los fallidos, devueltos y pendientes no salen, con su porqué', () => {
    const p = planMandar('2026-11', [
      cobro({ gcId: 'PM1' }), cobro({ gcId: 'PM2', estado: 'paid_out' }),
      cobro({ gcId: 'PM3', estado: 'failed' }), cobro({ gcId: 'PM4', estado: 'charged_back' }), cobro({ gcId: 'PM5', estado: 'pending_submission' }),
    ], sinFijos, new Set())
    expect(p.listos.map((x) => x.lineas.map((l) => l.gcId))).toEqual([['PM1', 'PM2']])
    expect(p.noSalen.map((x) => [x.gcId, x.porque])).toEqual([['PM3', 'no_cobrado'], ['PM4', 'no_cobrado'], ['PM5', 'no_cobrado']])
  })
  it('otro mes no entra', () => {
    expect(planMandar('2026-11', [cobro({ gcId: 'PM1', fecha: '2026-10-31' })], sinFijos, new Set()).listos).toEqual([])
  })
  it('sin ficha, sin código de Cegid o sin concepto aprobado (GESTORIA FISCAL, sin suscripción): no salen', () => {
    const p = planMandar('2026-11', [
      cobro({ gcId: 'A', partyId: null }), cobro({ gcId: 'B', codigoCegid: null }),
      cobro({ gcId: 'C', concepto: 'GESTORIA FISCAL MENSUAL' }), cobro({ gcId: 'D', concepto: null }),
    ], sinFijos, new Set())
    expect(p.listos).toEqual([])
    expect(p.noSalen.map((x) => x.porque)).toEqual(['sin_cliente', 'sin_codigo', 'sin_concepto', 'sin_concepto'])
  })
  it('un cliente con conceptos fijos en Cegid va a parados con todo lo suyo, y no se manda', () => {
    const p = planMandar('2026-11', [cobro({ gcId: 'A' }), cobro({ gcId: 'B', codigoCegid: 103, nombre: 'Cliente Tres SL' })],
      [...sinFijos, { codigo: 103, conceptos: [{ codigoConcepto: '00001', descripcion: 'GESTORIA MENSUAL', totalLinea: 60.5 }, { codigoConcepto: ' ', descripcion: null, totalLinea: null }] }], new Set())
    expect(p.listos.map((x) => x.codigo)).toEqual([101])
    expect(p.parados).toEqual([{ codigo: 103, nombre: 'Cliente Tres SL', conceptos: [{ codigo: '00001', descripcion: 'GESTORIA MENSUAL', total: 60.5 }], cobros: 1, totalCent: 6050 }])
    expect(p.frase).toBe('Listos para mandar: 1 cliente, 60,50 €. Parados por conceptos fijos en Cegid: 1.')
  })
  it('al volver a leer, el que ya está cortado sale de parados y pasa a listos', () => {
    const cobros = [cobro({ gcId: 'A', codigoCegid: 103 })]
    expect(planMandar('2026-11', cobros, [{ codigo: 103, conceptos: [{ codigoConcepto: '0008', descripcion: 'LABORAL', totalLinea: 30 }] }], new Set()).parados).toHaveLength(1)
    const p = planMandar('2026-11', cobros, [{ codigo: 103, conceptos: [] }], new Set())
    expect([p.parados.length, p.listos.length]).toEqual([0, 1])
  })
  it('nada dos veces: lo ya mandado no vuelve a salir', () => {
    const p = planMandar('2026-11', [cobro({ gcId: 'A' }), cobro({ gcId: 'B' })], sinFijos, new Set(['A']))
    expect(p.listos[0].lineas.map((l) => l.gcId)).toEqual(['B'])
    expect(p.yaMandados).toBe(1)
  })
})

describe('Q10 · mandar · una línea por cobro, con su concepto y su serie', () => {
  it('cada cobro, su línea; Contasimple en la serie 3, el resto en la 1', () => {
    const p = planMandar('2026-11', [
      cobro({ gcId: 'A', concepto: 'GESTION MENSUAL' }), cobro({ gcId: 'B', concepto: 'GESTION LABORAL TRABAJADOR UNO', importe: 30.25 }),
      cobro({ gcId: 'C', concepto: 'CONTASIMPLE SOFTWARE', importe: 12.1 }),
    ], sinFijos, new Set())
    expect(p.listos).toHaveLength(1)
    expect(p.listos[0].lineas.map((l) => [l.gcId, l.concepto.codigo, l.concepto.serie, l.baseCent])).toEqual([['A', '00001', '1', 5000], ['B', '0008', '1', 2500], ['C', '0016', '3', 1000]])
    expect(p.listos[0].totalCent).toBe(10285)
  })
  it('la tabla aprobada', () => {
    expect(['GESTION MENSUAL', 'GESTION LABORAL', 'CONTASIMPLE SOFTWARE', 'VIGILANCIA DE NOTIFICACIONES', 'OFICINA VIRTUAL MENSUAL'].map((n) => conceptoAprobado(n)?.codigo)).toEqual(['00001', '0008', '0016', '0021', '0034'])
    expect(conceptoAprobado('GESTORIA FISCAL MENSUAL')).toBeNull()
  })
  it('la base con el 21 % cuadra al céntimo, o no sale', () => {
    expect(baseDelCobro(6050)).toBe(5000)
    expect(baseDelCobro(3)).toBeNull() // 2 × 1,21 = 2,42 y 3 × 1,21 = 3,63: ninguna base da 0,03 €
  })
  it('el cuerpo de la incidencia: número 0 (lo pone Cegid), base sin IVA, sin retención, mes y año', () => {
    const p = planMandar('2026-11', [cobro({ gcId: 'A', concepto: 'GESTION LABORAL TRABAJADOR UNO', importe: 30.25 })], sinFijos, new Set())
    expect(cuerpoIncidencia(101, p.listos[0].lineas[0], '2026-11')).toMatchObject({
      cliente: 101, incidencia: 0, concepto: '0008', titulo: 'GESTION LABORAL TRABAJADOR UNO', importe: 25, porcentajeIva: 21, total: 30.25, llevaRetencion: false, estaFacturado: false, mes: 11, ano: 2026,
    })
  })
})

describe('Q10 · DiezREC · escribe solo incidencias, y solo si se le pide', () => {
  const claves = { client_id: 'id', client_secret: 's', username: 'u', password: 'p' }
  const red = () => {
    const llamadas: string[] = []
    const fetch = async (url: string, init: { method: string }) => {
      llamadas.push(`${init.method} ${url.replace('https://apirec.diezsoftware.com', '')}`)
      const login = url.endsWith('/api/Auth/login')
      return { status: 200, text: async () => (login ? JSON.stringify({ auth_token: 'tok' }) : init.method === 'DELETE' ? 'true' : JSON.stringify({ incidencia: 7 })) }
    }
    return { llamadas, fetch }
  }
  it('sin «escribe», crear no sale a la red', async () => {
    const n = red()
    await expect(new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch }).crearIncidencia({ cliente: 1 })).rejects.toThrow(/solo lee/)
    expect(n.llamadas.filter((x) => x.includes('Incidences'))).toEqual([])
  })
  it('con «escribe: incidencias», crea (Cegid numera) y borra', async () => {
    const n = red()
    const c = new ClienteDiezRec({ claves, empresa: '1', fetch: n.fetch, escribe: 'incidencias' })
    expect((await c.crearIncidencia({ cliente: 101, incidencia: 0 })).incidencia).toBe(7)
    expect(await c.borrarIncidencia(101, 7)).toBe(true)
    expect(n.llamadas).toEqual(['POST /api/Auth/login', 'POST /api/Incidences/incidence', 'DELETE /api/Incidences/delete/101/7'])
  })
})
