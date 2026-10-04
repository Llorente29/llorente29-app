-- supabase/staging/sql/20261007_c02_prueba_plan.sql
--
-- C02, tarea 3 · Prueba de la 0120 en staging-conta, con el JWT de verdad de
-- los administradores de A y de B (pasa por la RLS). Termina en ROLLBACK.
-- Los códigos esperados son los mismos que da el núcleo
-- (tests/unit/modules/conta/planEmpresaC02.test.ts) con las mismas entradas.
--
--   1. A (península): 615 hojas, 472/477 para 21, 10 y 4, 57200001 para su
--      banco; sus 4 proveedores de mercancía o sin tipo de gasto en
--      40000001…40000004 y el de alquiler en 41000001 (0130, 400 o 410);
--      43000000 común.
--   2. Coherencia: retenciones a 47510000, alquiler a 62100000; una cuenta
--      enlazada no se oculta; una libre sí; un tercero no comparte subcuenta.
--   3. Añadir subcuenta: la siguiente libre; renumerar 8 → 10.
--   4. Activar dos veces no se puede.
--   5. B (Canarias): IGIC; el 0 % va a la hoja. Y B no puede tocar el plan de A.
--   6. Vuelta atrás.

begin;

\echo '>>> 1-4. Como el administrador de A'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  r jsonb; v text; n int; fallo text;
begin
  r := public.company_chart_activate(emp, false, 'Prueba C02');
  raise notice 'PRUEBA C02 · activar A: %', r;
  if (r->>'cuentas')::int <> 615 then raise exception 'PRUEBA C02: A tiene % hojas (esperado 615)', r->>'cuentas'; end if;

  select string_agg(code, ' ' order by code) into v from public.company_account where company_id = emp and kind = 'own' and template_code in ('472', '477');
  if v is distinct from '47200004 47200010 47200021 47700004 47700010 47700021' then raise exception 'PRUEBA C02: IVA de A = %', v; end if;
  select string_agg(code, ' ' order by code) into v from public.company_account where company_id = emp and kind = 'own' and template_code = '572';
  if v is distinct from '57200001' then raise exception 'PRUEBA C02: bancos de A = %', v; end if;
  select string_agg(code, ' ' order by code) into v from public.company_account where company_id = emp and kind = 'own' and template_code = '4000';
  if v is distinct from '40000001 40000002 40000003 40000004' then raise exception 'PRUEBA C02: proveedores de A = %', v; end if;
  select string_agg(code || ' ' || name, ' | ' order by code) into v from public.company_account where company_id = emp and kind = 'own' and template_code = '4100';
  if v is distinct from '41000001 Acreedores · Locales del Norte (alquiler)' then raise exception 'PRUEBA C02: acreedores de A = %', v; end if;
  if (select supplier_account_leaf from public.expense_category where is_system and code = 'rent') <> '4100' then raise exception 'PRUEBA C02: el alquiler no va a 4100'; end if;
  if not (select is_common from public.company_account where company_id = emp and code = '43000000') then raise exception 'PRUEBA C02: 43000000 no es la común'; end if;
  if exists (select 1 from public.company_account where company_id = emp and template_code = '4300' and kind = 'own') then raise exception 'PRUEBA C02: hay subcuentas de 430 (D5)'; end if;

  -- 2. Enlaces y coherencia.
  select string_agg(distinct a.code, ' ') into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = emp and l.entity = 'withholding_rate';
  if v is distinct from '47510000' then raise exception 'PRUEBA C02: retenciones a %', v; end if;
  select a.code into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
    join public.expense_category g on g.id::text = l.entity_id where l.company_id = emp and g.code = 'rent' and g.is_system;
  if v is distinct from '62100000' then raise exception 'PRUEBA C02: alquiler a %', v; end if;
  begin
    perform public.company_account_set_hidden((select id from public.company_account where company_id = emp and code = '62100000'), true);
    raise exception 'PRUEBA C02: se ha ocultado una cuenta enlazada';
  exception when check_violation then fallo := sqlerrm; end;
  raise notice 'PRUEBA C02 · ocultar enlazada: %', fallo;
  perform public.company_account_set_hidden((select id from public.company_account where company_id = emp and code = '68100000'), true);
  if (select status from public.company_account where company_id = emp and code = '68100000') <> 'oculta' then raise exception 'PRUEBA C02: no se oculta una libre'; end if;
  begin
    perform public.company_account_link_set(emp, 'supplier', 'otro-proveedor', 'principal', (select id from public.company_account where company_id = emp and code = '40000001'));
    raise exception 'PRUEBA C02: dos terceros comparten subcuenta';
  exception when unique_violation then fallo := sqlerrm; end;
  raise notice 'PRUEBA C02 · enlace doble: %', fallo;

  -- 3. Añadir y renumerar.
  r := public.company_account_add(emp, '4000', 'Proveedor nuevo', 'Lo que le compras', null, null, 'Prueba C02');
  if r->>'code' <> '40000005' then raise exception 'PRUEBA C02: la nueva es %', r->>'code'; end if;
  r := public.company_chart_set_digits(emp, 10, 'Prueba C02');
  if (select string_agg(code, ' ' order by code) from public.company_account where company_id = emp and code in ('4000000005', '4720000021', '4700000000', '5720000001', '4100000001')) is distinct from '4000000005 4100000001 4700000000 4720000021 5720000001' then
    raise exception 'PRUEBA C02: el renumerado no da lo esperado';
  end if;
  if exists (select 1 from public.company_account where company_id = emp and length(code) <> 10) then raise exception 'PRUEBA C02: quedan cuentas sin renumerar'; end if;
  if (select account_digits from public.company_tax_profile where company_id = emp) <> 10 then raise exception 'PRUEBA C02: la longitud no ha cambiado'; end if;
  begin
    perform public.company_chart_set_digits(emp, 5);
    raise exception 'PRUEBA C02: se ha aceptado 5 dígitos';
  exception when invalid_parameter_value then fallo := sqlerrm; end;

  -- 4. Dos veces no.
  begin
    perform public.company_chart_activate(emp);
    raise exception 'PRUEBA C02: se ha activado dos veces';
  exception when unique_violation then fallo := sqlerrm; end;
  select count(*) into n from public.company_account_log where company_id = emp;
  raise notice 'PRUEBA C02 · 1-4 en verde (% entradas en el registro)', n;
