// tests/unit/modules/conta/r09/ventasTpv.test.ts
//
// R09 · «Subir las ventas del TPV» sin interruptor: una empresa de hostelería tiene las ventas del
// TPV siempre; fuera de hostelería manda company_tax_profile.ventas_por_dia. La regla vive en un
// solo sitio (conVentasTpv), y de ella cuelgan la condición «tpv» (el menú y Ajustes) y «ventas_por_dia».

import { describe, expect, it } from 'vitest'
import { conVentasTpv, cumple } from '@/modules/conta/esqueleto/productos'
import { indiceAjustes } from '@/config/navegacion'

const ctx = (hosteleria: boolean, ventasPorDia?: boolean) => ({ hosteleria, diez: false, ...(ventasPorDia === undefined ? {} : { ventasPorDia }) })

describe('R09 · Las ventas del TPV, sin interruptor en hostelería', () => {
  it('hostelería sin el campo: sí', () => {
    expect(conVentasTpv(ctx(true))).toBe(true)
    expect(cumple('tpv', ctx(true))).toBe(true)
    expect(cumple('ventas_por_dia', ctx(true))).toBe(true)
  })
  it('fuera de hostelería sin el campo (o apagado): no', () => {
    expect(conVentasTpv(ctx(false))).toBe(false)
    expect(cumple('tpv', ctx(false, false))).toBe(false)
    expect(cumple('ventas_por_dia', ctx(false))).toBe(false)
  })
  it('fuera de hostelería con el campo encendido: sí', () => {
    expect(conVentasTpv(ctx(false, true))).toBe(true)
    expect(cumple('tpv', ctx(false, true))).toBe(true)
  })
  it('el índice de Ajustes enseña «Ventas por día» con la misma regla', () => {
    const tiene = (si: boolean) => indiceAjustes(false, false, si).flatMap((g) => g.entradas).some((e) => e.id === 'ventas-por-dia')
    expect(tiene(conVentasTpv(ctx(true)))).toBe(true)
    expect(tiene(conVentasTpv(ctx(false)))).toBe(false)
  })
})
