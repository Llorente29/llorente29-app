-- supabase/staging/sql/20261119_x08_dias_tpv_a_erp10_prueba.sql
--
-- SOLO STAGING. Prueba del X08 (20261119T0551_x08_dias_tpv_por_salir), que el ensayo de
-- staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no
-- cambia. Nombra el objeto: public.conta_erp10_dias_tpv_por_salir(uuid,date) (nueva). No
-- cambia ninguna función que exista.
--
-- Con dos empresas inventadas (cuentas A y B), creadas aquí, y los días validados por el
-- camino de verdad (journal_entry_validar):
--   0. La forma: la función nueva, con sus permisos, solo lee.
--   1. Un día de Revo sale con su rango (primero, último, cuántas), su contador y cada
--      apunte de su asiento (el cobro en caja y en la 430 de Glovo; las ventas; el I.V.A.
--      con su tipo y su base); y la cuenta «Clientes de contado» de la sociedad.
--   2. Un día de Revo con dos contadores lo dice (contadores = 2); un día del TPV de Folvy
--      sin rango viene sin primero ni último, con su local.
--   3. Lo salido no vuelve a salir (un día apuntado en una tanda, como «emitida»).
--   4. Una empresa no ve lo de la otra; la de B, sin «Clientes de contado», lo dice vacío.
--   5. Lo de antes contra lo de después con la misma vara (regla 31): la función nueva no
--      cambia lo que sale; por_salir da las mismas partidas (clase, sale e importe) con ella
--      y sin ella. Y la vuelta atrás la quita.
--
-- Sin datos reales (T11): nombres inventados, que se ven inventados.
--
-- sin usuario: los días se validan y se apuntan como el usuario a1 de la cuenta A
-- (request.jwt.claims), por las funciones de verdad. El día de Revo y el de Folvy los pone la
-- prueba por debajo (conta_tpv_dia y sales_day_summary), con su asiento de ventas validado. La
-- sección 4 mira las tablas con «set local role authenticated» como el administrador de B.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X08: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La forma ---------------------------------------------------------------------------------
do $$
declare f constant text := 'public.conta_erp10_dias_tpv_por_salir(uuid, date)';
begin
  if to_regprocedure(f) is null then raise exception 'PRUEBA X08 · 0: falta %.', f; end if;
  if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA X08 · 0: anon puede ejecutar %.', f; end if;
  if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA X08 · 0: authenticated no puede ejecutar %.', f; end if;
  if not (select prosecdef from pg_proc where oid = f::regprocedure) then raise exception 'PRUEBA X08 · 0: % no es security definer.', f; end if;
  if (select provolatile from pg_proc where oid = f::regprocedure) <> 's' then raise exception 'PRUEBA X08 · 0: % no es stable (solo lee).', f; end if;
  raise notice 'PRUEBA X08 · 0 bien: la función nueva con sus permisos, solo lee.';
end $$;

