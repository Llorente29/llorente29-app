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
