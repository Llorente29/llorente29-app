// src/modules/kitchen/services/vatRateService.ts
//
// DE QUÉ TIPO DE IVA ES UN ARTÍCULO — 31/08/2026.
//
// Decisión de Julio (31/08): el tipo es del ARTÍCULO, la costumbre de meterlo
// o no en el importe de línea es del PROVEEDOR. Son dos ejes distintos y no se
// mezclan: `supplier.iva_incluido_en_linea` dice CÓMO escribe sus importes;
// de QUÉ tipo son responde este módulo, leyendo el modelo fiscal que ya existe
// en producción desde antes (`vat_category` / `vat_rate` / `family_vat_default`).
//
// Por eso NO hay un `default_vat_rate` en `supplier`: sería una tercera verdad
// sobre el tipo, compitiendo con la del artículo y ganándole por estar más a
// mano. Un mismo pollo al 10 % lo factura AMIRSA con el IVA dentro y Makro con
// base imponible; el 10 % es del pollo en los dos casos.
//
// LA CASCADA, Y DÓNDE SE PARA
//   1. `recipe_item.vat_category_id` → el tipo vigente de esa categoría.
//   2. Si no tiene: `family_vat_default` por el NOMBRE de su familia.
//   3. Si tampoco: NO SE RESUELVE. Devuelve rate null y la pantalla lo dice y
//      pide el tipo, en vez de suponerlo.
//
// DOS FRENOS QUE EVITAN SUPONER, y que salen de los propios datos:
//
//   · `family_vat_default.is_mixed` — 6 de las 16 familias mapeadas están
//     marcadas como MIXTAS (Bebidas sin alcohol, Congelados, Charcutería…).
//     Mixta significa «esta familia tiene varios tipos»: su defecto no decide
//     nada. Una familia mixta NO resuelve, pregunta.
//
//   · `recipe_item.vat_category_source` — el modelo fiscal distingue
//     'proposed' de 'confirmed' precisamente para no mentir en silencio. Una
//     categoría solo propuesta SÍ resuelve (es la mejor respuesta que hay) pero
//     viaja marcada, para que la pantalla lo diga en vez de presentarla como un
//     hecho. Verificado el 31/08: los dos artículos del ALB-00134 (Kebab Pollo
//     y Kebab Ternera Loncheado, familia «Carnes y aves») están en
//     'alimento_general' = 10 %, y su source es 'proposed'.
//
// ESTADO REAL DEL CATÁLOGO (31/08, contado en producción)
//   1.072 artículos · 273 con categoría propia (25 %) · 16 familias mapeadas,
//   6 de ellas mixtas. O sea: hoy el camino MAYORITARIO es el que pregunta.
//   Eso no es un fallo de este módulo, es el estado del catálogo fiscal — y es
//   la razón por la que preguntar tiene que quedar bien resuelto en pantalla,
//   no ser un caso raro de esquina.

import { supabase, isSupabaseEnabled } from '../../../lib/supabase'

/** De dónde sale el tipo. `ninguno` = no se sabe: hay que preguntarlo. */
export type OrigenTipoIva = 'articulo' | 'familia' | 'ninguno'

export interface TipoIvaResuelto {
  itemId: string
  /** Tipo en PORCENTAJE (10, no 0,10). null = no se ha podido resolver. */
  rate: number | null
  origen: OrigenTipoIva
  categoriaNombre: string | null
  familiaNombre: string | null
  /** La categoría del artículo está 'proposed', no confirmada por nadie. */
  soloPropuesta: boolean
  /** Su familia está marcada como mixta: tiene varios tipos y no decide. */
  familiaMixta: boolean
}

/** No se sabe nada de este artículo. Se pregunta. */
function sinResolver(itemId: string, familiaNombre: string | null, familiaMixta: boolean): TipoIvaResuelto {
  return {
    itemId, rate: null, origen: 'ninguno',
    categoriaNombre: null, familiaNombre, soloPropuesta: false, familiaMixta,
  }
}

type Row = Record<string, unknown>

/**
 * Resuelve el tipo de IVA de varios artículos a la vez.
 *
 * Nunca lanza: si algo falla, ese artículo sale `sinResolver` y la pantalla
 * pregunta. Un fallo leyendo el catálogo fiscal no puede convertirse en un
 * tipo inventado — el coste del almacén sale de aquí.
 */
