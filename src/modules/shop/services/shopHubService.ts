import { supabase } from '@/lib/supabase'

export interface HubBrand {
  brandId: string
  name: string
  logoUrl: string | null
  heroUrl: string | null
  accentColor: string | null
  template: string | null
  position: number | null
  rating: number | null
  ratingCount: number | null
  cuisineCode: string | null
  cuisineLabel: string | null
  cuisineEmoji: string | null
  isOpen: boolean
  // Mejor oferta activa ahora que toca esta marca (badge del hub). kind: 'bogo'
  // gana a 'item_percent' ("2x1" vende más que "−20%").
  offer: { kind: 'bogo' | 'item_percent'; pct: number; multi: boolean } | null
}

export interface TopDish {
  menuItemId: string
  name: string
  photoUrl: string | null
  price: number
  brandId: string
  brandName: string
  units: number
}

// Envío gratis a nivel TIENDA (cupón free_delivery auto activo ahora). null = no hay.
export interface FreeDeliveryInfo {
  active: boolean
  minSubtotal: number | null    // null = en todos los pedidos
}

export interface ShopHub {
  accountName: string
  accountLogoUrl: string | null
  slug: string
  heroUrl: string | null
  tagline: string | null
  subtitle: string | null
  freeDelivery: FreeDeliveryInfo | null
  brands: HubBrand[]
  topDishes: TopDish[]
}

export async function getShopHub(slug: string): Promise<ShopHub | null> {
  if (!supabase) throw new Error('Supabase no configurado')
  const { data, error } = await (supabase as any).rpc('shop_hub_by_slug', { p_slug: slug })
  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    accountName: data.account_name ?? '',
    accountLogoUrl: data.account_logo_url ?? null,
    slug: data.slug ?? slug,
    heroUrl: data.hero_url ?? null,
    tagline: data.tagline ?? null,
    subtitle: data.subtitle ?? null,
    freeDelivery: data.free_delivery && data.free_delivery.active
      ? { active: true, minSubtotal: data.free_delivery.minSubtotal != null ? Number(data.free_delivery.minSubtotal) : null }
      : null,
    brands: (data.brands ?? []).map((b: any) => ({
      brandId: b.brand_id,
      name: b.name,
      logoUrl: b.logo_url ?? null,
      heroUrl: b.hero_url ?? null,
      accentColor: b.accent_color ?? null,
      template: b.template ?? null,
      position: b.position ?? null,
      rating: b.rating ?? null,
      ratingCount: b.rating_count ?? null,
      cuisineCode: b.cuisine_code ?? null,
      cuisineLabel: b.cuisine_label ?? null,
      cuisineEmoji: b.cuisine_emoji ?? null,
      isOpen: b.is_open === true,
      offer: b.offer && b.offer.pct != null
        ? { kind: b.offer.kind === 'bogo' ? 'bogo' : 'item_percent', pct: Number(b.offer.pct), multi: b.offer.multi === true }
        : null,
    })),
    topDishes: (data.top_dishes ?? []).map((t: any) => ({
      menuItemId: t.menu_item_id,
      name: t.name,
      photoUrl: t.photo_url ?? null,
      price: Number(t.price ?? 0),
      brandId: t.brand_id,
      brandName: t.brand_name,
      units: Number(t.units ?? 0),
    })),
  }
}
