// B73a (06/09/2026). Un impacto de modificador puede estar «✓ Confirmado» en verde
// y aportar 0,00 € al coste. Esta prueba existe para que eso no se pueda volver a
// pintar de verde.
//
// LA FACTURA. `_impact_cost` tiene CUATRO caminos que devuelven 0 en silencio: sin
// destino, sin cantidad, sin unidad, y unidad no convertible. En Foodint había
// DIEZ impactos `add_item` confirmados sin unidad — todos apuntando a fichas con
// coste, todos aportando cero, todos en verde y contando dentro del «50 % de
// cobertura» que enseñaba la pestaña.
//
// LOS DATOS NO SON INVENTADOS (regla 31). Son los 33 impactos REALES de Foodint
// (51ad1792-…) tal y como estaban ANTES del arreglo — copiados del respaldo
// `_backup_20260906_modifier_recipe_impact`, con el coste real de cada ficha
// destino y las tres unidades reales que aparecen: `ud` (unit, factor 1),
// `g` (weight, factor 1) y `ml` (volume, factor 1).
//
// Y la prueba llevó la contraria a quien la escribió, que es para lo que sirve:
// yo esperaba que el cuarto camino («no convertible») fuera teórico. No lo es.
// «Sweet Chili T» de Big Mike´s cobra 0,60 €, su impacto pide **50 g** y la ficha
// de la salsa está en **ml**. Comprobado contra la base:
// `_impact_cost(...) = 0` y `recipe_item_unit_conversion` no tiene ni una fila
// para esa ficha. 36 líneas en agosto, 21,60 € cobrados, cero de coste.

import { describe, it, expect } from 'vitest'
import {
  resuelveImpacto, cuentaCobertura, pintaComoConfirmado, avisoDeConfirmadoSinCoste,
  unidadRacion, type UnidadPick, type ImpactoResuelto,
} from '../../../../src/modules/kitchen/lib/impactoResuelto'
import type { ImpactType } from '../../../../src/modules/kitchen/services/modifierImpactService'

// ── Las tres unidades reales ────────────────────────────────────────────────
const UD:  UnidadPick = { id: 'u-ud', abreviatura: 'ud', dimension: 'unit',   factorABase: 1 }
const G:   UnidadPick = { id: 'u-g',  abreviatura: 'g',  dimension: 'weight', factorABase: 1 }
const ML:  UnidadPick = { id: 'u-ml', abreviatura: 'ml', dimension: 'volume', factorABase: 1 }
const KG:  UnidadPick = { id: 'u-kg', abreviatura: 'kg', dimension: 'weight', factorABase: 1000 }
const UNIDADES = [UD, G, ML, KG]

// ── La población real, antes del arreglo ────────────────────────────────────
interface Fila {
  opcion: string
  tipo: ImpactType
  cantidad: number | null
  unidad: UnidadPick | null
  costeFicha: number | null   // null = sin ficha destino
  unidadBase: UnidadPick | null
}