export async function resolveVatRates(itemIds: string[]): Promise<Record<string, TipoIvaResuelto>> {
  const ids = Array.from(new Set(itemIds.filter(Boolean)))
  if (!isSupabaseEnabled || !supabase || ids.length === 0) return {}
  const sb = supabase

  try {
    // Los tres catálogos son GLOBALES y diminutos (5 categorías, 6 tipos, 16
    // familias el 31/08): se traen enteros en vez de filtrar por ids, que sería
    // más código para menos datos.
    const [itemsRes, catsRes, ratesRes, famDefRes] = await Promise.all([
      sb.from('recipe_item').select('id, family_id, vat_category_id, vat_category_source').in('id', ids),
      sb.from('vat_category').select('id, code, name'),
      sb.from('vat_rate').select('category_id, rate, valid_from, valid_to'),
      sb.from('family_vat_default').select('family_name, vat_category_id, is_mixed'),
    ])
    if (itemsRes.error) throw itemsRes.error
    if (catsRes.error) throw catsRes.error
    if (ratesRes.error) throw ratesRes.error
    if (famDefRes.error) throw famDefRes.error

    const items = (itemsRes.data as Row[]) ?? []

    // Las familias, solo las que hagan falta.
    const familyIds = Array.from(new Set(
      items.map(i => i.family_id).filter((x): x is string => typeof x === 'string'),
    ))
    let familyNames: Record<string, string> = {}
    if (familyIds.length > 0) {
      const famRes = await sb.from('recipe_family').select('id, name').in('id', familyIds)
      if (famRes.error) throw famRes.error
      familyNames = Object.fromEntries(
        ((famRes.data as Row[]) ?? []).map(f => [f.id as string, f.name as string]),
      )
    }

    const catName: Record<string, string> = Object.fromEntries(
      ((catsRes.data as Row[]) ?? []).map(c => [c.id as string, c.name as string]),
    )

    // Tipo VIGENTE HOY de cada categoría. El modelo versiona por fecha (el
    // aceite de oliva estuvo al 2 % hasta el 31/12/2024 y hoy está al 4 %), así
    // que hay que elegir la fila vigente, no la primera que llegue.
    const hoy = new Date().toISOString().slice(0, 10)
    const rateOfCat: Record<string, number> = {}
    for (const r of ((ratesRes.data as Row[]) ?? [])) {
      const from = (r.valid_from as string | null) ?? '0000-01-01'
      const to = r.valid_to as string | null
      if (from <= hoy && (to == null || to >= hoy)) {
        rateOfCat[r.category_id as string] = Number(r.rate)
      }
    }

    const famDef: Record<string, { catId: string | null; mixed: boolean }> = Object.fromEntries(
      ((famDefRes.data as Row[]) ?? []).map(f => [
        f.family_name as string,
        { catId: (f.vat_category_id as string | null) ?? null, mixed: f.is_mixed === true },
      ]),
    )

    const out: Record<string, TipoIvaResuelto> = {}
    for (const it of items) {
      const itemId = it.id as string
      const familiaNombre = typeof it.family_id === 'string' ? familyNames[it.family_id] ?? null : null
      const def = familiaNombre ? famDef[familiaNombre] : undefined
      const familiaMixta = def?.mixed === true

      // 1) La categoría del propio artículo manda.
      const catId = (it.vat_category_id as string | null) ?? null
      if (catId && rateOfCat[catId] != null) {
        out[itemId] = {
          itemId,
          rate: rateOfCat[catId],
          origen: 'articulo',
          categoriaNombre: catName[catId] ?? null,
          familiaNombre,
          soloPropuesta: (it.vat_category_source as string | null) !== 'confirmed',
          familiaMixta,
        }
        continue
      }

      // 2) La familia, SOLO si no es mixta. Mixta = «tiene varios tipos»: su
      //    defecto no es una respuesta, es una lista de candidatos.
      if (def && !def.mixed && def.catId && rateOfCat[def.catId] != null) {
        out[itemId] = {
          itemId,
          rate: rateOfCat[def.catId],
          origen: 'familia',
          categoriaNombre: catName[def.catId] ?? null,
          familiaNombre,
          soloPropuesta: false,
          familiaMixta: false,
        }
        continue
      }

      // 3) No se sabe. Se pregunta.
      out[itemId] = sinResolver(itemId, familiaNombre, familiaMixta)
    }

    // Un artículo que ni siquiera existe en recipe_item también se pregunta.
    for (const id of ids) if (!out[id]) out[id] = sinResolver(id, null, false)
    return out
  } catch (e) {
    console.error('[vatRateService] resolveVatRates', e)
    return Object.fromEntries(ids.map(id => [id, sinResolver(id, null, false)]))
  }
}

/**
 * La frase que explica de dónde sale el tipo. Va en pantalla, junto al número:
 * un tipo sin procedencia es indistinguible de uno inventado.
 */
export function explicaOrigen(t: TipoIvaResuelto | undefined): string | null {
  if (!t || t.rate == null) return null
  if (t.origen === 'articulo') {
    return t.soloPropuesta
      ? `por su categoría fiscal (${t.categoriaNombre ?? '?'}), propuesta y aún sin confirmar`
      : `por su categoría fiscal (${t.categoriaNombre ?? '?'})`
  }
  return `por su familia «${t.familiaNombre ?? '?'}» (${t.categoriaNombre ?? '?'})`
}

/** Por qué NO se sabe el tipo. Se dice, no se rellena con un 10 por defecto. */
export function explicaFalta(t: TipoIvaResuelto | undefined): string {
  if (t?.familiaMixta) {
    return `Su familia «${t.familiaNombre}» tiene varios tipos de IVA, así que no se puede deducir. Elige el que ponga el albarán.`
  }
  if (t?.familiaNombre) {
    return `Este artículo no tiene categoría fiscal y su familia «${t.familiaNombre}» tampoco está mapeada. Elige el tipo que ponga el albarán.`
  }
  return 'Este artículo no tiene categoría fiscal, así que no se puede deducir el tipo. Elige el que ponga el albarán.'
}
