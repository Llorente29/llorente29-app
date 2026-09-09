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
//   seed_catalog_canonical(p_account_id uuid, p_dry_run boolean,
//                          p_margen_foto interval)
//     → TABLE(dry_run bool, matriculas_miradas int, base_ya_existentes int,
//             productos_base_creados int, overrides_creados int,
//             overrides_de_foto_vieja int, saltados_sin_marca int,
//             saltados_por_ser_propia int, saltados_por_no_estar_en_la_foto int,
//             marcas_sin_resolver text[], marcas_propias_saltadas text[],
//             no_en_la_foto jsonb, fotos jsonb)
//   recast_lastapp_sales(p_account_id uuid, p_incluir_bajo_conteo bool,
//                        p_ventas_esperadas int)
//     → TABLE(ventas_procesadas int, ventas_protegidas int,
//             corte_en timestamptz, lineas_total int, lineas_casadas int,
//             lineas_no_brand int, lineas_no_recipe int, lineas_no_menu_item int,
//             lineas_ambiguous int, lineas_respetadas int)
// Y FILA_SEED no es un ejemplo: es la fila que devolvió el ensayo corriendo
// contra Foodint el 09/09, copiada tal cual. Las de recast son las medidas del
// mismo día (8.245 ventas protegidas por el corte).
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
  dry_run: true,
  matriculas_miradas: 419,
  base_ya_existentes: 307,
  productos_base_creados: 17,
  overrides_creados: 43,
  overrides_de_foto_vieja: 2,
  saltados_sin_marca: 18,
  saltados_por_ser_propia: 65,
  saltados_por_no_estar_en_la_foto: 12,
  marcas_sin_resolver: ['Van Van'],
  marcas_propias_saltadas: [
    'Smash Brothers Burgers', 'Meraki Pita', 'Dirty Burgers', 'Milanesa House', 'Bendito Burrito',
  ],
  no_en_la_foto: [
    { marca: 'Dos Coyotes', producto: 'PACK UNO PA UNO DC', visto_por_ultima_vez: '2026-06-21T16:08:19.11+00:00' },
    { marca: 'Chivuos', producto: 'CHIVUO´S®️ BURGER (CH)', visto_por_ultima_vez: '2026-08-30T20:00:09.895+00:00' },
  ],
  fotos: [
    { org: 'b7bc4753-575c-42e1-bf97-ed61443f639b', ultima_foto: '2026-09-08T23:00:10.179+00:00', horas: 10.5, filas: 3360 },
    { org: '31f13f35-be2e-4806-8be4-a7589c1cbf71', ultima_foto: '2026-09-05T23:00:08.69+00:00', horas: 82.5, filas: 1084 },
  ],
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
    await seedCatalogCanonical(CUENTA, true)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][0]).toBe('seed_catalog_canonical')
  })

  it('p_dry_run viaja SIEMPRE y viaja tal cual: no hay llamada sin decir si escribe', async () => {
    rpc.mockResolvedValue({ data: [FILA_SEED], error: null })
    await seedCatalogCanonical(CUENTA, true)
    expect(rpc.mock.calls[0][1]).toEqual({ p_account_id: CUENTA, p_dry_run: true })
    rpc.mockClear()
    await seedCatalogCanonical(CUENTA, false)
    expect(rpc.mock.calls[0][1]).toEqual({ p_account_id: CUENTA, p_dry_run: false })
  })

  it('mapea la fila entera del ensayo real de Foodint', async () => {
    rpc.mockResolvedValue({ data: [FILA_SEED], error: null })
    const r = await seedCatalogCanonical(CUENTA, true)
    expect(r.dryRun).toBe(true)
    expect(r.matriculasMiradas).toBe(419)
    expect(r.baseYaExistentes).toBe(307)
    expect(r.productosBaseCreados).toBe(17)
    expect(r.overridesCreados).toBe(43)
    expect(r.overridesDeFotoVieja).toBe(2)
    expect(r.saltadosSinMarca).toBe(18)
    expect(r.saltadosPorSerPropia).toBe(65)
    expect(r.saltadosPorNoEstarEnLaFoto).toBe(12)
  })

  it('las cinco partes suman las matrículas miradas: la pantalla se puede cuadrar', async () => {
    rpc.mockResolvedValue({ data: [FILA_SEED], error: null })
    const r = await seedCatalogCanonical(CUENTA, true)
    expect(
      r.baseYaExistentes + r.productosBaseCreados + r.saltadosSinMarca
      + r.saltadosPorSerPropia + r.saltadosPorNoEstarEnLaFoto,
    ).toBe(r.matriculasMiradas)
  })

  it('trae los NOMBRES de lo que deja fuera, no sólo el número (regla 7)', async () => {
    rpc.mockResolvedValue({ data: [FILA_SEED], error: null })
    const r = await seedCatalogCanonical(CUENTA, true)
    expect(r.marcasSinResolver).toEqual(['Van Van'])
    expect(r.marcasPropiasSaltadas).toContain('Milanesa House')
    expect(r.marcasPropiasSaltadas).toHaveLength(5)
    expect(r.noEnLaFoto[0]).toEqual({
      producto: 'PACK UNO PA UNO DC',
      marca: 'Dos Coyotes',
      vistoPorUltimaVez: '2026-06-21T16:08:19.11+00:00',
    })
    expect(r.fotos[1].horas).toBe(82.5)
  })

  it('dry_run false no se confunde con true: el eco se lee del dato, no de lo que se pidió', async () => {
    rpc.mockResolvedValue({ data: [{ ...FILA_SEED, dry_run: false }], error: null })
    expect((await seedCatalogCanonical(CUENTA, true)).dryRun).toBe(false)
  })

  it('los enteros que PostgREST manda como texto siguen siendo números', async () => {
    rpc.mockResolvedValue({ data: [{ ...FILA_SEED, productos_base_creados: '17' }], error: null })
    expect((await seedCatalogCanonical(CUENTA, true)).productosBaseCreados).toBe(17)
  })

  it('sin filas devuelve ceros y listas vacías, no undefined pintado como NaN', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const r = await seedCatalogCanonical(CUENTA, true)
    expect(r.matriculasMiradas).toBe(0)
    expect(r.productosBaseCreados).toBe(0)
    expect(r.marcasSinResolver).toEqual([])
    expect(r.noEnLaFoto).toEqual([])
    expect(r.fotos).toEqual([])
  })

  it('un error de la RPC se propaga con su mensaje, no se traga', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'sin acceso a la cuenta' } })
    await expect(seedCatalogCanonical(CUENTA, true)).rejects.toThrow(/sin acceso a la cuenta/)
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
