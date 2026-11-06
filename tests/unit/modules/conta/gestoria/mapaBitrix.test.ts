// G01 · Tarea 2. El mapa de Bitrix24 (es dato, no código) y la lectura de
// crm.company.list de 50 en 50 sin pasar de 2 peticiones por segundo.
// Códigos UF_CRM_ y valores inventados (T11).
import { describe, expect, it } from 'vitest'
import {
  ESPERA_MS, MAPA_QBO, camposQueSePiden, camposSinCodigo, importeACent, leerEmpresa, leerTodas, type MapaBitrix,
} from '../../../../../supabase/functions/conta-bitrix-leer/mapa'

const MAPA: MapaBitrix = {
  nombre: 'Gestoría de prueba',
  campos: [
    { codigo: 'TITLE', campo: 'nombre' },
    { codigo: 'EMAIL', campo: 'correo' },
    { codigo: 'PHONE', campo: 'telefono' },
    { codigo: 'UF_CRM_PRUEBA_NIF', campo: 'nif' },
    { codigo: 'UF_CRM_PRUEBA_SITUACION', campo: 'situacion', opciones: { '11': 'activo', '12': 'baja', '13': 'moroso', '14': 'solo_renta' } },
    { codigo: 'UF_CRM_PRUEBA_SERVICIOS', campo: 'servicios', opciones: { '21': 'C', '22': 'L', '23': 'S' } },
    { codigo: 'UF_CRM_PRUEBA_PAGO', campo: 'forma_pago', opciones: { '31': 'Emisor A', '32': 'Emisor A Nuevo', '33': 'Emisor B' } },
    { codigo: 'UF_CRM_PRUEBA_CUOTA', campo: 'cuota_referencia', etiqueta: 'Cuota mensual' },
  ],
  formaPagoAEmisor: { 'Emisor A': 'empresa-a', 'Emisor A Nuevo': 'empresa-a', 'Emisor B': 'empresa-b' },
}

