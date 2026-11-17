-- supabase/staging/sql/20261117_n03_antes_del_inicio_prueba.sql
--
-- SOLO STAGING. Prueba del N03 (20261117T0955_n03_respuesta_antes_del_inicio y
-- 20261117T0956_n03_parar_y_preguntar), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Datos INVENTADOS en la
-- empresa de la cuenta A, con día de inicio el 01/11/2026 (corte del banco) y el programa de
-- antes ERP10 (una lectura de ERP10). Nombra los tres objetos que cambian:
-- public._conta_recibida_no_antes_de_entrar, public.conta_documentos_recibidos y
-- public.conta_pagos_lista.
--
--   1. Permisos: las dos de la pantalla, para un usuario; las de dentro, solo service_role.
--   2. Una factura del 14/10/2026 sin respuesta: no se contabiliza (para con la pregunta), y
--      conta_recibida_antes_del_inicio dice que hay que preguntar, con sus dos fechas y «ERP10».
--   3. «Sí, ya estaba»: el texto de la pantalla; no deja asiento ni libro; sale en la lista
--      como «ya_contabilizada» con su porqué y «ERP10», y no cuenta en «Por revisar»;
--      aprobada, no sale en Pagos. Y no se puede contabilizar ni a la fuerza.
--   4. «No estaba contabilizada» la devuelve a como estaba (sin respuesta: vuelve a parar).
--   5. «No, es nueva»: se contabiliza en el primer día abierto (01/11/2026 o después) y la
--      fecha de la factura sigue siendo el 14/10/2026.
--   6. Si ya vino con lo traído (mismo NIF y número, source = traida), no se pregunta: se dice
--      cuál es.
--   7. Una empresa sin día de inicio hace lo de siempre: se contabiliza sin preguntar.
--   8. Las dos vueltas atrás, sobre estos datos (con respuestas guardadas): las tres funciones
--      vuelven a su cuerpo de antes y la respuesta sale de la factura.
--
-- con usuario: se entra como el administrador a1 de la cuenta A (request.jwt.claims y
-- «set local role authenticated») para todo lo que hace la pantalla; lo de preparar los datos
-- y mirar lo que ha quedado, como el dueño.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- 1 · Permisos ---------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['conta_recibida_antes_del_inicio(uuid)', 'conta_recibida_responder_antes_del_inicio(uuid,text,text)'] loop
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'PRUEBA N03 · 1: % no es solo para usuarios.', f;
    end if;
  end loop;
  foreach f in array array['_conta_recibida_antes_del_inicio_para(uuid,uuid)', '_conta_programa_de_antes(uuid)'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception 'PRUEBA N03 · 1: % la puede ejecutar un usuario, o no service_role.', f;
    end if;
  end loop;
end $$;

-- Preparar (como el dueño): la empresa de la cuenta A, con día de inicio el 01/11/2026 y ERP10.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_run uuid; v_p uuid; r jsonb; x text;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA N03: la cuenta A no tiene empresa.'; end if;
  perform set_config('n03.empresa', c::text, true);
  if not exists (select 1 from public.fiscal_year where company_id = c and starts_on <= '2026-12-31' and ends_on >= '2026-01-01') then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  end if;
  insert into public.import_run (account_id, company_id, program, kind, status, finished_at)
  values (v_acc, c, 'erp10', 'plan_cuentas', 'en_curso', null) returning id into v_run;
  r := public.conta_diez_subcuentas(c, v_run, '[{"code":"60000000","nombre":"Compras"},{"code":"40000000","nombre":"Proveedores"}]');
  if jsonb_array_length(r -> 'rechazadas') <> 0 then raise exception 'PRUEBA N03: las subcuentas de la prueba no entran: %.', r; end if;
  update public.import_run set status = 'en_prueba', finished_at = now() where id = v_run;
  insert into public.bank_settings (company_id, account_id, cutover_date) values (c, v_acc, '2026-11-01')
  on conflict (company_id) do update set cutover_date = excluded.cutover_date;

  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Proveedor Inventado N03', 'Proveedor Inventado N03, S.L.', 'B00000003', true, 'Prueba N03') returning id into v_p;
  perform set_config('n03.proveedor', v_p::text, true);
  -- Cuatro facturas del 14/10/2026, en revisión: la de «ya estaba», la de «es nueva», la que ya vino
  -- traída (y su gemela traída) y la de la empresa sin día de inicio.
  foreach x in array array['N03-YA-ESTABA', 'N03-ES-NUEVA', 'N03-TRAIDA', 'N03-SIN-INICIO'] loop
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
    values (v_acc, v_p, c, x, '2026-10-14', 'en_revision', 'manual', 121.00, 100.00, 21.00, 'Prueba N03');
  end loop;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_p, c, 'N03/TRAIDA', '2026-10-14', 'aprobada', 'traida', 99.00, 81.82, 17.18, 'Prueba N03 · traída');
