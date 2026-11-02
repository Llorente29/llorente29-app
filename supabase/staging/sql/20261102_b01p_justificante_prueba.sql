-- ============================================================================
-- PRUEBA (staging) · B01 · Cola 1e (2140, solo añade): el justificante de un
-- pago. Todo en una transacción con ROLLBACK. Datos INVENTADOS (IBAN del banco
-- 9999, T11), en la cuenta D.
--
--   0. La vuelta atrás quita todo, y la 2140 lo vuelve a poner (dos veces).
--   1. Un pago que el banco no ha confirmado no lleva justificante; uno pagado,
--      sí: sale en «por hacer», sus datos llevan el IBAN tapado (4 últimos) y
--      el correo del proveedor; guardarlo dos veces deja uno.
--   2. El enlace público: con la clave entera, el PDF; con otra o una a medias,
--      nada; pasados los 30 días, «caducado».
--   3. La ficha de la factura: el administrador lo ve, con el teléfono y la
--      casilla «al pagar»; otra cuenta no ve nada.
--   4. Lo de servicio no lo llama nadie más; anon, nada.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

\i supabase/vuelta-atras/20261102T2140_b01p_justificante.down.sql
do $$ begin
  if to_regclass('public.conta_pago_justificante') is not null or to_regprocedure('public.conta_justificante_publico(text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'justificante_al_pagar') then
    raise exception 'PRUEBA B01 justificante · 0: la vuelta atrás no lo quita todo.';
  end if;
end $$;
\i supabase/migrations/20261102T2140_b01p_justificante.sql
\i supabase/migrations/20261102T2140_b01p_justificante.sql

create temp table _r (clave text primary key, v text) on commit drop;
grant all on _r to authenticated;
insert into _r values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('admin', 'c01d0000-0000-4000-8000-0000000000d1'), ('otra', 'c01b0000-0000-4000-8000-0000000000b1');

do $$
declare a uuid := (select v::uuid from _r where clave = 'cuenta'); e uuid := (select v::uuid from _r where clave = 'empresa');
  adm uuid := (select v::uuid from _r where clave = 'admin'); s uuid; f uuid; t uuid; l uuid; p1 uuid; p2 uuid;
begin
  insert into public.supplier (account_id, name, iban, justificante_al_pagar) values (a, 'Envases Prueba Justificante', 'ES0799990000000000002115', true) returning id into s;
  insert into public.supplier_contact (account_id, supplier_id, name, phone, email, is_primary)
    values (a, s, 'Administración', '600000000', 'pagos@ejemplo.invalid', true);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, grand_total, status)
    values (a, e, s, 'JUS-1', '2026-10-22', '2026-11-06', 120.50, 'en_revision') returning id into f;
  insert into public.treasury_account (account_id, company_id, kind, name, iban) values (a, e, 'bank', 'Revolut prueba justificante', 'ES5499990000000000009999') returning id into t;
  insert into public.conta_pago_lote (account_id, company_id, treasury_account_id, proveedor, estado, huella, created_by)
    values (a, e, t, 'revolut', 'enviado', repeat('a', 64), adm) returning id into l;
  insert into public.conta_pago_salida (account_id, company_id, lote_id, invoice_id, supplier_id, amount, beneficiario, iban, iban_check, concepto, estado)
    values (a, e, l, f, s, 120.50, 'Envases Prueba Justificante', 'ES0799990000000000002115', 'comprobado', 'JUS-1', 'enviada') returning id into p1;
  insert into _r values ('salida', p1::text), ('factura', f::text);
end $$;

-- 1 · Sin confirmar, no; pagado, sí.
do $$
declare p uuid := (select v::uuid from _r where clave = 'salida'); e uuid := (select v::uuid from _r where clave = 'empresa');
  d jsonb; g jsonb; g2 jsonb; ok boolean := false;
