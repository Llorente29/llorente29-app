-- supabase/staging/sql/20261101_s01l_retencion_prueba.sql
--
-- S01l · Prueba en ROLLBACK de la tanda claude/s01l-retencion-leida (0920 y
-- 0921), con la cuenta D de staging y facturas inventadas (T11):
--
--   1. Alquiler al 19 % (la lectura dice 19 % y 190,00 € sobre 1.000,00 €):
--      entra con el tipo «Alquiler de local» (no «Intereses y dividendos»).
--   2. Profesional al 15 %, sin porcentaje en la lectura (solo 150,00 € sobre
--      1.000,00 €): el tipo sale de base × tipo = importe.
--   3. Una retención que no encaja con ningún tipo (123,45 € sobre 1.000,00 €):
--      la factura entra igual, sin retención, en revisión y con el aviso. Antes
--      de la 0920, las tres fallaban con supplier_invoice_retencion_completa.
--   4. Como persona (administración de D): lo mismo, sin error de la base.
--   5. La 0921 no hace nada sin Foodint.
--   6. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01l: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261101T0920_s01l_retencion_leida.sql
\i supabase/migrations/20261101T0921_s01l_releer_foodint.sql

-- Una llegada y su lectura inventadas, como las deja la entrada (ocr-albaran en modo factura).
create function pg_temp.leida(p_num text, p_ret jsonb) returns jsonb language plpgsql as $$
declare v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d'; v_in uuid; v_s uuid;
begin
  insert into public.document_inbox (account_id, company_id, channel, status, file_path)
  values (v_acc, 'c01d0000-0000-4000-8000-0000000000d2', 'subida', 'recibido', v_acc::text || '/_prueba/s01l-' || p_num || '.pdf') returning id into v_in;
  insert into public.goods_receipt_ai_session (account_id, kind, status, validation)
  values (v_acc, 'photo', 'pending_review', jsonb_build_object('factura', jsonb_build_object('confianza', 'probable',
    'factura', jsonb_build_object('numero', p_num, 'fecha', '2026-10-31', 'base', 1000.00, 'cuota', 210.00,
      'total', 1210.00 - (p_ret->>'importe')::numeric, 'clase', 'completa',
      'proveedor', jsonb_build_object('nombre', 'Arrendador de Prueba S.L.', 'nif', 'B00000195'),
      'tipos', jsonb_build_array(jsonb_build_object('tipo', 21, 'base', 1000.00, 'cuota', 210.00)),
      'retencion', p_ret)))) returning id into v_s;
  return jsonb_build_object('inbox', v_in, 'r', public.conta_factura_desde_lectura(v_in, v_s));
end $$;

-- Los pasos 1 a 3, como la entrada de correo: con el rol de servicio.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 1 · Alquiler al 19 %.
do $$
declare x jsonb; v_fac uuid;
begin
  x := pg_temp.leida('PRUEBA-S01L-ALQ', '{"tipo": 19, "importe": 190.00}');
  v_fac := (x->'r'->>'factura_id')::uuid;
  if x->'r'->>'estado' <> 'factura'
     or (select r.code from public.supplier_invoice i join public.withholding_rate r on r.id = i.withholding_rate_id where i.id = v_fac) is distinct from 'alquiler'
     or (select withholding_amount from public.supplier_invoice where id = v_fac) <> 190.00 then
    raise exception 'PRUEBA S01l · 1: el alquiler al 19 %% no entra con su tipo: %', x;
  end if;
  raise notice 'PRUEBA S01l · 1: alquiler al 19 %%: entra con «Alquiler de local» y 190,00 € («%»).', x->'r'->>'texto';
end $$;

-- 2 · Profesional al 15 %, sin porcentaje en la lectura.
do $$
declare x jsonb; v_fac uuid;
begin
  x := pg_temp.leida('PRUEBA-S01L-PRO', '{"tipo": null, "importe": 150.00}');
  v_fac := (x->'r'->>'factura_id')::uuid;
  if (select r.code from public.supplier_invoice i join public.withholding_rate r on r.id = i.withholding_rate_id where i.id = v_fac) is distinct from 'profesional' then
    raise exception 'PRUEBA S01l · 2: el profesional al 15 %% no saca su tipo de base × tipo = importe: %', x;
  end if;
  raise notice 'PRUEBA S01l · 2: profesional: 150,00 € sobre 1.000,00 € es el 15 %%: «Profesionales».';