end $$;

-- La propuesta de una factura (como la pantalla, con journal_entry_proponer), en una función de la sesión.
create or replace function pg_temp.proponer(p_num text) returns jsonb language plpgsql as $$
declare c uuid := current_setting('n03.empresa')::uuid; v_i uuid; r jsonb;
begin
  select id into v_i from public.supplier_invoice where company_id = c and invoice_number = p_num and source = 'manual';
  r := public.journal_entry_proponer(c,
    jsonb_build_object('series', 2, 'fecha', '2026-10-14', 'concepto', 'Factura Proveedor Inventado N03 · ' || p_num,
                       'source_type', 'supplier_invoice', 'source_id', v_i, 'confianza', 'seguro', 'porque', 'Prueba N03', 'documento', p_num),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 121, 'haber', 0, 'comun', true, 'documento', p_num),
      jsonb_build_object('cuenta', '40000000', 'debe', 0, 'haber', 121, 'comun', true, 'documento', p_num)),
    null, 'Prueba N03');
  return r;
end $$;
create or replace function pg_temp.factura(p_num text) returns uuid language sql as $$
  select id from public.supplier_invoice where company_id = current_setting('n03.empresa')::uuid and invoice_number = p_num and source = 'manual'
$$;
create or replace function pg_temp.asientos(p_num text) returns int language sql as $$
  select count(*)::int from public.journal_entry where source_type = 'supplier_invoice' and source_id = pg_temp.factura(p_num) and status <> 'anulado'
$$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 2 · Sin respuesta, no se contabiliza --------------------------------------------------------
do $$
declare r jsonb; v_hint text; v_msg text;
begin
  r := public.conta_recibida_antes_del_inicio(pg_temp.factura('N03-YA-ESTABA'));
  if not (r->>'preguntar')::boolean or r->>'fecha' <> '2026-10-14' or r->>'dia_inicio' <> '2026-11-01' or r->>'programa' <> 'ERP10' then
    raise exception 'PRUEBA N03 · 2: lo que necesita la pantalla para preguntar no está: %.', r;
  end if;
  begin
    perform pg_temp.proponer('N03-YA-ESTABA');
    raise exception 'PRUEBA N03 · 2: una factura de antes del inicio sin respuesta se ha contabilizado.';
  exception when check_violation then
    get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
  end;
  if v_hint is distinct from 'antes_del_inicio' or v_msg not like 'Esta factura es del 14/10/2026, y esta empresa empezó en Sumied el 01/11/2026.%ERP10.' then
    raise exception 'PRUEBA N03 · 2: no para con la pregunta (hint %, «%»).', v_hint, v_msg;
  end if;
  if pg_temp.asientos('N03-YA-ESTABA') <> 0 then raise exception 'PRUEBA N03 · 2: ha dejado un asiento.'; end if;
end $$;

-- 3 · «Sí, ya estaba» ------------------------------------------------------------------------
do $$
declare
  c uuid := current_setting('n03.empresa')::uuid; r jsonb; v_hint text; f jsonb; v_id uuid := pg_temp.factura('N03-YA-ESTABA');
