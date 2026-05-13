// src/platform/types.ts
// Tipos TypeScript de la capa de plataforma comercial

export type AccountStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'canceled'

export interface Account {
  id: string
  name: string
  legal_name: string | null
  cif: string | null
  billing_email: string | null
  country: string
  timezone: string
  locale: string
  currency: string
  status: AccountStatus
  is_internal: boolean
  trial_ends_at: string | null
  stripe_customer_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ModuleCategory = 'core' | 'operations' | 'sales' | 'integrations' | 'custom'
export type ModuleStatus = 'active' | 'beta' | 'coming_soon' | 'deprecated'

export interface PlatformModule {
  id: string
  code: string
  name: string
  description: string | null
  category: ModuleCategory
  is_base: boolean
  icon: string | null
  status: ModuleStatus
  sort_order: number
}

export type SubmoduleType = 'tier' | 'addon'

export interface Submodule {
  id: string
  module_id: string
  code: string
  name: string
  description: string | null
  type: SubmoduleType
  tier_level: number | null
  features: string[]
  status: ModuleStatus
  sort_order: number
}

export interface BillingPlan {
  id: string
  code: string
  name: string
  description: string | null
  included_submodules: string[]
  base_price_eur: number
  per_location_price: number
  max_locations: number
  max_employees: number
  trial_days: number
  billing_cycle: 'monthly' | 'annual'
  stripe_price_id: string | null
  status: 'active' | 'hidden' | 'legacy'
  sort_order: number
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused'

export interface Subscription {
  id: string
  account_id: string
  plan_id: string | null
  status: SubscriptionStatus
  current_period_start: string
  current_period_end: string
  cancel_at: string | null
  canceled_at: string | null
  trial_ends_at: string | null
  stripe_subscription_id: string | null
  billing_cycle: 'monthly' | 'annual'
}

export type FeatureSource = 'subscription' | 'trial' | 'manual_grant' | 'internal'

export interface FeatureFlag {
  account_id: string
  feature_key: string
  enabled: boolean
  source: FeatureSource
  expires_at: string | null
}

export interface Quota {
  account_id: string
  quota_key: string
  limit_value: number
}

export interface UsageCounter {
  account_id: string
  quota_key: string
  period_start: string
  current_value: number
}

// Estado completo de la capa de plataforma para una cuenta
export interface AccountPlatformState {
  account: Account
  flags: Set<string>             // Set de feature_keys activas (más rápido para lookup)
  quotas: Map<string, number>    // quota_key → limit_value
  usage: Map<string, number>     // quota_key → current_value (periodo actual)
  loadedAt: number               // timestamp para invalidación de cache
}