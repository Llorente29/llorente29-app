-- supabase/staging/sql/20261118_e03_de_quien_es_prueba.sql
--
-- SOLO STAGING. Prueba del E03 (20261118T1833_e03_de_quien_es,
-- 20261118T1835_e03_no_decide_solo y 20261118T1836_e03_lo_marcado_vuelve_a_pregunta), que el ensayo de staging pone
-- delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no
-- cambia. Lo que crea: supplier_invoice.recipient_answer, recipient_answered_at y
-- recipient_answered_by_name, public._conta_de_quien, public.conta_de_quien_es,
-- public.conta_recibida_de_quien, public.conta_recibida_pasar_a, la tabla
-- public.conta_e03_respaldo. Lo que cambia:
-- public._conta_iva_no_deducible_auto, public.tg_s01o2_iva_no_deducible,
-- public.conta_recibida_iva_no_deducible, public._conta_factura_segura,
-- public.conta_motivos_para_validar y public.conta_documentos_recibidos.
--
-- Monta dos cuentas inventadas: X, con dos sociedades (X1, B00000000, y X2,
-- A00000000), e Y, con una (Y1, A00000000 también: el mismo NIF en otra cuenta no
-- cuenta como «otra sociedad»). Recibidas de X1 con IVA, leídas de su papel:
--   1. Lo que crea y sus permisos.
--   2. Los cuatro casos, con el NIF leído en sus formas («ES-A00000000»,
--      « a0000 0000 », «b00000000»): otra sociedad, fuera, sin leer, la empresa;
--      y sin IVA, nada que preguntar. El disparador ya no marca ninguna.
--   3. La respuesta de una persona manda: no se pierde al cambiar su lectura ni
--      su proveedor; y desmarcar en la ficha de hoy también es una respuesta.
--   4. Con la pregunta sin contestar no se valida (de_quien_es) y en la lista
--      sale en «Por aclarar» con su etiqueta.
--   5. Pasarla a X2: la factura, su llegada y su apunte; no si tiene asiento
--      validado; una cuenta no la pasa a una sociedad de otra.
--   6. Lo que marcó Sumied solo vuelve a ser pregunta (1836), contado antes y
--      después con la misma vara (regla 31); lo de una persona y lo validado, no.
--   7. La vuelta atrás quita todo y deja las funciones como estaban.
--
-- Como el cliente: u (X) o w (Y) en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Montar X (X1 y X2) e Y (Y1) ----------------------------------------------------------------
do $$
declare
  u constant uuid := 'ae030000-0000-4000-8000-000000000001';
  w constant uuid := 'ae030000-0000-4000-8000-000000000002';
  x constant uuid := 'ae030000-0000-4000-8000-000000000010';
  y constant uuid := 'ae030000-0000-4000-8000-000000000020';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', z.id, 'authenticated', 'authenticated', z.correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    from (values (u, 'x@e03-prueba.test'), (w, 'y@e03-prueba.test')) z(id, correo);
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba E03 X', 'e03-prueba-x', 'active', 'otra_actividad', 'contabilidad'), (y, 'Prueba E03 Y', 'e03-prueba-y', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Admin X', now(), now()), (w, y, 'admin', true, 'Admin Y', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step, created_at) values
    ('ae030000-0000-4000-8000-000000000011', x, 'Prueba Uno, S.L.', 'B00000000', 'nombre', now() - interval '2 days'),
    ('ae030000-0000-4000-8000-000000000012', x, 'Prueba Dos Takeaway, S.L.', 'A00000000', 'nombre', now() - interval '1 day'),
    ('ae030000-0000-4000-8000-000000000021', y, 'Prueba Ajena, S.L.', 'A00000000', 'nombre', now());
end $$;

