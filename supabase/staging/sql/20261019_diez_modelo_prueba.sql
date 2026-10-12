-- supabase/staging/sql/20261019_diez_modelo_prueba.sql
--
-- SOLO STAGING. Prueba de «C04b · T2»: la conexión por empresa
-- (20261019T0100, public.account_connector y connector_token_save /
-- connector_token_read / connector_mark_down) y el modelo de traer, enviar y
-- comparar (20261019T0110: import_run, journal_entry, external_send,
-- external_entry_snapshot, external_compare_day, external_document,
-- external_balance_witness).
-- Todo en una transacción con ROLLBACK: no cambia staging.
--
--   1. Lo de hoy sigue igual en account_connector: una conexión de cuenta, de
--      marca y de local se dan de alta como antes; los seis estados de antes
--      valen; el upsert por la clave única de antes sigue funcionando.
--   2. Por empresa: scope company sin empresa no entra; con empresa sí; la
--      misma empresa y conector dos veces no; una de cuenta con empresa no;
--      «down» vale.
--   3. El token: un usuario no puede guardarlo, leerlo ni marcar la caída;
--      el servidor lo guarda en Vault, lo lee, lo renueva sin crear otro
--      secreto, y la caída lo borra de Vault y deja la conexión «down».
--   4. El libro: el mismo asiento de Diez (empresa, programa, ejercicio,
--      serie, número) no entra dos veces; con otro ejercicio, sí.
--   5. Los envíos: como mucho 3 intentos; «enviado» exige la clave de Diez;
--      un asiento no se envía dos veces, salvo que el primero se rechazara.
--   6. Los documentos: «enlazado» exige fichero y asiento; «revisar» dice
--      por qué; «pendiente de Diez» es asiento sin fichero; el mismo fichero
--      no entra dos veces.
--   7. El testigo: saldo = debe − haber.
--   8. La comparación por día: una explicación lleva quién y cuándo.
--   9. RLS: A lee lo suyo; B no lee lo de A; nadie escribe desde el front.

begin;

select set_config('prueba.a', 'c01a0000-0000-4000-8000-00000000000a', true);
select set_config('prueba.b', 'c01b0000-0000-4000-8000-00000000000b', true);
select set_config('prueba.empresa', '567b0264-7895-47b3-b9f9-81fae8a4aa2c', true);
select set_config('prueba.ejercicio', 'dec0f1cb-6e6f-42ce-9780-e70071c063a8', true);

-- Un conector de prueba con la forma de los de hoy (staging no tiene ninguno).
insert into public.connector (code, name, category, connection_type, managed_by, direction, is_available, status)
values ('prueba_cuenta', 'Prueba (cuenta)', 'other', 'credentials', 'client', 'inbound', true, 'active');

-- ── 1 · Lo de hoy sigue igual ────────────────────────────────────────────────
do $$
declare v_c uuid := (select id from public.connector where code = 'prueba_cuenta');
        v_a uuid := current_setting('prueba.a')::uuid; v_s text;
begin
  insert into public.account_connector (account_id, connector_id, scope) values (v_a, v_c, 'account');
  foreach v_s in array array['available', 'requested', 'connecting', 'connected', 'paused', 'error'] loop
    update public.account_connector set status = v_s where account_id = v_a and connector_id = v_c and scope = 'account';
  end loop;
  -- El upsert de connectorService.upsertAccountConnector (onConflict de la clave de antes).
  insert into public.account_connector (account_id, connector_id, scope, brand_id, location_id, status)
  values (v_a, v_c, 'location', null, null, 'available')
  on conflict (account_id, connector_id, scope, brand_id, location_id) do update set status = excluded.status;
  if (select count(*) from public.account_connector where account_id = v_a and connector_id = v_c) <> 2 then
    raise exception 'PRUEBA diez · 1: las conexiones de cuenta y de local no se dan de alta como antes.';
  end if;
  raise notice 'PRUEBA diez · 1: account_connector de cuenta y de local como antes; los seis estados de antes valen.';
