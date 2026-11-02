-- supabase/staging/sql/20261101_s01o2_resto_prueba.sql
--
-- SOLO STAGING. Prueba del S01o·2 (20261101T2210, 2211, 2212 y 20261102T0005,
-- 0006). Todo en una transacción con ROLLBACK. Datos inventados, en la cuenta D.
-- Prueba lo que cambia en caliente: public.supplier_invoice_repetida,
-- public.conta_factura_desde_lectura, public.tg_supplier_invoice_no_repetida,
-- public._compras_casar_solo, public.conta_correo_facturas,
-- public.conta_motivos_para_validar, public.supplier_invoice y public.supplier_invoice_tax.
--
--   1. La clave de NIF: «EU VAT IE…» e «IE…» son el mismo; el «ES» de delante, fuera.
--   2. Repetidas sin proveedor: la factura y su recibo (mismo NIF leído, número
--      y total) no entran dos veces.
--   3. Entrega mercancía: un servicio no espera albarán (casar sola no lo toca);
--      la ficha manda.
--   4. Una de servicios con su ficha completa y su local por defecto se apunta sola.
--   5. Lo que no es seguro, con su motivo: falta la cuenta de gasto; la lectura
--      dudó (dice qué); falta su local.
--   6. No viene a nombre de la empresa: el IVA va al gasto, no deducible, y validar la acepta.
--   7. De la UE con IVA español: sin contestar el ROI, no; sin ROI, al gasto con los dos motivos.
--   8. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01o·2: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la prueba llama a las funciones internas (las de la pasada), que no son de ninguna persona.

-- El workflow ya ha pasado la tanda de la rama: lo que cambia sobre la definición viva vuelve antes a la de antes, desde su respaldo.
do $$ begin
  if position('_conta_nif_clave' in pg_get_functiondef('public.supplier_invoice_repetida(uuid,uuid,text,text,date,numeric,uuid)'::regprocedure)) > 0 then
    perform public._restaurar_funcion('public.supplier_invoice_repetida(uuid,uuid,text,text,date,numeric,uuid)', '20261101T2210_s01o2_nif_y_repetidas');
    perform public._restaurar_funcion('public.conta_factura_desde_lectura(uuid,uuid)', '20261101T2210_s01o2_nif_y_repetidas');
    perform public._restaurar_funcion('public.tg_supplier_invoice_no_repetida()', '20261101T2210_s01o2_nif_y_repetidas');
  end if;
  if position('_conta_entrega_mercancia' in pg_get_functiondef('public._compras_casar_solo(uuid)'::regprocedure)) > 0 then
    perform public._restaurar_funcion('public._compras_casar_solo(uuid)', '20261101T2211_s01o2_entrega_mercancia');
    perform public._restaurar_funcion('public.conta_correo_facturas(uuid)', '20261101T2211_s01o2_entrega_mercancia');
  end if;
  if position('S01o·2' in pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure)) > 0 then
    perform public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261101T2212_s01o2_iva_no_deducible_solo');
  end if;
end $$;
\i supabase/migrations/20261101T2210_s01o2_nif_y_repetidas.sql
\i supabase/migrations/20261101T2211_s01o2_entrega_mercancia.sql
\i supabase/migrations/20261101T2212_s01o2_iva_no_deducible_solo.sql
\i supabase/migrations/20261102T0005_s01o2_factura_apunta_sola.sql
\i supabase/migrations/20261102T0006_s01o2_foodint.sql

