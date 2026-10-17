-- supabase/staging/sql/20261119_d01_facturas_correo_prueba.sql
--
-- SOLO STAGING. Prueba de 20261119T0100 (las facturas por correo) y de
-- 20261119T0110 (los datos de Foodint), con correos inventados y paso a paso
-- como los hace conta-facturas-entrada (con la clave de servicio). Todo en una
-- transacción con ROLLBACK: staging no cambia.
--
-- Cambian en caliente, y aquí se prueban por su nombre: public.conta_entrada_llegada.
-- Se añaden y aquí se prueban: public.conta_entrada_remitente y
-- public.company_inbound_sender.
--
--   0. La 0110 de verdad, sobre la cuenta A (d01_facturas.*): su dirección de
--      facturas, encendida, y el remitente de los justificantes, por su huella.
--   1. La factura: llega reenviada, su remitente no frena nada, entra y se lee.
--   2. La misma factura en otro correo, con el mismo PDF: «ya estaba», la
--      misma llegada, y su actividad lo dice. Con otro PDF de la misma factura:
--      la lectura dice «repetida» y no hay dos facturas.
--   3. El justificante: su remitente no manda facturas (con o sin nombre, en
--      mayúsculas o minúsculas); se apunta y no entra nada en la bandeja.
--   4. Las vueltas atrás, de verdad: la de la 0110 para mientras a la dirección
--      le han llegado correos; sin ellos, quita sus dos filas; y la de la 0100
--      deja conta_entrada_llegada como en la 0220 del 21 y quita lo demás.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 facturas por correo: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.company_inbound_sender') is null then
    raise exception 'PRUEBA D01 facturas por correo: falta la 0100 del 19 (company_inbound_sender).';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── 0 · La 0110, de verdad, sobre la cuenta A ─────────────────────────────────
select set_config('d01_facturas.cuenta', 'c01a0000-0000-4000-8000-00000000000a', true);
select set_config('d01_facturas.empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', true);
select set_config('d01_facturas.direccion', 'facturas-prueba-d01f', true);
\i supabase/migrations/20261119T0110_d01_facturas_foodint.sql
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_s1 uuid; v_s2 uuid;
  lect jsonb := '{"factura":{"proveedor":{"nombre":"Panadería Inventada D01, S.L.","nif":"B00000166"},"destinatario":{"nombre":null,"nif":null},"numero":"F-2026-0412","numeroClave":"F20260412","fecha":"2026-10-14","vencimiento":null,"clase":"completa","rectificaA":null,"tipos":[{"tipo":10,"base":80,"cuota":8,"recargoTipo":null,"recargo":0}],"base":80,"cuota":8,"recargo":0,"retencion":null,"total":88,"iban":null,"desgloseDe":"papel"},"comprobaciones":[{"id":"suma","ok":true,"grave":true,"texto":"Cuadra."}],"confianza":"seguro","porque":["Todo cuadra."]}';
begin
  if (select count(*) from public.company_inbound_address where company_id = v_e and kind = 'facturas' and local_part = 'facturas-prueba-d01f' and active) <> 1
     or (select count(*) from public.company_inbound_sender where company_id = v_e and sender_sha256 = 'efb721fef32c202a4279b3b73b3111296e5359cf133edcc22ac383e6b2b2f2c8') <> 1 then
    raise exception 'PRUEBA D01 facturas por correo · 0: la 0110 no deja la dirección encendida y el remitente.';
  end if;
  raise notice 'PRUEBA D01 facturas por correo · 0: la 0110 deja la dirección de facturas encendida y el remitente de los justificantes por su huella.';
  -- Otro remitente inventado de justificantes, para probarlo por su dirección (la de la 0110 no está en el repositorio).
  insert into public.company_inbound_sender (account_id, company_id, sender_sha256, reason, created_by_name)
  values (v_acc, v_e, encode(sha256(convert_to('justificantes@panaderia-inventada.test', 'UTF8')), 'hex'),
          'Desde esa dirección el proveedor manda sus justificantes de entrega, que no son facturas.', 'Prueba D01');
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Panadería Inventada D01', 'Panadería Inventada D01, S.L.', 'B00000166', true, 'Prueba D01') returning id into v_p;
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[{"raw_text":"Pan","line_amount":80,"vat_pct":10}]}', jsonb_build_object('factura', lect), 'prueba', 'pending_review') returning id into v_s1;
  -- La misma factura, en otro PDF (otra lectura, el mismo número).
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', lect), 'prueba', 'pending_review') returning id into v_s2;
  perform set_config('prueba.p', v_p::text, true);
  perform set_config('prueba.s1', v_s1::text, true);
  perform set_config('prueba.s2', v_s2::text, true);
