-- supabase/staging/sql/20261118_e04_pasar_sola_prueba.sql
--
-- SOLO STAGING. Prueba del E04 (20261118T1950_e04_pasar_sola,
-- 20261118T1951_e04_pasar_sola_al_leer y 20261118T1952_e04_las_que_esperan_se_pasan),
-- que el ensayo de staging pone delante en la misma sesión. Todo en una
-- transacción con ROLLBACK: staging no cambia. Lo que crea: public._conta_recibida_trabas,
-- public._conta_recibida_mover, public._conta_pasar_sola, public.conta_recibida_devolver,
-- public.conta_pasada_sola, public.conta_pasadas_solas, el disparador e04_pasar_sola
-- (public.tg_e04_pasar_sola) en public.supplier_invoice y la tabla public.conta_e04_respaldo.
-- Lo que cambia: public.conta_recibida_pasar_a (sobre lo común).
--
-- Monta dos cuentas inventadas: X, con dos sociedades (X1, B00000000, y X2,
-- A00000000), e Y, con una (Y1, G00000000). El disparador es DIFERIDO (actúa al
-- confirmar); aquí, que acaba en ROLLBACK, se le hace actuar con «set constraints
-- … immediate», que dispara en ese momento lo pendiente, como la confirmación.
--   1. Lo que crea y sus permisos.
--   2. Una que llega leída a nombre de X2 (factura, IVA y su llegada, como
--      conta_factura_desde_lectura) se pasa sola a X2, con su llegada, y lo apunta
--      Sumied con su porqué; la línea verde y el recuento de Inicio la ven.
--   3. «Deshacer» la devuelve a X1 con su llegada y apunta «Es de esta sociedad»:
--      aunque se vuelva a leer, ya no se mueve.
--   4. No se mueve: con asiento validado (sigue la pregunta), con un NIF de fuera,
--      con el NIF de su sociedad, sin leer, ni a una sociedad de otra cuenta; Y no
--      devuelve ni pasa una factura de X.
--   5. «Pasarla» del E03, sobre lo común, hace lo mismo que antes.
--   6. Las que esperaban al aplicar (1952), contadas antes y después con la misma
--      vara (regla 31): se pasan las de la pregunta en pie; la de asiento validado,
--      no; la segunda pasada no toca nada.
--   7. Las tres vueltas atrás quitan todo y dejan «Pasarla» como estaba.
--
-- Como el cliente: u (X) o w (Y) en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E04: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · Montar X (X1 y X2) e Y (Y1) ----------------------------------------------------------------
do $$
declare
  u constant uuid := 'ae040000-0000-4000-8000-000000000001';
  w constant uuid := 'ae040000-0000-4000-8000-000000000002';
  x constant uuid := 'ae040000-0000-4000-8000-000000000010';
  y constant uuid := 'ae040000-0000-4000-8000-000000000020';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', z.id, 'authenticated', 'authenticated', z.correo,
    extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
    from (values (u, 'x@e04-prueba.test'), (w, 'y@e04-prueba.test')) z(id, correo);
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba E04 X', 'e04-prueba-x', 'active', 'otra_actividad', 'contabilidad'), (y, 'Prueba E04 Y', 'e04-prueba-y', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Admin X', now(), now()), (w, y, 'admin', true, 'Admin Y', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step, created_at) values
    ('ae040000-0000-4000-8000-000000000011', x, 'Prueba Uno, S.L.', 'B00000000', 'nombre', now() - interval '2 days'),
    ('ae040000-0000-4000-8000-000000000012', x, 'Prueba Dos Takeaway, S.L.', 'A00000000', 'nombre', now() - interval '1 day'),
    ('ae040000-0000-4000-8000-000000000021', y, 'Prueba Ajena, S.L.', 'G00000000', 'nombre', now());
end $$;

