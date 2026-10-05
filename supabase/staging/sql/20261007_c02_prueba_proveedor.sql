-- supabase/staging/sql/20261007_c02_prueba_proveedor.sql
--
-- C02, tarea 6 · Prueba de la 0160 en staging-conta, con el JWT de verdad de
-- los administradores de A y de B (pasa por la RLS). Termina en ROLLBACK.
--
--   1. Un proveedor de A se paga desde el banco (57200001): antes de la 0160
--      eso chocaba con «un tercero, una subcuenta»; ahora es un papel aparte.
--   2. Sus facturas a la 629 y sus suplidos también; al banco, no (grupo 6).
--      Pagar desde la 629, no (57 o 43).
--   3. El principal sigue siendo uno por cabeza: su cuenta no puede ser la del banco.
--   4. Un proveedor de OTRA cuenta no se enlaza (regla 9).
--   5. Quitar el enlace de sus facturas queda en el registro; el principal no se quita.
--   6. B no toca nada de A.
--   7. Vuelta atrás de la 0160.

begin;

\echo '>>> 1-5. Como el administrador de A'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  prov text; banco uuid; c629 uuid; c600 uuid; fallo text; n int;
begin
  if not exists (select 1 from public.company_account where company_id = emp) then
    perform public.company_chart_activate(emp, false, 'prueba 0160');
  end if;
  select l.entity_id into prov from public.company_account_link l
   where l.company_id = emp and l.entity = 'supplier' and l.role = 'principal' order by l.entity_id limit 1;
  select l.company_account_id into banco from public.company_account_link l
   where l.company_id = emp and l.entity = 'bank_account' and l.role = 'principal' limit 1;
  select id into c629 from public.company_account where company_id = emp and template_code = '629' and kind = 'template';
  select id into c600 from public.company_account where company_id = emp and template_code = '600' and kind = 'template';
  if prov is null or banco is null or c629 is null or c600 is null then
    raise exception 'PRUEBA C02 0160: faltan datos de partida (proveedor %, banco %, 629 %, 600 %)', prov, banco, c629, c600;
  end if;

  -- 1
  perform public.company_account_link_set(emp, 'supplier', prov, 'pago', banco, 'prueba');
  -- 2
  perform public.company_account_link_set(emp, 'supplier', prov, 'gasto', c629, 'prueba');
  perform public.company_account_link_set(emp, 'supplier', prov, 'suplidos', c629, 'prueba');
  begin
    perform public.company_account_link_set(emp, 'supplier', prov, 'gasto', banco, 'prueba');
    raise exception 'PRUEBA C02 0160: sus facturas han ido al banco';
  exception when check_violation then fallo := sqlerrm; end;
  begin
    perform public.company_account_link_set(emp, 'supplier', prov, 'pago', c629, 'prueba');
    raise exception 'PRUEBA C02 0160: se le paga desde una cuenta de gastos';
  exception when check_violation then fallo := sqlerrm; end;
  begin
    perform public.company_account_link_set(emp, 'bank_account', gen_random_uuid()::text, 'pago', banco, 'prueba');
    raise exception 'PRUEBA C02 0160: un banco con papel de proveedor';
  exception when check_violation then fallo := sqlerrm; end;
  -- 3
  begin
    perform public.company_account_link_set(emp, 'supplier', prov, 'principal', banco, 'prueba');
    raise exception 'PRUEBA C02 0160: la cuenta del banco es ahora la del proveedor';
  exception when unique_violation then fallo := sqlerrm; end;
  -- 4
  begin
    perform public.company_account_link_set(emp, 'supplier',
      (select id::text from public.supplier where account_id = 'c01b0000-0000-4000-8000-00000000000b' limit 1), 'gasto', c600, 'prueba');
    raise exception 'PRUEBA C02 0160: un proveedor de B enlazado en A';
  exception when check_violation or not_null_violation then fallo := sqlerrm; end;
  -- 5
  perform public.company_account_link_unset(emp, 'supplier', prov, 'gasto', 'prueba');
  select count(*) into n from public.company_account_link where company_id = emp and entity = 'supplier' and entity_id = prov and role = 'gasto';
  if n <> 0 then raise exception 'PRUEBA C02 0160: el enlace de sus facturas sigue'; end if;
  select count(*) into n from public.company_account_log where company_id = emp and que = 'enlace_quitado' and despues->>'entity_id' = prov;
  if n <> 1 then raise exception 'PRUEBA C02 0160: % entradas «enlace_quitado» (se esperaba 1)', n; end if;
  begin
    perform public.company_account_link_unset(emp, 'supplier', prov, 'principal', 'prueba');
    raise exception 'PRUEBA C02 0160: se ha quitado su cuenta';
  exception when invalid_parameter_value then fallo := sqlerrm; end;
  raise notice 'PRUEBA C02 0160 · 1-5 en verde';
end $$;
reset role;

\echo '>>> 6. Como el administrador de B'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare fallo text; n int;
begin
  begin
    perform public.company_account_link_unset('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'supplier', 'x', 'pago', 'intruso');
    raise exception 'PRUEBA C02 0160: B ha quitado un enlace de A';
  exception when insufficient_privilege then fallo := sqlerrm; end;
  select count(*) into n from public.company_account_link where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  if n <> 0 then raise exception 'PRUEBA C02 0160: B ve % enlaces de A', n; end if;
  raise notice 'PRUEBA C02 0160 · 6 en verde';
end $$;
reset role;

\echo '>>> 7. Vuelta atrás de la 0160'
\ir ../../vuelta-atras/20261007T0160_c02_cuentas_del_proveedor.down.sql
do $$ begin
  if exists (select 1 from public.company_account_link where role in ('gasto', 'pago', 'suplidos')) then
    raise exception 'PRUEBA C02 0160: la vuelta atrás deja enlaces propios';
  end if;
  if to_regprocedure('public.company_account_link_unset(uuid, text, text, text, text)') is not null then
    raise exception 'PRUEBA C02 0160: la vuelta atrás no quita company_account_link_unset';
  end if;
  raise notice 'PRUEBA C02 0160 · 7 en verde';
end $$;

rollback;
