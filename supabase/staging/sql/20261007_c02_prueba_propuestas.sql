-- supabase/staging/sql/20261007_c02_prueba_propuestas.sql
--
-- C02, tarea 5 · Prueba de la 0180 en staging-conta, con el JWT de verdad de
-- los administradores de A y de B (pasa por la RLS). Termina en ROLLBACK:
-- lo que se crea aquí (un proveedor y un tipo de IVA de prueba) no se queda.
--
--   1. Aceptar «¿Le creo la suya?»: subcuenta y enlace con origen IA aceptada,
--      en el registro, y la respuesta guardada. Contestar otra vez, no.
--   2. Rechazar: se guarda y no hace nada.
--   3. Todo o nada: si una operación falla (código ocupado), no queda ninguna.
--      Un código de otra hoja o de otra longitud, no.
--   4. Ocultar: una enlazada no (guarda de la 0120); una libre sí, con registro.
--   5. company_chart_activate nombra el IVA con el tipo («7,5 %», no «75 %»).
--   6. B no contesta propuestas de A.
--   7. Vuelta atrás.

begin;

\echo '>>> 0. Datos de prueba (dentro del ROLLBACK): un proveedor sin subcuenta y un tipo al 7,5 %'
insert into public.supplier (id, account_id, name, expense_category_id)
values ('c02c0180-0000-4000-8000-000000000001', 'c01a0000-0000-4000-8000-00000000000a', 'Proveedor de Prueba Propuesta',
        (select id from public.expense_category where code = 'food_beverage' and is_system));
insert into public.tax_rate (account_id, company_id, code, name, tax_system, territory, rate, valid_from)
values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'prueba_75', 'IVA de prueba 7,5', 'iva', 'peninsula_baleares', 7.5, '2026-01-01');

\echo '>>> 1-4. Como el administrador de A'
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  prov constant text := 'c02c0180-0000-4000-8000-000000000001';
  r jsonb; v text; n int; fallo text;
begin
  if not exists (select 1 from public.company_account where company_id = emp) then
    perform public.company_chart_activate(emp, false, 'prueba 0180');
  end if;

  -- 1
  r := public.company_plan_propuesta_responder(emp, 'prueba:proveedores:' || prov, 'Tienes 1 proveedor nuevo que no tiene subcuenta. ¿Le creo la suya en el 400?',
         'Proveedor de Prueba Propuesta → 4000xxxx. Así tiene su extracto.', 'alta', true,
         jsonb_build_array(jsonb_build_object('op', 'crear', 'hoja', '4000', 'nombre', 'Proveedores · Proveedor de Prueba Propuesta', 'entity', 'supplier', 'entity_id', prov)), 'prueba');
  if (r ->> 'hechas')::int <> 1 then raise exception 'PRUEBA C02 0180: % operaciones (se esperaba 1)', r ->> 'hechas'; end if;
  select a.code into v from public.company_account_link l join public.company_account a on a.id = l.company_account_id
   where l.company_id = emp and l.entity = 'supplier' and l.entity_id = prov and l.role = 'principal' and l.source = 'ai_accepted' and a.source = 'ai_accepted' and a.template_code = '4000';
  if v is null then raise exception 'PRUEBA C02 0180: el proveedor no tiene su subcuenta con origen IA aceptada'; end if;
  if not exists (select 1 from public.company_account_log where company_id = emp and code = v and que = 'subcuenta_creada' and source = 'ai_accepted') then
    raise exception 'PRUEBA C02 0180: la subcuenta % no está en el registro como IA aceptada', v;
  end if;
  if not exists (select 1 from public.ai_suggestion where company_id = emp and kind = 'plan' and reason_key = 'prueba:proveedores:' || prov and status = 'accepted' and payload ->> 'confianza' = 'alta') then
    raise exception 'PRUEBA C02 0180: la respuesta no está guardada';
  end if;
  begin
    perform public.company_plan_propuesta_responder(emp, 'prueba:proveedores:' || prov, 't', 'p', 'alta', true, '[{"op":"ocultar","code":"62900000"}]', 'prueba');
    raise exception 'PRUEBA C02 0180: se ha contestado dos veces';
  exception when check_violation then fallo := sqlerrm; end;

  -- 2
  select count(*) into n from public.company_account where company_id = emp;
  r := public.company_plan_propuesta_responder(emp, 'prueba:rechazada', '¿La oculto?', 'Sin uso.', 'media', false, '[{"op":"ocultar","code":"62900000"}]', 'prueba');
  if (select count(*) from public.company_account where company_id = emp) <> n
     or (select status from public.company_account where company_id = emp and code = '62900000') <> 'activa'
     or not exists (select 1 from public.ai_suggestion where company_id = emp and reason_key = 'prueba:rechazada' and status = 'rejected') then
    raise exception 'PRUEBA C02 0180: rechazar ha hecho algo o no se ha guardado';
  end if;

  -- 3
  begin
    perform public.company_plan_propuesta_responder(emp, 'prueba:todo-o-nada', '¿Las creo?', 'Tipo nuevo.', 'alta', true,
      '[{"op":"crear","hoja":"472","code":"47200075","nombre":"IVA soportado 7,5 %"},{"op":"crear","hoja":"472","code":"47200021","nombre":"Repetida"}]', 'prueba');
    raise exception 'PRUEBA C02 0180: ha creado una cuenta repetida';
  exception when unique_violation then fallo := sqlerrm; end;
  if exists (select 1 from public.company_account where company_id = emp and code = '47200075')
     or exists (select 1 from public.ai_suggestion where company_id = emp and reason_key = 'prueba:todo-o-nada') then
    raise exception 'PRUEBA C02 0180: no es todo o nada (quedó la 47200075 o la respuesta)';
  end if;
  begin
    perform public.company_plan_propuesta_responder(emp, 'prueba:otra-hoja', 't', 'p', 'alta', true, '[{"op":"crear","hoja":"472","code":"47700075","nombre":"x"}]', 'prueba');
    raise exception 'PRUEBA C02 0180: una 477 colgada de la 472';
  exception when invalid_parameter_value then fallo := sqlerrm; end;
  begin
    perform public.company_plan_propuesta_responder(emp, 'prueba:otra-longitud', 't', 'p', 'alta', true, '[{"op":"crear","hoja":"472","code":"4720075","nombre":"x"}]', 'prueba');
    raise exception 'PRUEBA C02 0180: un código de otra longitud';
  exception when invalid_parameter_value then fallo := sqlerrm; end;

  -- 4
  begin
    perform public.company_plan_propuesta_responder(emp, 'prueba:ocultar-enlazada', 't', 'p', 'alta', true, jsonb_build_array(jsonb_build_object('op', 'ocultar', 'code', v)), 'prueba');
    raise exception 'PRUEBA C02 0180: ha ocultado una cuenta enlazada';
  exception when others then
    if sqlerrm like 'PRUEBA%' then raise; end if;
    fallo := sqlerrm;
  end;
  r := public.company_plan_propuesta_responder(emp, 'prueba:ocultar-libre', '¿La oculto?', 'Sin uso.', 'alta', true, '[{"op":"ocultar","code":"62900000"}]', 'prueba');
  if (select status from public.company_account where company_id = emp and code = '62900000') <> 'oculta'
     or not exists (select 1 from public.company_account_log where company_id = emp and code = '62900000' and que = 'oculta' and source = 'ai_accepted') then
    raise exception 'PRUEBA C02 0180: no ha ocultado la libre o no está en el registro';
  end if;
  raise notice 'PRUEBA C02 0180 · 1-4 en verde';
