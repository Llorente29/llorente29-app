-- supabase/seeds/conta/seed_compras_staging.sql
--
-- Compras (encargo «Contabilidad: las compras») en staging-conta. SOLO
-- STAGING. Todo inventado; nada copiado de producción. Se puede volver a
-- lanzar: ids fijos y, si ya está, no hace nada. Después de la 0170.
--
-- Pasa por los mismos caminos que la pantalla: confirm_goods_receipt (y con él
-- el disparador que decide el camino de cada papel) y
-- compras_liquidacion_guardar, con los permisos de una persona administradora
-- de la cuenta A.
--
-- Cuenta A (Taberna de Prueba Norte, empresa 3b34403a…), para las capturas:
--   Qué tienes que mirar
--     · Verduras del Huerto Prueba: entrega con albarán y su ficha no dice
--       cómo factura; tampoco tiene NIF (el papel trae B12345674).
--     · Bodega Prueba Ribera: su factura va a nombre de «Contado».
--   Qué está esperando factura
--     · Carnes Prueba del Valle (albarán y factura al mes, por local): tres
--       en Norte Centro desde el 4 de septiembre y una en Norte Mercado.
--   Liquidaciones del mes
--     · Distribuciones Prueba Aurora (liquida cada mes): septiembre de Norte
--       Centro ha llegado (AF-P9, sin confirmar); septiembre de Norte Mercado
--       no; octubre aún no toca.

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
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', p_local, p_prov, 'borrador', p_dia, v_s, 'semilla compras');
  perform confirm_goods_receipt(p_id);
end $$;