const POBLACION: Fila[] = [
  // Los DIEZ sin unidad, que cobran y valen cero.
  { opcion: 'Agua.',                        tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 0.35,               unidadBase: UD },
  { opcion: 'Coca Cola. (33cl)',            tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 0.5909375,          unidadBase: UD },
  { opcion: 'Coca Cola Zero. (33cl)',       tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 0.7675,             unidadBase: UD },
  { opcion: 'Fanta Naranja. (33cl)',        tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 0.495,              unidadBase: UD },
  { opcion: 'Nestea Limón. (33cl)',         tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 0.7999999999999999, unidadBase: UD },
  { opcion: 'Cheesecake de Nutella 🤤',     tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 3.158,              unidadBase: UD },
  { opcion: 'Tarta 3 Leches 🤤',            tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 3.158,              unidadBase: UD },
  { opcion: 'Si, con patatas',              tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 0.876096,           unidadBase: UD },
  { opcion: 'Quiero dos discos de carne',   tipo: 'add_item',     cantidad: 1,   unidad: null, costeFicha: 0.7481690140845071, unidadBase: UD },
  { opcion: 'Base Pollo (The OG)',          tipo: 'add_item',     cantidad: 0.5, unidad: null, costeFicha: 1.506578947368421,  unidadBase: UD },
  // El que sustituye, también sin unidad.
  { opcion: 'Base Ternera (Premium Selection)', tipo: 'replace_item', cantidad: 1, unidad: null, costeFicha: 3.655625,         unidadBase: UD },
  // Los dos `none`: no aportan coste POR DISEÑO. No son un hueco.
  { opcion: 'Solo un disco de carne',       tipo: 'none',         cantidad: null, unidad: null, costeFicha: null,              unidadBase: null },
  { opcion: 'Base Pollo (The OG) [milanesa]', tipo: 'none',       cantidad: 1,    unidad: null, costeFicha: 1.506578947368421, unidadBase: UD },
  { opcion: 'Con Pepinillos',               tipo: 'none',         cantidad: 20,  unidad: G,    costeFicha: 0.008289473684210527, unidadBase: G },
  // EL CUARTO CAMINO, vivo: 50 g contra una ficha en ml, sin conversión.
  { opcion: ' Sweet Chili T',               tipo: 'add_item',     cantidad: 50,  unidad: G,    costeFicha: 0.00514,            unidadBase: ML },
  // Los que SÍ funcionan: 16 `bundle` con unidad y destino, más dos `remove_item`.
  { opcion: 'Bocadillo Bacon Queso',        tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 1.7996365384615385, unidadBase: UD },
  { opcion: 'Bocadillo Clásico',            tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 1.7296731978182636, unidadBase: UD },
  { opcion: 'Bocadillo Club',               tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 1.9619955662393163, unidadBase: UD },
  { opcion: "Bocadillo Mila's",             tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 1.4348782051282052, unidadBase: UD },
  { opcion: 'Bocadillo Parmigiana',         tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 1.516422322775264,  unidadBase: UD },
  { opcion: 'Double Smash Bacon Cheeseburger', tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 3.4055211735324225, unidadBase: UD },
  { opcion: 'Double Smash Cheeseburger',    tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 3.081393253833008,  unidadBase: UD },
  { opcion: 'Fried Chicken Burger',         tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 2.1132869802555168, unidadBase: UD },
  { opcion: 'La Smash Brothers',            tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 3.1768840395223035, unidadBase: UD },
  { opcion: 'La Triple',                    tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 4.001768044759786,  unidadBase: UD },
  { opcion: 'Mahou 5 Estrellas',            tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 0.5092857142857142, unidadBase: UD },
  { opcion: 'Patatas Clásicas',             tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 0.876096,           unidadBase: UD },
  { opcion: 'Patatas Clásicas.',            tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 0.876096,           unidadBase: UD },
  { opcion: 'Smash Bacon Cheeseburger',     tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 2.741327806064457,  unidadBase: UD },
  { opcion: 'Smash Cheeseburger',           tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 2.3024944727311234, unidadBase: UD },
  { opcion: 'Truffled Smash',               tipo: 'bundle', cantidad: 1, unidad: UD, costeFicha: 3.2502138218198073, unidadBase: UD },
  { opcion: 'Sin pepinillos [quitar]',      tipo: 'remove_item', cantidad: 20, unidad: G, costeFicha: 0.008289473684210527, unidadBase: G },
  { opcion: 'Sin pepinillos [grupo pep.]',  tipo: 'remove_item', cantidad: 20, unidad: G, costeFicha: 0.008289473684210527, unidadBase: G },
]

function resuelve(f: Fila): ImpactoResuelto {
  return resuelveImpacto({
    impactType: f.tipo,
    targetRecipeItemId: f.costeFicha === null ? null : 'ficha-' + f.opcion,
    quantity: f.cantidad,
    unitId: f.unidad?.id ?? null,
    ficha: f.costeFicha === null ? null : { costeUnitario: f.costeFicha, baseUnitId: f.unidadBase?.id ?? null },
    unidadDeLaLinea: f.unidad,
    unidadBaseDeLaFicha: f.unidadBase,
  })
}