end $$;

-- ── 2 · Por empresa ────────────────────────────────────────────────────────
do $$
declare v_c uuid := (select id from public.connector where code = 'diez');
        v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid; v_id uuid;
begin
  if v_c is null then raise exception 'PRUEBA diez · 2: el conector «diez» no está en el catálogo.'; end if;
  begin
    insert into public.account_connector (account_id, connector_id, scope) values (v_a, v_c, 'company');
    raise exception 'PRUEBA diez · 2: una conexión de empresa sin empresa ha entrado.';
  exception when check_violation then null;
  end;
  insert into public.account_connector (account_id, connector_id, scope, company_id, external_account_id, status)
  values (v_a, v_c, 'company', v_e, 'C0009', 'connected') returning id into v_id;
  perform set_config('prueba.conexion', v_id::text, true);
  begin
    insert into public.account_connector (account_id, connector_id, scope, company_id) values (v_a, v_c, 'company', v_e);
    raise exception 'PRUEBA diez · 2: la misma empresa y conector han entrado dos veces.';
  exception when unique_violation then null;
  end;
  begin
    insert into public.account_connector (account_id, connector_id, scope, company_id) values (v_a, v_c, 'account', v_e);
    raise exception 'PRUEBA diez · 2: una conexión de cuenta con empresa ha entrado.';
  exception when check_violation then null;
  end;
  update public.account_connector set status = 'down' where id = v_id;
  update public.account_connector set status = 'connected' where id = v_id;
  raise notice 'PRUEBA diez · 2: por empresa, una por empresa y conector; «down» vale.';
end $$;

-- ── 3 · El token ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_id uuid := current_setting('prueba.conexion')::uuid; v_f text; v_mal text[] := '{}';
begin
  foreach v_f in array array[
    format('select public.connector_token_save(%L, %L, now())', v_id, 'x'),
    format('select public.connector_token_read(%L)', v_id),
    format('select public.connector_mark_down(%L, %L)', v_id, 'x')] loop
    begin
      execute v_f;
      v_mal := v_mal || v_f;
    exception when insufficient_privilege then null;
    end;
  end loop;
  if cardinality(v_mal) > 0 then raise exception 'PRUEBA diez · 3: un usuario puede llamar a: %', v_mal; end if;
end $$;
reset role;
do $$
declare v_id uuid := current_setting('prueba.conexion')::uuid; v_ref text; v_ref2 text; v_t jsonb;
begin
  perform public.connector_token_save(v_id, 'token-uno', now() + interval '14 days');
  select token_ref into v_ref from public.account_connector where id = v_id;
  v_t := public.connector_token_read(v_id);
  if v_t->>'token' <> 'token-uno' then raise exception 'PRUEBA diez · 3: el token leído no es el guardado.'; end if;
  perform public.connector_token_save(v_id, 'token-dos', now() + interval '14 days');
  select token_ref into v_ref2 from public.account_connector where id = v_id;
  if v_ref2 <> v_ref or public.connector_token_read(v_id)->>'token' <> 'token-dos' then
    raise exception 'PRUEBA diez · 3: renovar el token ha creado otro secreto o no lo ha cambiado.';
  end if;
  if (select count(*) from vault.secrets where name = 'connector-token:' || v_id::text) <> 1 then
    raise exception 'PRUEBA diez · 3: hay más de un secreto de token para la conexión.';
  end if;
  perform public.connector_mark_down(v_id, 'Error 9 - la renovación falló');
  if (select status from public.account_connector where id = v_id) <> 'down'
     or (select token_ref from public.account_connector where id = v_id) is not null
     or exists (select 1 from vault.secrets where id = v_ref::uuid) then
    raise exception 'PRUEBA diez · 3: la caída no deja «down», sin token y sin secreto.';
  end if;
  if public.connector_token_read(v_id) is not null then raise exception 'PRUEBA diez · 3: tras la caída aún se lee un token.'; end if;
  raise notice 'PRUEBA diez · 3: el token, solo el servidor; se renueva en el mismo secreto; la caída lo borra y deja «down».';
