-- supabase/staging/sql/20261122_i01_presentar_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0150_i01_presentar (con la 0100 a la 0140
-- delante), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Contra el 303 de verdad de la empresa de prueba A (el 4T de 2026, de su
-- libro de IVA) y con un certificado de mentira creado solo aquí dentro (no
-- hay secreto en el Vault: lo que hace Hacienda lo prueba el doble, en
-- tests/conta/impuestos/hacienda.test.ts).
--
--   1. Revisar: la cuenta B no; la de A sí, y dice cuántos avisos quedan;
--      dar por bueno un aviso pide motivo; una revisada no se vuelve a revisar.
--   2. Preparar (lo que hace conta-hacienda antes de abrir el certificado):
--      el token tiene que ser de esa persona, para PRESENTAR, para ESA
--      declaración, y la declaración, revisada. Devuelve lo del fichero.
--   3. Presentada: solo con el uso del certificado de esa persona para esa
--      declaración, y con un CSV con forma de CSV. Queda «Presentado», con
--      quién, cómo y el CSV; en el registro, solo sus 4 últimos.
--   4. El justificante: en su carpeta, con su huella, subido de verdad, y uno.
--   5. «Ya lo presenté fuera» (el 3T): sin comprobar, se dice; comprobado sin
--      el uso de la consulta, no; y un CSV sin forma, no.
--   6. Quién llama: las de servicio no se llaman como persona.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA presentar: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql
\i supabase/migrations/20261122T0120_i01_obligaciones.sql
\i supabase/migrations/20261122T0130_i01_certificados.sql
\i supabase/migrations/20261122T0140_i01_calculo_303.sql
\i supabase/migrations/20261122T0150_i01_presentar.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated, service_role;

-- ── 1 · Revisar ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; v_r uuid; v_avisos int; k uuid;
begin
  v := public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  v_r := (v->>'declaracion')::uuid;
  perform public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  insert into _p values ('r4t', v_r::text), ('r3t', (select id::text from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2026 and period = '3T'));
  -- Dar por bueno un aviso: con motivo.
  select id into k from public.tax_return_check where tax_return_id = v_r and check_key = 'ledger_477_472';
  begin
    perform public.conta_impuesto_aviso_aceptar(k, '  ');
    raise exception 'PRUEBA presentar 1: un aviso se da por bueno sin motivo.';
  exception when sqlstate '22023' then null;
  end;
  v := public.conta_impuesto_aviso_aceptar(k, 'PRUEBA I01a: la recibida se apuntó el 24/09 y llegó el 01/10.');
  if (select accepted_reason from public.tax_return_check where id = k) <> 'PRUEBA I01a: la recibida se apuntó el 24/09 y llegó el 01/10.' then
    raise exception 'PRUEBA presentar 1: el aviso no queda dado por bueno.';
  end if;
  select count(*) into v_avisos from public.tax_return_check where tax_return_id = v_r and result = 'warning' and accepted_at is null;
  v := public.conta_impuesto_revisar(v_r);
  if (v->>'avisos_sin_aceptar')::int <> v_avisos or (select status from public.tax_return where id = v_r) <> 'reviewed' then
    raise exception 'PRUEBA presentar 1: revisar da %.', v;
  end if;
  begin
    perform public.conta_impuesto_revisar(v_r);
    raise exception 'PRUEBA presentar 1: se revisa dos veces.';
  exception when sqlstate '22023' then null;
  end;
  raise notice 'PRUEBA presentar 1: «%»', v->>'mensaje';
end $$;

select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
begin
  perform public.conta_impuesto_revisar((select val::uuid from _p where k = 'r3t'));
  raise exception 'PRUEBA presentar 1: la cuenta B revisa un 303 de A.';
exception when insufficient_privilege then
  raise notice 'PRUEBA presentar 1: la cuenta B no revisa los impuestos de A.';
end $$;