-- Una recibida de X1 como la deja conta_factura_desde_lectura: la factura leída, su IVA y su llegada enlazada.
create function pg_temp.e04_llega(p_n int, p_nif text) returns uuid language plpgsql as $f$
declare v uuid := ('ae040000-0000-4000-8000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
begin
  insert into public.supplier_invoice (id, account_id, company_id, status, source, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, reading)
  values (v, 'ae040000-0000-4000-8000-000000000010', 'ae040000-0000-4000-8000-000000000011', 'en_revision', 'ocr', 'E04-' || p_n, date '2026-11-10', 100, 21, 121,
          jsonb_build_object('factura', jsonb_build_object('destinatario', jsonb_build_object('nombre', 'Destinatario inventado', 'nif', p_nif))));
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values ('ae040000-0000-4000-8000-000000000010', v, 21, 100, 21);
  insert into public.document_inbox (account_id, company_id, channel, status, file_path, file_name, supplier_invoice_id)
  values ('ae040000-0000-4000-8000-000000000010', 'ae040000-0000-4000-8000-000000000011', 'subida', 'factura',
          'ae040000-0000-4000-8000-000000000010/e04/' || p_n || '.pdf', 'e04-' || p_n || '.pdf', v);
  return v;
end $f$;
create function pg_temp.e04_sociedad(p uuid) returns text language sql as $f$
  select case si.company_id when 'ae040000-0000-4000-8000-000000000011' then 'X1' when 'ae040000-0000-4000-8000-000000000012' then 'X2' else si.company_id::text end
         || '/' || coalesce((select case d.company_id when 'ae040000-0000-4000-8000-000000000011' then 'X1' when 'ae040000-0000-4000-8000-000000000012' then 'X2' else '?' end
                               from public.document_inbox d where d.supplier_invoice_id = p), 'sin llegada')
    from public.supplier_invoice si where si.id = p
$f$;
-- Un asiento de la factura (sin su ejercicio: la prueba solo mira su estado; las reglas del libro, fuera, como en el E03).
create function pg_temp.e04_asiento(p uuid, p_estado text) returns uuid language plpgsql as $f$
declare e uuid := gen_random_uuid();
begin
  set local session_replication_role = replica;
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason,
                                    number, validated_at, hash, chain_seq)
  select e, si.account_id, si.company_id, gen_random_uuid(), 2, date '2026-11-10', 'Prueba E04', 'supplier_invoice', si.id, p_estado, 'seguro', 'Prueba E04',
         case when p_estado = 'validado' then 900000 + (random() * 99999)::int end, case when p_estado = 'validado' then now() end,
         case when p_estado = 'validado' then md5(e::text) end, case when p_estado = 'validado' then 900000 + (random() * 99999)::int end
    from public.supplier_invoice si where si.id = p;
  set local session_replication_role = origin;
  return e;
end $f$;

-- 1 · Lo que crea y sus permisos ------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'e04_pasar_sola' and tgrelid = 'public.supplier_invoice'::regclass and tgdeferrable and tginitdeferred) then
    raise exception 'PRUEBA E04 · 1: falta el disparador diferido e04_pasar_sola.';
  end if;
  if has_function_privilege('authenticated', 'public._conta_recibida_mover(uuid,uuid,text,boolean,text)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_pasar_sola(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._conta_recibida_trabas(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_recibida_devolver(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_pasada_sola(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.conta_pasadas_solas(uuid,timestamptz)', 'execute') then
    raise exception 'PRUEBA E04 · 1: los permisos de las funciones no son los esperados.';
  end if;
  raise notice '1 OK: el disparador diferido y los permisos.';
end $$;

-- 2 · Llega leída a nombre de X2: se pasa sola, con su llegada ---------------------------------------------
do $$ declare f uuid; begin
  f := pg_temp.e04_llega(1, 'ES-A00000000');
  if pg_temp.e04_sociedad(f) <> 'X1/X1' then raise exception 'PRUEBA E04 · 2: se ha movido antes de confirmar: %', pg_temp.e04_sociedad(f); end if;
