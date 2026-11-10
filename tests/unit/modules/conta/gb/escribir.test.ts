// GB · Segunda parte (nº 9) · Lo puro de guardar un cambio desde la pestaña
// (supabase/functions/conta-bitrix-pestana/escribir.ts). Importes inventados (T11).
import { describe, expect, it } from 'vitest'
import { centDeTexto, cuotaEnBitrix, mesSiguiente, queHacerConLaCuota, totalDelRecibo } from '../../../../../supabase/functions/conta-bitrix-pestana/escribir'
import { clientes, Q } from '../../../../e2e/conta/gb/respuesta'

describe('GB · el recibo nuevo, con la cuenta de la ficha del G04', () => {
  it('el de diciembre del cliente 1: 60,50 + 18 × 24,20 = 496,10 €', () => {
    expect(totalDelRecibo(clientes, '1', Q, '2026-12')).toBe(49610)
  })
  it('con un alta más desde diciembre, 24,20 € más', () => {
    const con = { ...clientes, asignaciones: [...clientes.asignaciones, { id: 'nueva', tipo: 'cuota', cliente_id: '1', empresa_id: Q, servicio_id: 'lab', nivel_id: null, paquete_id: null,
      empleado_nombre: 'Persona Prueba Nueva', importe_propio: null, periodo: 'mes', desde: '2026-12-01', hasta: null }] }
    expect(totalDelRecibo(con, '1', Q, '2026-12')).toBe(49610 + 2420)
  })
  it('el mes que viene', () => {
    expect([mesSiguiente('2026-11-09'), mesSiguiente('2026-12-31')]).toEqual(['2026-12', '2027-01'])
  })
})

describe('GB · la cuota de Bitrix24: se escribe, no se toca o choca (nunca se pisa)', () => {
  const base = { campo: 'UF_CRM_CUOTA_MENSUAL', conocida: '225,00', escrita: null, nuevoCent: 25000 }
  it('los importes, como los guarda Bitrix24', () => {
    expect([cuotaEnBitrix(25000), cuotaEnBitrix(49610), cuotaEnBitrix(5)]).toEqual(['250,00', '496,10', '0,05'])
    expect([centDeTexto('225,00'), centDeTexto('225'), centDeTexto('1.250,5 €'), centDeTexto('225|EUR'), centDeTexto(''), centDeTexto(null), centDeTexto('abc')])
      .toEqual([22500, 22500, 125050, 22500, null, null, null])
  })
  it('lo que hay es lo que Sumied leyó: se escribe', () => {
    expect(queHacerConLaCuota({ ...base, actual: '225,00' })).toEqual({ hacer: 'escribir', valor: '250,00' })
  })
  it('lo que hay es lo último que escribió la pestaña: se escribe', () => {
    expect(queHacerConLaCuota({ ...base, escrita: '275,00', actual: '275,00' })).toEqual({ hacer: 'escribir', valor: '250,00' })
  })
  it('alguien lo cambió en Bitrix24: no se pisa', () => {
    expect(queHacerConLaCuota({ ...base, actual: '300,00' })).toEqual({ hacer: 'choque', enBitrix: '300,00', sumied: '250,00' })
    expect(queHacerConLaCuota({ ...base, actual: '' })).toEqual({ hacer: 'choque', enBitrix: 'vacío', sumied: '250,00' })
  })
  it('vacío y Sumied no sabía nada: se escribe; ya está igual o no hay campo: nada', () => {
    expect(queHacerConLaCuota({ ...base, conocida: null, actual: null })).toEqual({ hacer: 'escribir', valor: '250,00' })
    expect(queHacerConLaCuota({ ...base, actual: '250,00' }).hacer).toBe('nada')
    expect(queHacerConLaCuota({ ...base, campo: null, actual: '225,00' }).hacer).toBe('nada')
  })
})

