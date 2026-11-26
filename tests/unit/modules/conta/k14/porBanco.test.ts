// tests/unit/modules/conta/k14/porBanco.test.ts
//
// K14 · Lo cobrado por el banco, casado solo con su cliente (_shared/cobro/porBanco.ts). Los conceptos tienen la forma de
// los del extracto de DiezBank de QBO; los nombres, NIF, IBAN y recibos son inventados (T11). El ensayo con el extracto
// real se hace en solo lectura y no entra en el repositorio.

import { describe, expect, it } from 'vitest'
import {
  aplicar, casarExtracto, lineaPagado, ordenanteYTexto, quienEs, viaDe,
  type ClienteBanco, type EntradaBanco, type ReciboSinCobrar,
} from '../../../../../supabase/functions/_shared/cobro/porBanco'
import { MOTOR_COBROS, aDatos, aFilas, casarCobrosDelBanco, fraseCobros } from '../../../../../supabase/functions/_shared/cobro/porBancoBd'

const CLIENTES: ClienteBanco[] = [
  { partyId: 'p-nif', nombre: 'ZOILO INVENTADO PRUEBAS', nif: '00000000T', nombresGc: [], ibans: [] },
  { partyId: 'p-iban', nombre: 'Cliente Con Cuenta Inventada', nif: null, nombresGc: [], ibans: ['ES00 9999 0000 0000 0000 0001'] },
  { partyId: 'p-persona', nombre: 'FICTICIA ARALIA QUIMERA PRUEBAS', nif: null, nombresGc: ['Aralia Quimera'], ibans: [] },
  { partyId: 'p-empresa', nombre: 'TALLERES INVENTADOS DEL NORTE SL (PERSONA DE CONTACTO)', nif: null, nombresGc: [], ibans: [] },
  { partyId: 'p-una', nombre: 'ZARZAMORIX, SOCIEDAD LIMITADA', nif: null, nombresGc: [], ibans: [] },
  { partyId: 'p-gonzalez1', nombre: 'MARIA GONZALEZ RUIZ', nif: null, nombresGc: [], ibans: [] },
  { partyId: 'p-gonzalez2', nombre: 'ANA GONZALEZ PEREZ', nif: null, nombresGc: [], ibans: [] },
  { partyId: 'p-cortado', nombre: 'NOMBRELARGO APELLIDOUNO APELLIDODOS', nif: null, nombresGc: [], ibans: [] },
  // La empresa y la persona que la paga por GoCardless, con el mismo nombre (pasa en el extracto real).
  { partyId: 'p-tienda-ficha', nombre: 'TIENDA INVENTADA DE PRUEBAS SL', nif: null, nombresGc: [], ibans: [] },
  { partyId: 'p-tienda-gc', nombre: 'Persona Titular Inventada', nif: null, nombresGc: ['TIENDA INVENTADA DE PRUEBAS SL'], ibans: [] },
]

const ent = (id: string, fecha: string, euros: number, concepto: string): EntradaBanco => ({ id, fecha, importeCent: Math.round(euros * 100), concepto })
const rec = (gcId: string, partyId: string, fecha: string, euros: number): ReciboSinCobrar => ({ gcId, partyId, fecha, importeCent: Math.round(euros * 100) })
const inmediata = (quien: string, texto: string) => `TRANSFER INMEDIATA, ${quien}, ${quien}, 000001020261104, ${quien} INVEXXXX, ${texto}`

describe('K14 · la vía y quién paga, del concepto', () => {
  it('cada forma del extracto, su vía', () => {
    expect(viaDe('TRANSFER INMEDIATA, A, A, 1')).toBe('transferencia')
    expect(viaDe('TRANSF. A SU FAVOR, 00000000-A, A')).toBe('transferencia')
    expect(viaDe('TRASPASO, , Pago de octubre')).toBe('traspaso')
    expect(viaDe('WEB340941087 1911, Comercia Global Payments')).toBe('tarjeta')
    expect(viaDe('TRANSF. A SU FAVOR, 00000000-GOCARDLESS LTD, GOCARDLESS')).toBe('gocardless')
    expect(viaDe('INGRESO CAJERO, cuota')).toBe('cajero')
  })

  it('el que paga sin el prefijo del banco; el texto sin referencias ni BIC', () => {
    expect(ordenanteYTexto('TRANSF. A SU FAVOR, 00000000-APELLIDOUNO NOMBRE, 00000000-APELLIDOUNO NOMBRE, 020261109004972, 00000000-APELLIDOUNO NOMBRE ORIGEN: 00000000, Abono de Mes'))
      .toEqual({ ordenante: 'APELLIDOUNO NOMBRE', texto: 'Abono de Mes' })
    expect(ordenanteYTexto(inmediata('Uno Inventado', 'Cuota noviembre')).texto).toBe('Cuota noviembre')
  })
})

