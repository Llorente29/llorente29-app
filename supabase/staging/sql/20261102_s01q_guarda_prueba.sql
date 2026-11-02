-- supabase/staging/sql/20261102_s01q_guarda_prueba.sql
--
-- SOLO STAGING. Prueba del S01q · la guarda (20261102T1311): una factura recibida
-- no se apunta sola si ya está contabilizada ni si es de un periodo cerrado. Todo
-- en una transacción con ROLLBACK. Datos inventados, en la cuenta D. Prueba lo
-- que cambia en caliente (public._conta_factura_apuntar,
-- public._conta_plataforma_apuntar, public.conta_documentos_recibidos y el CHECK
-- de public.supplier_invoice_auto):
--   1. Su número en el concepto de un asiento traído de Diez, con la subcuenta del
--      proveedor por el total: la pasada NO la apunta; queda enlazada a ese
--      asiento, «Ya contabilizada en Diez (asiento N, fecha)», sin asiento suyo.
--   2. Facturas recibidas la enseña «En Diez», con ese porqué (no «Por revisar»).
--   3. El mismo número con otro total: no es la misma, no la para.
--   4. De antes del corte y sin estar en Diez: no se apunta sola, con su motivo.
--   5. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01q guarda: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: prepara datos inventados y llama a las pasadas como el servicio; Facturas recibidas se lee con el usuario de la cuenta D (sus claims).

-- El workflow ya ha pasado la tanda de la rama: se vuelve antes a lo de antes.
do $$ begin
  if to_regprocedure('public._conta_factura_guarda(uuid)') is not null then
    perform public._restaurar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261102T1311_s01q_ya_contabilizada');
    perform public._restaurar_funcion('public._conta_plataforma_apuntar(uuid)', '20261102T1311_s01q_ya_contabilizada');
    perform public._restaurar_funcion('public._conta_factura_apuntar(uuid)', '20261102T1311_s01q_ya_contabilizada');
  end if;
end $$;
\i supabase/migrations/20261102T1311_s01q_ya_contabilizada.sql

-- Preparar (todo inventado): un proveedor con su subcuenta y su gasto, el
-- interruptor encendido, el eje «local» apagado, un corte y un asiento «de Diez».
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_s uuid; v_g uuid; v_corte date; r jsonb; v_d uuid;
begin
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and date '2026-10-20' between starts_on and ends_on);
  if public._conta_corte(v_e) is null then
    insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, date '2026-07-01')
    on conflict (company_id) do update set cutover_date = date '2026-07-01';
  end if;
  v_corte := public._conta_corte(v_e);
  if v_corte is null or v_corte > date '2026-10-20' then raise exception 'PRUEBA S01q guarda: el corte de la cuenta D (%) no deja probar.', v_corte; end if;
  insert into public.company_purchase_setting (company_id, account_id, receives_goods, post_safe_invoices) values (v_e, v_acc, true, true)
  on conflict (company_id) do update set post_safe_invoices = true;
  update public.conta_eje_analitico set activo = false where company_id = v_e and eje = 'local';
  insert into public.supplier (account_id, name, tax_id, tax_id_type, country_code)
  values (v_acc, 'Servicios Duplicados S01q, S.L.', 'B00000203', 'nif_es', 'ES') returning id into v_s;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, v_e, 'pymes', '41009936', '4100', 'Prueba S01q guarda', 'own', 'manual') returning id into v_g;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_g, 'supplier', v_s::text, 'principal', 'manual');
  select id into v_g from public.company_account where company_id = v_e and code = '62300000';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_g, 'supplier', v_s::text, 'gasto', 'manual');
  -- El asiento «de Diez»: su número en el concepto, la subcuenta del proveedor por 121 €.
  -- Como lo trae conta_diez_importar: en borrador, sus líneas y luego validado.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    reasons, external_program, external_year, external_series, external_number, created_by_name)
  values (v_acc, v_e, (select id from public.fiscal_year where company_id = v_e and date '2026-10-20' between starts_on and ends_on), 2,
          date '2026-10-20', 'S01Q-0001-SERVICIOS DUPLICADOS', 'migrated', 'borrador',
          jsonb_build_array(jsonb_build_object('decision', 'traido-de-diez', 'porque', 'Asiento de prueba')), 'diez', '2026', '2', '90001', 'Diez (traído)')
  returning id into v_d;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values
    (v_acc, v_e, v_d, 1, (select id from public.company_account where company_id = v_e and code = '62300000'), 100, 0),
    (v_acc, v_e, v_d, 2, (select id from public.company_account where company_id = v_e and code = '47200000'), 21, 0),
    (v_acc, v_e, v_d, 3, (select id from public.company_account where company_id = v_e and code = '41009936'), 0, 121);
  update public.journal_entry set number = 90001, status = 'validado', validated_at = now(), validated_by_name = 'Diez (traído)',
         chain_seq = coalesce((select max(chain_seq) from public.journal_entry where company_id = v_e), 0) + 1, hash = 'pendiente'
   where id = v_d;
  r := jsonb_build_object('id', v_d);
  perform set_config('prueba.acc', v_acc::text, true); perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.s', v_s::text, true); perform set_config('prueba.diez', r->>'id', true);
  perform set_config('prueba.corte', v_corte::text, true);