end $$;
set constraints public.e04_pasar_sola immediate;   -- lo que haría la confirmación
set constraints public.e04_pasar_sola deferred;
do $$ declare f constant uuid := 'ae040000-0000-4000-8000-000000000101'; h jsonb; begin
  if pg_temp.e04_sociedad(f) <> 'X2/X2' then raise exception 'PRUEBA E04 · 2: no se ha pasado sola con su llegada: %', pg_temp.e04_sociedad(f); end if;
  select c into h from public.supplier_invoice_change x cross join lateral jsonb_array_elements(x.cambios) c where x.supplier_invoice_id = f and x.by_name = 'Sumied' and c->>'campo' = 'sociedad';
  if h is null or not (h->>'sola')::boolean or h->>'porque' <> 'va a nombre de Prueba Dos Takeaway, S.L. (A00000000)' or h->'antes'->>'nombre' <> 'Prueba Uno, S.L.' then
    raise exception 'PRUEBA E04 · 2: no lo apunta Sumied con su porqué: %', h;
  end if;
  raise notice '2a OK: pasada sola a X2 con su llegada; apunte de Sumied: %', h;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'ae040000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare r jsonb; p jsonb; begin
  r := public.conta_pasada_sola('ae040000-0000-4000-8000-000000000101');
  if r->>'texto' <> 'Pasada sola desde Prueba Uno, S.L.: va a nombre de Prueba Dos Takeaway, S.L. (A00000000).' then raise exception 'PRUEBA E04 · 2: la línea verde dice: %', r; end if;
  p := public.conta_pasadas_solas('ae040000-0000-4000-8000-000000000012', now() - interval '1 day');
  if (p->>'n')::int <> 1 or p->'ids'->>0 <> 'ae040000-0000-4000-8000-000000000101' then raise exception 'PRUEBA E04 · 2: Inicio no la cuenta: %', p; end if;
  if (public.conta_pasadas_solas('ae040000-0000-4000-8000-000000000011', now() - interval '1 day')->>'n')::int <> 0 then raise exception 'PRUEBA E04 · 2: la de la que sale también la cuenta.'; end if;
  raise notice '2b OK: la línea verde «%» y en Inicio de X2, %.', r->>'texto', p->>'n';
end $$;
reset role;

-- 3 · «Deshacer»: vuelve a X1 y ya no se mueve ---------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'ae040000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare r jsonb; begin
  r := public.conta_recibida_devolver('ae040000-0000-4000-8000-000000000101', 'Admin X');
  if r->>'texto' <> 'Devuelta a Prueba Uno, S.L. Ya no se moverá sola.' then raise exception 'PRUEBA E04 · 3: «Deshacer» dice: %', r; end if;
  raise notice '3a OK: «%»', r->>'texto';
end $$;
reset role;
do $$ declare f constant uuid := 'ae040000-0000-4000-8000-000000000101'; begin
  if pg_temp.e04_sociedad(f) <> 'X1/X1' or (select recipient_answer from public.supplier_invoice where id = f) <> 'es_de_esta' then
    raise exception 'PRUEBA E04 · 3: no ha vuelto con su llegada y su respuesta: %', pg_temp.e04_sociedad(f);
  end if;
  update public.supplier_invoice set reading = reading where id = f;   -- se vuelve a leer
end $$;
set constraints public.e04_pasar_sola immediate;
set constraints public.e04_pasar_sola deferred;
do $$ begin
  if pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000101') <> 'X1/X1' or public.conta_pasada_sola('ae040000-0000-4000-8000-000000000101') is not null then
    raise exception 'PRUEBA E04 · 3: devuelta, se ha vuelto a mover al leerla.';
  end if;
  raise notice '3b OK: devuelta, con su llegada y «es_de_esta»; vuelta a leer, no se mueve y no lleva línea verde.';
end $$;

-- 4 · Lo que no se mueve ------------------------------------------------------------------------------------
do $$ declare f2 uuid; f3 uuid; f4 uuid; f5 uuid; f6 uuid; begin
  f2 := pg_temp.e04_llega(2, 'A00000000'); perform pg_temp.e04_asiento(f2, 'validado');   -- con asiento validado
  f3 := pg_temp.e04_llega(3, 'F00000000');                                                -- de fuera
  f4 := pg_temp.e04_llega(4, 'b-00000000');                                               -- la suya
  f5 := pg_temp.e04_llega(5, null);                                                       -- sin leer
  f6 := pg_temp.e04_llega(6, 'G00000000');                                                -- una sociedad de OTRA cuenta
