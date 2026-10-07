// tests/conta/cumplimiento/libro.test.ts
//
// C04 · El agente «Libro diario» (scripts/conta/lib/libro.mjs). La fixture es
// el volcado REAL de scripts/conta/agente-libro.sql contra staging-conta el
// 07/10 (regla 31): con la primera semilla del C04 vio, con razón, un resumen
// de ventas de 96 tickets sin ningún pedido guardado. Que el SQL encuentra
// cada cosa rota lo prueba supabase/staging/sql/20261011_c04_prueba_agente.sql.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NORMAS, informeLibro, revisarLibro } from '../../../scripts/conta/lib/libro.mjs'

const real = JSON.parse(readFileSync('tests/conta/cumplimiento/datos/libro_staging_20261007.json', 'utf8'))
const A = { account_id: 'c01a0000-0000-4000-8000-00000000000a', company_id: '3b34403a-a7d6-4a48-a8d7-737e8cababdc' }

describe('agente «Libro diario»', () => {
  it('sobre el volcado real de staging: el resumen sin pedidos, en rojo, con su cuenta y sus cifras', () => {
    const h = revisarLibro(real)
    expect(h).toHaveLength(1)
    expect(h[0]).toMatchObject({ nivel: 'rojo', tipo: 'ventas_dia', donde: 'cuenta c01a0000 · empresa 3b34403a' })
    expect(h[0].detalle).toBe('2026-10-05 local e0200000: los tickets no son los pedidos guardados (resumen 1100, 96 tickets, 0 pedidos que suman 0)')
    const t = informeLibro(h, { donde: 'staging-conta', hoy: '2026-10-07', contado: real.contado })
    expect(t).toContain('Mirados: 7 asientos (6 validados, 1 anulados) con 21 apuntes en 2 empresas; 4 propuestas o borradores esperando.')
    expect(t).toContain('**1 en rojo.**')
  })

  it('sin nada que decir, lo dice en verde', () => {
    const limpio = { ...real, ventas_dia: [] }
    expect(revisarLibro(limpio)).toEqual([])
    expect(informeLibro([], { donde: 'producción', hoy: '2026-10-08', contado: real.contado })).toContain('**En verde**')
  })

  it('una fila en cada comprobación: rojo lo que la base no debía dejar pasar, ámbar lo que espera a una persona', () => {
    const una = {
      contado: real.contado,
      cuadre: [{ ...A, serie: 9, numero: 1, debe: 5541, haber: 5540, apuntes: 5 }],
      huecos: [{ ...A, ejercicio: 'e1', serie: 4, falta: 1 }],
      cadena: [{ ...A, serie: 9, numero: 1, orden: 2, motivo: 'su contenido no es el que se validó' }],
      iva: [{ ...A, serie: 2, numero: 1, cuenta: '47200010', motivo: 'cuota 116.65 y base 1266.50 × 10 % = 126.65' }],
      ventas_dia: real.ventas_dia,
      cedidas_70: [{ ...A, serie: 1, numero: 1, cuenta: '70000000', marca: 'e0200000-x', importe: 89.91 }],
      socio_gasto: [{ ...A, serie: 2, numero: 1, cuenta: '60000000', importe: 1166.5 }],
      resultado: [{ ...A, serie: 2, numero: 1, cuenta: '60000000', motivo: '6/7 sin local ni común' }, { ...A, motivo: 'hay gastos o ingresos comunes y su regla de reparto suma 90 %' }],
      mes_cerrado: [{ ...A, serie: 4, numero: 1, fecha: '2026-10-06' }],
      propuestas: [{ ...A, serie: 1, fecha: '2026-10-05', origen: 'sales_day', dias: 8 }],
    }
    const h = revisarLibro(una)
    expect(h.map((x) => `${x.tipo}:${x.nivel}`)).toEqual([
      'cuadre:rojo', 'huecos:rojo', 'cadena:rojo', 'iva:rojo', 'ventas_dia:rojo', 'cedidas_70:rojo', 'socio_gasto:rojo',
      'resultado:rojo', 'resultado:ambar', 'mes_cerrado:rojo', 'propuestas:ambar',
    ])
    expect(h.every((x) => x.norma === NORMAS[x.tipo as keyof typeof NORMAS])).toBe(true)
    // La serie por su palabra (respuesta 1); sin conceptos ni nombres (repositorio público).
    expect(h[0].detalle).toBe('Nóminas nº 1: Debe 5541 y Haber 5540 (5 apuntes)')
    expect(h[1].detalle).toBe('falta General nº 1 en el ejercicio e1')
    expect(informeLibro(h, { donde: 'staging-conta', hoy: '2026-10-07', contado: real.contado })).toContain('### Ámbar (espera a una persona)')
  })
})
