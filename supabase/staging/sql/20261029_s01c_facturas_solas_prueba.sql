-- supabase/staging/sql/20261029_s01c_facturas_solas_prueba.sql
--
-- SOLO STAGING. Prueba de 20261029T1012_s01c_facturas_solas (y de que la 1013
-- no hace nada sin Foodint), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. Por sus caminos (regla 10): recepciones confirmadas de
-- verdad (confirm_goods_receipt) y facturas que entran como las mete la
-- entrada de correo. Es el caso de Olimpo, con nombres inventados.
--
--   1. «Albarán y factura después» y el papel leído como albarán-factura
--      (363,67): queda esperando factura, con el aviso, y NO se crea ninguna.
--   2. La ficha sin decir cómo factura y una factura: se pregunta y no se crea
--      nada; al cerrar la pregunta, se crea.
--   3. «Con cada entrega», facturas a primeros de mes, y un albarán: esperando,
--      sin pregunta; «Esperando factura» lo da hasta el día 10 del mes
--      siguiente, y no retrasado.
--   4. Un albarán que no cuadra (faltan 52,00 € de líneas sin leer).
--   5. La factura que llega por correo (170,10 = el total del albarán del
--      paso 4) casa sola y dice que difiere en 52,00 €; la de 363,67 casa con
--      el del paso 1; una de 99,99 espera su albarán.
--   5b. La factura contra su albarán, línea a línea.
--   6. El motivo del hueco lo quita de «líneas sin leer».
--   7. El correo de facturas: la confirmación de Gmail con su código y su
--      enlace, y cada correo con lo que se hizo.
--   8. La cuenta B no lee nada de A.
--   9. La vuelta atrás, y otra vez delante.

begin;
do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01c: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

\i supabase/migrations/20261029T1012_s01c_facturas_solas.sql
\i supabase/migrations/20261029T1013_s01c_arreglo_foodint.sql

-- La empresa de prueba de A, por su NIF de prueba (su id cambia de una base a otra).
select set_config('s01c.empresa', (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'B28000016'), true);
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.sesion(p_doc text, p_num text, p_total numeric, p_base numeric, p_suma numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, validation, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', jsonb_build_object('doc_type', p_doc, 'doc_number', p_num, 'doc_date', '2026-10-19',
                               'bill_to_name', 'TABERNA DE PRUEBA NORTE, S.L.', 'tax_base_total', p_base, 'tax_total', p_total - p_base, 'grand_total', p_total),
                             'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Género', 'line_amount', p_suma, 'vat_pct', 10, 'quantity', 1, 'unit_price_net', p_suma)),
                             'confidence', 0.9),
          jsonb_build_object('cuadra', abs(p_base - p_suma) < 0.01, 'base_declared', p_base, 'lines_sum', p_suma, 'needs_review', abs(p_base - p_suma) >= 0.01),
          'pending_review')
  returning id into v;
  return v;
end $$;

create function pg_temp.recepcion(p_id uuid, p_sup uuid, p_sesion uuid, p_dia date, p_num text) returns uuid language plpgsql as $$
begin
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, supplier_doc_number, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', p_sup, 'borrador', p_dia, p_sesion, p_num, 'prueba');
  insert into goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, recipe_item_id, qty_in_base, unit_cost)
  values ('c01a0000-0000-4000-8000-00000000000a', p_id, 'Género', 1, '7e000000-0000-4000-8000-000000000a01', 1, 1);
  perform confirm_goods_receipt(p_id);
  return p_id;
end $$;

create function pg_temp.camino(p_id uuid) returns goods_receipt_path language sql as $$ select * from goods_receipt_path where goods_receipt_id = p_id $$;

-- Una factura como la mete la entrada de correo: su llegada y la factura con inbox_id.
create function pg_temp.factura_por_correo(p_sup uuid, p_num text, p_total numeric, p_email text) returns uuid language plpgsql as $$
declare v_in uuid; v_f uuid;
begin
  insert into document_inbox (account_id, company_id, channel, status, email_id, email_to, email_from, email_subject, email_received_at)
  values ('c01a0000-0000-4000-8000-00000000000a', current_setting('s01c.empresa')::uuid, 'correo', 'leyendo', p_email,
          'facturas-prueba-s01c@entrada.folvy.app', 'administracion@proveedor.example', 'Factura ' || p_num, now())
  returning id into v_in;
  insert into supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total,
                                needs_review, created_by_name, arrival_channel, inbox_id)
  values ('c01a0000-0000-4000-8000-00000000000a', current_setting('s01c.empresa')::uuid, p_sup, 'invoice', p_num, date '2026-10-20', 'en_revision', 'ocr',
          p_total, round(p_total / 1.1, 2), p_total - round(p_total / 1.1, 2), true, 'Folvy', 'correo', v_in)
  returning id into v_f;
  update document_inbox set status = 'factura', supplier_invoice_id = v_f where id = v_in;
  return v_f;