end $$;

-- ── 1–3 · Los correos, como la función (service_role) ─────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_to constant text := 'facturas-prueba-d01f@entrada.folvy.app';
  v_de constant text := 'Panadería Inventada <facturacion@panaderia-inventada.test>';
  d jsonb; l1 jsonb; l2 jsonb; l3 jsonb; r jsonb; v_inv uuid; v_n int;
begin
  d := public.conta_entrada_destino('facturas-prueba-d01f', 'entrada.folvy.app');
  if d->>'company_id' <> v_e::text or not (d->>'activa')::boolean or d->>'tipo' <> 'facturas' then raise exception 'PRUEBA D01 facturas por correo · 1: la dirección no lleva a A, encendida y de facturas: %', d; end if;

  -- 1 · La factura.
  if public.conta_entrada_remitente(v_e, v_de) is not null then raise exception 'PRUEBA D01 facturas por correo · 1: el remitente de las facturas frena.'; end if;
  l1 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01f-1', 'to', v_to, 'from', v_de,
          'subject', 'Factura F-2026-0412', 'recibido', '2026-10-14T08:00:00Z', 'ruta', v_acc::text || '/_correo/prueba-d01f-1/01-F-2026-0412.pdf', 'nombre', 'F-2026-0412.pdf',
          'tipo', 'application/pdf', 'bytes', 48000, 'sha256', repeat('f1', 32)));
  if (l1->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 facturas por correo · 1: la primera llegada dice que ya estaba.'; end if;
  r := public.conta_factura_desde_lectura((l1->>'id')::uuid, current_setting('prueba.s1')::uuid);
  v_inv := (r->>'factura_id')::uuid;
  if r->>'estado' <> 'factura' or (select supplier_id from public.supplier_invoice where id = v_inv) <> current_setting('prueba.p')::uuid then
    raise exception 'PRUEBA D01 facturas por correo · 1: la factura no entra con su proveedor: %', r;
  end if;
  perform public.conta_entrada_correo(jsonb_build_object('email_id', 'prueba-d01f-1', 'to', v_to, 'from', v_de, 'company_id', v_e, 'resultado', 'recibido', 'detalle', jsonb_build_object('tomados', 1, 'por_sobre', true)));
  raise notice 'PRUEBA D01 facturas por correo · 1: %', r->>'texto';

  -- 2 · La misma factura en otro correo, con el mismo PDF: «ya estaba».
  l2 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01f-2', 'to', v_to, 'from', v_de,
          'subject', 'Factura F-2026-0412', 'recibido', '2026-10-15T08:00:00Z', 'ruta', v_acc::text || '/_correo/prueba-d01f-2/01-F-2026-0412.pdf', 'nombre', 'F-2026-0412.pdf',
          'tipo', 'application/pdf', 'bytes', 48000, 'sha256', repeat('f1', 32)));
  if not (l2->>'ya_estaba')::boolean or l2->>'id' <> l1->>'id' then raise exception 'PRUEBA D01 facturas por correo · 2: el mismo PDF en otro correo no es «ya estaba»: % %', l1, l2; end if;
  select count(*) into v_n from public.document_activity where inbox_id = (l1->>'id')::uuid and action = 'repetida'
     and text = 'Ha vuelto a llegar por correo el 15/10/2026 el mismo fichero (F-2026-0412.pdf): ya estaba, no lo apunto dos veces.';
  if v_n <> 1 then raise exception 'PRUEBA D01 facturas por correo · 2: la llegada que ya estaba no lo dice en su actividad (% líneas).', v_n; end if;
  -- El mismo correo que se reintenta (el mismo adjunto otra vez): no repite la línea.
  perform public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01f-1', 'to', v_to, 'from', v_de,
          'ruta', v_acc::text || '/_correo/prueba-d01f-1/01-F-2026-0412.pdf', 'nombre', 'F-2026-0412.pdf', 'tipo', 'application/pdf', 'bytes', 48000, 'sha256', repeat('f1', 32)));
  if (select count(*) from public.document_activity where inbox_id = (l1->>'id')::uuid and action = 'repetida') <> 1 then
    raise exception 'PRUEBA D01 facturas por correo · 2: el mismo correo otra vez añade otra línea de «ya estaba».';
  end if;
  -- Con otro PDF de la misma factura: la lectura la reconoce.
  l3 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01f-3', 'to', v_to, 'from', v_de,
          'subject', 'Factura F-2026-0412 (reenvío)', 'ruta', v_acc::text || '/_correo/prueba-d01f-3/01-F-2026-0412.pdf', 'nombre', 'F-2026-0412.pdf',
          'tipo', 'application/pdf', 'bytes', 47000, 'sha256', repeat('f2', 32)));
  r := public.conta_factura_desde_lectura((l3->>'id')::uuid, current_setting('prueba.s2')::uuid);
  if r->>'estado' <> 'repetida' or (r->>'factura_id')::uuid <> v_inv then raise exception 'PRUEBA D01 facturas por correo · 2: otro PDF de la misma factura no sale repetida: %', r; end if;
  if (select count(*) from public.supplier_invoice where account_id = v_acc and invoice_number = 'F-2026-0412') <> 1 then
    raise exception 'PRUEBA D01 facturas por correo · 2: hay dos facturas F-2026-0412.';
  end if;
  raise notice 'PRUEBA D01 facturas por correo · 2: el mismo PDF «ya estaba» (y su actividad lo dice); otro PDF de la misma: %', r->>'texto';

  -- 3 · El justificante: no entra.
  for d in select jsonb_build_object('de', x) from unnest(array['justificantes@panaderia-inventada.test', 'Panadería Inventada <JUSTIFICANTES@Panaderia-Inventada.test>', ' justificantes@panaderia-inventada.test ']) x loop
    r := public.conta_entrada_remitente(v_e, d->>'de');
    if r->>'decision' is distinct from 'no_facturas' then raise exception 'PRUEBA D01 facturas por correo · 3: el remitente «%» no frena: %', d->>'de', r; end if;
  end loop;
  if public.conta_entrada_remitente('567b0264-7895-47b3-b9f9-81fae8a4aa2c', 'justificantes@panaderia-inventada.test') is not null then
    raise exception 'PRUEBA D01 facturas por correo · 3: la regla de una empresa frena en otra.';
  end if;
  perform public.conta_entrada_correo(jsonb_build_object('email_id', 'prueba-d01f-4', 'to', v_to, 'from', 'Panadería Inventada <justificantes@panaderia-inventada.test>',
          'subject', 'Justificante de entrega 8812', 'company_id', v_e, 'resultado', 'sin_facturas', 'detalle', jsonb_build_object('motivo', 'remitente_no_facturas')));
  if not exists (select 1 from public.inbound_email_log where email_id = 'prueba-d01f-4' and outcome = 'sin_facturas' and detail->>'motivo' = 'remitente_no_facturas')
     or exists (select 1 from public.document_inbox where email_id = 'prueba-d01f-4') then
    raise exception 'PRUEBA D01 facturas por correo · 3: el justificante no queda apuntado, o entra en la bandeja.';
  end if;
  raise notice 'PRUEBA D01 facturas por correo · 3: el remitente de los justificantes frena (con nombre, en mayúsculas o con espacios), solo en su empresa; queda apuntado y no entra.';