-- ── 2 · Un certificado de mentira y sus tokens ──────────────────────────────
reset role;
do $$
declare v_c uuid;
begin
  insert into public.tax_certificate (owner_account_id, subject_name, subject_tax_id_hash, subject_tax_id_tail, issuer, serial, valid_from, valid_to,
                                      fingerprint_sha256, kind, storage, vault_secret_id, uploaded_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', 'PRUEBA I01a', repeat('0', 64), '00T', 'AC DE PRUEBA', '01', now() - interval '1 day', now() + interval '1 year',
          repeat('1', 64), 'natural_person', 'vault', gen_random_uuid(), 'PRUEBA I01a')
  returning id into v_c;
  insert into _p values ('cert', v_c::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_c uuid := (select val::uuid from _p where k = 'cert'); v_r uuid := (select val::uuid from _p where k = 'r4t'); v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  insert into _p values
    ('t_file', public.conta_cert_confirmar(v_c, 'file', v_r, v_a)::text),
    ('t_test', public.conta_cert_confirmar(v_c, 'test', null, v_a)::text),
    ('t_otra', public.conta_cert_confirmar(v_c, 'file', (select val::uuid from _p where k = 'r3t'), v_a)::text),
    ('t_query3', public.conta_cert_confirmar(v_c, 'query', (select val::uuid from _p where k = 'r3t'), v_a)::text);
end $$;

-- ── 2 · Preparar (como conta-hacienda) ─────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  v_r uuid := (select val::uuid from _p where k = 'r4t'); v_u constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  v jsonb; t text; v_msg text;
begin
  foreach t in array array['t_test', 't_otra'] loop
    begin
      perform public.conta_impuesto_303_preparar(v_r, v_u, (select val::uuid from _p where k = t));
      raise exception 'PRUEBA presentar 2: prepara con el token %.', t;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform public.conta_impuesto_303_preparar(v_r, 'c01b0000-0000-4000-8000-0000000000b1', (select val::uuid from _p where k = 't_file'));
    raise exception 'PRUEBA presentar 2: prepara para la cuenta B.';
  exception when insufficient_privilege then null;
  end;
  v := public.conta_impuesto_303_preparar(v_r, v_u, (select val::uuid from _p where k = 't_file'));
  if v->>'tipo' <> 'C' or v->>'periodo' <> '4T' or (v->'casillas'->>'71')::numeric <> -102.66 or v->>'declaracion' <> v_r::text
     or v->>'cuenta' <> 'c01a0000-0000-4000-8000-00000000000a' then
    raise exception 'PRUEBA presentar 2: prepara %.', v - 'nif' - 'nombre';
  end if;
  -- El 3T está en borrador: no se presenta sin revisar.
  begin
    perform public.conta_impuesto_303_preparar((select val::uuid from _p where k = 'r3t'), v_u, (select val::uuid from _p where k = 't_otra'));
    raise exception 'PRUEBA presentar 2: prepara un borrador.';
  exception when sqlstate '22023' then get stacked diagnostics v_msg = message_text;
  end;
  raise notice 'PRUEBA presentar 2: tokens de otra acción, de otra declaración o de otra cuenta, no; el bueno da el fichero «C» con [71] −102,66; un borrador: «%»', v_msg;
end $$;

-- ── 3 · Presentada ──────────────────────────────────────────────────────────
reset role;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'r4t'); v_c uuid := (select val::uuid from _p where k = 'cert');
begin
  -- Los usos que deja conta_cert_abrir al abrir (aquí no hay secreto que abrir).
  insert into public.tax_certificate_use (certificate_id, owner_account_id, tax_return_id, company_id, user_id, user_name, action, result, message)
  values (v_c, 'c01a0000-0000-4000-8000-00000000000a', v_r, '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a1', 'PRUEBA', 'file', 'error', 'Sin terminar: la llamada a Hacienda no ha dicho cómo acabó.');
  insert into _p values ('uso', (select id::text from public.tax_certificate_use where certificate_id = v_c and action = 'file'));
  insert into public.tax_certificate_use (certificate_id, owner_account_id, tax_return_id, company_id, user_id, user_name, action, result, message)
  values (v_c, 'c01a0000-0000-4000-8000-00000000000a', v_r, '3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a1', 'PRUEBA', 'test', 'ok', 'PRUEBA');
  insert into _p values ('uso_test', (select id::text from public.tax_certificate_use where certificate_id = v_c and action = 'test'));
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare
  v_r uuid := (select val::uuid from _p where k = 'r4t'); v_u constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  v jsonb; r public.tax_return; e public.tax_return_event;