end $$;

create temp table _s01c (que text primary key, id uuid) on commit drop;

-- ── 1, 3 y 4 · Las recepciones ─────────────────────────────────────────────
do $$
declare
  c constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  o constant uuid := 'c01c0000-0000-4000-8000-000000000001'; -- «albarán y factura después» (como Olimpo)
  n constant uuid := 'c01c0000-0000-4000-8000-000000000002'; -- sin forma
  m constant uuid := 'c01c0000-0000-4000-8000-000000000003'; -- con cada entrega, a primeros de mes (como Amirsa)
  p goods_receipt_path; r jsonb;
begin
  insert into supplier (id, account_id, name, tax_id, invoicing_mode, created_by_name) values
    (o, c, 'Gourmet Prueba S01c, S.L.', 'B00000101', 'delivery_note_then_invoice', 'prueba'),
    (n, c, 'Sin Forma Prueba S01c, S.L.', 'B00000102', null, 'prueba'),
    (m, c, 'Mensual Prueba S01c, S.L.', 'B00000103', 'per_delivery', 'prueba');
  r := public.compras_cuando_llegan_poner(m, 'inicio_mes_siguiente');
  if r->>'mensaje' not like 'Guardado: las facturas de Mensual Prueba S01c, S.L. llegan todas juntas a primeros del mes siguiente%' then
    raise exception 'PRUEBA S01c · 3: «cuándo llegan» no dice lo guardado (%).', r->>'mensaje';
  end if;

  -- 1 · El papel leído como albarán-factura, con la ficha «albarán y factura después».
  perform pg_temp.recepcion('c01c0000-0000-4000-8000-000000000101', o, pg_temp.sesion('albaran_factura', '26/13028', 363.67, 342.13, 342.13), date '2026-10-19', '26/13028');
  p := pg_temp.camino('c01c0000-0000-4000-8000-000000000101');
  if p.path <> 'pendiente_factura' or p.question is distinct from 'papel_y_ficha' or p.supplier_invoice_id is not null
     or exists (select 1 from supplier_invoice where supplier_id = o) then
    raise exception 'PRUEBA S01c · 1: con la ficha «albarán y factura después» el papel creó algo (camino %, pregunta %, factura %).', p.path, p.question, p.supplier_invoice_id;
  end if;
  if p.reason not like 'Gourmet Prueba S01c, S.L. factura aparte; este papel es el albarán%' then
    raise exception 'PRUEBA S01c · 1: el aviso no dice que manda la ficha (%).', p.reason;
  end if;

  -- 2 · La ficha sin decir y una factura: se pregunta y no se crea nada.
  perform pg_temp.recepcion('c01c0000-0000-4000-8000-000000000102', n, pg_temp.sesion('factura', 'SF-1', 55.00, 50.00, 50.00), date '2026-10-19', 'SF-1');
  p := pg_temp.camino('c01c0000-0000-4000-8000-000000000102');
  if p.path <> 'factura' or p.question is distinct from 'ficha_sin_forma' or exists (select 1 from supplier_invoice where supplier_id = n) then
    raise exception 'PRUEBA S01c · 2: con la ficha vacía se creó la factura sin preguntar (camino %, pregunta %).', p.path, p.question;
  end if;
  perform public.compras_cerrar_pregunta('c01c0000-0000-4000-8000-000000000102', 'Prueba: factura con cada entrega');
  if not exists (select 1 from supplier_invoice where supplier_id = n and invoice_number = 'SF-1') then
    raise exception 'PRUEBA S01c · 2: al cerrar la pregunta no se creó la factura.';
  end if;

  -- 3 · Con cada entrega, a primeros de mes, y un albarán: esperando, sin pregunta.
  perform pg_temp.recepcion('c01c0000-0000-4000-8000-000000000103', m, pg_temp.sesion('albaran', 'M-1', 210.10, 191.00, 191.00), date '2026-10-05', 'M-1');
  p := pg_temp.camino('c01c0000-0000-4000-8000-000000000103');
  if p.path <> 'pendiente_factura' or p.question is not null then
    raise exception 'PRUEBA S01c · 3: el albarán de quien manda sus facturas a primeros de mes pregunta (camino %, pregunta %).', p.path, p.question;
  end if;

  -- 4 · Un albarán que no cuadra: base 149,44 y líneas leídas 97,44 (faltan 52,00).
  perform pg_temp.recepcion('c01c0000-0000-4000-8000-000000000104', o, pg_temp.sesion('albaran', '26/13024', 170.10, 149.44, 97.44), date '2026-10-19', '26/13024');
  p := pg_temp.camino('c01c0000-0000-4000-8000-000000000104');
  if p.path <> 'pendiente_factura' or p.question is not null then
    raise exception 'PRUEBA S01c · 4: el albarán de Gourmet no queda esperando factura sin más (camino %, pregunta %).', p.path, p.question;
  end if;
  raise notice 'PRUEBA S01c · 1-4: manda la ficha (sin factura y con su aviso), sin ficha se pregunta y no se crea hasta cerrarla, y a primeros de mes no se pregunta.';
