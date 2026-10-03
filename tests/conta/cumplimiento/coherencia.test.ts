// tests/conta/cumplimiento/coherencia.test.ts
//
// Respuesta 3 del C00, punto 4: el agente comprueba COHERENCIA, no recuentos
// (scripts/conta/lib/coherencia.mjs). Contra la población real (regla 31):
// el catálogo del IAE y la CNAE, las filas de serie, las pantallas de verdad
// del módulo y lo que había en staging la primera vez que corrió.
//
// Y una cosa más: el agente es .mjs (corre en Actions sin compilar) y la app
// es TypeScript. Las reglas son LAS MISMAS; aquí se comprueba que dicen lo
// mismo sobre toda la población, no sobre tres ejemplos.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import ref from '../../../docs/conta/referencia/serie.json'
import staging from './datos/coherencia-staging-20261003.json'
import {
  coherenciaModelos as coherenciaAgente, esHosteleria as hosteleriaAgente, huecosDeVigencia, pantallasConCuentaCorta,
  revisarCoherencia, informeCoherencia,
} from '../../../scripts/conta/lib/coherencia.mjs'
import { coherenciaModelos } from '@/modules/conta/lib/modelos'
import { esHosteleria } from '@/modules/conta/lib/ivaVentas'
import { aReglaModelo } from '@/modules/conta/services/modelosService'

