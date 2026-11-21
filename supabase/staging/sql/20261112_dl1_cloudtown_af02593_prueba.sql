-- supabase/staging/sql/20261112_dl1_cloudtown_af02593_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · Cloudtown AF-02593 (1421). Todo en una
-- transacción con ROLLBACK, en la cuenta A, con cuentas de mentira si no las
-- tiene. La 1421 no añade funciones: en una base sin Foodint no hace nada, y la
-- prueba recorre su mismo camino (_dl1_venta_proponer y _dl1_validar) con un
-- asiento de la misma forma:
--   1. La 1421 entra sin error y, sin Foodint, no deja ningún asiento.
--   2. Una autofactura a 01/10: la 430 por el total, la 705 por la base en un
--      local, la 477 con su tipo, su base y el libro de emitidas; se propone,
--      se valida como la persona y la 430 sube el total.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 Cloudtown: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la tanda corre como el dueño; dentro, _dl1_validar pone el usuario de la persona.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
create temp table _antes on commit drop as select count(*) n from public.journal_entry where concept ilike '%AF-02593%';
\i supabase/migrations/20261112T1421_dl1_cloudtown_af02593.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record; v_admin uuid; v_tipo uuid; l1 uuid; e1 uuid; v_n int;
begin
  -- 1. Sin Foodint, la 1421 no deja nada.
  if (select count(*) from public.journal_entry where concept ilike '%AF-02593%') <> (select n from _antes) then
    raise exception 'PRUEBA DL1 Cloudtown 1: sin Foodint, la 1421 ha dejado algún asiento.';
  end if;

  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  select id into l1 from public.locations where account_id = v_acc order by id limit 1;
  if c is null or v_admin is null or l1 is null then raise exception 'PRUEBA DL1 Cloudtown: a la cuenta A le falta empresa, administrador o local.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-01' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  for x in select * from (values ('43000097', '4300'), ('70500098', '705'), ('47700098', '477')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 Cloudtown ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  select id into v_tipo from public.tax_rate where code = 'iva_reducido' and account_id is null and company_id is null order by valid_from desc limit 1;

  -- 2. La misma forma que la AF-02593.
  e1 := public._dl1_venta_proponer(c, date '2026-10-01', 1, 'PRUEBA Autofactura Cloudtown AF-0 · febrero 2026 · apuntada el 01/10', 'PRUEBA',
    jsonb_build_array(
      jsonb_build_object('cuenta', '43000097', 'debe', 110.00, 'documento', 'AF-0'),
      jsonb_build_object('cuenta', '70500098', 'haber', 100.00, 'local', l1, 'documento', 'AF-0'),
      jsonb_build_object('cuenta', '47700098', 'haber', 10.00, 'documento', 'AF-0', 'iva', jsonb_build_object('tipo', v_tipo, 'base', 100.00))));
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', e1, 'importe', 110.00)));
  if v_n <> 1 or (select status from public.journal_entry where id = e1) <> 'validado'
     or (select validated_by from public.journal_entry where id = e1) <> v_admin then
    raise exception 'PRUEBA DL1 Cloudtown 2: no se ha validado como la persona.';
  end if;
  if (select count(*) from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
       where jl.entry_id = e1 and ((a.code = '43000097' and jl.debit = 110.00) or (a.code = '70500098' and jl.credit = 100.00 and jl.location_id = l1)
                                   or (a.code = '47700098' and jl.credit = 10.00 and jl.tax_rate_id = v_tipo and jl.tax_base = 100.00 and jl.vat_book = 'issued'))) <> 3 then
    raise exception 'PRUEBA DL1 Cloudtown 2: las líneas no son 430 110 / 705 100 en su local / 477 10 con su IVA.';
  end if;
end $$;

select 'PRUEBA DL1 Cloudtown: en verde' as resultado;
rollback;
