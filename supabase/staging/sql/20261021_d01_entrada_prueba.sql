-- supabase/staging/sql/20261021_d01_entrada_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0220 (las entradas): inbound_email_log,
-- conta_entrada_destino, conta_entrada_correo, conta_entrada_llegada,
-- conta_subida_registrar, conta_factura_desde_lectura y
-- conta_proveedor_desde_factura. Todo en una transacción con ROLLBACK.
--
-- El CORREO, paso a paso como lo hace conta-facturas-entrada (con la clave de
-- servicio, service_role): la dirección de A encendida, un correo con un PDF,
-- el mismo PDF otra vez (misma huella), un correo con solo un enlace y uno a
-- una dirección que no es de nadie. La LECTURA, con la sesión que dejaría
-- ocr-albaran en modo factura. La SUBIDA, como administrador de A. Y B, que no
-- puede subir a A ni leer nada de lo suyo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 entrada: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Preparar (como postgres): la dirección de A encendida, un proveedor con NIF y
-- la sesión de lectura que dejaría ocr-albaran (modo factura).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := (select id from public.company where account_id = v_acc order by created_at limit 1);
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_p uuid;
  lect jsonb := '{"factura":{"proveedor":{"nombre":"Mayorista Prueba D01, S.L.","nif":"B00000011"},"destinatario":{"nombre":null,"nif":null},"numero":"PD01-2026/7","numeroClave":"PD0120267","fecha":"2026-10-11","vencimiento":"2026-11-10","clase":"completa","rectificaA":null,"tipos":[{"tipo":10,"base":100,"cuota":10,"recargoTipo":null,"recargo":0},{"tipo":21,"base":50,"cuota":10.5,"recargoTipo":null,"recargo":0}],"base":150,"cuota":20.5,"recargo":0,"retencion":null,"total":170.5,"iban":null,"desgloseDe":"papel"},"comprobaciones":[{"id":"suma","ok":true,"grave":true,"texto":"Cuadra."}],"confianza":"seguro","porque":["Todo cuadra y trae lo que pide la norma."]}';
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Mayorista Prueba D01', 'Mayorista Prueba D01, S.L.', 'B00000011', true, 'Prueba D01') returning id into v_p;
  insert into public.company_inbound_address (account_id, company_id, local_part, active, created_by_name) values (v_acc, v_e, 'facturas-prueba-d01', true, 'Prueba D01');
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[{"raw_text":"Aceite","line_amount":100,"vat_pct":10},{"raw_text":"Limpieza","line_amount":50,"vat_pct":21}]}', jsonb_build_object('factura', lect), 'prueba', 'pending_review') returning id into v_s1;
  -- La misma factura otra vez (otra lectura, mismo número): repetida.
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', jsonb_set(lect, '{factura,numero}', '"pd01 2026 7"')), 'prueba', 'pending_review') returning id into v_s2;
  -- De un proveedor que A no tiene: por aclarar, con el alta propuesta.
  insert into public.goods_receipt_ai_session (account_id, kind, input_files, parsed_result, validation, ai_model, status)
  values (v_acc, 'pdf', '[]', '{"document":{},"lines":[]}', jsonb_build_object('factura', jsonb_set(jsonb_set(lect, '{factura,proveedor}', '{"nombre":"Nuevo Prueba D01","nif":"B00000022"}'), '{factura,numero}', '"N-1"')), 'prueba', 'pending_review') returning id into v_s3;
  perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.p', v_p::text, true);
  perform set_config('prueba.s1', v_s1::text, true);
  perform set_config('prueba.s2', v_s2::text, true);
  perform set_config('prueba.s3', v_s3::text, true);
end $$;

-- ── El correo, como la función (service_role) ─────────────────────────────────
-- Con la clave de servicio, PostgREST pone el rol y sus claims: los dos.
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := current_setting('prueba.e')::uuid;
  d jsonb; l1 jsonb; l2 jsonb; l3 jsonb; r jsonb; v_inv uuid; v_n int;
  v_sha constant text := repeat('a1', 32);
