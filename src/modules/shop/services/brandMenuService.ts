import { supabase } from '@/lib/supabase'

// Oferta activa de carta (item_percent). wasPrice = ref Ómnibus (min 30d) SOLO si
// hay reducción legal frente a ella; si no, null (no se pinta tachado).
export interface DishOffer {
  campaignId: string
  pct: number
  discountedPrice: number
  wasPrice: number | null
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
              campaignId: p.offer.campaignId,
              pct: Number(p.offer.pct ?? 0),
              discountedPrice: Number(p.offer.discountedPrice ?? 0),
              wasPrice: p.offer.wasPrice != null ? Number(p.offer.wasPrice) : null,
            }
          : null,
      })),
    })),
  }
}