end $$;

create function pg_temp.factura(p_num text, p_fecha date, p_base numeric)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name, reading_confidence, reading)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, current_setting('prueba.s')::uuid, p_num, p_fecha, p_base, round(p_base * 0.21, 2), p_base + round(p_base * 0.21, 2),
          'en_revision', 'ocr', 'Prueba S01q', 'seguro',
          jsonb_build_object('factura', jsonb_build_object('proveedor', jsonb_build_object('nif', 'B00000203'), 'destinatario', jsonb_build_object('nif', 'B12345682')), 'confianza', 'seguro'))
  returning id into v;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  values (current_setting('prueba.acc')::uuid, v, 21, p_base, round(p_base * 0.21, 2));
  return v;
end $$;

-- 1 · Ya en Diez: la pasada no la apunta, la enlaza y lo dice.
do $$
declare v uuid; r jsonb;
begin
  v := pg_temp.factura('S01Q-0001', date '2026-10-20', 100);
  r := public._conta_factura_apuntar(v);
  if coalesce((r->>'apuntada')::boolean, true) or r->>'motivo' not like 'Ya contabilizada en Diez (asiento %, 20/10/2026): no se vuelve a apuntar.' then
    raise exception 'PRUEBA S01q guarda · 1: la que ya está en Diez no se para o no lo dice: %', r;
  end if;
  if exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = v) then
    raise exception 'PRUEBA S01q guarda · 1: se ha hecho un asiento suyo.';
  end if;
  if (select journal_entry_id::text from public.supplier_invoice where id = v) is distinct from current_setting('prueba.diez')
     or (select estado from public.supplier_invoice_auto where invoice_id = v) <> 'ya_contabilizada' then
    raise exception 'PRUEBA S01q guarda · 1: no queda enlazada a su asiento de Diez ni marcada «ya contabilizada».';
  end if;
  perform set_config('prueba.a', v::text, true);
  raise notice 'PRUEBA S01q guarda · 1: «%»', r->>'motivo';
end $$;

-- 2 · Facturas recibidas: «En Diez», con su porqué.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
do $$
declare r jsonb; f jsonb;
begin
  r := public.conta_documentos_recibidos(current_setting('prueba.e')::uuid, date '2026-10-01', date '2026-10-31');
  select x into f from jsonb_array_elements(r->'filas') x where x->>'id' = current_setting('prueba.a');
  if f is null or f->>'estado' <> 'en_diez' or f->>'porque' not like 'Ya contabilizada en Diez (asiento %' or f->'diez'->>'id' <> current_setting('prueba.diez') then
    raise exception 'PRUEBA S01q guarda · 2: Facturas recibidas no la enseña «En Diez» con su porqué: %', f;
  end if;
  raise notice 'PRUEBA S01q guarda · 2: «%» · %', f->>'estado', f->>'porque';