begin
  d := public.conta_entrada_destino('facturas-prueba-d01', 'entrada.folvy.app');
  if d->>'company_id' <> v_e::text or not (d->>'activa')::boolean then raise exception 'PRUEBA D01 entrada · 1: la dirección no lleva a la empresa de A: %', d; end if;
  if public.conta_entrada_destino('facturas-nadie', 'entrada.folvy.app') is not null then raise exception 'PRUEBA D01 entrada · 1: una dirección que no existe lleva a alguien.'; end if;
  perform public.conta_entrada_correo(jsonb_build_object('email_id', 'prueba-d01-nadie', 'to', 'facturas-nadie@entrada.folvy.app', 'from', 'x@ejemplo.test', 'resultado', 'sin_destino'));
  if not exists (select 1 from public.inbound_email_log where email_id = 'prueba-d01-nadie' and outcome = 'sin_destino' and company_id is null) then
    raise exception 'PRUEBA D01 entrada · 1: el correo a nadie no queda apuntado.';
  end if;
  raise notice 'PRUEBA D01 entrada · 1: la dirección lleva a A; la que no es de nadie no lleva a nadie y su correo queda apuntado.';

  l1 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01-1', 'to', 'facturas-prueba-d01@entrada.folvy.app', 'from', 'proveedor@ejemplo.test',
          'subject', 'Factura', 'ruta', v_acc::text || '/_correo/prueba-d01-1/01-f.pdf', 'nombre', 'f.pdf', 'tipo', 'application/pdf', 'bytes', 1000, 'sha256', v_sha));
  l2 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01-2', 'to', 'facturas-prueba-d01@entrada.folvy.app',
          'ruta', v_acc::text || '/_correo/prueba-d01-2/01-otra.pdf', 'nombre', 'otra.pdf', 'tipo', 'application/pdf', 'bytes', 1000, 'sha256', v_sha));
  if (l1->>'ya_estaba')::boolean or not (l2->>'ya_estaba')::boolean or l1->>'id' <> l2->>'id' then raise exception 'PRUEBA D01 entrada · 2: el mismo PDF dos veces no se reconoce: % %', l1, l2; end if;
  l3 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01-3', 'to', 'facturas-prueba-d01@entrada.folvy.app', 'enlace', 'https://portal.ejemplo.test/factura/77'));
  if (select status from public.document_inbox where id = (l3->>'id')::uuid) <> 'falta_pdf' then raise exception 'PRUEBA D01 entrada · 2: el correo con solo un enlace no queda «Falta el PDF».'; end if;
  raise notice 'PRUEBA D01 entrada · 2: un PDF entra; el mismo otra vez (misma huella) devuelve el que había; solo un enlace queda «Falta el PDF».';

  -- La lectura → la factura.
  r := public.conta_factura_desde_lectura((l1->>'id')::uuid, current_setting('prueba.s1')::uuid);
  v_inv := (r->>'factura_id')::uuid;
  if r->>'estado' <> 'factura' or r->>'confianza' <> 'seguro' then raise exception 'PRUEBA D01 entrada · 3: la lectura no da la factura segura: %', r; end if;
  if (select supplier_id from public.supplier_invoice where id = v_inv) <> current_setting('prueba.p')::uuid then raise exception 'PRUEBA D01 entrada · 3: no ha casado el proveedor por su NIF.'; end if;
  select count(*) into v_n from public.supplier_invoice_tax where supplier_invoice_id = v_inv;
  if v_n <> 2 or (select arrival_channel from public.supplier_invoice where id = v_inv) <> 'correo' then raise exception 'PRUEBA D01 entrada · 3: faltan sus bases por tipo (%) o su canal.', v_n; end if;
  if (select count(*) from public.supplier_invoice_line where supplier_invoice_id = v_inv) <> 2 then raise exception 'PRUEBA D01 entrada · 3: faltan sus líneas.'; end if;
  raise notice 'PRUEBA D01 entrada · 3: %', r->>'texto';

  -- La misma factura por otra llegada: repetida, no se crea otra.
  l2 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01-4', 'to', 'facturas-prueba-d01@entrada.folvy.app',
          'ruta', v_acc::text || '/_correo/prueba-d01-4/01-g.pdf', 'nombre', 'g.pdf', 'tipo', 'application/pdf', 'bytes', 900, 'sha256', repeat('b2', 32)));
  r := public.conta_factura_desde_lectura((l2->>'id')::uuid, current_setting('prueba.s2')::uuid);
  if r->>'estado' <> 'repetida' or (r->>'factura_id')::uuid <> v_inv then raise exception 'PRUEBA D01 entrada · 4: la misma factura otra vez no sale repetida: %', r; end if;
  raise notice 'PRUEBA D01 entrada · 4: %', r->>'texto';

  -- Un proveedor que A no tiene: por aclarar, sin proveedor, con el alta propuesta.
  l3 := public.conta_entrada_llegada(jsonb_build_object('account_id', v_acc, 'company_id', v_e, 'email_id', 'prueba-d01-5', 'to', 'facturas-prueba-d01@entrada.folvy.app',
          'ruta', v_acc::text || '/_correo/prueba-d01-5/01-n.pdf', 'nombre', 'n.pdf', 'tipo', 'application/pdf', 'bytes', 900, 'sha256', repeat('c3', 32)));
  r := public.conta_factura_desde_lectura((l3->>'id')::uuid, current_setting('prueba.s3')::uuid);
  if r->>'confianza' <> 'duda' or not (r->>'proveedor_nuevo')::boolean then raise exception 'PRUEBA D01 entrada · 5: con un proveedor nuevo no queda por aclarar: %', r; end if;
  perform set_config('prueba.inv_nuevo', r->>'factura_id', true);
  raise notice 'PRUEBA D01 entrada · 5: %', r->>'texto';
