// G01b · El mapa confirmado (Julio, 07/11): sin confirmar no se guarda la
// situación de nadie; lo que no encaja queda «Sin clasificar» con su texto;
// la dirección sale de un solo campo, el primero con algo, y las demás se
// guardan de referencia; solo «activo» espera cobro. Códigos y datos inventados (T11).
import { describe, expect, it } from 'vitest'
import { leerEmpresa, proponerMapa, textoDeDireccion, type MapaBitrix } from '../../../../../supabase/functions/conta-bitrix-leer/mapa'
import { SE_COBRA, casar } from '../../../../../supabase/functions/conta-gocardless-leer/casado'

const CONFIRMADO = { quien: 'persona-de-prueba', cuando: '2026-11-07T10:00:00Z' }

const MAPA: MapaBitrix = {
  nombre: 'Gestoría de prueba',
  campos: [
    { codigo: 'TITLE', campo: 'nombre' },
    { codigo: 'UF_CRM_S', campo: 'situacion',
      opciones: { '1': 'activo', '2': 'baja', '3': 'baja', '4': 'sin_clasificar', '5': 'moroso', '6': 'sin_clasificar', '7': 'solo_renta' },
      textos: { '1': 'ACTIVO', '2': 'BAJA DE AUTONOMO', '3': 'BAJA DE GESTORIA', '4': 'GRAVE DESAPARECIDO', '5': 'MOROSO', '6': 'Vzla Activo', '7': 'CLIENTE SOLO RENTA' } },
    // Los de antes, que con fuentes de dirección ya no se usan.
    { codigo: 'UF_CRM_CP_SUELTO', campo: 'cp' },
    { codigo: 'UF_CRM_POB_SUELTA', campo: 'poblacion' },
  ],
  formaPagoAEmisor: {},
  direcciones: [
    { etiqueta: 'Dirección Fiscal', calle: 'UF_CRM_FISCAL' },
    { etiqueta: 'Dirección Social', calle: 'UF_CRM_SOCIAL' },
    { etiqueta: 'Dirección', calle: 'ADDRESS', cp: 'ADDRESS_POSTAL_CODE', poblacion: 'ADDRESS_CITY', provincia: 'ADDRESS_PROVINCE' },
    { etiqueta: 'Calle, casa núm.', calle: 'UF_CRM_CALLE', cp: 'UF_CRM_CALLE_CP', poblacion: 'UF_CRM_CALLE_POB', provincia: 'UF_CRM_CALLE_PROV' },
  ],
  confirmado: CONFIRMADO,
}

describe('G01b · la situación, con el mapa confirmado', () => {
  it('sin confirmar, no se guarda la situación de nadie', () => {
    const f = leerEmpresa({ ID: '1', TITLE: 'CLIENTE PRUEBA', UF_CRM_S: '1' }, { ...MAPA, confirmado: null })
    expect(f).toMatchObject({ situacion: null, situacionTexto: null, avisos: [] })
  })

  it('cada opción de QBO va a la suya; GRAVE DESAPARECIDO y las «Vzla», sin clasificar con su texto; vacía, sin situación', () => {
    const sit = (id: string | null) => { const f = leerEmpresa({ ID: 'x', TITLE: 'C', UF_CRM_S: id }, MAPA); return [f.situacion, f.situacionTexto] }
    expect(sit('1')).toEqual(['activo', 'ACTIVO'])
    expect(sit('2')).toEqual(['baja', 'BAJA DE AUTONOMO'])
    expect(sit('3')).toEqual(['baja', 'BAJA DE GESTORIA'])
    expect(sit('5')).toEqual(['moroso', 'MOROSO'])
    expect(sit('7')).toEqual(['solo_renta', 'CLIENTE SOLO RENTA'])
    expect(sit('4')).toEqual(['sin_clasificar', 'GRAVE DESAPARECIDO'])
    expect(sit('6')).toEqual(['sin_clasificar', 'Vzla Activo'])
    expect(sit(null)).toEqual([null, null])
    expect(leerEmpresa({ ID: 'x', TITLE: 'C', UF_CRM_S: '4' }, MAPA).avisos).toEqual([])
  })

  it('la propuesta pone «sin clasificar» a lo que no encaja y guarda el texto de cada opción', () => {
    const p = proponerMapa('Gestoría de prueba', {
      UF_CRM_S: { listLabel: 'Situación del Cliente', items: [
        { ID: 1, VALUE: 'ACTIVO' }, { ID: 2, VALUE: 'BAJA DE AUTONOMO ❌' }, { ID: 3, VALUE: 'BAJA DE GESTORIA ❌' }, { ID: 4, VALUE: 'GRAVE DESAPARECIDO' },
        { ID: 5, VALUE: 'MOROSO' }, { ID: 6, VALUE: 'Vzla MOROSO' }, { ID: 7, VALUE: 'Vzla Activo' }, { ID: 8, VALUE: 'Vzla Excliente' }, { ID: 9, VALUE: 'CLIENTE SOLO RENTA' }] },
    }, [])
    const s = p.mapa.campos.find((c) => c.campo === 'situacion')!
    expect(s.opciones).toEqual({ '1': 'activo', '2': 'baja', '3': 'baja', '4': 'sin_clasificar', '5': 'moroso', '6': 'sin_clasificar', '7': 'sin_clasificar', '8': 'sin_clasificar', '9': 'solo_renta' })
    expect(s.textos?.['6']).toBe('Vzla MOROSO')
    expect(p.queEsCadaUno.find((x) => x.campo === 'situacion')?.nota).toBe('opciones sin significado en Sumied: GRAVE DESAPARECIDO, Vzla MOROSO, Vzla Activo, Vzla Excliente')
    expect(p.mapa.confirmado ?? null).toBeNull()
  })
})

