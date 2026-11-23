-- supabase/staging/sql/20261123_e10_lineas_por_partes_prueba.sql
--
-- SOLO STAGING. Prueba del E10 (20261123T0907_e10_lineas_por_partes), que el ensayo de staging pone delante en la
-- misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Lo que crea: public.conta_lectura_lineas_guardar.
--
-- Una cuenta inventada, su administrador u, una empresa, una lectura (sesión) de una factura larga leída por la
-- cabecera (sin líneas, «leyendo») y su factura. Por sus CAMINOS:
--   1. Lo que crea y los permisos.
--   2. Llegan las líneas: van a la sesión (parsed_result.lines y validation.lineas) y a la factura (tres líneas, en
--      su orden, con las mismas columnas que pone conta_factura_desde_lectura). Con la sesión de u.
--   3. «Leer las que faltan»: llegan otra vez, ahora cuatro: la factura tiene cuatro, ninguna repetida.
--   4. Una factura con una línea casada con un artículo no se toca, y se dice.
--   5. Otra persona (de otra cuenta) no puede; ni una lista que no es lista.
--   6. La vuelta atrás quita la función; las líneas guardadas se quedan.
--
-- Como el cliente: u en request.jwt.claims, con el rol authenticated.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E10: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La cuenta, su administrador, otra persona, la empresa, la lectura y su factura ---------
do $$
declare
  u constant uuid := 'ae100000-0000-4000-8000-000000000001';
  o constant uuid := 'ae100000-0000-4000-8000-000000000002';
  x constant uuid := 'ae100000-0000-4000-8000-000000000010';
  y constant uuid := 'ae100000-0000-4000-8000-000000000011';
  c constant uuid := 'ae100000-0000-4000-8000-000000000020';
  s constant uuid := 'ae100000-0000-4000-8000-000000000030';
  f constant uuid := 'ae100000-0000-4000-8000-000000000040';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'admin@e10-prueba.test',
          extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', o, 'authenticated', 'authenticated', 'otra@e10-prueba.test',
          extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
  insert into public.accounts (id, name, slug, status, business_type, product_brand) values
    (x, 'Prueba E10', 'e10-prueba', 'active', 'otra_actividad', 'contabilidad'),
    (y, 'Prueba E10 otra', 'e10-prueba-otra', 'active', 'otra_actividad', 'contabilidad');
  insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
  values (u, x, 'admin', true, 'Prueba E10', now(), now()), (o, y, 'admin', true, 'Prueba E10 otra', now(), now());
  insert into public.company (id, account_id, legal_name, tax_id, setup_step) values (c, x, 'Prueba E10, S.L.', 'B00000000', 'nombre');
  insert into public.goods_receipt_ai_session (id, account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (s, x, 'pdf', '[{"path":"e10/larga.pdf","bucket":"receipt-uploads"}]',
          '{"document":{"doc_number":"F-0000001","tax_base_total":100.00},"lines":[],"confidence":0.9}',
          '{"cuadra":null,"factura":{"factura":{"numero":"F-0000001"}},"lineas":{"estado":"leyendo","leidas":0,"esperadas":4}}', 'modelo-de-prueba', 'pending_review');
  insert into public.supplier_invoice (id, account_id, company_id, invoice_number, status, source, ai_session_id, tax_base_total, grand_total)
  values (f, x, c, 'F-0000001', 'en_revision', 'ocr', s, 100.00, 110.00);
end $$;

-- 1 · Lo que crea y los permisos ---------------------------------------------------------
do $$ begin
  if to_regprocedure('public.conta_lectura_lineas_guardar(uuid,jsonb,jsonb)') is null then raise exception 'PRUEBA E10 · 1: falta la función'; end if;
  if has_function_privilege('anon', 'public.conta_lectura_lineas_guardar(uuid,jsonb,jsonb)', 'execute') then raise exception 'PRUEBA E10 · 1: anon no puede'; end if;
  if not has_function_privilege('authenticated', 'public.conta_lectura_lineas_guardar(uuid,jsonb,jsonb)', 'execute') then raise exception 'PRUEBA E10 · 1: authenticated sí'; end if;
  raise notice 'PRUEBA E10 · 1 OK: la función, solo con sesión';
end $$;

-- 2 · Llegan las líneas, con la sesión de u -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare r jsonb; v jsonb;
  s constant uuid := 'ae100000-0000-4000-8000-000000000030';
  f constant uuid := 'ae100000-0000-4000-8000-000000000040';
begin
  r := public.conta_lectura_lineas_guardar(s,
    '[{"raw_text":"Artículo de prueba 1","quantity":2,"unit_price_net":10,"line_amount":20,"vat_pct":10,"lot_code":"L0001","expiry_date":"2026-12-01"},
      {"raw_text":"Artículo de prueba 2","quantity":3,"unit_price_net":10,"line_amount":30,"vat_pct":10,"lot_code":"L0002","expiry_date":"2026-12-02"},
      {"raw_text":"Artículo de prueba 3","quantity":1,"unit_price_net":25,"line_amount":25,"vat_pct":10,"lot_code":"L0003","expiry_date":"2026-12-03"}]',
    '{"cuadra":false,"factura":{"factura":{"numero":"F-0000001"}},"lineas":{"estado":"faltan","leidas":3,"esperadas":4,"sin_leer":[3]}}');
  if r->>'facturas' <> '1' or r->>'lineas' <> '3' then raise exception 'PRUEBA E10 · 2: devuelve %', r; end if;
  if (select count(*) from public.supplier_invoice_line where supplier_invoice_id = f) <> 3 then raise exception 'PRUEBA E10 · 2: la factura no tiene 3 líneas'; end if;
  if (select string_agg(raw_text || '·' || line_amount::text || '·' || position, ' | ' order by position) from public.supplier_invoice_line where supplier_invoice_id = f)
     <> 'Artículo de prueba 1·20·1 | Artículo de prueba 2·30·2 | Artículo de prueba 3·25·3' then raise exception 'PRUEBA E10 · 2: las líneas no son las leídas, en su orden'; end if;
  select validation into v from public.goods_receipt_ai_session where id = s;
  if v->'lineas'->>'estado' <> 'faltan' or v->'lineas'->>'leidas' <> '3' then raise exception 'PRUEBA E10 · 2: la sesión no dice cuántas: %', v->'lineas'; end if;
  if (select jsonb_array_length(parsed_result->'lines') from public.goods_receipt_ai_session where id = s) <> 3 then raise exception 'PRUEBA E10 · 2: la sesión no tiene sus líneas'; end if;
  if (select parsed_result->'lines'->0->>'lot_code' from public.goods_receipt_ai_session where id = s) <> 'L0001' then raise exception 'PRUEBA E10 · 2: el lote se ha perdido en la sesión'; end if;
  if (select parsed_result->'document'->>'doc_number' from public.goods_receipt_ai_session where id = s) <> 'F-0000001' then raise exception 'PRUEBA E10 · 2: la cabecera de la sesión ha cambiado'; end if;
  raise notice 'PRUEBA E10 · 2 OK: 3 líneas en la sesión (con su lote) y en la factura, en su orden; la sesión dice 3 de 4';