end $$;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 3 · El mismo número con otro total: no es la misma (un asiento traído con S01Q-0003 por 60 €; la factura, 60,50 €).
do $$
declare v uuid; v_d uuid; v_acc constant uuid := current_setting('prueba.acc')::uuid; v_e constant uuid := current_setting('prueba.e')::uuid;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    reasons, external_program, external_year, external_series, external_number, created_by_name)
  values (v_acc, v_e, (select id from public.fiscal_year where company_id = v_e and date '2026-10-21' between starts_on and ends_on), 2,
          date '2026-10-21', 'S01Q-0003-SERVICIOS DUPLICADOS', 'migrated', 'borrador',
          jsonb_build_array(jsonb_build_object('decision', 'traido-de-diez', 'porque', 'Asiento de prueba')), 'diez', '2026', '2', '90002', 'Diez (traído)')
  returning id into v_d;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values
    (v_acc, v_e, v_d, 1, (select id from public.company_account where company_id = v_e and code = '62300000'), 60, 0),
    (v_acc, v_e, v_d, 2, (select id from public.company_account where company_id = v_e and code = '41009936'), 0, 60);
  update public.journal_entry set number = 90002, status = 'validado', validated_at = now(), validated_by_name = 'Diez (traído)',
         chain_seq = coalesce((select max(chain_seq) from public.journal_entry where company_id = v_e), 0) + 1, hash = 'pendiente'
   where id = v_d;
  v := pg_temp.factura('S01Q-0003', date '2026-10-21', 50);
  if public._conta_factura_ya_contabilizada(v) is not null then
    raise exception 'PRUEBA S01q guarda · 3: con otro total (60,50 € frente a 60 €) la da por contabilizada.';
  end if;
  raise notice 'PRUEBA S01q guarda · 3: el mismo número con otro total no la para.';
end $$;

-- 4 · De antes del corte y sin estar en Diez: no se apunta sola, con su motivo.
do $$
declare v uuid; r jsonb;
begin
  v := pg_temp.factura('S01Q-0004', current_setting('prueba.corte')::date - 5, 40);
  r := public._conta_factura_apuntar(v);
  if coalesce((r->>'apuntada')::boolean, true) or r->>'motivo' not like 'Su fecha (%) es de un periodo ya cerrado%' then
    raise exception 'PRUEBA S01q guarda · 4: la de un periodo cerrado no se para o no lo dice: %', r;
  end if;
  if exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = v) then
    raise exception 'PRUEBA S01q guarda · 4: se ha hecho un asiento suyo.';
  end if;
  raise notice 'PRUEBA S01q guarda · 4: «%»', r->>'motivo';
end $$;

-- 5 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261102T1311_s01q_ya_contabilizada.down.sql
do $$ begin
  if to_regprocedure('public._conta_factura_guarda(uuid)') is not null
     or position('_conta_factura_guarda' in pg_get_functiondef('public._conta_factura_apuntar(uuid)'::regprocedure)) > 0
     or position('_conta_factura_guarda' in pg_get_functiondef('public._conta_plataforma_apuntar(uuid)'::regprocedure)) > 0
     or position('f.diez is not null' in pg_get_functiondef('public.conta_documentos_recibidos(uuid,date,date)'::regprocedure)) > 0
     or exists (select 1 from public.supplier_invoice_auto where estado = 'ya_contabilizada') then
    raise exception 'PRUEBA S01q guarda · 5: la vuelta atrás no deja las cosas como estaban.';
  end if;
  raise notice 'PRUEBA S01q guarda · 5: la vuelta atrás quita la guarda y devuelve las pasadas y Facturas recibidas.';
end $$;
\i supabase/migrations/20261102T1311_s01q_ya_contabilizada.sql

rollback;