end $$;

-- ── 4 · El libro: el mismo asiento de Diez no entra dos veces ──────────────────
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
        v_y uuid := current_setting('prueba.ejercicio')::uuid; v_id uuid;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    external_program, external_year, external_series, external_number, external_hash)
  values (v_a, v_e, v_y, 1, '2026-09-15', 'Traído de Diez (prueba)', 'migrated', 'borrador', 'diez', '2026', '1', '1234', 'h1')
  returning id into v_id;
  perform set_config('prueba.asiento', v_id::text, true);
  begin
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                      external_program, external_year, external_series, external_number)
    values (v_a, v_e, v_y, 1, '2026-09-15', 'Otra vez', 'migrated', 'borrador', 'diez', '2026', '1', '1234');
    raise exception 'PRUEBA diez · 4: el mismo asiento de Diez ha entrado dos veces.';
  exception when unique_violation then null;
  end;
  -- El mismo número en otro ejercicio es otro asiento.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    external_program, external_year, external_series, external_number)
  values (v_a, v_e, v_y, 1, '2026-09-15', 'Mismo número, otro ejercicio', 'migrated', 'borrador', 'diez', '2025', '1', '1234');
  raise notice 'PRUEBA diez · 4: (empresa, programa, ejercicio, serie, número) es único; con otro ejercicio entra.';
end $$;

-- ── 5 · Los envíos ─────────────────────────────────────────────────────────────
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
        v_en uuid := current_setting('prueba.asiento')::uuid;
begin
  begin
    insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, attempts) values (v_a, v_e, v_en, 'asiento', 'p', 4);
    raise exception 'PRUEBA diez · 5: un envío con 4 intentos ha entrado.';
  exception when check_violation then null;
  end;
  begin
    insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, status) values (v_a, v_e, v_en, 'asiento', 'p', 'enviado');
    raise exception 'PRUEBA diez · 5: «enviado» sin la clave de Diez ha entrado.';
  exception when check_violation then null;
  end;
  insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, status, attempts, last_error)
  values (v_a, v_e, v_en, 'asiento', 'p', 'rechazado', 3, 'rechazado por Diez');
  insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash, status, ext_year, ext_series, ext_number, sent_at)
  values (v_a, v_e, v_en, 'asiento', 'p', 'enviado', '2026', 'FOLVY', 1, now());
  begin
    insert into public.external_send (account_id, company_id, entry_id, kind, payload_hash) values (v_a, v_e, v_en, 'asiento', 'p');
    raise exception 'PRUEBA diez · 5: un asiento se ha enviado dos veces.';
  exception when unique_violation then null;
  end;
  raise notice 'PRUEBA diez · 5: como mucho 3 intentos; enviado con su clave; una vez por asiento (lo rechazado no cuenta).';
end $$;

-- ── 6 · Los documentos ─────────────────────────────────────────────────────────
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
        v_en uuid := current_setting('prueba.asiento')::uuid;
begin
  begin
    insert into public.external_document (account_id, company_id, source, status, entry_id) values (v_a, v_e, 'diez_zip', 'enlazado', v_en);
    raise exception 'PRUEBA diez · 6: «enlazado» sin fichero ha entrado.';
  exception when check_violation then null;
  end;
  begin
    insert into public.external_document (account_id, company_id, source, status, storage_path, sha256) values (v_a, v_e, 'diez_zip', 'revisar', 'x/a.pdf', 's1');
    raise exception 'PRUEBA diez · 6: «revisar» sin porqué ha entrado.';
  exception when check_violation then null;
  end;
  insert into public.external_document (account_id, company_id, source, status, entry_id) values (v_a, v_e, 'diez_api', 'pendiente_diez', v_en);
  insert into public.external_document (account_id, company_id, source, status, storage_path, sha256, reason)
  values (v_a, v_e, 'diez_zip', 'revisar', 'x/a.pdf', 's1', 'ninguna factura con esa serie, número y NIF');
  begin
    insert into public.external_document (account_id, company_id, source, status, storage_path, sha256, reason)
    values (v_a, v_e, 'diez_zip', 'revisar', 'x/b.pdf', 's1', 'el mismo fichero');
    raise exception 'PRUEBA diez · 6: el mismo fichero ha entrado dos veces.';
  exception when unique_violation then null;
  end;
  raise notice 'PRUEBA diez · 6: enlazado con fichero y asiento; revisar con porqué; pendiente de Diez sin fichero; un fichero, una vez.';