-- Una recibida de X1 leída de su papel, con el NIF del destinatario tal como se leyó y su IVA (o sin él).
create function pg_temp.e03_factura(p_n int, p_nif text, p_iva boolean default true, p_nombre text default 'Destinatario inventado') returns uuid language plpgsql as $f$
declare v uuid := ('ae030000-0000-4000-8000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.supplier_invoice (id, account_id, company_id, status, source, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, reading)
  values (v, 'ae030000-0000-4000-8000-000000000010', 'ae030000-0000-4000-8000-000000000011', 'en_revision', 'ocr', 'E03-' || p_n, date '2026-11-10',
          100, case when p_iva then 21 else 0 end, case when p_iva then 121 else 100 end,
          jsonb_build_object('factura', jsonb_build_object('destinatario', jsonb_build_object('nombre', p_nombre, 'nif', p_nif))));
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  values ('ae030000-0000-4000-8000-000000000010', v, case when p_iva then 21 else 0 end, 100, case when p_iva then 21 else 0 end);
  return v;
end $f$;
create function pg_temp.e03_caso(p uuid) returns text language sql as $f$ select coalesce(public._conta_de_quien(p)->>'caso', '-') || '/' || (public._conta_de_quien(p)->>'pregunta') $f$;
-- Un asiento de la factura (sin su ejercicio: la prueba solo mira su estado; las reglas del libro, fuera, como en la C04).
create function pg_temp.e03_asiento(p uuid, p_estado text) returns uuid language plpgsql as $f$
declare e uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason,
                                    number, validated_at, hash, chain_seq)
  select e, si.account_id, si.company_id, gen_random_uuid(), 2, date '2026-11-10', 'Prueba E03', 'supplier_invoice', si.id, p_estado, 'seguro', 'Prueba E03',
         case when p_estado = 'validado' then 900000 + (random() * 99999)::int end, case when p_estado = 'validado' then now() end,
         case when p_estado = 'validado' then md5(e::text) end, case when p_estado = 'validado' then 900000 + (random() * 99999)::int end
    from public.supplier_invoice si where si.id = p;
  set local session_replication_role = origin;
  return e;
end $f$;

-- 1 · Lo que crea y sus permisos ------------------------------------------------------------------------
do $$ begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name like 'recipient_answer%') <> 3 then
    raise exception 'PRUEBA E03 · 1: faltan las columnas de la respuesta.';
  end if;
  if has_function_privilege('authenticated', 'public._conta_de_quien(uuid)', 'execute')
     or has_function_privilege('anon', 'public.conta_recibida_pasar_a(uuid,uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_de_quien_es(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_recibida_de_quien(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_recibida_pasar_a(uuid,uuid,text)', 'execute') then
    raise exception 'PRUEBA E03 · 1: los permisos de las funciones no son los esperados.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'supplier_invoice_e03_respuesta'))
     <> 'CHECK ((recipient_answer = ANY (ARRAY[''es_de_esta''::text, ''deduce''::text, ''no_deduce''::text])))' then
    raise exception 'PRUEBA E03 · 1: el CHECK de la respuesta no es el esperado.';
  end if;
  raise notice '1 OK: las columnas, su CHECK y los permisos.';
end $$;

-- 2 · Los cuatro casos, con el NIF en sus formas; el disparador ya no marca nada -----------------------
do $$
declare f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; v_marcadas int; q jsonb;
begin
  f1 := pg_temp.e03_factura(1, 'ES-A00000000', true, 'PRUEBA DOS TAKEAWAY SL');
  f2 := pg_temp.e03_factura(2, ' f0000 0000 ', true, 'Alguien de fuera, S.L.');
  f3 := pg_temp.e03_factura(3, null, true, null);
  f4 := pg_temp.e03_factura(4, 'b00000000', true);
  f5 := pg_temp.e03_factura(5, 'F00000000', false);
  if pg_temp.e03_caso(f1) <> 'otra_sociedad/true' or pg_temp.e03_caso(f2) <> 'fuera/true' or pg_temp.e03_caso(f3) <> 'sin_leer/true'
     or pg_temp.e03_caso(f4) <> 'empresa/false' or pg_temp.e03_caso(f5) <> 'sin_iva/false' then
    raise exception 'PRUEBA E03 · 2: los casos no son los esperados: % % % % %', pg_temp.e03_caso(f1), pg_temp.e03_caso(f2), pg_temp.e03_caso(f3), pg_temp.e03_caso(f4), pg_temp.e03_caso(f5);
  end if;
  q := public._conta_de_quien(f1);
  if q->>'frase' <> 'Esta factura va a nombre de Prueba Dos Takeaway, S.L., no de Prueba Uno, S.L.' or q->>'sociedad_corta' <> 'Prueba Dos Takeaway'
     or (q->>'sociedad_id')::uuid <> 'ae030000-0000-4000-8000-000000000012' then
    raise exception 'PRUEBA E03 · 2: la otra sociedad no sale con su frase y su nombre corto: %', q;
  end if;
  if public._conta_de_quien(f2)->>'frase' <> 'Esta factura va a nombre de Alguien de fuera, S.L. (f0000 0000), no de Prueba Uno, S.L. Si no es vuestra, su IVA no se deduce.' then
    raise exception 'PRUEBA E03 · 2: la de fuera no dice su frase: %', public._conta_de_quien(f2)->>'frase';
  end if;
  if public._conta_de_quien(f3)->>'frase' <> 'No he podido leer a nombre de quién va esta factura. Míralo en el PDF.' then
    raise exception 'PRUEBA E03 · 2: la sin leer no dice su frase: %', public._conta_de_quien(f3)->>'frase';
  end if;
  select count(*) into v_marcadas from public.supplier_invoice where account_id = 'ae030000-0000-4000-8000-000000000010' and vat_non_deductible;
  if v_marcadas <> 0 then raise exception 'PRUEBA E03 · 2: el disparador ha marcado % como no deducibles por su cuenta.', v_marcadas; end if;
  raise notice '2 OK: otra sociedad, fuera, sin leer, la empresa y sin IVA, con el NIF en sus formas; frases: «%» · «%»; el disparador no marca ninguna.',
    q->>'frase', public._conta_de_quien(f2)->>'frase';
