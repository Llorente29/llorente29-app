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
  // G01b · Sin confirmar en «Qué es cada campo» no se guarda la situación de nadie.
  confirmado: { quien: 'persona-de-prueba', cuando: '2026-11-07T10:00:00Z' },
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
    // G01b · Una opción que el mapa no conoce queda «sin clasificar», con su texto (aquí, el id).
    expect(f.situacion).toBe('sin_clasificar')
    expect(f.situacionTexto).toBe('99')
    expect(f.emisorSegunBitrix).toBeNull()
    expect(f.avisos).toEqual(['Situación «99» sin clasificar en Sumied.', '«Forma de pago» dice «77», que el mapa no sabe de qué emisor es.', 'Sin nombre en Bitrix24.'])
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
    // Y la ficha se lee con el mapa propuesto: sin confirmar, sin situación; confirmado, con ella.
    const fila = { ID: '9', TITLE: 'CLIENTE PRUEBA', UF_CRM_P1: 'B00000009', UF_CRM_P2: '13', UF_CRM_P3: ['21', '23'], UF_CRM_P4: '32', UF_CRM_P5: '90,75' }
    expect(p.mapa.confirmado ?? null).toBeNull()
    expect(leerEmpresa(fila, p.mapa)).toMatchObject({ situacion: null, situacionTexto: null })
    const f = leerEmpresa(fila, { ...p.mapa, confirmado: { quien: null, cuando: '2026-11-07T10:00:00Z' } })
    expect(f).toMatchObject({ nif: 'B00000009', situacion: 'moroso', situacionTexto: 'Moroso', servicios: ['C', 'S'], emisorSegunBitrix: 'empresa-a', cuotasReferencia: [{ etiqueta: 'Cuota mensual', importeCent: 9075 }] })
  })

  it('G01b · cuando varios campos encajan, la duda se guarda con el mapa (con las etiquetas como las del portal de QBO)', () => {
    const medidos = {
      TITLE: { title: 'Nombre de la empresa' },
      ADDRESS: { title: 'Dirección' },
      UF_CRM_N1: { formLabel: 'CIF/NIF', type: 'string' },
      UF_CRM_N2: { formLabel: 'CIF - Compañía', type: 'string' },
      UF_CRM_N3: { formLabel: 'DNI / NIF ( Solo para clientes existentes )', type: 'string' },
      UF_CRM_S1: { formLabel: 'Situación del Cliente', type: 'enumeration', items: [{ ID: '1', VALUE: 'ACTIVO' }, { ID: '2', VALUE: 'GRAVE DESAPARECIDO' }] },
      UF_CRM_S2: { formLabel: 'Estado', type: 'enumeration', items: [{ ID: '3', VALUE: '1er Contacto' }] },
      UF_CRM_L1: { formLabel: 'Cuota Mensual Laboral', type: 'double' },
      UF_CRM_L2: { formLabel: 'Cuota Mensual Laboral z', type: 'money' },
      UF_CRM_K1: { formLabel: 'Cuota Mensual ContaSimple', type: 'double' },
      UF_CRM_K2: { formLabel: 'Cuota Mensual ContaSimple z', type: 'money' },
    }
    const p = proponerMapa('Gestoría de prueba', medidos, EMISORES)
    const duda = (campo: string, etiqueta?: string) => p.mapa.dudas?.find((d) => d.campo === campo && (!etiqueta || d.etiqueta === etiqueta))
    expect(duda('nif')).toEqual({ campo: 'nif', porque: 'varios', candidatos: [
      { codigo: 'UF_CRM_N1', etiqueta: 'CIF/NIF' }, { codigo: 'UF_CRM_N2', etiqueta: 'CIF - Compañía' }, { codigo: 'UF_CRM_N3', etiqueta: 'DNI / NIF ( Solo para clientes existentes )' }] })
    expect(duda('situacion')?.candidatos.map((c) => c.etiqueta)).toEqual(['Situación del Cliente', 'Estado'])
    expect(duda('provincia')).toMatchObject({ porque: 'ninguno', candidatos: [] })
    // Las cuotas buenas son las que no llevan «z» (Julio, 07/11): una sola encaja, y no queda duda.
    expect(p.mapa.campos.filter((c) => c.campo === 'cuota_referencia').map((c) => [c.etiqueta, c.codigo])).toEqual(expect.arrayContaining([['Laboral', 'UF_CRM_L1'], ['ContaSimple', 'UF_CRM_K1']]))
    expect(duda('cuota_referencia', 'Laboral')).toBeUndefined()
    expect(duda('cuota_referencia', 'ContaSimple')).toBeUndefined()
  })
})

import { camposDelRecuento, centDe, contar, gruposValidos, textoDe } from '../../../../../supabase/functions/conta-bitrix-leer/recuento'

