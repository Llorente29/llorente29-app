-- supabase/staging/sql/20261118_x06_comprobar_salida_prueba.sql
--
-- SOLO STAGING. Prueba del X06 (20261118T0515_x06_comprobar_salida), que el ensayo
-- de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK:
-- staging no cambia. Con dos empresas inventadas (cuentas A y B), creadas aquí, y los
-- asientos validados por el camino de verdad (journal_entry_validar).
--
--   0. La forma: las dos tablas con su RLS; las cuatro funciones con sus permisos;
--      la de comprobar solo lee.
--   1. Comprobar: los saldos a la fecha en el ejercicio, con el código en ERP10; cada
--      asiento desde que sale, con si salió y lo que pone en cada cuenta; lo de antes
--      de «desde», no.
--   2. «Ya la he metido a mano»: se apunta con quién y cuándo, dos veces no duplica,
--      y comprobar lo trae.
--   3. «Volver a sacar solo esa»: la partida pasa a «retirada», el asiento vuelve a lo
--      que sale y se puede apuntar en una tanda nueva; una que no salió, no.
--   4. «Darlo por igualado»: se apunta en la última tanda; sin tanda, no.
--   5. Una empresa no ve lo de la otra.
--   6. La vuelta atrás: no queda ni tabla ni función.
--
-- Sin datos reales (T11): nombres y NIF inventados, que se ven inventados.
--
-- sin usuario: todo se hace como el usuario a1 de la cuenta A (request.jwt.claims), por
-- las funciones de verdad; la sección 5 mira las tablas con «set local role
-- authenticated» como el administrador de B.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X06: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La forma ---------------------------------------------------------------------------------
do $$
declare f text; t text;
begin
  foreach t in array array['conta_erp10_a_mano', 'conta_erp10_igualado'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'PRUEBA X06 · 0: % sin RLS.', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert') then raise exception 'PRUEBA X06 · 0: authenticated puede escribir en %.', t; end if;
  end loop;
  foreach f in array array['public.conta_erp10_comprobar(uuid, date)', 'public.conta_erp10_a_mano_poner(uuid, uuid, text)',
                           'public.conta_erp10_volver_a_sacar(uuid, uuid, text)', 'public.conta_erp10_igualado_poner(uuid, date, text, date, integer, integer, text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA X06 · 0: anon puede ejecutar %.', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA X06 · 0: authenticated no puede ejecutar %.', f; end if;
    if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'PRUEBA X06 · 0: % no es security definer.', f; end if;
  end loop;
  if (select provolatile from pg_proc where oid = 'public.conta_erp10_comprobar(uuid, date)'::regprocedure) <> 's' then
    raise exception 'PRUEBA X06 · 0: conta_erp10_comprobar no es stable (solo lee).';
  end if;
  raise notice 'PRUEBA X06 · 0 bien: dos tablas con RLS y sin escritura directa; cuatro funciones con sus permisos; comprobar solo lee.';
end $$;

-- Las dos empresas inventadas, con una recibida antes de «desde» y dos después ---------------------
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c uuid; d uuid; y uuid; x record; cu jsonb; t21 uuid; e uuid; k record;
begin
  insert into public.company (account_id, legal_name) values (a, 'Empresa Inventada X06 Uno, S.L.') returning id into c;
  insert into public.company (account_id, legal_name) values (b, 'Empresa Inventada X06 Dos, S.L.') returning id into d;
  perform set_config('x06.c', c::text, true);
  perform set_config('x06.d', d::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (b, d, '2026', '2026-01-01', '2026-12-31');
  for x in select * from (values ('62900000', '629', 'Otros servicios'), ('47200000', '472', 'IVA soportado'), ('41000012', '4100', 'Suministros Inventados X06'),
                                 ('57200001', '572', 'Banco inventado')) v(codigo, plantilla, nombre) loop
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', x.codigo, x.plantilla, x.nombre, 'own', 'manual');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (b, d, 'pymes', x.codigo, x.plantilla, x.nombre, 'own', 'manual');
  end loop;
  select id into t21 from public.tax_rate where is_system and code = 'iva_general' and valid_to is null;
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;
  -- Una de septiembre (antes de «desde»), y dos de octubre: X06-1 de 82,10 y X06-2 de 121,00.
  for k in select * from (values ('X06-0', '2026-09-10', 50.00), ('X06-1', '2026-10-03', 67.85), ('X06-2', '2026-10-05', 100.00)) v(numero, fecha, base) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, document_ref, document_date)
    values (a, c, y, 2, k.fecha::date, 'Recibida inventada ' || k.numero, 'manual', k.numero, k.fecha::date) returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, tax_rate_id, tax_base, vat_book, vat_deductible, document_ref, document_date)
    values (a, c, e, 1, (cu ->> '62900000')::uuid, k.base, 0, null, null, null, null, null, null),
           (a, c, e, 2, (cu ->> '47200000')::uuid, round(k.base * 0.21, 2), 0, t21, k.base, 'received', 'yes', k.numero, k.fecha::date),
           (a, c, e, 3, (cu ->> '41000012')::uuid, 0, k.base + round(k.base * 0.21, 2), null, null, null, null, null, null);
    perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
    perform public.journal_entry_validar(e);
    perform set_config('x06.' || replace(k.numero, '-', ''), e::text, true);
  end loop;
end $$;

-- 1 · Comprobar (administrador de A) ----------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x06.c')::uuid;
  r jsonb; p jsonb; v_msg text;
begin
  begin perform public.conta_erp10_comprobar(c, '2026-10-31');
        raise exception 'PRUEBA X06 · 1: se comprobó sin la salida encendida.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'La salida a ERP10 no está encendida en esta empresa.' then raise exception 'PRUEBA X06 · 1: sin salida dice «%».', v_msg; end if;
  perform public.conta_erp10_salida_poner(c, true, '0007', 8, '2026-10-01');
  perform public.conta_erp10_lote_apuntar(c, '2026-10-01', '[{"nombre": "recibidas.xlsx", "filas": 1, "huella": "h"}]',
    jsonb_build_array(jsonb_build_object('entry_id', current_setting('x06.X061'), 'clase', 'recibida', 'huella', 'h1')));

  r := public.conta_erp10_comprobar(c, '2026-10-31');
  if r ->> 'fecha' <> '2026-10-31' or r -> 'ejercicio' ->> 'desde' <> '2026-01-01' or r ->> 'codigo' <> '0007' or (r ->> 'largo')::int <> 8 then
    raise exception 'PRUEBA X06 · 1: la cabecera es %.', r - 'saldos' - 'asientos';
  end if;
  -- Los saldos, de todo el ejercicio (también la de septiembre): 62900000 = 50 + 67,85 + 100.
  select x into p from jsonb_array_elements(r -> 'saldos') x where x ->> 'codigo' = '62900000';
  if (p ->> 'saldo')::numeric <> 217.85 or p ->> 'erp' <> '62900000' or p ->> 'plantilla' <> '629' then raise exception 'PRUEBA X06 · 1: el saldo de la 62900000 es %.', p; end if;
  select x into p from jsonb_array_elements(r -> 'saldos') x where x ->> 'codigo' = '41000012';
  if (p ->> 'saldo')::numeric <> -263.60 then raise exception 'PRUEBA X06 · 1: el saldo de la 41000012 es %.', p; end if;
  -- Los asientos, desde «desde»: dos (la de septiembre no); la X06-1, salida; la X06-2, no.
  if jsonb_array_length(r -> 'asientos') <> 2 then raise exception 'PRUEBA X06 · 1: vienen % asientos y son 2.', jsonb_array_length(r -> 'asientos'); end if;
  select x into p from jsonb_array_elements(r -> 'asientos') x where x ->> 'entryId' = current_setting('x06.X061');
  if p ->> 'factura' <> 'X06-1' or p -> 'salida' ->> 'clase' <> 'recibida' or p -> 'salida' ->> 'mes' <> '2026-10-01' or p -> 'aMano' <> 'null'::jsonb
     or p -> 'lineas' <> '[{"cuenta": "41000012", "importe": -82.10}, {"cuenta": "47200000", "importe": 14.25}, {"cuenta": "62900000", "importe": 67.85}]'::jsonb then
    raise exception 'PRUEBA X06 · 1: la X06-1 viene como %.', p;
  end if;
  select x into p from jsonb_array_elements(r -> 'asientos') x where x ->> 'entryId' = current_setting('x06.X062');
  if p -> 'salida' <> 'null'::jsonb then raise exception 'PRUEBA X06 · 1: la X06-2 viene como salida: %.', p; end if;
  if jsonb_array_length(r -> 'lotes') <> 1 or r -> 'igualado' <> 'null'::jsonb then raise exception 'PRUEBA X06 · 1: lotes % e igualado %.', r -> 'lotes', r -> 'igualado'; end if;
  raise notice 'PRUEBA X06 · 1 bien: sin salida, no; los saldos del ejercicio a la fecha con su código en ERP10; los asientos desde «desde», con la salida y lo de cada cuenta.';
end $$;

-- 2 · «Ya la he metido a mano» -----------------------------------------------------------------------
do $$
declare c constant uuid := current_setting('x06.c')::uuid; r jsonb; p jsonb;
begin
  r := public.conta_erp10_a_mano_poner(c, current_setting('x06.X061')::uuid, 'Persona Inventada X06');
  if r ->> 'texto' not like 'Apuntado: la X06-1 la metió a mano en ERP10 Persona Inventada X06 el __/__/____ a las __:__. Ya no cuenta como diferencia.' then
    raise exception 'PRUEBA X06 · 2: dice «%».', r ->> 'texto';
  end if;
  perform public.conta_erp10_a_mano_poner(c, current_setting('x06.X061')::uuid, 'Otra Persona Inventada');
  if (select count(*) from public.conta_erp10_a_mano where company_id = c) <> 1
     or (select metida_por_nombre from public.conta_erp10_a_mano where company_id = c) <> 'Persona Inventada X06' then
    raise exception 'PRUEBA X06 · 2: dos veces la misma deja % filas.', (select count(*) from public.conta_erp10_a_mano where company_id = c);
  end if;
  r := public.conta_erp10_comprobar(c, '2026-10-31');
  select x into p from jsonb_array_elements(r -> 'asientos') x where x ->> 'entryId' = current_setting('x06.X061');
  if p -> 'aMano' ->> 'quien' <> 'Persona Inventada X06' then raise exception 'PRUEBA X06 · 2: comprobar trae aMano %.', p -> 'aMano'; end if;
  raise notice 'PRUEBA X06 · 2 bien: se apunta con quién y cuándo, dos veces no duplica y comprobar lo trae.';
end $$;

-- 3 · «Volver a sacar solo esa» ------------------------------------------------------------------------
do $$
declare c constant uuid := current_setting('x06.c')::uuid; r jsonb; v_msg text;
begin
  begin perform public.conta_erp10_volver_a_sacar(c, current_setting('x06.X062')::uuid);
        raise exception 'PRUEBA X06 · 3: se volvió a sacar una que no había salido.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'Ese asiento no ha salido a ERP10: no hay nada que volver a sacar.' then raise exception 'PRUEBA X06 · 3: dice «%».', v_msg; end if;
  r := public.conta_erp10_volver_a_sacar(c, current_setting('x06.X061')::uuid);
  if (select estado from public.conta_erp10_salida_partida where entry_id = current_setting('x06.X061')::uuid) <> 'retirada' then
    raise exception 'PRUEBA X06 · 3: la partida no está retirada.';
  end if;
  -- Vuelve a lo que sale, y se apunta en una tanda nueva.
  if not exists (select 1 from jsonb_array_elements(public.conta_erp10_por_salir(c, '2026-10-01') -> 'partidas') x
                  where x ->> 'entry_id' = current_setting('x06.X061') and (x ->> 'sale')::boolean) then
    raise exception 'PRUEBA X06 · 3: la X06-1 no vuelve a lo que sale.';
  end if;
  perform public.conta_erp10_lote_apuntar(c, '2026-10-01', '[{"nombre": "recibidas.xlsx", "filas": 1, "huella": "h2"}]',
    jsonb_build_array(jsonb_build_object('entry_id', current_setting('x06.X061'), 'clase', 'recibida', 'huella', 'h1b')));
  if (select count(*) from public.conta_erp10_salida_partida where entry_id = current_setting('x06.X061')::uuid) <> 2
     or (select count(*) from public.conta_erp10_salida_lote where company_id = c) <> 2 then
    raise exception 'PRUEBA X06 · 3: después de volver a sacarla, partidas % y tandas %.',
      (select count(*) from public.conta_erp10_salida_partida where entry_id = current_setting('x06.X061')::uuid), (select count(*) from public.conta_erp10_salida_lote where company_id = c);
  end if;
  raise notice 'PRUEBA X06 · 3 bien: una que no salió, no; la que salió pasa a retirada, vuelve a lo que sale y sale en una tanda nueva.';
end $$;

-- 4 · «Darlo por igualado» --------------------------------------------------------------------------
do $$
declare c constant uuid := current_setting('x06.c')::uuid; r jsonb; v_msg text;
begin
  r := public.conta_erp10_igualado_poner(c, '2026-10-01', 'sumas_y_saldos.xlsx', '2026-10-31', 4, 1, 'Persona Inventada X06');
  if r ->> 'texto' not like 'Igualado: octubre de 2026 queda igual en Sumied y en ERP10 (sumas_y_saldos.xlsx, a 31/10; 4 cuentas). Lo dio por igualado Persona Inventada X06 el __/__/____ a las __:__.' then
    raise exception 'PRUEBA X06 · 4: dice «%».', r ->> 'texto';
  end if;
  if (select lote_id from public.conta_erp10_igualado where company_id = c) <> (select id from public.conta_erp10_salida_lote where company_id = c order by creado_en desc limit 1) then
    raise exception 'PRUEBA X06 · 4: no se apuntó en la última tanda.';
  end if;
  if public.conta_erp10_comprobar(c, '2026-10-31') -> 'igualado' ->> 'fichero' <> 'sumas_y_saldos.xlsx' then raise exception 'PRUEBA X06 · 4: comprobar no trae lo igualado.'; end if;
  raise notice 'PRUEBA X06 · 4 bien: se apunta en la última tanda y comprobar lo trae.';
end $$;

-- 5 · Una empresa no ve lo de la otra (administrador de B) ----------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_msg text; r jsonb;
begin
  begin perform public.conta_erp10_comprobar(current_setting('x06.c')::uuid, '2026-10-31');
        raise exception 'PRUEBA X06 · 5: B leyó la comprobación de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X06 · 5: B en A dice «%».', v_msg; end if;
  begin perform public.conta_erp10_a_mano_poner(current_setting('x06.c')::uuid, current_setting('x06.X062')::uuid);
        raise exception 'PRUEBA X06 · 5: B apuntó a mano en A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  perform public.conta_erp10_salida_poner(current_setting('x06.d')::uuid, true, '0008', 8, '2026-10-01');
  begin perform public.conta_erp10_igualado_poner(current_setting('x06.d')::uuid, '2026-10-01', 'x.xlsx', '2026-10-31', 0, 0);
        raise exception 'PRUEBA X06 · 5: se dio por igualada una empresa sin tandas.';
  exception when check_violation then v_msg := sqlerrm; end;
  if v_msg <> 'Todavía no ha salido nada a ERP10 en esta empresa: no hay nada que dar por igualado.' then raise exception 'PRUEBA X06 · 5: sin tanda dice «%».', v_msg; end if;
  r := public.conta_erp10_comprobar(current_setting('x06.d')::uuid, '2026-10-31');
  if jsonb_array_length(r -> 'saldos') <> 0 or jsonb_array_length(r -> 'asientos') <> 0 or jsonb_array_length(r -> 'lotes') <> 0 then
    raise exception 'PRUEBA X06 · 5: la empresa de B ve %.', r;
  end if;
end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conta_erp10_a_mano where company_id = current_setting('x06.c')::uuid)
     or exists (select 1 from public.conta_erp10_igualado where company_id = current_setting('x06.c')::uuid) then
    raise exception 'PRUEBA X06 · 5: el administrador de B ve lo de la empresa de A.';
  end if;
  raise notice 'PRUEBA X06 · 5 bien: B no lee ni escribe lo de A; sin tandas no se iguala; la suya sale vacía.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · La vuelta atrás ------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261118T0515_x06_comprobar_salida.down.sql
do $$
begin
  if to_regclass('public.conta_erp10_a_mano') is not null or to_regclass('public.conta_erp10_igualado') is not null
     or to_regprocedure('public.conta_erp10_comprobar(uuid, date)') is not null or to_regprocedure('public.conta_erp10_a_mano_poner(uuid, uuid, text)') is not null
     or to_regprocedure('public.conta_erp10_volver_a_sacar(uuid, uuid, text)') is not null
     or to_regprocedure('public.conta_erp10_igualado_poner(uuid, date, text, date, integer, integer, text)') is not null then
    raise exception 'PRUEBA X06 · 6: la vuelta atrás dejó algo.';
  end if;
  if to_regprocedure('public.conta_erp10_lote_apuntar(uuid, date, jsonb, jsonb, text)') is null then
    raise exception 'PRUEBA X06 · 6: la vuelta atrás se llevó una función de la X02.';
  end if;
  raise notice 'PRUEBA X06: 7 de 7 bien (0 a 6).';
end $$;

rollback;