type Fila = Record<string, unknown>
const TAX_FORM = (ref.tablas.tax_form.filas as Fila[])
const REGLAS = TAX_FORM.map(aReglaModelo)
const sql = readFileSync('supabase/migrations/20261003T0130_c00_valores_de_serie.sql', 'utf8')
const bloque = (tabla: string) => { const i = sql.indexOf(`insert into public.${tabla}`); return sql.slice(i, sql.indexOf(';\n', i)) }
const IAE = [...bloque('iae_heading').matchAll(/\('([0-9_]+)', '([123])'/g)].map((m) => m[1])
const CNAE = [...bloque('cnae_code').matchAll(/\('2025', '([0-9A-Z]+)'/g)].map((m) => m[1])
const bd = (extra: Fila = {}) => ({ tablas: { tax_form: TAX_FORM, tax_rate: ref.tablas.tax_rate.filas, withholding_rate: ref.tablas.withholding_rate.filas }, ...extra })

function ficheros(dir: string): { ruta: string; texto: string }[] {
  return readdirSync(dir).flatMap((n) => {
    const r = join(dir, n)
    return statSync(r).isDirectory() ? ficheros(r) : /\.(ts|tsx)$/.test(n) ? [{ ruta: r, texto: readFileSync(r, 'utf8') }] : []
  })
}

describe('el agente y la app dicen lo mismo (toda la población, no ejemplos)', () => {
  it('modelos: los 2.048 juegos posibles de los 11 modelos de la tabla, sociedad o autónomo, con y sin SII', () => {
    const codigos = TAX_FORM.map((f) => String(f.code))
    expect(codigos.length).toBe(11)
    let vistos = 0
    for (let mascara = 0; mascara < 1 << codigos.length; mascara++) {
      const modelos = codigos.filter((_, i) => mascara & (1 << i))
      for (const tipo of ['company', 'self_employed'] as const) for (const sii of [false, true]) {
        const app = coherenciaModelos(modelos, REGLAS, { tipo, sii }).map((x) => `${x.clave} ${x.modelo}`)
        const agente = coherenciaAgente(modelos, TAX_FORM, { tipo, sii }).map((x: { clave: string; modelo: string }) => `${x.clave} ${x.modelo}`)
        expect(agente, JSON.stringify({ modelos, tipo, sii })).toEqual(app)
        vistos++
      }
    }
    expect(vistos).toBe(8192)
  })
  it('hostelería: todos los códigos del IAE y de la CNAE-2025 cargados', () => {
    expect(IAE.length).toBeGreaterThan(1000)
    expect(CNAE.length).toBeGreaterThan(1000)
    for (const c of IAE) expect(hosteleriaAgente(c, null), c).toBe(esHosteleria({ iaeCode: c, cnaeCode: null }))
    for (const c of CNAE) expect(hosteleriaAgente(null, c), c).toBe(esHosteleria({ iaeCode: null, cnaeCode: c }))
  })
})

describe('lo que está bien no avisa', () => {
  it('la serie de impuestos y retenciones no tiene huecos; los plazos de serie no pasan de 60 días', () => {
    expect(huecosDeVigencia(ref.tablas.tax_rate.filas as Fila[])).toEqual([])
    expect(huecosDeVigencia(ref.tablas.withholding_rate.filas as Fila[])).toEqual([])
    expect(revisarCoherencia(bd({ plazos: staging.plazos }))).toEqual([])
  })
  it('ninguna pantalla del módulo enseña una cuenta de apunte con el código corto', () => {
    expect(pantallasConCuentaCorta(ficheros('src/modules/conta').map((f) => ({ ...f, ruta: f.ruta.replace(/\\/g, '/') })))).toEqual([])
  })
  it('una sociedad como la que deja el alta nueva es coherente', () => {
    const e = { account_id: 'x', legal_name: 'Nueva', entity_kind: 'company', completa: true, tax_territory: 'peninsula_baleares', sii: false,
      tax_forms: ['111', '115', '180', '190', '200', '202', '303', '347', '390'], sales_tax_rate_code: 'iva_reducido', account_digits: 8,
      actividades: [{ description: 'Comida a domicilio', iae_code: '1_6779', cnae_code: '5611', ended_on: null }] }
    expect(revisarCoherencia(bd({ empresas: [e] }))).toEqual([])
  })
})

describe('lo que está mal falla en rojo, con el caso y su norma', () => {
  it('FALLOS REALES · staging 03/10: lo que había antes de la respuesta 3', () => {
    const r = revisarCoherencia(bd({ ...staging })).map((x: { nivel: string; tipo: string; donde: string; detalle: string }) => `${x.nivel} ${x.tipo} · ${x.donde.split(' (')[0]} · ${x.detalle}`)
    expect(r).toEqual([
      'rojo modelos · Taberna de Prueba Norte, S.L. · Presenta el 111 y no su resumen anual, el 190.',
      'rojo modelos · Taberna de Prueba Norte, S.L. · Presenta el 202 y no su resumen anual, el 200.',
      'rojo iva_ventas · Taberna de Prueba Norte, S.L. · Es hostelería y el IVA de sus ventas está en nada, no en el 10 %.',
      // El caso de Julio, literal: «a Llorente29 la IA le puso 111, 115, 202, 303 y 390».
      'rojo modelos · Llorente29 Food, S.L. · Presenta el 111 y no su resumen anual, el 190.',
      'rojo modelos · Llorente29 Food, S.L. · Presenta el 202 y no su resumen anual, el 200.',
      'rojo modelo_347 · Llorente29 Food, S.L. · Es una sociedad fuera del SII y no tiene el 347.',
      'rojo modelos · Llorente29 Food, S.L. · Presenta el 115 y no su resumen anual, el 180.',
      'rojo iva_ventas · Llorente29 Food, S.L. · Es hostelería y el IVA de sus ventas está en nada, no en el 10 %.',
      'rojo modelos · Cocina de Prueba Sur, S.L. · Presenta el 111 y no su resumen anual, el 190.',
      'rojo modelo_347 · Cocina de Prueba Sur, S.L. · Es una sociedad fuera del SII y no tiene el 347.',
    ])
  })
  it('cada fallo lleva su norma', () => {
    for (const x of revisarCoherencia(bd({ ...staging }))) expect(x.norma, x.detalle).toBeTruthy()
  })
  it('un hueco de un día en un tipo real', () => {
    const filas = (ref.tablas.tax_rate.filas as Fila[]).map((f) => ({ ...f }))
    const reducido = filas.find((f) => f.code === 'iva_reducido')!
    filas.push({ ...reducido, valid_from: '2010-07-01', valid_to: '2012-08-30' }) // acaba el 30/08 y el siguiente empieza el 01/09
    expect(huecosDeVigencia(filas)).toEqual([{ code: 'iva_reducido', desde: '2012-08-31', hasta: '2012-09-01', norma: reducido.legal_ref }])
  })
  it('plazos de más de 60 días, en Tablas o en un proveedor (Ley 3/2004, art. 4.3)', () => {
    const r = revisarCoherencia(bd({
      plazos: [...staging.plazos, { account_id: 'c01a0000-x', is_system: false, code: 'p', name: '30, 60 y 90', days: [30, 60, 90] }],
      proveedores_plazo: [{ account_id: 'c01a0000-x', name: 'Hermanos Ruiz', payment_terms_days: 90 }],
    }))
    expect(r.map((x: { detalle: string; norma: string }) => `${x.detalle} ${x.norma}`)).toEqual([
      'Pasa de 60 días: 30, 60, 90. Ley 3/2004, art. 4.3', 'Paga a 90 días, más de 60. Ley 3/2004, art. 4.3',
    ])
  })
  it('epígrafe sin CNAE, y epígrafe y CNAE que no casan', () => {
    const e = (actividades: Fila[]) => ({ account_id: 'x', legal_name: 'E', entity_kind: 'self_employed', completa: true, tax_territory: 'canarias',
      tax_forms: [], sii: false, sales_tax_rate_code: null, account_digits: 8, actividades })
    const r = revisarCoherencia(bd({ empresas: [
      e([{ description: 'Bar', iae_code: '1_673', cnae_code: null, ended_on: null }]),
      e([{ description: 'Bar', iae_code: '1_673', cnae_code: '4711', ended_on: null }]),
    ] }))
    expect(r.map((x: { tipo: string }) => x.tipo)).toEqual(['iae_cnae', 'iae_cnae'])
  })
  it('una cuenta de apunte más corta que la de la empresa, en los datos y en una pantalla', () => {
    const r = revisarCoherencia(bd({ cuentas_apunte: [{ account_id: 'x', name: 'Hermanos Ruiz', ledger_account_code: '4000001', account_digits: 8 }] }),
      { ficheros: [{ ruta: 'src/modules/conta/apartados/Nueva.tsx', texto: "<span>{cuentaPgc('472')}</span>" }] })
    expect(r.map((x: { detalle: string }) => x.detalle)).toEqual([
      'Su cuenta 4000001 tiene 7 dígitos y la empresa usa 8.',
      'Enseña una cuenta con el código corto del plan (cuentaPgc) donde va la cuenta de apunte completa.',
    ])
  })
  it('el informe lo dice en lenguaje normal, con la norma de cada caso', () => {
    const t = informeCoherencia(revisarCoherencia(bd({ ...staging })), { empresasMiradas: 3 })
    expect(t).toContain('🔴 **10 fallos.**')
    expect(t).toContain('- **Llorente29 Food, S.L. (cuenta c01a0000)**: Presenta el 111 y no su resumen anual, el 190. _(RD 439/2007 (Reglamento del IRPF), art. 108.2)_')
  })
})
