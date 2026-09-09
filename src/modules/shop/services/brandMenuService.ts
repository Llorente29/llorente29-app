import { supabase } from '@/lib/supabase'

// Oferta activa de carta (item_percent). wasPrice = ref Ómnibus (min 30d) SOLO si
// hay reducción legal frente a ella; si no, null (no se pinta tachado).
// Promo de carta UNIFICADA (un solo 'offer' con discriminador 'kind'):
//   item_percent: pct por unidad; discountedPrice/wasPrice (tachado Ómnibus).
//   bogo (2x1 / 2ª unidad): pct de la 2ª unidad (100 = 2x1). No cambia el precio
//     unitario; el descuento es de línea, por par (floor(qty/2)). Sin tachado.
export interface DishOffer {
  kind: 'item_percent' | 'bogo'
  campaignId: string
  pct: number
  discountedPrice: number | null   // solo item_percent
  wasPrice: number | null          // solo item_percent
}

export interface MenuDish {
  id: string
  name: string
  description: string | null
  photoUrl: string | null
  price: number
  productType: 'item' | 'combo'
  offer: DishOffer | null
}

export interface MenuCategory {
  id: string
  name: string
  emoji: string | null
  position: number | null
  products: MenuDish[]
}

// Plato de regalo activo ahora de ESTA marca (banner del menú). null = no hay.
// Misma forma que el free_gift de cuenta del hub: { name, min, value }.
export interface MenuGiftInfo {
  name: string
  min: number | null            // "desde X€"; null = sin mínimo
  value: number | null          // precio normal del regalo
}

export interface BrandMenu {
  brandId: string
  name: string
  logoUrl: string | null
  accentColor: string | null
  heroUrl: string | null
  cuisineCode: string | null
  rating: number | null
  ratingCount: number | null
  isOpen: boolean
  locationIds: string[]
  freeDelivery: { active: boolean; minSubtotal: number | null } | null
  gift: MenuGiftInfo | null
  categories: MenuCategory[]
}

export async function getBrandMenu(slug: string, brandId: string): Promise<BrandMenu | null> {
  if (!supabase) throw new Error('Supabase no configurado')
  const { data, error } = await (supabase as any).rpc('shop_brand_menu_by_slug', {
    p_slug: slug,
    p_brand_id: brandId,
  })
  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    brandId: data.brand_id,
    name: data.name ?? '',
    logoUrl: data.logo_url ?? null,
    accentColor: data.accent_color ?? null,
    heroUrl: data.hero_url ?? null,
    cuisineCode: data.cuisine_code ?? null,
    rating: data.rating ?? null,
    ratingCount: data.rating_count ?? null,
    isOpen: data.is_open === true,
    locationIds: Array.isArray(data.location_ids) ? data.location_ids : [],
    freeDelivery: data.free_delivery && data.free_delivery.active
      ? { active: true, minSubtotal: data.free_delivery.minSubtotal != null ? Number(data.free_delivery.minSubtotal) : null }
      : null,
    gift: data.gift && data.gift.name
      ? { name: String(data.gift.name), min: data.gift.min != null ? Number(data.gift.min) : null, value: data.gift.value != null ? Number(data.gift.value) : null }
      : null,
    categories: (data.categories ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      emoji: c.emoji ?? null,
      position: c.position ?? null,
      products: (c.products ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? null,
        photoUrl: p.photo_url ?? null,
        price: Number(p.price ?? 0),
        productType: p.product_type === 'combo' ? 'combo' : 'item',
        offer: p.offer
          ? {
              kind: p.offer.kind === 'bogo' ? 'bogo' : 'item_percent',
              campaignId: p.offer.campaignId,
              pct: Number(p.offer.pct ?? 0),
              discountedPrice: p.offer.discountedPrice != null ? Number(p.offer.discountedPrice) : null,
              wasPrice: p.offer.wasPrice != null ? Number(p.offer.wasPrice) : null,
            }
          : null,
      })),
    }))
    // ── UNA SECCIÓN VACÍA NO SE PINTA EN LA CARTA DEL CLIENTE (09/09) ──────
    // El importador crea una categoría por CATÁLOGO de Last (Glovo, Uber, web,
    // sala…) y los platos cuelgan de una sola, así que las demás quedan vacías:
    // 102 de 182 en Foodint, con «Bebidas» hasta por triplicado. Al cliente eso
    // le llega como tres secciones seguidas, dos sin nada dentro.
    //
    // Esto NO arregla el fondo —las duplicadas se fusionan aparte— pero quita
    // lo que se ve. Y va en el servicio y no en el render a propósito: así
    // desaparecen también de la navegación por secciones y del scroll, que leen
    // esta misma lista. Filtrar sólo al pintar habría dejado pastillas de
    // navegación que llevan a una sección que no existe.
    //
    // OJO, y es lo contrario en la otra pantalla: la de EDICIÓN
    // (`KitchenMenuPage`) sigue enseñando las vacías, y debe seguir haciéndolo
    // — ahí son filas que el usuario abre a propósito para llenarlas o
    // borrarlas, y esconderlas sería la regla 7 al revés.
    .filter((c: MenuCategory) => c.products.length > 0),
  }
}