end $$;

-- ── 3 · «Esperando factura», albarán a albarán ─────────────────────────────
do $$
declare x record;
begin
  select * into x from public.compras_esperando_detalle('c01a0000-0000-4000-8000-00000000000a', date '2026-11-05') where goods_receipt_id = 'c01c0000-0000-4000-8000-000000000103';
  if x.goods_receipt_id is null or x.espera_hasta <> date '2026-11-10' or x.retrasado or x.dias <> 31 then
    raise exception 'PRUEBA S01c · 3: el de primeros de mes no espera hasta el 10/11 sin retraso (hasta %, días %, retrasado %).', x.espera_hasta, x.dias, x.retrasado;
  end if;
  select * into x from public.compras_esperando_detalle('c01a0000-0000-4000-8000-00000000000a', date '2026-11-05') where goods_receipt_id = 'c01c0000-0000-4000-8000-000000000104';
  if x.espera_hasta <> date '2026-11-03' or not x.retrasado or x.lineas_sin_leer <> 52.00 or x.total_papel <> 170.10 then
    raise exception 'PRUEBA S01c · 3: el de «albarán y factura después» no es el esperado (hasta %, retrasado %, sin leer %, total %).', x.espera_hasta, x.retrasado, x.lineas_sin_leer, x.total_papel;
  end if;
  raise notice 'PRUEBA S01c · 3: «Esperando factura» da hasta el 10/11 al de primeros de mes (no retrasado) y 15 días al otro (retrasado el 05/11), con 52,00 € sin leer.';
end $$;

-- ── 5 · Las facturas que llegan por correo casan solas ─────────────────────
do $$
declare
  o constant uuid := 'c01c0000-0000-4000-8000-000000000001';
  f1 uuid; f2 uuid; f3 uuid; t text;
