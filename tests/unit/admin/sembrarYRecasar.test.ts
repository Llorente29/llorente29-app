// Sembrar y recasar: dos botones, dos llamadas, y sus cifras.
//
// POR QUÉ EXISTE ESTA PRUEBA. Hasta el 09/09 la UI llamaba a las dos RPC y
// TIRABA lo que devolvían («No se parsean los contadores de retorno a
// propósito»), así que un nombre de columna mal escrito no lo notaba nadie:
// el contador salía a 0 y el 0 parecía un dato. Ahora las cifras se pintan, y
// un mapeo mal puesto es una pantalla que MIENTE con números — peor que no
// decir nada (regla 8).
//
// LAS FILAS DE ABAJO NO SON INVENTADAS (regla 31). Los nombres de columna
// salen de la firma real de la base, leída el 09/09:
//   seed_catalog_canonical(p_account_id uuid)
//     → TABLE(productos_base_creados int, overrides_creados int,
//             saltados_sin_marca int, base_ya_existentes int)
//   recast_lastapp_sales(p_account_id uuid, p_incluir_bajo_conteo bool,
//                        p_ventas_esperadas int)
//     → TABLE(ventas_procesadas int, ventas_protegidas int,
//             corte_en timestamptz, lineas_total int, lineas_casadas int,
//             lineas_no_brand int, lineas_no_recipe int, lineas_no_menu_item int,
//             lineas_ambiguous int, lineas_respetadas int)
// Y las cifras son las medidas en el dry_run de Foodint (94 base + 49
// overrides; 8.245 ventas protegidas por el corte).
//
// OJO al ámbito, que es lo que hace falsable esta prueba: de recast, solo
// `ventas_protegidas` y `corte_en` hablan de la pasada. Las `lineas_*` son el
// estado del casado de TODA la cuenta. La pantalla las etiqueta como tales.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc },
  isSupabaseEnabled: true,
}))

import { seedCatalogCanonical, recastLastappSales } from '@/admin/services/lastappIntegrationService'

const CUENTA = '11111111-1111-1111-1111-111111111111'

const FILA_SEED = {
  productos_base_creados: 94,
  overrides_creados: 49,
  saltados_sin_marca: 0,
  base_ya_existentes: 158,
}

const FILA_RECAST = {
  ventas_procesadas: 8253,
  ventas_protegidas: 8245,
  corte_en: '2026-09-08T20:43:11.512+00:00',
  lineas_total: 21140,
  lineas_casadas: 20918,
  lineas_no_brand: 0,
  lineas_no_recipe: 137,
  lineas_no_menu_item: 46,
  lineas_ambiguous: 3,
  lineas_respetadas: 36,
}

beforeEach(() => { rpc.mockReset() })

describe('seedCatalogCanonical', () => {
  it('llama SOLO a seed_catalog_canonical: sembrar ya no arrastra el recasado', async () => {
    rpc.mockResolvedValue({ data: [FILA_SEED], error: null })
    await seedCatalogCanonical(CUENTA)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('seed_catalog_canonical', { p_account_id: CUENTA })
  })

  it('mapea las cuatro columnas reales', async () => {
    rpc.mockResolvedValue({ data: [FILA_SEED], error: null })
    expect(await seedCatalogCanonical(CUENTA)).toEqual({
      productosBaseCreados: 94,
      overridesCreados: 49,
      saltadosSinMarca: 0,
      baseYaExistentes: 158,
    })
  })

  it('los enteros que PostgREST manda como texto siguen siendo números', async () => {
    rpc.mockResolvedValue({ data: [{ ...FILA_SEED, productos_base_creados: '94' }], error: null })
    const r = await seedCatalogCanonical(CUENTA)
    expect(r.productosBaseCreados).toBe(94)
  })

  it('sin filas devuelve ceros, no undefined pintado como NaN', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await seedCatalogCanonical(CUENTA)).toEqual({
      productosBaseCreados: 0, overridesCreados: 0, saltadosSinMarca: 0, baseYaExistentes: 0,
    })
  })

  it('un error de la RPC se propaga con su mensaje, no se traga', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'sin acceso a la cuenta' } })
    await expect(seedCatalogCanonical(CUENTA)).rejects.toThrow(/sin acceso a la cuenta/)
  })
})

describe('recastLastappSales', () => {
  it('llama SOLO a recast_lastapp_sales: recasar ya no exige sembrar antes', async () => {
    rpc.mockResolvedValue({ data: [FILA_RECAST], error: null })
    await recastLastappSales(CUENTA)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('recast_lastapp_sales', { p_account_id: CUENTA })
  })

  it('NO manda p_incluir_bajo_conteo: bajar del corte no es un botón de pantalla (regla 6)', async () => {
    rpc.mockResolvedValue({ data: [FILA_RECAST], error: null })
    await recastLastappSales(CUENTA)
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(args)).toEqual(['p_account_id'])
  })

  it('mapea las diez columnas reales', async () => {
    rpc.mockResolvedValue({ data: [FILA_RECAST], error: null })
    expect(await recastLastappSales(CUENTA)).toEqual({
      ventasProcesadas: 8253,
      ventasProtegidas: 8245,
      corteEn: '2026-09-08T20:43:11.512+00:00',
      lineasTotal: 21140,
      lineasCasadas: 20918,
      lineasNoBrand: 0,
      lineasNoRecipe: 137,
      lineasNoMenuItem: 46,
      lineasAmbiguous: 3,
      lineasRespetadas: 36,
    })
  })

  it('trae ventas_protegidas y corte_en, que los tipos generados NO conocen', async () => {
    rpc.mockResolvedValue({ data: [FILA_RECAST], error: null })
    const r = await recastLastappSales(CUENTA)
    expect(r.ventasProtegidas).toBe(8245)
    expect(r.corteEn).toBe('2026-09-08T20:43:11.512+00:00')
  })

  it('sin conteo cerrado, corte_en llega NULL y no se inventa una fecha', async () => {
    rpc.mockResolvedValue({ data: [{ ...FILA_RECAST, corte_en: null, ventas_protegidas: 0 }], error: null })
    const r = await recastLastappSales(CUENTA)
    expect(r.corteEn).toBeNull()
    expect(r.ventasProtegidas).toBe(0)
  })

  it('un error de la RPC se propaga con su mensaje', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'p_ventas_esperadas=0 no coincide' } })
    await expect(recastLastappSales(CUENTA)).rejects.toThrow(/no coincide/)
  })
})
