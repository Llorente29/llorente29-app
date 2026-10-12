// La analítica de Diez ↔ Folvy (Julio, 12/10): JDH frenado en el cliente; BAR
// es Carabanchel al leer y nunca se envía (Carabanchel va con CAM).

import { afterEach, describe, expect, it } from 'vitest'
import { ClienteDiez, FrenoDiez, gruposEn, subgruposEn, type FacturaData } from '../../../supabase/functions/_shared/diezCliente'
import {
  CORRESPONDENCIA_LLORENTE29 as C, analiticaParaEnviar, localAlLeer, marcaAlLeer, revisarCorrespondencia, type Correspondencia,
} from '../../../supabase/functions/_shared/diezAnalitica'
import { arrancarDiezFalso } from '../../../scripts/conta/diez/falso.mjs'

let falso: Awaited<ReturnType<typeof arrancarDiezFalso>> | null = null
afterEach(async () => { await falso?.cerrar(); falso = null })

const factura = (grupo: string): FacturaData => ({
  Ejercicio: '2026', Serie: '2', TipoAsiento: 2, CuentaCliente: '40000001', FechaFactura: 20261012, NumeroFactura: `P-${grupo}`,
  BaseImponible1: 1, PorcentajeIVA1: 10, CuotaIVA1: 0.1, TotalFactura: 1.1,
  Analitica: [{ Subcuenta: '60000000', Grupo: grupo, Subgrupo: '3', Nivel3: 'GLV', ImporteDebe: 1, ImporteHaber: 0 }],
})
const cliente = async () => {
  falso = await arrancarDiezFalso({ bases: { C0009: {} } })
  let g: { token: string; expiresAt: string } | null = null
  return new ClienteDiez({
    base: falso.url, nombreBd: 'C0009', credenciales: falso.credenciales, escribir: true,
    almacen: { leer: async () => g, guardar: async (token, expiresAt) => { g = { token, expiresAt } }, caida: async () => { g = null } },
  })
}

describe('freno JDH en el cliente', () => {
  it.each(['JDH', 'jdh', ' JDH '])('una factura con Grupo %j no sale, ni una petición de escritura', async (grupo) => {
    const c = await cliente()
    await expect(c.enviarFactura(factura(grupo))).rejects.toThrow(FrenoDiez)
    expect(falso!.estado.peticiones.filter((p) => p.ruta.endsWith('/add'))).toHaveLength(0)
    expect(falso!.estado.bases.C0009.facturas).toHaveLength(0)
  })

  it('aunque JDH vaya en la segunda fila de la analítica', async () => {
    const c = await cliente()
    const f = factura('CAM')
    f.Analitica = [...(f.Analitica as object[]), { Subcuenta: '60000000', Grupo: 'JDH', ImporteDebe: 0.5 }]
    await expect(c.enviarFactura(f)).rejects.toThrow(/JDH/)
  })

  it('BAR no está frenado en el cliente (Julio: no hay freno para BAR), y CAM tampoco', async () => {
    const c = await cliente()
    await expect(c.enviarFactura(factura('CAM'))).resolves.toMatchObject({ Documento: 1 })
    await expect(c.enviarFactura(factura('BAR'))).resolves.toMatchObject({ Documento: 2 })
  })

  it('gruposEn encuentra el Grupo a cualquier profundidad', () => {
    expect(gruposEn({ a: [{ Grupo: 'x' }, { b: { grupo: ' y ' } }], Grupo: 3 })).toEqual(['X', 'Y', '3'])
    expect(gruposEn({ Subgrupo: 'JDH', GrupoGastos: 'JDH' })).toEqual([])
  })
})

