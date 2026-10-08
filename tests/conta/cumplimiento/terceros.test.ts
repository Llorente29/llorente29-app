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
import { LIMITE_347 as LIMITE_AGENTE, alcance347Plataforma as alcanceAgente, descuadre, informeTerceros, nifValido, nombreNormal, revisarTerceros } from '../../../scripts/conta/lib/terceros.mjs'
import { validarNifEs } from '@/modules/conta/lib/nif'
import { LIMITE_347 } from '@/modules/conta/lib/cuentasProveedor'
import { cuadre } from '@/modules/conta/lib/liquidaciones'
import { alcance347Plataforma } from '@/modules/conta/lib/plataforma347'
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
    ventas_anio: [{ account_id: A, party_id: 'p1', anio: 2026, ventas: 148920, comisiones: 31273.2, modelo: 'revendedor' }],
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
      ventas_anio: [{ account_id: A, party_id: 'p6', anio: 2026, ventas: 3005.07, comisiones: 0, modelo: 'revendedor' },
        { account_id: A, party_id: 'p2', anio: 2026, ventas: 3005.06, comisiones: 0, modelo: 'revendedor' }],
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
      ventas_anio: [{ account_id: A, party_id: 'p6', anio: 2026, ventas: 5000, comisiones: 0, modelo: 'revendedor' }] }
    expect(revisarTerceros({ ...conVentas, excluidos_347: [{ account_id: A, party_id: 'p6', motivo: 'Operación con IVA intracomunitario' }] })).toEqual([])
    expect(revisarTerceros({ ...conVentas, excluidos_347: [{ account_id: A, party_id: 'p6', motivo: null }] }).map((x) => x.tipo)).toEqual(['excluido_sin_motivo'])
  })
  it('el 347 según el modelo (RD 1065/2007, art. 34.3): comisionista, revendedor y sin decir', () => {
    const sinNif = { account_id: A, id: 'p6', name: 'Plataforma sin NIF', tax_id: null, tax_id_type: null, archived: false }
    const con = (v: Record<string, unknown>) => revisarTerceros({ ...base, terceros: [...base.terceros, sinNif],
      ventas_anio: [{ account_id: A, party_id: 'p6', anio: 2026, ...v }] }).map((x) => `${x.nivel} ${x.tipo}`)
    // Comisionista: las ventas, por grandes que sean, no la meten; su comisión sí.
    expect(con({ ventas: 90000, comisiones: 2000, modelo: 'comisionista' })).toEqual([])
    expect(con({ ventas: 90000, comisiones: 3005.07, modelo: 'comisionista' })).toEqual(['rojo 347_proveedor_sin_nif'])
    // 2.500 € + 21 % = 3.025 €: puede pasar, lo dirán sus facturas → ámbar.
    expect(con({ ventas: 90000, comisiones: 2500, modelo: 'comisionista' })).toEqual(['ambar 347_proveedor_sin_nif'])
    // Revendedora: las ventas.
    expect(con({ ventas: 90000, comisiones: 0, modelo: 'revendedor' })).toEqual(['rojo 347_sin_nif'])
    // Sin decir: no se asume ninguno; ámbar, con o sin NIF.
    expect(con({ ventas: 90000, comisiones: 20000, modelo: null })).toEqual(['ambar 347_modelo_sin_decir'])
    expect(revisarTerceros({ ...base, ventas_anio: [{ ...base.ventas_anio[0], modelo: null }] }).map((x) => x.tipo)).toEqual(['347_modelo_sin_decir'])
    expect(con({ ventas: 3005.06, comisiones: 900, modelo: null })).toEqual([])
  })
  // C04 R4 · Un NIF, un tercero activo, y el mismo nombre. La forma es la de
  // producción el 08/10 (solo lectura, nombres cambiados: el repositorio es
  // público): la ficha que trajo el programa anterior, activa y sin NIF, y el
  // proveedor viejo de Cocina, archivado, con el nombre escrito de otra manera
  // («, S.L.» frente a «, SL»). Y el NIF que solo está en la ficha de proveedor
  // (el disparador no se lo da a un segundo tercero).
  it('un NIF en dos activos: rojo; en un activo y un archivado: ámbar (también si solo lo tiene su ficha de proveedor)', () => {
    const t = {
      ...base,
      terceros: [...base.terceros,
        { account_id: A, id: 'd1', name: 'Distribuciones Uno, S.L.', tax_id: 'B91030031', supplier_tax_id: 'B91030031', tax_id_type: 'nif_es', archived: false },
        { account_id: A, id: 'd2', name: 'DISTRIBUCIONES UNO (viejo)', tax_id: null, supplier_tax_id: 'B-91030031', tax_id_type: null, archived: false },
        { account_id: A, id: 'd3', name: 'Envases Dos, S.A.', tax_id: 'B91030049', supplier_tax_id: null, tax_id_type: 'nif_es', archived: false },
        { account_id: A, id: 'd4', name: 'ENVASES DOS antiguo', tax_id: null, supplier_tax_id: 'B91030049', tax_id_type: null, archived: true },
        // Mismo NIF pero en OTRA cuenta (la plantilla comparte nombres y NIF con producción): no es duplicado (regla 9).
        { account_id: 'plantilla', id: 'x1', name: 'Envases Dos, S.A.', tax_id: 'B91030049', supplier_tax_id: null, tax_id_type: null, archived: false }],
    }
    const h = revisarTerceros(t).map((x) => `${x.nivel} ${x.tipo}`).sort()
    expect(h).toEqual(['ambar nif_activo_y_archivado', 'rojo nif_dos_activos'])
  })
  it('el mismo nombre sin NIF que los distinga: ámbar; con NIF distintos, nada', () => {
    const t = {
      ...base,
      terceros: [...base.terceros,
        { account_id: A, id: 'v1', name: 'MARCAS ASOCIADAS PARTNERS, S.L.', tax_id: null, supplier_tax_id: null, tax_id_type: null, archived: false },
        { account_id: A, id: 'v2', name: 'MARCAS ASOCIADAS PARTNERS, SL', tax_id: null, supplier_tax_id: null, tax_id_type: null, archived: true },
        { account_id: A, id: 'w1', name: 'Hermanos García, S.L.', tax_id: 'B91030056', supplier_tax_id: null, tax_id_type: null, archived: false },
        { account_id: A, id: 'w2', name: 'HERMANOS GARCIA SL', tax_id: 'B91030064', supplier_tax_id: null, tax_id_type: null, archived: false },
        // Dos archivados con el mismo nombre: ya no molestan a nadie.
        { account_id: A, id: 'z1', name: 'Viejo, S.L.', tax_id: null, supplier_tax_id: null, tax_id_type: null, archived: true },
        { account_id: A, id: 'z2', name: 'VIEJO SL', tax_id: null, supplier_tax_id: null, tax_id_type: null, archived: true }],
    }
    const h = revisarTerceros(t)
    expect(h.map((x) => `${x.nivel} ${x.tipo}`)).toEqual(['ambar nombre_repetido'])
    expect(h[0].detalle).toContain('MARCAS ASOCIADAS PARTNERS, SL (archivado)')
    expect(nombreNormal('MARCAS ASOCIADAS PARTNERS, S.L.')).toBe(nombreNormal('Marcas Asociadas Partners SL'))
    expect(nombreNormal('Lácteos Ñandú, S.A.U.')).toBe('lacteos nandu')
  })
  it('sin volcado de terceros (base sin C03), nada', () => {
    expect(revisarTerceros(null)).toEqual([])
  })
})

describe('el 347 de una plataforma: el agente y la ficha dicen lo mismo', () => {
  it('un barrido de modelos, ventas y comisiones alrededor del límite', () => {
    const importes = [0, 1, 2483.52, 2483.53, 2483.54, 2500, 3005.05, 3005.06, 3005.07, 3500, 148920, -2600, -3005.07]
    let n = 0
    for (const modelo of [null, 'comisionista', 'revendedor'] as const) {
      for (const ventas of importes) for (const comisiones of importes) {
        expect(alcanceAgente(modelo, ventas, comisiones), `${modelo} ${ventas} ${comisiones}`).toEqual(alcance347Plataforma(modelo, ventas, comisiones))
        n++
      }
    }
    expect(n).toBe(3 * importes.length ** 2)
  })
})
