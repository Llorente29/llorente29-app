// tests/unit/modules/conta/q10/cegidMandar.test.ts
//
// Q10 · respuestas 3 y 4 · Mandar a Cegid lo cobrado:
//   · solo lo confirmado; una línea por cobro; nada dos veces; los conceptos fijos de Cegid no paran a nadie;
//   · dos vueltas (la incidencia no lleva serie): la 1, todo menos Contasimple; la 3, Contasimple, y solo con lo de la
//     vuelta 1 ya facturado en la serie 1;
//   · el cuadre cobro por cobro con las incidencias del mes que hay en Cegid (las de Sumied y las de cualquiera);
//   · la regla del NIF y las propuestas para atar una ficha sin código (por correo o por nombre);
//   · y la API solo escribe incidencias si se le pide, y solo crear y borrar.
// Datos inventados (T11): nombres de prueba, NIF de ceros o con su letra calculada; nunca contra el Cegid de QBO.

import { describe, expect, it } from 'vitest'
import {
  baseDelCobro, conceptoAprobado, cuadreCegid, cuerpoIncidencia, ganaNif, planMandar, proponerAtado, puertaContasimple, tipoNif,
  type CobroParaMandar, type IncidenciaCegid,
} from '../../../../../supabase/functions/_shared/cegidMandar'
import { ClienteDiezRec, rutaListado } from '../../../../../supabase/functions/_shared/diezRec'

const cobro = (o: Partial<CobroParaMandar> & { gcId: string }): CobroParaMandar => ({
  estado: 'confirmed', fecha: '2026-11-05', importe: 60.5, concepto: 'GESTION MENSUAL', partyId: 'p1', nombre: 'Cliente Uno SL', codigoCegid: 101, ...o,
})
const inc = (o: Partial<IncidenciaCegid> & { cliente: number; incidencia: number }): IncidenciaCegid => ({
  concepto: '00001', titulo: 'GESTION MENSUAL', texto: 'GESTION MENSUAL', importe: 50, total: 60.5, facturada: false, serieFactura: null, numeroFactura: null, ...o,
})

describe('Q10 · mandar · qué sale', () => {
  it('solo lo cobrado: los fallidos, devueltos y pendientes no salen, con su porqué', () => {
    const p = planMandar('2026-11', [
      cobro({ gcId: 'PM1' }), cobro({ gcId: 'PM2', estado: 'paid_out' }),
      cobro({ gcId: 'PM3', estado: 'failed' }), cobro({ gcId: 'PM4', estado: 'charged_back' }), cobro({ gcId: 'PM5', estado: 'pending_submission' }),
    ], new Set())
    expect(p.vueltas['1'].listos.map((x) => x.lineas.map((l) => l.gcId))).toEqual([['PM1', 'PM2']])
    expect(p.noSalen.map((x) => [x.gcId, x.porque])).toEqual([['PM3', 'no_cobrado'], ['PM4', 'no_cobrado'], ['PM5', 'no_cobrado']])
  })
  it('otro mes no entra', () => {
    expect(planMandar('2026-11', [cobro({ gcId: 'PM1', fecha: '2026-10-31' })], new Set()).vueltas['1'].listos).toEqual([])
  })
  it('sin ficha, sin código de Cegid o sin concepto aprobado: no salen', () => {
    const p = planMandar('2026-11', [
      cobro({ gcId: 'A', partyId: null }), cobro({ gcId: 'B', codigoCegid: null }),
      cobro({ gcId: 'C', concepto: 'TRAMITE INVENTADO' }), cobro({ gcId: 'D', concepto: null }),
    ], new Set())
    expect(p.vueltas['1'].listos).toEqual([])
    expect(p.noSalen.map((x) => x.porque)).toEqual(['sin_cliente', 'sin_codigo', 'sin_concepto', 'sin_concepto'])
  })
  it('nada dos veces: lo ya mandado no vuelve a salir', () => {
    const p = planMandar('2026-11', [cobro({ gcId: 'A' }), cobro({ gcId: 'B' })], new Set(['A']))
    expect(p.vueltas['1'].listos[0].lineas.map((l) => l.gcId)).toEqual(['B'])
    expect(p.yaMandados).toBe(1)
  })
})

