// tests/conta/cumplimiento/terceros.test.ts
//
// C03 · El agente «Datos maestros e impuestos» sobre los terceros
// (scripts/conta/lib/terceros.mjs). El agente es .mjs y la app TypeScript: las
// reglas son LAS MISMAS y aquí se comprueba sobre poblaciones enteras, no sobre
// tres ejemplos (regla 31): todos los NIF de las fixtures y semillas más un
// barrido de 30.000 generados, y las filas del CSV de Glovo de la fixture
// (que cuadra entera) y esas mismas con el neto movido, con el cuadre de la app.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIMITE_347 as LIMITE_AGENTE, descuadre, informeTerceros, nifValido, revisarTerceros } from '../../../scripts/conta/lib/terceros.mjs'
import { validarNifEs } from '@/modules/conta/lib/nif'
import { LIMITE_347 } from '@/modules/conta/lib/cuentasProveedor'
import { cuadre } from '@/modules/conta/lib/liquidaciones'
import { leerLiquidaciones } from '@/modules/conta/lib/lectorLiquidaciones'

const COSTES = ['delivery_transport', 'promo_product', 'promo_flash', 'offer_flash_credit', 'access_fee', 'prime_fee',
  'recurring_fee', 'incidents_cost', 'incidents_refund', 'min_order_fee', 'other_cost'] as const

describe('el NIF del agente es el de la app', () => {
  it('los NIF de las semillas y fixtures del repositorio', () => {
    const textos = ['supabase/seeds/conta/seed_c03_staging.sql', 'tests/conta/fixtures/liquidaciones/glovo.csv']
      .map((f) => readFileSync(f, 'utf8')).join('\n')
    const nifs = [...new Set(textos.match(/\b[A-Z0-9][0-9]{7}[A-Z0-9]\b/g) ?? [])]
    expect(nifs.length).toBeGreaterThan(3)
    for (const n of nifs) expect(nifValido(n), n).toBe(validarNifEs(n).ok)
  })
  it('un barrido de 30.000 (personas, NIE, especiales y sociedades), válidos e inválidos', () => {
    let x = 12345
    const azar = () => { x = (x * 1103515245 + 12345) % 2147483648; return x }
    const PRIMERA = '0123456789XYZKLMABCDEFGHJNPQRSUVW'
    const ULTIMA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let validos = 0
    for (let i = 0; i < 30000; i++) {
      const n = PRIMERA[azar() % PRIMERA.length] + String(azar() % 10000000).padStart(7, '0') + ULTIMA[azar() % ULTIMA.length]
      const app = validarNifEs(n).ok
      if (app) validos++
      expect(nifValido(n), n).toBe(app)
    }
    expect(validos, 'el barrido tiene válidos de verdad, no solo inválidos').toBeGreaterThan(300)
  })
  it('el límite del 347 es el mismo número', () => {
    expect(LIMITE_AGENTE).toBe(LIMITE_347)
  })
})

describe('el cuadre del agente es el de la app', () => {
  const { filas } = leerLiquidaciones(readFileSync('tests/conta/fixtures/liquidaciones/glovo.csv', 'utf8'))
  const lasDos = (f: (typeof filas)[number], neto: number | null) => {
    const r = f as unknown as Record<string, number | null>
    const app = cuadre({ ventas: f.gross_sales, comision: f.commission ?? null, otros: COSTES.map((k) => Number(r[k] ?? 0)).filter((v) => v !== 0), neto }).descuadre
    const agente = descuadre({ gross_sales: f.gross_sales, commission: f.commission, otros: COSTES.map((k) => r[k] ?? null), net_payout: neto })
    return { app, agente: agente == null ? null : agente / 100 }
  }
  it('cada fila del CSV de Glovo de la fixture: las dos reglas dicen lo mismo (y la fixture cuadra entera)', () => {
    expect(filas.length).toBeGreaterThan(1)
    for (const f of filas) {
      const { app, agente } = lasDos(f, f.net_payout ?? null)
      expect(agente, f.settlement_ref ?? '').toBe(app)
      expect(app, `${f.settlement_ref} cuadra en la fixture`).toBe(0)
    }
  })
  it('las mismas filas con el neto movido: la misma diferencia a los dos lados', () => {
    for (const f of filas) {
      for (const mueve of [0.01, -212.3, 25.5]) {
        const neto = Math.round(((f.net_payout ?? 0) + mueve) * 100) / 100
        const { app, agente } = lasDos(f, neto)
        expect(agente, `${f.settlement_ref} ${mueve}`).toBe(app)
        expect(app).toBe(mueve)
      }
    }
  })
})