end $$;
reset role;

\echo '>>> 5. company_chart_activate nombra el IVA con el tipo (desde cero, dentro del ROLLBACK)'
delete from public.company_account_link where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
delete from public.company_account_log where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
delete from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v text;
begin
  perform public.company_chart_activate('3b34403a-a7d6-4a48-a8d7-737e8cababdc', false, 'prueba 0180');
  select string_agg(code || ' ' || name, ' | ' order by code) into v from public.company_account
   where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code in ('47200075', '47700075', '47200021');
  if v is distinct from '47200021 IVA soportado 21 % | 47200075 IVA soportado 7,5 % | 47700075 IVA repercutido 7,5 %' then
    raise exception 'PRUEBA C02 0180: los nombres del IVA son «%»', v;
  end if;
  raise notice 'PRUEBA C02 0180 · 5 en verde: %', v;
end $$;
reset role;

\echo '>>> 6. Como el administrador de B'
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare fallo text;
begin
  begin
    perform public.company_plan_propuesta_responder('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'prueba:intruso', 't', 'p', 'alta', true, '[{"op":"ocultar","code":"62900000"}]', 'intruso');
    raise exception 'PRUEBA C02 0180: B ha contestado una propuesta de A';
  exception when insufficient_privilege then fallo := sqlerrm; end;
  if exists (select 1 from public.ai_suggestion where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') then
    raise exception 'PRUEBA C02 0180: B ve las respuestas de A';
  end if;
  raise notice 'PRUEBA C02 0180 · 6 en verde';
end $$;
reset role;

\echo '>>> 7. Vuelta atrás de la 0180'
\ir ../../vuelta-atras/20261007T0180_c02_propuestas_plan.down.sql
do $$ begin
  if to_regprocedure('public.company_plan_propuesta_responder(uuid, text, text, text, text, boolean, jsonb, text)') is not null then
    raise exception 'PRUEBA C02 0180: la vuelta atrás no quita la función';
  end if;
  if exists (select 1 from public.ai_suggestion where kind = 'plan') then raise exception 'PRUEBA C02 0180: quedan respuestas de clase plan'; end if;
  if pg_get_functiondef('public.company_chart_activate(uuid, boolean, text)'::regprocedure) not like '%r.suf || '' %''%' then
    raise exception 'PRUEBA C02 0180: company_chart_activate no ha vuelto a la de la 0130';
  end if;
  raise notice 'PRUEBA C02 0180 · 7 en verde';
end $$;

rollback;
