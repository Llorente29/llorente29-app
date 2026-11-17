-- supabase/staging/sql/20261117_n05c_sin_historico_prueba.sql
--
-- SOLO STAGING. Prueba del N05c (20261117T1655_n05c_sin_historico_decision y
-- 20261117T1656_n05c_sin_historico_validar), que el ensayo de staging pone delante en la misma
-- sesión. Todo en una transacción con ROLLBACK: staging no cambia. Datos INVENTADOS en la
-- empresa de la cuenta A, con su ejercicio 2026 traído a medias de ERP10 hasta el 31/10/2026
-- (conta_fijar_corte, como las sociedades del P01) y sin el histórico. Nombra el objeto que
-- cambia: public.conta_motivos_para_validar.
--
--   1. Permisos: las dos de la pantalla, para un usuario; la del día de inicio, no.
--   2. Sin decidir: un asiento del 05/11/2026 no se valida, con el motivo nuevo que dice qué hacer.
--   3. «Empezar a trabajar ya» (un administrador): el texto; y valida DE VERDAD un asiento del
--      05/11 y una recibida del 06/11 con su IVA (regla 10).
--   4. Uno anterior al día de inicio (15/10, sin IVA) sigue sin poder, con su porqué.
--   5. El cierre del ejercicio sigue necesitando lo de antes.
--   6. Retirar la decisión con un asiento ya validado se niega.
--   7. Las demás empresas no cambian: sus ejercicios, igual antes y después.
--   8. La vuelta atrás, sobre estos datos: la función vuelve a su cuerpo y la decisión sale.
--
-- con usuario: lo de la pantalla (decidir, retirar, proponer, validar y leer los motivos) se hace
-- como el administrador a1 de la cuenta A («set local role authenticated»); lo de preparar y mirar
-- lo que ha quedado, como el dueño.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N05c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- La medida de las demás empresas, antes (regla 31: la misma vara antes y después).
create temp table n05c_otras on commit drop as
  select y.id, md5(to_jsonb(y)::text) huella from public.fiscal_year y
   where y.account_id <> 'c01a0000-0000-4000-8000-00000000000a';

-- 1 · Permisos -----------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['conta_trabajar_sin_historico(uuid,text,text)', 'conta_trabajar_sin_historico_retirar(uuid,text)', '_conta_falta_historico_motivo(uuid)'] loop
    if not has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception 'PRUEBA N05c · 1: % no es solo para usuarios.', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public._conta_inicio_del_ejercicio(public.fiscal_year)', 'execute') then
    raise exception 'PRUEBA N05c · 1: _conta_inicio_del_ejercicio la puede ejecutar un usuario.';
  end if;
end $$;

-- Preparar (como el dueño): la empresa de la cuenta A, sin nada traído, con 2026 traído a medias de ERP10 hasta el 31/10.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_run uuid; r jsonb;
begin
  select co.id into c from public.company co
   where co.account_id = v_acc and not exists (select 1 from public.journal_entry e where e.company_id = co.id and e.source_type = 'migrated')
   order by co.created_at, co.id limit 1;
  if c is null then raise exception 'PRUEBA N05c: la cuenta A no tiene ninguna empresa sin asientos traídos.'; end if;
  perform set_config('n05c.empresa', c::text, true);
  if not exists (select 1 from public.fiscal_year where company_id = c and starts_on = '2026-01-01' and ends_on = '2026-12-31') then
    if exists (select 1 from public.fiscal_year where company_id = c and starts_on <= '2026-12-31' and ends_on >= '2026-01-01') then
      raise exception 'PRUEBA N05c: el ejercicio de 2026 de la empresa no va del 01/01 al 31/12.';
    end if;
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  end if;
  update public.fiscal_year set history_imported_at = null, works_without_history_at = null where company_id = c and code = '2026';
  update public.bank_settings set cutover_date = null where company_id = c;
  insert into public.import_run (account_id, company_id, program, kind) values (v_acc, c, 'otro', 'plan_cuentas') returning id into v_run;
  r := public.conta_diez_subcuentas(c, v_run, '[{"code":"62900000","nombre":"Otros servicios"},{"code":"57200000","nombre":"Bancos"},{"code":"60000000","nombre":"Compras"},{"code":"47200000","nombre":"IVA soportado"},{"code":"40000000","nombre":"Proveedores"}]');
  if jsonb_array_length(r -> 'rechazadas') <> 0 then raise exception 'PRUEBA N05c: las subcuentas de la prueba no entran: %.', r; end if;
  update public.import_run set status = 'hecho', finished_at = now() where id = v_run;
  perform public.conta_fijar_corte(c, '2026-10-31', 'erp10');
  if (select origin || '/' || origin_program || '/' || imported_until::text from public.fiscal_year where company_id = c and code = '2026')
     is distinct from 'mixed/erp10/2026-10-31' then
    raise exception 'PRUEBA N05c: el ejercicio no ha quedado traído a medias de ERP10 hasta el 31/10.';
  end if;