end $$;

-- 3 · La respuesta de una persona manda ---------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.conta_recibida_de_quien('ae030000-0000-4000-8000-000000000102', 'deduce', 'Admin X');
  if r->>'texto' not like 'Apuntado: su IVA se deduce. Lo decidió Admin X el %.' then raise exception 'PRUEBA E03 · 3: «se deduce» no lo confirma con su contenido: %', r; end if;
  r := public.conta_recibida_de_quien('ae030000-0000-4000-8000-000000000103', 'no_deduce', 'Admin X');
  if r->>'texto' not like 'Apuntado: su IVA no se deduce y va al gasto. Lo decidió Admin X el %.' then raise exception 'PRUEBA E03 · 3: «no se deduce» no lo confirma: %', r; end if;
  raise notice '3a OK: «%» · «%»', public.conta_de_quien_es('ae030000-0000-4000-8000-000000000102')->>'respuesta', r->>'texto';
end $$;
reset role;
do $$ declare f2 constant uuid := 'ae030000-0000-4000-8000-000000000102'; f3 constant uuid := 'ae030000-0000-4000-8000-000000000103'; begin
  -- Cambian su lectura y su proveedor: la respuesta sigue, y el disparador no las toca.
  insert into public.supplier (id, account_id, name) values ('ae030000-0000-4000-8000-000000000031', 'ae030000-0000-4000-8000-000000000010', 'Proveedor inventado');
  update public.supplier_invoice set reading = jsonb_set(reading, '{factura,destinatario,nif}', '"F11111111"'), supplier_id = 'ae030000-0000-4000-8000-000000000031' where id in (f2, f3);
  if (select vat_non_deductible from public.supplier_invoice where id = f2) or not (select vat_non_deductible from public.supplier_invoice where id = f3)
     or (select recipient_answer from public.supplier_invoice where id = f2) <> 'deduce' or (select recipient_answer from public.supplier_invoice where id = f3) <> 'no_deduce'
     or (public._conta_de_quien(f2)->>'pregunta')::boolean or (public._conta_de_quien(f3)->>'pregunta')::boolean then
    raise exception 'PRUEBA E03 · 3: la respuesta se ha perdido al cambiar su lectura o su proveedor: % · %', public._conta_de_quien(f2), public._conta_de_quien(f3);
  end if;
  raise notice '3b OK: cambiadas su lectura y su proveedor, la respuesta sigue (deduce / no_deduce) y no hay pregunta.';