end $$;

-- 3 · Una que no encaja: sin retención, en revisión y con el aviso; nada de error.
do $$
declare x jsonb; v_fac uuid;
begin
  x := pg_temp.leida('PRUEBA-S01L-RARA', '{"tipo": null, "importe": 123.45}');
  v_fac := (x->'r'->>'factura_id')::uuid;
  if x->'r'->>'estado' <> 'factura' or not (x->'r'->>'retencion_sin_tipo')::boolean
     or (select withholding_amount from public.supplier_invoice where id = v_fac) is not null
     or not (select needs_review from public.supplier_invoice where id = v_fac)
     or (select notes from public.supplier_invoice where id = v_fac) <> 'La factura trae una retención de 123,45 €: elige su tipo.'
     or (select status from public.document_inbox where id = (x->>'inbox')::uuid) <> 'factura' then
    raise exception 'PRUEBA S01l · 3: la que no encaja no entra en revisión con su aviso: %', x;
  end if;
  raise notice 'PRUEBA S01l · 3: no encaja: entra sin retención, en revisión: «%»', x->'r'->>'texto';
end $$;

-- 4 · Como persona (administración de D): sin ningún error de la base.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
do $$
declare v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d'; v_in uuid; v_s uuid;
begin
  insert into public.document_inbox (account_id, company_id, channel, status, file_path)
  values (v_acc, 'c01d0000-0000-4000-8000-0000000000d2', 'subida', 'recibido', v_acc::text || '/_prueba/s01l-persona.pdf') returning id into v_in;
  insert into public.goods_receipt_ai_session (account_id, kind, status, validation)
  values (v_acc, 'photo', 'pending_review', jsonb_build_object('factura', jsonb_build_object('confianza', 'probable',
    'factura', jsonb_build_object('numero', 'PRUEBA-S01L-PER', 'fecha', '2026-10-31', 'base', 1000.00, 'cuota', 210.00, 'total', 1020.00,
      'tipos', jsonb_build_array(jsonb_build_object('tipo', 21, 'base', 1000.00, 'cuota', 210.00)),
      'retencion', jsonb_build_object('tipo', 19, 'importe', 190.00))))) returning id into v_s;
  perform set_config('prueba.inbox', v_in::text, true);
  perform set_config('prueba.sesion', v_s::text, true);
end $$;
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.conta_factura_desde_lectura(current_setting('prueba.inbox')::uuid, current_setting('prueba.sesion')::uuid);
  if r->>'estado' <> 'factura' then raise exception 'PRUEBA S01l · 4: como persona no entra: %', r; end if;
  raise notice 'PRUEBA S01l · 4: como persona: «%»', r->>'texto';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 5 · La 0921, sin la cuenta de Foodint, no hace nada (lo ha dicho al aplicarse arriba).
do $$ begin
  if exists (select 1 from public.document_inbox where id = '55541602-d1bc-4fc4-97da-041a1822c205') then
    raise exception 'PRUEBA S01l · 5: esta base tiene la llegada de Foodint.';
  end if;
  raise notice 'PRUEBA S01l · 5: la 0921 no toca nada sin Foodint.';
end $$;

-- 6 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261101T0921_s01l_releer_foodint.down.sql
\i supabase/vuelta-atras/20261101T0920_s01l_retencion_leida.down.sql
do $$ begin
  if position('withholding_rate_id' in (select prosrc from pg_proc where oid = 'public.conta_factura_desde_lectura(uuid,uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA S01l · 6: la vuelta atrás no deja la función como estaba.';
  end if;
  raise notice 'PRUEBA S01l · 6: la vuelta atrás deja conta_factura_desde_lectura como estaba.';
end $$;
\i supabase/migrations/20261101T0920_s01l_retencion_leida.sql

rollback;