begin
  r := public.conta_recibida_responder_antes_del_inicio(v_id, 'ya_estaba', 'Prueba N03');
  if r->>'texto' <> 'Hecho. No se contabiliza: ya estaba en ERP10.' then raise exception 'PRUEBA N03 · 3: el texto es «%».', r->>'texto'; end if;
  begin
    perform pg_temp.proponer('N03-YA-ESTABA');
    raise exception 'PRUEBA N03 · 3: una factura que ya estaba en ERP10 se ha contabilizado.';
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'antes_del_inicio_ya_estaba' then raise exception 'PRUEBA N03 · 3: no para como «ya estaba» (hint %).', v_hint; end if;
  if pg_temp.asientos('N03-YA-ESTABA') <> 0 then raise exception 'PRUEBA N03 · 3: ha dejado un asiento.'; end if;
  -- En la lista: sale (regla 7), marcada, y no cuenta en «Por revisar».
  r := public.conta_documentos_recibidos(c, '2026-10-01', '2026-10-31');
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = v_id::text;
  if f is null then raise exception 'PRUEBA N03 · 3: la marcada no sale en la lista.'; end if;
  if f->>'estado' <> 'ya_contabilizada' or f->>'programa_antes' <> 'ERP10' or f->>'porque' not like 'Ya estaba contabilizada en ERP10: no se contabiliza en Sumied (Prueba N03, %).' then
    raise exception 'PRUEBA N03 · 3: en la lista sale %.', f;
  end if;
  if (select count(*) from jsonb_array_elements(r->'filas') x where x->>'estado' = 'para_mirar' and x->>'id' = v_id::text) <> 0 then
    raise exception 'PRUEBA N03 · 3: cuenta en «Por revisar».';
  end if;
end $$;

-- …y aprobada, no sale en Pagos (como el dueño, que puede aprobar sin pasar por la regla de quién aprueba).
reset role;
update public.supplier_invoice set status = 'aprobada' where id = pg_temp.factura('N03-YA-ESTABA');
update public.supplier_invoice set status = 'aprobada' where id = pg_temp.factura('N03-SIN-INICIO');
set local role authenticated;
do $$
declare c uuid := current_setting('n03.empresa')::uuid; r jsonb;
begin
  r := public.conta_pagos_lista(c, '2026-10-01');
  if exists (select 1 from jsonb_array_elements(r->'filas') x where x->>'id' = pg_temp.factura('N03-YA-ESTABA')::text) then
    raise exception 'PRUEBA N03 · 3: la que ya estaba en ERP10 sale en Pagos.';
  end if;
  if not exists (select 1 from jsonb_array_elements(r->'filas') x where x->>'id' = pg_temp.factura('N03-SIN-INICIO')::text) then
    raise exception 'PRUEBA N03 · 3: la medida no vale: una aprobada sin respuesta tampoco sale en Pagos.';
  end if;
end $$;

-- 4 · «No estaba contabilizada»: vuelve a como estaba --------------------------------------------
do $$
declare r jsonb; v_hint text;
begin
  r := public.conta_recibida_responder_antes_del_inicio(pg_temp.factura('N03-YA-ESTABA'), null, 'Prueba N03');
  if (r->>'texto') not like 'Hecho. Vuelve a estar sin contabilizar%' then raise exception 'PRUEBA N03 · 4: el texto es «%».', r->>'texto'; end if;
  if not (public.conta_recibida_antes_del_inicio(pg_temp.factura('N03-YA-ESTABA'))->>'preguntar')::boolean then
    raise exception 'PRUEBA N03 · 4: deshecha, no vuelve a preguntar.';
  end if;
  begin
    perform pg_temp.proponer('N03-YA-ESTABA');
    raise exception 'PRUEBA N03 · 4: deshecha, se contabiliza sin preguntar.';
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is distinct from 'antes_del_inicio' then raise exception 'PRUEBA N03 · 4: no vuelve a parar con la pregunta (hint %).', v_hint; end if;
end $$;