describe('G01 · mapa de Bitrix24', () => {
  it('pide el id y solo los campos del mapa con código', () => {
    expect(camposQueSePiden(MAPA)).toEqual(['ID', 'TITLE', 'EMAIL', 'PHONE', 'UF_CRM_PRUEBA_NIF', 'UF_CRM_PRUEBA_SITUACION', 'UF_CRM_PRUEBA_SERVICIOS', 'UF_CRM_PRUEBA_PAGO', 'UF_CRM_PRUEBA_CUOTA'])
  })

  it('el de QBO va primero, con lo estándar, y dice lo que falta por medir en el portal', () => {
    expect(camposQueSePiden(MAPA_QBO)).toEqual(['ID', 'TITLE', 'EMAIL', 'PHONE'])
    expect(camposSinCodigo(MAPA_QBO)).toContain('nif')
    expect(camposSinCodigo(MAPA_QBO)).toContain('Cuota mensual')
  })

  it('convierte una empresa en la ficha del cliente', () => {
    const f = leerEmpresa({
      ID: '501', TITLE: 'CLIENTE PRUEBA UNO, S.L.',
      EMAIL: [{ VALUE: 'Uno@Prueba.test', VALUE_TYPE: 'WORK' }, { VALUE: 'uno@prueba.test', VALUE_TYPE: 'HOME' }],
      PHONE: [{ VALUE: '600000000' }], UF_CRM_PRUEBA_NIF: 'b 00000001',
      UF_CRM_PRUEBA_SITUACION: '11', UF_CRM_PRUEBA_SERVICIOS: ['22', '21'], UF_CRM_PRUEBA_PAGO: '32', UF_CRM_PRUEBA_CUOTA: '90,75|EUR',
    }, MAPA)
    expect(f).toMatchObject({
      bitrixId: '501', nombre: 'CLIENTE PRUEBA UNO, S.L.', nif: 'B00000001', correos: ['uno@prueba.test'], telefonos: ['600000000'],
      situacion: 'activo', servicios: ['C', 'L'], formaPago: 'Emisor A Nuevo', emisorSegunBitrix: 'empresa-a',
      cuotasReferencia: [{ etiqueta: 'Cuota mensual', importeCent: 9075, texto: '90,75|EUR' }], avisos: [],
    })
  })

  it('lo que el mapa no conoce no se inventa: se dice', () => {
    const f = leerEmpresa({ ID: '502', UF_CRM_PRUEBA_SITUACION: '99', UF_CRM_PRUEBA_PAGO: '77' }, MAPA)
    expect(f.situacion).toBeNull()
    expect(f.emisorSegunBitrix).toBeNull()
    expect(f.avisos).toEqual(['Situación «99» que el mapa no conoce.', '«Forma de pago» dice «77», que el mapa no sabe de qué emisor es.', 'Sin nombre en Bitrix24.'])
  })

  it('los importes de referencia, en céntimos', () => {
    expect(importeACent('24,20')).toBe(2420)
    expect(importeACent('1.234,50 €')).toBe(123450)
    expect(importeACent('24.20')).toBe(2420)
    expect(importeACent('sin cuota')).toBeNull()
  })

  it('pagina de 50 en 50 y espera 500 ms entre peticiones (2 por segundo)', async () => {
    const pedidas: number[] = []
    const esperas: number[] = []
    const r = await leerTodas(
      async (start) => { pedidas.push(start); return start === 0 ? { result: Array(50).fill({ ID: 'x' }), next: 50, total: 60 } : { result: Array(10).fill({ ID: 'y' }), total: 60 } },
      async (ms) => { esperas.push(ms) },
    )
    expect(pedidas).toEqual([0, 50])
    expect(esperas).toEqual([ESPERA_MS])
    expect(ESPERA_MS).toBe(500)
    expect(r).toMatchObject({ total: 60, peticiones: 2 })
    expect(r.filas).toHaveLength(60)
  })

  it('para con el error de Bitrix24 en palabras (límite de peticiones)', async () => {
    await expect(leerTodas(async () => ({ error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests' }), async () => {}))
      .rejects.toThrow('Bitrix24 ha contestado «QUERY_LIMIT_EXCEEDED»: Too many requests.')
  })
})

import { emisorDeFormaDePago, proponerMapa } from '../../../../../supabase/functions/conta-bitrix-leer/mapa'

const EMISORES = [{ id: 'empresa-a', nombre: 'EMISOR PRUEBA ALFA, S.L.' }, { id: 'empresa-b', nombre: 'GOMEZ RUIZ, PERSONA PRUEBA' }]

describe('G01 · el mapa, propuesto desde crm.company.fields', () => {
  it('«Forma de pago» → el emisor cuyo nombre tiene sus palabras («… Nuevo» es el mismo)', () => {
    expect(emisorDeFormaDePago('Emisor Prueba Alfa', EMISORES)).toBe('empresa-a')
    expect(emisorDeFormaDePago('Emisor Prueba Alfa Nuevo', EMISORES)).toBe('empresa-a')
    expect(emisorDeFormaDePago('Persona Prueba Gómez', EMISORES)).toBe('empresa-b')
    expect(emisorDeFormaDePago('Otra cosa', EMISORES)).toBeNull()
  })

  it('propone cada campo por su etiqueta, con sus opciones, y dice lo que no encaja', () => {
    const medidos = {
      TITLE: { title: 'Nombre de la empresa' },
      ADDRESS: { title: 'Dirección' },
      UF_CRM_P1: { formLabel: 'NIF', type: 'string' },
      UF_CRM_P2: { listLabel: 'Situación', type: 'enumeration', items: [{ ID: '11', VALUE: 'Activo' }, { ID: '12', VALUE: 'Baja' }, { ID: '13', VALUE: 'Moroso' }, { ID: '14', VALUE: 'Solo renta' }, { ID: '15', VALUE: 'Prospecto' }] },
      UF_CRM_P3: { formLabel: 'Servicios', type: 'enumeration', isMultiple: true, items: [{ ID: '21', VALUE: 'C' }, { ID: '22', VALUE: 'L' }, { ID: '23', VALUE: 'S' }] },
      UF_CRM_P4: { formLabel: 'Forma de pago', type: 'enumeration', items: [{ ID: '31', VALUE: 'Emisor Prueba Alfa' }, { ID: '32', VALUE: 'Emisor Prueba Alfa Nuevo' }, { ID: '33', VALUE: 'Persona Prueba Gomez' }] },
      UF_CRM_P5: { formLabel: 'Cuota Mensual', type: 'money' },
      UF_CRM_P6: { formLabel: 'Población', type: 'string' },
      UF_CRM_P7: { formLabel: 'Población', type: 'string' },
      UF_CRM_P8: { formLabel: 'Comercial asignado', type: 'string' },
    }
    const p = proponerMapa('Gestoría de prueba', medidos, EMISORES)
    const cod = (campo: string) => p.queEsCadaUno.find((x) => x.campo === campo)?.codigo ?? null
    expect(cod('nif')).toBe('UF_CRM_P1')
    expect(cod('calle')).toBe('ADDRESS')
    expect(cod('situacion')).toBe('UF_CRM_P2')
    expect(cod('Cuota mensual')).toBe('UF_CRM_P5')
    expect(cod('poblacion')).toBeNull()
    expect(p.queEsCadaUno.find((x) => x.campo === 'poblacion')?.nota).toMatch(/^dudoso: UF_CRM_P6/)
    expect(p.queEsCadaUno.find((x) => x.campo === 'provincia')?.nota).toBe('ningún campo de Bitrix24 se llama así')
    expect(p.queEsCadaUno.find((x) => x.campo === 'situacion')?.nota).toBe('opciones sin significado en Sumied: Prospecto')
    expect(p.mapa.campos.find((c) => c.campo === 'servicios')?.opciones).toEqual({ '21': 'C', '22': 'L', '23': 'S' })
    expect(p.mapa.formaPagoAEmisor).toEqual({ 'Emisor Prueba Alfa': 'empresa-a', 'Emisor Prueba Alfa Nuevo': 'empresa-a', 'Persona Prueba Gomez': 'empresa-b' })
    expect(p.sinUsar).toEqual([{ codigo: 'UF_CRM_P6', etiqueta: 'POBLACION' }, { codigo: 'UF_CRM_P7', etiqueta: 'POBLACION' }, { codigo: 'UF_CRM_P8', etiqueta: 'COMERCIAL ASIGNADO' }])
    // Y la ficha se lee con el mapa propuesto.
    const f = leerEmpresa({ ID: '9', TITLE: 'CLIENTE PRUEBA', UF_CRM_P1: 'B00000009', UF_CRM_P2: '13', UF_CRM_P3: ['21', '23'], UF_CRM_P4: '32', UF_CRM_P5: '90,75' }, p.mapa)
    expect(f).toMatchObject({ nif: 'B00000009', situacion: 'moroso', servicios: ['C', 'S'], emisorSegunBitrix: 'empresa-a', cuotasReferencia: [{ etiqueta: 'Cuota mensual', importeCent: 9075 }] })
  })
})
