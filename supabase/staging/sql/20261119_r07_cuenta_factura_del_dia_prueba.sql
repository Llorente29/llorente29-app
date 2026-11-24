-- supabase/staging/sql/20261119_r07_cuenta_factura_del_dia_prueba.sql
--
-- SOLO STAGING. R07 · 1405, la cuenta de la factura del día, por empresa, y su vuelta
-- atrás, en una transacción que acaba en ROLLBACK: staging no cambia.
--   1. la tabla se crea dos veces sin error y guarda una cuenta por empresa;
--   2. una segunda fila de la misma empresa no se deja (una por empresa);
--   3. la vuelta atrás la quita, con su fila dentro.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R07 · 1405: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261119T1405_r07_cuenta_factura_del_dia.sql
\i supabase/migrations/20261119T1405_r07_cuenta_factura_del_dia.sql

-- Como la persona de la cuenta del núcleo (semilla K02), en su empresa general: los
-- permisos por fila dejan que una persona de la cuenta la guarde y la lea.
select set_config('request.jwt.claims', json_build_object('sub', 'c0e20000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_a record;
begin
  select a.id, a.account_id, a.company_id into v_a from public.company_account a
   where a.company_id = 'c0e20000-0000-4000-8000-0000000000e2' order by a.code limit 1;
  if v_a.id is null then raise exception 'PRUEBA R07 · 1405: la empresa general del núcleo no tiene ninguna cuenta (semilla K02).'; end if;
  insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id, created_by_name)
  values (v_a.account_id, v_a.company_id, v_a.id, 'Prueba R07');
  if (select count(*) from public.conta_tpv_factura_cuenta where company_id = v_a.company_id) <> 1 then raise exception 'PRUEBA R07 · 1405 · 1: no la lee.'; end if;
  raise notice '1 OK: la persona de la cuenta guarda y lee la cuenta de la factura del día de su empresa.';
  begin
    insert into public.conta_tpv_factura_cuenta (account_id, company_id, company_account_id) values (v_a.account_id, v_a.company_id, v_a.id);
    raise exception 'PRUEBA R07 · 1405 · 2: ha dejado dos cuentas para la misma empresa.';
  exception when unique_violation then raise notice '2 OK: una sola por empresa.';
  end;
end $$;
reset role;

\i supabase/vuelta-atras/20261119T1405_r07_cuenta_factura_del_dia.down.sql
do $$ begin
  if to_regclass('public.conta_tpv_factura_cuenta') is not null then raise exception 'PRUEBA R07 · 1405 · 3: la vuelta atrás no la quita.'; end if;
  raise notice '3 OK: la vuelta atrás la quita. PRUEBA R07 · 1405: 3 de 3 bien.';
end $$;
rollback;
