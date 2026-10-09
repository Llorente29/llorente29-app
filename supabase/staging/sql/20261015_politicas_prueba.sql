-- supabase/staging/sql/20261015_politicas_prueba.sql
--
-- SOLO STAGING. Prueba de las políticas de lectura de contabilidad «una vez
-- por consulta» (supabase/migrations/20261015T0100_politicas_una_vez.sql y
-- 20261015T0110_politicas_una_vez_resumen.sql). Todo en una transacción con
-- ROLLBACK: no cambia staging.
--
--   1. Siembra, en la empresa A, 1.100 ventas propias cerradas de noviembre
--      de 2026 en sus dos locales (más 40 de una marca de socio, que no
--      cuentan), 50 resúmenes de día (10 de noviembre con su asiento
--      propuesto) y 120 descartes (15 de noviembre). Y 5 + 5 en la cuenta B.
--   2. Con las políticas NUEVAS, como usuario de A: conta_dias_por_asentar
--      de noviembre tarda menos de 1 s, el plan resuelve
--      current_user_account_ids() en un InitPlan y no llama a
--      belongs_to_account. Y da los 35 días que tiene que dar (60 − 10 − 15).
--   3. Lo que ve cada uno en las 49 tablas, contado contra lo que hay:
--      A ve lo suyo (y lo de sistema), B lo suyo y nada de A, y un
--      superadmin (platform_admins) lo ve TODO, de las dos cuentas.
--   4. ROMPERLA A PROPÓSITO: se vuelven a poner las 49 políticas viejas
--      (belongs_to_account) y se mide igual. La prueba EXIGE que entonces no
--      pase (más de 1 s o belongs_to_account en el plan), y que el resultado
--      sea el mismo: si la vieja pasara, la prueba no distinguiría nada.
--
-- Las 49 tablas, con su política: ai_action_log, ai_data_origin, ai_suggestion, allocation_rule, annual_accounts_choice, annual_accounts_mapping, annual_accounts_mapping_change, brand_partner_contribution, company, company_account, company_account_link, company_account_log, company_activity, company_chart_import, company_doubt, company_relation, company_tax_profile, customer_fiscal, entry_template, entry_template_line, entry_text, expense_category, fiscal_period_lock, fiscal_year, fiscal_year_closing, general_row_setting, investment_good, investment_good_regularization, invoice_series, journal_correction, journal_dismissal, journal_entry, journal_line, party, party_merge, party_role, payment_method, payment_term, payroll_summary, sales_day_summary, supplier_contact, supplier_invoice_payment_log, supplier_learning, supplier_learning_log, supplier_proposal, tax_rate, treasury_account, vat_book_entry, withholding_rate.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA políticas: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- Las 49, con su texto de antes y la parte que no es de cuenta (is_system o
-- account_id is null), igual que tests/conta/produccion/politicas-c00-c05-produccion-20261009.json.
create temp table _politicas (t text, p text, roles text, vieja text, extra text) on commit drop;
insert into _politicas values
      ('ai_action_log', 'ai_action_log_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('ai_data_origin', 'ai_data_origin_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('ai_suggestion', 'ai_suggestion_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('allocation_rule', 'allocation_rule_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('annual_accounts_choice', 'annual_accounts_choice_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('annual_accounts_mapping', 'annual_accounts_mapping_select', 'authenticated', '((account_id IS NULL) OR belongs_to_account(account_id))', 'account_id is null'),
      ('annual_accounts_mapping_change', 'annual_accounts_mapping_change_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('brand_partner_contribution', 'brand_partner_contribution_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('company', 'company_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_account', 'company_account_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_account_link', 'company_account_link_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_account_log', 'company_account_log_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_activity', 'company_activity_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_chart_import', 'company_chart_import_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_doubt', 'company_doubt_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_relation', 'company_relation_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('company_tax_profile', 'company_tax_profile_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('customer_fiscal', 'customer_fiscal_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('entry_template', 'entry_template_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('entry_template_line', 'entry_template_line_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('entry_text', 'entry_text_select', 'authenticated', '(is_system OR belongs_to_account(account_id))', 'is_system'),
      ('expense_category', 'expense_category_select', 'authenticated', '(is_system OR belongs_to_account(account_id))', 'is_system'),
      ('fiscal_period_lock', 'fiscal_period_lock_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('fiscal_year', 'fiscal_year_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('fiscal_year_closing', 'fiscal_year_closing_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('general_row_setting', 'general_row_setting_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('investment_good', 'investment_good_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('investment_good_regularization', 'investment_good_regularization_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('invoice_series', 'invoice_series_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('journal_correction', 'journal_correction_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('journal_dismissal', 'journal_dismissal_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('journal_entry', 'journal_entry_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('journal_line', 'journal_line_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('party', 'party_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('party_merge', 'party_merge_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('party_role', 'party_role_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('payment_method', 'payment_method_select', 'authenticated', '(is_system OR belongs_to_account(account_id))', 'is_system'),
      ('payment_term', 'payment_term_select', 'authenticated', '(is_system OR belongs_to_account(account_id))', 'is_system'),
      ('payroll_summary', 'payroll_summary_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('sales_day_summary', 'sales_day_summary_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('supplier_contact', 'supplier_contact_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('supplier_invoice_payment_log', 'sipl_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('supplier_learning', 'supplier_learning_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('supplier_learning_log', 'supplier_learning_log_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('supplier_proposal', 'supplier_proposal_select', 'public', 'belongs_to_account(account_id)', 'false'),
      ('tax_rate', 'tax_rate_select', 'authenticated', '(is_system OR belongs_to_account(account_id))', 'is_system'),
      ('treasury_account', 'treasury_account_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('vat_book_entry', 'vat_book_entry_select', 'authenticated', 'belongs_to_account(account_id)', 'false'),
      ('withholding_rate', 'withholding_rate_select', 'authenticated', '(is_system OR belongs_to_account(account_id))', 'is_system');

\echo '>>> 0. Las 49 están con la forma nueva'
do $$
declare n int;
begin
  select count(*) into n from _politicas x join pg_policies p on p.schemaname = 'public' and p.tablename = x.t and p.policyname = x.p
   where p.cmd = 'SELECT' and p.qual like '%SELECT current_user_account_ids()%' and p.qual not like '%belongs_to_account%';
  if n <> 49 then raise exception 'PRUEBA políticas · 0: % de 49 con la forma nueva.', n; end if;
  raise notice 'PRUEBA políticas · 0 en verde: las 49 con account_id = any ((select current_user_account_ids())::uuid[]).';
end $$;

\echo '>>> 1. Siembra (noviembre de 2026, empresa A; y un poco de B)'
set local session_replication_role = replica;  -- sin los disparadores del pedido (impresión, consumo, reparto…)
insert into public.sale (account_id, location_id, brand_id, source, sold_at, total, tax, taxable_base, status)
select 'c01a0000-0000-4000-8000-00000000000a', case when (i / 30) % 2 = 0 then 'c01a0000-0000-4000-8000-0000000000a2'::uuid else 'e0200000-0000-4000-8000-0000000000a3'::uuid end,
       case when i <= 1100 then 'e0200000-0000-4000-8000-00000000a0b1'::uuid else 'e0200000-0000-4000-8000-00000000a0b5'::uuid end,
       'manual', timestamptz '2026-11-01 12:00:00+01' + ((i % 30) || ' days')::interval + ((i % 600) || ' minutes')::interval,
       22, 2, 20, 'closed'
  from generate_series(1, 1140) i;
set local session_replication_role = origin;

insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, entry_id, tickets_count, total, detail_hash)
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a2', date '2026-11-01' + d, '8024e31c-9b9f-48ea-bf8b-8bfb938f1826', 1, 22, 'prueba-politicas'
  from generate_series(0, 9) d
union all
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', case when d < 20 then 'c01a0000-0000-4000-8000-0000000000a2'::uuid else 'e0200000-0000-4000-8000-0000000000a3'::uuid end, date '2026-07-01' + (d % 20), null, 1, 22, 'prueba-politicas'
  from generate_series(0, 39) d
union all
select 'c01b0000-0000-4000-8000-00000000000b', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', 'c01b0000-0000-4000-8000-0000000000b2', date '2026-11-01' + d, null, 1, 22, 'prueba-politicas'
  from generate_series(0, 4) d;

insert into public.journal_dismissal (account_id, company_id, source_type, source_key, reason)
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'sales_day', 'e0200000-0000-4000-8000-0000000000a3:' || (date '2026-11-16' + d), 'Prueba de políticas'
  from generate_series(0, 14) d
union all
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'sales_day', l || ':' || (date '2026-06-01' + d), 'Prueba de políticas'
  from (values ('c01a0000-0000-4000-8000-0000000000a2'), ('e0200000-0000-4000-8000-0000000000a3')) v(l), generate_series(0, 29) d
union all
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'sales_day', 'c01a0000-0000-4000-8000-0000000000a2:' || (date '2026-08-01' + d), 'Prueba de políticas'
  from generate_series(0, 29) d
union all
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'sales_day', 'e0200000-0000-4000-8000-0000000000a3:' || (date '2026-08-01' + d), 'Prueba de políticas'
  from generate_series(0, 14) d
union all
select 'c01b0000-0000-4000-8000-00000000000b', '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6', 'sales_day', 'c01b0000-0000-4000-8000-0000000000b2:' || (date '2026-11-01' + d), 'Prueba de políticas'
  from generate_series(0, 4) d;
analyze public.sale, public.sales_day_summary, public.journal_dismissal;

do $$
declare v int; r int; x int;
begin
  select count(*) into v from public.sale s join public.brand b on b.id = s.brand_id
   where s.account_id = 'c01a0000-0000-4000-8000-00000000000a' and s.status = 'closed' and b.ownership_type = 'own'
     and s.sold_at >= timestamptz '2026-11-01 00:00:00+01' and s.sold_at < timestamptz '2026-12-01 00:00:00+01';
  select count(*) into r from public.sales_day_summary where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and detail_hash = 'prueba-politicas';
  select count(*) into x from public.journal_dismissal where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and reason = 'Prueba de políticas';
  if v < 1000 or r <> 50 or x <> 120 then raise exception 'PRUEBA políticas · 1: siembra corta (% ventas, % resúmenes, % descartes).', v, r, x; end if;
  raise notice 'PRUEBA políticas · 1: % ventas propias cerradas de noviembre en dos locales, % resúmenes de día, % descartes.', v, r, x;
end $$;

-- Lo que hay, contado sin RLS, para comparar con lo que ve cada uno.
do $$
declare r record; n int; na int; nb int; ea int; eb int; e jsonb := '[]';
begin
  for r in select * from _politicas order by t loop
    execute format('select count(*), count(*) filter (where account_id = %L or %s), count(*) filter (where account_id = %L or %s) from public.%I',
                   'c01a0000-0000-4000-8000-00000000000a', r.extra, 'c01b0000-0000-4000-8000-00000000000b', r.extra, r.t) into n, ea, eb;
    e := e || jsonb_build_object('t', r.t, 'total', n, 'a', ea, 'b', eb);
  end loop;
  perform set_config('prueba.esperado', e::text, true);
end $$;

\echo '>>> 2. Con las políticas nuevas, como usuario de A'
select set_config('prueba.fase', 'nueva', true);
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  q text; t0 timestamptz; ms numeric; n int; h text; j text; linea text; ok boolean;
begin
  -- La consulta de la función con sus parámetros puestos: el plan de dentro,
  -- no el «Function Scan» de fuera.
  select regexp_replace(replace(replace(replace(p.prosrc,
           'p_company', '''3b34403a-a7d6-4a48-a8d7-737e8cababdc''::uuid'), 'p_desde', '''2026-11-01''::date'), 'p_hasta', '''2026-11-30''::date'), ';\s*$', '')
    into q from pg_proc p where p.oid = 'public.conta_dias_por_asentar(uuid, date, date)'::regprocedure;
  perform count(*) from public.conta_dias_por_asentar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-11-01', '2026-11-30');  -- en caliente
  t0 := clock_timestamp();
  select count(*), md5(string_agg(x::text, ',' order by x::text)) into n, h
    from public.conta_dias_por_asentar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-11-01', '2026-11-30') x;
  ms := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
  execute 'explain (analyze, buffers, verbose, format json) ' || q into j;
  raise notice '--- explain (analyze, buffers), fase nueva ---';
  for linea in execute 'explain (analyze, buffers) ' || q loop raise notice '%', linea; end loop;
  ok := ms < 1000 and j like '%InitPlan%' and j like '%current_user_account_ids%' and j not like '%belongs_to_account%';
  perform set_config('prueba.nueva', json_build_object('ms', ms, 'dias', n, 'huella', h, 'ok', ok,
    'initplan', j like '%InitPlan%', 'belongs', j like '%belongs_to_account%')::text, true);
  raise notice 'PRUEBA políticas · fase nueva: conta_dias_por_asentar de noviembre en % ms, % días por asentar; InitPlan %, belongs_to_account en el plan %.',
    ms, n, j like '%InitPlan%', j like '%belongs_to_account%';
end $$;
reset role;
do $$
declare v jsonb := current_setting('prueba.nueva')::jsonb;
begin
  if (v->>'dias')::int <> 35 then raise exception 'PRUEBA políticas · 2: % días por asentar en noviembre (espero 35 = 60 − 10 con asiento − 15 descartados).', v->>'dias'; end if;
  if not (v->>'ok')::boolean then
    raise exception 'PRUEBA políticas · 2: con las políticas nuevas NO pasa: % ms (límite 1.000), InitPlan %, belongs_to_account en el plan %.', v->>'ms', v->>'initplan', v->>'belongs';
  end if;
  raise notice 'PRUEBA políticas · 2 en verde: % ms, 35 días, una sola llamada por consulta.', v->>'ms';
end $$;

\echo '>>> 3. Lo que ve cada uno en las 49 tablas'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r record; e jsonb := current_setting('prueba.esperado')::jsonb; n int; na int; nb int; mal text := ''; con int := 0;
begin
  for r in select * from jsonb_to_recordset(e) as x(t text, total int, a int, b int) loop
    execute format('select count(*), count(*) filter (where account_id = %L), count(*) filter (where account_id = %L) from public.%I', 'c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b', r.t) into n, na, nb;
    if n <> r.a or nb <> 0 then mal := mal || format(' %s (ve %s, A %s, B %s · hay %s, A %s, B %s);', r.t, n, na, nb, r.total, r.a, r.b); end if;
    if n > 0 then con := con + 1; end if;
  end loop;
  if mal <> '' then raise exception 'PRUEBA políticas · A ve lo suyo y nada de B:%', mal; end if;
  raise notice 'PRUEBA políticas · A ve lo suyo y nada de B en verde en las 49 tablas (% con filas a la vista).', con;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r record; e jsonb := current_setting('prueba.esperado')::jsonb; n int; na int; nb int; mal text := ''; con int := 0;
begin
  for r in select * from jsonb_to_recordset(e) as x(t text, total int, a int, b int) loop
    execute format('select count(*), count(*) filter (where account_id = %L), count(*) filter (where account_id = %L) from public.%I', 'c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b', r.t) into n, na, nb;
    if n <> r.b or na <> 0 then mal := mal || format(' %s (ve %s, A %s, B %s · hay %s, A %s, B %s);', r.t, n, na, nb, r.total, r.a, r.b); end if;
    if n > 0 then con := con + 1; end if;
  end loop;
  if mal <> '' then raise exception 'PRUEBA políticas · B ve lo suyo y nada de A:%', mal; end if;
  raise notice 'PRUEBA políticas · B ve lo suyo y nada de A en verde en las 49 tablas (% con filas a la vista).', con;
end $$;
reset role;
insert into public.platform_admins (user_id, full_name, role) values ('c01c0000-0000-4000-8000-0000000000c1', 'Superadmin de la prueba', 'support');
select set_config('request.jwt.claims', json_build_object('sub', 'c01c0000-0000-4000-8000-0000000000c1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r record; e jsonb := current_setting('prueba.esperado')::jsonb; n int; na int; nb int; mal text := ''; con int := 0;
begin
  for r in select * from jsonb_to_recordset(e) as x(t text, total int, a int, b int) loop
    execute format('select count(*), count(*) filter (where account_id = %L), count(*) filter (where account_id = %L) from public.%I', 'c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-00000000000b', r.t) into n, na, nb;
    if n <> r.total then mal := mal || format(' %s (ve %s, A %s, B %s · hay %s, A %s, B %s);', r.t, n, na, nb, r.total, r.a, r.b); end if;
    if n > 0 then con := con + 1; end if;
  end loop;
  if mal <> '' then raise exception 'PRUEBA políticas · el superadmin lo ve todo:%', mal; end if;
  raise notice 'PRUEBA políticas · el superadmin lo ve todo en verde en las 49 tablas (% con filas a la vista).', con;
end $$;
reset role;
do $$
declare e jsonb := current_setting('prueba.esperado')::jsonb; ra int; rb int;
begin
  select sum((x->>'total')::int - (x->>'b')::int) filter (where x->>'t' in ('sales_day_summary', 'journal_dismissal')),
         sum((x->>'total')::int - (x->>'a')::int) filter (where x->>'t' in ('sales_day_summary', 'journal_dismissal'))
    into ra, rb from jsonb_array_elements(e) x;
  -- Lo que el superadmin ve de más sobre B es lo de A, y al revés: tiene que haber de las dos.
  if coalesce(ra, 0) = 0 or coalesce(rb, 0) = 0 then raise exception 'PRUEBA políticas · 3: la siembra no deja filas de las dos cuentas (% y %).', ra, rb; end if;
  raise notice 'PRUEBA políticas · 3 en verde: el superadmin ve también las % filas de A y las % de B de resúmenes y descartes.', ra, rb;
end $$;

\echo '>>> 4. Romperla a propósito: las políticas viejas tienen que NO pasar'
do $$
declare r record;
begin
  for r in select * from _politicas loop
    execute format('drop policy %I on public.%I', r.p, r.t);
    execute format('create policy %I on public.%I as permissive for select to %s using (%s)', r.p, r.t, r.roles, r.vieja);
  end loop;
end $$;
select set_config('prueba.fase', 'vieja', true);
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  q text; t0 timestamptz; ms numeric; n int; h text; j text; linea text; ok boolean;
begin
  -- La consulta de la función con sus parámetros puestos: el plan de dentro,
  -- no el «Function Scan» de fuera.
  select regexp_replace(replace(replace(replace(p.prosrc,
           'p_company', '''3b34403a-a7d6-4a48-a8d7-737e8cababdc''::uuid'), 'p_desde', '''2026-11-01''::date'), 'p_hasta', '''2026-11-30''::date'), ';\s*$', '')
    into q from pg_proc p where p.oid = 'public.conta_dias_por_asentar(uuid, date, date)'::regprocedure;
  perform count(*) from public.conta_dias_por_asentar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-11-01', '2026-11-30');  -- en caliente
  t0 := clock_timestamp();
  select count(*), md5(string_agg(x::text, ',' order by x::text)) into n, h
    from public.conta_dias_por_asentar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-11-01', '2026-11-30') x;
  ms := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
  execute 'explain (analyze, buffers, verbose, format json) ' || q into j;
  raise notice '--- explain (analyze, buffers), fase vieja ---';
  for linea in execute 'explain (analyze, buffers) ' || q loop raise notice '%', linea; end loop;
  ok := ms < 1000 and j like '%InitPlan%' and j like '%current_user_account_ids%' and j not like '%belongs_to_account%';
  perform set_config('prueba.vieja', json_build_object('ms', ms, 'dias', n, 'huella', h, 'ok', ok,
    'initplan', j like '%InitPlan%', 'belongs', j like '%belongs_to_account%')::text, true);
  raise notice 'PRUEBA políticas · fase vieja: conta_dias_por_asentar de noviembre en % ms, % días por asentar; InitPlan %, belongs_to_account en el plan %.',
    ms, n, j like '%InitPlan%', j like '%belongs_to_account%';
end $$;
reset role;
do $$
declare v jsonb := current_setting('prueba.vieja')::jsonb; n jsonb := current_setting('prueba.nueva')::jsonb;
begin
  if (v->>'ok')::boolean then
    raise exception 'PRUEBA políticas · 4: con las políticas VIEJAS también pasa (% ms): la prueba no distingue.', v->>'ms';
  end if;
  if v->>'huella' is distinct from n->>'huella' then
    raise exception 'PRUEBA políticas · 4: las viejas dan otro resultado (% días contra %).', v->>'dias', n->>'dias';
  end if;
  raise notice 'PRUEBA políticas · 4 en verde: con las viejas NO pasa (% ms, belongs_to_account en el plan %); con las nuevas % ms. Mismo resultado: % días.',
    v->>'ms', v->>'belongs', n->>'ms', v->>'dias';
end $$;

rollback;