describe('revisarTerceros', () => {
  const A = 'cuenta-a'
  const base = {
    terceros: [
      { account_id: A, id: 'p1', name: 'Plataforma Norte', tax_id: 'B91030015', tax_id_type: 'nif_es', archived: false },
      { account_id: A, id: 'p2', name: 'Marcas del Sur', tax_id: 'B91030023', tax_id_type: 'nif_es', archived: false },
      { account_id: A, id: 'p3', name: 'Cliente francés', tax_id: 'FR12345678901', tax_id_type: 'vat_eu', archived: false },
    ],
    cuentas: [{ account_id: A, company_id: 'e', entity: 'customer', entity_id: 'p1', codes: ['43000001'] }],
    liquidaciones: [{ account_id: A, id: 'l1', party_id: 'p1', ref: 'X1', gross_sales: 100, commission: -21, otros: [], net_payout: 79, needs_review: false }],
    ventas_anio: [{ account_id: A, party_id: 'p1', anio: 2026, ventas: 148920 }],
    excluidos_347: [],
  }
  it('lo que está bien no dice nada (el NIF extranjero no se valida como español)', () => {
    expect(revisarTerceros(base)).toEqual([])
    expect(informeTerceros([], { tercerosMirados: 3, liquidacionesMiradas: 1 })).toContain('**Todo cuadra.**')
  })
  it('NIF inválido, NIF repetido, dos subcuentas, descuadre y 347 sin NIF', () => {
    const mal = {
      ...base,
      terceros: [...base.terceros,
        { account_id: A, id: 'p4', name: 'Mal escrito', tax_id: 'B91030010', tax_id_type: 'nif_es', archived: false },
        { account_id: A, id: 'p5', name: 'Otra con el mismo', tax_id: 'B91030015', tax_id_type: null, archived: false },
        { account_id: A, id: 'p6', name: 'Plataforma sin NIF', tax_id: null, tax_id_type: null, archived: false }],
      cuentas: [{ account_id: A, company_id: 'e', entity: 'customer', entity_id: 'p1', codes: ['43000001', '43000009'] }],
      liquidaciones: [{ account_id: A, id: 'l2', party_id: 'p1', ref: 'SEED-0816', gross_sales: 8905, commission: 1870, otros: [], net_payout: 6822.7, needs_review: false }],
      ventas_anio: [{ account_id: A, party_id: 'p6', anio: 2026, ventas: 3005.07 }, { account_id: A, party_id: 'p2', anio: 2026, ventas: 3005.06 }],
    }
    const h = revisarTerceros(mal)
    expect(h.map((x) => `${x.nivel} ${x.tipo}`).sort()).toEqual([
      'ambar neto_descuadrado', 'rojo 347_sin_nif', 'rojo dos_subcuentas', 'rojo nif_invalido', 'rojo nif_repetido',
    ])
    expect(h.find((x) => x.tipo === 'neto_descuadrado')!.detalle).toContain('SEED-0816: faltan 212,30 €')
    expect(h.find((x) => x.tipo === '347_sin_nif')!.detalle).toContain('3.005,07 €')
    // 3.005,06 € justos no entran (el límite es «más de»).
    expect(h.some((x) => x.donde.startsWith('Marcas del Sur'))).toBe(false)
    expect(informeTerceros(h, { tercerosMirados: 6, liquidacionesMiradas: 1 })).toContain('🔴 **4 fallos.**')
  })
  it('excluido del 347: con motivo vale; sin motivo, falla', () => {
    const conVentas = { ...base, terceros: [...base.terceros, { account_id: A, id: 'p6', name: 'Sin NIF', tax_id: null, tax_id_type: null, archived: false }],
      ventas_anio: [{ account_id: A, party_id: 'p6', anio: 2026, ventas: 5000 }] }
    expect(revisarTerceros({ ...conVentas, excluidos_347: [{ account_id: A, party_id: 'p6', motivo: 'Operación con IVA intracomunitario' }] })).toEqual([])
    expect(revisarTerceros({ ...conVentas, excluidos_347: [{ account_id: A, party_id: 'p6', motivo: null }] }).map((x) => x.tipo)).toEqual(['excluido_sin_motivo'])
  })
  it('sin volcado de terceros (base sin C03), nada', () => {
    expect(revisarTerceros(null)).toEqual([])
  })
})
