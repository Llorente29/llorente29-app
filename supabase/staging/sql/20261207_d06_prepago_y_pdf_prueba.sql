-- supabase/staging/sql/20261207_d06_prepago_y_pdf_prueba.sql
--
-- SOLO STAGING. Prueba de 20261207T0800_d06_prepago_y_pdf_bueno (y de la 0810
-- y su vuelta atrás, que sin Foodint no hacen nada), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Datos de la empresa A de staging;
-- el proveedor, las lecturas y las llegadas son inventados dentro de la
-- transacción (la función no mira el almacén: la ruta es la de la llegada).
--
--   (Empieza con las dos vueltas atrás, por si la 0800 ya estuviera.)
--   0. Lo de antes: conta_factura_desde_lectura es la de producción (md5
--      c7e7811e…), y los CHECK de public.supplier y public.supplier_invoice no
--      admiten 'prepaid'.
--   1. La 0800 y la 0810 (sin Foodint, la 0810 no hace nada y lo dice).
--   2. 'prepaid' entra en supplier y en supplier_invoice; lo que no está en la
--      lista, sigue sin entrar.
--   3. El correo, como conta-facturas-entrada (service_role): la factura entra
--      con una FOTO; luego llega su PDF (el mismo proveedor, el mismo número
--      escrito con espacios y guion, y el mismo total): el PDF ocupa su sitio, la foto
--      queda en su historial (supplier_invoice_change, antes y ahora), su fila
--      del D02 se quita, la llegada queda «repetida» de ella, y NO hay otra
--      factura.
--   4. Lo que no se sustituye, como hasta hoy: el mismo PDF otra vez (ya tiene
--      PDF: «repetida»); otra con foto cuyo PDF trae OTRO total (no es la
--      misma: entra como otra, y la lista avisa de posible duplicada).
--   4b. Como usuario de B: no puede usar una llegada de A.
--   5. Las vueltas atrás: la función byte a byte (md5 de producción) y los
--      CHECK sin 'prepaid'. Y otra vez delante: su md5 nuevo.
-- No toca coste ni stock: no escribe líneas con artículo (sin los cuatro
-- caminos de la regla 10, que no pasan por aquí).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D06: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/vuelta-atras/20261207T0810_d06_riders_prepago.down.sql
\i supabase/vuelta-atras/20261207T0800_d06_prepago_y_pdf_bueno.down.sql