-- Las dos empresas inventadas y tres días de ventas validados
do $$
declare
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  c uuid; d uuid; y uuid; x record; cu jsonb; t10 uuid; e uuid; k record; v_dia uuid; loc uuid;
begin
  insert into public.company (account_id, legal_name) values (a, 'Empresa Inventada X08 Uno, S.L.') returning id into c;
  insert into public.company (account_id, legal_name) values (b, 'Empresa Inventada X08 Dos, S.L.') returning id into d;
  perform set_config('x08.c', c::text, true);
  perform set_config('x08.d', d::text, true);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (a, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (b, d, '2026', '2026-01-01', '2026-12-31');
  for x in select * from (values ('57000000', '570', 'Caja inventada'), ('43000001', '4300', 'Glovo inventado'), ('70000000', '700', 'Ventas de mercaderías'),
                                 ('47700000', '477', 'IVA repercutido')) v(codigo, plantilla, nombre) loop
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', x.codigo, x.plantilla, x.nombre, 'own', 'manual');
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (b, d, 'pymes', x.codigo, x.plantilla, x.nombre, 'own', 'manual');
  end loop;
  -- «Clientes de contado», solo en la de A; en las dos, la 4311 «descontados», que no es de contado.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', '43000099', '4300', 'Clientes de contado', 'own', 'manual');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (a, c, 'pymes', '43110000', '4311', 'Efectos comerciales descontados', 'own', 'manual');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source) values (b, d, 'pymes', '43110000', '4311', 'Efectos comerciales descontados', 'own', 'manual');
  select id into t10 from public.tax_rate where is_system and code = 'iva_reducido' and valid_to is null;
  select jsonb_object_agg(code, id) into cu from public.company_account where company_id = c;
  select id into loc from public.locations where account_id = a order by created_at, id limit 1;
  perform set_config('x08.local', coalesce((select name from public.locations where id = loc), ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

  -- Tres días de ventas: cobro en caja y en Glovo, contra las ventas y el I.V.A. del 10 %.
  for k in select * from (values ('revo1', '2026-10-05'), ('revo2', '2026-10-06'), ('folvy1', '2026-10-07')) v(clave, fecha) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, c, y, 1, k.fecha::date, 'Ventas del día · inventado X08', 'sales_day') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common, tax_rate_id, tax_base, vat_book, tax_documents)
    values (a, c, e, 1, (cu ->> '57000000')::uuid, 300, 0, 'Cobra Efectivo', true, null, null, null, 1),
           (a, c, e, 2, (cu ->> '43000001')::uuid, 250, 0, 'Cobra Deliverect · Glovo', true, null, null, null, 1),
           (a, c, e, 3, (cu ->> '47700000')::uuid, 0, 50, 'IVA repercutido 10 %', true, t10, 500, 'issued', 48),
           (a, c, e, 4, (cu ->> '70000000')::uuid, 0, 500, 'Ventas del día', true, null, null, null, 1);
    perform set_config('x08.' || k.clave, e::text, true);
    if k.clave like 'revo%' then
      insert into public.conta_tpv_dia (account_id, company_id, dia, programa, estado, documentos, primer_numero, ultimo_numero, base, cuota, total, entry_id)
      values (a, c, k.fecha::date, 'revo', 'contabilizado', 48, 5001, 5048, 500, 50, 550, e) returning id into v_dia;
      insert into public.conta_tpv_documento (account_id, company_id, dia_id, numero, contador, fecha, orden, canal, base, cuota, total)
      values (a, c, v_dia, 5001, 'Facturas', (k.fecha || ' 13:00')::timestamptz, '700001', 'local', 300, 30, 330),
             (a, c, v_dia, 5048, case when k.clave = 'revo2' then 'Caja 2' else 'Facturas' end, (k.fecha || ' 21:00')::timestamptz, '700048', 'Glovo', 200, 20, 220);
      update public.journal_entry set source_id = v_dia where id = e;
    else
      insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, entry_id, tickets_count, total, detail_hash)
      values (a, c, loc, k.fecha::date, e, 48, 550, 'x08-inventado');
    end if;
    perform public.journal_entry_validar(e);
  end loop;
end $$;

-- 1 y 2 · Lo que sale (administrador de A) ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x08.c')::uuid;
  ps jsonb; r jsonb; p jsonb;
