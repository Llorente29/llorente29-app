-- supabase/staging/sql/20261114_dl1_glovo_facturas_1t2t_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · Glovo facturas 1T/2T (1210). Todo en una
-- transacción con ROLLBACK, en la cuenta A. La 1210 no añade objetos: crea
-- facturas, apunta con _dl1_asiento_iva (1451) y _journal_entry_proponer, y
-- valida con _dl1_validar (1750).
--   1. Sin Foodint, la migración no hace nada (la cuenta A sigue igual).
--   2. Un asiento de tres líneas (como el de una factura: dos al Debe y una al
--      Haber) se apunta y se valida por la suma del Debe.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 Glovo facturas 1T/2T: esta base tiene cuentas de producción. No se toca nada.';
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
\i supabase/migrations/20261114T1210_dl1_glovo_facturas_1t2t.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_admin uuid; x record; v_id uuid; v_n int;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  if (select count(*) from public.journal_entry where account_id = v_acc) <> (select n from prueba_antes) then
    raise exception 'PRUEBA DL1 Glovo facturas 1T/2T 1: sin Foodint la migración ha apuntado algo en la cuenta A.';
  end if;
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if c is null or v_admin is null then raise exception 'PRUEBA DL1 Glovo facturas 1T/2T: a la cuenta A le falta empresa o administrador.'; end if;
  if not exists (select 1 from public.fiscal_year where company_id = c and v_hoy between starts_on and ends_on) then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, c, extract(year from v_hoy)::text, date_trunc('year', v_hoy)::date, (date_trunc('year', v_hoy) + interval '1 year - 1 day')::date);
  end if;
  for x in select * from (values ('43000097', '4300'), ('70009097', '700'), ('70000097', '700')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.code, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  v_id := public._dl1_asiento_iva(c, v_hoy, 1, 'PRUEBA ventas con promoción', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '43000097', 'debe', 32.25), jsonb_build_object('cuenta', '70009097', 'debe', 43.41),
                      jsonb_build_object('cuenta', '70000097', 'haber', 75.66)));
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 75.66)));
  if v_n <> 1 or (select status from public.journal_entry where id = v_id) <> 'validado' then
    raise exception 'PRUEBA DL1 Glovo facturas 1T/2T 2: el asiento de ventas no se ha validado.';
  end if;
  if (select count(*) from public.journal_line where entry_id = v_id) <> 3 then
    raise exception 'PRUEBA DL1 Glovo facturas 1T/2T 2: el asiento de ventas no tiene sus 3 líneas.';
  end if;
end $$;

select 'PRUEBA DL1 Glovo facturas 1T/2T: en verde' as resultado;
rollback;