-- 1 · La clave de NIF.
do $$ begin
  if public._conta_nif_clave('EU VAT IE0000000X') <> 'IE0000000X' or public._conta_nif_clave('IE0000000X') <> 'IE0000000X'
     or public._conta_nif_clave('ES-B00000193') <> 'B00000193' or public._conta_nif_clave(' ') is not null then
    raise exception 'PRUEBA S01o·2 · 1: la clave de NIF no quita las etiquetas o el ES.';
  end if;
  if position('_conta_nif_clave' in pg_get_functiondef('public.conta_factura_desde_lectura(uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'PRUEBA S01o·2 · 1: conta_factura_desde_lectura no busca el proveedor con la clave de NIF.';
  end if;
  raise notice 'PRUEBA S01o·2 · 1: «EU VAT IE…» e «IE…» son el mismo NIF; conta_factura_desde_lectura busca con esa clave.';
end $$;

-- Preparar (todo inventado): un proveedor de servicios con su ficha completa, uno sin cuenta de gasto, uno de la UE.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_loc uuid; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_c uuid; v_g uuid; v_cod text;
begin
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and current_date between starts_on and ends_on);
  insert into public.company_purchase_setting (company_id, account_id, receives_goods, post_safe_invoices) values (v_e, v_acc, true, true)
  on conflict (company_id) do update set post_safe_invoices = true;
  insert into public.conta_eje_analitico (account_id, company_id, eje, activo, nombre) values (v_acc, v_e, 'local', true, 'Local') on conflict do nothing;
  update public.conta_eje_analitico set activo = true where company_id = v_e and eje = 'local';
  update public.company_tax_profile set en_roi = null where company_id = v_e;
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Inventado S01o2', 'Calle Inventada Sur, 9') returning id into v_loc;
  select id into v_g from public.company_account where company_id = v_e and code = '62300000';
  insert into public.supplier (account_id, name, tax_id, tax_id_type, country_code, default_location_id)
  values (v_acc, 'Servicios Inventados S01o2, S.L.', 'B00000193', 'nif_es', 'ES', v_loc) returning id into v_s1;
  insert into public.supplier (account_id, name, tax_id, tax_id_type, country_code)
  values (v_acc, 'Sin Gasto Inventado S01o2, S.L.', 'B00000194', 'nif_es', 'ES') returning id into v_s2;
  insert into public.supplier (account_id, name, tax_id, tax_id_type, country_code, tax_id_check_status, default_location_id)
  values (v_acc, 'Proveedor UE Inventado S01o2 Ltd', 'IE0000000X', 'vat_eu', 'IE', 'valid', v_loc) returning id into v_s3;
  for v_c, v_cod in select * from unnest(array[v_s1, v_s2, v_s3], array['41009931', '41009932', '41009933']) loop
    if not exists (select 1 from public.company_account_link where company_id = v_e and entity = 'supplier' and entity_id = v_c::text and role = 'principal') then
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
      values (v_acc, v_e, 'pymes', v_cod, '4100', 'Prueba S01o2', 'own', 'manual') returning id into v_g;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_g, 'supplier', v_c::text, 'principal', 'manual');
    end if;
  end loop;
  select id into v_g from public.company_account where company_id = v_e and code = '62300000';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_g, 'supplier', v_s1::text, 'gasto', 'manual'), (v_acc, v_e, v_g, 'supplier', v_s3::text, 'gasto', 'manual');
  perform set_config('prueba.acc', v_acc::text, true);
  perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.s1', v_s1::text, true);
  perform set_config('prueba.s2', v_s2::text, true);
  perform set_config('prueba.s3', v_s3::text, true);
  perform set_config('prueba.loc', v_loc::text, true);
end $$;

-- Una factura leída de su documento, con su IVA en líneas. p_dest: el NIF del destinatario leído (null: no viene).
create function pg_temp.factura(p_sup uuid, p_nif text, p_num text, p_base numeric, p_dest text, p_conf text default 'seguro', p_falla text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name, reading_confidence, reading)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, p_sup, p_num, date '2026-10-20', p_base, round(p_base * 0.21, 2), p_base + round(p_base * 0.21, 2),
          'en_revision', 'ocr', 'Prueba S01o2', p_conf,
          jsonb_build_object('factura', jsonb_build_object('proveedor', jsonb_build_object('nif', p_nif), 'destinatario', jsonb_build_object('nif', p_dest)),
                             'confianza', p_conf,
                             'comprobaciones', case when p_falla is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id', 'x', 'ok', false, 'texto', p_falla)) end))
  returning id into v;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  values (current_setting('prueba.acc')::uuid, v, 21, p_base, round(p_base * 0.21, 2));
  return v;
end $$;

-- 2 · Repetidas sin proveedor.
do $$
declare v1 uuid; r record;
begin
  v1 := pg_temp.factura(null, 'IE0000000X', 'INVS01O2-0001', 10, null);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);  -- como la llama el lector
  select * into r from public.supplier_invoice_repetida(current_setting('prueba.acc')::uuid, null, 'EU VAT IE0000000X', 'INVS01O2-0001', date '2026-10-20', 12.10) limit 1;
  perform set_config('request.jwt.claims', '', true);
  if r.nivel is distinct from 'repetida' or r.invoice_id <> v1 then raise exception 'PRUEBA S01o·2 · 2: sin proveedor, su recibo no sale como repetida: %', r; end if;
  begin
    perform pg_temp.factura(null, 'EU VAT IE0000000X', 'INVS01O2-0001', 10, null);
    raise exception 'PRUEBA S01o·2 · 2: el recibo de la misma factura ha entrado dos veces.';
  exception when unique_violation then null;
  end;
  delete from public.supplier_invoice_tax where supplier_invoice_id = v1;
  delete from public.supplier_invoice where id = v1;
  raise notice 'PRUEBA S01o·2 · 2: la factura y su recibo sin proveedor (mismo NIF leído, número y total) no entran dos veces.';