describe('K14 · de qué cliente es', () => {
  it('por el NIF del concepto', () => {
    const q = quienEs(ent('1', '2026-11-04', 84.7, 'TRANSFER INMEDIATA, Otro Nombre, Otro Nombre, 1, Pago 00000000T noviembre'), CLIENTES)
    expect(q).toEqual({ estado: 'casado', partyId: 'p-nif', porque: 'NIF 00000000T en el concepto' })
  })

  it('por el NIF pegado a una referencia', () => {
    expect(quienEs(ent('1', '2026-11-04', 10, 'DEH NOTIFICACION., 00000000T001, 00000000T001'), CLIENTES).partyId).toBe('p-nif')
  })

  it('por el IBAN del cliente', () => {
    const q = quienEs(ent('1', '2026-11-04', 50, 'TRANSFER INMEDIATA, Quien Sea, Quien Sea, 1, ES00 9999 0000 0000 0000 0001'), CLIENTES)
    expect(q.estado).toBe('casado')
    expect(q.partyId).toBe('p-iban')
    expect(q.porque).toBe('IBAN ····0001 del cliente')
  })

  it('por el nombre de una persona, en otro orden y con el nombre que tiene en GoCardless', () => {
    expect(quienEs(ent('1', '2026-11-04', 50, inmediata('QUIMERA PRUEBAS FICTICIA ARALIA', 'Mes')), CLIENTES)).toMatchObject({ estado: 'casado', partyId: 'p-persona' })
    expect(quienEs(ent('2', '2026-11-04', 50, inmediata('Aralia Quimera', 'Mes')), CLIENTES)).toMatchObject({ estado: 'casado', partyId: 'p-persona' })
  })

  it('por el nombre de una empresa, sin «S.L.» ni el contacto de la ficha', () => {
    expect(quienEs(ent('1', '2026-11-04', 50, inmediata('Talleres Inventados del Norte S.L.', 'Fra 12')), CLIENTES)).toMatchObject({ estado: 'casado', partyId: 'p-empresa' })
    // Una empresa de una sola palabra: el nombre exacto de la ficha basta.
    expect(quienEs(ent('2', '2026-11-04', 50, inmediata('ZARZAMORIX S.L.', 'Fra 13')), CLIENTES)).toMatchObject({ estado: 'casado', partyId: 'p-una' })
  })

  it('el nombre que el banco corta a medias', () => {
    const c = 'TRANSF. A SU FAVOR, 00000000-APELLIDOUNO APELLIDODOS NOMBREL, 00000000-APELLIDOUNO APELLIDODOS NOMBREL, 1, Abono'
    expect(quienEs(ent('1', '2026-11-10', 84.7, c), CLIENTES)).toMatchObject({ estado: 'casado', partyId: 'p-cortado' })
  })

  it('el cliente entero dentro del texto libre', () => {
    const q = quienEs(ent('1', '2026-11-20', 30, 'TRASPASO, , Mes de noviembre Talleres Inventados del Norte SL'), CLIENTES)
    expect(q).toMatchObject({ estado: 'casado', partyId: 'p-empresa' })
  })

  it('un apellido común no casa solo: va a «Por confirmar» con su propuesta', () => {
    const q = quienEs(ent('1', '2026-11-04', 50, inmediata('GONZALEZ', 'Cuota')), CLIENTES)
    expect(q.estado).toBe('por_confirmar')
    expect(q.partyId).not.toBeNull()
    expect(q.porque).toContain('no basta')
    // Dos palabras muy comunes tampoco.
    expect(quienEs(ent('2', '2026-11-04', 50, inmediata('MARIA GONZALEZ', 'Cuota')), CLIENTES).estado).toBe('por_confirmar')
  })

  it('el mismo nombre en dos fichas: casa con la que tiene un recibo sin cobrar de ese importe; si no, por confirmar', () => {
    const e = ent('1', '2026-11-20', 62.5, inmediata('Tienda Inventada de Pruebas Sl.', 'Mes'))
    expect(quienEs(e, CLIENTES).estado).toBe('por_confirmar')
    const pend = new Map([['p-tienda-gc', [rec('PM-T1', 'p-tienda-gc', '2026-11-04', 60.5)]]])
    expect(quienEs(e, CLIENTES, pend)).toMatchObject({ estado: 'casado', partyId: 'p-tienda-gc' })
  })

  it('nadie con ese nombre: sin cliente, y lo dice', () => {
    expect(quienEs(ent('1', '2026-11-04', 50, inmediata('Desconocida Total SL', 'x')), CLIENTES)).toEqual({ estado: 'sin_cliente', partyId: null, porque: 'Ningún cliente se llama «Desconocida Total SL»' })
  })
})