-- 0 · Lo de antes.
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef('public.conta_factura_desde_lectura(uuid,uuid)'::regprocedure)) into v_md5;
  if v_md5 <> 'c7e7811e385ce489612d491213276602' then raise exception 'PRUEBA D06 · 0: conta_factura_desde_lectura no es la de producción (%).', v_md5; end if;
  begin
    update public.supplier set payment_method = 'prepaid' where id = (select id from public.supplier where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
    raise exception 'PRUEBA D06 · 0: sin la 0800, supplier ya admite prepaid.';
  exception when check_violation then null;
  end;
  raise notice '0 · sin la 0800: la función de producción y ''prepaid'' no entra';
end $$;

-- 1 · La 0800 y la 0810.
\i supabase/migrations/20261207T0800_d06_prepago_y_pdf_bueno.sql
\i supabase/migrations/20261207T0810_d06_riders_prepago.sql

-- 2 · 'prepaid' entra; lo que no está en la lista, no.
do $$
declare v_p uuid := (select id from public.supplier where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
        v_i uuid := (select id from public.supplier_invoice where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
begin
  if v_p is null or v_i is null then raise exception 'PRUEBA D06 · 2: a la empresa A de staging le falta un proveedor o una recibida.'; end if;
  update public.supplier set payment_method = 'prepaid' where id = v_p;
  update public.supplier_invoice set payment_method = 'prepaid' where id = v_i;
  begin
    update public.supplier set payment_method = 'bizum' where id = v_p;
    raise exception 'PRUEBA D06 · 2: supplier admite una forma que no está en la lista.';
  exception when check_violation then null;
  end;
  begin
    update public.supplier_invoice set payment_method = 'bizum' where id = v_i;
    raise exception 'PRUEBA D06 · 2: supplier_invoice admite una forma que no está en la lista.';
  exception when check_violation then null;
  end;
  update public.supplier set payment_method = null where id = v_p;
  update public.supplier_invoice set payment_method = null where id = v_i;
  raise notice '2 · prepaid entra en supplier y supplier_invoice; «bizum» no';
end $$;

-- Las piezas (como postgres): un proveedor de A con NIF y las lecturas que dejaría ocr-albaran (modo factura).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := (select id from public.company where account_id = v_acc order by created_at limit 1);
  v_p uuid; v_s uuid;
  lect jsonb := '{"factura":{"proveedor":{"nombre":"Obrador Prueba D06, S.A.","nif":"A00000606"},"numero":"2403975","fecha":"2026-10-06","vencimiento":null,"clase":"completa","tipos":[{"tipo":10,"base":87.23,"cuota":8.72,"recargoTipo":null,"recargo":0}],"base":87.23,"cuota":8.72,"recargo":0,"retencion":null,"total":95.95},"comprobaciones":[{"id":"suma","ok":true,"grave":true,"texto":"Cuadra."}],"confianza":"seguro","porque":["Prueba D06."]}';
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Obrador Prueba D06', 'Obrador Prueba D06, S.A.', 'A00000606', true, 'Prueba D06') returning id into v_p;
  perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.p', v_p::text, true);
  -- foto: la factura entra con foto; pdf: su PDF («24 03-975»: el número escrito de otra forma); pdf2: el mismo PDF otra vez;
  -- foto2 / pdf_otro: otra factura con foto, y un PDF del mismo número con OTRO total.
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'photo', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', lect), 'prueba', 'pending_review') returning id into v_s;
  perform set_config('prueba.s_foto', v_s::text, true);
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', jsonb_set(lect, '{factura,numero}', '"24 03-975"')), 'prueba', 'pending_review') returning id into v_s;
  perform set_config('prueba.s_pdf', v_s::text, true);
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', lect), 'prueba', 'pending_review') returning id into v_s;
  perform set_config('prueba.s_pdf2', v_s::text, true);
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'photo', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', jsonb_set(lect, '{factura,numero}', '"D06-OTRA"')), 'prueba', 'pending_review') returning id into v_s;
  perform set_config('prueba.s_foto2', v_s::text, true);
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', jsonb_set(jsonb_set(lect, '{factura,numero}', '"D06-OTRA"'), '{factura,total}', '96.95')), 'prueba', 'pending_review') returning id into v_s;
  perform set_config('prueba.s_pdf_otro', v_s::text, true);
end $$;

-- 3 y 4 · El correo, como la función (service_role).
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := current_setting('prueba.e')::uuid;
  v_p uuid := current_setting('prueba.p')::uuid;
  l jsonb; r jsonb; v_inv uuid; v_inv2 uuid; f public.supplier_invoice; c record; v_n int;
  llegada constant text := 'facturas-prueba-d06@entrada.folvy.app';
begin
  -- La factura entra con FOTO.
  l := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d06-1', 'to', llegada,
         'ruta', v_acc::text || '/_correo/prueba-d06-1/01-foto.jpg', 'nombre', 'foto.jpg', 'tipo', 'image/jpeg', 'bytes', 1000, 'sha256', repeat('d6', 32)));
  r := public.conta_factura_desde_lectura((l->>'id')::uuid, current_setting('prueba.s_foto')::uuid);
  v_inv := (r->>'factura_id')::uuid;
  if r->>'estado' <> 'factura' or (select supplier_id from public.supplier_invoice where id = v_inv) <> v_p
     or (select raw_document_url from public.supplier_invoice where id = v_inv) not like '%.jpg' then
    raise exception 'PRUEBA D06 · 3: la factura con foto no entra como factura de su proveedor: %', r;
  end if;
  -- El D02 ya había hecho (o intentado) el PDF de la foto.
  insert into public.conta_recibida_pdf (invoice_id, account_id, attempts, last_error, next_try_at)
  values (v_inv, v_acc, 1, 'prueba D06: el PDF de la foto', now() + interval '1 hour');

  -- Llega su PDF: el mismo proveedor, «24 03-975» y el mismo total.
  l := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d06-2', 'to', llegada,
         'ruta', v_acc::text || '/_correo/prueba-d06-2/01-factura.pdf', 'nombre', 'factura.pdf', 'tipo', 'application/pdf', 'bytes', 2000, 'sha256', repeat('e7', 32)));
  r := public.conta_factura_desde_lectura((l->>'id')::uuid, current_setting('prueba.s_pdf')::uuid);
  select * into f from public.supplier_invoice where id = v_inv;
  if r->>'estado' <> 'pdf_sustituye_foto' or (r->>'factura_id')::uuid <> v_inv then
    raise exception 'PRUEBA D06 · 3: su PDF no sustituye a la foto: %', r;
  end if;
  if f.raw_document_url is distinct from v_acc::text || '/_correo/prueba-d06-2/01-factura.pdf' then
    raise exception 'PRUEBA D06 · 3: el documento de la factura no es el PDF (%).', f.raw_document_url;
  end if;
  select count(*) into v_n from public.supplier_invoice where account_id = v_acc and supplier_id = v_p;
  if v_n <> 1 then raise exception 'PRUEBA D06 · 3: se ha creado otra factura (% del proveedor).', v_n; end if;
  if exists (select 1 from public.conta_recibida_pdf where invoice_id = v_inv) then raise exception 'PRUEBA D06 · 3: su fila del D02 (el PDF de la foto) sigue ahí.'; end if;
  select * into c from public.supplier_invoice_change where supplier_invoice_id = v_inv;
  if c.what <> 'papel' or c.by_name <> 'Folvy' or c.cambios->0->>'antes' not like '%/01-foto.jpg' or c.cambios->0->>'ahora' not like '%/01-factura.pdf'
     or c.cambios->0->>'motivo' <> 'pdf_sustituye_foto' then
    raise exception 'PRUEBA D06 · 3: la foto no queda en su historial como documento anterior: %', to_jsonb(c);
  end if;
  if (select status from public.document_inbox where id = (l->>'id')::uuid) <> 'repetida'
     or (select duplicate_of_invoice_id from public.document_inbox where id = (l->>'id')::uuid) <> v_inv
     or not exists (select 1 from public.document_activity where inbox_id = (l->>'id')::uuid and action = 'corregida' and supplier_invoice_id = v_inv) then
    raise exception 'PRUEBA D06 · 3: la llegada del PDF no queda «repetida» de su factura, con su actividad.';
  end if;
  raise notice '3 · %', r->>'texto';

  -- 4 · El mismo PDF otra vez: ya tiene PDF → repetida, sin tocar nada.
  l := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d06-3', 'to', llegada,
         'ruta', v_acc::text || '/_correo/prueba-d06-3/01-otra-vez.pdf', 'nombre', 'otra-vez.pdf', 'tipo', 'application/pdf', 'bytes', 2100, 'sha256', repeat('f8', 32)));
  r := public.conta_factura_desde_lectura((l->>'id')::uuid, current_setting('prueba.s_pdf2')::uuid);
  if r->>'estado' <> 'repetida' or (select raw_document_url from public.supplier_invoice where id = v_inv) not like '%/01-factura.pdf'
     or (select count(*) from public.supplier_invoice_change where supplier_invoice_id = v_inv) <> 1 then
    raise exception 'PRUEBA D06 · 4: con su PDF ya puesto, otro PDF la cambia: %', r;
  end if;
  -- Otra con foto, y un PDF del mismo número con OTRO total: no es «la misma» (supplier_invoice_repetida pide el
  -- mismo total), así que entra como otra, como hasta hoy (la lista avisa de posible duplicada), y la foto se queda.
  l := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d06-4', 'to', llegada,
         'ruta', v_acc::text || '/_correo/prueba-d06-4/01-foto2.jpg', 'nombre', 'foto2.jpg', 'tipo', 'image/jpeg', 'bytes', 1000, 'sha256', repeat('a9', 32)));
  r := public.conta_factura_desde_lectura((l->>'id')::uuid, current_setting('prueba.s_foto2')::uuid);
  v_inv2 := (r->>'factura_id')::uuid;
  if r->>'estado' <> 'factura' then raise exception 'PRUEBA D06 · 4: la segunda con foto no entra: %', r; end if;
  l := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d06-5', 'to', llegada,
         'ruta', v_acc::text || '/_correo/prueba-d06-5/01-otro-total.pdf', 'nombre', 'otro-total.pdf', 'tipo', 'application/pdf', 'bytes', 1000, 'sha256', repeat('b1', 32)));
  r := public.conta_factura_desde_lectura((l->>'id')::uuid, current_setting('prueba.s_pdf_otro')::uuid);
  if r->>'estado' = 'pdf_sustituye_foto' or (r->>'factura_id')::uuid = v_inv2 or (select raw_document_url from public.supplier_invoice where id = v_inv2) not like '%/01-foto2.jpg' then
    raise exception 'PRUEBA D06 · 4: un PDF con otro total ha sustituido a la foto: %', r;
  end if;
  perform set_config('prueba.l_ultima', l->>'id', true);
  perform set_config('prueba.inv2', v_inv2::text, true);
  raise notice '4 · ya con su PDF: «repetida»; con otro total: entra como otra, como hasta hoy; y no se toca el documento de ninguna';