end $$;
set constraints public.e04_pasar_sola immediate;
set constraints public.e04_pasar_sola deferred;
do $$ begin
  if pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000102') <> 'X1/X1' or pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000103') <> 'X1/X1'
     or pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000104') <> 'X1/X1' or pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000105') <> 'X1/X1'
     or pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000106') <> 'X1/X1' then
    raise exception 'PRUEBA E04 · 4: se ha movido alguna que no debía.';
  end if;
  if public._conta_de_quien('ae040000-0000-4000-8000-000000000102')->>'caso' <> 'otra_sociedad' or (public._conta_de_quien('ae040000-0000-4000-8000-000000000102')->>'pregunta')::boolean
     or public._conta_de_quien('ae040000-0000-4000-8000-000000000106')->>'caso' <> 'fuera' then
    raise exception 'PRUEBA E04 · 4: los casos no son los esperados: % · %', public._conta_de_quien('ae040000-0000-4000-8000-000000000102'), public._conta_de_quien('ae040000-0000-4000-8000-000000000106');
  end if;
  raise notice '4a OK: no se mueven la de asiento validado, la de fuera, la suya, la sin leer ni la de una sociedad de otra cuenta (para X es «fuera»).';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'ae040000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare v_msg text; begin
  begin
    perform public.conta_recibida_devolver('ae040000-0000-4000-8000-000000000101', 'Admin Y');
    raise exception 'PRUEBA E04 · 4: Y ha devuelto una factura de X.';
  exception when insufficient_privilege then get stacked diagnostics v_msg = message_text;
  end;
  begin
    perform public.conta_recibida_pasar_a('ae040000-0000-4000-8000-000000000103', 'ae040000-0000-4000-8000-000000000021', 'Admin Y');
    raise exception 'PRUEBA E04 · 4: Y ha pasado una factura de X.';
  exception when insufficient_privilege then null;
  end;
  raise notice '4b OK: Y no devuelve ni pasa las de X: «%»', v_msg;
end $$;
reset role;

-- 5 · «Pasarla» del E03, sobre lo común -----------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'ae040000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ declare r jsonb; v_msg text; begin
  begin
    perform public.conta_recibida_pasar_a('ae040000-0000-4000-8000-000000000103', 'ae040000-0000-4000-8000-000000000021', 'Admin X');
    raise exception 'PRUEBA E04 · 5: X ha pasado su factura a una sociedad de Y.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_recibida_pasar_a('ae040000-0000-4000-8000-000000000102', 'ae040000-0000-4000-8000-000000000012', 'Admin X');
    raise exception 'PRUEBA E04 · 5: ha pasado una con su asiento validado.';
  exception when invalid_parameter_value then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg <> 'Tiene su asiento validado: anula el asiento antes de pasarla a Prueba Dos Takeaway, S.L.' then raise exception 'PRUEBA E04 · 5: no dice por qué no: %', v_msg; end if;
  r := public.conta_recibida_pasar_a('ae040000-0000-4000-8000-000000000103', 'ae040000-0000-4000-8000-000000000012', 'Admin X');
  if r->>'texto' <> 'Pasada a Prueba Dos Takeaway, S.L., con su PDF. Ya no está en esta lista.' or r ? 'sola' or r ? 'desde' then raise exception 'PRUEBA E04 · 5: «Pasarla» devuelve: %', r; end if;
  if public.conta_pasada_sola('ae040000-0000-4000-8000-000000000103') is not null then raise exception 'PRUEBA E04 · 5: la pasada a mano sale como pasada sola.'; end if;
  raise notice '5 OK: «Pasarla» igual que en el E03 («%», «%»); no lleva línea verde.', r->>'texto', v_msg;
end $$;
reset role;

-- 6 · Las que esperaban al aplicar (1952), con la misma vara antes y después ------------------------------------
-- f7 y f8: a nombre de X2, con la pregunta en pie y sin pasar (el disparador, pendiente: no se ha confirmado);
-- f9: a nombre de X2 con su asiento validado.
do $$ begin
  perform pg_temp.e04_llega(7, 'A00000000'); perform pg_temp.e04_llega(8, 'es a00000000'); perform pg_temp.e04_llega(9, 'A00000000');
  perform pg_temp.e04_asiento('ae040000-0000-4000-8000-000000000109', 'validado');
