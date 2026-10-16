-- supabase/seeds/conta/seed_d01_compras_ficha_staging.sql
--
-- D01 · Los fallos de Compras y de la ficha de proveedor que vio Julio el 16/10,
-- reproducidos en staging-conta para la e2e y sus capturas de antes y después.
-- SOLO STAGING. Todo inventado; nada copiado de producción. Se puede volver a
-- lanzar: ids fijos y, si ya está, no hace nada. Después de la 0190 de compras.
--
-- Pasa por los mismos caminos que la pantalla, como la semilla de compras:
-- confirm_goods_receipt (y con él el disparador que decide el camino y el que
-- hace la factura desde el papel), compras_forma_facturar y
-- company_account_link_set, con los permisos de una persona administradora de
-- la cuenta A.
--
-- Cuenta A (Taberna de Prueba Norte, empresa 3b34403a…):
--   · Lácteos Prueba Ocho (el primer caso): NIF y tipo de gasto puestos,
--     su ficha no decía cómo factura cuando llegó su factura del 07/10 (la
--     factura se hizo desde el papel), y DESPUÉS se le dijo «Entrega con
--     albarán y factura después». La pregunta de esa recepción se quedó abierta.
--   · Marca Prueba Cedida (el segundo): liquida cada mes, sin
--     tipo de gasto, pero sus facturas tienen su cuenta (la 60000000).

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recibe(p_id uuid, p_prov uuid, p_local uuid, p_dia date, p_doc jsonb, p_base numeric) returns void language plpgsql as $$
declare v_s uuid;
begin
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', p_doc || jsonb_build_object('doc_date', p_dia, 'tax_base_total', p_base,
                               'tax_total', round(p_base * 0.10, 2), 'grand_total', round(p_base * 1.10, 2)),
                             'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Género', 'line_amount', p_base, 'vat_pct', 10))), 'pending_review')
  returning id into v_s;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', p_local, p_prov, 'borrador', p_dia, v_s, 'semilla compras ficha');
  perform confirm_goods_receipt(p_id);
end $$;

do $$
declare
  a  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  centro  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  lacteos constant uuid := 'd1c00000-0000-4000-8000-000000000001';
  cedida  constant uuid := 'd1c00000-0000-4000-8000-000000000002';
  empresa constant text := 'Taberna de Prueba Norte, S.L.';
  v_tipo uuid; v_600 uuid; v_p goods_receipt_path;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla compras ficha: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if exists (select 1 from public.supplier where id = lacteos) then
    raise notice 'Semilla compras ficha: ya estaba sembrada; no hago nada.';
    return;
  end if;
  select id into v_tipo from public.expense_category where is_system and pgc_account_hint = '600' order by name limit 1;
  select id into v_600 from public.company_account where company_id = ea and code = '60000000';
  if v_tipo is null or v_600 is null then
    raise exception 'Semilla compras ficha: falta el tipo de gasto 600 o la cuenta 60000000 de la empresa A.';
  end if;

  insert into public.supplier (id, account_id, name, tax_id, expense_category_id, invoicing_mode, created_by_name) values
    (lacteos, a, 'Lácteos Prueba Ocho, S.L.', 'B00000141', v_tipo, null, 'semilla compras ficha'),
    (cedida,  a, 'Marca Prueba Cedida, S.L.', 'B00000158', null, 'monthly_settlement', 'semilla compras ficha');

  -- 1 · Llega su factura con la ficha sin decir cómo factura; la factura se hace desde el papel.
  perform pg_temp.recibe('d1c00000-0000-4000-8000-000000000101', lacteos, centro, date '2026-10-07',
    jsonb_build_object('doc_type', 'factura', 'doc_number', 'LP-7', 'bill_to_name', empresa, 'supplier_tax_id', 'B00000141'), 120.00);
  select * into v_p from public.goods_receipt_path where goods_receipt_id = 'd1c00000-0000-4000-8000-000000000101';
  if v_p.question is distinct from 'ficha_sin_forma' or v_p.consumed_at is null then
    raise exception 'Semilla compras ficha: la recepción de Lácteos no ha quedado como la que se buscaba (pregunta %, usada %).', v_p.question, v_p.consumed_at is not null;
  end if;
  -- … y después se le dice cómo factura, como en su ficha («Cómo te factura»).
  perform public.compras_forma_facturar(lacteos, 'delivery_note_then_invoice', false, 'monthly');

  -- 2 · Sus facturas tienen su cuenta, sin tipo de gasto.
  perform public.company_account_link_set(ea, 'supplier', cedida::text, 'gasto', v_600, 'semilla compras ficha', 'manual');

  raise notice 'Semilla compras ficha: Lácteos con su pregunta «¿cómo factura?» abierta y su ficha ya contestada; Marca Prueba Cedida con su cuenta de facturas y sin tipo de gasto.';
end $$;
