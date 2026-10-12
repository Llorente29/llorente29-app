-- supabase/staging/sql/20261019_diez_importar_prueba.sql
--
-- SOLO STAGING. Prueba de 20261019T0150 (conta_diez_ejercicio,
-- conta_diez_subcuentas, conta_diez_importar, conta_diez_cerrar_ejercicio),
-- con asientos INVENTADOS en la empresa de la cuenta A de pruebas. Todo en una
-- transacción con ROLLBACK: no cambia staging.
--
--   1. Solo service_role ejecuta las cuatro funciones.
--   2. El ejercicio traído se crea una vez; uno de Folvy no se toca.
--   3. Subcuentas: la que falta se da de alta colgando de su hoja; la que está,
--      no se toca; la que no cuelga de nada, se rechaza con su porqué.
--   4. Se traen 2 asientos válidos y se rechazan 4 con su motivo (subcuenta
--      que falta, ejercicio de Folvy, fecha fuera del ejercicio, serie ajena),
--      sin que el rechazo de uno tumbe a los demás.
--   5. Lo traído queda migrated, validado, con el NÚMERO de Diez, su clave,
--      la marca de negativo en su línea y la foto para comparar.
--   6. La cadena de huellas de lo traído es buena (journal_cadena_comprobar).
--   7. Idempotente: traerlo otra vez no duplica; si cambió en Diez, se dice y
--      no se pisa.
--   8. Cerrar el ejercicio traído; después ya no entra nada en él; uno de
--      Folvy no se cierra por aquí.

begin;

do $$
declare
  c constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';   -- empresa de la cuenta A de pruebas
  v_run uuid; v_y uuid; v_y2 uuid; r jsonb; v_ok boolean; v_n int; v_e public.journal_entry; v_txt text;
  f text;
  a_bien jsonb := jsonb_build_object('ejercicio', '2024', 'serie', 2, 'numero', 5, 'fecha', '2024-03-01', 'concepto', 'Factura inventada',
    'tipoAsiento', 2, 'huella', 'h-a', 'lineas', jsonb_build_array(
      jsonb_build_object('posicion', 1, 'cuenta', '60000000', 'debe', 10000, 'haber', 0, 'negativoEnDiez', null),
      jsonb_build_object('posicion', 2, 'cuenta', '47200000', 'debe', 2100, 'haber', 0, 'negativoEnDiez', 'haber'),
      jsonb_build_object('posicion', 3, 'cuenta', '40000901', 'debe', 0, 'haber', 12100, 'negativoEnDiez', null)));
  b_bien jsonb := jsonb_build_object('ejercicio', '2024', 'serie', 4, 'numero', 1, 'fecha', '2024-01-01', 'concepto', '',
    'tipoAsiento', 3, 'huella', 'h-b', 'lineas', jsonb_build_array(
      jsonb_build_object('posicion', 1, 'cuenta', '57000000', 'debe', 2800, 'haber', 0),
      jsonb_build_object('posicion', 2, 'cuenta', '55100000', 'debe', 0, 'haber', 2800)));