begin
  perform public.conta_erp10_salida_poner(c, true, '0007', 8, '2026-10-01');
  ps := public.conta_erp10_por_salir(c, '2026-10-01');
  perform set_config('x08.despues', (select jsonb_object_agg(x ->> 'entry_id', jsonb_build_object('clase', x ->> 'clase', 'sale', x -> 'sale', 'importe', x -> 'importe'))
                                       from jsonb_array_elements(ps -> 'partidas') x)::text, true);
  for p in select x from jsonb_array_elements(ps -> 'partidas') x loop
    if p ->> 'clase' <> 'emitida' or p ->> 'origen' <> 'sales_day' or not (p ->> 'sale')::boolean then
      raise exception 'PRUEBA X08 · 1: por_salir da el día como %.', p;
    end if;
  end loop;

  r := public.conta_erp10_dias_tpv_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'dias') <> 3 then raise exception 'PRUEBA X08 · 1: vienen % días y son 3: %.', jsonb_array_length(r -> 'dias'), r -> 'dias'; end if;
  -- En orden de fecha: el de Revo del 05/10, campo a campo.
  p := r -> 'dias' -> 0;
  if p ->> 'entryId' <> current_setting('x08.revo1') or p ->> 'fecha' <> '2026-10-05' or p ->> 'origen' <> 'revo' or p ->> 'local' <> 'Revo'
     or p ->> 'primero' <> '5001' or p ->> 'ultimo' <> '5048' or (p ->> 'facturas')::int <> 48 or (p ->> 'contadores')::int <> 1 then
    raise exception 'PRUEBA X08 · 1: el día de Revo viene como %.', p - 'lineas';
  end if;
  if p -> 'lineas' <> '[{"cuenta": "57000000", "plantilla": "570", "nombre": "Caja inventada", "debe": 300.00, "haber": 0.00, "tipoIva": null, "baseIva": null, "libro": null},
                        {"cuenta": "43000001", "plantilla": "4300", "nombre": "Glovo inventado", "debe": 250.00, "haber": 0.00, "tipoIva": null, "baseIva": null, "libro": null},
                        {"cuenta": "47700000", "plantilla": "477", "nombre": "IVA repercutido", "debe": 0.00, "haber": 50.00, "tipoIva": 10.00, "baseIva": 500.00, "libro": "issued"},
                        {"cuenta": "70000000", "plantilla": "700", "nombre": "Ventas de mercaderías", "debe": 0.00, "haber": 500.00, "tipoIva": null, "baseIva": null, "libro": null}]'::jsonb then
    raise exception 'PRUEBA X08 · 1: los apuntes del día de Revo son %.', p -> 'lineas';
  end if;
  if r -> 'contado' <> '[{"codigo": "43000099", "plantilla": "4300", "nombre": "Clientes de contado"}]'::jsonb then
    raise exception 'PRUEBA X08 · 1: «Clientes de contado» es % (la 4311 «descontados» no cuenta).', r -> 'contado';
  end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'cuentas') x where x ->> 'codigo' = '43000099') then
    raise exception 'PRUEBA X08 · 1: «Clientes de contado» no está en las cuentas: %.', r -> 'cuentas';
  end if;
  -- 2 · Dos contadores; y el de Folvy sin rango, con su local.
  p := r -> 'dias' -> 1;
  if p ->> 'entryId' <> current_setting('x08.revo2') or (p ->> 'contadores')::int <> 2 then raise exception 'PRUEBA X08 · 2: el de dos contadores viene como %.', p - 'lineas'; end if;
  p := r -> 'dias' -> 2;
  if p ->> 'entryId' <> current_setting('x08.folvy1') or p ->> 'origen' <> 'folvy' or p ->> 'primero' is not null or p ->> 'ultimo' is not null
     or (p ->> 'facturas')::int <> 48 or coalesce(p ->> 'local', '') <> current_setting('x08.local') or (p ->> 'resumenes')::int <> 1 then
    raise exception 'PRUEBA X08 · 2: el de Folvy viene como %.', p - 'lineas';
  end if;
  raise notice 'PRUEBA X08 · 1 y 2 bien: el día de Revo sale con su rango, su contador y sus apuntes campo a campo, con «Clientes de contado»; el de dos contadores lo dice; el de Folvy viene sin rango.';
end $$;