end $$;

-- Proponer un asiento (como la pantalla) y validarlo.
create or replace function pg_temp.asiento(p_fecha date, p_concepto text, p_tipo text default 'manual', p_origen uuid default null, p_lineas jsonb default null) returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := public.journal_entry_proponer(current_setting('n05c.empresa')::uuid,
    jsonb_build_object('series', case when p_tipo = 'supplier_invoice' then 2 else 3 end, 'fecha', p_fecha, 'concepto', p_concepto,
                       'source_type', p_tipo, 'source_id', p_origen, 'confianza', 'seguro', 'porque', 'Prueba N05c'),
    coalesce(p_lineas, jsonb_build_array(
      jsonb_build_object('cuenta', '62900000', 'debe', 100, 'haber', 0, 'comun', true),
      jsonb_build_object('cuenta', '57200000', 'debe', 0, 'haber', 100, 'comun', true))),
    null, 'Prueba N05c');
  return (r->>'id')::uuid;
end $$;
create or replace function pg_temp.motivo(p_entry uuid) returns text language sql as $$
  select string_agg(codigo || ': ' || motivo, ' | ' order by orden) from public.conta_motivos_para_validar(p_entry)
$$;

set local role authenticated;

-- 2 · Sin decidir: no se valida, y el motivo dice qué hacer -------------------------------------
do $$
declare v uuid; v_msg text;
begin
  v := pg_temp.asiento('2026-11-05', 'Prueba N05c · sin decidir');
  perform set_config('n05c.sin_decidir', v::text, true);
  begin
    perform public.journal_entry_validar(v, 'Prueba N05c');
    raise exception 'PRUEBA N05c · 2: sin decidir, se ha validado.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg is distinct from 'Lo anterior al 01/11/2026 todavía no se ha traído de ERP10. Tráelo, o decide empezar a trabajar ya en Ajustes › Ejercicio.' then
    raise exception 'PRUEBA N05c · 2: el motivo es «%».', v_msg;
  end if;
end $$;