describe('GB (nº 13) · «Trabajadores» y «Estado del cobro» en la ficha de Bitrix24', () => {
  it('cuántos trabajadores se cobran el mes que viene (con un alta, uno más)', async () => {
    const { trabajadoresDelRecibo } = await import('../../../../../supabase/functions/conta-bitrix-pestana/escribir')
    expect(trabajadoresDelRecibo(clientes, '1', Q, '2026-12')).toBe(18)
    const con = { ...clientes, asignaciones: [...clientes.asignaciones, { id: 'nueva', tipo: 'cuota', cliente_id: '1', empresa_id: Q, servicio_id: 'lab', nivel_id: null, paquete_id: null,
      empleado_nombre: 'Persona Prueba Nueva', importe_propio: null, periodo: 'mes', desde: '2026-12-01', hasta: null }] }
    expect(trabajadoresDelRecibo(con, '1', Q, '2026-12')).toBe(19)
    expect(trabajadoresDelRecibo(clientes, 'otro', Q, '2026-12')).toBeNull()
  })
  it('el estado del cobro: el del último cobro; sin cobros, lo que dice el mandato', async () => {
    const { estadoDelCobro } = await import('../../../../../supabase/functions/conta-bitrix-pestana/escribir')
    const { ficha } = await import('../../../../e2e/conta/gb/respuesta')
    expect(estadoDelCobro(ficha, Q)).toBe('Cobrado')
    const devuelto = { ...ficha, cobros: [...ficha.cobros, { company_id: Q, gc_id: 'PM9', mandato_gc_id: 'MD1', estado: 'failed', fecha: '2026-12-04', importe: 496.1 }] }
    expect(estadoDelCobro(devuelto, Q)).toBe('Devuelto')
    expect(estadoDelCobro({ mandatos: ficha.mandatos, cobros: [] }, Q)).toBe('Mandato firmado, sin cobros')
    expect(estadoDelCobro({ mandatos: [{ company_id: Q, estado: 'pending_customer_approval' }], cobros: [] }, Q)).toBe('Mandato por firmar')
    expect(estadoDelCobro({}, Q)).toBe('Sin mandato')
    // Solo los de esa empresa.
    expect(estadoDelCobro(ficha, 'otra-empresa')).toBe('Sin mandato')
  })
  it('se escribe si está vacío o tiene lo último de Sumied; si alguien lo cambió en Bitrix24, no se pisa', async () => {
    const { queHacerConElTexto, textoParaComparar } = await import('../../../../../supabase/functions/conta-bitrix-pestana/escribir')
    expect([textoParaComparar('18'), textoParaComparar('18.00'), textoParaComparar(' Cobrado '), textoParaComparar(null), textoParaComparar(['4'])]).toEqual(['18', '18', 'cobrado', '', '4'])
    const c = { campo: 'UF_CRM_TRABAJADORES', escrita: '18' }
    expect(queHacerConElTexto({ ...c, actual: '', nuevo: '19' })).toEqual({ hacer: 'escribir', valor: '19' })
    expect(queHacerConElTexto({ ...c, actual: '18', nuevo: '19' })).toEqual({ hacer: 'escribir', valor: '19' })
    expect(queHacerConElTexto({ ...c, actual: '19.0', nuevo: '19' })).toEqual({ hacer: 'nada', porque: 'Bitrix24 ya lo tiene' })
    expect(queHacerConElTexto({ ...c, actual: '25', nuevo: '19' })).toEqual({ hacer: 'choque', enBitrix: '25', sumied: '19' })
    // Sin nada escrito por Sumied antes, lo que haya en Bitrix24 es de alguien: no se pisa.
    expect(queHacerConElTexto({ ...c, escrita: null, actual: 'Al día', nuevo: 'Cobrado' })).toEqual({ hacer: 'choque', enBitrix: 'Al día', sumied: 'Cobrado' })
    expect(queHacerConElTexto({ campo: null, actual: '', escrita: null, nuevo: 'Cobrado' })).toEqual({ hacer: 'nada', porque: 'el mapa de Bitrix24 no tiene ese campo' })
  })
})