begin
  begin
    perform public.conta_impuesto_presentada(v_r, v_u, (select val::uuid from _p where k = 'uso_test'), 'PRUEBAI01ACSV001', '3032600000001', 'E1', now(), '{}');
    raise exception 'PRUEBA presentar 3: se apunta presentada con el uso de «probar».';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_impuesto_presentada(v_r, v_u, (select val::uuid from _p where k = 'uso'), 'corto', '3032600000001', 'E1', now(), '{}');
    raise exception 'PRUEBA presentar 3: se apunta presentada con un CSV sin forma.';
  exception when sqlstate '22023' then null;
  end;
  v := public.conta_impuesto_presentada(v_r, v_u, (select val::uuid from _p where k = 'uso'), 'PRUEBAI01ACSV001', '3032600000001', 'E1', now(), '{"avisos": []}');
  select * into r from public.tax_return where id = v_r;
  if r.status <> 'filed' or r.filed_via <> 'sumied' or r.presenter_kind <> 'company' or r.aeat_csv <> 'PRUEBAI01ACSV001' or r.aeat_receipt_number <> '3032600000001'
     or r.filed_by <> v_u or r.certificate_id <> (select val::uuid from _p where k = 'cert') then
    raise exception 'PRUEBA presentar 3: queda %, %, %, %.', r.status, r.filed_via, r.presenter_kind, r.aeat_csv;
  end if;
  select * into e from public.tax_return_event where tax_return_id = v_r and kind = 'aeat_call' and aeat_service = 'present';
  if e.result <> 'ok' or e.detail->>'csv_cola' <> 'V001' or e.detail::text like '%PRUEBAI01ACSV001%' or e.message like '%PRUEBAI01ACSV001%' then
    raise exception 'PRUEBA presentar 3: el registro guarda %.', e.detail;
  end if;
  if not exists (select 1 from public.tax_return_event where tax_return_id = v_r and kind = 'status' and to_status = 'filed') then
    raise exception 'PRUEBA presentar 3: el cambio a «Presentado» no está en el registro.';
  end if;
  begin
    perform public.conta_impuesto_presentada(v_r, v_u, (select val::uuid from _p where k = 'uso'), 'PRUEBAI01ACSV002', '3032600000002', 'E2', now(), '{}');
    raise exception 'PRUEBA presentar 3: se presenta dos veces.';
  exception when sqlstate '22023' then null;
  end;
  perform public.conta_impuesto_hacienda_apunte(v_r, v_u, 'receipt_pdf', 'error', null, 'PRUEBA I01a: Hacienda no da el justificante desde aquí.', '{}');
  raise notice 'PRUEBA presentar 3: «%»', v->>'mensaje';
end $$;

-- ── 4 · El justificante ─────────────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_r uuid := (select val::uuid from _p where k = 'r4t'); v_h constant text := repeat('ab', 32);
  v_ruta text := 'c01a0000-0000-4000-8000-00000000000a/impuestos/' || (select val from _p where k = 'r4t') || '/' || repeat('ab', 32) || '.pdf';
  v jsonb;
