-- ============================================================================
-- Políticas de lectura de contabilidad, una vez por consulta — 1 · las 48
-- ----------------------------------------------------------------------------
-- cambia: public.ai_action_log · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.ai_data_origin · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.ai_suggestion · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.allocation_rule · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.annual_accounts_choice · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.annual_accounts_mapping · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.annual_accounts_mapping_change · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.brand_partner_contribution · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_account · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_account_link · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_account_log · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_activity · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_chart_import · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_doubt · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_relation · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.company_tax_profile · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.customer_fiscal · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.entry_template · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.entry_template_line · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.entry_text · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.expense_category · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.fiscal_period_lock · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.fiscal_year · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.fiscal_year_closing · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.general_row_setting · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.investment_good · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.investment_good_regularization · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.invoice_series · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.journal_correction · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.journal_dismissal · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.journal_line · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.party · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.party_merge · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.party_role · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.payment_method · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.payment_term · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.payroll_summary · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.supplier_contact · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.supplier_invoice_payment_log · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.supplier_learning · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.supplier_learning_log · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.supplier_proposal · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.tax_rate · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.treasury_account · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.vat_book_entry · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
-- cambia: public.withholding_rate · prueba: supabase/staging/sql/20261015_politicas_prueba.sql
--
-- El libro diario no cargaba en producción: «conta_dias_por_asentar: canceling
-- statement due to statement timeout». El explain midió 18,0 s contra el
-- límite de 8 s. Los dos «not exists» (sobre sales_day_summary y sobre
-- journal_dismissal) llamaban a belongs_to_account(account_id) —SQL, security
-- definer, que el planificador no puede desplegar— UNA VEZ POR FILA: unos
-- 0,37 ms por llamada, 33.840 + 13.818 llamadas.
--
-- Las 49 políticas de SELECT de las tablas que crearon C00 a C05 (todas las
-- que usan belongs_to_account; lista de pg_policies, igual en producción y en
-- staging el 09/10: tests/conta/produccion/politicas-c00-c05-produccion-
-- 20261009.json) pasan a
--     account_id = any ((select public.current_user_account_ids())::uuid[])
-- El «(select …)» la convierte en un InitPlan: se calcula UNA vez por
-- consulta, no una por fila. El «::uuid[]» no sobra: sin él, «= any
-- (select …)» se lee como «= ANY (subconsulta)» y compara uuid con uuid[]
-- (42883; lo cazó el primer run de staging, 09/10).
--
-- Mismo resultado sobre los datos reales: belongs_to_account(p) es
-- «p = any(current_user_account_ids()) or current_user_is_admin()», y para un
-- superadmin current_user_account_ids() ya devuelve TODAS las cuentas. Solo
-- diferirían las filas con account_id fuera de accounts, o nulo fuera de
-- «is_system» / «account_id is null»: medido en producción el 09/10, 0 en las
-- 49 tablas. Se conservan el nombre, el rol (authenticated o public) y la
-- parte «is_system or» / «account_id is null or» de cada una.
--
-- Las de UPDATE/DELETE (current_user_is_admin_or_manager_of) se quedan: no
-- hay pantalla ni función que las ejerza sobre muchas filas (informe del PR).
--
-- En dos ficheros porque el analizador pone sales_day_summary en el camino
-- del pedido (CAMINO_TABLAS: «sales_.*»): 0100 lleva las otras 48 y «sigue»;
-- 0110 lleva solo sales_day_summary y pide «autorizo». Las dos hacen falta
-- para que el libro diario baje del límite.
--
-- Guarda: PARA si alguna de las 48 no está exactamente como se midió.
-- Vuelta atrás: supabase/vuelta-atras/20261015T0100_politicas_una_vez.down.sql
-- ============================================================================