-- 5 · «No, es nueva»: al primer día abierto, con su fecha de factura intacta ----------------------
do $$
declare r jsonb; v_e public.journal_entry;
begin
  r := public.conta_recibida_responder_antes_del_inicio(pg_temp.factura('N03-ES-NUEVA'), 'es_nueva', 'Prueba N03');
  if r->>'respuesta' <> 'es_nueva' then raise exception 'PRUEBA N03 · 5: %.', r; end if;
  r := pg_temp.proponer('N03-ES-NUEVA');
  select * into v_e from public.journal_entry where id = (r->>'id')::uuid;
  if v_e.id is null or v_e.entry_date < date '2026-11-01' then
    raise exception 'PRUEBA N03 · 5: el asiento de la nueva no va al primer día abierto (%).', v_e.entry_date;
  end if;
  if (select invoice_date from public.supplier_invoice where id = pg_temp.factura('N03-ES-NUEVA')) <> date '2026-10-14' then
    raise exception 'PRUEBA N03 · 5: ha cambiado la fecha de la factura.';
  end if;
  if coalesce(r->>'aviso', '') not like '%14/10/2026%' then raise exception 'PRUEBA N03 · 5: el aviso no dice la fecha de la factura: «%».', r->>'aviso'; end if;
  perform set_config('n03.fecha_nueva', v_e.entry_date::text, true);
end $$;

-- 6 · Ya vino con lo traído: no se pregunta, se dice cuál es -------------------------------------
do $$
declare r jsonb;
begin
  r := public.conta_recibida_antes_del_inicio(pg_temp.factura('N03-TRAIDA'));
  if (r->>'preguntar')::boolean or r->'traida' is null or r->'traida'->>'numero' <> 'N03/TRAIDA' then
    raise exception 'PRUEBA N03 · 6: la traída no se encuentra: %.', r;
  end if;
end $$;

-- 7 · Sin día de inicio, como siempre ------------------------------------------------------------
reset role;
do $$
declare c uuid := current_setting('n03.empresa')::uuid;
begin
  update public.bank_settings set cutover_date = null where company_id = c;
  update public.fiscal_year set origin = 'folvy', origin_program = null, imported_until = null
   where company_id = c and origin <> 'folvy'
     and not exists (select 1 from public.journal_entry e where e.fiscal_year_id = fiscal_year.id and e.source_type = 'migrated');
  perform set_config('n03.sin_inicio', (public.conta_dia_de_inicio(c) is null)::text, true);
  if public.conta_dia_de_inicio(c) is not null then
    raise notice 'PRUEBA N03 · 7: esta empresa trae ejercicios de otro programa con asientos; no se puede dejar sin día de inicio aquí.';
  end if;
end $$;
set local role authenticated;
do $$
declare c uuid := current_setting('n03.empresa')::uuid; r jsonb;
begin
  if current_setting('n03.sin_inicio')::boolean then
    if (public.conta_recibida_antes_del_inicio(pg_temp.factura('N03-SIN-INICIO'))->>'preguntar')::boolean then
      raise exception 'PRUEBA N03 · 7: sin día de inicio, pregunta.';
    end if;
    r := pg_temp.proponer('N03-SIN-INICIO');
    if r->>'id' is null or pg_temp.asientos('N03-SIN-INICIO') <> 1 then raise exception 'PRUEBA N03 · 7: sin día de inicio, no se contabiliza: %.', r; end if;
  end if;
  raise notice 'PRUEBA N03: 7 de 7 bien (la nueva, contabilizada el %).', current_setting('n03.fecha_nueva');
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

-- 8 · Las vueltas atrás, sobre estos datos ------------------------------------------------------
\i supabase/vuelta-atras/20261117T0956_n03_parar_y_preguntar.down.sql
\i supabase/vuelta-atras/20261117T0955_n03_respuesta_antes_del_inicio.down.sql
do $$
begin
  if exists (select 1 from pg_proc where proname in ('_conta_recibida_no_antes_de_entrar', 'conta_documentos_recibidos', 'conta_pagos_lista')
               and pronamespace = 'public'::regnamespace and prosrc ~ 'N03') then
    raise exception 'PRUEBA N03 · 8: la vuelta atrás no devolvió las funciones a como estaban.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name like 'before_start%')
     or to_regprocedure('public.conta_recibida_antes_del_inicio(uuid)') is not null then
    raise exception 'PRUEBA N03 · 8: la vuelta atrás dejó la respuesta o las funciones nuevas.';
  end if;
  raise notice 'PRUEBA N03 · 8: las vueltas atrás, bien.';
end $$;
rollback;
