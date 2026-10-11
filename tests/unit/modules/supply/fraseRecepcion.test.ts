// La frase de «Recibido» (Compras · N21): la primera oración en negrita. Los
// casos son las cuatro frases que devuelve compras_camino_de (0170), tal cual.
import { describe, expect, it } from 'vitest'
import { partirFrase } from '@/modules/supply/lib/fraseRecepcion'

describe('partirFrase (N21)', () => {
  it('las frases de compras_camino_de', () => {
    expect(partirFrase('Este papel es una factura. Ya ha pasado a la oficina. No tienes que hacer nada más.'))
      .toEqual(['Este papel es una factura.', 'Ya ha pasado a la oficina. No tienes que hacer nada más.'])
    expect(partirFrase('Este papel es un albarán. La oficina esperará la factura.'))
      .toEqual(['Este papel es un albarán.', 'La oficina esperará la factura.'])
    expect(partirFrase('Este género es de Distribuciones Prueba Aurora, S.L. Entra en la cuenta del mes.'))
      .toEqual(['Este género es de Distribuciones Prueba Aurora, S.L.', 'Entra en la cuenta del mes.'])
    expect(partirFrase('Recibido. La oficina lo revisará.')).toEqual(['Recibido.', 'La oficina lo revisará.'])
  })
})
