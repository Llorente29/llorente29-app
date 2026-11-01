// tests/conta/s01l/retencionLeida.test.ts
//
// S01l · La retención que traía el papel y no entró (su tipo no encajaba): la
// ficha la propone para elegir su tipo. Lo que elige el tipo en la base lo
// prueba supabase/staging/sql/20261101_s01l_retencion_prueba.sql (alquiler al
// 19 %, profesional al 15 % y una que no encaja). Cifras inventadas.
import { describe, expect, it } from 'vitest'
import { retencionLeidaSinTipo } from '@/modules/conta/documentos/fichaRecibida'

describe('S01l · la retención leída que no entró', () => {
  it('sin retención guardada y con una leída: se propone, con su tipo si es uno de la lista', () => {
    expect(retencionLeidaSinTipo(null, { tipo: null, importe: 123.45 })).toEqual({ importe: 123.45, tipo: '', aviso: 'La factura trae una retención de 123,45 €: elige su tipo.' })
    expect(retencionLeidaSinTipo(null, { tipo: 19, importe: 190 })?.tipo).toBe('19')
    expect(retencionLeidaSinTipo(null, { tipo: 12, importe: 120 })?.tipo).toBe('')
    expect(retencionLeidaSinTipo(null, { tipo: -15, importe: -150 })).toMatchObject({ importe: 150, tipo: '15' })
  })
  it('con la retención ya guardada, o sin ninguna en el papel: nada', () => {
    expect(retencionLeidaSinTipo(190, { tipo: 19, importe: 190 })).toBeNull()
    expect(retencionLeidaSinTipo(null, null)).toBeNull()
    expect(retencionLeidaSinTipo(null, { tipo: null, importe: 0 })).toBeNull()
  })
})