describe('Q10 · mandar · dos vueltas, una por serie', () => {
  it('Contasimple va en la vuelta 3; el resto, en la 1; cada una con su línea', () => {
    const p = planMandar('2026-11', [
      cobro({ gcId: 'A', concepto: 'GESTION MENSUAL' }), cobro({ gcId: 'B', concepto: 'GESTION LABORAL TRABAJADOR UNO', importe: 30.25 }),
      cobro({ gcId: 'C', concepto: 'CONTASIMPLE SOFTWARE', importe: 12.1 }), cobro({ gcId: 'D', concepto: 'CONTASIMPLE SOFTWARE', importe: 12.1, codigoCegid: 102, partyId: 'p2', nombre: 'Cliente Dos SL' }),
    ], new Set())
    expect(p.vueltas['1'].listos.map((x) => [x.codigo, x.lineas.map((l) => [l.gcId, l.concepto.codigo, l.baseCent])])).toEqual([[101, [['A', '00001', 5000], ['B', '0008', 2500]]]])
    expect(p.vueltas['3'].listos.map((x) => [x.codigo, x.lineas.map((l) => l.gcId)])).toEqual([[101, ['C']], [102, ['D']]])
    expect(p.vueltas['1'].frase).toBe('Primero: 1 cliente, 90,75 € → factura con la serie 1')
    expect(p.vueltas['3'].frase).toBe('Después: Contasimple, 2 clientes, 24,20 € → factura con la serie 3')
  })
  it('la vuelta 3 se abre solo con todo lo de la serie 1 facturado en la serie 1', () => {
    expect(puertaContasimple([]).abierta).toBe(false)
    expect(puertaContasimple([{ estado: 'mandada', serie: '1', serieFactura: null }]).porque).toMatch(/1 línea de la serie 1 sin facturar/)
    expect(puertaContasimple([{ estado: 'facturada', serie: '1', serieFactura: '3' }]).porque).toMatch(/otra serie que la 1/)
    expect(puertaContasimple([{ estado: 'facturada', serie: '1', serieFactura: '1' }, { estado: 'deshecha', serie: '1', serieFactura: null }]).abierta).toBe(true)
  })
  it('la tabla aprobada (con la GESTORIA FISCAL al 00001, respuesta 4)', () => {
    expect(['GESTION MENSUAL', 'GESTION LABORAL', 'CONTASIMPLE SOFTWARE', 'VIGILANCIA DE NOTIFICACIONES', 'OFICINA VIRTUAL MENSUAL', 'GESTORIA FISCAL MENSUAL']
      .map((n) => conceptoAprobado(n)?.codigo)).toEqual(['00001', '0008', '0016', '0021', '0034', '00001'])
    expect(conceptoAprobado('TRAMITE INVENTADO')).toBeNull()
  })
  it('la base con el 21 % cuadra al céntimo, o no sale', () => {
    expect(baseDelCobro(6050)).toBe(5000)
    expect(baseDelCobro(3)).toBeNull() // 2 × 1,21 = 2,42 y 3 × 1,21 = 3,63: ninguna base da 0,03 €
  })
  it('el cuerpo de la incidencia: número 0 (lo pone Cegid), base sin IVA, sin retención, mes y año', () => {
    const p = planMandar('2026-11', [cobro({ gcId: 'A', concepto: 'GESTION LABORAL TRABAJADOR UNO', importe: 30.25 })], new Set())
    expect(cuerpoIncidencia(101, p.vueltas['1'].listos[0].lineas[0], '2026-11')).toMatchObject({
      cliente: 101, incidencia: 0, concepto: '0008', titulo: 'GESTION LABORAL TRABAJADOR UNO', importe: 25, porcentajeIva: 21, total: 30.25, llevaRetencion: false, estaFacturado: false, mes: 11, ano: 2026,
    })
  })
})