begin
  if public.conta_pago_justificante_por_hacer(e) @> to_jsonb(p::text) then raise exception 'PRUEBA B01 justificante · 1: un pago enviado sale como por hacer.'; end if;
  begin
    perform public.conta_pago_justificante_guardar(p, repeat('A', 43), 'x/justificantes/a.pdf');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'PRUEBA B01 justificante · 1: se guarda el justificante de un pago sin confirmar.'; end if;

  update public.conta_pago_salida set estado = 'pagada', estado_at = now(), banco_id = 'tx-prueba' where id = p;
  if not public.conta_pago_justificante_por_hacer(e) @> jsonb_build_array(p::text) then raise exception 'PRUEBA B01 justificante · 1: el pago pagado no sale como por hacer.'; end if;
  d := public.conta_pago_justificante_datos(p);
  if d->'proveedor'->>'iban4' <> '2115' or d->'proveedor'->>'iban_pais' <> 'ES' or d::text like '%0000000000002115%' then
    raise exception 'PRUEBA B01 justificante · 1: el IBAN no sale tapado (%).', d->'proveedor';
  end if;
  if d->'proveedor'->>'correo' <> 'pagos@ejemplo.invalid' or (d->'proveedor'->>'al_pagar')::boolean is distinct from true
     or (d->>'importe')::numeric <> 120.50 or d->'factura'->>'numero' <> 'JUS-1' or d->>'banco' <> 'Revolut' then
    raise exception 'PRUEBA B01 justificante · 1: los datos no son los esperados (%).', d;
  end if;
  g := public.conta_pago_justificante_guardar(p, repeat('A', 43), 'x/justificantes/a.pdf');
  g2 := public.conta_pago_justificante_guardar(p, repeat('B', 43), 'x/justificantes/b.pdf');
  if (g->>'nuevo')::boolean is distinct from true or (g2->>'nuevo')::boolean is distinct from false or g2->>'clave' <> repeat('A', 43) then
    raise exception 'PRUEBA B01 justificante · 1: guardarlo dos veces no deja uno (% / %).', g, g2;
  end if;
  if (select count(*) from public.conta_pago_justificante where salida_id = p) <> 1 then raise exception 'PRUEBA B01 justificante · 1: hay más de uno.'; end if;
  if public.conta_pago_justificante_por_hacer(e) @> jsonb_build_array(p::text) then raise exception 'PRUEBA B01 justificante · 1: sigue como por hacer.'; end if;
  ok := false;
  begin
    insert into public.conta_pago_justificante (account_id, company_id, salida_id, invoice_id, supplier_id, clave, pdf_path)
      select account_id, company_id, gen_random_uuid(), invoice_id, supplier_id, 'corta', 'x' from public.conta_pago_salida where id = p;
  exception when check_violation or foreign_key_violation then ok := true; end;
  if not ok then raise exception 'PRUEBA B01 justificante · 1: admite una clave corta.'; end if;
  perform public.conta_pago_justificante_correo((g->>'id')::uuid, 'pagos@ejemplo.invalid', 'Mandado el justificante a pagos@ejemplo.invalid.', null);
  if (select correo_a from public.conta_pago_justificante where salida_id = p) <> 'pagos@ejemplo.invalid' then raise exception 'PRUEBA B01 justificante · 1: no apunta el correo.'; end if;
end $$;

-- 2 · El enlace público.
do $$
declare r jsonb;
begin
  r := public.conta_justificante_publico(repeat('A', 43));
  if r->>'pdf_path' <> 'x/justificantes/a.pdf' or (r->>'caducado')::boolean then raise exception 'PRUEBA B01 justificante · 2: con la clave no da el PDF (%).', r; end if;
  if public.conta_justificante_publico(repeat('A', 42)) is not null or public.conta_justificante_publico(repeat('B', 43)) is not null
     or public.conta_justificante_publico('%') is not null then
    raise exception 'PRUEBA B01 justificante · 2: con otra clave da algo.';
  end if;
  update public.conta_pago_justificante set caduca_at = now() - interval '1 second' where clave = repeat('A', 43);
  if (public.conta_justificante_publico(repeat('A', 43))->>'caducado')::boolean is distinct from true then raise exception 'PRUEBA B01 justificante · 2: no caduca.'; end if;
end $$;

-- 3 · La ficha de la factura.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb := public.conta_factura_justificantes((select v::uuid from _r where clave = 'factura'));
begin
  if jsonb_array_length(r) <> 1 or r->0->>'telefono' <> '600000000' or (r->0->>'al_pagar')::boolean is distinct from true
     or r->0->>'clave' <> repeat('A', 43) or r->0->>'correo_a' <> 'pagos@ejemplo.invalid' then
    raise exception 'PRUEBA B01 justificante · 3: la ficha no lo enseña como se espera (%).', r;
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'otra'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if jsonb_array_length(public.conta_factura_justificantes((select v::uuid from _r where clave = 'factura'))) <> 0
     or exists (select 1 from public.conta_pago_justificante) then
    raise exception 'PRUEBA B01 justificante · 3: otra cuenta ve el justificante.';
  end if;
end $$;
reset role;

-- 4 · Quién llama a qué.
do $$
declare f text;
begin
  foreach f in array array['public.conta_pago_justificante_por_hacer(uuid)', 'public.conta_pago_justificante_datos(uuid)',
    'public.conta_pago_justificante_guardar(uuid,text,text)', 'public.conta_pago_justificante_correo(uuid,text,text,text)', 'public.conta_justificante_publico(text)'] loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') then
      raise exception 'PRUEBA B01 justificante · 4: % la puede llamar alguien que no es el servicio.', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.conta_factura_justificantes(uuid)', 'execute') then raise exception 'PRUEBA B01 justificante · 4: anon lee la ficha.'; end if;
  if has_table_privilege('authenticated', 'public.conta_pago_justificante', 'insert') or has_table_privilege('authenticated', 'public.conta_pago_justificante', 'update') then
    raise exception 'PRUEBA B01 justificante · 4: un usuario puede escribir en la tabla.';
  end if;
end $$;

select 'PRUEBA B01 cola 1e · el justificante de un pago: todo en verde' as resultado;
rollback;