describe('correspondencia de Llorente29', () => {
  it('pasa su propia revisión', () => {
    expect(revisarCorrespondencia(C)).toEqual([])
  })

  it('al enviar: Carabanchel → CAM (nunca BAR), Alcalá → FLO, Plaza Castilla → CAN', () => {
    expect(analiticaParaEnviar({ local: 'Foodint Carabanchel' }, C).analitica.Grupo).toBe('CAM')
    expect(analiticaParaEnviar({ local: 'Foodint Alcalá' }, C).analitica.Grupo).toBe('FLO')
    expect(analiticaParaEnviar({ local: 'Foodint Plaza Castilla' }, C).analitica.Grupo).toBe('CAN')
    // Ningún local de Folvy se envía con BAR ni con JDH.
    expect(Object.values(C.localAlEnviar)).not.toContain('BAR')
    expect(Object.values(C.localAlEnviar)).not.toContain('JDH')
  })

  it('al leer: CAM y BAR → Carabanchel, FLO → Alcalá, CAN → Plaza Castilla, JDH fuera con su porqué', () => {
    expect(localAlLeer('CAM', C)).toEqual({ local: 'Foodint Carabanchel' })
    expect(localAlLeer('bar', C)).toEqual({ local: 'Foodint Carabanchel' })
    expect(localAlLeer('FLO', C)).toEqual({ local: 'Foodint Alcalá' })
    expect(localAlLeer('CAN', C)).toEqual({ local: 'Foodint Plaza Castilla' })
    expect(localAlLeer('JDH', C)).toEqual({ sinLocal: 'JDH: José del Hierro: no es un local abierto y no tiene ventas' })
    expect(localAlLeer('XYZ', C)).toEqual({ sinLocal: 'XYZ: grupo sin correspondencia' })
    expect(localAlLeer(null, C)).toEqual({ sinLocal: 'sin analítica' })
  })

  it('lo que no tiene correspondencia se envía sin esa dimensión y se dice por qué', () => {
    const r = analiticaParaEnviar({ local: 'Foodint Alcalá', marca: 'Marca Nueva', canal: 'Glovo' }, C)
    expect(r.analitica).toEqual({ Grupo: 'FLO', Nivel3: 'GLV' })
    expect(r.sinPoner).toEqual(['marca «Marca Nueva»: sin subgrupo en Diez'])
    expect(analiticaParaEnviar({ local: 'Foodint Nuevo' }, C).sinPoner).toEqual(['local «Foodint Nuevo»: sin grupo en Diez'])
  })

  it('una tabla que enviase Carabanchel con BAR o con JDH no pasa la revisión, y el envío no los lleva igualmente', () => {
    const conBar: Correspondencia = { ...C, localAlEnviar: { ...C.localAlEnviar, 'Foodint Carabanchel': 'BAR' } }
    expect(revisarCorrespondencia(conBar)).toEqual(['Foodint Carabanchel se enviaría con BAR, que solo vale al leer: Carabanchel se envía siempre con CAM (Camichi 4), nunca con BAR'])
    expect(analiticaParaEnviar({ local: 'Foodint Carabanchel' }, conBar)).toEqual({ analitica: {}, sinPoner: ['local «Foodint Carabanchel»: su grupo BAR no se envía'] })
    const conJdh: Correspondencia = { ...C, localAlEnviar: { ...C.localAlEnviar, 'Foodint Carabanchel': 'JDH' } }
    expect(revisarCorrespondencia(conJdh)).toEqual(expect.arrayContaining(['Foodint Carabanchel se enviaría con JDH, que está vetado']))
    expect(analiticaParaEnviar({ local: 'Foodint Carabanchel' }, conJdh)).toEqual({ analitica: {}, sinPoner: ['local «Foodint Carabanchel»: su grupo JDH no se envía'] })
  })
})

// Tabla de marcas confirmada por Julio (12/10). Las marcas, con sus nombres
// REALES de Folvy (producción, cuenta de Foodint, leídos el 12/10).
const MARCAS_FOLVY = [
  'Ay Mamita Bowls', 'Bendito Burrito', 'Big Mike´s Burger Joint', 'Birria Burrito', 'Chivuos', 'Deep Pizza', 'Dirty Burger',
  'Dos Coyotes', 'Koreans do it better - Fried Chicken', 'Lobbers', 'Lovers Burgers', 'Meraki Pita', "Mila's Sandwiches",
  'Milanesa Haus', 'Milanesa House', 'Scandal Burgers', 'Smash Brothers Burgers', 'The Urban Kebab',
]