begin
  begin
    perform public.conta_impuesto_justificante_guardar(v_r, 'c01a0000-0000-4000-8000-00000000000a/otra/' || v_h || '.pdf', v_h, 1234);
    raise exception 'PRUEBA presentar 4: un justificante fuera de su carpeta.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.conta_impuesto_justificante_guardar(v_r, v_ruta, v_h, 1234);
    raise exception 'PRUEBA presentar 4: un justificante que no se ha subido.';
  exception when sqlstate 'P0002' then null;
  end;
  insert into storage.objects (bucket_id, name, metadata) values ('conta-documentos', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  begin
    perform public.conta_impuesto_justificante_guardar(v_r, v_ruta, v_h, 999);
    raise exception 'PRUEBA presentar 4: un justificante con otro tamaño.';
  exception when sqlstate '22023' then null;
  end;
  v := public.conta_impuesto_justificante_guardar(v_r, v_ruta, v_h, 1234);
  if (select receipt_document_path from public.tax_return where id = v_r) <> v_ruta then raise exception 'PRUEBA presentar 4: no queda enlazado.'; end if;
  if public.conta_impuesto_justificante_guardar(v_r, v_ruta, v_h, 1234)->>'mensaje' <> 'El justificante ya estaba guardado.' then
    raise exception 'PRUEBA presentar 4: guardar el mismo dos veces no lo dice.';
  end if;
  raise notice 'PRUEBA presentar 4: «%»', v->>'mensaje';
end $$;

-- ── 5 · «Ya lo presenté fuera» ──────────────────────────────────────────────
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'r3t'); v_u constant uuid := 'c01a0000-0000-4000-8000-0000000000a1'; v jsonb; r public.tax_return;
begin
  begin
    perform public.conta_impuesto_fuera(v_r, v_u, '12345', false, null, null, null);
    raise exception 'PRUEBA presentar 5: un CSV sin forma.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.conta_impuesto_fuera(v_r, v_u, 'PRUEBAI01ACSV003', true, '3032600000003', now(), (select val::uuid from _p where k = 'uso'));
    raise exception 'PRUEBA presentar 5: comprobada con el uso de otra cosa.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_impuesto_fuera(v_r, 'c01b0000-0000-4000-8000-0000000000b1', 'PRUEBAI01ACSV003', false, null, null, null);
    raise exception 'PRUEBA presentar 5: la cuenta B apunta un 303 de A.';
  exception when insufficient_privilege then null;
  end;
  v := public.conta_impuesto_fuera(v_r, v_u, 'prue bai01 acsv003', false, null, null, null);
  select * into r from public.tax_return where id = v_r;
  if r.status <> 'filed' or r.filed_via <> 'outside' or r.aeat_csv <> 'PRUEBAI01ACSV003' or r.outside_csv_pasted_at is null
     or v->>'mensaje' <> 'Apuntado como presentado fuera, con el CSV que has pegado. No se ha podido comprobar con Hacienda.'
     or not exists (select 1 from public.tax_return_event where tax_return_id = v_r and kind = 'note' and message like '%No se ha comprobado con Hacienda.') then
    raise exception 'PRUEBA presentar 5: fuera queda %, %, «%».', r.status, r.filed_via, v->>'mensaje';
  end if;
  raise notice 'PRUEBA presentar 5: «%»', v->>'mensaje';
end $$;

-- ── 6 · Las de servicio no se llaman como persona ──────────────────────────
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare f text; n int := 0;
begin
  foreach f in array array[
    'select public.conta_impuesto_gestiona(''c01a0000-0000-4000-8000-0000000000a1'', ''3b34403a-a7d6-4a48-a8d7-737e8cababdc'')',
    'select public.conta_impuesto_303_preparar(gen_random_uuid(), gen_random_uuid(), gen_random_uuid())',
    'select public.conta_impuesto_presentada(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), ''x'', null, null, null, null)',
    'select public.conta_impuesto_fuera(gen_random_uuid(), gen_random_uuid(), ''x'', false, null, null, null)',
    'select public.conta_impuesto_hacienda_apunte(gen_random_uuid(), gen_random_uuid(), ''present'', ''ok'', null, ''x'', null)'] loop
    begin
      execute f;
      raise exception 'PRUEBA presentar 6: una persona llama a %.', f;
    exception when insufficient_privilege then n := n + 1;
    end;
  end loop;
  raise notice 'PRUEBA presentar 6: % funciones de servicio, ninguna para una persona.', n;
end $$;

rollback;