do $$
declare
  a  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  centro  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  mercado constant uuid := 'e0200000-0000-4000-8000-0000000000a3';
  verduras constant uuid := 'c0c00000-0000-4000-8000-000000000001';
  bodega   constant uuid := 'c0c00000-0000-4000-8000-000000000002';
  carnes   constant uuid := 'c0c00000-0000-4000-8000-000000000003';
  aurora   constant uuid := 'c0c00000-0000-4000-8000-000000000004';
  empresa  constant text := 'Taberna de Prueba Norte, S.L.';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla compras: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regprocedure('public.compras_liquidacion_productos(uuid)') is null then raise exception 'Semilla compras: falta la 0170.'; end if;
  if exists (select 1 from public.supplier where id = verduras) then
    raise notice 'Semilla compras: ya estaba sembrada; no hago nada.';
    return;
  end if;

  insert into public.supplier (id, account_id, name, tax_id, invoicing_mode, invoicing_per_location, invoicing_frequency, created_by_name) values
    (verduras, a, 'Verduras del Huerto Prueba, S.L.', null, null, null, null, 'semilla compras'),
    (bodega,   a, 'Bodega Prueba Ribera, S.L.', 'B00000091', 'per_delivery', null, 'per_delivery', 'semilla compras'),
    (carnes,   a, 'Carnes Prueba del Valle, S.L.', 'B00000092', 'delivery_note_then_invoice', true, 'monthly', 'semilla compras'),
    (aurora,   a, 'Distribuciones Prueba Aurora, S.L.', 'B00000093', 'monthly_settlement', null, 'monthly', 'semilla compras');

  -- Qué tienes que mirar
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000101', verduras, centro, date '2026-10-05',
    jsonb_build_object('doc_type', 'albaran', 'doc_number', 'VH-1', 'bill_to_name', empresa, 'supplier_tax_id', 'B12345674'), 191.00);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000102', bodega, centro, date '2026-09-25',
    jsonb_build_object('doc_type', 'factura', 'doc_number', 'BR-77', 'bill_to_name', 'Contado'), 102.54);

  -- Qué está esperando factura
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000201', carnes, centro,  date '2026-09-04', jsonb_build_object('doc_type', 'albaran', 'doc_number', 'CV-1', 'bill_to_name', empresa), 402.10);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000202', carnes, centro,  date '2026-09-15', jsonb_build_object('doc_type', 'albaran', 'doc_number', 'CV-2', 'bill_to_name', empresa), 260.00);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000203', carnes, centro,  date '2026-09-28', jsonb_build_object('doc_type', 'albaran', 'doc_number', 'CV-3', 'bill_to_name', empresa), 249.28);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000204', carnes, mercado, date '2026-09-18', jsonb_build_object('doc_type', 'albaran', 'doc_number', 'CV-4', 'bill_to_name', empresa), 189.50);

  -- Liquidaciones: lo recibido del socio (sin papel leído: manda su ficha).
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000301', aurora, centro,  date '2026-09-10', '{}'::jsonb, 300.00);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000302', aurora, centro,  date '2026-09-24', '{}'::jsonb, 150.00);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000303', aurora, mercado, date '2026-09-12', '{}'::jsonb, 220.00);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000304', aurora, centro,  date '2026-10-03', '{}'::jsonb, 310.00);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000305', aurora, centro,  date '2026-10-08', '{}'::jsonb, 95.40);

  -- Septiembre de Norte Centro ha llegado: lo que daría leerLiquidacion con
  -- sus cinco documentos (inventados, y cuadrados entre sí).
  perform public.compras_liquidacion_guardar(ea, aurora, centro, jsonb_build_object(
    'emitida', jsonb_build_object('numero', 'AF-P9', 'fecha', '2026-09-30', 'periodo', jsonb_build_object('desde', '2026-09-01', 'hasta', '2026-09-30'),
      'desde', jsonb_build_object('nombre', empresa, 'nif', null), 'a', jsonb_build_object('nombre', 'Distribuciones Prueba Aurora, S.L.', 'nif', 'B00000093'),
      'total', 1320, 'lineas', jsonb_build_array(
        jsonb_build_object('concepto', 'Servicio por sus ventas (25 %)', 'base', 1000, 'tipo', 10, 'total', 1100),
        jsonb_build_object('concepto', 'Mercaderías que pusiste tú', 'base', 200, 'tipo', 10, 'total', 220))),
    'recibida', jsonb_build_object('numero', 'FV-P9', 'fecha', '2026-09-30', 'periodo', jsonb_build_object('desde', '2026-09-01', 'hasta', '2026-09-30'),
      'desde', jsonb_build_object('nombre', 'Distribuciones Prueba Aurora, S.L.', 'nif', 'B00000093'), 'a', jsonb_build_object('nombre', empresa, 'nif', null),
      'total', 434, 'lineas', jsonb_build_array(
        jsonb_build_object('concepto', 'Género que queda en el local, al 4 %', 'base', 100, 'tipo', 4, 'total', 104),
        jsonb_build_object('concepto', 'Género que queda en el local, al 10 %', 'base', 300, 'tipo', 10, 'total', 330))),
    'transaccion', jsonb_build_object('fecha', '2026-09-30', 'periodo', jsonb_build_object('desde', '2026-09-01', 'hasta', '2026-09-30'),
      'lineas', jsonb_build_array(
        jsonb_build_object('concepto', 'Factura AF-P9', 'importe', 1320, 'referencia', 'AF-P9'),
        jsonb_build_object('concepto', 'Factura FV-P9', 'importe', -434, 'referencia', 'FV-P9')),
      'saldo', jsonb_build_object('concepto', 'Saldo', 'importe', 886)),
    'ventas', jsonb_build_object('referencia', 'V-P9', 'periodo', jsonb_build_object('desde', '2026-09-01', 'hasta', '2026-09-30'),
      'plataformas', jsonb_build_array(jsonb_build_object('plataforma', 'Glovo', 'marcas', '[]'::jsonb, 'reparto', '[]'::jsonb,
        'totales', jsonb_build_object('ventas', 4000, 'devoluciones', 0, 'total', 4000)))),
    'inventario', jsonb_build_object('referencia', 'I-P9', 'periodo', jsonb_build_object('desde', '2026-09-01', 'hasta', '2026-09-30'),
      'repetidas', 0, 'totalDocumento', 400, 'productos', jsonb_build_array(
        jsonb_build_object('nombre', 'Patata Prueba kg', 'precio', 1, 'compras', 100, 'unidad', 'kg', 'consumo', 60, 'saldo', 40, 'total', 40),
        jsonb_build_object('nombre', 'Aceite Prueba lt', 'precio', 7, 'compras', 50, 'unidad', 'lt', 'consumo', 0, 'saldo', 50, 'total', 350),
        jsonb_build_object('nombre', 'Salsa Prueba Rara', 'precio', 2, 'compras', 0, 'unidad', 'ud', 'consumo', 5, 'saldo', 5, 'total', 10))),
    'periodo', jsonb_build_object('desde', '2026-09-01', 'hasta', '2026-09-30'),
    'bloqueos', '[]'::jsonb, 'avisos', '[]'::jsonb, 'noReconocidos', '[]'::jsonb));

  raise notice 'Semilla compras: % caminos, % preguntas, % liquidación(es) de documentos.',
    (select count(*) from goods_receipt_path where goods_receipt_id::text like 'c0c00000-%'),
    (select count(*) from goods_receipt_path where goods_receipt_id::text like 'c0c00000-%' and question is not null),
    (select count(*) from licensed_settlement where supplier_id = aurora and formula = 'documentos');
end $$;