end $$;

-- 3 · «Leer las que faltan»: ahora cuatro, ninguna repetida --------------------------------
do $$
declare r jsonb;
  s constant uuid := 'ae100000-0000-4000-8000-000000000030';
  f constant uuid := 'ae100000-0000-4000-8000-000000000040';
begin
  r := public.conta_lectura_lineas_guardar(s,
    '[{"raw_text":"Artículo de prueba 1","quantity":2,"unit_price_net":10,"line_amount":20,"vat_pct":10},
      {"raw_text":"Artículo de prueba 2","quantity":3,"unit_price_net":10,"line_amount":30,"vat_pct":10},
      {"raw_text":"Artículo de prueba 3","quantity":1,"unit_price_net":25,"line_amount":25,"vat_pct":10},
      {"raw_text":"Artículo de prueba 4","quantity":5,"unit_price_net":5,"line_amount":25,"vat_pct":10}]',
    '{"cuadra":true,"lineas":{"estado":"completas","leidas":4,"esperadas":4,"sin_leer":[],"cuadre":{"suman":100,"base":100,"cuadra":true}}}');
  if (select count(*) from public.supplier_invoice_line where supplier_invoice_id = f) <> 4 then raise exception 'PRUEBA E10 · 3: la factura no tiene 4 líneas'; end if;
  if (select sum(line_amount) from public.supplier_invoice_line where supplier_invoice_id = f) <> 100 then raise exception 'PRUEBA E10 · 3: no suman la base'; end if;
  if (select validation->'lineas'->>'estado' from public.goods_receipt_ai_session where id = s) <> 'completas' then raise exception 'PRUEBA E10 · 3: la sesión no dice completas'; end if;
  raise notice 'PRUEBA E10 · 3 OK: 4 líneas, ninguna repetida, suman la base; la sesión dice completas';