begin
  -- 1 · Permisos
  foreach f in array array['conta_diez_ejercicio(uuid,text,date,date)', 'conta_diez_subcuentas(uuid,uuid,jsonb)',
                           'conta_diez_importar(uuid,uuid,jsonb)', 'conta_diez_cerrar_ejercicio(uuid,text)'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'PRUEBA importar · 1: % la puede ejecutar un usuario.', f;
    end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception 'PRUEBA importar · 1: service_role no puede ejecutar %.', f;
    end if;
  end loop;

  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'diez', 'historico', '2024-01-01', '2024-12-31') returning id into v_run;

  -- 2 · Ejercicio traído
  v_y := public.conta_diez_ejercicio(c, '2024', '2024-01-01', '2024-12-31');
  v_y2 := public.conta_diez_ejercicio(c, '2024', '2024-01-01', '2024-12-31');
  if v_y is distinct from v_y2 then raise exception 'PRUEBA importar · 2: el ejercicio se creó dos veces.'; end if;
  if not exists (select 1 from public.fiscal_year where id = v_y and origin = 'migrated' and origin_program = 'diez'
                 and imported_until = '2024-12-31' and status = 'open') then
    raise exception 'PRUEBA importar · 2: el ejercicio traído no quedó migrated/diez/abierto hasta el 31/12.';
  end if;
  v_ok := false;
  begin perform public.conta_diez_ejercicio(c, '2026', '2026-01-01', '2026-12-31'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA importar · 2: dejó traer encima de un ejercicio de Folvy.'; end if;

  -- 3 · Subcuentas
  r := public.conta_diez_subcuentas(c, v_run, '[{"code":"40000901","nombre":"PROVEEDOR INVENTADO"},{"code":"40000001","nombre":"X"},{"code":"99999999","nombre":"NADA"}]');
  if (r ->> 'nuevas')::int <> 1 or (r ->> 'estaban')::int <> 1 or jsonb_array_length(r -> 'rechazadas') <> 1 then
    raise exception 'PRUEBA importar · 3: subcuentas %.', r;
  end if;
  if not exists (select 1 from public.company_account where company_id = c and code = '40000901' and template_code = '4000'
                 and kind = 'own' and source = 'migrated') then
    raise exception 'PRUEBA importar · 3: la 40000901 no cuelga de la 4000 como propia traída.';
  end if;

  -- 4 · Traer: 2 bien y 4 rechazados, cada uno con su motivo
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(
    a_bien, b_bien,
    jsonb_set(jsonb_set(a_bien, '{numero}', '6'), '{lineas,2,cuenta}', '"40000999"'),        -- subcuenta que falta
    jsonb_set(jsonb_set(b_bien, '{ejercicio}', '"2026"'), '{fecha}', '"2026-01-02"'),       -- ejercicio de Folvy
    jsonb_set(jsonb_set(b_bien, '{numero}', '2'), '{fecha}', '"2025-01-01"'),               -- fecha fuera del ejercicio
    jsonb_set(jsonb_set(b_bien, '{numero}', '3'), '{serie}', '7')));                        -- serie ajena
  if (r ->> 'traidos')::int <> 2 or jsonb_array_length(r -> 'rechazados') <> 4 then
    raise exception 'PRUEBA importar · 4: %.', r;
  end if;
  select string_agg(x ->> 'motivo', ' | ') into v_txt from jsonb_array_elements(r -> 'rechazados') x;
  if v_txt not like '%40000999%' or v_txt not like '%es de Folvy%' or v_txt not like '%no es del ejercicio%' or v_txt not like '%serie 7%' then
    raise exception 'PRUEBA importar · 4: los motivos no dicen lo que pasa: %.', v_txt;
  end if;

  -- 5 · Cómo queda
  select * into v_e from public.journal_entry where company_id = c and external_program = 'diez' and external_year = '2024'
     and external_series = '2' and external_number = '5';
  if v_e.status <> 'validado' or v_e.source_type <> 'migrated' or v_e.series <> 2 or v_e.number <> 5 or v_e.fiscal_year_id <> v_y
     or v_e.external_hash <> 'h-a' or v_e.import_run_id <> v_run or v_e.hash is null or v_e.hash = 'pendiente' then
    raise exception 'PRUEBA importar · 5: el asiento traído quedó %.', to_jsonb(v_e) - 'reasons';
  end if;
  if (select sum(debit) from public.journal_line where entry_id = v_e.id) <> 121.00 then
    raise exception 'PRUEBA importar · 5: los céntimos no se pasaron a euros.';
  end if;
  if (select external_negative_side from public.journal_line where entry_id = v_e.id and position = 2) is distinct from 'haber'
     or exists (select 1 from public.journal_line where entry_id = v_e.id and position <> 2 and external_negative_side is not null) then
    raise exception 'PRUEBA importar · 5: la marca de negativo no quedó solo en su línea.';
  end if;
  if (select concept from public.journal_entry where company_id = c and external_series = '4' and external_number = '1' and external_year = '2024')
     <> 'Asiento 4/1 traído de Diez' then
    raise exception 'PRUEBA importar · 5: un asiento sin descripción no tiene concepto de reserva.';
  end if;
  select count(*) into v_n from public.external_entry_snapshot where company_id = c and import_run_id = v_run;
  if v_n <> 2 then raise exception 'PRUEBA importar · 5: % fotos para comparar, y son 2.', v_n; end if;

  -- 6 · La cadena
  -- (journal_cadena_comprobar pide un usuario de la cuenta; aquí se rehace a mano
  --  lo mismo: la huella de cada traído y su enganche con el anterior.)
  if exists (select 1 from public.journal_entry e
               left join public.journal_entry p on p.company_id = e.company_id and p.chain_seq = e.chain_seq - 1
              where e.company_id = c and e.import_run_id = v_run
                and (e.hash <> public.journal_huella(e.prev_hash, public.journal_entry_canonico(e.id))
                     or e.prev_hash is distinct from p.hash)) then
    raise exception 'PRUEBA importar · 6: la cadena de huellas de lo traído no es buena.';
  end if;

  -- 7 · Idempotente
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(a_bien, jsonb_set(b_bien, '{huella}', '"h-b-cambiada"')));
  if (r ->> 'traidos')::int <> 0 or (r ->> 'yaEstaban')::int <> 1 or jsonb_array_length(r -> 'distintos') <> 1 then
    raise exception 'PRUEBA importar · 7: %.', r;
  end if;
  if (select count(*) from public.journal_entry where company_id = c and import_run_id = v_run) <> 2 then
    raise exception 'PRUEBA importar · 7: traerlo dos veces duplicó asientos.';
  end if;
  if (select external_hash from public.journal_entry where company_id = c and external_year = '2024' and external_series = '4' and external_number = '1') <> 'h-b' then
    raise exception 'PRUEBA importar · 7: un cambio en Diez pisó lo traído.';
  end if;

  -- 8 · Cerrar
  r := public.conta_diez_cerrar_ejercicio(c, '2024');
  if not (r ->> 'cerrado')::boolean or (select status from public.fiscal_year where id = v_y) <> 'closed' then
    raise exception 'PRUEBA importar · 8: no se cerró: %.', r;
  end if;
  r := public.conta_diez_importar(c, v_run, jsonb_build_array(jsonb_set(b_bien, '{numero}', '9')));
  if (r ->> 'traidos')::int <> 0 or (r -> 'rechazados' -> 0 ->> 'motivo') not like '%está cerrado%' then
    raise exception 'PRUEBA importar · 8: entró algo en un ejercicio cerrado: %.', r;
  end if;
  v_ok := false;
  begin perform public.conta_diez_cerrar_ejercicio(c, '2026'); exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA importar · 8: cerró por aquí un ejercicio de Folvy.'; end if;

  raise notice 'PRUEBA importar: 8 de 8 bien.';
end $$;

rollback;