describe('G01b · la dirección, de un solo campo', () => {
  it('la primera fuente con algo da calle y código postal; nunca se mezclan con los campos sueltos ni con otra fuente', () => {
    const f = leerEmpresa({
      ID: '1', TITLE: 'C', UF_CRM_FISCAL: 'Calle Inventada 1, 28000 Madrid|;|123',
      UF_CRM_CP_SUELTO: '99999', UF_CRM_POB_SUELTA: 'Otra', ADDRESS: 'Calle Otra 2', ADDRESS_POSTAL_CODE: '28999', ADDRESS_CITY: 'Ninguna',
    }, MAPA)
    expect(f).toMatchObject({ calle: 'Calle Inventada 1, 28000 Madrid', cp: '28000', poblacion: null, provincia: null, direccionDe: 'Dirección Fiscal' })
    expect(f.otrasDirecciones).toEqual([{ etiqueta: 'Dirección', texto: 'Calle Otra 2, 28999, Ninguna' }])
  })

  it('sin fiscal, la social (si tiene varias, la primera); sin ninguna, ADDRESS con sus propios campos; luego «Calle, casa núm.»', () => {
    expect(leerEmpresa({ ID: '2', TITLE: 'C', UF_CRM_SOCIAL: ['', 'Plaza Prueba 3|;|7', 'Plaza Segunda 4|;|8'] }, MAPA))
      .toMatchObject({ calle: 'Plaza Prueba 3', cp: null, direccionDe: 'Dirección Social', otrasDirecciones: [] })
    expect(leerEmpresa({ ID: '3', TITLE: 'C', ADDRESS: 'Avenida Prueba 5', ADDRESS_POSTAL_CODE: '28001', ADDRESS_CITY: 'Madrid', ADDRESS_PROVINCE: 'Madrid' }, MAPA))
      .toMatchObject({ calle: 'Avenida Prueba 5', cp: '28001', poblacion: 'Madrid', provincia: 'Madrid', direccionDe: 'Dirección' })
    expect(leerEmpresa({ ID: '4', TITLE: 'C', UF_CRM_CALLE: 'Camino Prueba 6', UF_CRM_CALLE_CP: '28002', UF_CRM_CALLE_POB: 'Getafe' }, MAPA))
      .toMatchObject({ calle: 'Camino Prueba 6', cp: '28002', poblacion: 'Getafe', direccionDe: 'Calle, casa núm.' })
    expect(leerEmpresa({ ID: '5', TITLE: 'C' }, MAPA)).toMatchObject({ calle: null, cp: null, direccionDe: null, otrasDirecciones: [] })
  })

  it('el texto de un campo de dirección: lo de antes de «|», sin espacios de más', () => {
    expect(textoDeDireccion('  Calle   Uno 1 |;|55')).toBe('Calle Uno 1')
    expect(textoDeDireccion(['|;|1', 'Calle Dos 2|;|2'])).toBe('Calle Dos 2')
    expect(textoDeDireccion(null)).toBeNull()
  })
})

describe('G01b · solo «activo» espera cobro', () => {
  it('la morosa, la de baja, la de solo renta y la sin clasificar no salen en «Activos en Bitrix24 sin cobro»', () => {
    expect(SE_COBRA).toEqual(['activo'])
    const ficha = (claveFicha: string, situacion: 'activo' | 'baja' | 'moroso' | 'solo_renta' | 'sin_clasificar' | null) =>
      ({ claveFicha, nombre: `CLIENTE PRUEBA ${claveFicha}`, nif: null, correos: [], situacion, formaPago: null, emisorSegunCrm: null })
    const r = casar([ficha('1', 'activo'), ficha('2', 'moroso'), ficha('3', 'baja'), ficha('4', 'solo_renta'), ficha('5', 'sin_clasificar'), ficha('6', null)], [], () => '')
    expect(r.diferencias.filter((d) => d.tipo === 'crm_sin_cobro').map((d) => [d.claveFicha, d.porque]))
      .toEqual([['1', '«CLIENTE PRUEBA 1» está activo en Bitrix24 y no está en GoCardless (ni por NIF ni por correo).']])
  })
})