end $$;

-- 4 · Una línea casada con un artículo: la factura no se toca ------------------------------
reset role;
do $$
declare
  f constant uuid := 'ae100000-0000-4000-8000-000000000040';
  ri uuid := (select id from public.recipe_item limit 1);
begin
  if ri is null then raise notice 'PRUEBA E10 · 4: no hay ningún artículo en esta base; se salta'; return; end if;
  update public.supplier_invoice_line set recipe_item_id = ri where supplier_invoice_id = f and position = 1;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ae100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
declare r jsonb;
  s constant uuid := 'ae100000-0000-4000-8000-000000000030';
  f constant uuid := 'ae100000-0000-4000-8000-000000000040';
begin
  if not exists (select 1 from public.supplier_invoice_line where supplier_invoice_id = f and recipe_item_id is not null) then
    raise notice 'PRUEBA E10 · 4: se salta (sin artículo)'; return;
  end if;
  r := public.conta_lectura_lineas_guardar(s, '[{"raw_text":"Otra","line_amount":1}]', '{"lineas":{"estado":"completas"}}');
  if r->>'casadas' <> '1' or r->>'facturas' <> '0' then raise exception 'PRUEBA E10 · 4: devuelve %', r; end if;
  if (select count(*) from public.supplier_invoice_line where supplier_invoice_id = f) <> 4 then raise exception 'PRUEBA E10 · 4: ha tocado una factura con una línea casada'; end if;
  raise notice 'PRUEBA E10 · 4 OK: con una línea casada, la factura no se toca y se dice (casadas 1)';
end $$;

-- 5 · Otra persona no puede; una lista que no es lista, tampoco ------------------------------
select set_config('request.jwt.claims', '{"sub":"ae100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.conta_lectura_lineas_guardar('ae100000-0000-4000-8000-000000000030', '[]', '{}');
    raise exception 'PRUEBA E10 · 5: otra cuenta ha podido';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"ae100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.conta_lectura_lineas_guardar('ae100000-0000-4000-8000-000000000030', '{"no":"lista"}', '{}');
    raise exception 'PRUEBA E10 · 5: ha aceptado una lista que no es lista';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PRUEBA E10 · 5 OK: otra cuenta no puede (42501) y una lista que no es lista para (22023)';
end $$;
reset role;

-- 6 · La vuelta atrás --------------------------------------------------------------------
\i supabase/vuelta-atras/20261123T0907_e10_lineas_por_partes.down.sql
do $$ begin
  if to_regprocedure('public.conta_lectura_lineas_guardar(uuid,jsonb,jsonb)') is not null then raise exception 'PRUEBA E10 · 6: la función sigue'; end if;
  if (select count(*) from public.supplier_invoice_line where supplier_invoice_id = 'ae100000-0000-4000-8000-000000000040') = 0 then raise exception 'PRUEBA E10 · 6: se han ido las líneas'; end if;
  raise notice 'PRUEBA E10 · 6 OK: la vuelta atrás quita la función y las líneas guardadas se quedan';
end $$;

rollback;
