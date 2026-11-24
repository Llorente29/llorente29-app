-- supabase/staging/sql/20261113_dl1_qbo_apertura_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · apertura de QBO (1035). Todo en una
-- transacción con ROLLBACK, en la cuenta A. La 1035 no añade objetos: apunta
-- con _dl1_asiento_iva (1451) y valida con _dl1_validar (1750).
--   1. Sin Foodint, la migración no hace nada (la cuenta A sigue igual).
--   2. Un asiento como el de la tanda (a 01/01, Debe 410 con su tercero /
--      Haber 113, sin IVA, en un mes cerrado por el corte) se valida como la persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 QBO: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: las funciones solo las llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona al validar.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
\i supabase/migrations/20261112T1451_dl1_cloudtown_enero.sql
create temp table prueba_antes on commit drop as select count(*) n from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a';
\i supabase/migrations/20261113T1035_dl1_qbo_apertura.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_admin uuid; x record; v_id uuid; v_n int;
begin
  if (select count(*) from public.journal_entry where account_id = v_acc) <> (select n from prueba_antes) then
    raise exception 'PRUEBA DL1 QBO 1: sin Foodint la migración ha apuntado algo en la cuenta A.';
  end if;
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if c is null or v_admin is null then raise exception 'PRUEBA DL1 QBO: a la cuenta A le falta empresa o administrador.'; end if;
  if not exists (select 1 from public.fiscal_year where company_id = c and date '2026-01-01' between starts_on and ends_on) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  end if;
  for x in select * from (values ('41000098', '4100'), ('11300098', '113')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  if not exists (select 1 from public.fiscal_period_lock where company_id = c and month = date '2026-01-01') then
    insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind)
    select v_acc, c, fy.id, date '2026-01-01', 'migrated' from public.fiscal_year fy where fy.company_id = c and date '2026-01-01' between fy.starts_on and fy.ends_on;
  end if;
  v_id := public._dl1_asiento_iva(c, date '2026-01-01', 4, 'PRUEBA saldo de apertura sin respaldo', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '41000098', 'debe', 145.20), jsonb_build_object('cuenta', '11300098', 'haber', 145.20)));
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 145.20)));
  if v_n <> 1 or (select status from public.journal_entry where id = v_id) <> 'validado' then
    raise exception 'PRUEBA DL1 QBO 2: el asiento a 01/01 no se ha validado.';
  end if;
end $$;

select 'PRUEBA DL1 QBO: en verde' as resultado;
rollback;