describe('resuelveImpacto · contra la población real de Foodint', () => {
  it('caza los DIEZ que cobran y valen cero por falta de unidad', () => {
    const sinUnidad = POBLACION
      .filter((f) => f.tipo === 'add_item' && f.unidad === null)
      .map((f) => ({ opcion: f.opcion, r: resuelve(f) }))

    expect(sinUnidad).toHaveLength(10)
    for (const { opcion, r } of sinUnidad) {
      expect(r.estado, opcion).toBe('sin_coste')
      if (r.estado === 'sin_coste') expect(r.motivo, opcion).toBe('le falta la unidad')
    }
  })

  it('el `replace_item` sin unidad también cae, y por lo mismo', () => {
    const r = resuelve(POBLACION.find((f) => f.opcion === 'Base Ternera (Premium Selection)')!)
    expect(r).toEqual({ estado: 'sin_coste', motivo: 'le falta la unidad' })
  })

  it('CUARTO CAMINO: 50 g contra una ficha en ml no resuelve, y NO se pinta verde', () => {
    const r = resuelve(POBLACION.find((f) => f.opcion === ' Sweet Chili T')!)
    expect(r.estado).toBe('no_calculable')
    // Lo que importa de verdad: el motor devuelve 0 y la pantalla no puede decir
    // que está bien.
    expect(pintaComoConfirmado('confirmed', r)).toBe(false)
    expect(avisoDeConfirmadoSinCoste('confirmed', r))
      .toBe('Confirmado, sin poder calcular — necesita una conversión propia de la ficha')
  })

  it('los 16 `bundle` que funcionan dan exactamente el coste de su ficha', () => {
    const bundles = POBLACION.filter((f) => f.tipo === 'bundle')
    expect(bundles).toHaveLength(16)
    for (const f of bundles) {
      const r = resuelve(f)
      expect(r.estado, f.opcion).toBe('con_coste')
      if (r.estado === 'con_coste') expect(r.euros, f.opcion).toBeCloseTo(f.costeFicha!, 10)
    }
  })

  it('«Si, con patatas» con unidad da 0,876096 € — no 1,100176: el envase no entra', () => {
    const r = resuelveImpacto({
      impactType: 'bundle', targetRecipeItemId: 'patatas', quantity: 1, unitId: UD.id,
      // 0,876096 de escandallo. El `packaging_cost` de 0,22408 NO se pasa a propósito:
      // ni `_impact_cost` ni `compute_sale_line_cost` lo leen. Eso es B73b.
      ficha: { costeUnitario: 0.876096, baseUnitId: UD.id },
      unidadDeLaLinea: UD, unidadBaseDeLaFicha: UD,
    })
    expect(r).toEqual({ estado: 'con_coste', euros: 0.876096 })
  })

  it('los `none` no son un hueco: son una respuesta', () => {
    for (const f of POBLACION.filter((x) => x.tipo === 'none')) {
      expect(resuelve(f), f.opcion).toEqual({ estado: 'no_aplica' })
      expect(pintaComoConfirmado('confirmed', resuelve(f)), f.opcion).toBe(true)
    }
  })

  it('convierte entre unidades de la misma dimensión como el motor', () => {
    // 0,5 kg de algo que cuesta 0,004 €/g = 2 €. El motor hace
    // quantity * factor_linea / factor_base = 0,5 * 1000 / 1 = 500 g.
    const r = resuelveImpacto({
      impactType: 'add_item', targetRecipeItemId: 'x', quantity: 0.5, unitId: KG.id,
      ficha: { costeUnitario: 0.004, baseUnitId: G.id },
      unidadDeLaLinea: KG, unidadBaseDeLaFicha: G,
    })
    expect(r).toEqual({ estado: 'con_coste', euros: 2 })
  })

  it('una ficha destino con coste 0 se dice, no se disfraza', () => {
    // Real: «The Parmigiana Vibe» tiene computed_cost 0 y ninguna línea de receta.
    const r = resuelveImpacto({
      impactType: 'bundle', targetRecipeItemId: 'parmigiana-vibe', quantity: 1, unitId: UD.id,
      ficha: { costeUnitario: 0, baseUnitId: UD.id },
      unidadDeLaLinea: UD, unidadBaseDeLaFicha: UD,
    })
    expect(r).toEqual({ estado: 'sin_coste', motivo: 'la ficha de destino no tiene coste' })
  })

  it('sin destino y sin cantidad tienen cada uno su motivo, no un «error»', () => {
    expect(resuelveImpacto({
      impactType: 'add_item', targetRecipeItemId: null, quantity: 1, unitId: UD.id,
      ficha: null, unidadDeLaLinea: UD, unidadBaseDeLaFicha: null,
    })).toEqual({ estado: 'sin_coste', motivo: 'no tiene ficha de destino' })

    expect(resuelveImpacto({
      impactType: 'add_item', targetRecipeItemId: 'x', quantity: null, unitId: UD.id,
      ficha: { costeUnitario: 1, baseUnitId: UD.id }, unidadDeLaLinea: UD, unidadBaseDeLaFicha: UD,
    })).toEqual({ estado: 'sin_coste', motivo: 'no tiene cantidad' })
  })

  it('`multiply` por 1 no cambia nada, y se dice', () => {
    const r = resuelveImpacto({
      impactType: 'multiply', targetRecipeItemId: null, quantity: 1, unitId: null,
      ficha: null, unidadDeLaLinea: null, unidadBaseDeLaFicha: null,
    })
    expect(r).toEqual({ estado: 'sin_coste', motivo: 'multiplica por 1, así que no cambia el coste' })
  })
})