describe('GB (nº 13, punto 2) · los choques con Bitrix24 a «Pendiente de revisar»', () => {
  it('los choques (con su nombre en la ficha) y lo escrito sin choque', async () => {
    const { choquesDe } = await import('../../../../../supabase/functions/conta-bitrix-pestana/escribir')
    expect(choquesDe({ hecho: 'choque', campo: 'UF_CRM_CUOTA', en_bitrix: '300,00', sumied: '250,00',
      campos: { trabajadores: { hecho: 'escrito', campo: 'UF_CRM_T', escrito: '19' }, estado_cobro: { hecho: 'choque', campo: 'UF_CRM_E', en_bitrix: 'Al día', sumied: 'Cobrado' } } }))
      .toEqual({ choques: [{ campo: 'Cuota mensual', en_bitrix: '300,00', sumied: '250,00' }, { campo: 'Estado del cobro', en_bitrix: 'Al día', sumied: 'Cobrado' }], escritos: ['Trabajadores'] })
    expect(choquesDe({ hecho: 'escrito', escrito: '250,00', campos: {} })).toEqual({ choques: [], escritos: ['Cuota mensual'] })
    expect(choquesDe({ hecho: 'nada', texto: 'Bitrix24 no contesta' })).toEqual({ choques: [], escritos: [] })
  })
  it('en la ficha del cliente, con su chip y «Ya lo he revisado»', async () => {
    const { CHIPS, comoResolver } = await import('@/modules/conta/gestoria/vista')
    expect(CHIPS.find((c) => c.tipos.includes('bitrix_cambiado'))).toMatchObject({ etiqueta: 'Cambiado a mano en Bitrix24', necesita: ['bitrix'] })
    expect(comoResolver({ tipo: 'bitrix_cambiado' } as never)).toEqual(['revisada'])
  })
})

describe('GB (nº 13, punto 3) · la nota corta en el historial de la ficha', () => {
  it('una por cambio, corta, con el mes', async () => {
    const { notaDelCambio, mesEnPalabras } = await import('../../../../../supabase/functions/conta-bitrix-pestana/escribir')
    expect([mesEnPalabras('2026-12-01'), mesEnPalabras('2027-01'), mesEnPalabras('x'), mesEnPalabras(null)]).toEqual(['diciembre', 'enero', null, null])
    expect(notaDelCambio('alta', { nombre: 'Luis Prueba Soto', desde: '2026-12-01', servicio: 'lab' }, 'Alta de LUIS…')).toBe('Sumied · alta de Luis Prueba Soto desde diciembre')
    expect(notaDelCambio('baja', { linea: 'w0', mes: '2026-11-01', nombre: 'Persona Prueba 00' }, 'Baja…')).toBe('Sumied · baja de Persona Prueba 00: se deja de cobrar desde diciembre')
    expect(notaDelCambio('baja', { linea: 'w0', mes: '2026-12-01' }, 'Baja…')).toBe('Sumied · baja de un trabajador: se deja de cobrar desde enero')
    expect(notaDelCambio('solicitud', { solicitud: 's1', nombre: 'DIEGO PRUEBA FERRER', tipo: 'alta' }, 'Alta…')).toBe('Sumied · alta de DIEGO PRUEBA FERRER, que pidió el cliente en su portal')
    expect(notaDelCambio('tarifa', { linea: 'g1', desde: '2026-12-01', precio: 135, motivo: 'Cliente desde 2015' }, '…'))
      .toBe('Sumied · precio especial de 135,00 € desde diciembre. Por qué: Cliente desde 2015')
    expect(notaDelCambio('tarifa', { linea: 'g1', desde: '2026-12-01', nivel: 'n1' }, 'Cliente Prueba, S.L. pasa de Gestoría mensual · Premium a Gestoría mensual · Básica desde diciembre de 2026.'))
      .toBe('Sumied · Cliente Prueba, S.L. pasa de Gestoría mensual · Premium a Gestoría mensual · Básica desde diciembre de 2026')
    expect(notaDelCambio('alta', { nombre: 'x'.repeat(400) }, '').length).toBe(240)
  })
})