end $$;

-- 3 · Entrega mercancía.
do $$
declare v uuid;
begin
  if public._conta_entrega_mercancia(current_setting('prueba.s1')::uuid) is not false then raise exception 'PRUEBA S01o·2 · 3: un servicio (sin albaranes, gasto 62x) dice que entrega mercancía.'; end if;
  update public.supplier set delivers_goods = true where id = current_setting('prueba.s2')::uuid;
  if public._conta_entrega_mercancia(current_setting('prueba.s2')::uuid) is not true then raise exception 'PRUEBA S01o·2 · 3: la ficha no manda.'; end if;
  update public.supplier set delivers_goods = null where id = current_setting('prueba.s2')::uuid;
  v := pg_temp.factura(current_setting('prueba.s1')::uuid, 'B00000193', 'S01O2-ALB', 5, 'B12345682');
  if public._compras_casar_solo(v) is not null or exists (select 1 from public.document_activity where supplier_invoice_id = v and (detail->>'espera_albaran')::boolean) then
    raise exception 'PRUEBA S01o·2 · 3: la factura de un servicio queda esperando su albarán.';
  end if;
  if position('espera_albaran' in pg_get_functiondef('public.conta_correo_facturas(uuid)'::regprocedure)) = 0 then
    raise exception 'PRUEBA S01o·2 · 3: Correo de facturas no dice si la factura espera albarán.';
  end if;
  delete from public.supplier_invoice_tax where supplier_invoice_id = v; delete from public.supplier_invoice where id = v;
  raise notice 'PRUEBA S01o·2 · 3: un servicio no espera albarán y la ficha manda.';
end $$;

-- 4 · De servicios, ficha completa y local por defecto: apuntada sola.
do $$
declare v uuid; r jsonb; n int;
begin
  v := pg_temp.factura(current_setting('prueba.s1')::uuid, 'B00000193', 'S01O2-0001', 100, 'ES-B12345682');
  r := public._conta_factura_apuntar(v);
  if not coalesce((r->>'apuntada')::boolean, false) then raise exception 'PRUEBA S01o·2 · 4: la segura no se ha apuntado: %', r; end if;
  select count(*) into n from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = (r->>'asiento')::uuid and l.location_id = current_setting('prueba.loc')::uuid
     and ((a.code = '62300000' and l.debit = 100) or (a.code like '472%' and l.debit = 21 and l.vat_deductible = 'yes') or (a.code like '4100%' and l.credit = 121));
  if n <> 3 then raise exception 'PRUEBA S01o·2 · 4: no son el gasto, la 472 y la subcuenta con su local por defecto (% de 3).', n; end if;
  if (select status from public.journal_entry where id = (r->>'asiento')::uuid) <> 'validado' then raise exception 'PRUEBA S01o·2 · 4: el asiento no está validado.'; end if;
  raise notice 'PRUEBA S01o·2 · 4: «%»', r->>'porque';
end $$;

-- 5 · Lo que no es seguro, con su motivo.
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb;
begin
  r1 := public._conta_factura_apuntar(pg_temp.factura(current_setting('prueba.s2')::uuid, 'B00000194', 'S01O2-0002', 10, 'B12345682'));
  r2 := public._conta_factura_apuntar(pg_temp.factura(current_setting('prueba.s1')::uuid, 'B00000193', 'S01O2-0003', 10, 'B12345682', 'duda', 'No cuadra: bases + IVA no es el total.'));
  update public.supplier set default_location_id = null where id = current_setting('prueba.s1')::uuid;
  r3 := public._conta_factura_apuntar(pg_temp.factura(current_setting('prueba.s1')::uuid, 'B00000193', 'S01O2-0004', 10, 'B12345682'));
  update public.supplier set default_location_id = current_setting('prueba.loc')::uuid where id = current_setting('prueba.s1')::uuid;
  if r1->>'motivo' <> 'Falta la cuenta de gasto en la ficha de Sin Gasto Inventado S01o2, S.L..'
     or r2->>'motivo' <> 'La lectura dudó: No cuadra: bases + IVA no es el total.'
     or r3->>'motivo' <> 'Falta su local en la ficha de Servicios Inventados S01o2, S.L..' then
    raise exception 'PRUEBA S01o·2 · 5: los motivos no son los esperados: % · % · %', r1, r2, r3;
  end if;
  raise notice 'PRUEBA S01o·2 · 5: «%» · «%» · «%»', r1->>'motivo', r2->>'motivo', r3->>'motivo';