do $$
declare n int;
begin
  -- Cada política, con su nombre, su rol y su texto exactos de antes.
  select count(*) into n
    from (values
      ('ai_action_log', 'ai_action_log_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('ai_data_origin', 'ai_data_origin_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('ai_suggestion', 'ai_suggestion_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('allocation_rule', 'allocation_rule_select', 'public', 'belongs_to_account(account_id)'),
      ('annual_accounts_choice', 'annual_accounts_choice_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('annual_accounts_mapping', 'annual_accounts_mapping_select', 'authenticated', '((account_id IS NULL) OR belongs_to_account(account_id))'),
      ('annual_accounts_mapping_change', 'annual_accounts_mapping_change_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('brand_partner_contribution', 'brand_partner_contribution_select', 'public', 'belongs_to_account(account_id)'),
      ('company', 'company_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_account', 'company_account_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_account_link', 'company_account_link_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_account_log', 'company_account_log_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_activity', 'company_activity_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_chart_import', 'company_chart_import_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_doubt', 'company_doubt_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_relation', 'company_relation_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('company_tax_profile', 'company_tax_profile_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('customer_fiscal', 'customer_fiscal_select', 'public', 'belongs_to_account(account_id)'),
      ('entry_template', 'entry_template_select', 'public', 'belongs_to_account(account_id)'),
      ('entry_template_line', 'entry_template_line_select', 'public', 'belongs_to_account(account_id)'),
      ('entry_text', 'entry_text_select', 'authenticated', '(is_system OR belongs_to_account(account_id))'),
      ('expense_category', 'expense_category_select', 'authenticated', '(is_system OR belongs_to_account(account_id))'),
      ('fiscal_period_lock', 'fiscal_period_lock_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('fiscal_year', 'fiscal_year_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('fiscal_year_closing', 'fiscal_year_closing_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('general_row_setting', 'general_row_setting_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('investment_good', 'investment_good_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('investment_good_regularization', 'investment_good_regularization_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('invoice_series', 'invoice_series_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('journal_correction', 'journal_correction_select', 'public', 'belongs_to_account(account_id)'),
      ('journal_dismissal', 'journal_dismissal_select', 'public', 'belongs_to_account(account_id)'),
      ('journal_entry', 'journal_entry_select', 'public', 'belongs_to_account(account_id)'),
      ('journal_line', 'journal_line_select', 'public', 'belongs_to_account(account_id)'),
      ('party', 'party_select', 'public', 'belongs_to_account(account_id)'),
      ('party_merge', 'party_merge_select', 'public', 'belongs_to_account(account_id)'),
      ('party_role', 'party_role_select', 'public', 'belongs_to_account(account_id)'),
      ('payment_method', 'payment_method_select', 'authenticated', '(is_system OR belongs_to_account(account_id))'),
      ('payment_term', 'payment_term_select', 'authenticated', '(is_system OR belongs_to_account(account_id))'),
      ('payroll_summary', 'payroll_summary_select', 'public', 'belongs_to_account(account_id)'),
      ('supplier_contact', 'supplier_contact_select', 'public', 'belongs_to_account(account_id)'),
      ('supplier_invoice_payment_log', 'sipl_select', 'public', 'belongs_to_account(account_id)'),
      ('supplier_learning', 'supplier_learning_select', 'public', 'belongs_to_account(account_id)'),
      ('supplier_learning_log', 'supplier_learning_log_select', 'public', 'belongs_to_account(account_id)'),
      ('supplier_proposal', 'supplier_proposal_select', 'public', 'belongs_to_account(account_id)'),
      ('tax_rate', 'tax_rate_select', 'authenticated', '(is_system OR belongs_to_account(account_id))'),
      ('treasury_account', 'treasury_account_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('vat_book_entry', 'vat_book_entry_select', 'authenticated', 'belongs_to_account(account_id)'),
      ('withholding_rate', 'withholding_rate_select', 'authenticated', '(is_system OR belongs_to_account(account_id))')
    ) e(t, p, roles, qual)
    join pg_policies x on x.schemaname = 'public' and x.tablename = e.t and x.policyname = e.p
                      and x.cmd = 'SELECT' and x.permissive = 'PERMISSIVE'
                      and array_to_string(x.roles, ',') = e.roles and x.qual = e.qual;
  if n <> 48 then
    raise exception 'Políticas de conta: % de 48 están como se midieron el 09/10. No se toca nada.', n;
  end if;
end $$;

drop policy if exists ai_action_log_select on public.ai_action_log;
create policy ai_action_log_select on public.ai_action_log as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists ai_data_origin_select on public.ai_data_origin;
create policy ai_data_origin_select on public.ai_data_origin as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists ai_suggestion_select on public.ai_suggestion;
create policy ai_suggestion_select on public.ai_suggestion as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists allocation_rule_select on public.allocation_rule;
create policy allocation_rule_select on public.allocation_rule as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists annual_accounts_choice_select on public.annual_accounts_choice;
create policy annual_accounts_choice_select on public.annual_accounts_choice as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists annual_accounts_mapping_select on public.annual_accounts_mapping;
create policy annual_accounts_mapping_select on public.annual_accounts_mapping as permissive for select to authenticated using (account_id is null or account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists annual_accounts_mapping_change_select on public.annual_accounts_mapping_change;
create policy annual_accounts_mapping_change_select on public.annual_accounts_mapping_change as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists brand_partner_contribution_select on public.brand_partner_contribution;
create policy brand_partner_contribution_select on public.brand_partner_contribution as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_select on public.company;
create policy company_select on public.company as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_account_select on public.company_account;
create policy company_account_select on public.company_account as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_account_link_select on public.company_account_link;
create policy company_account_link_select on public.company_account_link as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_account_log_select on public.company_account_log;
create policy company_account_log_select on public.company_account_log as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_activity_select on public.company_activity;
create policy company_activity_select on public.company_activity as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_chart_import_select on public.company_chart_import;
create policy company_chart_import_select on public.company_chart_import as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_doubt_select on public.company_doubt;
create policy company_doubt_select on public.company_doubt as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_relation_select on public.company_relation;
create policy company_relation_select on public.company_relation as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists company_tax_profile_select on public.company_tax_profile;
create policy company_tax_profile_select on public.company_tax_profile as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists customer_fiscal_select on public.customer_fiscal;
create policy customer_fiscal_select on public.customer_fiscal as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists entry_template_select on public.entry_template;
create policy entry_template_select on public.entry_template as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists entry_template_line_select on public.entry_template_line;
create policy entry_template_line_select on public.entry_template_line as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists entry_text_select on public.entry_text;
create policy entry_text_select on public.entry_text as permissive for select to authenticated using (is_system or account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists expense_category_select on public.expense_category;
create policy expense_category_select on public.expense_category as permissive for select to authenticated using (is_system or account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists fiscal_period_lock_select on public.fiscal_period_lock;
create policy fiscal_period_lock_select on public.fiscal_period_lock as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists fiscal_year_select on public.fiscal_year;
create policy fiscal_year_select on public.fiscal_year as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists fiscal_year_closing_select on public.fiscal_year_closing;
create policy fiscal_year_closing_select on public.fiscal_year_closing as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists general_row_setting_select on public.general_row_setting;
create policy general_row_setting_select on public.general_row_setting as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists investment_good_select on public.investment_good;
create policy investment_good_select on public.investment_good as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists investment_good_regularization_select on public.investment_good_regularization;
create policy investment_good_regularization_select on public.investment_good_regularization as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists invoice_series_select on public.invoice_series;
create policy invoice_series_select on public.invoice_series as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists journal_correction_select on public.journal_correction;
create policy journal_correction_select on public.journal_correction as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists journal_dismissal_select on public.journal_dismissal;
create policy journal_dismissal_select on public.journal_dismissal as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists journal_entry_select on public.journal_entry;
create policy journal_entry_select on public.journal_entry as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists journal_line_select on public.journal_line;
create policy journal_line_select on public.journal_line as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists party_select on public.party;
create policy party_select on public.party as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists party_merge_select on public.party_merge;
create policy party_merge_select on public.party_merge as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists party_role_select on public.party_role;
create policy party_role_select on public.party_role as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists payment_method_select on public.payment_method;
create policy payment_method_select on public.payment_method as permissive for select to authenticated using (is_system or account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists payment_term_select on public.payment_term;
create policy payment_term_select on public.payment_term as permissive for select to authenticated using (is_system or account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists payroll_summary_select on public.payroll_summary;
create policy payroll_summary_select on public.payroll_summary as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists supplier_contact_select on public.supplier_contact;
create policy supplier_contact_select on public.supplier_contact as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists sipl_select on public.supplier_invoice_payment_log;
create policy sipl_select on public.supplier_invoice_payment_log as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists supplier_learning_select on public.supplier_learning;
create policy supplier_learning_select on public.supplier_learning as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists supplier_learning_log_select on public.supplier_learning_log;
create policy supplier_learning_log_select on public.supplier_learning_log as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists supplier_proposal_select on public.supplier_proposal;
create policy supplier_proposal_select on public.supplier_proposal as permissive for select to public using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists tax_rate_select on public.tax_rate;
create policy tax_rate_select on public.tax_rate as permissive for select to authenticated using (is_system or account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists treasury_account_select on public.treasury_account;
create policy treasury_account_select on public.treasury_account as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists vat_book_entry_select on public.vat_book_entry;
create policy vat_book_entry_select on public.vat_book_entry as permissive for select to authenticated using (account_id = any ((select public.current_user_account_ids())::uuid[]));
drop policy if exists withholding_rate_select on public.withholding_rate;
create policy withholding_rate_select on public.withholding_rate as permissive for select to authenticated using (is_system or account_id = any ((select public.current_user_account_ids())::uuid[]));

-- Comprobación: las 48 con la forma nueva y ninguna con belongs_to_account.
do $$
declare n int; v int;
begin
  select count(*) filter (where qual like '%SELECT current_user_account_ids()%' and qual not like '%belongs_to_account%'),
         count(*) filter (where qual like '%belongs_to_account%')
    into n, v
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT'
     and tablename in (
      'ai_action_log', 'ai_data_origin', 'ai_suggestion', 'allocation_rule', 'annual_accounts_choice', 'annual_accounts_mapping',
      'annual_accounts_mapping_change', 'brand_partner_contribution', 'company', 'company_account', 'company_account_link', 'company_account_log',
      'company_activity', 'company_chart_import', 'company_doubt', 'company_relation', 'company_tax_profile', 'customer_fiscal',
      'entry_template', 'entry_template_line', 'entry_text', 'expense_category', 'fiscal_period_lock', 'fiscal_year',
      'fiscal_year_closing', 'general_row_setting', 'investment_good', 'investment_good_regularization', 'invoice_series', 'journal_correction',
      'journal_dismissal', 'journal_entry', 'journal_line', 'party', 'party_merge', 'party_role',
      'payment_method', 'payment_term', 'payroll_summary', 'supplier_contact', 'supplier_invoice_payment_log', 'supplier_learning',
      'supplier_learning_log', 'supplier_proposal', 'tax_rate', 'treasury_account', 'vat_book_entry', 'withholding_rate');
  if n <> 48 or v <> 0 then
    raise exception 'Políticas de conta: después del cambio hay % con la forma nueva y % con belongs_to_account (espero 48 y 0).', n, v;
  end if;
end $$;