-- 3 · Empezar a trabajar ya: valida de verdad un asiento y una recibida -------------------------
do $$
declare c uuid := current_setting('n05c.empresa')::uuid; r jsonb; v uuid; v_i uuid; v_iva uuid; v_e public.journal_entry;
begin
  r := public.conta_trabajar_sin_historico(c, '2026', 'Prueba N05c');
  if r->>'texto' is distinct from 'Hecho. Ya puedes contabilizar desde el 01/11/2026. Lo anterior lo traes cuando lo tengas.' then
    raise exception 'PRUEBA N05c · 3: el texto es «%».', r->>'texto';
  end if;
  v := current_setting('n05c.sin_decidir')::uuid;
  perform public.journal_entry_validar(v, 'Prueba N05c');
  select * into v_e from public.journal_entry where id = v;
  if v_e.status <> 'validado' or v_e.number is null or v_e.hash is null or v_e.hash = 'pendiente' then
    raise exception 'PRUEBA N05c · 3: el asiento del 05/11 no ha quedado validado y encadenado: %.', to_jsonb(v_e) - 'reasons';
  end if;
  -- Una recibida del 06/11, con su IVA al 21 %.
  select id into v_iva from public.tax_rate where rate = 21 and treatment = 'taxed' and valid_to is null order by name limit 1;
  insert into public.supplier_invoice (account_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', c, 'N05C-1', '2026-11-06', 'en_revision', 'manual', 121, 100, 21, 'Prueba N05c') returning id into v_i;
  v := pg_temp.asiento('2026-11-06', 'Prueba N05c · recibida', 'supplier_invoice', v_i, jsonb_build_array(
    jsonb_build_object('cuenta', '60000000', 'debe', 100, 'haber', 0, 'comun', true),
    jsonb_build_object('cuenta', '47200000', 'debe', 21, 'haber', 0, 'comun', true,
                       'iva', jsonb_build_object('tipo_id', v_iva, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
    jsonb_build_object('cuenta', '40000000', 'debe', 0, 'haber', 121, 'comun', true)));
  perform public.journal_entry_validar(v, 'Prueba N05c');
  select * into v_e from public.journal_entry where id = v;
  if v_e.status <> 'validado' or v_e.entry_date <> '2026-11-06' then
    raise exception 'PRUEBA N05c · 3: la recibida no ha quedado validada el 06/11: % (%).', v_e.status, v_e.entry_date;
  end if;
  perform set_config('n05c.recibida', v::text, true);
end $$;

-- 4 · Lo anterior al día de inicio sigue sin poder ------------------------------------------------
do $$
declare v uuid; v_msg text;
begin
  v := pg_temp.asiento('2026-10-15', 'Prueba N05c · de antes');
  begin
    perform public.journal_entry_validar(v, 'Prueba N05c');
    raise exception 'PRUEBA N05c · 4: un asiento del 15/10 se ha validado.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg is distinct from 'Este asiento es del 15/10/2026 y lo anterior al 01/11/2026 todavía no se ha traído de ERP10: no se contabiliza hasta traerlo.' then
    raise exception 'PRUEBA N05c · 4: el motivo es «%».', v_msg;
  end if;
end $$;

-- 5 · El cierre sigue necesitando lo de antes ------------------------------------------------------
reset role;
do $$
declare v uuid := pg_temp.asiento('2026-12-31', 'Prueba N05c · cierre');
begin
  update public.journal_entry set source_type = 'closing' where id = v;
  if coalesce(pg_temp.motivo(v), '') not like '%falta_historico: Para cerrar el ejercicio hace falta lo anterior al 01/11/2026, que todavía no se ha traído de ERP10. Tráelo antes de cerrar.%' then
    raise exception 'PRUEBA N05c · 5: un asiento de cierre no para por lo de antes: «%».', pg_temp.motivo(v);
  end if;
  delete from public.journal_entry where id = v;
end $$;
set local role authenticated;

-- 6 · Retirar la decisión con un asiento ya validado se niega --------------------------------------
do $$
declare c uuid := current_setting('n05c.empresa')::uuid; v_msg text;
begin
  begin
    perform public.conta_trabajar_sin_historico_retirar(c, '2026');
    raise exception 'PRUEBA N05c · 6: se ha retirado con asientos ya validados.';
  exception when check_violation then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg is distinct from 'No se puede retirar: ya hay 2 asientos contabilizados desde el 01/11/2026.' then
    raise exception 'PRUEBA N05c · 6: el motivo es «%».', v_msg;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 7 · Las demás empresas no cambian -----------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from (
    select y.id, md5(to_jsonb(y)::text) from public.fiscal_year y where y.account_id <> 'c01a0000-0000-4000-8000-00000000000a'
    except select id, huella from n05c_otras) x;
  if v_n <> 0 or (select count(*) from n05c_otras) <> (select count(*) from public.fiscal_year where account_id <> 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA N05c · 7: han cambiado % ejercicios de otras cuentas.', v_n;
  end if;
  raise notice 'PRUEBA N05c: 7 de 7 bien (% ejercicios de otras cuentas, iguales antes y después).', (select count(*) from n05c_otras);
end $$;

-- 8 · Las vueltas atrás, sobre estos datos ------------------------------------------------------------
\i supabase/vuelta-atras/20261117T1656_n05c_sin_historico_validar.down.sql
\i supabase/vuelta-atras/20261117T1655_n05c_sin_historico_decision.down.sql
do $$
begin
  if exists (select 1 from pg_proc where proname = 'conta_motivos_para_validar' and prosrc ~ 'N05c') then
    raise exception 'PRUEBA N05c · 8: conta_motivos_para_validar no ha vuelto a su cuerpo.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'fiscal_year' and column_name like 'works_without_history%')
     or to_regprocedure('public._conta_falta_historico_motivo(uuid)') is not null then
    raise exception 'PRUEBA N05c · 8: la vuelta atrás dejó la decisión o sus funciones.';
  end if;
  raise notice 'PRUEBA N05c · 8: las vueltas atrás, bien.';
end $$;
rollback;