begin
  f1 := pg_temp.factura_por_correo(o, '1/26A/10965', 170.10, 'prueba-s01c-1');
  if not exists (select 1 from supplier_invoice_receipt where supplier_invoice_id = f1 and goods_receipt_id = 'c01c0000-0000-4000-8000-000000000104') then
    raise exception 'PRUEBA S01c · 5: la de 170,10 no casó con su albarán.';
  end if;
  select text into t from document_activity where supplier_invoice_id = f1 and action = 'casada';
  if t is distinct from 'Casa con el albarán 26/13024 del 19/10. Difiere en 52,00 €: el albarán tiene líneas sin leer.' then
    raise exception 'PRUEBA S01c · 5: la frase de la de 170,10 no es la esperada (%).', t;
  end if;
  if (select match_status from supplier_invoice where id = f1) <> 'con_diferencias' then raise exception 'PRUEBA S01c · 5: la de 170,10 no queda con diferencias.'; end if;
  f2 := pg_temp.factura_por_correo(o, '1/26A/10966', 363.67, 'prueba-s01c-2');
  if not exists (select 1 from supplier_invoice_receipt where supplier_invoice_id = f2 and goods_receipt_id = 'c01c0000-0000-4000-8000-000000000101')
     or (select consumed_at from goods_receipt_path where goods_receipt_id = 'c01c0000-0000-4000-8000-000000000101') is null then
    raise exception 'PRUEBA S01c · 5: la de 363,67 no casó con el albarán que se leyó como albarán-factura.';
  end if;
  f3 := pg_temp.factura_por_correo(o, '1/26A/99999', 99.99, 'prueba-s01c-3');
  select text into t from document_activity where supplier_invoice_id = f3 and action = 'propuesta';
  if t not like 'Espera su albarán:%' or exists (select 1 from supplier_invoice_receipt where supplier_invoice_id = f3) then
    raise exception 'PRUEBA S01c · 5: la de 99,99 no dice que espera su albarán (%).', t;
  end if;
  insert into _s01c values ('f1', f1);
  raise notice 'PRUEBA S01c · 5: casan solas la de 170,10 (difiere en 52,00 €: líneas sin leer) y la de 363,67; la de 99,99 espera su albarán.';
end $$;

-- ── 5b · La factura contra su albarán, línea a línea ───────────────────────
-- Las líneas de la factura llegan después de la factura (así lo hace la
-- entrada): la comparación se calcula al leerla. El albarán 26/13024 tiene una
-- línea leída («Género», 1 × 1,00); la factura trae esa (en mayúsculas y con
-- tilde) y la que no se leyó. La de 363,67 trae 2 del mismo artículo.
do $$
declare
  f1 uuid := (select id from _s01c where que = 'f1');
  f2 uuid := (select supplier_invoice_id from supplier_invoice_receipt where goods_receipt_id = 'c01c0000-0000-4000-8000-000000000101');
  r jsonb;
begin
  insert into supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position) values
    (f1, 'GÉNERO', 1, 1.00, 1.00, 10, 1),
    (f1, 'Aceite de prueba 5 L', 2, 26.00, 52.00, 10, 2);
  r := public.compras_factura_lineas(f1);
  if (r->>'lineas_factura')::int <> 2 or (r->>'cuadran')::int <> 1 or (r->>'solo_factura')::int <> 1 or (r->>'solo_albaran')::int <> 0
     or r->'lineas'->0->>'resultado' <> 'cuadra' or r->'lineas'->0->>'albaran' <> '26/13024'
     or r->'lineas'->1->>'resultado' <> 'solo_factura' or (r->'lineas'->1->>'importe_factura')::numeric <> 52.00 then
    raise exception 'PRUEBA S01c · 5b: la de 170,10 línea a línea no es la esperada (%).', r;
  end if;
  insert into supplier_invoice_line (supplier_invoice_id, recipe_item_id, raw_text, qty, unit_price, line_amount, vat_pct, position) values
    (f2, '7e000000-0000-4000-8000-000000000a01', 'Otro nombre en la factura', 2, 1.00, 2.00, 10, 1);
  r := public.compras_factura_lineas(f2);
  if (r->>'difieren')::int <> 1 or r->'lineas'->0->>'resultado' <> 'cantidad'
     or (r->'lineas'->0->>'cant_factura')::numeric <> 2 or (r->'lineas'->0->>'cant_albaran')::numeric <> 1 then
    raise exception 'PRUEBA S01c · 5b: la de 363,67 no difiere en cantidad (%).', r;
  end if;
  raise notice 'PRUEBA S01c · 5b: línea a línea, la de 170,10 cuadra en «Género» y trae 52,00 € que el albarán no tiene; la de 363,67 difiere en cantidad (2 frente a 1).';
end $$;

-- ── 6 · El motivo del hueco ────────────────────────────────────────────────
do $$
declare r jsonb;
begin
  begin perform public.compras_hueco_recepcion('c01c0000-0000-4000-8000-000000000104', ' '); raise exception 'PRUEBA S01c · 6: apuntó un hueco sin motivo.';
  exception when invalid_parameter_value then null; end;
  r := public.compras_hueco_recepcion('c01c0000-0000-4000-8000-000000000104', 'Una caja vino sin precio');
  if r->>'mensaje' not like 'Apuntado: en % faltan 52,00 € de líneas sin leer, porque «Una caja vino sin precio». Queda marcado para la oficina.' then
    raise exception 'PRUEBA S01c · 6: el mensaje no dice lo apuntado (%).', r->>'mensaje';
  end if;
  if not (select needs_review from goods_receipt where id = 'c01c0000-0000-4000-8000-000000000104') then raise exception 'PRUEBA S01c · 6: no queda marcado para la oficina.'; end if;
  raise notice 'PRUEBA S01c · 6: sin motivo no; con motivo, apuntado con su cifra y marcado para la oficina.';
