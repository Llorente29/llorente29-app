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
}

export interface DeliveryInfo {
  etaMin: number | null
  deliveryFeeMin: number | null
  minOrder: number | null
}

export interface ShopHub {
  accountName: string
  slug: string
  heroUrl: string | null
  tagline: string | null
  brands: HubBrand[]
  deliveryInfo: DeliveryInfo
}

export async function getShopHub(slug: string): Promise<ShopHub | null> {
  if (!supabase) throw new Error('Supabase no configurado')
  const { data, error } = await (supabase as any).rpc('shop_hub_by_slug', { p_slug: slug })
  if (error) throw new Error(error.message)
  if (!data) return null

  const di = data.delivery_info ?? {}
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
    })),
    deliveryInfo: {
      etaMin: di.eta_min ?? null,
      deliveryFeeMin: di.delivery_fee_min ?? null,
      minOrder: di.min_order ?? null,
    },
  }
}