import { fraseDelReparto, miles, repartoDe } from '../../../../../supabase/functions/conta-bitrix-leer/lectura'

describe('G01b · la frase de la lectura: cuántas en cada situación, con NIF y con dirección', () => {
  const f = (situacion: 'activo' | 'baja' | 'moroso' | 'solo_renta' | 'sin_clasificar' | null, nif: string | null = null, calle: string | null = null) => ({ situacion, nif, calle })
  it('con el mapa confirmado, cada situación y la vacía', () => {
    const r = repartoDe([f('activo', 'B00000001', 'Calle Uno 1'), f('activo'), f('baja'), f('moroso', 'B00000002'), f('solo_renta'), f('sin_clasificar'), f(null, null, 'Calle Dos 2')])
    expect(r).toEqual({ total: 7, activo: 2, baja: 1, moroso: 1, solo_renta: 1, sin_clasificar: 1, sin_situacion: 1, conNif: 2, conDireccion: 2 })
    expect(fraseDelReparto(r, true)).toBe('7 fichas: 2 activas, 1 de baja, 1 morosa, 1 solo renta, 1 sin clasificar, 1 sin situación en Bitrix24. Con NIF: 2; con dirección: 2.')
  })
  it('sin confirmar, dice por qué no hay situación', () => {
    expect(fraseDelReparto(repartoDe([f(null, 'B00000001')]), false)).toBe('1 ficha. La situación no se guarda hasta confirmar el mapa en «Qué es cada campo». Con NIF: 1; con dirección: 0.')
  })
  it('los miles con punto, también con cuatro cifras', () => {
    expect([miles(7), miles(1437), miles(1234567)]).toEqual(['7', '1.437', '1.234.567'])
  })
})

import { camposQueSePiden } from '../../../../../supabase/functions/conta-bitrix-leer/mapa'
import { leerFichas } from '../../../../../supabase/functions/conta-bitrix-leer/lectura'

describe('G01b · la dirección se pide a Bitrix24 (en producción salía «Con dirección: 0»)', () => {
  it('reproduce el fallo: las fuentes de la dirección van en mapa.direcciones, no en mapa.campos, y no se pedían', () => {
    const pedidos = camposQueSePiden(MAPA)
    for (const c of ['UF_CRM_FISCAL', 'UF_CRM_SOCIAL', 'ADDRESS', 'ADDRESS_POSTAL_CODE', 'ADDRESS_CITY', 'ADDRESS_PROVINCE', 'UF_CRM_CALLE', 'UF_CRM_CALLE_CP', 'UF_CRM_CALLE_POB', 'UF_CRM_CALLE_PROV'])
      expect(pedidos).toContain(c)
  })

  it('y la lectura las trae: la ficha sale con su dirección', async () => {
    const pedidas: string[][] = []
    const medidos = Object.fromEntries(['TITLE', 'UF_CRM_S', 'UF_CRM_FISCAL', 'UF_CRM_SOCIAL', 'ADDRESS', 'ADDRESS_POSTAL_CODE', 'ADDRESS_CITY', 'ADDRESS_PROVINCE',
      'UF_CRM_CALLE', 'UF_CRM_CALLE_CP', 'UF_CRM_CALLE_POB', 'UF_CRM_CALLE_PROV', 'UF_CRM_CP_SUELTO', 'UF_CRM_POB_SUELTA'].map((k) => [k, { title: k, type: 'string' }]))
    const fila = { ID: '7', TITLE: 'CLIENTE PRUEBA', UF_CRM_FISCAL: 'Calle Inventada 7, 28000 Madrid|;|1' }
    const pedir = async (url: string, init: { body: string }) => {
      const metodo = url.split('/').pop()!.replace('.json', '')
      const cuerpo = JSON.parse(init.body) as { select?: string[] }
      if (cuerpo.select) pedidas.push(cuerpo.select)
      // Bitrix24 solo devuelve los campos que se le piden en «select».
      const res = metodo === 'crm.company.fields' ? { result: medidos }
        : { result: [Object.fromEntries(Object.entries(fila).filter(([k]) => (cuerpo.select ?? []).includes(k)))], total: 1 }
      return { ok: true, status: 200, json: async () => res }
    }
    const r = await leerFichas(pedir, 'https://portal.test/rest/1/abc/', MAPA, async () => {})
    expect(pedidas[0]).toContain('UF_CRM_FISCAL')
    expect(r.fichas[0]).toMatchObject({ calle: 'Calle Inventada 7, 28000 Madrid', cp: '28000', direccionDe: 'Dirección Fiscal' })
  })
})
