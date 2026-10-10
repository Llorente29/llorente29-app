-- supabase/seeds/conta/seed_compras_repaso_staging.sql
--
-- Compras · el repaso (10/10), en staging-conta. SOLO STAGING. Todo
-- inventado; se puede volver a lanzar. Después de la 0190 y de la semilla de
-- compras.
--   · El papel a nombre de «Contado» de la semilla se decide otra vez: con la
--     0190 ya no pregunta de quién es; avisa de que así no se descuenta el IVA.
--   · Tres albaranes del socio a nombre de uno de sus locales («Aurora Cocina
--     Centro»): una sola pregunta para los tres.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

create function pg_temp.recibe(p_id uuid, p_dia date, p_base numeric) returns void language plpgsql as $$
declare v_s uuid;
begin
  if exists (select 1 from goods_receipt where id = p_id) then return; end if;
  insert into goods_receipt_ai_session (account_id, kind, parsed_result, status)
  values ('c01a0000-0000-4000-8000-00000000000a', 'photo',
          jsonb_build_object('document', jsonb_build_object('doc_type', 'albaran', 'doc_number', 'AU-' || right(p_id::text, 2), 'doc_date', p_dia,
                               'bill_to_name', 'Aurora Cocina Centro', 'tax_base_total', p_base),
                             'lines', jsonb_build_array(jsonb_build_object('raw_text', 'Género', 'line_amount', p_base, 'vat_pct', 10))), 'pending_review')
  returning id into v_s;
  insert into goods_receipt (id, account_id, location_id, supplier_id, status, receipt_date, ai_session_id, created_by_name)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'c0c00000-0000-4000-8000-000000000004',
          'borrador', p_dia, v_s, 'semilla compras');
  perform confirm_goods_receipt(p_id);
end $$;

do $$
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla repaso: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regprocedure('public.compras_sin_iva(uuid,uuid)') is null then raise exception 'Semilla repaso: falta la 0190.'; end if;
  if not exists (select 1 from public.supplier where id = 'c0c00000-0000-4000-8000-000000000004') then
    raise exception 'Semilla repaso: falta la semilla de compras.';
  end if;
  -- El de «Contado», otra vez, si aún pregunta de quién es.
  if exists (select 1 from goods_receipt_path where goods_receipt_id = 'c0c00000-0000-4000-8000-000000000102' and question = 'a_nombre_de') then
    perform public._compras_camino_guarda('c0c00000-0000-4000-8000-000000000102');
  end if;
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000401', date '2026-10-02', 84.20);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000402', date '2026-10-06', 132.75);
  perform pg_temp.recibe('c0c00000-0000-4000-8000-000000000403', date '2026-10-09', 61.10);
  raise notice 'Semilla repaso: «Contado» → %; a nombre del local del socio: % pregunta(s).',
    (select path || '/' || coalesce(question, '-') from goods_receipt_path where goods_receipt_id = 'c0c00000-0000-4000-8000-000000000102'),
    (select count(*) from goods_receipt_path where goods_receipt_id::text like 'c0c00000-%-0000000004__' and question = 'a_nombre_de');
end $$;
