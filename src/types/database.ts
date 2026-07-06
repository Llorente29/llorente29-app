export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _backup_20260516_accounts: {
        Row: {
          billing_address: Json | null
          billing_email: string | null
          billing_phone: string | null
          cif: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          id: string | null
          is_internal: boolean | null
          legal_name: string | null
          locale: string | null
          metadata: Json | null
          name: string | null
          status: string | null
          stripe_customer_id: string | null
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          is_internal?: boolean | null
          legal_name?: string | null
          locale?: string | null
          metadata?: Json | null
          name?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          is_internal?: boolean | null
          legal_name?: string | null
          locale?: string | null
          metadata?: Json | null
          name?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20260516_accounts_pre_slug: {
        Row: {
          billing_address: Json | null
          billing_email: string | null
          billing_phone: string | null
          cif: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          id: string | null
          is_internal: boolean | null
          legal_name: string | null
          locale: string | null
          metadata: Json | null
          name: string | null
          status: string | null
          stripe_customer_id: string | null
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          is_internal?: boolean | null
          legal_name?: string | null
          locale?: string | null
          metadata?: Json | null
          name?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          id?: string | null
          is_internal?: boolean | null
          legal_name?: string | null
          locale?: string | null
          metadata?: Json | null
          name?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20260516_billing_plans: {
        Row: {
          base_price_eur: number | null
          billing_cycle: string | null
          code: string | null
          created_at: string | null
          description: string | null
          id: string | null
          included_submodules: string[] | null
          max_employees: number | null
          max_locations: number | null
          name: string | null
          per_location_price: number | null
          sort_order: number | null
          status: string | null
          stripe_price_id: string | null
          trial_days: number | null
          updated_at: string | null
        }
        Insert: {
          base_price_eur?: number | null
          billing_cycle?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          included_submodules?: string[] | null
          max_employees?: number | null
          max_locations?: number | null
          name?: string | null
          per_location_price?: number | null
          sort_order?: number | null
          status?: string | null
          stripe_price_id?: string | null
          trial_days?: number | null
          updated_at?: string | null
        }
        Update: {
          base_price_eur?: number | null
          billing_cycle?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          included_submodules?: string[] | null
          max_employees?: number | null
          max_locations?: number | null
          name?: string | null
          per_location_price?: number | null
          sort_order?: number | null
          status?: string | null
          stripe_price_id?: string | null
          trial_days?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20260516_feature_flags: {
        Row: {
          account_id: string | null
          created_at: string | null
          enabled: boolean | null
          expires_at: string | null
          feature_key: string | null
          granted_by: string | null
          source: string | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          enabled?: boolean | null
          expires_at?: string | null
          feature_key?: string | null
          granted_by?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          enabled?: boolean | null
          expires_at?: string | null
          feature_key?: string | null
          granted_by?: string | null
          source?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20260516_functions: {
        Row: {
          args: string | null
          body: string | null
          prokind: unknown
          proname: unknown
          provolatile: unknown
          returns: string | null
          security_definer: boolean | null
        }
        Insert: {
          args?: string | null
          body?: string | null
          prokind?: unknown
          proname?: unknown
          provolatile?: unknown
          returns?: string | null
          security_definer?: boolean | null
        }
        Update: {
          args?: string | null
          body?: string | null
          prokind?: unknown
          proname?: unknown
          provolatile?: unknown
          returns?: string | null
          security_definer?: boolean | null
        }
        Relationships: []
      }
      _backup_20260516_modules: {
        Row: {
          category: string | null
          code: string | null
          created_at: string | null
          description: string | null
          icon: string | null
          id: string | null
          is_base: boolean | null
          name: string | null
          sort_order: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          is_base?: boolean | null
          name?: string | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          code?: string | null
          created_at?: string | null
          description?: string | null
          icon?: string | null
          id?: string | null
          is_base?: boolean | null
          name?: string | null
          sort_order?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20260516_policies: {
        Row: {
          cmd: string | null
          permissive: string | null
          policyname: unknown
          roles: unknown[] | null
          schemaname: unknown
          tablename: unknown
          using_expression: string | null
          with_check: string | null
        }
        Insert: {
          cmd?: string | null
          permissive?: string | null
          policyname?: unknown
          roles?: unknown[] | null
          schemaname?: unknown
          tablename?: unknown
          using_expression?: string | null
          with_check?: string | null
        }
        Update: {
          cmd?: string | null
          permissive?: string | null
          policyname?: unknown
          roles?: unknown[] | null
          schemaname?: unknown
          tablename?: unknown
          using_expression?: string | null
          with_check?: string | null
        }
        Relationships: []
      }
      _backup_20260516_submodules: {
        Row: {
          code: string | null
          created_at: string | null
          description: string | null
          features: Json | null
          id: string | null
          module_id: string | null
          name: string | null
          sort_order: number | null
          status: string | null
          tier_level: number | null
          type: string | null
          updated_at: string | null
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          features?: Json | null
          id?: string | null
          module_id?: string | null
          name?: string | null
          sort_order?: number | null
          status?: string | null
          tier_level?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          features?: Json | null
          id?: string | null
          module_id?: string | null
          name?: string | null
          sort_order?: number | null
          status?: string | null
          tier_level?: number | null
          type?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_20260516_user_profiles: {
        Row: {
          active: boolean | null
          created_at: string | null
          display_name: string | null
          employee_id: string | null
          id: string | null
          role: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          display_name?: string | null
          employee_id?: string | null
          id?: string | null
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          display_name?: string | null
          employee_id?: string | null
          id?: string | null
          role?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      _backup_20260517_user_profiles_read_policy: {
        Row: {
          cmd: string | null
          old_qual: string | null
          policy_name: string | null
        }
        Insert: {
          cmd?: string | null
          old_qual?: string | null
          policy_name?: string | null
        }
        Update: {
          cmd?: string | null
          old_qual?: string | null
          policy_name?: string | null
        }
        Relationships: []
      }
      account_connector: {
        Row: {
          account_id: string
          archived_at: string | null
          brand_id: string | null
          config: Json | null
          connected_at: string | null
          connected_by: string | null
          connector_id: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          credentials_ref: string | null
          external_account_id: string | null
          id: string
          is_active: boolean
          last_error: string | null
          last_sync_at: string | null
          location_id: string | null
          requested_at: string | null
          requested_by: string | null
          scope: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          brand_id?: string | null
          config?: Json | null
          connected_at?: string | null
          connected_by?: string | null
          connector_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          credentials_ref?: string | null
          external_account_id?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          location_id?: string | null
          requested_at?: string | null
          requested_by?: string | null
          scope?: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          brand_id?: string | null
          config?: Json | null
          connected_at?: string | null
          connected_by?: string | null
          connector_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          credentials_ref?: string | null
          external_account_id?: string | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          location_id?: string | null
          requested_at?: string | null
          requested_by?: string | null
          scope?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_connector_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_connector_connector_id_fkey"
            columns: ["connector_id"]
            isOneToOne: false
            referencedRelation: "connector"
            referencedColumns: ["id"]
          },
        ]
      }
      account_discount: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          created_by: string | null
          discount_type: string
          id: string
          note: string | null
          valid_until: string | null
          value: number
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          discount_type: string
          id?: string
          note?: string | null
          valid_until?: string | null
          value: number
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          discount_type?: string
          id?: string
          note?: string | null
          valid_until?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "account_discount_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_email_log: {
        Row: {
          account_id: string
          error_message: string | null
          id: string
          recipient_employee_id: string
          resend_email_id: string | null
          sender_employee_id: string | null
          sender_user_id: string
          sent_at: string
          status: string
          subject: string
          template: string
          to_email: string
        }
        Insert: {
          account_id: string
          error_message?: string | null
          id?: string
          recipient_employee_id: string
          resend_email_id?: string | null
          sender_employee_id?: string | null
          sender_user_id: string
          sent_at?: string
          status: string
          subject: string
          template: string
          to_email: string
        }
        Update: {
          account_id?: string
          error_message?: string | null
          id?: string
          recipient_employee_id?: string
          resend_email_id?: string | null
          sender_employee_id?: string | null
          sender_user_id?: string
          sent_at?: string
          status?: string
          subject?: string
          template?: string
          to_email?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_email_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_email_log_recipient_employee_id_fkey"
            columns: ["recipient_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_email_log_sender_employee_id_fkey"
            columns: ["sender_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      account_gestoria_config: {
        Row: {
          account_id: string
          created_at: string
          day_of_month: number
          enabled: boolean
          gestoria_email: string
          gestoria_nombre: string
          last_sent_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          day_of_month?: number
          enabled?: boolean
          gestoria_email?: string
          gestoria_nombre?: string
          last_sent_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          day_of_month?: number
          enabled?: boolean
          gestoria_email?: string
          gestoria_nombre?: string
          last_sent_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_gestoria_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          archived_at: string | null
          billing_address: Json | null
          billing_email: string | null
          billing_phone: string | null
          cif: string | null
          country: string
          created_at: string
          created_by: string | null
          currency: string | null
          deleted_at: string | null
          id: string
          is_internal: boolean
          legal_name: string | null
          locale: string | null
          logo_url: string | null
          metadata: Json | null
          name: string
          past_due_at: string | null
          shop_coupon_margin_floor_pct: number | null
          shop_fee_bps: number
          shop_hero_url: string | null
          shop_logo_url: string | null
          shop_pay_cash_delivery: boolean
          shop_pay_cash_pickup: boolean
          shop_pay_online: boolean
          shop_subtitle: string | null
          shop_tagline: string | null
          slug: string
          status: string
          stripe_account_id: string | null
          stripe_charges_enabled: boolean
          stripe_customer_id: string | null
          stripe_details_submitted: boolean
          suspended_at: string | null
          suspended_by: string | null
          suspension_reason: string | null
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          deleted_at?: string | null
          id?: string
          is_internal?: boolean
          legal_name?: string | null
          locale?: string | null
          logo_url?: string | null
          metadata?: Json | null
          name: string
          past_due_at?: string | null
          shop_coupon_margin_floor_pct?: number | null
          shop_fee_bps?: number
          shop_hero_url?: string | null
          shop_logo_url?: string | null
          shop_pay_cash_delivery?: boolean
          shop_pay_cash_pickup?: boolean
          shop_pay_online?: boolean
          shop_subtitle?: string | null
          shop_tagline?: string | null
          slug: string
          status?: string
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_details_submitted?: boolean
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          deleted_at?: string | null
          id?: string
          is_internal?: boolean
          legal_name?: string | null
          locale?: string | null
          logo_url?: string | null
          metadata?: Json | null
          name?: string
          past_due_at?: string | null
          shop_coupon_margin_floor_pct?: number | null
          shop_fee_bps?: number
          shop_hero_url?: string | null
          shop_logo_url?: string | null
          shop_pay_cash_delivery?: boolean
          shop_pay_cash_pickup?: boolean
          shop_pay_online?: boolean
          shop_subtitle?: string | null
          shop_tagline?: string | null
          slug?: string
          status?: string
          stripe_account_id?: string | null
          stripe_charges_enabled?: boolean
          stripe_customer_id?: string | null
          stripe_details_submitted?: boolean
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_run_log: {
        Row: {
          account_id: string
          campaigns_created: number
          decisions: Json
          id: string
          ran_at: string
          signals: Json
        }
        Insert: {
          account_id: string
          campaigns_created?: number
          decisions: Json
          id?: string
          ran_at?: string
          signals: Json
        }
        Update: {
          account_id?: string
          campaigns_created?: number
          decisions?: Json
          id?: string
          ran_at?: string
          signals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_run_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_action: {
        Row: {
          account_id: string
          agent: string
          args: Json
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          effect_preview: Json | null
          error_message: string | null
          executed_at: string | null
          id: string
          proposed_by: string | null
          result: Json | null
          risk: string
          rollback_hint: Json | null
          session_id: string | null
          status: string
          summary: string
          target_id: string | null
          target_table: string | null
          tool_name: string
        }
        Insert: {
          account_id: string
          agent: string
          args?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          effect_preview?: Json | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          proposed_by?: string | null
          result?: Json | null
          risk?: string
          rollback_hint?: Json | null
          session_id?: string | null
          status?: string
          summary: string
          target_id?: string | null
          target_table?: string | null
          tool_name: string
        }
        Update: {
          account_id?: string
          agent?: string
          args?: Json
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          effect_preview?: Json | null
          error_message?: string | null
          executed_at?: string | null
          id?: string
          proposed_by?: string | null
          result?: Json | null
          risk?: string
          rollback_hint?: Json | null
          session_id?: string | null
          status?: string
          summary?: string
          target_id?: string | null
          target_table?: string | null
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_action_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_interaction: {
        Row: {
          account_id: string
          created_at: string
          duration_ms: number | null
          error_message: string | null
          id: string
          model: string | null
          module: string | null
          request: Json
          response: Json | null
          session_id: string | null
          status: string
          surface: string
          tokens_in: number | null
          tokens_out: number | null
          tools_used: Json | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          model?: string | null
          module?: string | null
          request: Json
          response?: Json | null
          session_id?: string | null
          status?: string
          surface: string
          tokens_in?: number | null
          tokens_out?: number | null
          tools_used?: Json | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          model?: string | null
          module?: string | null
          request?: Json
          response?: Json | null
          session_id?: string | null
          status?: string
          surface?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tools_used?: Json | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_interaction_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_memory: {
        Row: {
          account_id: string
          confidence: number | null
          created_at: string
          id: string
          key: string
          scope: string
          source: string
          updated_at: string
          value: Json
        }
        Insert: {
          account_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          key: string
          scope: string
          source?: string
          updated_at?: string
          value: Json
        }
        Update: {
          account_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          key?: string
          scope?: string
          source?: string
          updated_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_memory_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      allergen: {
        Row: {
          code: string
          created_at: string
          eu_reference: string
          icon: string
          name_en: string
          name_es: string
          position: number
        }
        Insert: {
          code: string
          created_at?: string
          eu_reference: string
          icon: string
          name_en: string
          name_es: string
          position?: number
        }
        Update: {
          code?: string
          created_at?: string
          eu_reference?: string
          icon?: string
          name_en?: string
          name_es?: string
          position?: number
        }
        Relationships: []
      }
      analysis_account: {
        Row: {
          account_id: string
          account_type: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          account_type?: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          account_type?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "analysis_account_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analysis_account_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "analysis_account"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          account_id: string | null
          created_at: string
          forgot_clockout_min: number
          id: string
          late_alert_min: number
          rounding_tolerance_min: number
          scope: string
          show_hour_bank_to_employee: boolean
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          forgot_clockout_min?: number
          id?: string
          late_alert_min?: number
          rounding_tolerance_min?: number
          scope?: string
          show_hour_bank_to_employee?: boolean
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          forgot_clockout_min?: number
          id?: string
          late_alert_min?: number
          rounding_tolerance_min?: number
          scope?: string
          show_hour_bank_to_employee?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_account_fk"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_audit_items: {
        Row: {
          code: string
          creates_incident_on_fail: boolean | null
          display_order: number | null
          help_text: string | null
          id: string
          incident_severity: string | null
          question: string
          scoring_type: string | null
          section_id: string
          weight: number | null
        }
        Insert: {
          code: string
          creates_incident_on_fail?: boolean | null
          display_order?: number | null
          help_text?: string | null
          id?: string
          incident_severity?: string | null
          question: string
          scoring_type?: string | null
          section_id: string
          weight?: number | null
        }
        Update: {
          code?: string
          creates_incident_on_fail?: boolean | null
          display_order?: number | null
          help_text?: string | null
          id?: string
          incident_severity?: string | null
          question?: string
          scoring_type?: string | null
          section_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_audit_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "appcc_audit_sections"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_audit_log: {
        Row: {
          account_id: string
          entity_id: string
          entity_type: string
          event_data: Json
          event_type: string
          id: string
          ip_address: unknown
          location_id: string | null
          performed_at: string
          performed_by: string | null
          user_agent: string | null
        }
        Insert: {
          account_id: string
          entity_id: string
          entity_type: string
          event_data?: Json
          event_type: string
          id?: string
          ip_address?: unknown
          location_id?: string | null
          performed_at?: string
          performed_by?: string | null
          user_agent?: string | null
        }
        Update: {
          account_id?: string
          entity_id?: string
          entity_type?: string
          event_data?: Json
          event_type?: string
          id?: string
          ip_address?: unknown
          location_id?: string | null
          performed_at?: string
          performed_by?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_audit_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audit_log_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_audit_response_photos: {
        Row: {
          caption: string | null
          id: string
          response_id: string
          storage_path: string
          taken_at: string | null
          taken_by: string | null
        }
        Insert: {
          caption?: string | null
          id?: string
          response_id: string
          storage_path: string
          taken_at?: string | null
          taken_by?: string | null
        }
        Update: {
          caption?: string | null
          id?: string
          response_id?: string
          storage_path?: string
          taken_at?: string | null
          taken_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_audit_response_photos_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "appcc_audit_responses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audit_response_photos_taken_by_fkey"
            columns: ["taken_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_audit_responses: {
        Row: {
          answered_at: string | null
          answered_by: string | null
          audit_id: string
          id: string
          incident_id: string | null
          item_id: string
          notes: string | null
          value: string | null
        }
        Insert: {
          answered_at?: string | null
          answered_by?: string | null
          audit_id: string
          id?: string
          incident_id?: string | null
          item_id: string
          notes?: string | null
          value?: string | null
        }
        Update: {
          answered_at?: string | null
          answered_by?: string | null
          audit_id?: string
          id?: string
          incident_id?: string | null
          item_id?: string
          notes?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_audit_responses_answered_by_fkey"
            columns: ["answered_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audit_responses_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "appcc_audits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audit_responses_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "appcc_incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audit_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "appcc_audit_items"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_audit_schedules: {
        Row: {
          account_id: string
          created_at: string | null
          day_of_month: number | null
          id: string
          is_active: boolean | null
          location_id: string
          next_due_date: string | null
          recurrence: string
          template_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          day_of_month?: number | null
          id?: string
          is_active?: boolean | null
          location_id: string
          next_due_date?: string | null
          recurrence: string
          template_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          day_of_month?: number | null
          id?: string
          is_active?: boolean | null
          location_id?: string
          next_due_date?: string | null
          recurrence?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_audit_schedules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "appcc_audit_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_audit_sections: {
        Row: {
          code: string
          description: string | null
          display_order: number | null
          id: string
          name: string
          template_id: string
          weight: number | null
        }
        Insert: {
          code: string
          description?: string | null
          display_order?: number | null
          id?: string
          name: string
          template_id: string
          weight?: number | null
        }
        Update: {
          code?: string
          description?: string | null
          display_order?: number | null
          id?: string
          name?: string
          template_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_audit_sections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "appcc_audit_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_audit_templates: {
        Row: {
          account_id: string
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_seed: boolean | null
          name: string
          pass_score: number | null
          recurrence: string | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_seed?: boolean | null
          name: string
          pass_score?: number | null
          recurrence?: string | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_seed?: boolean | null
          name?: string
          pass_score?: number | null
          recurrence?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      appcc_audits: {
        Row: {
          account_id: string
          auditor_id: string | null
          auditor_name: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          final_score: number | null
          id: string
          location_id: string
          notes: string | null
          passed: boolean | null
          scheduled_date: string
          signature: string | null
          started_at: string | null
          started_by: string | null
          status: string | null
          template_id: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          auditor_id?: string | null
          auditor_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          final_score?: number | null
          id?: string
          location_id: string
          notes?: string | null
          passed?: boolean | null
          scheduled_date: string
          signature?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string | null
          template_id: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          auditor_id?: string | null
          auditor_name?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          final_score?: number | null
          id?: string
          location_id?: string
          notes?: string | null
          passed?: boolean | null
          scheduled_date?: string
          signature?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string | null
          template_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_audits_auditor_id_fkey"
            columns: ["auditor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audits_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audits_started_by_fkey"
            columns: ["started_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_audits_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "appcc_audit_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_execution_photos: {
        Row: {
          caption: string | null
          file_name: string | null
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          response_id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          response_id: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          response_id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_execution_photos_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "appcc_execution_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_execution_responses: {
        Row: {
          answered_at: string
          answered_by: string | null
          boolean_value: boolean | null
          date_value: string | null
          execution_id: string
          id: string
          is_out_of_range: boolean
          item_id: string
          numeric_value: number | null
          selected_option_id: string | null
          text_value: string | null
        }
        Insert: {
          answered_at?: string
          answered_by?: string | null
          boolean_value?: boolean | null
          date_value?: string | null
          execution_id: string
          id?: string
          is_out_of_range?: boolean
          item_id: string
          numeric_value?: number | null
          selected_option_id?: string | null
          text_value?: string | null
        }
        Update: {
          answered_at?: string
          answered_by?: string | null
          boolean_value?: boolean | null
          date_value?: string | null
          execution_id?: string
          id?: string
          is_out_of_range?: boolean
          item_id?: string
          numeric_value?: number | null
          selected_option_id?: string | null
          text_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_execution_responses_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "appcc_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_execution_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "appcc_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_execution_responses_selected_option_id_fkey"
            columns: ["selected_option_id"]
            isOneToOne: false
            referencedRelation: "appcc_template_item_options"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_executions: {
        Row: {
          account_id: string
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          failure_count: number
          has_failures: boolean
          id: string
          location_id: string
          notes: string | null
          schedule_id: string | null
          scheduled_date: string
          scheduled_time: string | null
          started_at: string | null
          started_by: string | null
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          failure_count?: number
          has_failures?: boolean
          id?: string
          location_id: string
          notes?: string | null
          schedule_id?: string | null
          scheduled_date: string
          scheduled_time?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          failure_count?: number
          has_failures?: boolean
          id?: string
          location_id?: string
          notes?: string | null
          schedule_id?: string | null
          scheduled_date?: string
          scheduled_time?: string | null
          started_at?: string | null
          started_by?: string | null
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_executions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_executions_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_executions_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_executions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "appcc_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_executions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "appcc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_incident_actions: {
        Row: {
          action_type: string | null
          created_at: string
          description: string
          id: string
          incident_id: string
          taken_at: string
          taken_by: string | null
        }
        Insert: {
          action_type?: string | null
          created_at?: string
          description: string
          id?: string
          incident_id: string
          taken_at?: string
          taken_by?: string | null
        }
        Update: {
          action_type?: string | null
          created_at?: string
          description?: string
          id?: string
          incident_id?: string
          taken_at?: string
          taken_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_incident_actions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "appcc_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_incident_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          created_at: string | null
          description: string | null
          event_data: Json | null
          event_type: string
          id: string
          incident_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string | null
          description?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          incident_id: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          created_at?: string | null
          description?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_incident_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_incident_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "appcc_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_incident_photos: {
        Row: {
          action_id: string | null
          caption: string | null
          file_name: string | null
          file_size_bytes: number | null
          id: string
          incident_id: string
          mime_type: string | null
          photo_kind: string | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          action_id?: string | null
          caption?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          incident_id: string
          mime_type?: string | null
          photo_kind?: string | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          action_id?: string | null
          caption?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          id?: string
          incident_id?: string
          mime_type?: string | null
          photo_kind?: string | null
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_incident_photos_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "appcc_incident_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_incident_photos_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "appcc_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_incidents: {
        Row: {
          account_id: string
          assigned_at: string | null
          assigned_to: string | null
          category: string | null
          closed_at: string | null
          closed_by: string | null
          closure_signature: string | null
          corrective_action: string | null
          corrective_action_at: string | null
          corrective_action_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_at: string | null
          escalated: boolean | null
          escalated_at: string | null
          escalated_to: string | null
          execution_id: string | null
          id: string
          location_id: string
          preventive_action: string | null
          preventive_action_at: string | null
          preventive_action_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          response_id: string | null
          root_cause: string | null
          root_cause_data: Json | null
          root_cause_method: string | null
          severity: string
          sla_due_at: string | null
          sla_hours: number | null
          source: string
          status: string
          title: string
          updated_at: string
          verification_effective: boolean | null
          verification_notes: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          account_id: string
          assigned_at?: string | null
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_signature?: string | null
          corrective_action?: string | null
          corrective_action_at?: string | null
          corrective_action_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          escalated?: boolean | null
          escalated_at?: string | null
          escalated_to?: string | null
          execution_id?: string | null
          id?: string
          location_id: string
          preventive_action?: string | null
          preventive_action_at?: string | null
          preventive_action_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          response_id?: string | null
          root_cause?: string | null
          root_cause_data?: Json | null
          root_cause_method?: string | null
          severity: string
          sla_due_at?: string | null
          sla_hours?: number | null
          source?: string
          status?: string
          title: string
          updated_at?: string
          verification_effective?: boolean | null
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          account_id?: string
          assigned_at?: string | null
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_signature?: string | null
          corrective_action?: string | null
          corrective_action_at?: string | null
          corrective_action_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_at?: string | null
          escalated?: boolean | null
          escalated_at?: string | null
          escalated_to?: string | null
          execution_id?: string | null
          id?: string
          location_id?: string
          preventive_action?: string | null
          preventive_action_at?: string | null
          preventive_action_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          response_id?: string | null
          root_cause?: string | null
          root_cause_data?: Json | null
          root_cause_method?: string | null
          severity?: string
          sla_due_at?: string | null
          sla_hours?: number | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
          verification_effective?: boolean | null
          verification_notes?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_incidents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_incidents_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_incidents_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "appcc_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_incidents_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_incidents_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "appcc_execution_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_notifications: {
        Row: {
          account_id: string
          body: string | null
          created_at: string | null
          email_sent: boolean | null
          email_sent_at: string | null
          id: string
          link_id: string | null
          link_type: string | null
          read_at: string | null
          severity: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          body?: string | null
          created_at?: string | null
          email_sent?: boolean | null
          email_sent_at?: string | null
          id?: string
          link_id?: string | null
          link_type?: string | null
          read_at?: string | null
          severity?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          account_id?: string
          body?: string | null
          created_at?: string | null
          email_sent?: boolean | null
          email_sent_at?: string | null
          id?: string
          link_id?: string | null
          link_type?: string | null
          read_at?: string | null
          severity?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      appcc_plans: {
        Row: {
          code: string
          created_at: string
          description: string | null
          display_order: number
          icon: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      appcc_schedule_responsibles: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          schedule_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          schedule_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          schedule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_schedule_responsibles_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "appcc_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_schedules: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          location_id: string
          recurrence_config: Json
          recurrence_type: string
          scheduled_time: string | null
          template_id: string
          updated_at: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          location_id: string
          recurrence_config?: Json
          recurrence_type: string
          scheduled_time?: string | null
          template_id: string
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          location_id?: string
          recurrence_config?: Json
          recurrence_type?: string
          scheduled_time?: string | null
          template_id?: string
          updated_at?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appcc_schedules_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_schedules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_schedules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "appcc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_signatures: {
        Row: {
          canvas_storage_path: string | null
          execution_id: string
          id: string
          ip_address: unknown
          signature_hash: string
          signed_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          canvas_storage_path?: string | null
          execution_id: string
          id?: string
          ip_address?: unknown
          signature_hash: string
          signed_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          canvas_storage_path?: string | null
          execution_id?: string
          id?: string
          ip_address?: unknown
          signature_hash?: string
          signed_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_signatures_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "appcc_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_template_item_options: {
        Row: {
          code: string
          display_order: number
          id: string
          is_failure: boolean
          item_id: string
          label: string
        }
        Insert: {
          code: string
          display_order?: number
          id?: string
          is_failure?: boolean
          item_id: string
          label: string
        }
        Update: {
          code?: string
          display_order?: number
          id?: string
          is_failure?: boolean
          item_id?: string
          label?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_template_item_options_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "appcc_template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_template_items: {
        Row: {
          code: string
          created_at: string
          creates_incident_on_fail: boolean
          display_order: number
          expected_boolean: boolean | null
          field_type: string
          help_text: string | null
          id: string
          incident_severity: string | null
          is_required: boolean
          label: string
          numeric_max: number | null
          numeric_min: number | null
          numeric_unit: string | null
          template_id: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          creates_incident_on_fail?: boolean
          display_order?: number
          expected_boolean?: boolean | null
          field_type: string
          help_text?: string | null
          id?: string
          incident_severity?: string | null
          is_required?: boolean
          label: string
          numeric_max?: number | null
          numeric_min?: number | null
          numeric_unit?: string | null
          template_id: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          creates_incident_on_fail?: boolean
          display_order?: number
          expected_boolean?: boolean | null
          field_type?: string
          help_text?: string | null
          id?: string
          incident_severity?: string | null
          is_required?: boolean
          label?: string
          numeric_max?: number | null
          numeric_min?: number | null
          numeric_unit?: string | null
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "appcc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      appcc_templates: {
        Row: {
          account_id: string | null
          assignment_moment: string
          code: string
          created_at: string
          description: string | null
          estimated_minutes: number | null
          id: string
          is_active: boolean
          is_seed: boolean
          name: string
          plan_id: string
          requires_feature: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          assignment_moment?: string
          code: string
          created_at?: string
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          name: string
          plan_id: string
          requires_feature?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          assignment_moment?: string
          code?: string
          created_at?: string
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          is_active?: boolean
          is_seed?: boolean
          name?: string
          plan_id?: string
          requires_feature?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appcc_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appcc_templates_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "appcc_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      article_supplier: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          is_preferred: boolean
          last_price: number | null
          negotiated_price: number | null
          purchase_format_id: string | null
          recipe_item_id: string
          supplier_code: string | null
          supplier_id: string
          supplier_item_name: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          last_price?: number | null
          negotiated_price?: number | null
          purchase_format_id?: string | null
          recipe_item_id: string
          supplier_code?: string | null
          supplier_id: string
          supplier_item_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_preferred?: boolean
          last_price?: number | null
          negotiated_price?: number | null
          purchase_format_id?: string | null
          recipe_item_id?: string
          supplier_code?: string | null
          supplier_id?: string
          supplier_item_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_supplier_purchase_format_id_fkey"
            columns: ["purchase_format_id"]
            isOneToOne: false
            referencedRelation: "recipe_item_purchase_format"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_supplier_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_supplier_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_rate_limits: {
        Row: {
          attempts: number
          email: string
          first_attempt: string
          id: string
          ip_address: unknown
          locked_until: string | null
          user_agent: string | null
        }
        Insert: {
          attempts?: number
          email: string
          first_attempt?: string
          id?: string
          ip_address?: unknown
          locked_until?: string | null
          user_agent?: string | null
        }
        Update: {
          attempts?: number
          email?: string
          first_attempt?: string
          id?: string
          ip_address?: unknown
          locked_until?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      availability_push_log: {
        Row: {
          account_id: string
          catalog_product_id: string | null
          created_at: string
          enable: boolean | null
          error: string | null
          external_catalog_id: string | null
          external_org_id: string | null
          http_status: number | null
          id: string
          ok: boolean | null
          organization_product_id: string | null
        }
        Insert: {
          account_id: string
          catalog_product_id?: string | null
          created_at?: string
          enable?: boolean | null
          error?: string | null
          external_catalog_id?: string | null
          external_org_id?: string | null
          http_status?: number | null
          id?: string
          ok?: boolean | null
          organization_product_id?: string | null
        }
        Update: {
          account_id?: string
          catalog_product_id?: string | null
          created_at?: string
          enable?: boolean | null
          error?: string | null
          external_catalog_id?: string | null
          external_org_id?: string | null
          http_status?: number | null
          id?: string
          ok?: boolean | null
          organization_product_id?: string | null
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          account_id: string
          created_at: string
          id: string
          payload: Json
          processed_at: string | null
          stripe_event_id: string | null
          type: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          stripe_event_id?: string | null
          type: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          stripe_event_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_plans: {
        Row: {
          base_price_eur: number
          billing_cycle: string
          code: string
          created_at: string
          description: string | null
          id: string
          included_submodules: string[]
          max_employees: number
          max_locations: number
          name: string
          per_location_price: number
          sort_order: number | null
          status: string
          stripe_price_id: string | null
          trial_days: number
          updated_at: string
        }
        Insert: {
          base_price_eur?: number
          billing_cycle?: string
          code: string
          created_at?: string
          description?: string | null
          id?: string
          included_submodules?: string[]
          max_employees?: number
          max_locations?: number
          name: string
          per_location_price?: number
          sort_order?: number | null
          status?: string
          stripe_price_id?: string | null
          trial_days?: number
          updated_at?: string
        }
        Update: {
          base_price_eur?: number
          billing_cycle?: string
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          included_submodules?: string[]
          max_employees?: number
          max_locations?: number
          name?: string
          per_location_price?: number
          sort_order?: number | null
          status?: string
          stripe_price_id?: string | null
          trial_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      brand: {
        Row: {
          account_id: string
          archived_at: string | null
          catalog_source: string
          color: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          cuisine_code: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          notes: string | null
          ownership_type: string
          qr_caption: string | null
          shop_url: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          catalog_source?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          cuisine_code?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          notes?: string | null
          ownership_type?: string
          qr_caption?: string | null
          shop_url?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          catalog_source?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          cuisine_code?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          notes?: string | null
          ownership_type?: string
          qr_caption?: string | null
          shop_url?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_cuisine_code_fkey"
            columns: ["cuisine_code"]
            isOneToOne: false
            referencedRelation: "shop_cuisine"
            referencedColumns: ["code"]
          },
        ]
      }
      brand_channel: {
        Row: {
          account_id: string
          archived_at: string | null
          brand_id: string
          channel_id: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          brand_id: string
          channel_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          brand_id?: string
          channel_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bc_brand_fk"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bc_channel_fk"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channel"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_channel_rate: {
        Row: {
          account_id: string
          archived_at: string | null
          brand_channel_id: string
          commission_base: string
          commission_fixed: number | null
          commission_pct: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_active: boolean
          own_courier_cost: number | null
          own_customer_fee: number | null
          own_customer_fee_vat_pct: number
          service_type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          brand_channel_id: string
          commission_base?: string
          commission_fixed?: number | null
          commission_pct?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          own_courier_cost?: number | null
          own_customer_fee?: number | null
          own_customer_fee_vat_pct?: number
          service_type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          brand_channel_id?: string
          commission_base?: string
          commission_fixed?: number | null
          commission_pct?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          own_courier_cost?: number | null
          own_customer_fee?: number | null
          own_customer_fee_vat_pct?: number
          service_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_channel_rate_brand_channel_id_fkey"
            columns: ["brand_channel_id"]
            isOneToOne: false
            referencedRelation: "brand_channel"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_channel_target: {
        Row: {
          account_id: string
          brand_id: string
          channel_id: string
          id: string
          location_id: string
          target_daily: number
          updated_at: string
        }
        Insert: {
          account_id: string
          brand_id: string
          channel_id: string
          id?: string
          location_id: string
          target_daily: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          brand_id?: string
          channel_id?: string
          id?: string
          location_id?: string
          target_daily?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_channel_target_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_channel_target_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_channel_target_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_channel_target_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_licensing_agreement: {
        Row: {
          account_id: string
          archived_at: string | null
          brand_id: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          ends_on: string | null
          id: string
          is_active: boolean
          notes: string | null
          owner_name: string
          reimburses_consumption: boolean
          revenue_share_pct: number
          starts_on: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          brand_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          ends_on?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          owner_name: string
          reimburses_consumption?: boolean
          revenue_share_pct: number
          starts_on?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          brand_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          ends_on?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          owner_name?: string
          reimburses_consumption?: boolean
          revenue_share_pct?: number
          starts_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bla_brand_fk"
            columns: ["brand_id"]
            isOneToOne: true
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_location_availability: {
        Row: {
          account_id: string
          active_since: string | null
          brand_id: string
          created_at: string
          id: string
          inactive_since: string | null
          is_active: boolean
          location_id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          active_since?: string | null
          brand_id: string
          created_at?: string
          id?: string
          inactive_since?: string | null
          is_active?: boolean
          location_id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          active_since?: string | null
          brand_id?: string
          created_at?: string
          id?: string
          inactive_since?: string | null
          is_active?: boolean
          location_id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_location_availability_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_location_availability_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_location_availability_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          account_id: string
          brand_id: string | null
          close_time: string
          created_at: string
          id: string
          location_id: string
          open_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          account_id: string
          brand_id?: string | null
          close_time: string
          created_at?: string
          id?: string
          location_id: string
          open_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          account_id?: string
          brand_id?: string | null
          close_time?: string
          created_at?: string
          id?: string
          location_id?: string
          open_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_hours_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_hours_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours_exception: {
        Row: {
          account_id: string
          brand_id: string | null
          close_time: string | null
          created_at: string
          exception_date: string
          id: string
          is_closed: boolean
          location_id: string
          note: string | null
          open_time: string | null
        }
        Insert: {
          account_id: string
          brand_id?: string | null
          close_time?: string | null
          created_at?: string
          exception_date: string
          id?: string
          is_closed?: boolean
          location_id: string
          note?: string | null
          open_time?: string | null
        }
        Update: {
          account_id?: string
          brand_id?: string | null
          close_time?: string | null
          created_at?: string
          exception_date?: string
          id?: string
          is_closed?: boolean
          location_id?: string
          note?: string | null
          open_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_exception_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_hours_exception_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_hours_exception_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_rule: {
        Row: {
          account_id: string
          action_template: Json
          active: boolean
          brand_id: string | null
          budget_max: number
          condition: Json
          cooldown_minutes: number
          created_at: string
          created_by: string | null
          duration_minutes: number
          id: string
          last_fired_at: string | null
          location_id: string | null
          max_active: number
          menu_item_id: string | null
          name: string
          trigger_type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          action_template: Json
          active?: boolean
          brand_id?: string | null
          budget_max: number
          condition?: Json
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          id?: string
          last_fired_at?: string | null
          location_id?: string | null
          max_active?: number
          menu_item_id?: string | null
          name: string
          trigger_type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          action_template?: Json
          active?: boolean
          brand_id?: string | null
          budget_max?: number
          condition?: Json
          cooldown_minutes?: number
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          id?: string
          last_fired_at?: string | null
          location_id?: string | null
          max_active?: number
          menu_item_id?: string | null
          name?: string
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_rule_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_rule_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_rule_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_rule_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_rule_firing: {
        Row: {
          account_id: string
          acknowledged_at: string | null
          acknowledged_by: string | null
          coupon_id: string | null
          fired_at: string
          id: string
          reason: Json
          rule_id: string
        }
        Insert: {
          account_id: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          coupon_id?: string | null
          fired_at?: string
          id?: string
          reason?: Json
          rule_id: string
        }
        Update: {
          account_id?: string
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          coupon_id?: string | null
          fired_at?: string
          id?: string
          reason?: Json
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_rule_firing_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_rule_firing_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_rule_firing_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "campaign_rule"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_scope: {
        Row: {
          brand_id: string | null
          coupon_id: string
          created_at: string
          id: string
          menu_category_id: string | null
          menu_item_id: string | null
        }
        Insert: {
          brand_id?: string | null
          coupon_id: string
          created_at?: string
          id?: string
          menu_category_id?: string | null
          menu_item_id?: string | null
        }
        Update: {
          brand_id?: string | null
          coupon_id?: string
          created_at?: string
          id?: string
          menu_category_id?: string | null
          menu_item_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_scope_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_scope_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_scope_menu_category_id_fkey"
            columns: ["menu_category_id"]
            isOneToOne: false
            referencedRelation: "menu_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_scope_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_image_map: {
        Row: {
          account_id: string
          created_at: string
          external_catalog_id: string
          id: string
          image_id: string
          menu_item_id: string
          source_hash: string
          source_url: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          external_catalog_id: string
          id?: string
          image_id: string
          menu_item_id: string
          source_hash: string
          source_url: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          external_catalog_id?: string
          id?: string
          image_id?: string
          menu_item_id?: string
          source_hash?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_image_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_image_map_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_publish: {
        Row: {
          account_id: string
          brand_id: string
          id: string
          note: string | null
          requested_at: string
          requested_by: string | null
          status: string
        }
        Insert: {
          account_id: string
          brand_id: string
          id?: string
          note?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          brand_id?: string
          id?: string
          note?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_publish_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_publish_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_publish_target: {
        Row: {
          channel_id: string | null
          connection_name: string | null
          error_text: string | null
          external_catalog_id: string | null
          id: string
          publish_id: string
          published_at: string | null
          status: string
        }
        Insert: {
          channel_id?: string | null
          connection_name?: string | null
          error_text?: string | null
          external_catalog_id?: string | null
          id?: string
          publish_id: string
          published_at?: string | null
          status?: string
        }
        Update: {
          channel_id?: string | null
          connection_name?: string | null
          error_text?: string | null
          external_catalog_id?: string | null
          id?: string
          publish_id?: string
          published_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_publish_target_publish_id_fkey"
            columns: ["publish_id"]
            isOneToOne: false
            referencedRelation: "catalog_publish"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_rate: {
        Row: {
          account_id: string
          archived_at: string | null
          commission_base: string
          commission_fixed: number | null
          commission_pct: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_active: boolean
          own_courier_cost: number | null
          own_customer_fee: number | null
          own_customer_fee_vat_pct: number
          sales_channel_id: string
          service_type: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          commission_base?: string
          commission_fixed?: number | null
          commission_pct?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          own_courier_cost?: number | null
          own_customer_fee?: number | null
          own_customer_fee_vat_pct?: number
          sales_channel_id: string
          service_type: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          commission_base?: string
          commission_fixed?: number | null
          commission_pct?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          own_courier_cost?: number | null
          own_customer_fee?: number | null
          own_customer_fee_vat_pct?: number
          sales_channel_id?: string
          service_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_rate_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_rate_sales_channel_id_fkey"
            columns: ["sales_channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channel"
            referencedColumns: ["id"]
          },
        ]
      }
      clock_entries: {
        Row: {
          address: string | null
          created_at: string
          datetime: string
          diff_minutes: number | null
          employee_id: string
          id: string
          lat: number | null
          lng: number | null
          location_id_at_clock: string | null
          photo_data_url: string | null
          real_datetime: string | null
          rounding_applied: boolean | null
          scheduled: string | null
          source: string | null
          type: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          datetime?: string
          diff_minutes?: number | null
          employee_id: string
          id?: string
          lat?: number | null
          lng?: number | null
          location_id_at_clock?: string | null
          photo_data_url?: string | null
          real_datetime?: string | null
          rounding_applied?: boolean | null
          scheduled?: string | null
          source?: string | null
          type: string
        }
        Update: {
          address?: string | null
          created_at?: string
          datetime?: string
          diff_minutes?: number | null
          employee_id?: string
          id?: string
          lat?: number | null
          lng?: number | null
          location_id_at_clock?: string | null
          photo_data_url?: string | null
          real_datetime?: string | null
          rounding_applied?: boolean | null
          scheduled?: string | null
          source?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "clock_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clock_entries_location_id_at_clock_fkey"
            columns: ["location_id_at_clock"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_slot: {
        Row: {
          account_id: string
          combo_item_id: string
          created_at: string
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          max_selections: number
          min_selections: number
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          account_id: string
          combo_item_id: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          combo_item_id?: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_slot_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_slot_combo_item_id_fkey"
            columns: ["combo_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_slot_option: {
        Row: {
          account_id: string
          combo_slot_id: string
          created_at: string
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          is_default: boolean
          menu_item_id: string | null
          modifier_group_id: string | null
          position: number
          price_impact: number
        }
        Insert: {
          account_id: string
          combo_slot_id: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          menu_item_id?: string | null
          modifier_group_id?: string | null
          position?: number
          price_impact?: number
        }
        Update: {
          account_id?: string
          combo_slot_id?: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          menu_item_id?: string | null
          modifier_group_id?: string | null
          position?: number
          price_impact?: number
        }
        Relationships: [
          {
            foreignKeyName: "combo_slot_option_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_slot_option_combo_slot_id_fkey"
            columns: ["combo_slot_id"]
            isOneToOne: false
            referencedRelation: "combo_slot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_slot_option_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combo_slot_option_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_group"
            referencedColumns: ["id"]
          },
        ]
      }
      connector: {
        Row: {
          category: string
          code: string
          config_schema: Json | null
          connection_type: string
          created_at: string
          description: string | null
          direction: string
          features: Json
          id: string
          is_available: boolean
          logo_url: string | null
          managed_by: string
          name: string
          sort_order: number | null
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          config_schema?: Json | null
          connection_type: string
          created_at?: string
          description?: string | null
          direction?: string
          features?: Json
          id?: string
          is_available?: boolean
          logo_url?: string | null
          managed_by: string
          name: string
          sort_order?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          config_schema?: Json | null
          connection_type?: string
          created_at?: string
          description?: string | null
          direction?: string
          features?: Json
          id?: string
          is_available?: boolean
          logo_url?: string | null
          managed_by?: string
          name?: string
          sort_order?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      cost_center: {
        Row: {
          account_id: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          location_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_center_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_center_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon: {
        Row: {
          account_id: string
          active: boolean
          applies_to: string
          auto_apply: boolean
          budget_max: number | null
          channels: string[]
          code: string | null
          created_at: string
          created_by: string | null
          discount_type: string
          ends_at: string | null
          first_order_only: boolean
          frequency_threshold: number | null
          id: string
          kind: string
          max_per_customer: number
          max_redemptions: number | null
          min_subtotal: number | null
          name: string
          omnibus_ref_note: string | null
          origin: string
          paused_at: string | null
          scope: Json | null
          starts_at: string | null
          time_from: string | null
          time_to: string | null
          updated_at: string
          value: number
          weekdays: number[] | null
        }
        Insert: {
          account_id: string
          active?: boolean
          applies_to?: string
          auto_apply?: boolean
          budget_max?: number | null
          channels?: string[]
          code?: string | null
          created_at?: string
          created_by?: string | null
          discount_type: string
          ends_at?: string | null
          first_order_only?: boolean
          frequency_threshold?: number | null
          id?: string
          kind?: string
          max_per_customer?: number
          max_redemptions?: number | null
          min_subtotal?: number | null
          name: string
          omnibus_ref_note?: string | null
          origin?: string
          paused_at?: string | null
          scope?: Json | null
          starts_at?: string | null
          time_from?: string | null
          time_to?: string | null
          updated_at?: string
          value: number
          weekdays?: number[] | null
        }
        Update: {
          account_id?: string
          active?: boolean
          applies_to?: string
          auto_apply?: boolean
          budget_max?: number | null
          channels?: string[]
          code?: string | null
          created_at?: string
          created_by?: string | null
          discount_type?: string
          ends_at?: string | null
          first_order_only?: boolean
          frequency_threshold?: number | null
          id?: string
          kind?: string
          max_per_customer?: number
          max_redemptions?: number | null
          min_subtotal?: number | null
          name?: string
          omnibus_ref_note?: string | null
          origin?: string
          paused_at?: string | null
          scope?: Json | null
          starts_at?: string | null
          time_from?: string | null
          time_to?: string | null
          updated_at?: string
          value?: number
          weekdays?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      coupon_redemption: {
        Row: {
          account_id: string
          coupon_id: string
          customer_email: string | null
          customer_id: string | null
          customer_phone: string | null
          discount_amount: number
          id: string
          is_cycle: boolean
          margin_after: number | null
          reference_subtotal: number
          sale_id: string
          ts: string
        }
        Insert: {
          account_id: string
          coupon_id: string
          customer_email?: string | null
          customer_id?: string | null
          customer_phone?: string | null
          discount_amount: number
          id?: string
          is_cycle?: boolean
          margin_after?: number | null
          reference_subtotal: number
          sale_id: string
          ts?: string
        }
        Update: {
          account_id?: string
          coupon_id?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          is_cycle?: boolean
          margin_after?: number | null
          reference_subtotal?: number
          sale_id?: string
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemption_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemption_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemption_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemption_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale"
            referencedColumns: ["id"]
          },
        ]
      }
      ctb_notification_queue: {
        Row: {
          account_id: string
          created_at: string
          goods_receipt_id: string
          has_differences: boolean
          id: string
          location_id: string | null
          notify_group: string
          sent_at: string | null
          sent_by: string | null
          sent_by_name: string | null
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          goods_receipt_id: string
          has_differences?: boolean
          id?: string
          location_id?: string | null
          notify_group?: string
          sent_at?: string | null
          sent_by?: string | null
          sent_by_name?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          goods_receipt_id?: string
          has_differences?: boolean
          id?: string
          location_id?: string | null
          notify_group?: string
          sent_at?: string | null
          sent_by?: string | null
          sent_by_name?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ctb_notification_queue_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ctb_notification_queue_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: true
            referencedRelation: "goods_receipt"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ctb_notification_queue_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ctb_notification_queue_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      customer: {
        Row: {
          account_id: string
          created_at: string
          email: string | null
          email_verified: boolean
          first_brand_id: string | null
          first_location_id: string | null
          first_seen_at: string
          id: string
          last_login_at: string | null
          last_seen_at: string
          name: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          email?: string | null
          email_verified?: boolean
          first_brand_id?: string | null
          first_location_id?: string | null
          first_seen_at?: string
          id?: string
          last_login_at?: string | null
          last_seen_at?: string
          name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          email?: string | null
          email_verified?: boolean
          first_brand_id?: string | null
          first_location_id?: string | null
          first_seen_at?: string
          id?: string
          last_login_at?: string | null
          last_seen_at?: string
          name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_address: {
        Row: {
          account_id: string
          address: string
          created_at: string
          customer_id: string
          detail: string | null
          id: string
          is_default: boolean
          label: string | null
          lat: number | null
          lng: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          address: string
          created_at?: string
          customer_id: string
          detail?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          address?: string
          created_at?: string
          customer_id?: string
          detail?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          lat?: number | null
          lng?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_address_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_address_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_consent: {
        Row: {
          account_id: string
          customer_id: string
          marketing_email: boolean
          marketing_sms: boolean
          marketing_whatsapp: boolean
          updated_at: string
        }
        Insert: {
          account_id: string
          customer_id: string
          marketing_email?: boolean
          marketing_sms?: boolean
          marketing_whatsapp?: boolean
          updated_at?: string
        }
        Update: {
          account_id?: string
          customer_id?: string
          marketing_email?: boolean
          marketing_sms?: boolean
          marketing_whatsapp?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_consent_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consent_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_consent_log: {
        Row: {
          account_id: string
          action: string
          channel: string
          customer_id: string
          id: string
          ip: string | null
          source: string
          terms_version: string | null
          ts: string
          user_agent: string | null
        }
        Insert: {
          account_id: string
          action: string
          channel: string
          customer_id: string
          id?: string
          ip?: string | null
          source: string
          terms_version?: string | null
          ts?: string
          user_agent?: string | null
        }
        Update: {
          account_id?: string
          action?: string
          channel?: string
          customer_id?: string
          id?: string
          ip?: string | null
          source?: string
          terms_version?: string | null
          ts?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_consent_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_consent_log_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_otp: {
        Row: {
          account_id: string
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
        }
        Insert: {
          account_id: string
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_otp_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_session: {
        Row: {
          account_id: string
          created_at: string
          customer_id: string
          expires_at: string
          id: string
          last_seen_at: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          account_id: string
          created_at?: string
          customer_id: string
          expires_at: string
          id?: string
          last_seen_at?: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          account_id?: string
          created_at?: string
          customer_id?: string
          expires_at?: string
          id?: string
          last_seen_at?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_session_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_session_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_zone: {
        Row: {
          account_id: string
          area: unknown
          center: unknown
          created_at: string
          delivery_fee: number
          eta_min: number | null
          fee_source: string
          id: string
          is_active: boolean
          location_id: string
          method: string
          min_order: number | null
          name: string
          postal_codes: string[] | null
          priority: number
          radius_m: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          area?: unknown
          center?: unknown
          created_at?: string
          delivery_fee?: number
          eta_min?: number | null
          fee_source?: string
          id?: string
          is_active?: boolean
          location_id: string
          method: string
          min_order?: number | null
          name: string
          postal_codes?: string[] | null
          priority?: number
          radius_m?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          area?: unknown
          center?: unknown
          created_at?: string
          delivery_fee?: number
          eta_min?: number | null
          fee_source?: string
          id?: string
          is_active?: boolean
          location_id?: string
          method?: string
          min_order?: number | null
          name?: string
          postal_codes?: string[] | null
          priority?: number
          radius_m?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_zone_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_zone_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_family_template: {
        Row: {
          code: string
          created_at: string
          icon: string
          id: string
          name_en: string
          name_es: string
          position: number
        }
        Insert: {
          code: string
          created_at?: string
          icon: string
          id?: string
          name_en: string
          name_es: string
          position?: number
        }
        Update: {
          code?: string
          created_at?: string
          icon?: string
          id?: string
          name_en?: string
          name_es?: string
          position?: number
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          employee_id: string
          file_path: string
          file_size_kb: number
          id: string
          name: string
          notes: string | null
          type: string
          uploaded_by: string | null
          uploaded_role: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          file_path: string
          file_size_kb?: number
          id?: string
          name: string
          notes?: string | null
          type: string
          uploaded_by?: string | null
          uploaded_role?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          file_path?: string
          file_size_kb?: number
          id?: string
          name?: string
          notes?: string | null
          type?: string
          uploaded_by?: string | null
          uploaded_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_events: {
        Row: {
          account_id: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          location_id: string | null
          module_code: string
          occurred_at: string
          payload: Json
          processed_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          location_id?: string | null
          module_code: string
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          location_id?: string | null
          module_code?: string
          occurred_at?: string
          payload?: Json
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_events_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_availability: {
        Row: {
          available: boolean
          created_at: string
          day_of_week: number
          employee_id: string
          id: string
          note: string | null
          shift_period: string
        }
        Insert: {
          available?: boolean
          created_at?: string
          day_of_week: number
          employee_id: string
          id?: string
          note?: string | null
          shift_period: string
        }
        Update: {
          available?: boolean
          created_at?: string
          day_of_week?: number
          employee_id?: string
          id?: string
          note?: string | null
          shift_period?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_formations: {
        Row: {
          created_at: string
          document_url: string | null
          employee_id: string
          expiry_date: string | null
          id: string
          issue_date: string
          issuer: string | null
          name: string
          notes: string | null
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_url?: string | null
          employee_id: string
          expiry_date?: string | null
          id?: string
          issue_date: string
          issuer?: string | null
          name: string
          notes?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_url?: string | null
          employee_id?: string
          expiry_date?: string | null
          id?: string
          issue_date?: string
          issuer?: string | null
          name?: string
          notes?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_formations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_notifications: {
        Row: {
          body: string
          created_at: string
          data: Json | null
          employee_id: string
          id: string
          read: boolean
          read_at: string | null
          sender_employee_id: string | null
          title: string
          type: string
        }
        Insert: {
          body: string
          created_at?: string
          data?: Json | null
          employee_id: string
          id?: string
          read?: boolean
          read_at?: string | null
          sender_employee_id?: string | null
          title: string
          type: string
        }
        Update: {
          body?: string
          created_at?: string
          data?: Json | null
          employee_id?: string
          id?: string
          read?: boolean
          read_at?: string | null
          sender_employee_id?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_notifications_sender_employee_id_fkey"
            columns: ["sender_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          assigned_locations: string[] | null
          availability: Json | null
          birth_date: string | null
          contract_type: string | null
          contracted_hours_week: number | null
          created_at: string
          department: string | null
          dni: string | null
          email: string | null
          end_date: string | null
          id: string
          initial_hours_balance: number | null
          location_id: string | null
          name: string
          notes: string | null
          phone: string | null
          photo: string | null
          pin: string | null
          position: string | null
          rest_pattern: string | null
          salary: number | null
          schedule: string | null
          shift_code: string | null
          shift_period: string | null
          show_hours_balance: boolean | null
          start_date: string | null
          termination_communicated_to_gestoria: boolean | null
          termination_reason: string | null
          termination_type: string | null
          trial_period_days: number | null
          updated_at: string
          username: string | null
          weekly_hours: number | null
          weekly_schedule: Json | null
        }
        Insert: {
          active?: boolean
          assigned_locations?: string[] | null
          availability?: Json | null
          birth_date?: string | null
          contract_type?: string | null
          contracted_hours_week?: number | null
          created_at?: string
          department?: string | null
          dni?: string | null
          email?: string | null
          end_date?: string | null
          id?: string
          initial_hours_balance?: number | null
          location_id?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          photo?: string | null
          pin?: string | null
          position?: string | null
          rest_pattern?: string | null
          salary?: number | null
          schedule?: string | null
          shift_code?: string | null
          shift_period?: string | null
          show_hours_balance?: boolean | null
          start_date?: string | null
          termination_communicated_to_gestoria?: boolean | null
          termination_reason?: string | null
          termination_type?: string | null
          trial_period_days?: number | null
          updated_at?: string
          username?: string | null
          weekly_hours?: number | null
          weekly_schedule?: Json | null
        }
        Update: {
          active?: boolean
          assigned_locations?: string[] | null
          availability?: Json | null
          birth_date?: string | null
          contract_type?: string | null
          contracted_hours_week?: number | null
          created_at?: string
          department?: string | null
          dni?: string | null
          email?: string | null
          end_date?: string | null
          id?: string
          initial_hours_balance?: number | null
          location_id?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          photo?: string | null
          pin?: string | null
          position?: string | null
          rest_pattern?: string | null
          salary?: number | null
          schedule?: string | null
          shift_code?: string | null
          shift_period?: string | null
          show_hours_balance?: boolean | null
          start_date?: string | null
          termination_communicated_to_gestoria?: boolean | null
          termination_reason?: string | null
          termination_type?: string | null
          trial_period_days?: number | null
          updated_at?: string
          username?: string | null
          weekly_hours?: number | null
          weekly_schedule?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      external_brand_map: {
        Row: {
          account_id: string
          brand_id: string | null
          created_at: string
          external_brand_id: string
          external_location_id: string
          id: string
          is_ignored: boolean
          source: string
          updated_at: string
        }
        Insert: {
          account_id: string
          brand_id?: string | null
          created_at?: string
          external_brand_id: string
          external_location_id: string
          id?: string
          is_ignored?: boolean
          source: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          brand_id?: string | null
          created_at?: string
          external_brand_id?: string
          external_location_id?: string
          id?: string
          is_ignored?: boolean
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_brand_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_brand_map_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
        ]
      }
      external_catalog_product: {
        Row: {
          account_id: string
          catalog_product_id: string
          created_at: string
          external_brand_name: string | null
          external_catalog_id: string | null
          external_channel: string | null
          external_location_id: string | null
          external_org_id: string
          id: string
          is_enabled: boolean | null
          needs_review: boolean
          organization_product_id: string | null
          price_cents: number | null
          product_name: string | null
          product_type: string | null
          seen_in_catalog_at: string | null
          seen_in_sale_at: string | null
          source: string
          updated_at: string
        }
        Insert: {
          account_id: string
          catalog_product_id: string
          created_at?: string
          external_brand_name?: string | null
          external_catalog_id?: string | null
          external_channel?: string | null
          external_location_id?: string | null
          external_org_id: string
          id?: string
          is_enabled?: boolean | null
          needs_review?: boolean
          organization_product_id?: string | null
          price_cents?: number | null
          product_name?: string | null
          product_type?: string | null
          seen_in_catalog_at?: string | null
          seen_in_sale_at?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          catalog_product_id?: string
          created_at?: string
          external_brand_name?: string | null
          external_catalog_id?: string | null
          external_channel?: string | null
          external_location_id?: string | null
          external_org_id?: string
          id?: string
          is_enabled?: boolean | null
          needs_review?: boolean
          organization_product_id?: string | null
          price_cents?: number | null
          product_name?: string | null
          product_type?: string | null
          seen_in_catalog_at?: string | null
          seen_in_sale_at?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lastapp_catalog_product_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      external_integration: {
        Row: {
          access_token: string | null
          account_id: string
          connection_name: string | null
          created_at: string
          external_catalog_id: string | null
          external_location_id: string | null
          external_org_id: string | null
          id: string
          is_active: boolean
          organization_name: string | null
          ownership_type: string
          push_status_enabled: boolean
          source: string
          token_secret_name: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          account_id: string
          connection_name?: string | null
          created_at?: string
          external_catalog_id?: string | null
          external_location_id?: string | null
          external_org_id?: string | null
          id?: string
          is_active?: boolean
          organization_name?: string | null
          ownership_type?: string
          push_status_enabled?: boolean
          source?: string
          token_secret_name?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          account_id?: string
          connection_name?: string | null
          created_at?: string
          external_catalog_id?: string | null
          external_location_id?: string | null
          external_org_id?: string | null
          id?: string
          is_active?: boolean
          organization_name?: string | null
          ownership_type?: string
          push_status_enabled?: boolean
          source?: string
          token_secret_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lastapp_integration_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      external_location_map: {
        Row: {
          account_id: string
          created_at: string
          external_location_id: string
          external_location_name: string | null
          id: string
          is_active: boolean
          location_id: string | null
          needs_review: boolean
          source: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          external_location_id: string
          external_location_name?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          needs_review?: boolean
          source: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          external_location_id?: string
          external_location_name?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          needs_review?: boolean
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_location_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_location_map_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      external_product_map: {
        Row: {
          account_id: string
          created_at: string
          external_brand_id: string | null
          external_product_id: string
          id: string
          menu_item_id: string
          source: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          external_brand_id?: string | null
          external_product_id: string
          id?: string
          menu_item_id: string
          source: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          external_brand_id?: string | null
          external_product_id?: string
          id?: string
          menu_item_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_product_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_product_map_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      external_webhook_log: {
        Row: {
          created_at: string
          headers: Json | null
          id: string
          note: string | null
          payload: Json | null
          processed: boolean
          source: string
        }
        Insert: {
          created_at?: string
          headers?: Json | null
          id?: string
          note?: string | null
          payload?: Json | null
          processed?: boolean
          source: string
        }
        Update: {
          created_at?: string
          headers?: Json | null
          id?: string
          note?: string | null
          payload?: Json | null
          processed?: boolean
          source?: string
        }
        Relationships: []
      }
      family_vat_default: {
        Row: {
          created_at: string
          family_name: string
          id: string
          is_mixed: boolean
          note: string | null
          vat_category_id: string
        }
        Insert: {
          created_at?: string
          family_name: string
          id?: string
          is_mixed?: boolean
          note?: string | null
          vat_category_id: string
        }
        Update: {
          created_at?: string
          family_name?: string
          id?: string
          is_mixed?: boolean
          note?: string | null
          vat_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_vat_default_vat_category_id_fkey"
            columns: ["vat_category_id"]
            isOneToOne: false
            referencedRelation: "vat_category"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          account_id: string
          created_at: string
          enabled: boolean
          expires_at: string | null
          feature_key: string
          granted_by: string | null
          source: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          feature_key: string
          granted_by?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          feature_key?: string
          granted_by?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      folvy_map_node: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          created_by_name: string | null
          description: string | null
          doc_ref: string | null
          flow_order: number
          id: string
          is_active: boolean
          layer: string
          measure_table: string | null
          name: string
          parent_id: string | null
          status_declared: string
          status_note: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          doc_ref?: string | null
          flow_order?: number
          id?: string
          is_active?: boolean
          layer: string
          measure_table?: string | null
          name: string
          parent_id?: string | null
          status_declared?: string
          status_note?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          doc_ref?: string | null
          flow_order?: number
          id?: string
          is_active?: boolean
          layer?: string
          measure_table?: string | null
          name?: string
          parent_id?: string | null
          status_declared?: string
          status_note?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "folvy_map_node_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folvy_map_node"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt: {
        Row: {
          account_id: string
          ai_confidence: number | null
          ai_session_id: string | null
          archived_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          delivered_by: string | null
          id: string
          is_active: boolean
          location_id: string
          needs_review: boolean
          notes: string | null
          purchase_order_id: string | null
          raw_document_url: string | null
          receipt_date: string
          received_at: string | null
          source: string
          status: string
          supplier_doc_number: string | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          ai_session_id?: string | null
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delivered_by?: string | null
          id?: string
          is_active?: boolean
          location_id: string
          needs_review?: boolean
          notes?: string | null
          purchase_order_id?: string | null
          raw_document_url?: string | null
          receipt_date?: string
          received_at?: string | null
          source?: string
          status?: string
          supplier_doc_number?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          ai_session_id?: string | null
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delivered_by?: string | null
          id?: string
          is_active?: boolean
          location_id?: string
          needs_review?: boolean
          notes?: string | null
          purchase_order_id?: string | null
          raw_document_url?: string | null
          receipt_date?: string
          received_at?: string | null
          source?: string
          status?: string
          supplier_doc_number?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_ai_session_id_fkey"
            columns: ["ai_session_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_ai_session"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_ai_session: {
        Row: {
          account_id: string
          ai_cost_eur: number | null
          ai_latency_ms: number | null
          ai_model: string | null
          created_at: string
          created_by: string | null
          goods_receipt_id: string | null
          id: string
          input_files: Json | null
          kind: string
          parsed_result: Json | null
          raw_response: Json | null
          status: string
          updated_at: string
          validation: Json | null
        }
        Insert: {
          account_id: string
          ai_cost_eur?: number | null
          ai_latency_ms?: number | null
          ai_model?: string | null
          created_at?: string
          created_by?: string | null
          goods_receipt_id?: string | null
          id?: string
          input_files?: Json | null
          kind?: string
          parsed_result?: Json | null
          raw_response?: Json | null
          status?: string
          updated_at?: string
          validation?: Json | null
        }
        Update: {
          account_id?: string
          ai_cost_eur?: number | null
          ai_latency_ms?: number | null
          ai_model?: string | null
          created_at?: string
          created_by?: string | null
          goods_receipt_id?: string | null
          id?: string
          input_files?: Json | null
          kind?: string
          parsed_result?: Json | null
          raw_response?: Json | null
          status?: string
          updated_at?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_ai_session_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_line: {
        Row: {
          account_id: string
          created_at: string
          discrepancy_reason: string | null
          doc_amount: number | null
          doc_qty: number | null
          expiry_date: string | null
          goods_receipt_id: string
          id: string
          lot_code: string | null
          map_confidence: number | null
          map_needs_review: boolean
          map_source: string | null
          notes: string | null
          position: number
          product_name: string
          purchase_format_id: string | null
          purchase_order_line_id: string | null
          purchase_unit_id: string | null
          qty_in_base: number | null
          qty_received: number
          raw_text: string | null
          recipe_item_id: string | null
          supplier_code: string | null
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          discrepancy_reason?: string | null
          doc_amount?: number | null
          doc_qty?: number | null
          expiry_date?: string | null
          goods_receipt_id: string
          id?: string
          lot_code?: string | null
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string | null
          notes?: string | null
          position?: number
          product_name: string
          purchase_format_id?: string | null
          purchase_order_line_id?: string | null
          purchase_unit_id?: string | null
          qty_in_base?: number | null
          qty_received: number
          raw_text?: string | null
          recipe_item_id?: string | null
          supplier_code?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          discrepancy_reason?: string | null
          doc_amount?: number | null
          doc_qty?: number | null
          expiry_date?: string | null
          goods_receipt_id?: string
          id?: string
          lot_code?: string | null
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string | null
          notes?: string | null
          position?: number
          product_name?: string
          purchase_format_id?: string | null
          purchase_order_line_id?: string | null
          purchase_unit_id?: string | null
          qty_in_base?: number | null
          qty_received?: number
          raw_text?: string | null
          recipe_item_id?: string | null
          supplier_code?: string | null
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_line_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_line_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_line_purchase_format_id_fkey"
            columns: ["purchase_format_id"]
            isOneToOne: false
            referencedRelation: "recipe_item_purchase_format"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_line_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_line_purchase_unit_id_fkey"
            columns: ["purchase_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_line_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_sessions: {
        Row: {
          actions_taken: Json
          ended_at: string | null
          force_closed: boolean | null
          id: string
          ip_address: unknown
          platform_admin_id: string
          reason: string
          started_at: string
          target_account_id: string
          target_user_id: string
          user_agent: string | null
        }
        Insert: {
          actions_taken?: Json
          ended_at?: string | null
          force_closed?: boolean | null
          id?: string
          ip_address?: unknown
          platform_admin_id: string
          reason: string
          started_at?: string
          target_account_id: string
          target_user_id: string
          user_agent?: string | null
        }
        Update: {
          actions_taken?: Json
          ended_at?: string | null
          force_closed?: boolean | null
          id?: string
          ip_address?: unknown
          platform_admin_id?: string
          reason?: string
          started_at?: string
          target_account_id?: string
          target_user_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_sessions_platform_admin_id_fkey"
            columns: ["platform_admin_id"]
            isOneToOne: false
            referencedRelation: "platform_admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_sessions_target_account_id_fkey"
            columns: ["target_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_monitor_config: {
        Row: {
          account_id: string
          alert_cooldown_minutes: number
          created_at: string
          enabled: boolean
          freshness_threshold_minutes: number
          service_windows: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          account_id: string
          alert_cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          freshness_threshold_minutes?: number
          service_windows?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          alert_cooldown_minutes?: number
          created_at?: string
          enabled?: boolean
          freshness_threshold_minutes?: number
          service_windows?: Json
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_monitor_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_monitor_state: {
        Row: {
          account_id: string
          last_alert_kind: string | null
          last_alert_sent_at: string | null
          last_sale_seen_at: string | null
          last_synthetic_ping_at: string | null
          last_synthetic_ping_ok: boolean | null
          updated_at: string
        }
        Insert: {
          account_id: string
          last_alert_kind?: string | null
          last_alert_sent_at?: string | null
          last_sale_seen_at?: string | null
          last_synthetic_ping_at?: string | null
          last_synthetic_ping_ok?: boolean | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          last_alert_kind?: string | null
          last_alert_sent_at?: string | null
          last_sale_seen_at?: string | null
          last_synthetic_ping_at?: string | null
          last_synthetic_ping_ok?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_monitor_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredient_family_template: {
        Row: {
          accounting_category: string | null
          code: string
          created_at: string
          gpc_brick_code: string | null
          icon: string | null
          id: string
          name_en: string | null
          name_es: string
          parent_code: string | null
          position: number
          updated_at: string
        }
        Insert: {
          accounting_category?: string | null
          code: string
          created_at?: string
          gpc_brick_code?: string | null
          icon?: string | null
          id?: string
          name_en?: string | null
          name_es: string
          parent_code?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          accounting_category?: string | null
          code?: string
          created_at?: string
          gpc_brick_code?: string | null
          icon?: string | null
          id?: string
          name_en?: string | null
          name_es?: string
          parent_code?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_family_template_parent_code_fkey"
            columns: ["parent_code"]
            isOneToOne: false
            referencedRelation: "ingredient_family_template"
            referencedColumns: ["code"]
          },
        ]
      }
      ingredient_template: {
        Row: {
          aliases: string[]
          code: string
          conservation_type: string | null
          created_at: string
          default_base_dimension: string | null
          default_waste_pct: number | null
          density_g_per_ml: number | null
          family_code: string | null
          gpc_brick_code: string | null
          gtin: string | null
          id: string
          is_active: boolean
          name_en: string | null
          name_es: string
          nutrition: Json | null
          photo_url: string | null
          position: number
          published_at: string | null
          shelf_life_days: number | null
          source: string
          updated_at: string
          version: number
        }
        Insert: {
          aliases?: string[]
          code: string
          conservation_type?: string | null
          created_at?: string
          default_base_dimension?: string | null
          default_waste_pct?: number | null
          density_g_per_ml?: number | null
          family_code?: string | null
          gpc_brick_code?: string | null
          gtin?: string | null
          id?: string
          is_active?: boolean
          name_en?: string | null
          name_es: string
          nutrition?: Json | null
          photo_url?: string | null
          position?: number
          published_at?: string | null
          shelf_life_days?: number | null
          source?: string
          updated_at?: string
          version?: number
        }
        Update: {
          aliases?: string[]
          code?: string
          conservation_type?: string | null
          created_at?: string
          default_base_dimension?: string | null
          default_waste_pct?: number | null
          density_g_per_ml?: number | null
          family_code?: string | null
          gpc_brick_code?: string | null
          gtin?: string | null
          id?: string
          is_active?: boolean
          name_en?: string | null
          name_es?: string
          nutrition?: Json | null
          photo_url?: string | null
          position?: number
          published_at?: string | null
          shelf_life_days?: number | null
          source?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      ingredient_template_allergen: {
        Row: {
          allergen_code: string
          created_at: string
          source: string
          state: string
          template_id: string
        }
        Insert: {
          allergen_code: string
          created_at?: string
          source?: string
          state?: string
          template_id: string
        }
        Update: {
          allergen_code?: string
          created_at?: string
          source?: string
          state?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_template_allergen_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "ingredient_template"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count: {
        Row: {
          account_id: string
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          blind: boolean
          closed_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_opening: boolean
          kind: string
          location_id: string
          notes: string | null
          started_at: string | null
          started_by: string | null
          started_by_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          blind?: boolean
          closed_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_opening?: boolean
          kind?: string
          location_id: string
          notes?: string | null
          started_at?: string | null
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          blind?: boolean
          closed_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_opening?: boolean
          kind?: string
          location_id?: string
          notes?: string | null
          started_at?: string | null
          started_by?: string | null
          started_by_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_count_line: {
        Row: {
          abc_class: string | null
          account_id: string
          assigned_to: string | null
          counted_by: string | null
          counted_by_name: string | null
          counted_qty: number | null
          created_at: string
          id: string
          inventory_count_id: string
          position: number
          reason_code: string | null
          recipe_item_id: string
          recount_of: string | null
          storage_area_id: string | null
          system_qty: number | null
          variance_pct: number | null
          variance_qty: number | null
          variance_value: number | null
          within_tolerance: boolean | null
        }
        Insert: {
          abc_class?: string | null
          account_id: string
          assigned_to?: string | null
          counted_by?: string | null
          counted_by_name?: string | null
          counted_qty?: number | null
          created_at?: string
          id?: string
          inventory_count_id: string
          position?: number
          reason_code?: string | null
          recipe_item_id: string
          recount_of?: string | null
          storage_area_id?: string | null
          system_qty?: number | null
          variance_pct?: number | null
          variance_qty?: number | null
          variance_value?: number | null
          within_tolerance?: boolean | null
        }
        Update: {
          abc_class?: string | null
          account_id?: string
          assigned_to?: string | null
          counted_by?: string | null
          counted_by_name?: string | null
          counted_qty?: number | null
          created_at?: string
          id?: string
          inventory_count_id?: string
          position?: number
          reason_code?: string | null
          recipe_item_id?: string
          recount_of?: string | null
          storage_area_id?: string | null
          system_qty?: number | null
          variance_pct?: number | null
          variance_qty?: number | null
          variance_value?: number | null
          within_tolerance?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_count_line_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_line_inventory_count_id_fkey"
            columns: ["inventory_count_id"]
            isOneToOne: false
            referencedRelation: "inventory_count"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_line_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_line_recount_of_fkey"
            columns: ["recount_of"]
            isOneToOne: false
            referencedRelation: "inventory_count_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_count_line_storage_area_id_fkey"
            columns: ["storage_area_id"]
            isOneToOne: false
            referencedRelation: "storage_area"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_approval_rule: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          location_id: string | null
          max_amount: number | null
          min_amount: number | null
          priority: number
          required_role: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          location_id?: string | null
          max_amount?: number | null
          min_amount?: number | null
          priority?: number
          required_role?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          location_id?: string | null
          max_amount?: number | null
          min_amount?: number | null
          priority?: number
          required_role?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_approval_rule_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_approval_rule_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          account_id: string
          amount_eur: number
          created_at: string
          due_at: string | null
          id: string
          issued_at: string | null
          metadata: Json | null
          number: string | null
          paid_at: string | null
          pdf_url: string | null
          status: string
          stripe_invoice_id: string | null
          tax_eur: number
          total_eur: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount_eur: number
          created_at?: string
          due_at?: string | null
          id?: string
          issued_at?: string | null
          metadata?: Json | null
          number?: string | null
          paid_at?: string | null
          pdf_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tax_eur?: number
          total_eur?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount_eur?: number
          created_at?: string
          due_at?: string | null
          id?: string
          issued_at?: string | null
          metadata?: Json | null
          number?: string | null
          paid_at?: string | null
          pdf_url?: string | null
          status?: string
          stripe_invoice_id?: string | null
          tax_eur?: number
          total_eur?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_device: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          last_seen_at: string | null
          location_id: string
          station_ids: string[] | null
          token: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          last_seen_at?: string | null
          location_id: string
          station_ids?: string[] | null
          token: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          last_seen_at?: string | null
          location_id?: string
          station_ids?: string[] | null
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kds_device_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kds_device_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_line_state: {
        Row: {
          account_id: string
          id: string
          marked: boolean
          marked_at: string | null
          sale_line_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          id?: string
          marked?: boolean
          marked_at?: string | null
          sale_line_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          id?: string
          marked?: boolean
          marked_at?: string | null
          sale_line_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kds_line_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kds_line_state_sale_line_id_fkey"
            columns: ["sale_line_id"]
            isOneToOne: true
            referencedRelation: "sale_line"
            referencedColumns: ["id"]
          },
        ]
      }
      kds_ticket_station_state: {
        Row: {
          account_id: string
          id: string
          sale_id: string
          station_id: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          id?: string
          sale_id: string
          station_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          id?: string
          sale_id?: string
          station_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kds_ticket_station_state_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kds_ticket_station_state_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kds_ticket_station_state_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_station"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_cut_type: {
        Row: {
          account_id: string
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_cut_type_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_cut_type_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "kitchen_cut_type_template"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_cut_type_template: {
        Row: {
          code: string
          created_at: string
          icon: string | null
          id: string
          name_en: string
          name_es: string
          position: number
        }
        Insert: {
          code: string
          created_at?: string
          icon?: string | null
          id?: string
          name_en: string
          name_es: string
          position?: number
        }
        Update: {
          code?: string
          created_at?: string
          icon?: string | null
          id?: string
          name_en?: string
          name_es?: string
          position?: number
        }
        Relationships: []
      }
      kitchen_family_route: {
        Row: {
          account_id: string
          created_at: string
          family_id: string
          id: string
          station_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          family_id: string
          id?: string
          station_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          family_id?: string
          id?: string
          station_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_family_route_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_family_route_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "recipe_family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_family_route_station_id_fkey"
            columns: ["station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_station"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_settings: {
        Row: {
          account_id: string
          ai_default_model: string
          ai_escalation_enabled: boolean
          allow_negative_yield: boolean
          audit_mode_default: string
          audit_shadow_min_samples: number
          audit_threshold_default: number
          cost_strategy_default: string
          cost_window_days_default: number
          created_at: string
          created_by: string | null
          created_by_name: string | null
          currency: string
          id: string
          indirect_cost_pct_default: number
          labor_target_pct: number | null
          max_recipe_depth_warning: number
          photo_retention_days: number
          price_rounding: string
          reliability_min_pct: number
          target_food_cost_pct: number | null
          target_plate_cost_pct: number | null
          transcription_language: string
          updated_at: string
          version_alert_pct: number
        }
        Insert: {
          account_id: string
          ai_default_model?: string
          ai_escalation_enabled?: boolean
          allow_negative_yield?: boolean
          audit_mode_default?: string
          audit_shadow_min_samples?: number
          audit_threshold_default?: number
          cost_strategy_default?: string
          cost_window_days_default?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          id?: string
          indirect_cost_pct_default?: number
          labor_target_pct?: number | null
          max_recipe_depth_warning?: number
          photo_retention_days?: number
          price_rounding?: string
          reliability_min_pct?: number
          target_food_cost_pct?: number | null
          target_plate_cost_pct?: number | null
          transcription_language?: string
          updated_at?: string
          version_alert_pct?: number
        }
        Update: {
          account_id?: string
          ai_default_model?: string
          ai_escalation_enabled?: boolean
          allow_negative_yield?: boolean
          audit_mode_default?: string
          audit_shadow_min_samples?: number
          audit_threshold_default?: number
          cost_strategy_default?: string
          cost_window_days_default?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          id?: string
          indirect_cost_pct_default?: number
          labor_target_pct?: number | null
          max_recipe_depth_warning?: number
          photo_retention_days?: number
          price_rounding?: string
          reliability_min_pct?: number
          target_food_cost_pct?: number | null
          target_plate_cost_pct?: number | null
          transcription_language?: string
          updated_at?: string
          version_alert_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_station: {
        Row: {
          account_id: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          is_default: boolean
          kind: string
          location_id: string
          name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind?: string
          location_id: string
          name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          kind?: string
          location_id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_station_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_station_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_unit: {
        Row: {
          abbreviation: string
          account_id: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          dimension: string
          factor_to_base: number
          id: string
          is_active: boolean
          is_base: boolean
          is_seed: boolean
          name: string
          updated_at: string
        }
        Insert: {
          abbreviation: string
          account_id?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          dimension: string
          factor_to_base: number
          id?: string
          is_active?: boolean
          is_base?: boolean
          is_seed?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          abbreviation?: string
          account_id?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          dimension?: string
          factor_to_base?: number
          id?: string
          is_active?: boolean
          is_base?: boolean
          is_seed?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_unit_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      lastapp_webhook_log: {
        Row: {
          headers: Json | null
          id: string
          note: string | null
          payload: Json | null
          processed: boolean
          received_at: string
        }
        Insert: {
          headers?: Json | null
          id?: string
          note?: string | null
          payload?: Json | null
          processed?: boolean
          received_at?: string
        }
        Update: {
          headers?: Json | null
          id?: string
          note?: string | null
          payload?: Json | null
          processed?: boolean
          received_at?: string
        }
        Relationships: []
      }
      local_event: {
        Row: {
          account_id: string
          created_at: string
          demand_effect: string
          ends_at: string
          event_type: string
          id: string
          name: string
          notes: string | null
          starts_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          demand_effect?: string
          ends_at: string
          event_type?: string
          id?: string
          name: string
          notes?: string | null
          starts_at: string
        }
        Update: {
          account_id?: string
          created_at?: string
          demand_effect?: string
          ends_at?: string
          event_type?: string
          id?: string
          name?: string
          notes?: string | null
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "local_event_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          account_id: string | null
          active: boolean
          address: string | null
          clock_geofence_mode: string
          clock_radius_m: number
          created_at: string
          dispatch_broker: string
          dispatch_mode: string
          glovo_pos_hint: string | null
          hours_balance_close_day: number | null
          hours_balance_sync_with_gestoria: boolean | null
          id: string
          is_billable: boolean
          lat: number | null
          lng: number | null
          name: string
          phone: string | null
          receipt_approval: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          address?: string | null
          clock_geofence_mode?: string
          clock_radius_m?: number
          created_at?: string
          dispatch_broker?: string
          dispatch_mode?: string
          glovo_pos_hint?: string | null
          hours_balance_close_day?: number | null
          hours_balance_sync_with_gestoria?: boolean | null
          id?: string
          is_billable?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          phone?: string | null
          receipt_approval?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          address?: string | null
          clock_geofence_mode?: string
          clock_radius_m?: number
          created_at?: string
          dispatch_broker?: string
          dispatch_mode?: string
          glovo_pos_hint?: string | null
          hours_balance_close_day?: number | null
          hours_balance_sync_with_gestoria?: boolean | null
          id?: string
          is_billable?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          phone?: string | null
          receipt_approval?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_locations: {
        Row: {
          created_at: string
          id: string
          location_id: string
          user_profile_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          user_profile_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_locations_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_permissions: {
        Row: {
          can_manage_employees: boolean
          created_at: string | null
          show_ahora_mismo: boolean
          show_appcc_incidents: boolean | null
          show_appcc_today: boolean | null
          show_audits: boolean
          show_bolsa_horas: boolean
          show_calendario: boolean
          show_cambios_pendientes: boolean
          show_dashboard: boolean
          show_fichajes_global: boolean
          show_history: boolean
          show_incidents: boolean
          show_informes_personal: boolean
          show_inventory: boolean
          show_kiosko_fichaje: boolean
          show_locations: boolean
          show_plantilla_turnos: boolean
          show_prediccion_personal: boolean
          show_salaries: boolean
          show_scheduled: boolean
          show_solicitudes_pendientes: boolean
          show_staff: boolean
          show_tasks: boolean
          show_templates: boolean
          show_tspoon: boolean
          show_tspoon_settings: boolean
          show_turnos_abiertos: boolean
          show_ventas_analisis: boolean
          show_zonas_pedido: boolean
          updated_at: string | null
          user_profile_id: string
        }
        Insert: {
          can_manage_employees?: boolean
          created_at?: string | null
          show_ahora_mismo?: boolean
          show_appcc_incidents?: boolean | null
          show_appcc_today?: boolean | null
          show_audits?: boolean
          show_bolsa_horas?: boolean
          show_calendario?: boolean
          show_cambios_pendientes?: boolean
          show_dashboard?: boolean
          show_fichajes_global?: boolean
          show_history?: boolean
          show_incidents?: boolean
          show_informes_personal?: boolean
          show_inventory?: boolean
          show_kiosko_fichaje?: boolean
          show_locations?: boolean
          show_plantilla_turnos?: boolean
          show_prediccion_personal?: boolean
          show_salaries?: boolean
          show_scheduled?: boolean
          show_solicitudes_pendientes?: boolean
          show_staff?: boolean
          show_tasks?: boolean
          show_templates?: boolean
          show_tspoon?: boolean
          show_tspoon_settings?: boolean
          show_turnos_abiertos?: boolean
          show_ventas_analisis?: boolean
          show_zonas_pedido?: boolean
          updated_at?: string | null
          user_profile_id: string
        }
        Update: {
          can_manage_employees?: boolean
          created_at?: string | null
          show_ahora_mismo?: boolean
          show_appcc_incidents?: boolean | null
          show_appcc_today?: boolean | null
          show_audits?: boolean
          show_bolsa_horas?: boolean
          show_calendario?: boolean
          show_cambios_pendientes?: boolean
          show_dashboard?: boolean
          show_fichajes_global?: boolean
          show_history?: boolean
          show_incidents?: boolean
          show_informes_personal?: boolean
          show_inventory?: boolean
          show_kiosko_fichaje?: boolean
          show_locations?: boolean
          show_plantilla_turnos?: boolean
          show_prediccion_personal?: boolean
          show_salaries?: boolean
          show_scheduled?: boolean
          show_solicitudes_pendientes?: boolean
          show_staff?: boolean
          show_tasks?: boolean
          show_templates?: boolean
          show_tspoon?: boolean
          show_tspoon_settings?: boolean
          show_turnos_abiertos?: boolean
          show_ventas_analisis?: boolean
          show_zonas_pedido?: boolean
          updated_at?: string | null
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manager_permissions_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mapping_candidate: {
        Row: {
          created_at: string
          id: string
          proposal_id: string
          rank: number
          reason: string | null
          score: number
          target_id: string
          target_label: string
        }
        Insert: {
          created_at?: string
          id?: string
          proposal_id: string
          rank: number
          reason?: string | null
          score: number
          target_id: string
          target_label: string
        }
        Update: {
          created_at?: string
          id?: string
          proposal_id?: string
          rank?: number
          reason?: string | null
          score?: number
          target_id?: string
          target_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "mapping_candidate_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "mapping_proposal"
            referencedColumns: ["id"]
          },
        ]
      }
      mapping_decision: {
        Row: {
          account_id: string
          action: string
          chosen_target_id: string | null
          created_at: string
          decided_by: string | null
          decided_by_name: string | null
          id: string
          note: string | null
          proposal_id: string
        }
        Insert: {
          account_id: string
          action: string
          chosen_target_id?: string | null
          created_at?: string
          decided_by?: string | null
          decided_by_name?: string | null
          id?: string
          note?: string | null
          proposal_id: string
        }
        Update: {
          account_id?: string
          action?: string
          chosen_target_id?: string | null
          created_at?: string
          decided_by?: string | null
          decided_by_name?: string | null
          id?: string
          note?: string | null
          proposal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mapping_decision_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mapping_decision_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "mapping_proposal"
            referencedColumns: ["id"]
          },
        ]
      }
      mapping_proposal: {
        Row: {
          account_id: string
          chosen_target_id: string | null
          confidence: number | null
          context_brand_id: string | null
          created_at: string
          engine_version: string | null
          id: string
          method: string
          rationale: string | null
          source_kind: string
          source_normalized: string
          source_ref: string | null
          source_text: string
          status: string
          target_kind: string
          updated_at: string
        }
        Insert: {
          account_id: string
          chosen_target_id?: string | null
          confidence?: number | null
          context_brand_id?: string | null
          created_at?: string
          engine_version?: string | null
          id?: string
          method?: string
          rationale?: string | null
          source_kind: string
          source_normalized: string
          source_ref?: string | null
          source_text: string
          status?: string
          target_kind: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          chosen_target_id?: string | null
          confidence?: number | null
          context_brand_id?: string | null
          created_at?: string
          engine_version?: string | null
          id?: string
          method?: string
          rationale?: string | null
          source_kind?: string
          source_normalized?: string
          source_ref?: string | null
          source_text?: string
          status?: string
          target_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mapping_proposal_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mapping_proposal_context_brand_id_fkey"
            columns: ["context_brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_category: {
        Row: {
          account_id: string
          brand_id: string
          created_at: string
          emoji: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          name: string
          parent_id: string | null
          position: number
          slug: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          brand_id: string
          created_at?: string
          emoji?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name: string
          parent_id?: string | null
          position?: number
          slug?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          brand_id?: string
          created_at?: string
          emoji?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          name?: string
          parent_id?: string | null
          position?: number
          slug?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_category_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_category_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_category_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "menu_category"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item: {
        Row: {
          account_id: string
          ai_confidence: number | null
          ai_suggested_price: number | null
          archived_at: string | null
          availability_reason: string | null
          available_until: string | null
          brand_id: string
          category: string | null
          channel_id: string | null
          consumption_price: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          description: string | null
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          is_available: boolean
          kitchen_name: string | null
          menu_category_id: string | null
          mirror_of_item_id: string | null
          name: string
          needs_review: boolean
          notes_internal: string | null
          packaging_cost: number | null
          packaging_description: string | null
          photo_url: string | null
          position: number
          price: number
          product_type: string
          recipe_item_id: string | null
          short_name: string | null
          source: string
          tags: string[] | null
          target_food_cost_pct: number | null
          updated_at: string
          vat_rate: number
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          ai_suggested_price?: number | null
          archived_at?: string | null
          availability_reason?: string | null
          available_until?: string | null
          brand_id: string
          category?: string | null
          channel_id?: string | null
          consumption_price?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          kitchen_name?: string | null
          menu_category_id?: string | null
          mirror_of_item_id?: string | null
          name: string
          needs_review?: boolean
          notes_internal?: string | null
          packaging_cost?: number | null
          packaging_description?: string | null
          photo_url?: string | null
          position?: number
          price: number
          product_type?: string
          recipe_item_id?: string | null
          short_name?: string | null
          source?: string
          tags?: string[] | null
          target_food_cost_pct?: number | null
          updated_at?: string
          vat_rate?: number
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          ai_suggested_price?: number | null
          archived_at?: string | null
          availability_reason?: string | null
          available_until?: string | null
          brand_id?: string
          category?: string | null
          channel_id?: string | null
          consumption_price?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          description?: string | null
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          is_available?: boolean
          kitchen_name?: string | null
          menu_category_id?: string | null
          mirror_of_item_id?: string | null
          name?: string
          needs_review?: boolean
          notes_internal?: string | null
          packaging_cost?: number | null
          packaging_description?: string | null
          photo_url?: string | null
          position?: number
          price?: number
          product_type?: string
          recipe_item_id?: string | null
          short_name?: string | null
          source?: string
          tags?: string[] | null
          target_food_cost_pct?: number | null
          updated_at?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_brand_fk"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_channel_fk"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_menu_category_id_fkey"
            columns: ["menu_category_id"]
            isOneToOne: false
            referencedRelation: "menu_category"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_mirror_of_item_id_fkey"
            columns: ["mirror_of_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_recipe_item_fk"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_override: {
        Row: {
          account_id: string
          category_name: string | null
          channel_id: string | null
          created_at: string
          description: string | null
          external_id: string | null
          id: string
          is_available: boolean | null
          location_id: string | null
          menu_item_id: string
          name: string | null
          photo_url: string | null
          price: number | null
          short_name: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          category_name?: string | null
          channel_id?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          is_available?: boolean | null
          location_id?: string | null
          menu_item_id: string
          name?: string | null
          photo_url?: string | null
          price?: number | null
          short_name?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          category_name?: string | null
          channel_id?: string | null
          created_at?: string
          description?: string | null
          external_id?: string | null
          id?: string
          is_available?: boolean | null
          location_id?: string | null
          menu_item_id?: string
          name?: string | null
          photo_url?: string | null
          price?: number | null
          short_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_override_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_override_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_override_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_override_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_price_history: {
        Row: {
          account_id: string
          captured_at: string
          id: string
          menu_item_id: string
          price: number
        }
        Insert: {
          account_id: string
          captured_at?: string
          id?: string
          menu_item_id: string
          price: number
        }
        Update: {
          account_id?: string
          captured_at?: string
          id?: string
          menu_item_id?: string
          price?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_price_history_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_price_history_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_group: {
        Row: {
          account_id: string
          allow_repetition: boolean
          brand_id: string
          created_at: string
          external_id: string | null
          external_source: string | null
          group_type: string
          id: string
          internal_name: string | null
          is_active: boolean
          max_selections: number
          min_selections: number
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          account_id: string
          allow_repetition?: boolean
          brand_id: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          group_type?: string
          id?: string
          internal_name?: string | null
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name: string
          position?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          allow_repetition?: boolean
          brand_id?: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          group_type?: string
          id?: string
          internal_name?: string | null
          is_active?: boolean
          max_selections?: number
          min_selections?: number
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_group_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_group_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_group_assignment: {
        Row: {
          account_id: string
          created_at: string
          id: string
          menu_item_id: string
          modifier_group_id: string
          position: number
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          menu_item_id: string
          modifier_group_id: string
          position?: number
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          menu_item_id?: string
          modifier_group_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "modifier_group_assignment_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_group_assignment_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_group_assignment_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_group"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_option: {
        Row: {
          account_id: string
          created_at: string
          external_id: string | null
          external_source: string | null
          id: string
          is_active: boolean
          is_default: boolean
          modifier_group_id: string
          name: string
          position: number
          price_impact: number
          recipe_item_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          modifier_group_id: string
          name: string
          position?: number
          price_impact?: number
          recipe_item_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          external_id?: string | null
          external_source?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          modifier_group_id?: string
          name?: string
          position?: number
          price_impact?: number
          recipe_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_option_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_option_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_group"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_option_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_recipe_impact: {
        Row: {
          account_id: string
          confidence: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_by_name: string | null
          created_at: string
          id: string
          impact_type: string
          modifier_option_id: string
          quantity: number | null
          rationale: string | null
          source: string
          status: string
          target_recipe_item_id: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_name?: string | null
          created_at?: string
          id?: string
          impact_type: string
          modifier_option_id: string
          quantity?: number | null
          rationale?: string | null
          source?: string
          status?: string
          target_recipe_item_id?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_name?: string | null
          created_at?: string
          id?: string
          impact_type?: string
          modifier_option_id?: string
          quantity?: number | null
          rationale?: string | null
          source?: string
          status?: string
          target_recipe_item_id?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_recipe_impact_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_recipe_impact_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_option"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_recipe_impact_target_recipe_item_id_fkey"
            columns: ["target_recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_recipe_impact_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          category: string
          code: string
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_base: boolean
          name: string
          sort_order: number | null
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          code: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_base?: boolean
          name: string
          sort_order?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          code?: string
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_base?: boolean
          name?: string
          sort_order?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      monthly_balance_closures: {
        Row: {
          closed_at: string
          closed_by: string | null
          contracted_hours_period: number
          delta: number
          employee_id: string
          id: string
          location_id: string
          period_end: string
          period_label: string
          period_start: string
          resolution: string
          resolution_amount: number | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          scheduled_hours: number
          vacation_hours: number
        }
        Insert: {
          closed_at?: string
          closed_by?: string | null
          contracted_hours_period?: number
          delta?: number
          employee_id: string
          id?: string
          location_id: string
          period_end: string
          period_label: string
          period_start: string
          resolution?: string
          resolution_amount?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scheduled_hours?: number
          vacation_hours?: number
        }
        Update: {
          closed_at?: string
          closed_by?: string | null
          contracted_hours_period?: number
          delta?: number
          employee_id?: string
          id?: string
          location_id?: string
          period_end?: string
          period_label?: string
          period_start?: string
          resolution?: string
          resolution_amount?: number | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          scheduled_hours?: number
          vacation_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_balance_closures_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_balance_closures_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      offers_agent_config: {
        Row: {
          account_id: string
          aggressiveness: string
          enabled: boolean
          growth_mode: boolean
          margin_floor_pct: number
          max_campaign_days: number
          platform_mode: string
          push_agent_secret: string | null
          recovery_target_pct: number
          shop_mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          aggressiveness?: string
          enabled?: boolean
          growth_mode?: boolean
          margin_floor_pct?: number
          max_campaign_days?: number
          platform_mode?: string
          push_agent_secret?: string | null
          recovery_target_pct?: number
          shop_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          aggressiveness?: string
          enabled?: boolean
          growth_mode?: boolean
          margin_floor_pct?: number
          max_campaign_days?: number
          platform_mode?: string
          push_agent_secret?: string | null
          recovery_target_pct?: number
          shop_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offers_agent_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      open_shift_requests: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          notes: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          shift_id: string
          status: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          notes?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id: string
          status?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          notes?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          shift_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_shift_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shift_requests_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "open_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      open_shifts: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          date: string
          end_time: string
          id: string
          location_id: string
          notes: string | null
          position: string | null
          start_time: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          date: string
          end_time: string
          id?: string
          location_id: string
          notes?: string | null
          position?: string | null
          start_time: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          end_time?: string
          id?: string
          location_id?: string
          notes?: string | null
          position?: string | null
          start_time?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "open_shifts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_shifts_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_acceptance_config: {
        Row: {
          account_id: string
          auto_accept: boolean
          brand_id: string | null
          channel_id: string | null
          id: string
          respect_hours: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          auto_accept?: boolean
          brand_id?: string | null
          channel_id?: string | null
          id?: string
          respect_hours?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          auto_accept?: boolean
          brand_id?: string | null
          channel_id?: string | null
          id?: string
          respect_hours?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_acceptance_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_acceptance_config_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_acceptance_config_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channel"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_set_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          permission_set_id: string
          user_profile_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          permission_set_id: string
          user_profile_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          permission_set_id?: string
          user_profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_set_assignments_permission_set_id_fkey"
            columns: ["permission_set_id"]
            isOneToOne: false
            referencedRelation: "permission_sets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "permission_set_assignments_user_profile_id_fkey"
            columns: ["user_profile_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_sets: {
        Row: {
          account_id: string | null
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_system: boolean
          name: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_sets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admin_2fa: {
        Row: {
          activated_at: string
          backup_codes_hash: string[]
          backup_codes_used: number[]
          id: string
          last_used_at: string | null
          platform_admin_id: string
          totp_secret: string
        }
        Insert: {
          activated_at?: string
          backup_codes_hash?: string[]
          backup_codes_used?: number[]
          id?: string
          last_used_at?: string | null
          platform_admin_id: string
          totp_secret: string
        }
        Update: {
          activated_at?: string
          backup_codes_hash?: string[]
          backup_codes_used?: number[]
          id?: string
          last_used_at?: string | null
          platform_admin_id?: string
          totp_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admin_2fa_platform_admin_id_fkey"
            columns: ["platform_admin_id"]
            isOneToOne: true
            referencedRelation: "platform_admins"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admin_permissions: {
        Row: {
          id: string
          platform_admin_id: string
          platform_can_archive_accounts: boolean
          platform_can_create_accounts: boolean
          platform_can_delete_accounts: boolean
          platform_can_edit_seed_data: boolean
          platform_can_impersonate: boolean
          platform_can_manage_admins: boolean
          platform_can_reset_2fa_of_others: boolean
          platform_can_send_global_notifications: boolean
          platform_can_suspend_accounts: boolean
          platform_can_view_audit_log: boolean
          platform_can_view_system_health: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          platform_admin_id: string
          platform_can_archive_accounts?: boolean
          platform_can_create_accounts?: boolean
          platform_can_delete_accounts?: boolean
          platform_can_edit_seed_data?: boolean
          platform_can_impersonate?: boolean
          platform_can_manage_admins?: boolean
          platform_can_reset_2fa_of_others?: boolean
          platform_can_send_global_notifications?: boolean
          platform_can_suspend_accounts?: boolean
          platform_can_view_audit_log?: boolean
          platform_can_view_system_health?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          platform_admin_id?: string
          platform_can_archive_accounts?: boolean
          platform_can_create_accounts?: boolean
          platform_can_delete_accounts?: boolean
          platform_can_edit_seed_data?: boolean
          platform_can_impersonate?: boolean
          platform_can_manage_admins?: boolean
          platform_can_reset_2fa_of_others?: boolean
          platform_can_send_global_notifications?: boolean
          platform_can_suspend_accounts?: boolean
          platform_can_view_audit_log?: boolean
          platform_can_view_system_health?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_admin_permissions_platform_admin_id_fkey"
            columns: ["platform_admin_id"]
            isOneToOne: true
            referencedRelation: "platform_admins"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          full_name: string
          id: string
          last_login_at: string | null
          notes: string | null
          role: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          full_name: string
          id?: string
          last_login_at?: string | null
          notes?: string | null
          role: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          full_name?: string
          id?: string
          last_login_at?: string | null
          notes?: string | null
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_api_token: {
        Row: {
          access_token: string
          expires_at: string
          platform: string
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          platform: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          platform?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_audit_log: {
        Row: {
          created_at: string
          details: Json | null
          event_type: string
          id: string
          ip_address: unknown
          platform_admin_id: string | null
          target_account_id: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          event_type: string
          id?: string
          ip_address?: unknown
          platform_admin_id?: string | null
          target_account_id?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          event_type?: string
          id?: string
          ip_address?: unknown
          platform_admin_id?: string | null
          target_account_id?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_audit_log_platform_admin_id_fkey"
            columns: ["platform_admin_id"]
            isOneToOne: false
            referencedRelation: "platform_admins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_audit_log_target_account_id_fkey"
            columns: ["target_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      print_job: {
        Row: {
          account_id: string
          attempts: number
          created_at: string
          doc_type: string
          done_at: string | null
          id: string
          last_error: string | null
          location_id: string
          payload: Json
          printer_id: string | null
          sale_id: string | null
          sent_at: string | null
          source: string
          status: string
        }
        Insert: {
          account_id: string
          attempts?: number
          created_at?: string
          doc_type: string
          done_at?: string | null
          id?: string
          last_error?: string | null
          location_id: string
          payload: Json
          printer_id?: string | null
          sale_id?: string | null
          sent_at?: string | null
          source?: string
          status?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          created_at?: string
          doc_type?: string
          done_at?: string | null
          id?: string
          last_error?: string | null
          location_id?: string
          payload?: Json
          printer_id?: string | null
          sale_id?: string | null
          sent_at?: string | null
          source?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "print_job_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_job_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_job_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "print_job_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale"
            referencedColumns: ["id"]
          },
        ]
      }
      printer: {
        Row: {
          account_id: string
          config: Json
          created_at: string
          doc_types: string[]
          id: string
          is_active: boolean
          location_id: string
          name: string
          transport: string
          updated_at: string
        }
        Insert: {
          account_id: string
          config?: Json
          created_at?: string
          doc_types?: string[]
          id?: string
          is_active?: boolean
          location_id: string
          name: string
          transport: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          config?: Json
          created_at?: string
          doc_types?: string[]
          id?: string
          is_active?: boolean
          location_id?: string
          name?: string
          transport?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "printer_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "printer_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_availability: {
        Row: {
          account_id: string
          available_until: string | null
          created_at: string
          external_id: string | null
          id: string
          is_available: boolean
          location_id: string | null
          reason: string
          recipe_item_id: string | null
          set_at: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          available_until?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          is_available?: boolean
          location_id?: string | null
          reason?: string
          recipe_item_id?: string | null
          set_at?: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          available_until?: string | null
          created_at?: string
          external_id?: string | null
          id?: string
          is_available?: boolean
          location_id?: string | null
          reason?: string
          recipe_item_id?: string | null
          set_at?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promo_push_job: {
        Row: {
          account_id: string
          action: string
          attempts: number
          brand_id: string
          coupon_id: string
          created_at: string
          external_ref: string | null
          id: string
          last_error: string | null
          location_id: string | null
          payload: Json
          platform: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          action: string
          attempts?: number
          brand_id: string
          coupon_id: string
          created_at?: string
          external_ref?: string | null
          id?: string
          last_error?: string | null
          location_id?: string | null
          payload: Json
          platform: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          action?: string
          attempts?: number
          brand_id?: string
          coupon_id?: string
          created_at?: string
          external_ref?: string | null
          id?: string
          last_error?: string | null
          location_id?: string | null
          payload?: Json
          platform?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promo_push_job_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_push_job_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_push_job_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_push_job_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase: {
        Row: {
          account_id: string
          ai_confidence: number | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          document_date: string | null
          document_number: string | null
          id: string
          is_active: boolean
          location_id: string
          needs_review: boolean
          notes: string | null
          raw_document_url: string | null
          received_at: string | null
          source: string
          status: string
          subtotal: number | null
          supplier_id: string | null
          tax: number | null
          total: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          document_date?: string | null
          document_number?: string | null
          id?: string
          is_active?: boolean
          location_id: string
          needs_review?: boolean
          notes?: string | null
          raw_document_url?: string | null
          received_at?: string | null
          source?: string
          status?: string
          subtotal?: number | null
          supplier_id?: string | null
          tax?: number | null
          total?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          document_date?: string | null
          document_number?: string | null
          id?: string
          is_active?: boolean
          location_id?: string
          needs_review?: boolean
          notes?: string | null
          raw_document_url?: string | null
          received_at?: string | null
          source?: string
          status?: string
          subtotal?: number | null
          supplier_id?: string | null
          tax?: number | null
          total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_line: {
        Row: {
          account_id: string
          created_at: string
          id: string
          line_total: number | null
          map_confidence: number | null
          map_needs_review: boolean
          map_source: string | null
          product_name: string | null
          purchase_id: string
          purchase_unit_id: string | null
          quantity: number
          raw_text: string | null
          recipe_item_id: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          line_total?: number | null
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string | null
          product_name?: string | null
          purchase_id: string
          purchase_unit_id?: string | null
          quantity: number
          raw_text?: string | null
          recipe_item_id?: string | null
          unit_price: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          line_total?: number | null
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string | null
          product_name?: string | null
          purchase_id?: string
          purchase_unit_id?: string | null
          quantity?: number
          raw_text?: string | null
          recipe_item_id?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_line_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchase"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_line_purchase_unit_id_fkey"
            columns: ["purchase_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_line_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order: {
        Row: {
          account_id: string
          archived_at: string | null
          code: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          currency: string
          est_subtotal: number | null
          est_total: number | null
          expected_date: string | null
          id: string
          is_active: boolean
          location_id: string | null
          notes: string | null
          order_date: string
          origin: string
          source_need_ref: string | null
          status: string
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          est_subtotal?: number | null
          est_total?: number | null
          expected_date?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          notes?: string | null
          order_date?: string
          origin?: string
          source_need_ref?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          code?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          currency?: string
          est_subtotal?: number | null
          est_total?: number | null
          expected_date?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          notes?: string | null
          order_date?: string
          origin?: string
          source_need_ref?: string | null
          status?: string
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_line: {
        Row: {
          account_id: string
          created_at: string
          est_line_total: number | null
          est_unit_price: number | null
          id: string
          notes: string | null
          position: number
          product_name: string
          purchase_format_id: string | null
          purchase_order_id: string
          purchase_unit_id: string | null
          qty_ordered: number
          recipe_item_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          est_line_total?: number | null
          est_unit_price?: number | null
          id?: string
          notes?: string | null
          position?: number
          product_name: string
          purchase_format_id?: string | null
          purchase_order_id: string
          purchase_unit_id?: string | null
          qty_ordered: number
          recipe_item_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          est_line_total?: number | null
          est_unit_price?: number | null
          id?: string
          notes?: string | null
          position?: number
          product_name?: string
          purchase_format_id?: string | null
          purchase_order_id?: string
          purchase_unit_id?: string | null
          qty_ordered?: number
          recipe_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_line_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_line_purchase_format_id_fkey"
            columns: ["purchase_format_id"]
            isOneToOne: false
            referencedRelation: "recipe_item_purchase_format"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_line_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_order"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_line_purchase_unit_id_fkey"
            columns: ["purchase_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_line_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      quotas: {
        Row: {
          account_id: string
          limit_value: number
          quota_key: string
          updated_at: string
        }
        Insert: {
          account_id: string
          limit_value: number
          quota_key: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          limit_value?: number
          quota_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotas_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_family: {
        Row: {
          account_id: string
          accounting_category: string | null
          code: string | null
          color: string | null
          created_at: string
          icon: string | null
          id: string
          is_active: boolean
          name: string
          parent_family_id: string | null
          position: number
          scope: string
          template_id: string | null
        }
        Insert: {
          account_id: string
          accounting_category?: string | null
          code?: string | null
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          parent_family_id?: string | null
          position?: number
          scope: string
          template_id?: string | null
        }
        Update: {
          account_id?: string
          accounting_category?: string | null
          code?: string | null
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          parent_family_id?: string | null
          position?: number
          scope?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dish_family_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_family_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "dish_family_template"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_family_parent_family_id_fkey"
            columns: ["parent_family_id"]
            isOneToOne: false
            referencedRelation: "recipe_family"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item: {
        Row: {
          account_id: string
          ai_confidence: number | null
          alt_name: string | null
          alt_names: string[]
          archived_at: string | null
          base_unit_id: string
          category: string | null
          chef_notes: string | null
          code: string | null
          completeness: Json | null
          computed_cost: number | null
          conservation_type: string | null
          cook_time_minutes: number | null
          cost_strategy: string
          cost_updated_at: string | null
          cost_window_days: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          current_stock: number | null
          current_stock_unit_id: string | null
          default_waste_pct: number | null
          external_codes: Json
          family_id: string | null
          finishing_notes: string | null
          fixed_cost: number | null
          folvy_code: string | null
          id: string
          indirect_cost_pct: number | null
          is_active: boolean
          is_operational_critical: boolean
          is_purchasable: boolean
          is_sellable: boolean
          is_stockable: boolean
          kds_station_id: string | null
          kitchen_photo_url: string | null
          label_override: string | null
          label_simplified: boolean
          last_purchase_date: string | null
          media: Json | null
          menu_tags: string[]
          name: string
          needs_review: boolean
          notes: string | null
          nutrition: Json | null
          operational_min_qty: number | null
          origin: string | null
          packaging_cost: number
          plating_notes: string | null
          prep_notes: string | null
          prep_time_minutes: number | null
          procedure_text: string | null
          purchase_unit_id: string | null
          recyclable_packaging: Json | null
          review_dismissed_at: string | null
          review_dismissed_by: string | null
          review_dismissed_reason: string | null
          review_notes: Json | null
          season_end: string | null
          season_start: string | null
          service_temp_c: number | null
          shelf_life_days: number | null
          source: string
          steps_auto_split: boolean
          stock_unit_id: string | null
          supplier_codes: Json | null
          supplier_name: string | null
          supplier_url: string | null
          template_code: string | null
          template_version: number | null
          type: string
          updated_at: string
          vat_category_id: string | null
          vat_category_source: string | null
          yield_portions: number | null
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          alt_name?: string | null
          alt_names?: string[]
          archived_at?: string | null
          base_unit_id: string
          category?: string | null
          chef_notes?: string | null
          code?: string | null
          completeness?: Json | null
          computed_cost?: number | null
          conservation_type?: string | null
          cook_time_minutes?: number | null
          cost_strategy?: string
          cost_updated_at?: string | null
          cost_window_days?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          current_stock?: number | null
          current_stock_unit_id?: string | null
          default_waste_pct?: number | null
          external_codes?: Json
          family_id?: string | null
          finishing_notes?: string | null
          fixed_cost?: number | null
          folvy_code?: string | null
          id?: string
          indirect_cost_pct?: number | null
          is_active?: boolean
          is_operational_critical?: boolean
          is_purchasable?: boolean
          is_sellable?: boolean
          is_stockable?: boolean
          kds_station_id?: string | null
          kitchen_photo_url?: string | null
          label_override?: string | null
          label_simplified?: boolean
          last_purchase_date?: string | null
          media?: Json | null
          menu_tags?: string[]
          name: string
          needs_review?: boolean
          notes?: string | null
          nutrition?: Json | null
          operational_min_qty?: number | null
          origin?: string | null
          packaging_cost?: number
          plating_notes?: string | null
          prep_notes?: string | null
          prep_time_minutes?: number | null
          procedure_text?: string | null
          purchase_unit_id?: string | null
          recyclable_packaging?: Json | null
          review_dismissed_at?: string | null
          review_dismissed_by?: string | null
          review_dismissed_reason?: string | null
          review_notes?: Json | null
          season_end?: string | null
          season_start?: string | null
          service_temp_c?: number | null
          shelf_life_days?: number | null
          source?: string
          steps_auto_split?: boolean
          stock_unit_id?: string | null
          supplier_codes?: Json | null
          supplier_name?: string | null
          supplier_url?: string | null
          template_code?: string | null
          template_version?: number | null
          type: string
          updated_at?: string
          vat_category_id?: string | null
          vat_category_source?: string | null
          yield_portions?: number | null
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          alt_name?: string | null
          alt_names?: string[]
          archived_at?: string | null
          base_unit_id?: string
          category?: string | null
          chef_notes?: string | null
          code?: string | null
          completeness?: Json | null
          computed_cost?: number | null
          conservation_type?: string | null
          cook_time_minutes?: number | null
          cost_strategy?: string
          cost_updated_at?: string | null
          cost_window_days?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          current_stock?: number | null
          current_stock_unit_id?: string | null
          default_waste_pct?: number | null
          external_codes?: Json
          family_id?: string | null
          finishing_notes?: string | null
          fixed_cost?: number | null
          folvy_code?: string | null
          id?: string
          indirect_cost_pct?: number | null
          is_active?: boolean
          is_operational_critical?: boolean
          is_purchasable?: boolean
          is_sellable?: boolean
          is_stockable?: boolean
          kds_station_id?: string | null
          kitchen_photo_url?: string | null
          label_override?: string | null
          label_simplified?: boolean
          last_purchase_date?: string | null
          media?: Json | null
          menu_tags?: string[]
          name?: string
          needs_review?: boolean
          notes?: string | null
          nutrition?: Json | null
          operational_min_qty?: number | null
          origin?: string | null
          packaging_cost?: number
          plating_notes?: string | null
          prep_notes?: string | null
          prep_time_minutes?: number | null
          procedure_text?: string | null
          purchase_unit_id?: string | null
          recyclable_packaging?: Json | null
          review_dismissed_at?: string | null
          review_dismissed_by?: string | null
          review_dismissed_reason?: string | null
          review_notes?: Json | null
          season_end?: string | null
          season_start?: string | null
          service_temp_c?: number | null
          shelf_life_days?: number | null
          source?: string
          steps_auto_split?: boolean
          stock_unit_id?: string | null
          supplier_codes?: Json | null
          supplier_name?: string | null
          supplier_url?: string | null
          template_code?: string | null
          template_version?: number | null
          type?: string
          updated_at?: string
          vat_category_id?: string | null
          vat_category_source?: string | null
          yield_portions?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_base_unit_id_fkey"
            columns: ["base_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_current_stock_unit_id_fkey"
            columns: ["current_stock_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "recipe_family"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_kds_station_id_fkey"
            columns: ["kds_station_id"]
            isOneToOne: false
            referencedRelation: "kitchen_station"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_purchase_unit_id_fkey"
            columns: ["purchase_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_review_dismissed_by_fkey"
            columns: ["review_dismissed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_stock_unit_id_fkey"
            columns: ["stock_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_vat_category_id_fkey"
            columns: ["vat_category_id"]
            isOneToOne: false
            referencedRelation: "vat_category"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_ai_session: {
        Row: {
          account_id: string
          ai_cost_eur: number | null
          ai_latency_ms: number | null
          ai_model: string | null
          created_at: string
          created_by: string | null
          decisions: Json | null
          id: string
          input_files: Json | null
          input_text: string | null
          kind: string
          parsed_result: Json | null
          raw_response: Json | null
          recipe_item_id: string | null
          status: string
          transcription_raw: string | null
          updated_at: string
          user_abandoned: boolean
          user_correction_count: number
        }
        Insert: {
          account_id: string
          ai_cost_eur?: number | null
          ai_latency_ms?: number | null
          ai_model?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: Json | null
          id?: string
          input_files?: Json | null
          input_text?: string | null
          kind: string
          parsed_result?: Json | null
          raw_response?: Json | null
          recipe_item_id?: string | null
          status?: string
          transcription_raw?: string | null
          updated_at?: string
          user_abandoned?: boolean
          user_correction_count?: number
        }
        Update: {
          account_id?: string
          ai_cost_eur?: number | null
          ai_latency_ms?: number | null
          ai_model?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: Json | null
          id?: string
          input_files?: Json | null
          input_text?: string | null
          kind?: string
          parsed_result?: Json | null
          raw_response?: Json | null
          recipe_item_id?: string | null
          status?: string
          transcription_raw?: string | null
          updated_at?: string
          user_abandoned?: boolean
          user_correction_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_ai_session_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_ai_session_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_ai_session_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_allergen: {
        Row: {
          allergen_code: string
          created_at: string
          manual_reason: string | null
          recipe_item_id: string
          source: string
          state: string
        }
        Insert: {
          allergen_code: string
          created_at?: string
          manual_reason?: string | null
          recipe_item_id: string
          source: string
          state: string
        }
        Update: {
          allergen_code?: string
          created_at?: string
          manual_reason?: string | null
          recipe_item_id?: string
          source?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_allergen_allergen_code_fkey"
            columns: ["allergen_code"]
            isOneToOne: false
            referencedRelation: "allergen"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "recipe_item_allergen_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_location_cost: {
        Row: {
          account_id: string
          computed_at: string
          cost_strategy: string
          cost_window_days: number | null
          created_at: string
          id: string
          location_id: string
          recipe_item_id: string
          source: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          account_id: string
          computed_at?: string
          cost_strategy?: string
          cost_window_days?: number | null
          created_at?: string
          id?: string
          location_id: string
          recipe_item_id: string
          source?: string | null
          unit_cost: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          computed_at?: string
          cost_strategy?: string
          cost_window_days?: number | null
          created_at?: string
          id?: string
          location_id?: string
          recipe_item_id?: string
          source?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_location_cost_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_location_cost_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_location_stock: {
        Row: {
          account_id: string
          avg_unit_cost: number | null
          id: string
          location_id: string
          qty_on_hand: number
          recipe_item_id: string
          stock_value: number
          updated_at: string
        }
        Insert: {
          account_id: string
          avg_unit_cost?: number | null
          id?: string
          location_id: string
          qty_on_hand?: number
          recipe_item_id: string
          stock_value?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          avg_unit_cost?: number | null
          id?: string
          location_id?: string
          qty_on_hand?: number
          recipe_item_id?: string
          stock_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_location_stock_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_location_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_location_stock_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_photo: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          photo_kind: string | null
          photo_url: string
          position: number
          recipe_item_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          photo_kind?: string | null
          photo_url: string
          position?: number
          recipe_item_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          photo_kind?: string | null
          photo_url?: string
          position?: number
          recipe_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_photo_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_production_check: {
        Row: {
          ai_cost_eur: number | null
          ai_latency_ms: number | null
          ai_model: string | null
          cook_decision: string | null
          cook_reason: string | null
          created_at: string
          id: string
          is_false_positive: boolean
          issues: Json | null
          location_id: string | null
          match_score: number | null
          photo_url: string
          recipe_item_id: string
          reference_photo_url: string | null
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          ai_cost_eur?: number | null
          ai_latency_ms?: number | null
          ai_model?: string | null
          cook_decision?: string | null
          cook_reason?: string | null
          created_at?: string
          id?: string
          is_false_positive?: boolean
          issues?: Json | null
          location_id?: string | null
          match_score?: number | null
          photo_url: string
          recipe_item_id: string
          reference_photo_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          ai_cost_eur?: number | null
          ai_latency_ms?: number | null
          ai_model?: string | null
          cook_decision?: string | null
          cook_reason?: string | null
          created_at?: string
          id?: string
          is_false_positive?: boolean
          issues?: Json | null
          location_id?: string | null
          match_score?: number | null
          photo_url?: string
          recipe_item_id?: string
          reference_photo_url?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_production_check_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_production_check_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_production_check_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_purchase_format: {
        Row: {
          account_id: string
          ai_confidence: number | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_active: boolean
          is_piece: boolean
          is_weighted: boolean
          item_id: string
          name: string
          needs_review: boolean
          parent_format_id: string | null
          qty_in_base: number
          qty_per_parent: number | null
          source: string
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          is_piece?: boolean
          is_weighted?: boolean
          item_id: string
          name: string
          needs_review?: boolean
          parent_format_id?: string | null
          qty_in_base: number
          qty_per_parent?: number | null
          source?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          is_piece?: boolean
          is_weighted?: boolean
          item_id?: string
          name?: string
          needs_review?: boolean
          parent_format_id?: string | null
          qty_in_base?: number
          qty_per_parent?: number | null
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_purchase_format_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_purchase_format_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_purchase_format_parent_format_id_fkey"
            columns: ["parent_format_id"]
            isOneToOne: false
            referencedRelation: "recipe_item_purchase_format"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ripf_parent_same_item"
            columns: ["parent_format_id", "item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item_purchase_format"
            referencedColumns: ["id", "item_id"]
          },
        ]
      }
      recipe_item_step: {
        Row: {
          created_at: string
          duration_min: number | null
          id: string
          kind: string
          photo_url: string | null
          position: number
          recipe_item_id: string
          temperature_c: number | null
          text: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          created_at?: string
          duration_min?: number | null
          id?: string
          kind?: string
          photo_url?: string | null
          position: number
          recipe_item_id: string
          temperature_c?: number | null
          text: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          created_at?: string
          duration_min?: number | null
          id?: string
          kind?: string
          photo_url?: string | null
          position?: number
          recipe_item_id?: string
          temperature_c?: number | null
          text?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_step_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_step_line: {
        Row: {
          account_id: string
          created_at: string
          id: string
          line_id: string
          step_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          line_id: string
          step_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          line_id?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_step_line_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_step_line_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "recipe_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_step_line_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "recipe_item_step"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_storage_area: {
        Row: {
          account_id: string
          created_at: string
          id: string
          position: number
          recipe_item_id: string
          storage_area_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          position?: number
          recipe_item_id: string
          storage_area_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          position?: number
          recipe_item_id?: string
          storage_area_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_storage_area_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_storage_area_storage_area_id_fkey"
            columns: ["storage_area_id"]
            isOneToOne: false
            referencedRelation: "storage_area"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_tag: {
        Row: {
          created_at: string
          recipe_item_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          recipe_item_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          recipe_item_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_tag_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_tag_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tag"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_unit_conversion: {
        Row: {
          account_id: string
          ai_confidence: number | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          from_unit_id: string
          id: string
          is_active: boolean
          item_id: string
          needs_review: boolean
          qty_in_base: number
          source: string
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_confidence?: number | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          from_unit_id: string
          id?: string
          is_active?: boolean
          item_id: string
          needs_review?: boolean
          qty_in_base: number
          source?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_confidence?: number | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          from_unit_id?: string
          id?: string
          is_active?: boolean
          item_id?: string
          needs_review?: boolean
          qty_in_base?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_unit_conversion_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_unit_conversion_from_unit_id_fkey"
            columns: ["from_unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_unit_conversion_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_item_version: {
        Row: {
          change_note: string | null
          computed_cost: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_milestone: boolean
          milestone_label: string | null
          recipe_item_id: string
          snapshot: Json
          status: string
          valid_from: string
          valid_to: string | null
          version_number: number
        }
        Insert: {
          change_note?: string | null
          computed_cost?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_milestone?: boolean
          milestone_label?: string | null
          recipe_item_id: string
          snapshot: Json
          status?: string
          valid_from: string
          valid_to?: string | null
          version_number: number
        }
        Update: {
          change_note?: string | null
          computed_cost?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_milestone?: boolean
          milestone_label?: string | null
          recipe_item_id?: string
          snapshot?: Json
          status?: string
          valid_from?: string
          valid_to?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_item_version_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_item_version_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_line: {
        Row: {
          account_id: string
          child_item_id: string
          comment: string | null
          created_at: string
          cut_type_id: string | null
          id: string
          parent_item_id: string
          position: number
          quantity_gross: number | null
          quantity_net: number
          unit_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          child_item_id: string
          comment?: string | null
          created_at?: string
          cut_type_id?: string | null
          id?: string
          parent_item_id: string
          position?: number
          quantity_gross?: number | null
          quantity_net: number
          unit_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          child_item_id?: string
          comment?: string | null
          created_at?: string
          cut_type_id?: string | null
          id?: string
          parent_item_id?: string
          position?: number
          quantity_gross?: number | null
          quantity_net?: number
          unit_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipe_line_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_line_child_item_id_fkey"
            columns: ["child_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_line_cut_type_id_fkey"
            columns: ["cut_type_id"]
            isOneToOne: false
            referencedRelation: "kitchen_cut_type"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_line_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_line_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "kitchen_unit"
            referencedColumns: ["id"]
          },
        ]
      }
      sale: {
        Row: {
          account_id: string
          archived_at: string | null
          brand_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          carrier_code: string | null
          carrier_order_id: string | null
          channel_id: string | null
          closed_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          customer_id: string | null
          customer_name: string | null
          customer_note: string | null
          customer_phone: string | null
          delivery_address: string | null
          delivery_cost: number | null
          delivery_state: string | null
          discount_amount: number | null
          dispatch_error: string | null
          dispatch_mode: string
          eta_delivery: string | null
          eta_pickup: string | null
          expected_time: string | null
          external_brand_text: string | null
          external_channel_text: string | null
          external_location_text: string | null
          external_ref: string | null
          external_tab_ref: string | null
          id: string
          is_active: boolean
          location_id: string | null
          opened_at: string | null
          order_status: string | null
          paid: number | null
          paid_at: string | null
          payment_method: string | null
          payment_status: string | null
          platform_order_code: string | null
          pos_short_code: string | null
          public_token: string | null
          raw_products: string | null
          raw_tab: string | null
          refund_amount: number | null
          rider_name: string | null
          rider_phone: string | null
          service_type: string | null
          sold_at: string
          source: string
          status: string
          stripe_payment_intent_id: string | null
          tax: number | null
          taxable_base: number | null
          total: number
          transport_price: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          brand_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier_code?: string | null
          carrier_order_id?: string | null
          channel_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_note?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_cost?: number | null
          delivery_state?: string | null
          discount_amount?: number | null
          dispatch_error?: string | null
          dispatch_mode?: string
          eta_delivery?: string | null
          eta_pickup?: string | null
          expected_time?: string | null
          external_brand_text?: string | null
          external_channel_text?: string | null
          external_location_text?: string | null
          external_ref?: string | null
          external_tab_ref?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          opened_at?: string | null
          order_status?: string | null
          paid?: number | null
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string | null
          platform_order_code?: string | null
          pos_short_code?: string | null
          public_token?: string | null
          raw_products?: string | null
          raw_tab?: string | null
          refund_amount?: number | null
          rider_name?: string | null
          rider_phone?: string | null
          service_type?: string | null
          sold_at: string
          source?: string
          status?: string
          stripe_payment_intent_id?: string | null
          tax?: number | null
          taxable_base?: number | null
          total?: number
          transport_price?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          brand_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          carrier_code?: string | null
          carrier_order_id?: string | null
          channel_id?: string | null
          closed_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_note?: string | null
          customer_phone?: string | null
          delivery_address?: string | null
          delivery_cost?: number | null
          delivery_state?: string | null
          discount_amount?: number | null
          dispatch_error?: string | null
          dispatch_mode?: string
          eta_delivery?: string | null
          eta_pickup?: string | null
          expected_time?: string | null
          external_brand_text?: string | null
          external_channel_text?: string | null
          external_location_text?: string | null
          external_ref?: string | null
          external_tab_ref?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          opened_at?: string | null
          order_status?: string | null
          paid?: number | null
          paid_at?: string | null
          payment_method?: string | null
          payment_status?: string | null
          platform_order_code?: string | null
          pos_short_code?: string | null
          public_token?: string | null
          raw_products?: string | null
          raw_tab?: string | null
          refund_amount?: number | null
          rider_name?: string | null
          rider_phone?: string | null
          service_type?: string | null
          sold_at?: string
          source?: string
          status?: string
          stripe_payment_intent_id?: string | null
          tax?: number | null
          taxable_base?: number | null
          total?: number
          transport_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_brand_fk"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_channel_fk"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "sales_channel"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customer"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_location_fk"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_line: {
        Row: {
          account_id: string
          combo_slot_id: string | null
          computed_cost: number | null
          cost_computed_at: string | null
          created_at: string
          discount_label: string | null
          external_brand_id: string | null
          external_product_id: string | null
          external_source: string | null
          id: string
          ignore_reason: string | null
          ignored_at: string | null
          line_total: number | null
          line_type: string
          map_confidence: number | null
          map_needs_review: boolean
          map_source: string
          menu_item_id: string | null
          modifier_option_id: string | null
          original_unit_price: number | null
          parent_sale_line_id: string | null
          product_name: string
          quantity: number
          raw_text: string
          sale_id: string
          unit_price: number | null
          unmapped_reason: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          combo_slot_id?: string | null
          computed_cost?: number | null
          cost_computed_at?: string | null
          created_at?: string
          discount_label?: string | null
          external_brand_id?: string | null
          external_product_id?: string | null
          external_source?: string | null
          id?: string
          ignore_reason?: string | null
          ignored_at?: string | null
          line_total?: number | null
          line_type?: string
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string
          menu_item_id?: string | null
          modifier_option_id?: string | null
          original_unit_price?: number | null
          parent_sale_line_id?: string | null
          product_name: string
          quantity?: number
          raw_text: string
          sale_id: string
          unit_price?: number | null
          unmapped_reason?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          combo_slot_id?: string | null
          computed_cost?: number | null
          cost_computed_at?: string | null
          created_at?: string
          discount_label?: string | null
          external_brand_id?: string | null
          external_product_id?: string | null
          external_source?: string | null
          id?: string
          ignore_reason?: string | null
          ignored_at?: string | null
          line_total?: number | null
          line_type?: string
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string
          menu_item_id?: string | null
          modifier_option_id?: string | null
          original_unit_price?: number | null
          parent_sale_line_id?: string | null
          product_name?: string
          quantity?: number
          raw_text?: string
          sale_id?: string
          unit_price?: number | null
          unmapped_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_line_combo_slot_id_fkey"
            columns: ["combo_slot_id"]
            isOneToOne: false
            referencedRelation: "combo_slot"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_line_menu_item_fk"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_line_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_option"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_line_parent_sale_line_id_fkey"
            columns: ["parent_sale_line_id"]
            isOneToOne: false
            referencedRelation: "sale_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_line_sale_fk"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sale"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_channel: {
        Row: {
          account_id: string
          archived_at: string | null
          channel_type: string
          color: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          channel_type?: string
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          channel_type?: string
          color?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_channel_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          cells: Json
          coverage_overrides: Json
          created_at: string
          generated_at: string | null
          id: string
          location_id: string
          published_at: string | null
          status: string
          updated_at: string
          week_start: string
        }
        Insert: {
          cells?: Json
          coverage_overrides?: Json
          created_at?: string
          generated_at?: string | null
          id?: string
          location_id: string
          published_at?: string | null
          status?: string
          updated_at?: string
          week_start: string
        }
        Update: {
          cells?: Json
          coverage_overrides?: Json
          created_at?: string
          generated_at?: string | null
          id?: string
          location_id?: string
          published_at?: string | null
          status?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          details: Json | null
          id: string
          ip_address: string | null
          target_user_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          ip_address?: string | null
          target_user_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      shift_swap_requests: {
        Row: {
          acceptor_notes: string | null
          created_at: string
          hours_attribution: string | null
          id: string
          manager_notes: string | null
          request_notes: string | null
          requester_date: string
          requester_day_key: string
          requester_id: string
          requester_schedule_id: string
          requester_template_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          swap_type: string
          target_date: string | null
          target_day_key: string | null
          target_id: string | null
          target_schedule_id: string | null
          target_template_id: string | null
          updated_at: string
        }
        Insert: {
          acceptor_notes?: string | null
          created_at?: string
          hours_attribution?: string | null
          id?: string
          manager_notes?: string | null
          request_notes?: string | null
          requester_date: string
          requester_day_key: string
          requester_id: string
          requester_schedule_id: string
          requester_template_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          swap_type: string
          target_date?: string | null
          target_day_key?: string | null
          target_id?: string | null
          target_schedule_id?: string | null
          target_template_id?: string | null
          updated_at?: string
        }
        Update: {
          acceptor_notes?: string | null
          created_at?: string
          hours_attribution?: string | null
          id?: string
          manager_notes?: string | null
          request_notes?: string | null
          requester_date?: string
          requester_day_key?: string
          requester_id?: string
          requester_schedule_id?: string
          requester_template_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          swap_type?: string
          target_date?: string | null
          target_day_key?: string | null
          target_id?: string | null
          target_schedule_id?: string | null
          target_template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_swap_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requester_schedule_id_fkey"
            columns: ["requester_schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_requester_template_id_fkey"
            columns: ["requester_template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_target_schedule_id_fkey"
            columns: ["target_schedule_id"]
            isOneToOne: false
            referencedRelation: "schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_swap_requests_target_template_id_fkey"
            columns: ["target_template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          active: boolean
          coverage_fri: number
          coverage_mon: number
          coverage_sat: number
          coverage_sun: number
          coverage_thu: number
          coverage_tue: number
          coverage_wed: number
          created_at: string
          end_time: string
          id: string
          label: string
          location_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          coverage_fri?: number
          coverage_mon?: number
          coverage_sat?: number
          coverage_sun?: number
          coverage_thu?: number
          coverage_tue?: number
          coverage_wed?: number
          created_at?: string
          end_time: string
          id?: string
          label: string
          location_id: string
          start_time: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          coverage_fri?: number
          coverage_mon?: number
          coverage_sat?: number
          coverage_sun?: number
          coverage_thu?: number
          coverage_tue?: number
          coverage_wed?: number
          created_at?: string
          end_time?: string
          id?: string
          label?: string
          location_id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_templates_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_cuisine: {
        Row: {
          code: string
          created_at: string
          emoji: string | null
          is_active: boolean
          label: string
          position: number
        }
        Insert: {
          code: string
          created_at?: string
          emoji?: string | null
          is_active?: boolean
          label: string
          position?: number
        }
        Update: {
          code?: string
          created_at?: string
          emoji?: string | null
          is_active?: boolean
          label?: string
          position?: number
        }
        Relationships: []
      }
      shop_theme: {
        Row: {
          accent_color: string | null
          account_id: string
          brand_id: string | null
          created_at: string
          extra: Json
          font: string
          hero_url: string | null
          hub_position: number
          hub_visible: boolean
          id: string
          is_published: boolean
          mode: string
          photo_density: string
          seed_rating: number | null
          seed_rating_count: number | null
          template: string
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          account_id: string
          brand_id?: string | null
          created_at?: string
          extra?: Json
          font?: string
          hero_url?: string | null
          hub_position?: number
          hub_visible?: boolean
          id?: string
          is_published?: boolean
          mode?: string
          photo_density?: string
          seed_rating?: number | null
          seed_rating_count?: number | null
          template?: string
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          account_id?: string
          brand_id?: string | null
          created_at?: string
          extra?: Json
          font?: string
          hero_url?: string | null
          hub_position?: number
          hub_visible?: boolean
          id?: string
          is_published?: boolean
          mode?: string
          photo_density?: string
          seed_rating?: number | null
          seed_rating_count?: number | null
          template?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_theme_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_theme_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
        ]
      }
      social_account: {
        Row: {
          account_id: string
          config: Json
          created_at: string
          display_name: string | null
          handle: string
          id: string
          is_active: boolean
          link_status: string
          network: string
          updated_at: string
        }
        Insert: {
          account_id: string
          config?: Json
          created_at?: string
          display_name?: string | null
          handle: string
          id?: string
          is_active?: boolean
          link_status?: string
          network: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          config?: Json
          created_at?: string
          display_name?: string | null
          handle?: string
          id?: string
          is_active?: boolean
          link_status?: string
          network?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_account_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_config: {
        Row: {
          account_id: string
          launch_phase: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          launch_phase?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          launch_phase?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_copy: {
        Row: {
          account_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          lang: string
          pillar: string
          template: string
          text: string
          times_used: number
          weight: number
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          lang?: string
          pillar: string
          template?: string
          text: string
          times_used?: number
          weight?: number
        }
        Update: {
          account_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          lang?: string
          pillar?: string
          template?: string
          text?: string
          times_used?: number
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_copy_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      social_directive: {
        Row: {
          account_id: string
          anonymous: boolean | null
          brand_id: string | null
          caption: string | null
          consumed_at: string | null
          created_at: string
          created_by: string | null
          hashtags: string[] | null
          id: string
          kind: string
          menu_item_id: string | null
          networks: string[] | null
          photo_url: string | null
          status: string
          template: string | null
          theme: string | null
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          account_id: string
          anonymous?: boolean | null
          brand_id?: string | null
          caption?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          hashtags?: string[] | null
          id?: string
          kind: string
          menu_item_id?: string | null
          networks?: string[] | null
          photo_url?: string | null
          status?: string
          template?: string | null
          theme?: string | null
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          account_id?: string
          anonymous?: boolean | null
          brand_id?: string | null
          caption?: string | null
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          hashtags?: string[] | null
          id?: string
          kind?: string
          menu_item_id?: string | null
          networks?: string[] | null
          photo_url?: string | null
          status?: string
          template?: string | null
          theme?: string | null
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "social_directive_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_directive_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_directive_menu_item_id_fkey"
            columns: ["menu_item_id"]
            isOneToOne: false
            referencedRelation: "menu_item"
            referencedColumns: ["id"]
          },
        ]
      }
      social_post: {
        Row: {
          account_id: string
          attempts: number
          brand_id: string | null
          created_at: string
          external_ref: string | null
          id: string
          last_error: string | null
          network: string
          origin: string
          payload: Json
          published_at: string | null
          reason: string | null
          scheduled_at: string | null
          social_account_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          attempts?: number
          brand_id?: string | null
          created_at?: string
          external_ref?: string | null
          id?: string
          last_error?: string | null
          network: string
          origin?: string
          payload: Json
          published_at?: string | null
          reason?: string | null
          scheduled_at?: string | null
          social_account_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          attempts?: number
          brand_id?: string | null
          created_at?: string
          external_ref?: string | null
          id?: string
          last_error?: string | null
          network?: string
          origin?: string
          payload?: Json
          published_at?: string | null
          reason?: string | null
          scheduled_at?: string | null
          social_account_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_post_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_post_social_account_id_fkey"
            columns: ["social_account_id"]
            isOneToOne: false
            referencedRelation: "social_account"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustment: {
        Row: {
          account_id: string
          cost_eur: number | null
          counted_base: number
          created_at: string
          created_by: string | null
          created_by_name: string | null
          delta_base: number
          expiry_date: string | null
          id: string
          location_id: string
          lot_code: string | null
          notes: string | null
          occurred_at: string
          photo_url: string | null
          previous_base: number
          reason_code: string
          recipe_item_id: string
          unit_cost: number | null
          use_qty: number | null
          use_unit_factor: number | null
          use_unit_label: string | null
        }
        Insert: {
          account_id: string
          cost_eur?: number | null
          counted_base: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delta_base: number
          expiry_date?: string | null
          id?: string
          location_id: string
          lot_code?: string | null
          notes?: string | null
          occurred_at?: string
          photo_url?: string | null
          previous_base: number
          reason_code: string
          recipe_item_id: string
          unit_cost?: number | null
          use_qty?: number | null
          use_unit_factor?: number | null
          use_unit_label?: string | null
        }
        Update: {
          account_id?: string
          cost_eur?: number | null
          counted_base?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delta_base?: number
          expiry_date?: string | null
          id?: string
          location_id?: string
          lot_code?: string | null
          notes?: string | null
          occurred_at?: string
          photo_url?: string | null
          previous_base?: number
          reason_code?: string
          recipe_item_id?: string
          unit_cost?: number | null
          use_qty?: number | null
          use_unit_factor?: number | null
          use_unit_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_level: {
        Row: {
          account_id: string
          created_at: string
          id: string
          lead_time_days: number | null
          location_id: string
          min_qty: number | null
          par_qty: number | null
          recipe_item_id: string
          reorder_point: number | null
          safety_qty: number | null
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          lead_time_days?: number | null
          location_id: string
          min_qty?: number | null
          par_qty?: number | null
          recipe_item_id: string
          reorder_point?: number | null
          safety_qty?: number | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          lead_time_days?: number | null
          location_id?: string
          min_qty?: number | null
          par_qty?: number | null
          recipe_item_id?: string
          reorder_point?: number | null
          safety_qty?: number | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_level_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_level_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_level_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movement: {
        Row: {
          account_id: string
          cost_provisional: boolean
          created_at: string
          created_by: string | null
          created_by_name: string | null
          expiry_date: string | null
          id: string
          location_id: string
          lot_code: string | null
          movement_type: string
          notes: string | null
          occurred_at: string
          qty_base: number
          recipe_item_id: string
          source_id: string | null
          source_type: string
          storage_area_id: string | null
          unit_cost: number | null
        }
        Insert: {
          account_id: string
          cost_provisional?: boolean
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expiry_date?: string | null
          id?: string
          location_id: string
          lot_code?: string | null
          movement_type: string
          notes?: string | null
          occurred_at?: string
          qty_base: number
          recipe_item_id: string
          source_id?: string | null
          source_type: string
          storage_area_id?: string | null
          unit_cost?: number | null
        }
        Update: {
          account_id?: string
          cost_provisional?: boolean
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expiry_date?: string | null
          id?: string
          location_id?: string
          lot_code?: string | null
          movement_type?: string
          notes?: string | null
          occurred_at?: string
          qty_base?: number
          recipe_item_id?: string
          source_id?: string | null
          source_type?: string
          storage_area_id?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movement_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movement_storage_area_id_fkey"
            columns: ["storage_area_id"]
            isOneToOne: false
            referencedRelation: "storage_area"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer: {
        Row: {
          account_id: string
          cost_eur: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          from_location_id: string
          id: string
          notes: string | null
          occurred_at: string
          qty_base: number
          recipe_item_id: string
          to_location_id: string
          unit_cost: number | null
        }
        Insert: {
          account_id: string
          cost_eur?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          from_location_id: string
          id?: string
          notes?: string | null
          occurred_at?: string
          qty_base: number
          recipe_item_id: string
          to_location_id: string
          unit_cost?: number | null
        }
        Update: {
          account_id?: string
          cost_eur?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          from_location_id?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          qty_base?: number
          recipe_item_id?: string
          to_location_id?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_waste: {
        Row: {
          account_id: string
          cost_eur: number | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          expiry_date: string | null
          id: string
          location_id: string
          lot_code: string | null
          notes: string | null
          occurred_at: string
          photo_url: string | null
          qty_base: number
          reason_code: string
          recipe_item_id: string
          unit_cost: number | null
          use_qty: number | null
          use_unit_factor: number | null
          use_unit_label: string | null
        }
        Insert: {
          account_id: string
          cost_eur?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expiry_date?: string | null
          id?: string
          location_id: string
          lot_code?: string | null
          notes?: string | null
          occurred_at?: string
          photo_url?: string | null
          qty_base: number
          reason_code: string
          recipe_item_id: string
          unit_cost?: number | null
          use_qty?: number | null
          use_unit_factor?: number | null
          use_unit_label?: string | null
        }
        Update: {
          account_id?: string
          cost_eur?: number | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expiry_date?: string | null
          id?: string
          location_id?: string
          lot_code?: string | null
          notes?: string | null
          occurred_at?: string
          photo_url?: string | null
          qty_base?: number
          reason_code?: string
          recipe_item_id?: string
          unit_cost?: number | null
          use_qty?: number | null
          use_unit_factor?: number | null
          use_unit_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_waste_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_waste_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_waste_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_area: {
        Row: {
          account_id: string
          active: boolean
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          location_id: string
          name: string
          parent_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          account_id: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          location_id: string
          name: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          active?: boolean
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          location_id?: string
          name?: string
          parent_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "storage_area_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_area_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "storage_area"
            referencedColumns: ["id"]
          },
        ]
      }
      submodules: {
        Row: {
          code: string
          created_at: string
          description: string | null
          features: Json
          id: string
          module_id: string
          name: string
          price_eur: number
          sort_order: number | null
          status: string
          tier_level: number | null
          type: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          module_id: string
          name: string
          price_eur?: number
          sort_order?: number | null
          status?: string
          tier_level?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          module_id?: string
          name?: string
          price_eur?: number
          sort_order?: number | null
          status?: string
          tier_level?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submodules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_items: {
        Row: {
          created_at: string
          ends_at: string | null
          id: string
          quantity: number
          starts_at: string
          status: string
          submodule_id: string
          subscription_id: string
          unit_price_eur: number
        }
        Insert: {
          created_at?: string
          ends_at?: string | null
          id?: string
          quantity?: number
          starts_at?: string
          status?: string
          submodule_id: string
          subscription_id: string
          unit_price_eur?: number
        }
        Update: {
          created_at?: string
          ends_at?: string | null
          id?: string
          quantity?: number
          starts_at?: string
          status?: string
          submodule_id?: string
          subscription_id?: string
          unit_price_eur?: number
        }
        Relationships: [
          {
            foreignKeyName: "subscription_items_submodule_id_fkey"
            columns: ["submodule_id"]
            isOneToOne: false
            referencedRelation: "submodules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_items_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          account_id: string
          billing_cycle: string
          cancel_at: string | null
          canceled_at: string | null
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          plan_id: string | null
          status: string
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          billing_cycle?: string
          cancel_at?: string | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_id?: string | null
          status?: string
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          billing_cycle?: string
          cancel_at?: string | null
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_id?: string | null
          status?: string
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier: {
        Row: {
          account_id: string
          address: string | null
          archived_at: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          email: string | null
          health_registry_no: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          notify_group: string | null
          phone: string | null
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          address?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          email?: string | null
          health_registry_no?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          notify_group?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          address?: string | null
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          email?: string | null
          health_registry_no?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          notify_group?: string | null
          phone?: string | null
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_alias: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          delivered_by: string | null
          emitter_nif: string | null
          emitter_norm: string
          id: string
          supplier_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          delivered_by?: string | null
          emitter_nif?: string | null
          emitter_norm: string
          id?: string
          supplier_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          delivered_by?: string | null
          emitter_nif?: string | null
          emitter_norm?: string
          id?: string
          supplier_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_alias_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoice: {
        Row: {
          account_id: string
          ai_session_id: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          code: string | null
          corrects_invoice_id: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          doc_kind: string
          grand_total: number | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          location_id: string | null
          match_status: string
          needs_review: boolean
          notes: string | null
          raw_document_url: string | null
          source: string
          status: string
          supplier_id: string | null
          tax_base_total: number | null
          tax_total: number | null
          updated_at: string
        }
        Insert: {
          account_id: string
          ai_session_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          code?: string | null
          corrects_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          doc_kind?: string
          grand_total?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          location_id?: string | null
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          raw_document_url?: string | null
          source?: string
          status?: string
          supplier_id?: string | null
          tax_base_total?: number | null
          tax_total?: number | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          ai_session_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          code?: string | null
          corrects_invoice_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          doc_kind?: string
          grand_total?: number | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          location_id?: string | null
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          raw_document_url?: string | null
          source?: string
          status?: string
          supplier_id?: string | null
          tax_base_total?: number | null
          tax_total?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_corrects_invoice_id_fkey"
            columns: ["corrects_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "supplier"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoice_line: {
        Row: {
          created_at: string
          goods_receipt_line_id: string | null
          id: string
          line_amount: number | null
          map_needs_review: boolean
          map_source: string | null
          match_detail: Json | null
          match_result: string | null
          position: number | null
          qty: number | null
          raw_text: string | null
          recipe_item_id: string | null
          supplier_code: string | null
          supplier_invoice_id: string
          unit_price: number | null
          vat_category_id: string | null
          vat_pct: number | null
        }
        Insert: {
          created_at?: string
          goods_receipt_line_id?: string | null
          id?: string
          line_amount?: number | null
          map_needs_review?: boolean
          map_source?: string | null
          match_detail?: Json | null
          match_result?: string | null
          position?: number | null
          qty?: number | null
          raw_text?: string | null
          recipe_item_id?: string | null
          supplier_code?: string | null
          supplier_invoice_id: string
          unit_price?: number | null
          vat_category_id?: string | null
          vat_pct?: number | null
        }
        Update: {
          created_at?: string
          goods_receipt_line_id?: string | null
          id?: string
          line_amount?: number | null
          map_needs_review?: boolean
          map_source?: string | null
          match_detail?: Json | null
          match_result?: string | null
          position?: number | null
          qty?: number | null
          raw_text?: string | null
          recipe_item_id?: string | null
          supplier_code?: string | null
          supplier_invoice_id?: string
          unit_price?: number | null
          vat_category_id?: string | null
          vat_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_line_goods_receipt_line_id_fkey"
            columns: ["goods_receipt_line_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_line"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_line_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_line_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoice"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_line_vat_category_id_fkey"
            columns: ["vat_category_id"]
            isOneToOne: false
            referencedRelation: "vat_category"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoice_receipt: {
        Row: {
          goods_receipt_id: string
          supplier_invoice_id: string
        }
        Insert: {
          goods_receipt_id: string
          supplier_invoice_id: string
        }
        Update: {
          goods_receipt_id?: string
          supplier_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_receipt_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_receipt_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoice"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_settings: {
        Row: {
          account_id: string
          autoinventory_enabled: boolean
          autoinventory_per_person: number
          created_at: string
          created_by: string | null
          created_by_name: string | null
          drift_alert_pct: number
          drift_window_months: number
          expiry_alert_days: number
          id: string
          negotiated_alert_pct: number
          price_alert_pct: number
          tol_a_pct: number
          tol_b_pct: number
          tol_c_pct: number
          updated_at: string
        }
        Insert: {
          account_id: string
          autoinventory_enabled?: boolean
          autoinventory_per_person?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          drift_alert_pct?: number
          drift_window_months?: number
          expiry_alert_days?: number
          id?: string
          negotiated_alert_pct?: number
          price_alert_pct?: number
          tol_a_pct?: number
          tol_b_pct?: number
          tol_c_pct?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          autoinventory_enabled?: boolean
          autoinventory_per_person?: number
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          drift_alert_pct?: number
          drift_window_months?: number
          expiry_alert_days?: number
          id?: string
          negotiated_alert_pct?: number
          price_alert_pct?: number
          tol_a_pct?: number
          tol_b_pct?: number
          tol_c_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      tag: {
        Row: {
          account_id: string
          color: string | null
          created_at: string
          group: string | null
          icon: string | null
          id: string
          is_active: boolean
          name: string
          template_id: string | null
        }
        Insert: {
          account_id: string
          color?: string | null
          created_at?: string
          group?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          template_id?: string | null
        }
        Update: {
          account_id?: string
          color?: string | null
          created_at?: string
          group?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tag_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tag_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "tag_template"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_template: {
        Row: {
          code: string
          color: string | null
          created_at: string
          group: string | null
          icon: string | null
          id: string
          name_en: string
          name_es: string
        }
        Insert: {
          code: string
          color?: string | null
          created_at?: string
          group?: string | null
          icon?: string | null
          id?: string
          name_en: string
          name_es: string
        }
        Update: {
          code?: string
          color?: string | null
          created_at?: string
          group?: string | null
          icon?: string | null
          id?: string
          name_en?: string
          name_es?: string
        }
        Relationships: []
      }
      uber_store_map: {
        Row: {
          account_id: string
          brand_id: string
          created_at: string
          id: string
          location_id: string | null
          store_id: string
          store_name: string | null
        }
        Insert: {
          account_id: string
          brand_id: string
          created_at?: string
          id?: string
          location_id?: string | null
          store_id: string
          store_name?: string | null
        }
        Update: {
          account_id?: string
          brand_id?: string
          created_at?: string
          id?: string
          location_id?: string | null
          store_id?: string
          store_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "uber_store_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uber_store_map_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brand"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uber_store_map_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          account_id: string
          current_value: number
          period_start: string
          quota_key: string
          updated_at: string
        }
        Insert: {
          account_id: string
          current_value?: number
          period_start: string
          quota_key: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          current_value?: number
          period_start?: string
          quota_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_counters_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          account_id: string | null
          active: boolean
          created_at: string
          display_name: string | null
          employee_id: string | null
          id: string
          last_login_at: string | null
          last_password_change_at: string | null
          role: string
          suspended_at: string | null
          suspended_by: string | null
          terms_accepted_at: string | null
          updated_at: string
          user_id: string
          welcome_completed_at: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          display_name?: string | null
          employee_id?: string | null
          id?: string
          last_login_at?: string | null
          last_password_change_at?: string | null
          role?: string
          suspended_at?: string | null
          suspended_by?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
          user_id: string
          welcome_completed_at?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          display_name?: string | null
          employee_id?: string | null
          id?: string
          last_login_at?: string | null
          last_password_change_at?: string | null
          role?: string
          suspended_at?: string | null
          suspended_by?: string | null
          terms_accepted_at?: string | null
          updated_at?: string
          user_id?: string
          welcome_completed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      user_saved_view: {
        Row: {
          created_at: string
          filters: Json
          id: string
          is_pinned: boolean
          name: string
          position: number
          scope: string
          sort_by: string | null
          sort_dir: string | null
          updated_at: string
          user_id: string
          view_mode: string | null
        }
        Insert: {
          created_at?: string
          filters: Json
          id?: string
          is_pinned?: boolean
          name: string
          position?: number
          scope: string
          sort_by?: string | null
          sort_dir?: string | null
          updated_at?: string
          user_id: string
          view_mode?: string | null
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          is_pinned?: boolean
          name?: string
          position?: number
          scope?: string
          sort_by?: string | null
          sort_dir?: string | null
          updated_at?: string
          user_id?: string
          view_mode?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_saved_view_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vacation_settings: {
        Row: {
          account_id: string
          asuntos_propios_per_year: number
          created_at: string
          employee_id: string | null
          id: string
          min_lead_days: number
          min_staff_per_location: number
          request_types_disabled: string[]
          scope: string
          updated_at: string
          vacation_days_per_year: number
        }
        Insert: {
          account_id: string
          asuntos_propios_per_year?: number
          created_at?: string
          employee_id?: string | null
          id?: string
          min_lead_days?: number
          min_staff_per_location?: number
          request_types_disabled?: string[]
          scope?: string
          updated_at?: string
          vacation_days_per_year?: number
        }
        Update: {
          account_id?: string
          asuntos_propios_per_year?: number
          created_at?: string
          employee_id?: string | null
          id?: string
          min_lead_days?: number
          min_staff_per_location?: number
          request_types_disabled?: string[]
          scope?: string
          updated_at?: string
          vacation_days_per_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "vacation_settings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_settings_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      vacations: {
        Row: {
          alert_lead_time: boolean | null
          alert_min_staff: boolean | null
          created_at: string
          days: number
          employee_id: string
          end_date: string
          id: string
          notes: string | null
          paid: boolean | null
          requested_at: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          start_date: string
          status: string
          type: string
        }
        Insert: {
          alert_lead_time?: boolean | null
          alert_min_staff?: boolean | null
          created_at?: string
          days?: number
          employee_id: string
          end_date: string
          id?: string
          notes?: string | null
          paid?: boolean | null
          requested_at?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date: string
          status?: string
          type: string
        }
        Update: {
          alert_lead_time?: boolean | null
          alert_min_staff?: boolean | null
          created_at?: string
          days?: number
          employee_id?: string
          end_date?: string
          id?: string
          notes?: string | null
          paid?: boolean | null
          requested_at?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          start_date?: string
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "vacations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      vat_category: {
        Row: {
          code: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      vat_rate: {
        Row: {
          category_id: string
          created_at: string
          equivalence_surcharge: number
          id: string
          note: string | null
          rate: number
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          category_id: string
          created_at?: string
          equivalence_surcharge?: number
          id?: string
          note?: string | null
          rate: number
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          category_id?: string
          created_at?: string
          equivalence_surcharge?: number
          id?: string
          note?: string | null
          rate?: number
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vat_rate_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vat_category"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
    }
    Functions: {
      _allergens_of_recipe: {
        Args: { p_recipe_item_id: string }
        Returns: Json
      }
      _delivery_zone_account_of_location: {
        Args: { p_location_id: string }
        Returns: string
      }
      _eur_base_from_format: {
        Args: { p_format_id: string; p_price_per_format: number }
        Returns: number
      }
      _generate_daily_count_core: {
        Args: {
          p_account_id: string
          p_coverage_target?: number
          p_employee_ids?: string[]
          p_ignore_freshness?: boolean
          p_location_id: string
          p_per_person?: number
        }
        Returns: {
          already_existed: boolean
          count_id: string
          coverage_after: number
          coverage_before: number
          lines_created: number
          per_person_today: number
        }[]
      }
      _impact_cost: {
        Args: {
          p_quantity: number
          p_target_item_id: string
          p_unit_id: string
        }
        Returns: number
      }
      _modgroups_of_item: { Args: { p_menu_item_id: string }; Returns: Json }
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _qty_in_base: {
        Args: {
          p_quantity: number
          p_target_item_id: string
          p_unit_id: string
        }
        Returns: number
      }
      _require_manage_admins: { Args: never; Returns: undefined }
      _resolve_day_counters: {
        Args: { p_date: string; p_location_id: string }
        Returns: string[]
      }
      _sale_line_raw_consumption: {
        Args: { p_sale_line_id: string }
        Returns: {
          qty_base: number
          raw_item_id: string
        }[]
      }
      _shop_account_free_delivery: {
        Args: { p_account: string }
        Returns: Json
      }
      _shop_account_free_gift: { Args: { p_account: string }; Returns: Json }
      _shop_brand_best_offer: {
        Args: { p_account: string; p_brand: string }
        Returns: Json
      }
      _shop_item_bogo: {
        Args: { p_account: string; p_menu_item_id: string }
        Returns: Json
      }
      _shop_item_offer: {
        Args: { p_account: string; p_menu_item_id: string; p_price: number }
        Returns: Json
      }
      _shop_item_promo: {
        Args: { p_account: string; p_menu_item_id: string; p_price: number }
        Returns: Json
      }
      _shop_reprice_line: {
        Args: { p_account_id: string; p_line: Json }
        Returns: Json
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _user_can_manage_admins: { Args: { p_user_id: string }; Returns: boolean }
      adapt_folvy_shop_order: { Args: { p_sale_id: string }; Returns: number }
      adapt_hubrise_order: { Args: { p_sale_id: string }; Returns: number }
      adapt_lastapp_order: { Args: { p_sale_id: string }; Returns: number }
      add_ingredient_to_recipes: {
        Args: {
          p_cut?: string
          p_parents?: string[]
          p_qty: number
          p_target: string
          p_unit: string
        }
        Returns: {
          added: number
          affected_item_ids: string[]
          skipped_cycle: number
        }[]
      }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      agent_campaign_uplift: {
        Args: { p_account_id: string; p_days_back?: number }
        Returns: {
          activa: boolean
          ambito_locales: string
          arranque_desde_cero: boolean
          brand_name: string
          campaign_name: string
          channel_name: string
          coupon_id: string
          dias_campaña: number
          ped_dia_antes: number
          ped_dia_durante: number
          uplift_pct: number
        }[]
      }
      agent_dow_signal: {
        Args: { p_account_id: string }
        Returns: {
          brand_id: string
          channel_name: string
          dow: number
          pct_share: number
        }[]
      }
      agent_learning_signal: {
        Args: { p_account_id: string }
        Returns: {
          arranques: number
          brand_id: string
          channel_name: string
          n_medidas: number
          uplift_medio: number
        }[]
      }
      agent_sales_signal: {
        Args: { p_account_id: string }
        Returns: {
          avg_28d: number
          brand_id: string
          channel_name: string
          peak_daily: number
          sales_7d: number
        }[]
      }
      agent_sales_signal_v2: {
        Args: { p_account_id: string }
        Returns: {
          avg_28d: number
          brand_id: string
          channel_name: string
          location_id: string
          location_name: string
          peak_daily: number
          sales_7d: number
          target_daily: number
        }[]
      }
      appcc_mark_overdue: { Args: never; Returns: undefined }
      apply_appcc_assignment_moments: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      apply_inventory_count: {
        Args: {
          p_count_id: string
          p_partial?: boolean
          p_user_id?: string
          p_user_name?: string
        }
        Returns: {
          adjustments: number
          items_recomputed: number
        }[]
      }
      apply_invoice_costs: {
        Args: { p_invoice_id: string }
        Returns: {
          item_name: string
          new_cost: number
          new_price: number
          old_cost: number
          old_price: number
          pct: number
          recipe_item_id: string
        }[]
      }
      assign_items_to_zones: {
        Args: {
          p_account: string
          p_item_ids: string[]
          p_mode?: string
          p_primary_zone_id: string
          p_zone_ids: string[]
        }
        Returns: Json
      }
      autoclose_daily_count: {
        Args: { p_count_id: string }
        Returns: {
          applied: number
          closed: boolean
          final_status: string
          pending_anomalies: number
        }[]
      }
      autoinventory_queue: {
        Args: {
          p_account_id: string
          p_coverage_target?: number
          p_location_id: string
          p_w_risk?: number
          p_w_rotation?: number
          p_w_value?: number
          p_window_days?: number
        }
        Returns: {
          abc_rich: string
          base_unit: string
          code: string
          coverage_pct: number
          critical_reason: string
          in_scope: boolean
          must_count: boolean
          name: string
          qty_on_hand: number
          rank: number
          recipe_item_id: string
          risk_eur: number
          rotation_eur: number
          score: number
          score_risk: number
          score_rotation: number
          score_value: number
          stock_value: number
        }[]
      }
      availability_panel: {
        Args: { p_account_id: string; p_location_id?: string }
        Returns: {
          available_until: string
          brand_names: string[]
          brands: number
          location_id: string
          location_name: string
          name: string
          photo_url: string
          product_key: string
          reason: string
          recipe_item_id: string
          representative_menu_item_id: string
          set_at: string
          source_folvy: boolean
          source_last: boolean
        }[]
      }
      availability_panel_by_token: {
        Args: { p_device_token: string }
        Returns: Json
      }
      avt_incomplete_raws: {
        Args: {
          p_account: string
          p_from?: string
          p_location?: string
          p_to?: string
        }
        Returns: {
          location_id: string
          recipe_item_id: string
        }[]
      }
      avt_period: {
        Args: {
          p_account: string
          p_from: string
          p_location?: string
          p_to: string
        }
        Returns: Json
      }
      belongs_to_account: { Args: { p_account_id: string }; Returns: boolean }
      build_inventory_count: {
        Args: { p_area_ids?: string[]; p_count_id: string; p_full?: boolean }
        Returns: number
      }
      campaign_menu_tree: { Args: { p_account: string }; Returns: Json }
      campaign_performance: {
        Args: {
          p_account: string
          p_coupon: string
          p_from: string
          p_to: string
        }
        Returns: Json
      }
      campaigns_overview: {
        Args: {
          p_account: string
          p_brand: string
          p_from: string
          p_kinds: string[]
          p_to: string
        }
        Returns: Json
      }
      cancel_sale: {
        Args: { p_reason?: string; p_sale_id: string }
        Returns: undefined
      }
      check_count_variance: {
        Args: { p_counted: number; p_line_id: string }
        Returns: string
      }
      claim_next_image_job: {
        Args: never
        Returns: {
          account_id: string
          brand_anonymous: boolean
          discount_pct: number
          dish: string
          hero_url: string
          post_id: string
          template: string
        }[]
      }
      claim_pending_directive: {
        Args: { p_account_id: string }
        Returns: {
          account_id: string
          anonymous: boolean | null
          brand_id: string | null
          caption: string | null
          consumed_at: string | null
          created_at: string
          created_by: string | null
          hashtags: string[] | null
          id: string
          kind: string
          menu_item_id: string | null
          networks: string[] | null
          photo_url: string | null
          status: string
          template: string | null
          theme: string | null
          valid_from: string
          valid_until: string | null
        }
        SetofOptions: {
          from: "*"
          to: "social_directive"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_print_jobs: {
        Args: { p_device_token: string; p_limit?: number }
        Returns: Json
      }
      claim_promo_push_jobs: {
        Args: { p_limit?: number; p_platform: string; p_secret: string }
        Returns: {
          account_id: string
          action: string
          attempts: number
          brand_id: string
          coupon_id: string
          created_at: string
          external_ref: string | null
          id: string
          last_error: string | null
          location_id: string | null
          payload: Json
          platform: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "promo_push_job"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_promo_push_jobs_srv: {
        Args: { p_limit?: number; p_platform: string }
        Returns: {
          account_id: string
          action: string
          attempts: number
          brand_id: string
          coupon_id: string
          created_at: string
          external_ref: string | null
          id: string
          last_error: string | null
          location_id: string | null
          payload: Json
          platform: string
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "promo_push_job"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      classify_unmapped_product: {
        Args: {
          p_account_id: string
          p_action: string
          p_product_name: string
          p_recipe_item_id?: string
          p_unit_cost?: number
        }
        Returns: {
          candidatos: Json
          lineas_casadas: number
          marcas_creadas: number
          recipe_item_id: string
          resultado: string
        }[]
      }
      cleanup_auth_rate_limits: { Args: never; Returns: number }
      clear_account_discount: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      clear_menu_item_override: {
        Args: {
          p_channel_id: string
          p_location_id?: string
          p_menu_item_id: string
        }
        Returns: undefined
      }
      clone_brand_catalog: {
        Args: {
          p_dst_account: string
          p_dst_brand: string
          p_src_account: string
          p_src_brand: string
        }
        Returns: Json
      }
      close_inventory_count: {
        Args: { p_count_id: string }
        Returns: {
          lines_counted: number
          lines_ok: number
          lines_out: number
          lines_total: number
          lines_uncounted: number
          total_variance_value: number
        }[]
      }
      close_sale: { Args: { p_sale_id: string }; Returns: undefined }
      commit_ai_action: {
        Args: { p_action_id: string; p_edited_args?: Json }
        Returns: Json
      }
      compute_combo_cost: {
        Args: { p_combo_item_id: string }
        Returns: {
          cost: number
          detail: Json
          fc_pct: number
          is_incomplete: boolean
          margin: number
          price: number
          slots_incomplete: number
          slots_provisional: number
          slots_reliable: number
          slots_total: number
        }[]
      }
      compute_sale_line_consumption: {
        Args: { p_sale_line_id: string }
        Returns: number
      }
      compute_sale_line_cost: {
        Args: { p_sale_line_id: string }
        Returns: number
      }
      confirm_goods_receipt: {
        Args: { p_receipt_id: string }
        Returns: {
          posted_lines: number
          skipped_lines: number
        }[]
      }
      confirm_mapping: {
        Args: {
          p_action: string
          p_actor_name?: string
          p_chosen_target?: string
          p_note?: string
          p_proposal_id: string
        }
        Returns: {
          propagated_lines: number
        }[]
      }
      connector_assert_manager: {
        Args: { p_account_connector_id: string; p_user_id: string }
        Returns: string
      }
      connector_secret_clear: {
        Args: { p_account_connector_id: string; p_user_id: string }
        Returns: undefined
      }
      connector_secret_read: {
        Args: { p_account_connector_id: string }
        Returns: Json
      }
      connector_secret_save: {
        Args: {
          p_account_connector_id: string
          p_config?: Json
          p_secret_json: string
          p_user_id: string
        }
        Returns: undefined
      }
      connector_secret_status: {
        Args: { p_account_connector_id: string; p_user_id: string }
        Returns: boolean
      }
      create_account_tx: {
        Args: {
          p_account_name: string
          p_account_slug: string
          p_admin_display_name: string
          p_admin_user_id: string
          p_brand_name: string
          p_brand_slug: string
          p_created_by: string
          p_location_name: string
          p_plan_id: string
          p_status: string
          p_submodule_ids: string[]
        }
        Returns: string
      }
      create_dish_from_unmapped: {
        Args: { p_account_id: string; p_product_name: string }
        Returns: {
          out_lineas_casadas: number
          out_marcas_creadas: number
          out_recipe_item_id: string
        }[]
      }
      create_mirror_item: {
        Args: { p_account: string; p_item: string }
        Returns: Json
      }
      create_platform_admin_tx: {
        Args: {
          p_created_by: string
          p_full_name: string
          p_role: string
          p_user_id: string
        }
        Returns: string
      }
      create_recipe_version: {
        Args: {
          p_created_by_name?: string
          p_is_milestone?: boolean
          p_item_id: string
          p_label?: string
          p_note?: string
        }
        Returns: string
      }
      cron_generate_daily_counts: { Args: never; Returns: undefined }
      current_user_account_ids: { Args: never; Returns: string[] }
      current_user_can_approve_invoice: {
        Args: { p_invoice_id: string }
        Returns: boolean
      }
      current_user_has_platform_permission: {
        Args: { p_permission_flag: string }
        Returns: boolean
      }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_is_admin_of: {
        Args: { p_account_id: string }
        Returns: boolean
      }
      current_user_is_admin_or_manager_of: {
        Args: { p_account_id: string }
        Returns: boolean
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      customer_addresses: { Args: { p_token: string }; Returns: Json }
      customer_coupons: { Args: { p_token: string }; Returns: Json }
      customer_delete_address: {
        Args: { p_id: string; p_token: string }
        Returns: Json
      }
      customer_logout: { Args: { p_token: string }; Returns: Json }
      customer_orders: {
        Args: { p_limit?: number; p_token: string }
        Returns: Json
      }
      customer_reorder_payload: {
        Args: { p_sale_id: string; p_token: string }
        Returns: Json
      }
      customer_request_login: {
        Args: { p_email: string; p_slug: string }
        Returns: Json
      }
      customer_save_address: {
        Args: {
          p_address: string
          p_detail: string
          p_id: string
          p_is_default: boolean
          p_label: string
          p_lat: number
          p_lng: number
          p_token: string
        }
        Returns: Json
      }
      customer_session_me: { Args: { p_token: string }; Returns: Json }
      customer_set_consent: {
        Args: { p_consent: boolean; p_token: string }
        Returns: Json
      }
      customer_update_profile: {
        Args: { p_name: string; p_phone: string; p_token: string }
        Returns: Json
      }
      customer_verify_login: {
        Args: {
          p_code: string
          p_email: string
          p_slug: string
          p_ttl_days?: number
        }
        Returns: Json
      }
      default_permissions_for_role: { Args: { p_role: string }; Returns: Json }
      delete_account_tx: {
        Args: { p_account_id: string; p_admin_user_id: string }
        Returns: undefined
      }
      delete_campaign: {
        Args: { p_account: string; p_id: string }
        Returns: Json
      }
      delete_delivery_zone: { Args: { p_id: string }; Returns: undefined }
      device_location_by_token: {
        Args: { p_device_token: string }
        Returns: Json
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
      dropgeometrytable:
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
      duplicate_recipe_item: {
        Args: { p_new_name?: string; p_source_id: string }
        Returns: string
      }
      enablelongtransactions: { Args: never; Returns: string }
      enqueue_print_job: {
        Args: {
          p_account_id: string
          p_doc_type: string
          p_location_id: string
          p_payload: Json
          p_sale_id: string
          p_source?: string
        }
        Returns: number
      }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      evaluate_campaign_rules: { Args: never; Returns: number }
      expire_unpaid_shop_orders: {
        Args: { p_minutes?: number }
        Returns: number
      }
      explode_recipe_to_raws: {
        Args: { p_item_id: string; p_multiplier: number }
        Returns: {
          qty_base: number
          raw_item_id: string
        }[]
      }
      fail_image_job: {
        Args: { p_err: string; p_post_id: string }
        Returns: undefined
      }
      fill_line_discounts: { Args: { p_sale_id: string }; Returns: number }
      finish_image_job: {
        Args: { p_post_id: string; p_public_url: string }
        Returns: undefined
      }
      fiscal_for_print: {
        Args: { p_device_token: string; p_sale_id: string }
        Returns: Json
      }
      folvy_code_prefix: { Args: { p_type: string }; Returns: string }
      folvy_map_measure: {
        Args: never
        Returns: {
          filas: number
          measure_table: string
        }[]
      }
      force_close_long_impersonations: { Args: never; Returns: number }
      format_price_per_base: {
        Args: { p_format_id: string; p_supplier_id: string }
        Returns: number
      }
      generate_daily_count: {
        Args: {
          p_account_id: string
          p_coverage_target?: number
          p_employee_ids?: string[]
          p_ignore_freshness?: boolean
          p_location_id: string
          p_per_person?: number
        }
        Returns: {
          already_existed: boolean
          count_id: string
          coverage_after: number
          coverage_before: number
          lines_created: number
          per_person_today: number
        }[]
      }
      generate_sale_consumption: {
        Args: { p_sale_id: string }
        Returns: number
      }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_account_discount: { Args: { p_account_id: string }; Returns: Json }
      get_auth_user_id_by_email: {
        Args: { p_created_by: string; p_email: string }
        Returns: string
      }
      get_effective_permissions: {
        Args: { p_account_id: string }
        Returns: Json
      }
      get_launch_phase: { Args: { p_account_id: string }; Returns: string }
      get_promo_push_job_status: {
        Args: { p_job_id: string; p_secret: string }
        Returns: string
      }
      gettransactionid: { Args: never; Returns: unknown }
      has_permission: {
        Args: { p_account_id: string; p_permission_key: string }
        Returns: boolean
      }
      hours_staffing_gaps: {
        Args: { p_location_id: string }
        Returns: {
          gap_end: string
          gap_start: string
          weekday: number
        }[]
      }
      hubrise_money: { Args: { p: string }; Returns: number }
      invoice_required_role: { Args: { p_invoice_id: string }; Returns: string }
      is_brand_open: {
        Args: { p_brand_id: string; p_location_id: string; p_ts?: string }
        Returns: boolean
      }
      item_movements: {
        Args: {
          p_account: string
          p_from?: string
          p_limit?: number
          p_location?: string
          p_recipe_item: string
          p_to?: string
        }
        Returns: Json
      }
      item_stock_by_location: {
        Args: { p_account: string; p_recipe_item: string }
        Returns: Json
      }
      kds_authorize: {
        Args: { p_location_id: string; p_token: string }
        Returns: string
      }
      kds_board: {
        Args: { p_device_token?: string; p_location_id?: string }
        Returns: Json
      }
      kds_bump: {
        Args: { p_sale_id: string; p_station_id: string; p_token?: string }
        Returns: undefined
      }
      kds_mark_line: {
        Args: { p_sale_line_id: string; p_token?: string }
        Returns: boolean
      }
      kds_recipe: {
        Args: {
          p_location_id?: string
          p_menu_item_id: string
          p_qty?: number
          p_token?: string
        }
        Returns: Json
      }
      kds_resolve_device: {
        Args: { p_token: string }
        Returns: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          last_seen_at: string | null
          location_id: string
          station_ids: string[] | null
          token: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "kds_device"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      kds_set_default_station: {
        Args: { p_location_id: string; p_station_id: string }
        Returns: undefined
      }
      kds_unbump: {
        Args: { p_sale_id: string; p_station_id: string; p_token?: string }
        Returns: undefined
      }
      kitchen_ancestors_of: {
        Args: { p_item_id: string }
        Returns: {
          ancestor_id: string
          depth: number
        }[]
      }
      kitchen_delete_or_archive_item: {
        Args: { p_item_id: string }
        Returns: Json
      }
      kitchen_dish_state_for_ai: {
        Args: { p_recipe_item_id: string }
        Returns: Json
      }
      kitchen_dishes_incomplete: {
        Args: { p_account_id: string }
        Returns: {
          dish_id: string
          has_incomplete: boolean
        }[]
      }
      kitchen_item_delete_check: { Args: { p_item_id: string }; Returns: Json }
      kitchen_raw_usage_counts: {
        Args: { p_account_id: string }
        Returns: {
          child_item_id: string
          usage_count: number
        }[]
      }
      kitchen_recipe_breakdown: {
        Args: { p_item_id: string }
        Returns: {
          child_item_id: string
          child_name: string
          child_needs_review: boolean
          child_type: string
          line_cost: number
          line_id: string
          needs_review: boolean
          quantity: number
          quantity_net: number
          unit_abbr: string
        }[]
      }
      kitchen_recipe_cost_by_location: {
        Args: { p_item_id: string; p_location_id: string }
        Returns: {
          child_item_id: string
          child_name: string
          cost_source: string
          line_cost: number
          line_id: string
          needs_review: boolean
          quantity: number
          unit_abbr: string
        }[]
      }
      kitchen_recompute_item: { Args: { p_item_id: string }; Returns: number }
      kitchen_recompute_raw_cost: {
        Args: { p_item_id: string }
        Returns: number
      }
      kitchen_recompute_users_of: {
        Args: { p_item_id: string }
        Returns: number
      }
      kitchen_similar_dishes_for_ai: {
        Args: { p_n?: number; p_recipe_item_id: string }
        Returns: Json
      }
      learn_from_receipt: { Args: { p_receipt_id: string }; Returns: number }
      learn_supplier_alias: { Args: { p_receipt_id: string }; Returns: boolean }
      list_campaigns: { Args: { p_account: string }; Returns: Json }
      list_costless_sold_products: {
        Args: { p_account_id: string; p_from?: string; p_to?: string }
        Returns: {
          has_recipe_lines: boolean
          importe: number
          is_purchasable: boolean
          product_name: string
          recipe_item_id: string
          recipe_type: string
          ventas: number
        }[]
      }
      list_delivery_zones: {
        Args: { p_location_id: string }
        Returns: {
          area_geojson: Json
          center_lat: number
          center_lng: number
          delivery_fee: number
          eta_min: number
          id: string
          is_active: boolean
          method: string
          min_order: number
          name: string
          postal_codes: string[]
          priority: number
          radius_m: number
        }[]
      }
      list_pending_external_brands: {
        Args: { p_account_id: string }
        Returns: {
          external_brand_id: string
          external_location_id: string
          folvy_location_id: string
          folvy_location_name: string
          pista_catalogo: string
          pista_productos: string
          source: string
          ventas: number
        }[]
      }
      list_platform_admins: {
        Args: never
        Returns: {
          active: boolean
          can_archive_accounts: boolean
          can_create_accounts: boolean
          can_delete_accounts: boolean
          can_edit_seed_data: boolean
          can_impersonate: boolean
          can_manage_admins: boolean
          can_reset_2fa_of_others: boolean
          can_send_global_notifications: boolean
          can_suspend_accounts: boolean
          can_view_audit_log: boolean
          can_view_system_health: boolean
          created_at: string
          email: string
          full_name: string
          id: string
          last_login_at: string
          role: string
          user_id: string
        }[]
      }
      list_platform_events: {
        Args: {
          p_account_id?: string
          p_admin_id?: string
          p_event_type?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_to?: string
        }
        Returns: {
          account_name: string
          admin_email: string
          admin_id: string
          admin_name: string
          created_at: string
          details: Json
          event_type: string
          id: string
          ip_address: string
          target_account_id: string
          target_user_id: string
          total_count: number
          user_agent: string
        }[]
      }
      list_pricing: { Args: never; Returns: Json }
      list_stock_movements: {
        Args: {
          p_account: string
          p_from?: string
          p_limit?: number
          p_location: string
          p_offset?: number
          p_to?: string
          p_types?: string[]
        }
        Returns: Json
      }
      location_economics: {
        Args: { p_from?: string; p_location_id: string; p_to?: string }
        Returns: {
          employee_count: number
          food_cost: number
          food_cost_coverage_pct: number
          food_cost_pct: number
          is_estimate: boolean
          labor_cost: number
          labor_cost_pct: number
          prime_cost: number
          prime_cost_pct: number
          revenue: number
        }[]
      }
      location_labor_cost: {
        Args: { p_from?: string; p_location_id: string; p_to?: string }
        Returns: {
          days_in_period: number
          employee_count: number
          is_estimate: boolean
          labor_cost: number
        }[]
      }
      log_platform_event: {
        Args: {
          p_details?: Json
          p_event_type: string
          p_target_account_id?: string
          p_target_user_id?: string
        }
        Returns: string
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      mark_ctb_notification_sent: {
        Args: { p_queue_id: string }
        Returns: undefined
      }
      mark_shop_order_failed: {
        Args: { p_payment_intent_id: string }
        Returns: Json
      }
      mark_shop_order_paid: {
        Args: { p_amount_cents?: number; p_payment_intent_id: string }
        Returns: Json
      }
      mark_social_post_published: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      materialize_recipe_session: {
        Args: { p_decisions?: Json; p_session_id: string }
        Returns: {
          dish_name: string
          lines_created: number
          lines_skipped: number
          new_articles_created: number
          result_recipe_id: string
          was_created: boolean
        }[]
      }
      menu_item_channel_economics: {
        Args: { p_menu_item_id: string; p_overrides?: Json }
        Returns: {
          channel_id: string
          channel_name: string
          channel_type: string
          commission_amount: number
          commission_base: string
          commission_fixed: number
          commission_pct: number
          contribution_margin: number
          contribution_margin_pct: number
          cost: number
          cost_available: boolean
          food_cost: number
          food_cost_pct: number
          food_cost_status: string
          is_available: boolean
          net_margin: number
          net_margin_pct: number
          order_costs_per_item: number
          own_courier_cost: number
          own_customer_fee: number
          packaging_cost: number
          plate_cost_pct: number
          plate_cost_status: string
          price: number
          price_source: string
          price_with_vat: number
          service_type: string
          target_food_cost_pct: number
          target_plate_cost_pct: number
          vat_rate: number
        }[]
      }
      menu_item_economics: {
        Args: { p_brand_id: string; p_service_type?: string }
        Returns: {
          channel_id: string
          channel_name: string
          commission_amount: number
          commission_fixed: number
          commission_pct: number
          consumption_reimb: number
          contribution_margin: number
          cost: number
          cost_available: boolean
          delivery_fee: number
          flow_type: string
          food_cost: number
          food_cost_pct: number
          food_cost_status: string
          menu_item_id: string
          menu_item_name: string
          net_margin: number
          net_margin_pct: number
          packaging_cost: number
          plate_cost_pct: number
          plate_cost_status: string
          price: number
          price_with_vat: number
          recipe_item_id: string
          revenue_share_amount: number
          revenue_share_pct: number
          target_food_cost_pct: number
          target_plate_cost_pct: number
          vat_rate: number
        }[]
      }
      menu_item_units_sold: {
        Args: { p_brand_id: string; p_from?: string; p_to?: string }
        Returns: {
          first_sold_at: string
          last_sold_at: string
          lines_count: number
          menu_item_id: string
          revenue: number
          units_sold: number
        }[]
      }
      migrate_brands_and_map: {
        Args: { p_dest: string; p_run?: boolean; p_source: string }
        Returns: {
          n: number
          paso: string
        }[]
      }
      migrate_kitchen_core: {
        Args: { p_dest: string; p_run?: boolean; p_source: string }
        Returns: {
          n: number
          paso: string
        }[]
      }
      migrate_locations_and_staff: {
        Args: { p_dest: string; p_run?: boolean; p_source: string }
        Returns: {
          n: number
          paso: string
        }[]
      }
      migrate_supplier_articles: {
        Args: { p_mode?: string; p_source: string; p_target: string }
        Returns: {
          affected_item_ids: string[]
          merged: number
          moved: number
        }[]
      }
      mirror_state: {
        Args: { p_account: string; p_item: string }
        Returns: Json
      }
      move_items_to_zone: {
        Args: {
          p_account: string
          p_from_zone_id: string
          p_item_ids: string[]
          p_to_zone_id: string
        }
        Returns: Json
      }
      next_folvy_code: {
        Args: { p_account_id: string; p_type: string }
        Returns: string
      }
      next_goods_receipt_code: {
        Args: { p_account_id: string }
        Returns: string
      }
      next_inventory_count_code: {
        Args: { p_account_id: string }
        Returns: string
      }
      next_purchase_order_code: {
        Args: { p_account_id: string }
        Returns: string
      }
      next_supplier_invoice_code: {
        Args: { p_account_id: string }
        Returns: string
      }
      normalize_ingredient_name: { Args: { p_text: string }; Returns: string }
      offers_goal_report: {
        Args: { p_account_id: string }
        Returns: {
          brand_id: string
          brand_name: string
          channel_name: string
          location_id: string
          location_name: string
          pct_objetivo: number
          ped_dia_7d: number
          ped_dia_prev7: number
          target_daily: number
          tendencia_pct: number
        }[]
      }
      omnibus_ref_price: { Args: { p_menu_item_id: string }; Returns: number }
      onboard_account: {
        Args: {
          p_account_id: string
          p_admin_user_id?: string
          p_plan_code?: string
          p_status?: string
        }
        Returns: Json
      }
      order_for_print: {
        Args: { p_device_token: string; p_sale_id: string }
        Returns: Json
      }
      orders_feed: { Args: { p_location_id: string }; Returns: Json }
      orders_feed_by_token: { Args: { p_device_token: string }; Returns: Json }
      pick_social_copy: {
        Args: { p_account_id?: string; p_pillar: string }
        Returns: string
      }
      place_shop_order: {
        Args: { p_dry_run?: boolean; p_payload: Json; p_slug: string }
        Returns: Json
      }
      platform_metrics: { Args: never; Returns: Json }
      populate_geometry_columns:
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
        | { Args: { use_typmod?: boolean }; Returns: string }
      post_pending_receipt: {
        Args: { p_receipt_id: string }
        Returns: {
          pending_items: Json
          posted: number
          still_pending: number
        }[]
      }
      post_pending_receipt_line: {
        Args: { p_line_id: string }
        Returns: boolean
      }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      preview_add_ingredient: {
        Args: {
          p_cut?: string
          p_qty: number
          p_target: string
          p_unit: string
        }
        Returns: {
          already_has: boolean
          coste_actual: number
          coste_nuevo: number
          is_cycle: boolean
          parent_item_id: string
          parent_name: string
        }[]
      }
      preview_bogo_mirror_price: {
        Args: {
          p_account_id: string
          p_brand_id: string
          p_channel_id: string
          p_margin_floor_pct?: number
          p_menu_item_ids?: string[]
        }
        Returns: {
          ahorro_cliente_pct: number
          brand_name: string
          food_cost: number
          item_name: string
          margen_2x1: number
          margen_pct_2x1: number
          menu_item_id: string
          precio_min_suelo: number
          precio_paridad: number
          precio_sugerido: number
          pvp_cliente: number
          status: string
          units_30d: number
        }[]
      }
      preview_coupon_impact: {
        Args: { p_account: string; p_discount_type: string; p_value: number }
        Returns: {
          avg_margin_after_pct: number
          avg_margin_now_pct: number
          avg_order: number
          costed_items: number
          effective_pct: number
          floor_pct: number
          items_below_floor_after: number
          min_margin_after_pct: number
          sellable_items: number
          uncosted_items: number
        }[]
      }
      preview_modifier_impact_cost: {
        Args: {
          p_impact_type: string
          p_quantity: number
          p_recipe_item_id: string
          p_target_recipe_item_id: string
          p_unit_id: string
        }
        Returns: {
          base_cost: number
          delta: number
          total_cost: number
        }[]
      }
      preview_platform_promo_impact: {
        Args: {
          p_account_id: string
          p_brand_ids: string[]
          p_channel_id: string
          p_discount_type: string
          p_discount_value: number
          p_margin_floor_pct?: number
          p_menu_item_ids?: string[]
        }
        Returns: {
          brand_name: string
          comision_antes: number
          comision_despues: number
          descuento: number
          food_cost: number
          item_name: string
          margen_antes: number
          margen_despues: number
          margen_pct_antes: number
          margen_pct_despues: number
          menu_item_id: string
          pvp_cliente: number
          pvp_promo_cliente: number
          status: string
          units_30d: number
        }[]
      }
      preview_remove_ingredient: {
        Args: { p_source: string }
        Returns: {
          coste_actual: number
          coste_nuevo: number
          first_qty: number
          first_unit_id: string
          n_lines: number
          parent_item_id: string
          parent_name: string
        }[]
      }
      preview_scope_by_token: {
        Args: { p_device_token: string; p_menu_item_id: string }
        Returns: Json
      }
      preview_substitute_ingredient: {
        Args: { p_source: string; p_target: string }
        Returns: {
          coste_actual: number
          coste_nuevo: number
          estado: string
          first_qty: number
          first_unit_id: string
          n_lines: number
          parent_item_id: string
          parent_name: string
        }[]
      }
      preview_supplier_migration: {
        Args: { p_source: string; p_target: string }
        Returns: {
          colisiones: number
          migran_limpio: number
          origen_total: number
        }[]
      }
      price_drift_for: {
        Args: {
          p_account_id: string
          p_item_id: string
          p_window_months?: number
        }
        Returns: {
          actual_eur_base: number
          median_eur_base: number
          n_recepciones: number
          pct_vs_median: number
        }[]
      }
      propose_ai_action: {
        Args: {
          p_account_id: string
          p_agent: string
          p_args: Json
          p_effect_preview?: Json
          p_risk?: string
          p_rollback_hint?: Json
          p_session_id?: string
          p_summary: string
          p_target_id?: string
          p_target_table?: string
          p_tool_name: string
        }
        Returns: string
      }
      propose_vat_category: {
        Args: { p_recipe_item_id: string }
        Returns: string
      }
      recast_lastapp_sales: {
        Args: { p_account_id: string }
        Returns: {
          lineas_ambiguous: number
          lineas_casadas: number
          lineas_no_brand: number
          lineas_no_menu_item: number
          lineas_no_recipe: number
          lineas_respetadas: number
          lineas_total: number
          ventas_procesadas: number
        }[]
      }
      recipe_item_has_unmeasurable_line: {
        Args: { p_item_id: string }
        Returns: boolean
      }
      recipe_item_unmeasurable_raws: {
        Args: { p_item_id: string }
        Returns: {
          raw_item_id: string
        }[]
      }
      recompute_location_stock: {
        Args: { p_item_id: string; p_location_id: string }
        Returns: undefined
      }
      recompute_location_stock_core: {
        Args: { p_item_id: string; p_location_id: string }
        Returns: undefined
      }
      recompute_purchase_order_status: {
        Args: { p_order_id: string }
        Returns: string
      }
      recompute_sales_consumption: {
        Args: { p_account_id: string; p_from?: string; p_to?: string }
        Returns: {
          lines_processed: number
          movements_written: number
        }[]
      }
      regenerate_social_copy: { Args: { p_post_id: string }; Returns: string }
      register_adjustment: {
        Args: {
          p_account_id: string
          p_counted_base: number
          p_expiry_date?: string
          p_location_id: string
          p_lot_code?: string
          p_notes?: string
          p_photo_url?: string
          p_reason_code: string
          p_recipe_item_id: string
          p_use_qty?: number
          p_use_unit_factor?: number
          p_use_unit_label?: string
          p_user_id?: string
          p_user_name?: string
        }
        Returns: {
          adjustment_id: string
          cost_eur: number
          delta_base: number
        }[]
      }
      register_shop_consent: {
        Args: {
          p_consent: boolean
          p_email: string
          p_name: string
          p_phone: string
          p_slug: string
          p_terms_version?: string
        }
        Returns: Json
      }
      register_transfer: {
        Args: {
          p_account_id: string
          p_from_location: string
          p_notes?: string
          p_qty_base: number
          p_recipe_item_id: string
          p_to_location: string
          p_user_id?: string
          p_user_name?: string
        }
        Returns: {
          cost_eur: number
          transfer_id: string
        }[]
      }
      register_waste: {
        Args: {
          p_account_id: string
          p_expiry_date?: string
          p_location_id: string
          p_lot_code?: string
          p_notes?: string
          p_photo_url?: string
          p_qty_base: number
          p_reason_code: string
          p_recipe_item_id: string
          p_use_qty?: number
          p_use_unit_factor?: number
          p_use_unit_label?: string
          p_user_id?: string
          p_user_name?: string
        }
        Returns: {
          cost_eur: number
          waste_id: string
        }[]
      }
      remove_ingredient_from_recipes: {
        Args: { p_parents: string[]; p_source: string }
        Returns: {
          affected_item_ids: string[]
          removed: number
        }[]
      }
      report_print_job: {
        Args: {
          p_device_token: string
          p_error?: string
          p_job_id: string
          p_ok: boolean
        }
        Returns: undefined
      }
      report_promo_push_job: {
        Args: {
          p_error?: string
          p_external_ref?: string
          p_job_id: string
          p_ok: boolean
          p_secret: string
        }
        Returns: undefined
      }
      reprocess_sale: { Args: { p_sale_id: string }; Returns: number }
      request_social_generation: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      requeue_social_image: { Args: { p_post_id: string }; Returns: undefined }
      resolve_delivery_zone: {
        Args: {
          p_account_id: string
          p_lat: number
          p_lng: number
          p_postal?: string
        }
        Returns: {
          delivery_fee: number
          eta_min: number
          location_id: string
          method: string
          min_order: number
          zone_id: string
          zone_name: string
        }[]
      }
      resolve_mapping_proposals: {
        Args: {
          p_fuzzy_min?: number
          p_session_id: string
          p_target_types?: string[]
        }
        Returns: {
          auto_confirmed: number
          needs_review: number
          no_candidate: number
          resolved: number
        }[]
      }
      resolve_sale_brand_from_map: {
        Args: { p_sale_id: string }
        Returns: undefined
      }
      resolve_unmapped_sales: {
        Args: {
          p_account_id: string
          p_action: string
          p_brand_id?: string
          p_product_name: string
          p_reason?: string
        }
        Returns: {
          brand_id: string
          lineas_afectadas: number
          menu_item_id: string
          recipe_item_id: string
          resultado: string
        }[]
      }
      restore_recipe_version: {
        Args: { p_created_by_name?: string; p_version_id: string }
        Returns: string
      }
      revert_sale_consumption: { Args: { p_sale_id: string }; Returns: number }
      run_invoice_match: {
        Args: { p_invoice_id: string }
        Returns: {
          lines_diff_price: number
          lines_diff_qty: number
          lines_not_received: number
          lines_ok: number
          lines_total: number
          lines_unmatched: number
          lines_vat_bad: number
          match_status: string
        }[]
      }
      run_mapping:
        | {
            Args: {
              p_account_id: string
              p_code?: string
              p_fuzzy_min?: number
              p_limit?: number
              p_text: string
            }
            Returns: {
              confidence: number
              folvy_code: string
              match_type: string
              name: string
              recipe_item_id: string
              semaphore: string
            }[]
          }
        | {
            Args: {
              p_account_id: string
              p_code?: string
              p_fuzzy_min?: number
              p_limit?: number
              p_target_types?: string[]
              p_text: string
            }
            Returns: {
              confidence: number
              folvy_code: string
              match_type: string
              name: string
              recipe_item_id: string
              semaphore: string
            }[]
          }
      safe_jsonb: { Args: { p_text: string }; Returns: Json }
      sales_dashboard: {
        Args: {
          p_account_id: string
          p_brand_id?: string
          p_channel?: string
          p_from?: string
          p_location_id?: string
          p_ownership?: string
          p_to?: string
        }
        Returns: Json
      }
      sales_mapping_reliability: {
        Args: { p_account_id: string; p_from?: string; p_to?: string }
        Returns: {
          casado_sin_coste_eur: number
          casado_sin_coste_lineas: number
          ciego_calculable_eur: number
          ciego_calculable_lineas: number
          ciego_desconocido_eur: number
          ciego_desconocido_lineas: number
          ciego_otros_eur: number
          ciego_otros_lineas: number
          cost_coverage_pct: number
          lineas_casadas: number
          lineas_total: number
          reliability_pct: number
          revenue_casado: number
          revenue_sin_casar: number
          revenue_total: number
          status: string
          threshold_pct: number
        }[]
      }
      save_campaign: {
        Args: {
          p_account: string
          p_budget_max: number
          p_code: string
          p_discount_type: string
          p_ends_at: string
          p_id: string
          p_kind: string
          p_max_per_customer: number
          p_max_redemptions: number
          p_min_subtotal: number
          p_name: string
          p_scope: Json
          p_starts_at: string
          p_time_from: string
          p_time_to: string
          p_value: number
          p_weekdays: number[]
        }
        Returns: Json
      }
      save_frequency_reward: {
        Args: {
          p_account: string
          p_active: boolean
          p_discount_type: string
          p_threshold: number
          p_value: number
        }
        Returns: Json
      }
      save_welcome_offer: {
        Args: {
          p_account: string
          p_active: boolean
          p_discount_type: string
          p_floor_pct: number
          p_value: number
        }
        Returns: Json
      }
      search_products_by_token: {
        Args: { p_device_token: string; p_query: string }
        Returns: Json
      }
      seed_appcc_for_account: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      seed_catalog_canonical: {
        Args: { p_account_id: string }
        Returns: {
          base_ya_existentes: number
          overrides_creados: number
          productos_base_creados: number
          saltados_sin_marca: number
        }[]
      }
      seed_ingredient_families_for_account: {
        Args: { p_account_id: string }
        Returns: number
      }
      seed_vacation_settings_for_account: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      set_account_discount: {
        Args: {
          p_account_id: string
          p_discount_type: string
          p_note?: string
          p_valid_until?: string
          p_value: number
        }
        Returns: undefined
      }
      set_account_shop_logo: {
        Args: { p_account_id: string; p_url: string }
        Returns: undefined
      }
      set_account_shop_text: {
        Args: { p_account_id: string; p_subtitle: string; p_tagline: string }
        Returns: undefined
      }
      set_launch_phase: {
        Args: { p_account_id: string; p_phase: string }
        Returns: undefined
      }
      set_menu_item_override: {
        Args: {
          p_channel_id: string
          p_is_available?: boolean
          p_location_id?: string
          p_menu_item_id: string
          p_price?: number
        }
        Returns: undefined
      }
      set_order_status: {
        Args: { p_new_status: string; p_sale_id: string }
        Returns: string
      }
      set_order_status_by_token: {
        Args: {
          p_device_token: string
          p_new_status: string
          p_sale_id: string
        }
        Returns: string
      }
      set_plan_pricing: {
        Args: {
          p_base_price_eur: number
          p_max_locations: number
          p_per_location_price: number
          p_plan_id: string
        }
        Returns: undefined
      }
      set_platform_admin_active: {
        Args: { p_active: boolean; p_admin_id: string }
        Returns: undefined
      }
      set_platform_admin_permissions: {
        Args: { p_admin_id: string; p_permissions: Json }
        Returns: undefined
      }
      set_platform_admin_role: {
        Args: { p_admin_id: string; p_role: string }
        Returns: undefined
      }
      set_product_availability: {
        Args: {
          p_available_until?: string
          p_is_available: boolean
          p_location_id?: string
          p_menu_item_id: string
          p_reason?: string
        }
        Returns: Json
      }
      set_product_availability_by_token: {
        Args: {
          p_available_until?: string
          p_device_token: string
          p_is_available: boolean
          p_menu_item_id: string
          p_reason?: string
        }
        Returns: Json
      }
      set_social_post_status: {
        Args: { p_post_id: string; p_status: string }
        Returns: undefined
      }
      set_stock_level: {
        Args: {
          p_account: string
          p_location: string
          p_min?: number
          p_par?: number
          p_recipe_item: string
          p_user_id?: string
          p_user_name?: string
        }
        Returns: undefined
      }
      set_submodule_price: {
        Args: { p_price_eur: number; p_submodule_id: string }
        Returns: undefined
      }
      shop_brand_menu_by_slug: {
        Args: { p_brand_id: string; p_slug: string }
        Returns: Json
      }
      shop_check_delivery: {
        Args: {
          p_lat: number
          p_lng: number
          p_location_id: string
          p_slug: string
        }
        Returns: Json
      }
      shop_delivery_slots: {
        Args: {
          p_eta_min?: number
          p_location_id: string
          p_slug: string
          p_step_min?: number
        }
        Returns: Json
      }
      shop_home_overview: {
        Args: {
          p_account: string
          p_brand_ids: string[]
          p_from: string
          p_kinds: string[]
          p_location_ids: string[]
          p_to: string
        }
        Returns: Json
      }
      shop_hub_by_slug: { Args: { p_slug: string }; Returns: Json }
      shop_item_config: {
        Args: { p_menu_item_id: string; p_slug: string }
        Returns: Json
      }
      shop_locations_by_slug: { Args: { p_slug: string }; Returns: Json }
      shop_order_status: { Args: { p_token: string }; Returns: Json }
      shop_payment_config: { Args: { p_slug: string }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      social_secret_read: { Args: { p_name: string }; Returns: string }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
      st_askml:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geog: unknown }; Returns: number }
        | { Args: { geom: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      stock_levels_overview: {
        Args: {
          p_account: string
          p_location: string
          p_only_with_level?: boolean
        }
        Returns: Json
      }
      storage_coverage: {
        Args: { p_account: string; p_location: string }
        Returns: Json
      }
      storage_orphans: {
        Args: {
          p_account: string
          p_family?: string
          p_limit?: number
          p_location: string
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      storage_zone_items: {
        Args: {
          p_account: string
          p_area: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: Json
      }
      substitute_ingredient_in_recipes: {
        Args: { p_parents: string[]; p_source: string; p_target: string }
        Returns: {
          affected_item_ids: string[]
          flagged: number
          merged: number
          replaced: number
          skipped_cycle: number
        }[]
      }
      suggest_purchase_qty: {
        Args: {
          p_account: string
          p_consumo_days?: number
          p_hist_days?: number
          p_horizon_days?: number
          p_location: string
          p_supplier: string
        }
        Returns: {
          confidence: string
          format_qty_base: number
          needed_base: number
          recipe_item_id: string
          source: string
          suggested_qty: number
        }[]
      }
      supplier_format_prices: {
        Args: { p_account_id: string; p_supplier_id: string }
        Returns: {
          eur_per_base: number
          format_id: string
        }[]
      }
      swap_mirror: {
        Args: { p_account: string; p_item: string; p_use_mirror: boolean }
        Returns: Json
      }
      toggle_campaign: {
        Args: { p_account: string; p_active: boolean; p_id: string }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
      unassign_items_from_zones: {
        Args: {
          p_account: string
          p_item_ids?: string[]
          p_location: string
          p_zone_ids?: string[]
        }
        Returns: Json
      }
      unignore_unmapped_sales: {
        Args: {
          p_account_id: string
          p_brand_id?: string
          p_product_name: string
        }
        Returns: {
          lineas_afectadas: number
          resultado: string
        }[]
      }
      unlockrows: { Args: { "": string }; Returns: number }
      update_social_post_content: {
        Args: { p_copy: string; p_hashtags: string[]; p_post_id: string }
        Returns: undefined
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      upsert_delivery_zone_polygon: {
        Args: {
          p_delivery_fee: number
          p_eta_min?: number
          p_geojson: Json
          p_id: string
          p_location_id: string
          p_min_order?: number
          p_name: string
          p_priority?: number
        }
        Returns: string
      }
      upsert_delivery_zone_postal: {
        Args: {
          p_delivery_fee: number
          p_eta_min?: number
          p_id: string
          p_location_id: string
          p_min_order?: number
          p_name: string
          p_postal_codes: string[]
          p_priority?: number
        }
        Returns: string
      }
      upsert_delivery_zone_radius: {
        Args: {
          p_delivery_fee: number
          p_eta_min?: number
          p_id: string
          p_lat: number
          p_lng: number
          p_location_id: string
          p_min_order?: number
          p_name: string
          p_priority?: number
          p_radius_m: number
        }
        Returns: string
      }
      vat_rate_for: {
        Args: { p_category_id: string; p_date: string }
        Returns: {
          equivalence_surcharge: number
          rate: number
        }[]
      }
      void_goods_receipt: { Args: { p_receipt_id: string }; Returns: number }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
