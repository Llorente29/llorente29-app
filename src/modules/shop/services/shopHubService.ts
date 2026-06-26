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

export interface ShopHub {
  accountName: string
  slug: string
  heroUrl: string | null
  tagline: string | null
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
    slug: data.slug ?? slug,
    heroUrl: data.hero_url ?? null,
    tagline: data.tagline ?? null,
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