describe('marcas (subgrupos de Diez)', () => {
  it('cada marca real de Folvy tiene subgrupo o un porqué para ir sin él: ninguna se queda sin decidir', () => {
    for (const m of MARCAS_FOLVY) expect(m in C.marcaAlEnviar || m in C.marcasSinSubgrupo, m).toBe(true)
  })

  it.each([
    ['Milanesa House', '1'], ['Meraki Pita', '2'], ['Scandal Burgers', '3'], ['Smash Brothers Burgers', '4'],
    ["Mila's Sandwiches", '5'], ['Bendito Burrito', '6'], ['The Urban Kebab', '7'], ['Dirty Burger', '8'], ['Lovers Burgers', '11'],
  ])('al enviar: %s → %s', (marca, sg) => {
    expect(analiticaParaEnviar({ local: 'Foodint Alcalá', marca }, C)).toEqual({ analitica: { Grupo: 'FLO', Subgrupo: sg }, sinPoner: [] })
  })

  it('las cedidas, y Lobbers, van sin marca y dicen por qué', () => {
    expect(analiticaParaEnviar({ local: 'Foodint Carabanchel', marca: 'Milanesa Haus' }, C)).toEqual({
      analitica: { Grupo: 'CAM' }, sinPoner: ['marca «Milanesa Haus»: sin marca en Diez (marca cedida: va por la liquidación con el socio)'],
    })
    expect(analiticaParaEnviar({ local: 'Foodint Carabanchel', marca: 'Lobbers' }, C).sinPoner).toEqual(['marca «Lobbers»: sin marca en Diez (ya no existe y no se usa)'])
  })

  it.each([
    ['1', { marca: 'Milanesa House' }], ['3', { marca: 'Scandal Burgers' }],
    ['9', { marca: 'Lovers Burgers' }], ['11', { marca: 'Lovers Burgers' }], ['09', { marca: 'Lovers Burgers' }],
    ['10', { nombreDiez: 'Vooger' }], ['12', { nombreDiez: 'NKD Burger' }],
    ['13', { sinMarca: 'subgrupo 13 sin correspondencia' }], ['', { sinMarca: 'sin analítica' }],
  ] as [string, unknown][])('al leer: subgrupo %j', (sg, esperado) => {
    expect(marcaAlLeer(sg, C)).toEqual(esperado)
  })

  it('Lovers Burgers nunca se envía con el 9: la revisión lo para y el envío no lo pone', () => {
    const con9: Correspondencia = { ...C, marcaAlEnviar: { ...C.marcaAlEnviar, 'Lovers Burgers': '9' } }
    expect(revisarCorrespondencia(con9)).toEqual(expect.arrayContaining(['Lovers Burgers se enviaría con el subgrupo 9, que está vetado']))
    expect(analiticaParaEnviar({ local: 'Foodint Alcalá', marca: 'Lovers Burgers' }, con9)).toEqual({
      analitica: { Grupo: 'FLO' }, sinPoner: ['marca «Lovers Burgers»: su subgrupo 9 no se envía'],
    })
  })
})

describe('freno del subgrupo 9 en el cliente', () => {
  it.each(['9', '09', ' 9 ', 9])('una factura con Subgrupo %j no sale, ni una petición de escritura', async (sg) => {
    const c = await cliente()
    const f = factura('FLO')
    f.Analitica = [{ Subcuenta: '60000000', Grupo: 'FLO', Subgrupo: sg, Nivel3: 'GLV', ImporteDebe: 1 }]
    await expect(c.enviarFactura(f)).rejects.toThrow(/subgrupo 9/)
    expect(falso!.estado.peticiones.filter((p) => p.ruta.endsWith('/add'))).toHaveLength(0)
  })

  it('el 11 y el resto sí salen', async () => {
    const c = await cliente()
    const f = factura('FLO')
    f.Analitica = [{ Subcuenta: '60000000', Grupo: 'FLO', Subgrupo: '11', Nivel3: 'GLV', ImporteDebe: 1 }]
    await expect(c.enviarFactura(f)).resolves.toMatchObject({ Documento: 1 })
  })

  it('subgruposEn quita los ceros de delante y no confunde otros campos', () => {
    expect(subgruposEn({ Analitica: [{ Subgrupo: '09' }, { subgrupo: 11 }], Grupo: '9' })).toEqual(['9', '11'])
  })
})