describe('Q10 · el cuadre con Cegid, cobro por cobro', () => {
  const nombres = new Map([[101, 'CLIENTE UNO SL'], [102, 'CLIENTE DOS SL']])
  it('lo mandado por Sumied casa por su número; lo de otro, por cliente e importe; todo cuadra', () => {
    const c = cuadreCegid('2026-11', [cobro({ gcId: 'A' }), cobro({ gcId: 'B', codigoCegid: 102, partyId: 'p2', concepto: 'CONTASIMPLE SOFTWARE', importe: 12.1 })],
      [inc({ cliente: 101, incidencia: 7 }), inc({ cliente: 102, incidencia: 1, concepto: '0016', importe: 10, total: 12.1 })],
      [{ gcCobroId: 'A', cliente: 101, incidencia: 7, estado: 'mandada' }], nombres)
    expect(c.cuadra).toBe(true)
    expect(c.frase).toBe('Cegid va a facturar 72,60 € en 2 clientes. GoCardless cobró 72,60 €. Cuadra cobro por cobro.')
    expect(c.porSerie).toEqual({ '1': { cent: 6050, clientes: 1, lineas: 1 }, '3': { cent: 1210, clientes: 1, lineas: 1 } })
    expect(c.filas.map((f) => [f.gcId, f.codigo, f.nombreCegid, f.cuadra])).toEqual([['A', 101, 'CLIENTE UNO SL', true], ['B', 102, 'CLIENTE DOS SL', true]])
  })
  it('lo que falta en Cegid, lo que sobra y lo que no casa: diferencias, con su porqué', () => {
    const c = cuadreCegid('2026-11', [cobro({ gcId: 'A' }), cobro({ gcId: 'B', importe: 121 }), cobro({ gcId: 'C', concepto: null }), cobro({ gcId: 'D', estado: 'failed' })],
      [inc({ cliente: 101, incidencia: 1, total: 121, concepto: '0008' }), inc({ cliente: 102, incidencia: 1 })], [], nombres)
    expect(c.cuadra).toBe(false)
    expect(c.filas.map((f) => [f.gcId, f.cuadra, f.porque])).toEqual([
      ['A', false, 'Cobrado y no está en Cegid: falta mandarlo.'],
      ['B', false, 'En Cegid va con el concepto 0008 y le toca el 00001.'],
      ['C', false, 'Cobrado y no está en Cegid: su concepto no está en la tabla aprobada.'],
      [null, false, 'Está en Cegid y no tiene cobro de GoCardless.'],
    ])
    expect(c.frase).toBe('Cegid va a facturar 181,50 € en 2 clientes. GoCardless cobró 242,00 €. No cuadra: 4 diferencias.')
  })
  it('una facturada cuenta en la serie de su factura', () => {
    const c = cuadreCegid('2026-11', [], [inc({ cliente: 101, incidencia: 1, concepto: '0016', facturada: true, serieFactura: '1' })], [], nombres)
    expect(c.porSerie['1'].cent).toBe(6050)
  })
})

describe('Q10 · atar una ficha a su cliente de Cegid', () => {
  it('el tipo de un NIF y su letra de control', () => {
    expect(tipoNif('00000000T')).toEqual({ nif: '00000000T', tipo: 'dni', valido: true })
    expect(tipoNif('00000000A')?.valido).toBe(false)
    expect(tipoNif('X0000000T')).toEqual({ nif: 'X0000000T', tipo: 'nie', valido: true })
    expect(tipoNif('B00000000')?.tipo).toBe('cif')
    expect(tipoNif(' ')).toBeNull()
  })
  it('la regla del NIF: la letra mala pierde; CIF > DNI > NIE; si falta, el del otro', () => {
    expect(ganaNif('00000000T', '00000000T')).toBe('iguales')
    expect(ganaNif(null, '00000000T')).toBe('cegid')
    expect(ganaNif('00000000T', null)).toBe('sumied')
    expect(ganaNif('00000000T', 'X0000000T')).toBe('sumied') // el DNI gana al NIE
    expect(ganaNif('00000000T', 'B00000000')).toBe('cegid') // el CIF gana al DNI
    expect(ganaNif('00000000A', 'X0000000T')).toBe('cegid') // la letra mala pierde (la errata 7 → Y)
    expect(ganaNif('00000000T', '00000001R')).toBe('mirar')
  })
  it('las propuestas: primero por correo, después por dos palabras del nombre', () => {
    const cl = [
      { codigo: 10, nombre: 'PRUEBA ROJAS, ANA', nif: null, email: null },
      { codigo: 11, nombre: 'OTRA PERSONA', nif: null, email: 'ana@ejemplo.test' },
      { codigo: 12, nombre: 'INMOBILIARIA DE PRUEBA SL', nif: null, email: null },
    ]
    expect(proponerAtado('ANA MARIA PRUEBA ROJAS', ['Ana@Ejemplo.test'], cl).map((x) => [x.codigo, x.por])).toEqual([[11, 'correo'], [10, 'nombre']])
    expect(proponerAtado('INMOBILIARIA PRUEBA S.L.', [], cl).map((x) => x.codigo)).toEqual([12])
    expect(proponerAtado('NADIE', [], cl)).toEqual([])
  })
})

describe('Q10 · DiezREC · las incidencias de un mes', () => {
  it('se piden por año y mes, de 200 en 200', () => {
    expect(decodeURIComponent(rutaListado('incidencias', 0, 2026, 11))).toBe('/api/Incidences?$filter=ano eq 2026 and mes eq 11&$orderby=cliente&$top=200&$skip=0')
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