describe('K14 · a qué recibos de GoCardless paga', () => {
  it('el recargo de 2 €: paga el recibo y apunta el recargo', () => {
    expect(aplicar(7460, '2026-11-19', [rec('PM-1', 'p', '2026-11-04', 72.6)])).toEqual({ recibos: [{ gcId: 'PM-1', importeCent: 7260 }], recargoCent: 200, cobroCent: 0 })
  })

  it('un pago que cubre dos recibos, del más antiguo al más nuevo; lo que sobra, cobro', () => {
    const a = aplicar(30000, '2026-11-12', [rec('PM-NUEVO', 'p', '2026-11-04', 96.8), rec('PM-VIEJO', 'p', '2026-10-05', 193.6)])
    expect(a.recibos.map((r) => r.gcId)).toEqual(['PM-VIEJO', 'PM-NUEVO'])
    expect(a.recargoCent).toBe(400)
    expect(a.cobroCent).toBe(30000 - 19360 - 9680 - 400)
  })

  it('un recibo que no cabe entero se salta; uno posterior a la entrada no se paga', () => {
    const a = aplicar(6250, '2026-11-20', [rec('PM-GRANDE', 'p', '2026-06-15', 242), rec('PM-OK', 'p', '2026-10-05', 60.5), rec('PM-FUTURO', 'p', '2026-12-04', 60.5)])
    expect(a.recibos.map((r) => r.gcId)).toEqual(['PM-OK'])
    expect(a.recargoCent).toBe(200)
  })

  it('sin recibos, la entrada entera es cobro del mes', () => {
    expect(aplicar(12100, '2026-11-04', [])).toEqual({ recibos: [], recargoCent: 0, cobroCent: 12100 })
  })
})

describe('K14 · el extracto entero', () => {
  const entradas = [
    ent('a', '2026-11-19', 74.6, inmediata('Aralia Quimera', 'Recibo noviembre')),
    ent('b', '2026-11-20', 74.6, inmediata('Aralia Quimera', 'Otra vez')),
    ent('c', '2026-11-19', 1234.56, 'WEB340941087 1911, Comercia Global Payments'),
    ent('d', '2026-11-06', 19506.48, 'TRANSF. A SU FAVOR, 00000000-GOCARDLESS LTD, GOCARDLESS'),
    ent('e', '2026-11-21', -50, inmediata('Aralia Quimera', 'Salida')),
    ent('f', '2026-11-22', 30, inmediata('GONZALEZ', 'Cuota')),
  ]
  const recibos = [rec('PM-AQ', 'p-persona', '2026-11-04', 72.6)]
  const r = casarExtracto(entradas, CLIENTES, recibos)

  it('el TPV no se reparte: un total del día, «tarjeta», sin cliente', () => {
    expect(r.find((x) => x.entradaId === 'c')).toMatchObject({ estado: 'tarjeta', partyId: null, recibos: [], cobroCent: 0, importeCent: 123456 })
  })

  it('el abono de GoCardless no se casa (sus cobros ya están en Sumied); las salidas no se miran', () => {
    expect(r.find((x) => x.entradaId === 'd')?.estado).toBe('gocardless')
    expect(r.find((x) => x.entradaId === 'e')).toBeUndefined()
  })

  it('un recibo lo paga una sola entrada: la segunda es cobro del mes', () => {
    expect(r.find((x) => x.entradaId === 'a')).toMatchObject({ estado: 'casado', recibos: [{ gcId: 'PM-AQ', importeCent: 7260 }], recargoCent: 200, cobroCent: 0, mes: '2026-11' })
    expect(r.find((x) => x.entradaId === 'b')).toMatchObject({ estado: 'casado', recibos: [], recargoCent: 0, cobroCent: 7460 })
  })

  it('lo por confirmar lleva su propuesta y no gasta recibos', () => {
    expect(r.find((x) => x.entradaId === 'f')).toMatchObject({ estado: 'por_confirmar', recibos: [], cobroCent: 0 })
  })

  it('el mismo extracto dos veces da lo mismo, entrada por entrada (y la base no lo apunta dos veces: una fila por movimiento)', () => {
    expect(casarExtracto(entradas, CLIENTES, recibos)).toEqual(r)
    expect(casarExtracto([...entradas].reverse(), CLIENTES, recibos)).toEqual(r)
  })

  it('la línea del recibo pagado por el banco', () => {
    expect(lineaPagado('transferencia', '2026-11-19', 7460)).toBe('Pagado por transferencia el 19/11 · 74,60 €')
    expect(lineaPagado('bizum', '2026-11-03', 123456)).toBe('Pagado por Bizum el 03/11 · 1.234,56 €')
  })
})

