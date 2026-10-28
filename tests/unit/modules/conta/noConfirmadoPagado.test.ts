import { describe, expect, it } from 'vitest'
import { diaYMes } from '@/modules/conta/lib/asientosPropuestos'

// Cierre del día · T4. La regla del no confirmado que una liquidación paga vive
// en SQL desde el S01 · PR 3 (conta_propuesta_pagado_despues, sobre la regla de
// ventas); sus casos, en supabase/staging/sql/20261028_s01_propuestas_pagado_despues_prueba.sql.
// Aquí queda lo que sigue en el navegador: las fechas en palabras.
describe('las fechas en palabras', () => {
  it('1 de enero, 31 de diciembre', () => {
    expect(diaYMes('2026-01-01')).toBe('1 de enero')
    expect(diaYMes('2026-12-31')).toBe('31 de diciembre')
  })
})