end $$;
reset role;

-- 4b · Como usuario de B (la pantalla de subir lo llama con la sesión): no lee ni toca lo de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_factura_desde_lectura(current_setting('prueba.l_ultima')::uuid, current_setting('prueba.s_pdf_otro')::uuid);
    raise exception 'PRUEBA D06 · 4b: B ha usado una llegada de A.';
  exception when insufficient_privilege then null;
  end;
  raise notice '4b · B no puede: «Solo un administrador o un encargado de la cuenta»';
end $$;
reset role;
do $$ begin
  if (select raw_document_url from public.supplier_invoice where id = current_setting('prueba.inv2')::uuid) not like '%/01-foto2.jpg' then
    raise exception 'PRUEBA D06 · 4b: lo de A ha cambiado.';
  end if;
end $$;

-- 5 · Las vueltas atrás, y otra vez delante.
\i supabase/vuelta-atras/20261207T0810_d06_riders_prepago.down.sql
\i supabase/vuelta-atras/20261207T0800_d06_prepago_y_pdf_bueno.down.sql
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef('public.conta_factura_desde_lectura(uuid,uuid)'::regprocedure)) into v_md5;
  if v_md5 <> 'c7e7811e385ce489612d491213276602' then raise exception 'PRUEBA D06 · 5: la vuelta atrás no deja la función byte a byte (%).', v_md5; end if;
  begin
    update public.supplier set payment_method = 'prepaid' where id = (select id from public.supplier where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
    raise exception 'PRUEBA D06 · 5: la vuelta atrás deja ''prepaid'' en supplier.';
  exception when check_violation then null;
  end;
end $$;
\i supabase/migrations/20261207T0800_d06_prepago_y_pdf_bueno.sql
\i supabase/migrations/20261207T0810_d06_riders_prepago.sql
do $$
declare v_md5 text;
begin
  select md5(pg_get_functiondef('public.conta_factura_desde_lectura(uuid,uuid)'::regprocedure)) into v_md5;
  if v_md5 <> '2279355e38145dd73f902a03e92e2808' then raise exception 'PRUEBA D06 · 5: otra vez delante, la función no es la de la 0800 (%).', v_md5; end if;
  raise notice '5 · la vuelta atrás, byte a byte y sin prepaid; y otra vez delante (md5 %)', v_md5;
end $$;

rollback;