end $$;
-- La ficha de hoy: desmarcar también es una respuesta.
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  perform public.conta_recibida_iva_no_deducible('ae030000-0000-4000-8000-000000000103', false, null, null, 'Admin X');
  if (select recipient_answer from public.supplier_invoice where id = 'ae030000-0000-4000-8000-000000000103') <> 'deduce' then
    raise exception 'PRUEBA E03 · 3: desmarcar en la ficha de hoy no queda como respuesta.';
  end if;
  raise notice '3c OK: desmarcar en la ficha de hoy queda como respuesta «deduce», de Admin X.';
end $$;
reset role;

-- 4 · Con la pregunta, no se valida; en la lista, «Por aclarar» con su etiqueta ---------------------
do $$ declare e uuid; m text; begin
  e := pg_temp.e03_asiento('ae030000-0000-4000-8000-000000000101', 'propuesto');
  select string_agg(codigo || ': ' || motivo, ' | ') into m from public.conta_motivos_para_validar(e) where codigo = 'de_quien_es';
  if m is null or m not like 'de_quien_es: Esta factura va a nombre de Prueba Dos Takeaway, S.L., no de Prueba Uno, S.L. Contesta en su ficha%' then
    raise exception 'PRUEBA E03 · 4: con la pregunta sin contestar, se podría validar: %', m;
  end if;
  if strpos(pg_get_functiondef('public._conta_factura_segura(uuid)'::regprocedure), 'E03 · Si va a nombre de otro y nadie lo ha contestado') = 0 then
    raise exception 'PRUEBA E03 · 4: «apunta sola» no mira la pregunta.';
  end if;
  delete from public.journal_entry where id = e;
  raise notice '4a OK: no se valida: «%»; y «apunta sola» la deja para una persona.', m;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare d jsonb; f jsonb; begin
  d := public.conta_documentos_recibidos('ae030000-0000-4000-8000-000000000011', date '2026-11-01', date '2026-11-30');
  select x into f from jsonb_array_elements(d->'filas') x where x->>'id' = 'ae030000-0000-4000-8000-000000000101';
  if f->>'estado' <> 'por_aclarar' or f->'de_quien'->>'caso' <> 'otra_sociedad' or f->>'porque' not like 'Esta factura va a nombre de Prueba Dos Takeaway%' then
    raise exception 'PRUEBA E03 · 4: en la lista no sale en «Por aclarar» con su etiqueta: %', f;
  end if;
  select x into f from jsonb_array_elements(d->'filas') x where x->>'id' = 'ae030000-0000-4000-8000-000000000104';
  if f->'de_quien' is not null and f->'de_quien' <> 'null'::jsonb then raise exception 'PRUEBA E03 · 4: la que va a nombre de la empresa lleva etiqueta: %', f; end if;
  raise notice '4b OK: en la lista, «%» con de_quien %; por aclarar: % (la de la empresa, sin etiqueta).', f->>'estado', (select x->'de_quien' from jsonb_array_elements(d->'filas') x where x->>'id' = 'ae030000-0000-4000-8000-000000000101'), d->'cifras'->>'por_aclarar';
end $$;
reset role;

-- 5 · Pasarla a la otra sociedad -------------------------------------------------------------------
do $$ begin
  insert into public.document_inbox (account_id, company_id, channel, status, file_path, file_name, supplier_invoice_id)
  values ('ae030000-0000-4000-8000-000000000010', 'ae030000-0000-4000-8000-000000000011', 'subida', 'factura',
          'ae030000-0000-4000-8000-000000000010/e03/1.pdf', 'e03-1.pdf', 'ae030000-0000-4000-8000-000000000101');
  perform pg_temp.e03_factura(6, 'A00000000');
  perform pg_temp.e03_asiento('ae030000-0000-4000-8000-000000000106', 'validado');