end $$;

-- 6 · No viene a nombre de la empresa: el IVA al gasto.
do $$
declare v uuid; r jsonb; n int;
begin
  v := pg_temp.factura(current_setting('prueba.s1')::uuid, 'B00000193', 'S01O2-0005', 50, null);
  if (select vat_non_deductible_reason from public.supplier_invoice where id = v) is distinct from 'no_a_nombre' then
    raise exception 'PRUEBA S01o·2 · 6: al guardar su IVA no se ha marcado «no viene a nombre».';
  end if;
  r := public._conta_factura_apuntar(v);
  select count(*) into n from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = (r->>'asiento')::uuid and a.code like '472%';
  if not coalesce((r->>'apuntada')::boolean, false) or n <> 0
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                     where l.entry_id = (r->>'asiento')::uuid and a.code = '62300000' and l.debit = 10.50 and l.vat_deductible = 'no')
     or r->>'porque' not like '%No viene a nombre de Asesoría de Prueba Oeste, S.L.: el IVA no se puede deducir y va al gasto.%' then
    raise exception 'PRUEBA S01o·2 · 6: la que no viene a nombre no lleva su IVA al gasto: %', r;
  end if;
  raise notice 'PRUEBA S01o·2 · 6: «%»', r->>'porque';
end $$;

-- 7 · De la UE con IVA español: sin contestar el ROI, no; sin ROI, al gasto con los dos motivos, y validar la acepta.
do $$
declare v uuid; r jsonb;
begin
  v := pg_temp.factura(current_setting('prueba.s3')::uuid, 'IE0000000X', 'S01O2-0006', 20, null);
  r := public._conta_factura_apuntar(v);
  if (r->>'apuntada')::boolean or r->>'motivo' not like '%falta saber si estás en el ROI%' then
    raise exception 'PRUEBA S01o·2 · 7: sin contestar el ROI se ha apuntado o no lo dice: %', r;
  end if;
  update public.company_tax_profile set en_roi = false where company_id = current_setting('prueba.e')::uuid;
  r := public._conta_factura_apuntar(v);
  if not coalesce((r->>'apuntada')::boolean, false) or r->>'porque' not like '%No viene a nombre%' or r->>'porque' not like '%no está en el ROI%' then
    raise exception 'PRUEBA S01o·2 · 7: sin ROI no se apunta al gasto con sus dos motivos: %', r;
  end if;
  raise notice 'PRUEBA S01o·2 · 7: «%»', r->>'porque';
end $$;

-- 8 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261102T0006_s01o2_foodint.down.sql
\i supabase/vuelta-atras/20261102T0005_s01o2_factura_apunta_sola.down.sql
\i supabase/vuelta-atras/20261101T2212_s01o2_iva_no_deducible_solo.down.sql
\i supabase/vuelta-atras/20261101T2211_s01o2_entrega_mercancia.down.sql
\i supabase/vuelta-atras/20261101T2210_s01o2_nif_y_repetidas.down.sql
do $$ begin
  if to_regprocedure('public._conta_nif_clave(text)') is not null or to_regprocedure('public._conta_factura_segura(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'company_tax_profile' and column_name = 'en_roi')
     or position('_conta_nif_clave' in pg_get_functiondef('public.supplier_invoice_repetida(uuid,uuid,text,text,date,numeric,uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA S01o·2 · 8: la vuelta atrás no deja las cosas como estaban.';
  end if;
  raise notice 'PRUEBA S01o·2 · 8: la vuelta atrás quita lo de la 2210 a la 0006.';
end $$;
\i supabase/migrations/20261101T2210_s01o2_nif_y_repetidas.sql
\i supabase/migrations/20261101T2211_s01o2_entrega_mercancia.sql
\i supabase/migrations/20261101T2212_s01o2_iva_no_deducible_solo.sql
\i supabase/migrations/20261102T0005_s01o2_factura_apunta_sola.sql

rollback;
