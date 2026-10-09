// tests/conta/cumplimiento/libros.test.ts
//
// C05 · La parte «libros y balances» del agente (scripts/conta/lib/libros.mjs).
// El caso verde es el volcado REAL de scripts/conta/agente-libros.sql contra
// staging-conta el 08/10 (regla 31): 3 empresas, 17 cuentas con saldo y nada
// que decir. Que el SQL encuentra cada cosa rota lo prueba
// supabase/staging/sql/20261014_c05_prueba_agente.sql, que rompe una por
// comprobación y exige verla.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NORMAS_LIBROS, informeLibros, revisarLibros } from '../../../scripts/conta/lib/libros.mjs'

const real = JSON.parse(readFileSync('tests/conta/cumplimiento/datos/libros_staging_20261008.json', 'utf8'))
const A = { account_id: 'c01a0000-0000-4000-8000-00000000000a', company_id: '3b34403a-a7d6-4a48-a8d7-737e8cababdc' }

describe('agente «Libro diario» · libros y balances (C05)', () => {
  it('sobre el volcado real de staging: nada, y el informe lo dice con lo mirado', () => {
    expect(revisarLibros(real)).toEqual([])
    const t = informeLibros([], real.contado)
    expect(t).toContain('3 empresas, 17 cuentas con saldo, 2 anotaciones del libro registro')
    expect(t).toContain('**En verde**')
  })

  it('una base sin el C05 (sin volcado) no da hallazgos', () => {
    expect(revisarLibros(null)).toEqual([])
  })

  it('cada comprobación sale con su nivel, su cuenta y su norma', () => {
    const roto = {
      ...real,
      cuadre_mes: [{ ...A, modelo: 'pymes', fin_mes: '2026-09-30', diferencia: 1250.4 }],
      sin_sitio: [{ ...A, modelo: 'pymes', cuenta: '77400000', saldo: -300, porque: 'el modelo de pymes no tiene «Diferencia negativa de combinaciones de negocio»: va en rojo, nunca escondida en otra línea' }],
      pyg_129: [{ ...A, ejercicio: '2025', cuentas: 3, saldo: 812.33 }],
      libro_diario: [{ ...A, trimestre: '2026-3T', libro: 'issued', en_libro: 1010.5, en_diario: 1009.5 }],
      cerrado_con_asientos: [{ ...A, ejercicio: '2025', serie: 4, numero: 12, fecha: '2025-12-31' }],
      fuera_con_saldo: [{ ...A, modelo: 'pymes', cuenta: '57200001', saldo: 10431.5 }],
      por_defecto: [{ ...A, modelo: 'pymes', n: 2, cuentas: ['473', '510'] }],
      otros_resultados: [{ ...A, cuenta: '67800000', saldo: 120 }],
    }
    const h = revisarLibros(roto)
    const por = Object.fromEntries(h.map((x) => [x.tipo, x]))
    expect(h.filter((x) => x.nivel === 'rojo').map((x) => x.tipo).sort()).toEqual(['cerrado_con_asientos', 'cuadre_mes', 'libro_diario', 'pyg_129', 'sin_sitio'])
    expect(h.filter((x) => x.nivel === 'ambar').map((x) => x.tipo).sort()).toEqual(['fuera_con_saldo', 'otros_resultados', 'por_defecto'])
    for (const x of h) {
      expect(x.donde).toBe('cuenta c01a0000 · empresa 3b34403a')
      expect(x.norma).toBe(NORMAS_LIBROS[x.tipo as keyof typeof NORMAS_LIBROS])
    }
    expect(por.sin_sitio.detalle).toContain('77400000')
    expect(por.sin_sitio.detalle).toContain('pymes no tiene «Diferencia negativa')
    expect(por.libro_diario.detalle).toContain('la 477')
    expect(por.otros_resultados.detalle).toContain('la memoria tiene que explicarlos')
    expect(por.por_defecto.detalle).toContain('2 cuentas con saldo colocadas por defecto')
    expect(por.cerrado_con_asientos.detalle).toContain('General nº 12')
    const t = informeLibros(h, roto.contado)
    expect(t).toContain('**5 en rojo.**')
    expect(t).not.toContain('**En verde**')
  })
})