-- 3 · Lo salido no vuelve a salir ------------------------------------------------------------------------
do $$
declare c constant uuid := current_setting('x08.c')::uuid; r jsonb;
begin
  perform public.conta_erp10_lote_apuntar(c, '2026-10-01', '[{"nombre": "dias-tpv.xlsx", "filas": 1, "huella": "h"}]',
    jsonb_build_array(jsonb_build_object('entry_id', current_setting('x08.revo1'), 'clase', 'emitida', 'huella', 'h1')));
  r := public.conta_erp10_dias_tpv_por_salir(c, '2026-10-01');
  if jsonb_array_length(r -> 'dias') <> 2 or exists (select 1 from jsonb_array_elements(r -> 'dias') x where x ->> 'entryId' = current_setting('x08.revo1')) then
    raise exception 'PRUEBA X08 · 3: después de salir el 05/10 vienen %.', r -> 'dias';
  end if;
  raise notice 'PRUEBA X08 · 3 bien: el día salido no vuelve.';
end $$;

-- 4 · Una empresa no ve lo de la otra (administrador de B) ----------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$
declare v_msg text; r jsonb;
begin
  begin perform public.conta_erp10_dias_tpv_por_salir(current_setting('x08.c')::uuid, '2026-10-01');
        raise exception 'PRUEBA X08 · 4: B leyó los días de A.';
  exception when no_data_found then v_msg := sqlerrm; end;
  if v_msg <> 'Esa empresa no está.' then raise exception 'PRUEBA X08 · 4: B en A dice «%».', v_msg; end if;
  perform public.conta_erp10_salida_poner(current_setting('x08.d')::uuid, true, '0008', 8, '2026-10-01');
  r := public.conta_erp10_dias_tpv_por_salir(current_setting('x08.d')::uuid, '2026-10-01');
  if jsonb_array_length(r -> 'dias') <> 0 or jsonb_array_length(r -> 'contado') <> 0 then raise exception 'PRUEBA X08 · 4: la empresa de B ve %.', r; end if;
end $$;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conta_erp10_salida_partida where company_id = current_setting('x08.c')::uuid) then
    raise exception 'PRUEBA X08 · 4: el administrador de B ve lo que salió de la empresa de A.';
  end if;
  raise notice 'PRUEBA X08 · 4 bien: B no lee los días ni lo salido de A; la suya, sin días ni «Clientes de contado» (la 4311 no cuenta).';
end $$;
reset role;

-- 5 · La vuelta atrás, y antes contra después con la misma vara ------------------------------------------
select set_config('request.jwt.claims', '', true);
\i supabase/vuelta-atras/20261119T0551_x08_dias_tpv_por_salir.down.sql
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare
  c constant uuid := current_setting('x08.c')::uuid;
  despues constant jsonb := current_setting('x08.despues')::jsonb;
  antes jsonb;
begin
  if to_regprocedure('public.conta_erp10_dias_tpv_por_salir(uuid, date)') is not null then raise exception 'PRUEBA X08 · 5: la vuelta atrás dejó la función nueva.'; end if;
  -- Sin el lote de la sección 3 (para medir lo mismo): todo en ROLLBACK.
  delete from public.conta_erp10_subcuenta_salida where company_id = c;
  delete from public.conta_erp10_salida_partida where company_id = c;
  delete from public.conta_erp10_salida_lote where company_id = c;
  select jsonb_object_agg(x ->> 'entry_id', jsonb_build_object('clase', x ->> 'clase', 'sale', x -> 'sale', 'importe', x -> 'importe'))
    into antes from jsonb_array_elements(public.conta_erp10_por_salir(c, '2026-10-01') -> 'partidas') x;
  if antes is distinct from despues then raise exception 'PRUEBA X08 · 5: por_salir cambia sin la función nueva (antes %, después %).', antes, despues; end if;
  raise notice 'PRUEBA X08 · 5 bien: vuelta atrás limpia; con la función y sin ella, las % partidas iguales en clase, «sale» e importe.', (select count(*) from jsonb_object_keys(despues));
  raise notice 'PRUEBA X08: 6 de 6 bien (0 a 5).';
end $$;

rollback;
