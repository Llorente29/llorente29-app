-- supabase/seeds/conta/seed_d01_staging.sql
--
-- D01 · Facturas recibidas (N22 y N23) en staging-conta, para las capturas.
-- SOLO STAGING. Todo inventado; nada copiado de producción. Se puede volver a
-- lanzar: ids fijos y, si ya está, no hace nada. Después de la 0290.
--
-- Cuenta A (Taberna de Prueba Norte, empresa 3b34403a…, con Cocina), octubre:
--   · Mayorista Prueba Alfa: F-2026-1022, 11/10, por correo, «probable», al
--     10 % (sus facturas se apuntan en 60000000, elegida en su ficha).
--   · Suministros Eléctricos Prueba Norte: 2026/0512, 09/10, por correo,
--     «seguro», al 21 %.
--   · Un ticket sin emisor reconocido, 07/10, subido: «No reconozco el emisor».
-- El frente C se captura con la misma cuenta y ?marca=contabilidad (R2): no se
-- siembra nada en la cuenta de la C06, que es de C y cuenta sus filas.
--
-- Con los permisos de una persona administradora de la cuenta A (las
-- subcuentas se dan de alta con company_account_add, como en la pantalla).

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.factura(p_id uuid, p_acc uuid, p_emp uuid, p_prov uuid, p_num text, p_dia date, p_canal text, p_conf text,
                                p_tipo numeric, p_base numeric, p_porque text, p_propuesto text, p_lineas jsonb) returns void language plpgsql as $$
declare v_cuota numeric := round(p_base * p_tipo / 100, 2);
begin
  insert into public.supplier_invoice (id, account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total,
                                       needs_review, created_by_name, arrival_channel, reading_confidence, reading)
  values (p_id, p_acc, p_prov, p_emp, p_num, p_dia, 'en_revision', 'ocr', p_base + v_cuota, p_base, v_cuota, p_conf <> 'seguro', 'semilla D01', p_canal, p_conf,
          jsonb_build_object('porque', jsonb_build_array(p_porque), 'comprobaciones', '[]'::jsonb, 'confianza', p_conf,
                             'factura', jsonb_build_object('proveedor', jsonb_build_object('nombre', p_propuesto, 'nif', null))));
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (p_acc, p_id, p_tipo, p_base, v_cuota);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
  select p_id, l->>'texto', nullif(l->>'cantidad', '')::numeric, null, (l->>'importe')::numeric, p_tipo, o::int
    from jsonb_array_elements(p_lineas) with ordinality as e(l, o);
end $$;

create function pg_temp.subcuenta(p_emp uuid, p_prov uuid, p_nombre text) returns void language plpgsql as $$
begin
  if not exists (select 1 from public.company_account_link where company_id = p_emp and entity = 'supplier' and entity_id = p_prov::text and role = 'principal') then
    perform public.company_account_add(p_emp, '4000', p_nombre, null, 'supplier', p_prov::text, 'semilla D01');
  end if;
end $$;

