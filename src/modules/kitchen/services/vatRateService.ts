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
// ESTADO REAL DEL CATÁLOGO (31/08, contado en produccion, SOLO Foodint y solo
// articulos activos — corregido por Julio: la primera cuenta miraba
// `recipe_item` entera, que es multi-cuenta e incluye el catalogo plantilla de
// «Folvy Interno» (625 articulos) y «Kitchen Grill LstQ» (56). Leer una tabla
// multi-cuenta sin su account_id da un numero que no es de nadie.)
//
//   352 articulos activos · 188 con categoria propia (53 %)
//   de esas 188: 43 CONFIRMADAS y 145 solo PROPUESTAS
//   16 familias mapeadas, 6 de ellas mixtas
//
// O sea: la mayoria SI resuelve, pero casi todo lo que resuelve lo hace con una
// categoria que nadie ha confirmado. Son dos trabajos distintos y los dos se
// hacen desde la misma pantalla: 164 fichas sin categoria que hay que rellenar,
// y 145 propuestas que hay que confirmar.

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
  /**
   * ¿Se puede OFRECER guardar la respuesta en la ficha? Solo si la migración
   * que crea las columnas de procedencia ya está aplicada. Antes de eso el
   * botón no aparece: ofrecer un guardado que va a dar 400 es peor que no
   * ofrecerlo.
   */
  puedeGuardarse: boolean
}

/** No se sabe nada de este artículo. Se pregunta. */
function sinResolver(
  itemId: string, familiaNombre: string | null, familiaMixta: boolean, puedeGuardarse = false,
): TipoIvaResuelto {
  return {
    itemId, rate: null, origen: 'ninguno',
    categoriaNombre: null, familiaNombre, soloPropuesta: false, familiaMixta, puedeGuardarse,
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
      // select('*') a proposito: pedir por nombre una columna que aun no existe
      // da un 400 de PostgREST. Asi esto funciona igual antes y despues de
      // aplicar la migracion, y ademas permite DETECTAR si ya esta aplicada
      // mirando si la fila trae la clave (mismo truco que notify_group).
      sb.from('recipe_item').select('*').in('id', ids),
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
      // La migracion de procedencia, ¿esta aplicada? La fila lo dice.
      const puedeGuardarse = 'vat_category_origin' in it

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
          puedeGuardarse,
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
          puedeGuardarse,
        }
        continue
      }

      // 3) No se sabe. Se pregunta.
      out[itemId] = sinResolver(itemId, familiaNombre, familiaMixta, puedeGuardarse)
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


// ═══════════════════════════════════════════════════════════════════════════
// QUE EL CATÁLOGO FISCAL SE COMPLETE CON EL TRABAJO DIARIO
// Añadido al alcance por Julio (31/08): cuando la recepción pregunta el tipo
// porque no se sabía, la pantalla OFRECE guardarlo en la ficha del artículo
// como categoría confirmada, con su origen anotado.
//
// NUNCA EN SILENCIO. Se ofrece, no se escribe solo. De ahí que esto sea una
// función suelta que solo se llama desde un botón, y no algo que ocurra dentro
// de `resolveVatRates` ni al guardar la línea.
// ═══════════════════════════════════════════════════════════════════════════

export interface CategoriaFiscal {
  id: string
  code: string
  name: string
  /** Tipo vigente HOY de esta categoría, en porcentaje. */
  rate: number
}

/**
 * Las categorías vigentes que llevan ESE tipo.
 *
 * Devuelve una LISTA, no una categoría, porque un tipo NO identifica una
 * categoría — verificado el 31/08 en producción:
 *     4 %  -> Alimento básico  |  Aceite de oliva
 *    10 %  -> Alimento general                      (la única sin ambigüedad)
 *    21 %  -> Bebida o azúcar  |  No alimentario
 *
 * Por eso guardar «el 10 %» en la ficha se puede hacer de un toque, pero
 * guardar «el 21 %» obliga a elegir cuál de las dos. Escoger por él sería
 * meter una categoría inventada en la tabla que esto viene a mejorar: el
 * artículo quedaría CONFIRMADO y mal, que es peor que quedarse vacío.
 */
export async function categoriasParaTipo(rate: number): Promise<CategoriaFiscal[]> {
  if (!isSupabaseEnabled || !supabase || !Number.isFinite(rate)) return []
  const sb = supabase
  try {
    const [catsRes, ratesRes] = await Promise.all([
      sb.from('vat_category').select('id, code, name, is_active'),
      sb.from('vat_rate').select('category_id, rate, valid_from, valid_to'),
    ])
    if (catsRes.error) throw catsRes.error
    if (ratesRes.error) throw ratesRes.error

    const hoy = new Date().toISOString().slice(0, 10)
    const vigente: Record<string, number> = {}
    for (const r of ((ratesRes.data as Row[]) ?? [])) {
      const from = (r.valid_from as string | null) ?? '0000-01-01'
      const to = r.valid_to as string | null
      if (from <= hoy && (to == null || to >= hoy)) vigente[r.category_id as string] = Number(r.rate)
    }

    return ((catsRes.data as Row[]) ?? [])
      .filter(c => (c.is_active ?? true) === true)
      .map(c => ({ id: c.id as string, code: c.code as string, name: c.name as string, rate: vigente[c.id as string] }))
      .filter(c => c.rate != null && Math.abs(c.rate - rate) < 0.001)
  } catch (e) {
    console.error('[vatRateService] categoriasParaTipo', e)
    return []
  }
}

/**
 * Guarda la categoría fiscal en la ficha del artículo, CONFIRMADA y con su
 * origen anotado. Solo se llama desde el botón que lo ofrece.
 *
 * LANZA si falla, a propósito: quien lo llama tiene que poder decirlo en
 * pantalla (regla 8). Un guardado de catálogo que falla en silencio deja al
 * usuario creyendo que ha clasificado un artículo que sigue sin clasificar, y
 * la próxima recepción se lo vuelve a preguntar sin explicar por qué.
 *
 * RLS: `recipe_item_update` exige admin o encargado de la cuenta. Si quien
 * verifica no lo es, esto falla con el mensaje de PostgREST y la pantalla lo
 * enseña — no se esconde el botón, porque en oficina lo normal es tener
 * permiso y esconderlo confundiría más que el error.
 */
export async function confirmaCategoriaFiscal(args: {
  itemId: string
  categoryId: string
  /** Texto legible de dónde sale. Ej.: «recepción ALB-00134 (AMIRSA)». */
  origen: string
  actorId?: string | null
}): Promise<void> {
  if (!isSupabaseEnabled || !supabase) throw new Error('Supabase no está configurado.')
  // Casteado porque las tres columnas de procedencia aun no estan en los tipos
  // autogenerados (la migracion entra manana). Mismo patron que notify_group.
  const parche: Record<string, unknown> = {
    vat_category_id: args.categoryId,
    vat_category_source: 'confirmed',
    vat_category_origin: args.origen,
    vat_category_set_at: new Date().toISOString(),
    vat_category_set_by: args.actorId ?? null,
  }
  const { error } = await supabase
    .from('recipe_item')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(parche as any)
    .eq('id', args.itemId)
  if (error) throw new Error(`No se pudo guardar la categoría fiscal: ${error.message}`)
}
