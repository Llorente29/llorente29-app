-- supabase/staging/sql/20261112_dl1_glovo_compensaciones_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · compensaciones de Glovo (1958). Todo en una
-- transacción con ROLLBACK, en la cuenta A. La 1958 no añade objetos: valida
-- asientos que ya existen con _dl1_validar (de la 1750). Recorre:
--   1. Sin Foodint, la migración no hace nada (la cuenta A sigue igual).
--   2. Una compensación propuesta como las de Glovo (Debe 410 / Haber 430, sin
--      IVA) se valida como la persona.
--   3. Si su importe no es el esperado, no se valida nada.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 Glovo: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: las funciones solo las llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona al validar.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
create temp table prueba_antes on commit drop as select count(*) n, count(*) filter (where status = 'validado') v from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a';
\i supabase/migrations/20261112T1958_dl1_glovo_compensaciones.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; v_admin uuid; x record; v_id uuid; v_n int; v_err text;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  -- 1. Sin Foodint, nada.
  if (select count(*) from public.journal_entry where account_id = v_acc) <> (select n from prueba_antes)
     or (select count(*) from public.journal_entry where account_id = v_acc and status = 'validado') <> (select v from prueba_antes) then
    raise exception 'PRUEBA DL1 Glovo 1: sin Foodint la migración ha cambiado algo en la cuenta A.';
  end if;

  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if c is null or v_admin is null then raise exception 'PRUEBA DL1 Glovo: a la cuenta A le falta empresa o administrador.'; end if;
  select id into y from public.fiscal_year where company_id = c and v_hoy between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, c, extract(year from v_hoy)::text, date_trunc('year', v_hoy)::date, (date_trunc('year', v_hoy) + interval '1 year - 1 day')::date);
  end if;
  for x in select * from (values ('41000098', '4100'), ('43000098', '4300')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;

  -- 2. Una compensación propuesta, validada como la persona.
  v_id := public._dl1_venta_proponer(c, v_hoy, 4, 'PRUEBA Liquidación Glovo · compensación', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '41000098', 'debe', 25.19), jsonb_build_object('cuenta', '43000098', 'haber', 25.19)));
  -- 3. Con otro importe, no se valida nada.
  begin
    perform public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 25.20)));
    raise exception 'PRUEBA DL1 Glovo 3: se ha validado con un importe que no es el suyo.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'se esperaba' then raise; end if;
  end;
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_id, 'importe', 25.19)));
  if v_n <> 1 or (select status from public.journal_entry where id = v_id) <> 'validado'
     or (select validated_by from public.journal_entry where id = v_id) <> v_admin then
    raise exception 'PRUEBA DL1 Glovo 2: la compensación no se ha validado como la persona.';
  end if;
end $$;

select 'PRUEBA DL1 Glovo: en verde' as resultado;
rollback;