describe('K14 · contra la base (porBancoBd.ts)', () => {
  const datos = {
    aplica: true,
    entradas: [
      { id: 'm1', fecha: '2026-11-19', importe: 74.6, concepto: inmediata('Aralia Quimera', 'Recibo') },
      { id: 'm2', fecha: '2026-11-06', importe: 500, concepto: 'TRANSF. A SU FAVOR, 00000000-GOCARDLESS LTD, GOCARDLESS' },
      { id: 'm3', fecha: '2026-11-22', importe: 30, concepto: inmediata('GONZALEZ', 'Cuota') },
    ],
    clientes: [{ party_id: 'p-persona', nombre: 'FICTICIA ARALIA QUIMERA PRUEBAS', nif: null, nombres_gc: ['Aralia Quimera'] },
      { party_id: 'p-gonzalez1', nombre: 'MARIA GONZALEZ RUIZ', nif: null, nombres_gc: [] }],
    recibos: [{ gc_id: 'PM-AQ', party_id: 'p-persona', fecha: '2026-11-04', importe: 72.6 }],
    decisiones: [{ movement_id: 'm3', party_id: 'p-gonzalez1', ninguno: false }],
  }

  it('lee, casa (con lo que decidió una persona) y guarda; el abono de GoCardless no va', async () => {
    const llamadas: { nombre: string; args: Record<string, unknown> }[] = []
    const rpc = async <T,>(nombre: string, args: Record<string, unknown>): Promise<T> => {
      llamadas.push({ nombre, args })
      return (nombre === 'conta_banco_cobros_datos' ? datos
        : { guardadas: 2, casados: 2, casados_importe: 104.6, por_confirmar: 0, por_confirmar_importe: 0, tarjeta: 0, tarjeta_importe: 0, recibos: 1 }) as T
    }
    const r = await casarCobrosDelBanco(rpc, 'emp')
    const filas = llamadas[1].args.p_filas as Record<string, unknown>[]
    expect(llamadas[1].args.p_motor).toBe(MOTOR_COBROS)
    expect(filas.map((f) => f.movement_id)).toEqual(['m1', 'm3'])
    expect(filas[0]).toMatchObject({ estado: 'casado', party_id: 'p-persona', importe: 74.6, recargo: 2, cobro: 0, recibos: [{ gc_id: 'PM-AQ', importe: 72.6 }] })
    expect(filas[1]).toMatchObject({ estado: 'casado', party_id: 'p-gonzalez1', porque: 'Lo confirmó una persona', cobro: 30 })
    expect(fraseCobros(r!)).toBe('Cobros de clientes por el banco: 2 casados solos (104,60 €) · 0 por confirmar (0,00 €) · tarjeta sin asignar 0,00 €.')
  })

  it('una empresa sin GoCardless: no casa nada ni guarda', async () => {
    const nombres: string[] = []
    const rpc = async <T,>(nombre: string): Promise<T> => { nombres.push(nombre); return { aplica: false } as T }
    expect(await casarCobrosDelBanco(rpc, 'emp')).toBeNull()
    expect(nombres).toEqual(['conta_banco_cobros_datos'])
  })

  it('«No es de ningún cliente»: no_es_cobro', () => {
    const d = aDatos({ ...datos, decisiones: [{ movement_id: 'm3', party_id: null, ninguno: true }] })
    const r = casarExtracto(d.entradas, d.clientes, d.recibos, d.decisiones)
    expect(r.find((x) => x.entradaId === 'm3')).toMatchObject({ estado: 'no_es_cobro', partyId: null })
    expect(aFilas(r).map((f) => f.estado)).toEqual(['casado', 'no_es_cobro'])
  })
})