end $$;
reset role;

\echo '>>> 5. Como el administrador de B'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  emp constant uuid := '7e35fa0e-65aa-4a96-86e6-de9a2317c0f6';
  r jsonb; v text; fallo text;
begin
  r := public.company_chart_activate(emp, true, 'Prueba C02');
  select string_agg(code, ' ' order by code) into v from public.company_account where company_id = emp and kind = 'own' and template_code = '472';
  if v is distinct from '47200003 47200005 47200007 47200015 47200020 47200095' then raise exception 'PRUEBA C02: IGIC de B = %', v; end if;
  select string_agg(a.code, ' ' order by a.code) into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
    join public.tax_rate t on t.id::text = l.entity_id where l.company_id = emp and t.code = 'igic_cero';
  if v is distinct from '47200000 47700000' then raise exception 'PRUEBA C02: IGIC cero a %', v; end if;
  -- Cuenta común de proveedores: todos a 40000000, ninguna subcuenta.
  if exists (select 1 from public.company_account where company_id = emp and template_code in ('4000', '4100') and kind = 'own') then raise exception 'PRUEBA C02: B pidió cuenta común y tiene subcuentas'; end if;
  select string_agg(distinct a.code, ' ' order by a.code) into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = emp and l.entity = 'supplier';
  if v is distinct from '40000000 41000000' then raise exception 'PRUEBA C02: los proveedores de B van a % (esperado las dos comunes)', v; end if;
  -- B no ve ni toca el plan de A.
  if exists (select 1 from public.company_account where account_id = 'c01a0000-0000-4000-8000-00000000000a') then raise exception 'PRUEBA C02: B ve cuentas de A'; end if;
  begin
    perform public.company_account_add('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '4000', 'Intruso');
    raise exception 'PRUEBA C02: B ha añadido una cuenta en A';
  exception when insufficient_privilege then fallo := sqlerrm; end;
  begin
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values ('c01b0000-0000-4000-8000-00000000000b', emp, 'pymes', '40009999', '4000', 'Directo', 'own', 'manual');
    raise exception 'PRUEBA C02: se escribe en company_account sin la función';
  exception when insufficient_privilege then fallo := sqlerrm; end;
  raise notice 'PRUEBA C02 · 5 en verde';
end $$;
reset role;

\echo '>>> 6. Vuelta atrás (0130 y luego 0120)'
\ir ../../vuelta-atras/20261007T0130_c02_proveedor_400_410.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_name = 'expense_category' and column_name = 'supplier_account_leaf') then
    raise exception 'PRUEBA C02: la vuelta atrás de la 0130 no quita la marca';
  end if;
end $$;
\ir ../../vuelta-atras/20261007T0120_c02_plan_empresa.down.sql
do $$ begin
  if to_regclass('public.company_account') is not null then raise exception 'PRUEBA C02: la vuelta atrás no quita company_account'; end if;
  raise notice 'PRUEBA C02 · 6 en verde';
end $$;

rollback;