describe('G01b · el recuento de los campos dudosos: solo números', () => {
  const medidos = {
    UF_CRM_N1: { formLabel: 'CIF/NIF' }, UF_CRM_N2: { formLabel: 'CIF - Compañía' },
    UF_CRM_C1: { formLabel: 'Calle, casa núm.' }, UF_CRM_C2: { formLabel: 'Dirección Fiscal', type: 'address' },
    UF_CRM_S1: { formLabel: 'Situación del Cliente', items: [{ ID: '1', VALUE: 'ACTIVO' }, { ID: '2', VALUE: 'MOROSO' }] },
    UF_CRM_Q1: { formLabel: 'Cuota Mensual', type: 'double' }, UF_CRM_Q2: { formLabel: 'Cuota Mensual z', type: 'money' },
  }
  const grupos = { texto: { nif: ['UF_CRM_N1', 'UF_CRM_N2'], calle: ['UF_CRM_C1', 'UF_CRM_C2'] }, situacion: 'UF_CRM_S1', cuotas: ['UF_CRM_Q1', 'UF_CRM_Q2'] }
  const filas = [
    { ID: '1', UF_CRM_N1: 'B00000001', UF_CRM_N2: 'b-00000001', UF_CRM_C1: 'Calle Prueba 1', UF_CRM_C2: 'Calle Prueba, 1|;|99', UF_CRM_S1: '1', UF_CRM_Q1: 60.5, UF_CRM_Q2: '60.5|EUR' },
    { ID: '2', UF_CRM_N1: 'B00000002', UF_CRM_N2: 'B00000003', UF_CRM_C1: '', UF_CRM_C2: ['', 'Otra Calle 2|;|7'], UF_CRM_S1: '2', UF_CRM_Q1: '0', UF_CRM_Q2: '' },
    { ID: '3', UF_CRM_N1: ' ', UF_CRM_N2: null, UF_CRM_C1: null, UF_CRM_C2: null, UF_CRM_S1: '', UF_CRM_Q1: '24,20', UF_CRM_Q2: null },
    { ID: '4', UF_CRM_S1: '99' },
  ]

  it('cuenta rellenas, más de uno y que no coinciden (sin tildes ni signos); situación por opción; cuotas con importe y su suma', () => {
    const r = contar(filas, grupos, medidos)
    expect(r.total).toBe(4)
    expect(r.texto.nif).toEqual({ campos: [{ codigo: 'UF_CRM_N1', etiqueta: 'CIF/NIF', rellenas: 2 }, { codigo: 'UF_CRM_N2', etiqueta: 'CIF - Compañía', rellenas: 2 }], masDeUno: 2, noCoinciden: 1 })
    expect(r.texto.calle).toEqual({ campos: [{ codigo: 'UF_CRM_C1', etiqueta: 'Calle, casa núm.', rellenas: 1 }, { codigo: 'UF_CRM_C2', etiqueta: 'Dirección Fiscal', rellenas: 2 }], masDeUno: 1, noCoinciden: 0 })
    expect(r.situacion).toEqual({ codigo: 'UF_CRM_S1', etiqueta: 'Situación del Cliente', opciones: [{ id: '1', texto: 'ACTIVO', fichas: 1 }, { id: '2', texto: 'MOROSO', fichas: 1 }], vacias: 1, otras: 1 })
    expect(r.cuotas).toEqual([{ codigo: 'UF_CRM_Q1', etiqueta: 'Cuota Mensual', conImporte: 2, sumaCent: 8470 }, { codigo: 'UF_CRM_Q2', etiqueta: 'Cuota Mensual z', conImporte: 1, sumaCent: 6050 }])
    // Solo números y etiquetas: ningún valor de una ficha sale del recuento.
    expect(JSON.stringify(r)).not.toMatch(/B0000000|Calle Prueba|Otra Calle/)
  })

  it('los valores de Bitrix24: dirección antes de «|», el primero con algo de una lista, importes con coma o con moneda', () => {
    expect(textoDe('Calle Prueba, 1|;|99')).toBe('Calle Prueba, 1')
    expect(textoDe(['', 'Otra|x'])).toBe('Otra')
    expect(textoDe({ a: 1 })).toBe('')
    expect([centDe('24,20'), centDe('60.5|EUR'), centDe(12), centDe(''), centDe('nada')]).toEqual([2420, 6050, 1200, null, null])
  })

  it('pide a Bitrix24 solo el id y esos campos, y no acepta otra cosa que códigos', () => {
    expect(camposDelRecuento(grupos)).toEqual(['ID', 'UF_CRM_N1', 'UF_CRM_N2', 'UF_CRM_C1', 'UF_CRM_C2', 'UF_CRM_S1', 'UF_CRM_Q1', 'UF_CRM_Q2'])
    expect(gruposValidos(grupos)).toEqual(grupos)
    expect(gruposValidos({ ...grupos, cuotas: ['DROP TABLE'] })).toBeNull()
    expect(gruposValidos({ ...grupos, texto: { nif: [] } })).toBeNull()
    expect(gruposValidos(null)).toBeNull()
  })
})

import { contarRepetidos, nifComoLaBase, suenaASociedad, tipoDeNif } from '../../../../../supabase/functions/conta-bitrix-leer/recuento'

