-- supabase/staging/sql/20261112_dl1_cloudtown_enero_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · Cloudtown, enero de Carabanchel (1451). Todo
-- en una transacción con ROLLBACK, en la cuenta A, con cuentas de mentira si no
-- las tiene. Recorre el camino de producción (las funciones), no solo el «sin
-- Foodint». Nombra lo que añade: _dl1_asiento_iva.
--   1. Sin Foodint, la 1451 entra sin error y no deja nada.
--   2. Una factura recibida a 01/10: la 600 por la base en su local, una 472 por
--      tipo con su base y el libro de recibidas (deducible), la 400 con su
--      tercero y la 769 por el céntimo; se valida como la persona.
--   3. Un cruce de cuentas sin IVA en un mes cerrado por el corte: se valida.
--   4. Una línea con IVA que no dice su libro: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 Cloudtown enero: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda corre como el dueño; dentro, _dl1_validar pone el usuario de la persona.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
\i supabase/migrations/20261106T2213_dl1_adleta_liquidacion.sql
create temp table _antes on commit drop as select count(*) n from public.journal_entry where created_by_name = 'Julio (tanda DL1)';
\i supabase/migrations/20261112T1451_dl1_cloudtown_enero.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record; v_admin uuid; l1 uuid; v_t10 uuid; v_t21 uuid;
  e1 uuid; e2 uuid; v_n int; v_err text; v_party uuid;
begin
  -- 1. Sin Foodint, nada.
  if (select count(*) from public.journal_entry where created_by_name = 'Julio (tanda DL1)') <> (select n from _antes) then
    raise exception 'PRUEBA DL1 Cloudtown enero 1: sin Foodint, la 1451 ha dejado algún asiento.';
  end if;

  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  select id into l1 from public.locations where account_id = v_acc order by id limit 1;
  select id into v_party from public.party where account_id = v_acc order by created_at, id limit 1;
  if c is null or v_admin is null or l1 is null then raise exception 'PRUEBA DL1 Cloudtown enero: a la cuenta A le falta empresa, administrador o local.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-01' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  for x in select * from (values ('60000099', '600'), ('47200099', '472'), ('40000099', '4000'), ('76900099', '769'), ('43000096', '4300'), ('67800099', '678')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 Cloudtown ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  select id into v_t10 from public.tax_rate where code = 'iva_reducido' and account_id is null and company_id is null order by valid_from desc limit 1;
  select id into v_t21 from public.tax_rate where code = 'iva_general' and account_id is null and company_id is null order by valid_from desc limit 1;
  if not exists (select 1 from public.fiscal_period_lock where company_id = c and month = date '2026-03-01') then
    insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind)
    select v_acc, c, fy.id, date '2026-03-01', 'migrated' from public.fiscal_year fy where fy.company_id = c and date '2026-03-01' between fy.starts_on and fy.ends_on;
  end if;

  -- 2. Una recibida.
  e1 := public._dl1_asiento_iva(c, date '2026-10-01', 2, 'PRUEBA Factura de stock FV-0 · apuntada el 01/10', 'PRUEBA',
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000099', 'debe', 300.00, 'local', l1, 'documento', 'FV-0'),
      jsonb_build_object('cuenta', '47200099', 'debe', 10.00, 'local', l1, 'documento', 'FV-0', 'iva', jsonb_build_object('tipo', v_t10, 'base', 100.00, 'libro', 'received')),
      jsonb_build_object('cuenta', '47200099', 'debe', 42.00, 'local', l1, 'documento', 'FV-0', 'iva', jsonb_build_object('tipo', v_t21, 'base', 200.00, 'libro', 'received')),
      jsonb_build_object('cuenta', '40000099', 'haber', 351.99, 'local', l1, 'tercero', v_party, 'documento', 'FV-0'),
      jsonb_build_object('cuenta', '76900099', 'haber', 0.01, 'local', l1, 'documento', 'FV-0')));
  if (select count(*) from public.journal_line where entry_id = e1 and vat_book = 'received' and vat_deductible = 'yes' and tax_rate_id in (v_t10, v_t21)) <> 2
     or not exists (select 1 from public.journal_line jl join public.company_account a on a.id = jl.company_account_id where jl.entry_id = e1 and a.code = '40000099' and jl.document_ref = 'FV-0' and jl.credit = 351.99) then
    raise exception 'PRUEBA DL1 Cloudtown enero 2: las 472 no van al libro de recibidas, deducibles, o la 400 no lleva su documento.';
  end if;

  -- 3. Un cruce sin IVA en el mes cerrado.
  e2 := public._dl1_asiento_iva(c, date '2026-03-09', 4, 'PRUEBA de la 678 a la 430', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '43000096', 'debe', 50.00, 'documento', '4/0'),
                      jsonb_build_object('cuenta', '67800099', 'haber', 50.00, 'documento', '4/0')));
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(
    jsonb_build_object('id', e1, 'importe', 352.00), jsonb_build_object('id', e2, 'importe', 50.00)));
  if v_n <> 2 or (select count(*) from public.journal_entry where id in (e1, e2) and status = 'validado' and validated_by = v_admin) <> 2 then
    raise exception 'PRUEBA DL1 Cloudtown enero 2/3: no se han validado los dos como la persona.';
  end if;

  -- 4. IVA sin libro.
  begin
    perform public._dl1_asiento_iva(c, date '2026-10-02', 2, 'PRUEBA sin libro', 'PRUEBA',
      jsonb_build_array(jsonb_build_object('cuenta', '47200099', 'debe', 10.00, 'iva', jsonb_build_object('tipo', v_t10, 'base', 100.00)),
                        jsonb_build_object('cuenta', '40000099', 'haber', 10.00)));
    raise exception 'PRUEBA DL1 Cloudtown enero 4: ha aceptado una línea de IVA sin libro.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no dice su libro' then raise; end if;
  end;
end $$;

select 'PRUEBA DL1 Cloudtown enero: en verde' as resultado;
rollback;