end $$;

-- ── 6b · Añadir en oficina la línea que no se leyó (regla 10: el camino de recibir) ──
do $$
declare r jsonb; v_n int; x record; v_antes numeric; v_despues numeric;
begin
  perform pg_temp.recepcion('c01c0000-0000-4000-8000-000000000105', 'c01c0000-0000-4000-8000-000000000001',
    pg_temp.sesion('albaran', '26/13099', 170.10, 149.44, 97.44), date '2026-10-21', '26/13099');
  select coalesce(sum(qty_base), 0) into v_antes from stock_movement where account_id = 'c01a0000-0000-4000-8000-00000000000a'
     and recipe_item_id = '7e000000-0000-4000-8000-000000000a01' and location_id = 'c01a0000-0000-4000-8000-0000000000a2';
  begin perform public.compras_recepcion_linea_anadir('c01c0000-0000-4000-8000-000000000105', '7e000000-0000-4000-8000-000000000a01', 0, 52, null);
    raise exception 'PRUEBA S01c · 6b: añadió una línea sin cantidad.';
  exception when invalid_parameter_value then null; end;
  r := public.compras_recepcion_linea_anadir('c01c0000-0000-4000-8000-000000000105', '7e000000-0000-4000-8000-000000000a01', 4, 52.00, 'La caja que no se leyó');
  if r->>'mensaje' not like 'Añadida a %: 4 de % por 52,00 €; ha entrado al almacén. Ya no falta nada por leer.' then
    raise exception 'PRUEBA S01c · 6b: el mensaje no dice lo añadido (%).', r->>'mensaje';
  end if;
  select count(*) into v_n from stock_movement where source_type = 'goods_receipt_line' and source_id = (r->>'linea')::uuid and movement_type = 'recepcion' and qty_base = 4;
  select coalesce(sum(qty_base), 0) into v_despues from stock_movement where account_id = 'c01a0000-0000-4000-8000-00000000000a'
     and recipe_item_id = '7e000000-0000-4000-8000-000000000a01' and location_id = 'c01a0000-0000-4000-8000-0000000000a2';
  if v_n <> 1 or v_despues - v_antes <> 4 then
    raise exception 'PRUEBA S01c · 6b: la línea no entró al almacén por el camino de recibir (% movimientos, stock +%).', v_n, v_despues - v_antes;
  end if;
  -- Las líneas que ya estaban no se vuelven a meter.
  if (select count(*) from stock_movement m join goods_receipt_line l on l.id = m.source_id
       where m.source_type = 'goods_receipt_line' and l.goods_receipt_id = 'c01c0000-0000-4000-8000-000000000105') <> 2 then
    raise exception 'PRUEBA S01c · 6b: al añadir, las líneas que ya estaban entraron otra vez.';
  end if;
  select * into x from public.compras_esperando_detalle('c01a0000-0000-4000-8000-00000000000a', date '2026-10-29') where goods_receipt_id = 'c01c0000-0000-4000-8000-000000000105';
  if x.lineas_sin_leer is not null then raise exception 'PRUEBA S01c · 6b: después de añadirla sigue diciendo que faltan % €.', x.lineas_sin_leer; end if;
  raise notice 'PRUEBA S01c · 6b: la línea que faltaba entra al almacén (1 movimiento, +4) sin repetir las de antes, y ya no falta nada por leer.';
end $$;

