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
          metadata: Json | null
          name: string
          past_due_at: string | null
          slug: string
          status: string
          stripe_customer_id: string | null
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
          metadata?: Json | null
          name: string
          past_due_at?: string | null
          slug: string
          status?: string
          stripe_customer_id?: string | null
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
          metadata?: Json | null
          name?: string
          past_due_at?: string | null
          slug?: string
          status?: string
          stripe_customer_id?: string | null
          suspended_at?: string | null
          suspended_by?: string | null
          suspension_reason?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
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
          color: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          id: string
          is_active: boolean
          logo_url: string | null
          name: string
          notes: string | null
          ownership_type: string
          slug: string
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name: string
          notes?: string | null
          ownership_type?: string
          slug: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          name?: string
          notes?: string | null
          ownership_type?: string
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
      lastapp_catalog_product: {
        Row: {
          account_id: string
          catalog_product_id: string
          created_at: string
          id: string
          is_enabled: boolean | null
          lastapp_brand_name: string | null
          lastapp_catalog_id: string | null
          lastapp_channel: string | null
          lastapp_organization_id: string
          needs_review: boolean
          organization_product_id: string | null
          price_cents: number | null
          product_name: string | null
          product_type: string | null
          seen_in_catalog_at: string | null
          seen_in_sale_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          catalog_product_id: string
          created_at?: string
          id?: string
          is_enabled?: boolean | null
          lastapp_brand_name?: string | null
          lastapp_catalog_id?: string | null
          lastapp_channel?: string | null
          lastapp_organization_id: string
          needs_review?: boolean
          organization_product_id?: string | null
          price_cents?: number | null
          product_name?: string | null
          product_type?: string | null
          seen_in_catalog_at?: string | null
          seen_in_sale_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          catalog_product_id?: string
          created_at?: string
          id?: string
          is_enabled?: boolean | null
          lastapp_brand_name?: string | null
          lastapp_catalog_id?: string | null
          lastapp_channel?: string | null
          lastapp_organization_id?: string
          needs_review?: boolean
          organization_product_id?: string | null
          price_cents?: number | null
          product_name?: string | null
          product_type?: string | null
          seen_in_catalog_at?: string | null
          seen_in_sale_at?: string | null
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
      lastapp_integration: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_active: boolean
          lastapp_organization_id: string
          organization_name: string | null
          ownership_type: string
          token_secret_name: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          lastapp_organization_id: string
          organization_name?: string | null
          ownership_type?: string
          token_secret_name: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          lastapp_organization_id?: string
          organization_name?: string | null
          ownership_type?: string
          token_secret_name?: string
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
      lastapp_location_map: {
        Row: {
          account_id: string
          created_at: string
          id: string
          lastapp_location_id: string
          lastapp_location_name: string | null
          location_id: string | null
          needs_review: boolean
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          lastapp_location_id: string
          lastapp_location_name?: string | null
          location_id?: string | null
          needs_review?: boolean
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          lastapp_location_id?: string
          lastapp_location_name?: string | null
          location_id?: string | null
          needs_review?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lastapp_location_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lastapp_location_map_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      lastapp_product_map: {
        Row: {
          account_id: string
          created_at: string
          id: string
          lastapp_product_name: string | null
          needs_review: boolean
          organization_product_id: string
          recipe_item_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          lastapp_product_name?: string | null
          needs_review?: boolean
          organization_product_id: string
          recipe_item_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          lastapp_product_name?: string | null
          needs_review?: boolean
          organization_product_id?: string
          recipe_item_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lastapp_product_map_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lastapp_product_map_recipe_item_id_fkey"
            columns: ["recipe_item_id"]
            isOneToOne: false
            referencedRelation: "recipe_item"
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
      location_planning: {
        Row: {
          id: string
          location_id: string
          needed_default: number
          needed_dom: number | null
          needed_jue: number | null
          needed_lun: number | null
          needed_mar: number | null
          needed_mie: number | null
          needed_sab: number | null
          needed_vie: number | null
          notes: string | null
          shift_type_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          location_id: string
          needed_default?: number
          needed_dom?: number | null
          needed_jue?: number | null
          needed_lun?: number | null
          needed_mar?: number | null
          needed_mie?: number | null
          needed_sab?: number | null
          needed_vie?: number | null
          notes?: string | null
          shift_type_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          location_id?: string
          needed_default?: number
          needed_dom?: number | null
          needed_jue?: number | null
          needed_lun?: number | null
          needed_mar?: number | null
          needed_mie?: number | null
          needed_sab?: number | null
          needed_vie?: number | null
          notes?: string | null
          shift_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_planning_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_planning_shift_type_id_fkey"
            columns: ["shift_type_id"]
            isOneToOne: false
            referencedRelation: "shift_types"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          account_id: string | null
          active: boolean
          address: string | null
          created_at: string
          hours_balance_close_day: number | null
          hours_balance_sync_with_gestoria: boolean | null
          id: string
          is_billable: boolean
          lat: number | null
          lng: number | null
          name: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          address?: string | null
          created_at?: string
          hours_balance_close_day?: number | null
          hours_balance_sync_with_gestoria?: boolean | null
          id?: string
          is_billable?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          address?: string | null
          created_at?: string
          hours_balance_close_day?: number | null
          hours_balance_sync_with_gestoria?: boolean | null
          id?: string
          is_billable?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          phone?: string | null
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
          created_at: string
          id: string
          impact_type: string
          modifier_option_id: string
          quantity: number | null
          target_recipe_item_id: string | null
          unit_id: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          impact_type: string
          modifier_option_id: string
          quantity?: number | null
          target_recipe_item_id?: string | null
          unit_id?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          impact_type?: string
          modifier_option_id?: string
          quantity?: number | null
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
          is_purchasable: boolean
          is_sellable: boolean
          is_stockable: boolean
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
          origin: string | null
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
          is_purchasable?: boolean
          is_sellable?: boolean
          is_stockable?: boolean
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
          origin?: string | null
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
          is_purchasable?: boolean
          is_sellable?: boolean
          is_stockable?: boolean
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
          origin?: string | null
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
          channel_id: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          delivery_cost: number | null
          discount_amount: number | null
          external_brand_text: string | null
          external_channel_text: string | null
          external_location_text: string | null
          external_ref: string | null
          id: string
          is_active: boolean
          location_id: string | null
          paid: number | null
          payment_method: string | null
          raw_products: string | null
          refund_amount: number | null
          service_type: string | null
          sold_at: string
          source: string
          tax: number | null
          taxable_base: number | null
          total: number
          updated_at: string
        }
        Insert: {
          account_id: string
          archived_at?: string | null
          brand_id?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delivery_cost?: number | null
          discount_amount?: number | null
          external_brand_text?: string | null
          external_channel_text?: string | null
          external_location_text?: string | null
          external_ref?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          paid?: number | null
          payment_method?: string | null
          raw_products?: string | null
          refund_amount?: number | null
          service_type?: string | null
          sold_at: string
          source?: string
          tax?: number | null
          taxable_base?: number | null
          total?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          archived_at?: string | null
          brand_id?: string | null
          channel_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          delivery_cost?: number | null
          discount_amount?: number | null
          external_brand_text?: string | null
          external_channel_text?: string | null
          external_location_text?: string | null
          external_ref?: string | null
          id?: string
          is_active?: boolean
          location_id?: string | null
          paid?: number | null
          payment_method?: string | null
          raw_products?: string | null
          refund_amount?: number | null
          service_type?: string | null
          sold_at?: string
          source?: string
          tax?: number | null
          taxable_base?: number | null
          total?: number
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
          created_at: string
          id: string
          line_total: number | null
          line_type: string
          map_confidence: number | null
          map_needs_review: boolean
          map_source: string
          menu_item_id: string | null
          modifier_option_id: string | null
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
          created_at?: string
          id?: string
          line_total?: number | null
          line_type?: string
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string
          menu_item_id?: string | null
          modifier_option_id?: string | null
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
          created_at?: string
          id?: string
          line_total?: number | null
          line_type?: string
          map_confidence?: number | null
          map_needs_review?: boolean
          map_source?: string
          menu_item_id?: string | null
          modifier_option_id?: string | null
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
      shift_assignments: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          id: string
          notes: string | null
          override_end: string | null
          override_start: string | null
          plan_id: string
          shift_type_id: string | null
          slot: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          employee_id: string
          id?: string
          notes?: string | null
          override_end?: string | null
          override_start?: string | null
          plan_id: string
          shift_type_id?: string | null
          slot?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          notes?: string | null
          override_end?: string | null
          override_start?: string | null
          plan_id?: string
          shift_type_id?: string | null
          slot?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "weekly_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_assignments_shift_type_id_fkey"
            columns: ["shift_type_id"]
            isOneToOne: false
            referencedRelation: "shift_types"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_minimums: {
        Row: {
          created_at: string
          id: string
          location_id: string | null
          min_default: number
          min_weekend: number | null
          shift_type_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id?: string | null
          min_default?: number
          min_weekend?: number | null
          shift_type_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string | null
          min_default?: number
          min_weekend?: number | null
          shift_type_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_minimums_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_minimums_shift_type_id_fkey"
            columns: ["shift_type_id"]
            isOneToOne: false
            referencedRelation: "shift_types"
            referencedColumns: ["id"]
          },
        ]
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
      shift_types: {
        Row: {
          account_id: string | null
          active: boolean | null
          break_minutes: number | null
          code: string
          color: string | null
          created_at: string
          display_order: number | null
          end_time: string | null
          hours: number | null
          id: string
          is_off: boolean | null
          is_split: boolean | null
          label: string
          split_2_end: string | null
          split_2_start: string | null
          start_time: string | null
        }
        Insert: {
          account_id?: string | null
          active?: boolean | null
          break_minutes?: number | null
          code: string
          color?: string | null
          created_at?: string
          display_order?: number | null
          end_time?: string | null
          hours?: number | null
          id?: string
          is_off?: boolean | null
          is_split?: boolean | null
          label: string
          split_2_end?: string | null
          split_2_start?: string | null
          start_time?: string | null
        }
        Update: {
          account_id?: string | null
          active?: boolean | null
          break_minutes?: number | null
          code?: string
          color?: string | null
          created_at?: string
          display_order?: number | null
          end_time?: string | null
          hours?: number | null
          id?: string
          is_off?: boolean | null
          is_split?: boolean | null
          label?: string
          split_2_end?: string | null
          split_2_start?: string | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_types_account_fk"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
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
          created_at: string
          created_by: string | null
          created_by_name: string | null
          expiry_alert_days: number
          id: string
          price_alert_pct: number
          tol_a_pct: number
          tol_b_pct: number
          tol_c_pct: number
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expiry_alert_days?: number
          id?: string
          price_alert_pct?: number
          tol_a_pct?: number
          tol_b_pct?: number
          tol_c_pct?: number
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          expiry_alert_days?: number
          id?: string
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
          asuntos_propios_per_year: number
          created_at: string
          employee_id: string | null
          id: string
          min_lead_days: number
          min_staff_per_location: number
          scope: string
          updated_at: string
          vacation_days_per_year: number
        }
        Insert: {
          asuntos_propios_per_year?: number
          created_at?: string
          employee_id?: string | null
          id?: string
          min_lead_days?: number
          min_staff_per_location?: number
          scope?: string
          updated_at?: string
          vacation_days_per_year?: number
        }
        Update: {
          asuntos_propios_per_year?: number
          created_at?: string
          employee_id?: string | null
          id?: string
          min_lead_days?: number
          min_staff_per_location?: number
          scope?: string
          updated_at?: string
          vacation_days_per_year?: number
        }
        Relationships: [
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
      weekly_availability: {
        Row: {
          available: boolean
          employee_id: string
          id: string
          notes: string | null
          updated_at: string
          week_start: string
        }
        Insert: {
          available?: boolean
          employee_id: string
          id?: string
          notes?: string | null
          updated_at?: string
          week_start: string
        }
        Update: {
          available?: boolean
          employee_id?: string
          id?: string
          notes?: string | null
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_plans: {
        Row: {
          created_at: string
          id: string
          location_id: string | null
          notes: string | null
          published_at: string | null
          published_by: string | null
          status: string
          updated_at: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string | null
          notes?: string | null
          published_at?: string | null
          published_by?: string | null
          status?: string
          updated_at?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_plans_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_plans_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      appcc_mark_overdue: { Args: never; Returns: undefined }
      apply_inventory_count: {
        Args: { p_count_id: string; p_user_id?: string; p_user_name?: string }
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
      belongs_to_account: { Args: { p_account_id: string }; Returns: boolean }
      build_inventory_count: {
        Args: { p_area_ids?: string[]; p_count_id: string; p_full?: boolean }
        Returns: number
      }
      classify_unmapped_product: {
        Args: {
          p_account_id: string
          p_action: string
          p_product_name: string
          p_unit_cost?: number
        }
        Returns: {
          lineas_casadas: number
          marcas_creadas: number
          recipe_item_id: string
          resultado: string
        }[]
      }
      cleanup_auth_rate_limits: { Args: never; Returns: number }
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
      delete_account_tx: {
        Args: { p_account_id: string; p_admin_user_id: string }
        Returns: undefined
      }
      folvy_code_prefix: { Args: { p_type: string }; Returns: string }
      force_close_long_impersonations: { Args: never; Returns: number }
      format_price_per_base: {
        Args: { p_format_id: string; p_supplier_id: string }
        Returns: number
      }
      get_effective_permissions: {
        Args: { p_account_id: string }
        Returns: Json
      }
      has_permission: {
        Args: { p_account_id: string; p_permission_key: string }
        Returns: boolean
      }
      invoice_required_role: { Args: { p_invoice_id: string }; Returns: string }
      kitchen_ancestors_of: {
        Args: { p_item_id: string }
        Returns: {
          ancestor_id: string
          depth: number
        }[]
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
      kitchen_similar_dishes_for_ai: {
        Args: { p_n?: number; p_recipe_item_id: string }
        Returns: Json
      }
      learn_from_receipt: { Args: { p_receipt_id: string }; Returns: number }
      learn_supplier_alias: { Args: { p_receipt_id: string }; Returns: boolean }
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
      materialize_recipe_session: {
        Args: { p_session_id: string }
        Returns: {
          dish_name: string
          lines_created: number
          lines_skipped: number
          new_articles_created: number
          result_recipe_id: string
          was_created: boolean
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
          food_cost_pct: number
          food_cost_status: string
          menu_item_id: string
          menu_item_name: string
          net_margin: number
          net_margin_pct: number
          price: number
          price_with_vat: number
          recipe_item_id: string
          revenue_share_amount: number
          revenue_share_pct: number
          target_food_cost_pct: number
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
      recompute_location_stock: {
        Args: { p_item_id: string; p_location_id: string }
        Returns: undefined
      }
      recompute_purchase_order_status: {
        Args: { p_order_id: string }
        Returns: string
      }
      resolve_lastapp_line: {
        Args: {
          p_account_id: string
          p_catalog_product_id: string
          p_channel_slug: string
        }
        Returns: {
          menu_item_id: string
          org_product_id: string
          recipe_item_id: string
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
      resolve_unmapped_sales: {
        Args: { p_account_id: string; p_action: string; p_product_name: string }
        Returns: {
          brand_id: string
          lineas_afectadas: number
          menu_item_id: string
          recipe_item_id: string
          resultado: string
        }[]
      }
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
      seed_appcc_for_account: {
        Args: { p_account_id: string }
        Returns: undefined
      }
      seed_lastapp_catalog: {
        Args: { p_account_id: string }
        Returns: {
          menu_items_creados: number
          productos_sin_marca: number
          recipe_items_creados: number
          vinculos_creados: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      supplier_format_prices: {
        Args: { p_account_id: string; p_supplier_id: string }
        Returns: {
          eur_per_base: number
          format_id: string
        }[]
      }
      unaccent: { Args: { "": string }; Returns: string }
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
      [_ in never]: never
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