end $$;

-- ── 7 · El testigo ─────────────────────────────────────────────────────────────
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
begin
  begin
    insert into public.external_balance_witness (account_id, company_id, source, as_of, account_code, debit, credit, balance)
    values (v_a, v_e, 'diez_excel', '2025-12-31', '57200000', 100, 40, 70);
    raise exception 'PRUEBA diez · 7: un saldo que no es debe − haber ha entrado.';
  exception when check_violation then null;
  end;
  insert into public.external_balance_witness (account_id, company_id, source, as_of, account_code, debit, credit, balance)
  values (v_a, v_e, 'diez_excel', '2025-12-31', '57200000', 100, 40, 60);
  raise notice 'PRUEBA diez · 7: el testigo exige saldo = debe − haber.';
end $$;

-- ── 8 · La comparación por día ───────────────────────────────────────────────
do $$
declare v_a uuid := current_setting('prueba.a')::uuid; v_e uuid := current_setting('prueba.empresa')::uuid;
begin
  begin
    insert into public.external_compare_day (account_id, company_id, day, status, explanation) values (v_a, v_e, '2026-10-01', 'distinto', 'sin quién');
    raise exception 'PRUEBA diez · 8: una explicación sin cuándo ha entrado.';
  exception when check_violation then null;
  end;
  insert into public.external_compare_day (account_id, company_id, day, status) values (v_a, v_e, '2026-10-01', 'igual');
  insert into public.import_run (account_id, company_id, program, kind, period_from, period_to) values (v_a, v_e, 'diez', 'historico', '2023-10-01', '2026-09-30');
  raise notice 'PRUEBA diez · 8: una explicación lleva quién y cuándo.';
end $$;

-- ── 9 · RLS ──────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('prueba.lee_a', (select (select count(*) from public.import_run) + (select count(*) from public.external_send)
  + (select count(*) from public.external_document) + (select count(*) from public.external_compare_day)
  + (select count(*) from public.external_balance_witness))::text, true);
do $$ begin
  begin
    insert into public.import_run (account_id, company_id, program, kind) values (current_setting('prueba.a')::uuid, current_setting('prueba.empresa')::uuid, 'diez', 'al_dia');
    raise exception 'PRUEBA diez · 9: un usuario ha escrito en import_run.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
select set_config('prueba.lee_b', (select (select count(*) from public.import_run) + (select count(*) from public.external_send)
  + (select count(*) from public.external_document) + (select count(*) from public.external_compare_day)
  + (select count(*) from public.external_balance_witness))::text, true);
reset role;
do $$ begin
  -- A: 1 lectura + 2 envíos + 2 documentos + 1 día + 1 testigo = 7.
  if current_setting('prueba.lee_a')::int <> 7 then raise exception 'PRUEBA diez · 9: A lee % filas suyas (se esperaban 7).', current_setting('prueba.lee_a'); end if;
  if current_setting('prueba.lee_b')::int <> 0 then raise exception 'PRUEBA diez · 9: B lee % filas de A.', current_setting('prueba.lee_b'); end if;
  raise notice 'PRUEBA diez · 9: A lee sus 7 filas; B, 0; nadie escribe desde el front.';
end $$;

rollback;
