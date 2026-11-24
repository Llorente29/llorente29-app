-- supabase/staging/sql/20261113_dl1_compensaciones_a_31_10_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · compensaciones a 31/10 (1500). Todo en una
-- transacción con ROLLBACK, en la cuenta A. La 1500 no añade objetos: anula con
-- _dl1_anular (0205), propone con _journal_entry_proponer, apunta con
-- _dl1_asiento_iva (1451) y valida con _dl1_validar (1750).
--   1. Sin Foodint, la migración no hace nada (la cuenta A sigue igual).
--   2. Un asiento validado de compensación (Debe 410 / Haber 430) se anula en su
--      misma fecha, y el contraasiento sale con esa fecha.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 compensaciones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: las funciones solo las llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona al validar y anular.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
\i supabase/migrations/20261112T1451_dl1_cloudtown_enero.sql
\i supabase/migrations/20261113T0205_dl1_glovo_devoluciones.sql
create temp table prueba_antes on commit drop as select count(*) n from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a';
\i supabase/migrations/20261113T1500_dl1_compensaciones_a_31_10.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_admin uuid; x record; v_id uuid; v_n int; v_r jsonb;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  if (select count(*) from public.journal_entry where account_id = v_acc) <> (select n from prueba_antes) then
    raise exception 'PRUEBA DL1 compensaciones 1: sin Foodint la migración ha apuntado algo en la cuenta A.';
  end if;
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if c is null or v_admin is null then raise exception 'PRUEBA DL1 compensaciones: a la cuenta A le falta empresa o administrador.'; end if;
  if not exists (select 1 from public.fiscal_year where company_id = c and v_hoy between starts_on and ends_on) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, c, extract(year from v_hoy)::text, date_trunc('year', v_hoy)::date, (date_trunc('year', v_hoy) + interval '1 year - 1 day')::date);
  end if;
  for x in select * from (values ('41000097', '4100'), ('43000097', '4300')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  v_id := public._dl1_asiento_iva(c, v_hoy, 4, 'PRUEBA compensación en bloque', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '41000097', 'debe', 12.34), jsonb_build_object('cuenta', '43000097', 'haber', 12.34)));
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 12.34)));
  if v_n <> 1 then raise exception 'PRUEBA DL1 compensaciones 2: el bloque no se ha validado.'; end if;
  v_r := public._dl1_anular(c, v_admin, 'Persona de prueba', v_id, 'PRUEBA', v_hoy);
  if (select status from public.journal_entry where id = v_id) <> 'anulado' or (v_r->>'fecha')::date <> v_hoy then
    raise exception 'PRUEBA DL1 compensaciones 2: el bloque no queda anulado con contraasiento en su fecha.';
  end if;
end $$;

select 'PRUEBA DL1 compensaciones: en verde' as resultado;
rollback;