describe('cuentaCobertura · el «50 %» estaba inflado', () => {
  const filas = POBLACION.map((f) => ({ status: 'confirmed' as const, resuelto: resuelve(f) }))

  it('separa los que aportan de los que no, sin esconder a nadie', () => {
    const c = cuentaCobertura(filas)
    expect(c.total).toBe(POBLACION.length)
    // Los 11 sin unidad (10 add_item + 1 replace_item).
    expect(c.sinCoste).toBe(11)
    // El de g→ml.
    expect(c.dudoso).toBe(1)
    // 16 bundle + 2 remove_item + 3 none.
    expect(c.conCoste).toBe(21)
    // Y la suma cierra: nadie se cae de la cuenta (regla 7).
    expect(c.conCoste + c.sinCoste + c.dudoso + c.porRevisar).toBe(c.total)
  })

  it('la cobertura vieja habría dicho 100 %; la nueva dice 64 %', () => {
    const vieja = Math.round((filas.filter((f) => f.status === 'confirmed').length / filas.length) * 100)
    expect(vieja).toBe(100)
    expect(cuentaCobertura(filas).pct).toBe(64)
  })

  it('lo que está por revisar no cuenta como cobertura ni como fallo', () => {
    const c = cuentaCobertura([
      { status: 'proposed', resuelto: { estado: 'con_coste', euros: 1 } },
      { status: null,       resuelto: { estado: 'sin_coste', motivo: 'x' } },
    ])
    expect(c).toEqual({ total: 2, conCoste: 0, sinCoste: 0, dudoso: 0, porRevisar: 2, pct: 0 })
  })
})

describe('unidadRacion · cuando el destino es un plato, la cantidad son raciones', () => {
  it('encuentra la «Unidad (ud)» entre las reales', () => {
    expect(unidadRacion(UNIDADES)?.abreviatura).toBe('ud')
  })

  it('si no hay ninguna de dimensión `unit`, lo dice con null y no inventa una', () => {
    expect(unidadRacion([G, ML, KG])).toBeNull()
  })
})