describe('G01b · los NIF repetidos del recuento: solo números', () => {
  // Inventados (T11): NIF de ceros y nombres de prueba.
  const medidos = { UF_N: { formLabel: 'CIF/NIF' }, UF_S: { listLabel: 'Situación del Cliente', items: [{ ID: 1, VALUE: 'ACTIVO' }, { ID: 2, VALUE: 'BAJA DE GESTORIA ❌' }, { ID: 3, VALUE: 'MOROSO' }, { ID: 4, VALUE: 'Vzla Activo' }] } }
  const f = (nif: string | null, sit: string | null, nombre: string) => ({ UF_N: nif, UF_S: sit, TITLE: nombre })
  const filas = [
    f('00000000T', '1', 'PERSONA PRUEBA UNO'), f('00000000-t', '2', 'PERSONA PRUEBA UNO, S.L.'),                       // DNI · activa y baja · sociedad y persona
    f('B00000000', '1', 'EMPRESA PRUEBA, S.L.'), f('b 00000000', '1', 'EMPRESA PRUEBA SL'), f('ESB00000000', '1', 'EMPRESA PRUEBA S.L.'), // CIF · misma situación · 3 fichas
    f('X0000000T', '3', 'PERSONA PRUEBA DOS'), f('X0000000T', '4', 'PERSONA PRUEBA DOS'),                               // NIE · distinta, sin activa y baja
    f('Y0000000Z', '1', 'PERSONA PRUEBA TRES'), f(null, '1', 'SIN NIF'), f('  ', '2', 'NIF VACÍO'),
  ]

  it('cuenta los NIF repetidos como los compara la base, con sus situaciones, su tipo y si mezclan sociedad y persona', () => {
    const r = contarRepetidos(filas, { nif: 'UF_N', nombre: 'TITLE' }, 'UF_S', medidos)
    expect(r).toEqual({
      campoNif: { codigo: 'UF_N', etiqueta: 'CIF/NIF' }, fichasConNif: 8,
      nifRepetidos: 3, fichasEnRepetidos: 7, maximoPorNif: 3, mismaSituacion: 1, distintaSituacion: 2, activaYBaja: 1,
      porTipo: { DNI: 1, NIE: 1, CIF: 1, RIF: 0, otro: 0 }, sociedadYPersona: 1, situacionSegun: 'texto de la opción',
    })
    // Ningún NIF ni nombre sale del resultado.
    const txt = JSON.stringify(r)
    for (const x of ['00000000T', 'B00000000', 'X0000000T', 'PRUEBA']) expect(txt).not.toContain(x)
  })

  it('con el mapa confirmado, la situación es la que dice el mapa, no su texto', () => {
    const dos = [f('X0000000T', '1', 'A'), f('X0000000T', '4', 'A')]
    // Por su texto, «Vzla Activo» es «sin clasificar»: dos situaciones distintas.
    expect(contarRepetidos(dos, { nif: 'UF_N', nombre: 'TITLE' }, 'UF_S', medidos)).toMatchObject({ distintaSituacion: 1, situacionSegun: 'texto de la opción' })
    // Si la persona dijo en el mapa que es «activo», la misma.
    expect(contarRepetidos(dos, { nif: 'UF_N', nombre: 'TITLE' }, 'UF_S', medidos, { '1': 'activo', '2': 'baja', '3': 'moroso', '4': 'activo' }))
      .toMatchObject({ nifRepetidos: 1, mismaSituacion: 1, activaYBaja: 0, situacionSegun: 'mapa confirmado' })
  })

  it('el NIF como la base, su tipo y el nombre de sociedad', () => {
    expect([nifComoLaBase('es-b.00000000'), nifComoLaBase(' 00000000-t '), nifComoLaBase(''), nifComoLaBase(null)]).toEqual(['B00000000', '00000000T', null, null])
    expect([tipoDeNif('00000000T'), tipoDeNif('X0000000T'), tipoDeNif('B00000000'), tipoDeNif('123')]).toEqual(['DNI', 'NIE', 'CIF', 'otro'])
    expect(['EMPRESA PRUEBA, S.L.', 'EMPRESA PRUEBA SLU', 'PRUEBA S.A.', 'BAR PRUEBA C.B.', 'PRUEBA SOCIEDAD COOPERATIVA'].every(suenaASociedad)).toBe(true)
    expect(['PERSONA PRUEBA', 'JOSE S LOPEZ PRUEBA', 'SALA PRUEBA'].some(suenaASociedad)).toBe(false)
  })

  it('los grupos admiten «repetidos» solo con códigos de campo, y se piden sus dos campos', () => {
    const g = { texto: { nif: ['UF_N'] }, situacion: 'UF_S', cuotas: [], repetidos: { nif: 'UF_N', nombre: 'TITLE' } }
    expect(gruposValidos(g)).toEqual(g)
    expect(gruposValidos({ ...g, repetidos: { nif: 'UF_N', nombre: 'drop table' } })).toBeNull()
    expect(camposDelRecuento(g)).toEqual(['ID', 'UF_N', 'UF_S', 'TITLE'])
  })
})