end $$;
-- Y no puede pasar la de X; X no la pasa a la sociedad de Y.
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_msg text; begin
  begin
    perform public.conta_recibida_pasar_a('ae030000-0000-4000-8000-000000000101', 'ae030000-0000-4000-8000-000000000021', 'Admin Y');
    raise exception 'PRUEBA E03 · 5: Y ha pasado una factura de X.';
  exception when insufficient_privilege then get stacked diagnostics v_msg = message_text;
  end;
  raise notice '5a OK: Y no pasa la de X: «%»', v_msg;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'ae030000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_msg text; r jsonb; v_c uuid; v_l uuid; n int; begin
  begin
    perform public.conta_recibida_pasar_a('ae030000-0000-4000-8000-000000000101', 'ae030000-0000-4000-8000-000000000021', 'Admin X');
    raise exception 'PRUEBA E03 · 5: X ha pasado su factura a una sociedad de Y.';
  exception when insufficient_privilege then get stacked diagnostics v_msg = message_text;
  end;
  begin
    perform public.conta_recibida_pasar_a('ae030000-0000-4000-8000-000000000106', 'ae030000-0000-4000-8000-000000000012', 'Admin X');
    raise exception 'PRUEBA E03 · 5: ha pasado una con su asiento validado.';
  exception when invalid_parameter_value then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'Tiene su asiento validado: anula el asiento antes de pasarla a Prueba Dos Takeaway, S.L.%' then raise exception 'PRUEBA E03 · 5: no dice por qué no: %', v_msg; end if;
  end;
  r := public.conta_recibida_pasar_a('ae030000-0000-4000-8000-000000000101', 'ae030000-0000-4000-8000-000000000012', 'Admin X');
  select company_id into v_c from public.supplier_invoice where id = 'ae030000-0000-4000-8000-000000000101';
  select company_id into v_l from public.document_inbox where supplier_invoice_id = 'ae030000-0000-4000-8000-000000000101';
  select count(*) into n from public.supplier_invoice_change where supplier_invoice_id = 'ae030000-0000-4000-8000-000000000101' and by_name = 'Admin X'
     and cambios @> '[{"campo": "sociedad", "antes": {"id": "ae030000-0000-4000-8000-000000000011"}, "ahora": {"id": "ae030000-0000-4000-8000-000000000012"}}]';
  if v_c <> 'ae030000-0000-4000-8000-000000000012' or v_l <> 'ae030000-0000-4000-8000-000000000012' or n <> 1
     or r->>'texto' <> 'Pasada a Prueba Dos Takeaway, S.L., con su PDF. Ya no está en esta lista.'
     or public.conta_de_quien_es('ae030000-0000-4000-8000-000000000101')->>'caso' <> 'empresa' then
    raise exception 'PRUEBA E03 · 5: no se ha pasado entera: factura %, llegada %, apunte %, %', v_c, v_l, n, r;
  end if;
  raise notice '5b OK: no a otra cuenta, no con asiento validado; pasada con su llegada y su apunte: «%»; en X2 ya va a nombre de la empresa.', r->>'texto';
end $$;
reset role;

-- 6 · Lo que marcó Sumied solo vuelve a ser pregunta (1836), con la misma vara antes y después -----
-- f7, marcada sola y sin asiento; f8, marcada por una persona en la ficha (con su apunte); f9, marcada sola con su asiento validado.
do $$ begin
  perform pg_temp.e03_factura(7, 'F00000000'); perform pg_temp.e03_factura(8, 'F00000000'); perform pg_temp.e03_factura(9, 'F00000000');
  update public.supplier_invoice set vat_non_deductible = true, vat_non_deductible_reason = 'no_a_nombre'
   where id in ('ae030000-0000-4000-8000-000000000107', 'ae030000-0000-4000-8000-000000000108', 'ae030000-0000-4000-8000-000000000109');
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values ('ae030000-0000-4000-8000-000000000010', 'ae030000-0000-4000-8000-000000000108', 'Admin X', 'guardar',
          '[{"campo": "iva_no_deducible", "antes": {"no_deducible": false}, "ahora": {"no_deducible": true, "motivo": "no_a_nombre"}}]');
  perform pg_temp.e03_asiento('ae030000-0000-4000-8000-000000000109', 'validado');
end $$;
-- La vara: cuántas de cada clase en f7, f8 y f9 (cuenta X, regla 9), antes y después.
create function pg_temp.e03_vara() returns jsonb language sql as $f$
  select jsonb_object_agg(k, n) from (
    select case when vat_non_deductible and vat_non_deductible_reason = 'no_a_nombre' then 'marcadas' else 'sin_marca' end
           || ' · ' || coalesce(recipient_answer, 'sin respuesta') as k, count(*) n
      from public.supplier_invoice where account_id = 'ae030000-0000-4000-8000-000000000010'
       and id in ('ae030000-0000-4000-8000-000000000107', 'ae030000-0000-4000-8000-000000000108', 'ae030000-0000-4000-8000-000000000109')
     group by 1) t