end $$;
reset role;

-- Un usuario no llega a lo del servidor.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_entrada_remitente('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'x@ejemplo.test');
    raise exception 'PRUEBA D01 facturas por correo: un usuario puede llamar a conta_entrada_remitente.';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.company_inbound_sender limit 1;
    raise exception 'PRUEBA D01 facturas por correo: un usuario lee company_inbound_sender.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 facturas por correo: un administrador de A no llama a conta_entrada_remitente ni lee los remitentes.';
end $$;
reset role;

-- ── 4 · Las vueltas atrás, de verdad ─────────────────────────────────────────
-- La de la 0110, con correos llegados a la dirección: para.
savepoint freno_0110;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261119T0110_d01_facturas_foodint.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint freno_0110;
select (:'LAST_ERROR_MESSAGE' like 'VUELTA ATRÁS 0110 (facturas de Foodint) PARADA: a facturas-prueba-d01f@entrada.folvy.app ya le han llegado correos.%') as freno_0110_ok \gset
\echo 'El freno de la vuelta atrás de la 0110 dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_0110_ok
\else
  do $$ begin raise exception 'PRUEBA D01 facturas por correo · 4: la vuelta atrás de la 0110 NO ha parado con correos llegados.'; end $$;
\endif
-- La de la 0100 con filas en company_inbound_sender: su guarda para (primero va la de la 0110).
savepoint freno_0100;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261119T0100_d01_facturas_correo.down.guarda.sql
\set ON_ERROR_STOP 1
rollback to savepoint freno_0100;
select (:'LAST_ERROR_MESSAGE' like 'VUELTA ATRÁS 0100 (facturas por correo) PARADA:%') as freno_0100_ok \gset
\if :freno_0100_ok
\else
  do $$ begin raise exception 'PRUEBA D01 facturas por correo · 4: la vuelta atrás de la 0100 NO ha parado con remitentes.'; end $$;
\endif

-- Sin los correos de la prueba (y sin el remitente inventado): las dos, en orden inverso.
do $$ begin
  -- (la bandeja se queda, con su factura: solo deja de decir a qué dirección llegó)
  update public.document_inbox set email_to = null where email_id like 'prueba-d01f-%';
  delete from public.inbound_email_log where email_id like 'prueba-d01f-%';
  delete from public.company_inbound_sender where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and sender_sha256 = encode(sha256(convert_to('justificantes@panaderia-inventada.test', 'UTF8')), 'hex');
end $$;
\i supabase/vuelta-atras/20261119T0110_d01_facturas_foodint.down.sql
do $$ begin
  if exists (select 1 from public.company_inbound_address where local_part = 'facturas-prueba-d01f') or exists (select 1 from public.company_inbound_sender) then
    raise exception 'PRUEBA D01 facturas por correo · 4: la vuelta atrás de la 0110 no quita la dirección o el remitente.';
  end if;
end $$;
\i supabase/vuelta-atras/20261119T0100_d01_facturas_correo.down.sql
do $$ begin
  if to_regclass('public.company_inbound_sender') is not null or to_regprocedure('public.conta_entrada_remitente(uuid,text)') is not null then
    raise exception 'PRUEBA D01 facturas por correo · 4: la vuelta atrás de la 0100 no quita la tabla o la función.';
  end if;
  -- La de la 0220 del 21, la que hay en producción antes de la tanda (medida el 16/10, solo lectura).
  if md5(pg_get_functiondef('public.conta_entrada_llegada(jsonb)'::regprocedure)) <> '2b167f388100372dfde07516b17eb26e' then
    raise exception 'PRUEBA D01 facturas por correo · 4: tras la vuelta atrás, conta_entrada_llegada no es la de la 0220 (%).', md5(pg_get_functiondef('public.conta_entrada_llegada(jsonb)'::regprocedure));
  end if;
  raise notice 'PRUEBA D01 facturas por correo · 4: las dos vueltas atrás paran cuando deben y, sin nada colgando, dejan la base como antes (conta_entrada_llegada, md5 2b167f38).';
end $$;

rollback;