do $$
declare
  a     constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea    constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  alfa  constant uuid := 'd0100000-0000-4000-8000-000000000001';
  luz   constant uuid := 'd0100000-0000-4000-8000-000000000002';
  v_g   uuid;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla D01: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regprocedure('public.conta_factura_para_revisar(uuid)') is null then raise exception 'Semilla D01: falta la 0290.'; end if;
  if exists (select 1 from public.supplier where id = alfa) then
    raise notice 'Semilla D01 · cuenta A: ya estaba sembrada; no hago nada.';
    return;
  end if;

  insert into public.supplier (id, account_id, name, legal_name, tax_id, is_active, created_by_name) values
    (alfa, a, 'Mayorista Prueba Alfa', 'Mayorista Prueba Alfa, S.A.', 'A00000018', true, 'semilla D01'),
    (luz,  a, 'Suministros Eléctricos Prueba Norte', 'Suministros Eléctricos Prueba Norte, S.L.', 'B00000026', true, 'semilla D01');
  perform pg_temp.subcuenta(ea, alfa, 'Mayorista Prueba Alfa');
  perform pg_temp.subcuenta(ea, luz, 'Suministros Eléctricos Prueba Norte');
  select id into v_g from public.company_account where company_id = ea and code = '60000000';
  if v_g is not null then perform public.company_account_link_set(ea, 'supplier', alfa::text, 'gasto', v_g, 'semilla D01', 'manual'); end if;

  perform pg_temp.factura('d0100000-0000-4000-8000-0000000000f1', a, ea, alfa, 'F-2026-1022', '2026-10-11', 'correo', 'probable', 10, 1283.15,
    'Las tres líneas suman la base y el total cuadra; es la primera de este proveedor que leo, por eso la miras tú.', null,
    '[{"texto":"Aceite de oliva 5 L","cantidad":4,"importe":98.00},{"texto":"Harina 25 kg","cantidad":6,"importe":132.60},{"texto":"Género variado","cantidad":null,"importe":1052.55}]');
  perform pg_temp.factura('d0100000-0000-4000-8000-0000000000f2', a, ea, luz, '2026/0512', '2026-10-09', 'correo', 'seguro', 21, 412.30,
    'Trae todo lo que pide la norma y el total cuadra.', null,
    '[{"texto":"Energía de septiembre","cantidad":null,"importe":412.30}]');
  perform pg_temp.factura('d0100000-0000-4000-8000-0000000000f3', a, ea, null, null, '2026-10-07', 'subida', 'duda', 21, 38.90,
    'Sin NIF: no deduce IVA. La apunto como gasto si me dices de quién es.', 'Ferretería Prueba',
    '[{"texto":"Tornillería","cantidad":null,"importe":38.90}]');
  raise notice 'Semilla D01 · cuenta A: 2 proveedores y 3 facturas de octubre.';
end $$;

-- R5 (14/10) · El papel de la F-2026-1022 dice «Vencimiento: 10/11/2026 ·
-- transferencia» y la semilla no lo traía: N23 decía «sin vencimiento · sale de
-- su ficha». No era la lectura (la semilla no pasa por ella; la lectura de
-- verdad lo lee, tests/conta/d01/lecturaFactura.test.ts): faltaba aquí. Y la
-- ficha de Alfa, a 30 días, que con la fecha de la factura da el mismo día.
-- Se puede volver a lanzar: solo rellena lo que falta.
do $$
begin
  update public.supplier_invoice set due_date = '2026-11-10'
   where id = 'd0100000-0000-4000-8000-0000000000f1' and account_id = 'c01a0000-0000-4000-8000-00000000000a' and due_date is null;
  update public.supplier set payment_terms_days = 30
   where id = 'd0100000-0000-4000-8000-000000000001' and account_id = 'c01a0000-0000-4000-8000-00000000000a' and payment_terms_days is null;
  raise notice 'Semilla D01 R5: el vencimiento de la F-2026-1022 y el plazo de su ficha, puestos si faltaban.';
end $$;

-- 14/10 · Los NIF inventados de Alfa y Suministros no pasaban el carácter de
-- control (A00000001, B00000002): el agente nocturno «Datos maestros» de
-- staging lo marcó en rojo (run 38523520670). Inventados igual, y ahora
-- válidos: A00000018 y B00000026 (scripts/conta/lib/terceros.mjs nifValido).
-- Solo cambia los que siguen con el viejo.
do $$
begin
  update public.supplier set tax_id = 'A00000018'
   where id = 'd0100000-0000-4000-8000-000000000001' and account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'A00000001';
  update public.supplier set tax_id = 'B00000026'
   where id = 'd0100000-0000-4000-8000-000000000002' and account_id = 'c01a0000-0000-4000-8000-00000000000a' and tax_id = 'B00000002';
  raise notice 'Semilla D01 · NIF de Alfa y Suministros, con su carácter de control.';
end $$;