end $$;
reset role;

-- ── Como administrador de A: dar de alta el proveedor leído, y subir ──────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e uuid := current_setting('prueba.e')::uuid;
  r jsonb; v_ruta text := v_acc::text || '/d01-prueba/subida.pdf';
begin
  r := public.conta_proveedor_desde_factura(current_setting('prueba.inv_nuevo')::uuid, 'Prueba D01');
  if (r->>'ya_estaba')::boolean or (select created_from from public.supplier where id = (r->>'supplier_id')::uuid) <> 'factura' then
    raise exception 'PRUEBA D01 entrada · 6: el alta desde la factura no deja el proveedor «traído de factura»: %', r;
  end if;
  raise notice 'PRUEBA D01 entrada · 6: proveedor dado de alta desde lo leído («Traída de factura · por completar»).';

  begin
    perform public.conta_subida_registrar(v_e, v_ruta, 'subida.pdf', 'application/pdf', 1234, repeat('d4', 32), 'Prueba D01');
    raise exception 'PRUEBA D01 entrada · 7: ha registrado una subida sin fichero.';
  exception when sqlstate 'P0002' then null; end;
  insert into storage.objects (bucket_id, name, metadata) values ('receipt-uploads', v_ruta, '{"size": 1234, "mimetype": "application/pdf"}');
  r := public.conta_subida_registrar(v_e, v_ruta, 'subida.pdf', 'application/pdf', 1234, repeat('d4', 32), 'Prueba D01');
  if (r->>'ya_estaba')::boolean or (select channel from public.document_inbox where id = (r->>'id')::uuid) <> 'subida' then raise exception 'PRUEBA D01 entrada · 7: la subida no queda en la bandeja: %', r; end if;
  if not (public.conta_subida_registrar(v_e, v_ruta, 'subida.pdf', 'application/pdf', 1234, repeat('d4', 32), 'Prueba D01')->>'ya_estaba')::boolean then
    raise exception 'PRUEBA D01 entrada · 7: la misma subida dos veces no se reconoce.';
  end if;
  begin
    perform public.conta_entrada_llegada('{}'::jsonb);
    raise exception 'PRUEBA D01 entrada · 7: un usuario puede llamar a lo del servidor.';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.inbound_email_log limit 1;
    raise exception 'PRUEBA D01 entrada · 7: un usuario lee el registro de correos.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 entrada · 7: subir sin fichero no; con fichero sí, y dos veces la misma, una; lo del servidor y su registro, no para un usuario.';
end $$;
reset role;

-- ── Como administrador de B ───────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_subida_registrar(current_setting('prueba.e')::uuid, 'c01a0000-0000-4000-8000-00000000000a/x.pdf', 'x.pdf', 'application/pdf', 1, repeat('e5', 32), 'B');
    raise exception 'PRUEBA D01 entrada · 8: B ha subido a la empresa de A.';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.conta_proveedor_desde_factura(current_setting('prueba.inv_nuevo')::uuid, 'B');
    raise exception 'PRUEBA D01 entrada · 8: B ha dado de alta un proveedor en A.';
  exception when sqlstate 'P0002' then null; end;
  if exists (select 1 from public.document_inbox where account_id = 'c01a0000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.document_activity where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA D01 entrada · 8: B ve la bandeja o la actividad de A.';
  end if;
  raise notice 'PRUEBA D01 entrada · 8: B no sube a A, no da de alta en A y no ve su bandeja ni su actividad.';
end $$;
reset role;

rollback;
