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
      accounts: {
        Row: {
          billing_address: Json | null
          billing_email: string | null
          billing_phone: string | null
          cif: string | null
          country: string
          created_at: string
          created_by: string | null
          currency: string | null
          id: string
          is_internal: boolean
          legal_name: string | null
          locale: string | null
          metadata: Json | null
          name: string
          slug: string
          status: string
          stripe_customer_id: string | null
          timezone: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          is_internal?: boolean
          legal_name?: string | null
          locale?: string | null
          metadata?: Json | null
          name: string
          slug: string
          status?: string
          stripe_customer_id?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          billing_address?: Json | null
          billing_email?: string | null
          billing_phone?: string | null
          cif?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          is_internal?: boolean
          legal_name?: string | null
          locale?: string | null
          metadata?: Json | null
          name?: string
          slug?: string
          status?: string
          stripe_customer_id?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          updated_at?: string
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
          commission_pct: number | null
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
          commission_pct?: number | null
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
          commission_pct?: number | null
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
      sales_channel: {
        Row: {
          account_id: string
          archived_at: string | null
          channel_type: string
          color: string | null
          created_at: string
          default_commission_pct: number | null
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
          default_commission_pct?: number | null
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
          default_commission_pct?: number | null
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
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          display_name?: string | null
          employee_id?: string | null
          id?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          active?: boolean
          created_at?: string
          display_name?: string | null
          employee_id?: string | null
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
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
      current_user_account_ids: { Args: never; Returns: string[] }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_is_admin_of: {
        Args: { p_account_id: string }
        Returns: boolean
      }
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