-- ── 7 · El correo de facturas ──────────────────────────────────────────────
reset role;
do $$
declare v_dir text;
begin
  select local_part into v_dir from company_inbound_address where company_id = current_setting('s01c.empresa')::uuid and kind = 'facturas';
  if v_dir is null then
    insert into company_inbound_address (account_id, company_id, kind, local_part, created_by_name)
    values ('c01a0000-0000-4000-8000-00000000000a', current_setting('s01c.empresa')::uuid, 'facturas', 'facturas-prueba-s01c', 'prueba')
    returning local_part into v_dir;
  end if;
  insert into inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail, received_at) values
    ('prueba-s01c-conf', v_dir || '@entrada.folvy.app', 'forwarding-noreply@google.com', '(#123456789) Confirmación de reenvío', current_setting('s01c.empresa')::uuid,
     'c01a0000-0000-4000-8000-00000000000a', 'confirmacion', '{"codigo": "123456789", "enlace": "https://mail-settings.google.com/mail/vf-prueba"}', now() - interval '1 hour'),
    ('prueba-s01c-1', v_dir || '@entrada.folvy.app', 'administracion@proveedor.example', 'Factura 1/26A/10965', current_setting('s01c.empresa')::uuid,
     'c01a0000-0000-4000-8000-00000000000a', 'recibido', '{}', now());
  update document_inbox set email_to = v_dir || '@entrada.folvy.app' where email_id like 'prueba-s01c-%';
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare c jsonb := public.conta_correo_facturas(current_setting('s01c.empresa')::uuid); x jsonb;
begin
  if c->'confirmacion'->>'codigo' is distinct from '123456789' or c->'confirmacion'->>'enlace' not like 'https://mail-settings.google.com/%' then
    raise exception 'PRUEBA S01c · 7: no enseña la confirmación de Gmail (%).', c->'confirmacion';
  end if;
  select l into x from jsonb_array_elements(c->'llegadas') l where l->>'asunto' = 'Factura 1/26A/10965';
  if x is null or (x->'factura'->>'casada')::boolean is not true or x->>'dicho' not like 'Casa con el albarán 26/13024%' then
    raise exception 'PRUEBA S01c · 7: el correo no dice lo que se hizo (%).', x;
  end if;
  raise notice 'PRUEBA S01c · 7: el correo de facturas enseña el código y el enlace de Gmail, y de cada correo, lo que se hizo.';
end $$;
reset role;

-- ── 8 · La cuenta B ────────────────────────────────────────────────────────
select set_config('s01c.f1', (select id::text from _s01c where que = 'f1'), true);
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin perform public.conta_correo_facturas(current_setting('s01c.empresa')::uuid); raise exception 'PRUEBA S01c · 8: B lee el correo de A.';
  exception when no_data_found then null; end;
  begin perform public.compras_esperando_detalle('c01a0000-0000-4000-8000-00000000000a', null); raise exception 'PRUEBA S01c · 8: B lee lo que espera factura de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.compras_cuando_llegan_poner('c01c0000-0000-4000-8000-000000000003', null); raise exception 'PRUEBA S01c · 8: B cambia la ficha de A.';
  exception when insufficient_privilege then null; end;
  begin perform public.compras_factura_lineas(current_setting('s01c.f1')::uuid); raise exception 'PRUEBA S01c · 8: B lee las líneas de una factura de A.';
  exception when no_data_found then null; end;
  raise notice 'PRUEBA S01c · 8: la cuenta B no lee ni cambia nada de A.';
end $$;
reset role;

-- ── 9 · La vuelta atrás, y otra vez delante ────────────────────────────────
\i supabase/vuelta-atras/20261029T1012_s01c_facturas_solas.down.sql
do $$ begin
  if to_regprocedure('public._compras_casar_solo(uuid)') is not null or to_regprocedure('public.compras_factura_lineas(uuid)') is not null or exists (select 1 from public.funcion_respaldo where migracion = '20261029T1012_s01c_facturas_solas')
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'invoice_arrival')
     or position('S01c' in pg_get_functiondef('public.tg_goods_receipt_path_factura()'::regprocedure)) > 0
     or position('S01c' in pg_get_functiondef('public._compras_camino_calcula(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA S01c · 9: la vuelta atrás deja algo de la 1012.';
  end if;
end $$;
\i supabase/migrations/20261029T1012_s01c_facturas_solas.sql
do $$ begin
  if to_regprocedure('public._compras_casar_solo(uuid)') is null then raise exception 'PRUEBA S01c · 9: otra vez delante, falta lo de la 1012.'; end if;
  raise notice 'PRUEBA S01c · 9: la vuelta atrás deja las dos funciones como estaban y quita lo nuevo; y otra vez delante.';
end $$;

rollback;