end $$;
create function pg_temp.e04_vara() returns jsonb language sql as $f$
  select jsonb_object_agg(k, n) from (
    select pg_temp.e04_sociedad(si.id) || ' · ' || case when coalesce((public._conta_de_quien(si.id)->>'pregunta')::boolean, false) then 'pregunta' else 'sin pregunta' end k, count(*) n
      from public.supplier_invoice si
     where si.account_id = 'ae040000-0000-4000-8000-000000000010'
       and si.id in ('ae040000-0000-4000-8000-000000000107', 'ae040000-0000-4000-8000-000000000108', 'ae040000-0000-4000-8000-000000000109')
     group by 1) t
$f$;
create temp table e04_antes as select pg_temp.e04_vara() v;
\i supabase/migrations/20261118T1952_e04_las_que_esperan_se_pasan.sql
create temp table e04_despues as select pg_temp.e04_vara() v, (select count(*) from public.supplier_invoice_change where account_id = 'ae040000-0000-4000-8000-000000000010') apuntes;
\i supabase/migrations/20261118T1952_e04_las_que_esperan_se_pasan.sql
do $$ declare a jsonb := (select v from e04_antes); b jsonb := (select v from e04_despues); begin
  -- f9 (validada) sigue en X1, sin pregunta (su asiento validado manda: la mira una persona en su ficha).
  if a <> '{"X1/X1 · pregunta": 2, "X1/X1 · sin pregunta": 1}'::jsonb or b <> '{"X2/X2 · sin pregunta": 2, "X1/X1 · sin pregunta": 1}'::jsonb then
    raise exception 'PRUEBA E04 · 6: antes % y después %', a, b;
  end if;
  if (select count(*) from public.conta_e04_respaldo where account_id = 'ae040000-0000-4000-8000-000000000010') <> 2
     or not exists (select 1 from public.supplier_invoice_change h where h.supplier_invoice_id = 'ae040000-0000-4000-8000-000000000107'
                     and h.by_name = 'Sumied' and h.cambios::text like '%al aplicar el E04%') then
    raise exception 'PRUEBA E04 · 6: no ha guardado su respaldo o su apunte.';
  end if;
  if pg_temp.e04_vara() <> b or (select count(*) from public.supplier_invoice_change where account_id = 'ae040000-0000-4000-8000-000000000010') <> (select apuntes from e04_despues) then
    raise exception 'PRUEBA E04 · 6: la segunda pasada vuelve a tocar.';
  end if;
  raise notice '6 OK: antes % · después % (la de asiento validado no se mueve); la segunda pasada no toca nada.', a, b;
end $$;

-- 7 · Las vueltas atrás -----------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261118T1952_e04_las_que_esperan_se_pasan.down.sql
\i supabase/vuelta-atras/20261118T1951_e04_pasar_sola_al_leer.down.sql
\i supabase/vuelta-atras/20261118T1950_e04_pasar_sola.down.sql
do $$ begin
  if to_regprocedure('public._conta_recibida_mover(uuid,uuid,text,boolean,text)') is not null or to_regprocedure('public._conta_pasar_sola(uuid)') is not null
     or to_regprocedure('public.conta_recibida_devolver(uuid,text)') is not null or to_regprocedure('public.tg_e04_pasar_sola()') is not null
     or exists (select 1 from pg_trigger where tgname = 'e04_pasar_sola') or to_regclass('public.conta_e04_respaldo') is not null
     or strpos(pg_get_functiondef('public.conta_recibida_pasar_a(uuid,uuid,text)'::regprocedure), '_conta_recibida_mover') > 0 then
    raise exception 'PRUEBA E04 · 7: la vuelta atrás dejó algo.';
  end if;
  if pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000107') <> 'X1/X1' or pg_temp.e04_sociedad('ae040000-0000-4000-8000-000000000108') <> 'X1/X1' then
    raise exception 'PRUEBA E04 · 7: la vuelta atrás no devuelve las pasadas al aplicar.';
  end if;
  raise notice '7 OK: las vueltas atrás quitan las funciones, el disparador y la tabla, devuelven las pasadas al aplicar y dejan «Pasarla» como estaba.';
  raise notice 'PRUEBA E04: 7 de 7 bien.';
end $$;

rollback;