$f$;
create temp table e03_antes as select pg_temp.e03_vara() as v, (select count(*) from public.supplier_invoice_change where account_id = 'ae030000-0000-4000-8000-000000000010') as apuntes;
-- El fichero entero, otra vez (se puede pasar dos veces): es lo que hará el real.
\i supabase/migrations/20261118T1836_e03_lo_marcado_vuelve_a_pregunta.sql
create temp table e03_despues as select pg_temp.e03_vara() as v, (select count(*) from public.supplier_invoice_change where account_id = 'ae030000-0000-4000-8000-000000000010') as apuntes;
\i supabase/migrations/20261118T1836_e03_lo_marcado_vuelve_a_pregunta.sql
do $$
declare a jsonb := (select v from e03_antes); b jsonb := (select v from e03_despues); n_b int; n_c int;
begin
  if a <> '{"marcadas · sin respuesta": 3}'::jsonb or b <> '{"marcadas · no_deduce": 1, "marcadas · sin respuesta": 1, "sin_marca · sin respuesta": 1}'::jsonb then
    raise exception 'PRUEBA E03 · 6: antes % y después %', a, b;
  end if;
  if (select vat_non_deductible from public.supplier_invoice where id = 'ae030000-0000-4000-8000-000000000107')
     or not (public._conta_de_quien('ae030000-0000-4000-8000-000000000107')->>'pregunta')::boolean
     or not (public._conta_de_quien('ae030000-0000-4000-8000-000000000109')->>'solo_sumied')::boolean
     or (select recipient_answered_by_name from public.supplier_invoice where id = 'ae030000-0000-4000-8000-000000000108') <> 'Admin X'
     or (select count(*) from public.conta_e03_respaldo where account_id = 'ae030000-0000-4000-8000-000000000010') <> 2 then
    raise exception 'PRUEBA E03 · 6: no ha quedado como se espera.';
  end if;
  -- La segunda pasada no toca nada: ni la vara ni los apuntes.
  select count(*) into n_c from public.supplier_invoice_change where account_id = 'ae030000-0000-4000-8000-000000000010';
  n_b := (select apuntes from e03_despues);
  if pg_temp.e03_vara() <> b or n_c <> n_b then raise exception 'PRUEBA E03 · 6: la segunda pasada vuelve a tocar: % (apuntes % y %)', pg_temp.e03_vara(), n_b, n_c; end if;
  raise notice '6 OK: antes % · después % (la marcada sola vuelve a ser pregunta; la de la persona queda como su respuesta; la validada no se toca y dice «lo marcó Sumied solo»); la segunda pasada no toca nada.', a, b;
end $$;

-- 7 · La vuelta atrás ---------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261118T1836_e03_lo_marcado_vuelve_a_pregunta.down.sql
\i supabase/vuelta-atras/20261118T1835_e03_no_decide_solo.down.sql
\i supabase/vuelta-atras/20261118T1833_e03_de_quien_es.down.sql
do $$ begin
  if to_regprocedure('public._conta_de_quien(uuid)') is not null or to_regprocedure('public.conta_recibida_pasar_a(uuid,uuid,text)') is not null
     or to_regclass('public.conta_e03_respaldo') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_invoice' and column_name like 'recipient_answer%')
     or strpos(pg_get_functiondef('public.conta_documentos_recibidos(uuid,date,date)'::regprocedure), 'E03') > 0
     or strpos(pg_get_functiondef('public._conta_iva_no_deducible_auto(uuid)'::regprocedure), 'no_a_nombre') = 0 then
    raise exception 'PRUEBA E03 · 7: la vuelta atrás dejó algo.';
  end if;
  if (select vat_non_deductible_reason from public.supplier_invoice where id = 'ae030000-0000-4000-8000-000000000107') is distinct from 'no_a_nombre' then
    raise exception 'PRUEBA E03 · 7: la vuelta atrás no devuelve la marca de antes.';
  end if;
  raise notice '7 OK: la vuelta atrás quita las funciones, la tabla y las columnas, devuelve las seis funciones y la marca de antes.';
  raise notice 'PRUEBA E03: 7 de 7 bien.';
end $$;

rollback;
