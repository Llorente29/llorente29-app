-- supabase/staging/sql/20261102_s01q_no_duplicar_prueba.sql
--
-- SOLO STAGING. Prueba del S01q·7 · que Sumied no pueda duplicar (20261102T2139,
-- 2010 y 2011). Todo en una transacción con ROLLBACK. Datos inventados, en la cuenta D.
-- La 2010 es de Foodint y en staging no hace nada. Intenta duplicar por cada
-- camino y comprueba que sale el mensaje:
--   1. Regla 1 · la pasada: una factura que Diez ya tiene con otro total no se
--      apunta sola, y dice dónde está.
--   2. Regla 1 · la pantalla (journal_entry_proponer, con el usuario de la cuenta).
--   3. Regla 1 · una tanda (un insert directo en journal_entry).
--   4. Regla 1 · sin falsos: otro número que empieza igual sí se apunta; y con
--      «No es repetida» también la misma.
--   5. Regla 2 · antes del corte: ni al proponer ni al cambiar la fecha.
--   6. Regla 3 · una factura emitida, un asiento.
--   7. Regla 4 · un pago o un cobro no pasa del total.
--   9. S01q·8 · el borrado dice en qué declaración está un asiento (borrador o presentada) y no lo borra.
--   8. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01q·7: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: prepara datos inventados como propietaria; el camino de la pantalla se prueba con los claims del usuario de la cuenta D.

\i supabase/migrations/20261102T2139_s01q_borrar_dice_borrador.sql
\i supabase/migrations/20261102T2010_s01q_borrar_vercel_supabase.sql
\i supabase/migrations/20261102T2011_s01q_no_duplicar.sql

create temp table _p (k text primary key, v text) on commit drop;
grant all on _p to authenticated;

-- Preparar (todo inventado): un proveedor con su subcuenta y su gasto, el
-- interruptor encendido, el eje «local» apagado, un corte y un asiento «de Diez»
-- con la factura S01Q7-0001 por 121,00 €.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_s uuid; v_g uuid; v_corte date; v_d uuid;
begin
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and date '2026-10-20' between starts_on and ends_on);
  if public._conta_corte(v_e) is null then
    insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, date '2026-07-01')
    on conflict (company_id) do update set cutover_date = date '2026-07-01';
  end if;
  v_corte := public._conta_corte(v_e);
  if v_corte is null or v_corte > date '2026-10-20' or v_corte < date '2026-01-02' then
    raise exception 'PRUEBA S01q·7: el corte de la cuenta D (%) no deja probar.', v_corte;
  end if;
  insert into public.company_purchase_setting (company_id, account_id, receives_goods, post_safe_invoices) values (v_e, v_acc, true, true)
  on conflict (company_id) do update set post_safe_invoices = true;
  update public.conta_eje_analitico set activo = false where company_id = v_e and eje = 'local';
  insert into public.supplier (account_id, name, tax_id, tax_id_type, country_code)
  values (v_acc, 'Servicios Duplicados S01q7, S.L.', 'B00000211', 'nif_es', 'ES') returning id into v_s;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, v_e, 'pymes', '41009937', '4100', 'Prueba S01q·7', 'own', 'manual') returning id into v_g;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_g, 'supplier', v_s::text, 'principal', 'manual');
  select id into v_g from public.company_account where company_id = v_e and code = '62300000';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_g, 'supplier', v_s::text, 'gasto', 'manual');
  -- Como lo trae conta_diez_importar: en borrador, sus líneas y luego validado.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status,
                                    reasons, external_program, external_year, external_series, external_number, created_by_name)
  values (v_acc, v_e, (select id from public.fiscal_year where company_id = v_e and date '2026-10-20' between starts_on and ends_on), 2,
          date '2026-10-20', 'S01Q7-0001-SERVICIOS DUPLICADOS', 'migrated', 'borrador',
          jsonb_build_array(jsonb_build_object('decision', 'traido-de-diez', 'porque', 'Asiento de prueba')), 'diez', '2026', '2', '90011', 'Diez (traído)')
  returning id into v_d;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values
    (v_acc, v_e, v_d, 1, (select id from public.company_account where company_id = v_e and code = '62300000'), 100, 0),
    (v_acc, v_e, v_d, 2, (select id from public.company_account where company_id = v_e and code = '47200000'), 21, 0),
    (v_acc, v_e, v_d, 3, (select id from public.company_account where company_id = v_e and code = '41009937'), 0, 121);
  update public.journal_entry set number = 90011, status = 'validado', validated_at = now(), validated_by_name = 'Diez (traído)',
         chain_seq = coalesce((select max(chain_seq) from public.journal_entry where company_id = v_e), 0) + 1, hash = 'pendiente'
   where id = v_d;
  insert into _p values ('acc', v_acc), ('e', v_e), ('s', v_s), ('diez', v_d), ('corte', v_corte);
end $$;

create function pg_temp.p(k text) returns text language sql as $$ select v from _p where _p.k = $1 $$;

create function pg_temp.factura(p_num text, p_fecha date, p_base numeric)
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name, reading_confidence, reading)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, pg_temp.p('s')::uuid, p_num, p_fecha, p_base, round(p_base * 0.21, 2), p_base + round(p_base * 0.21, 2),
          'en_revision', 'ocr', 'Prueba S01q·7', 'seguro',
          jsonb_build_object('factura', jsonb_build_object('proveedor', jsonb_build_object('nif', 'B00000211'), 'destinatario', jsonb_build_object('nif', 'B12345682')), 'confianza', 'seguro'))
  returning id into v;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  values (pg_temp.p('acc')::uuid, v, 21, p_base, round(p_base * 0.21, 2));
  return v;
end $$;

-- Lo que la pantalla y una tanda le piden a la base: el asiento de la factura.
create function pg_temp.entrada(p_fact uuid, p_fecha date, p_source text default 'supplier_invoice') returns jsonb language sql as $$
  select jsonb_build_object('series', 2, 'fecha', p_fecha, 'concepto', 'Factura Servicios Duplicados · ' || (select invoice_number from public.supplier_invoice where id = p_fact),
                            'source_type', p_source, 'source_id', case when p_source = 'supplier_invoice' then p_fact end,
                            'confianza', 'seguro', 'porque', 'Prueba S01q·7.',
                            'documento', (select invoice_number from public.supplier_invoice where id = p_fact))
$$;
create function pg_temp.lineas(p_total numeric) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('cuenta', '62300000', 'debe', p_total, 'haber', 0, 'comun', true),
                           jsonb_build_object('cuenta', '41009937', 'debe', 0, 'haber', p_total, 'comun', true))
$$;

-- 1 · Regla 1 · la pasada: la misma factura con otro total (120,99 € frente a los 121,00 € de Diez).
do $$
declare v uuid; r jsonb; v_msg text;
begin
  v := pg_temp.factura('S01Q7-0001', date '2026-10-20', 99.99);
  insert into _p values ('f1', v);
  if public._conta_factura_ya_contabilizada(v) is not null then
    raise exception 'PRUEBA S01q·7 · 1: la guarda del #448 ya la para; la prueba no mide la regla.';
  end if;
  begin
    r := public._conta_factura_apuntar(v);
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is null or v_msg not like '%Esta factura ya está contabilizada en el asiento 2/90011 del 20/10/2026, traído de Diez, por 121,00 €. No se apunta dos veces. Si es otra factura con el mismo número, márcala «No es repetida».%' then
    raise exception 'PRUEBA S01q·7 · 1: la pasada no la para con su mensaje: % / %', r, v_msg;
  end if;
  if exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = v) then
    raise exception 'PRUEBA S01q·7 · 1: se ha quedado un asiento suyo.';
  end if;
  raise notice 'PRUEBA S01q·7 · 1 (la pasada): «%»', v_msg;
end $$;

-- 2 · Regla 1 · la pantalla: el usuario de la cuenta D propone el asiento de la factura.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
do $$
declare r jsonb; v_msg text; v_err text;
begin
  begin
    r := public.journal_entry_proponer(pg_temp.p('e')::uuid, pg_temp.entrada(pg_temp.p('f1')::uuid, date '2026-10-20'), pg_temp.lineas(120.99), null, 'Prueba S01q·7 (pantalla)');
  exception when others then v_msg := sqlerrm; v_err := sqlstate;
  end;
  if v_err is distinct from '23505' or v_msg not like 'Esta factura ya está contabilizada en el asiento 2/90011 del 20/10/2026, traído de Diez, por 121,00 €.%' then
    raise exception 'PRUEBA S01q·7 · 2: la pantalla no la para con su mensaje: % / % / %', r, v_err, v_msg;
  end if;
  raise notice 'PRUEBA S01q·7 · 2 (la pantalla): % «%»', v_err, v_msg;
end $$;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);

-- 3 · Regla 1 · una tanda: un insert directo, sin pasar por ninguna función.
do $$
declare v_msg text; v_err text;
begin
  begin
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, created_by_name)
    values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid,
            (select id from public.fiscal_year where company_id = pg_temp.p('e')::uuid and date '2026-10-20' between starts_on and ends_on),
            2, date '2026-10-20', 'Factura S01Q7-0001 (tanda)', 'supplier_invoice', pg_temp.p('f1')::uuid, 'borrador', 'Prueba S01q·7 (tanda)');
  exception when others then v_msg := sqlerrm; v_err := sqlstate;
  end;
  if v_err is distinct from '23505' or v_msg not like 'Esta factura ya está contabilizada en el asiento 2/90011%' then
    raise exception 'PRUEBA S01q·7 · 3: una tanda la apunta otra vez: % / %', v_err, v_msg;
  end if;
  raise notice 'PRUEBA S01q·7 · 3 (una tanda): «%»', v_msg;
end $$;

-- 4 · Sin falsos: S01Q7-001 (empieza igual, es otra) se apunta; y con «No es repetida», la S01Q7-0001 también.
do $$
declare v uuid; r jsonb;
begin
  v := pg_temp.factura('S01Q7-001', date '2026-10-21', 10);
  r := public._journal_entry_proponer(pg_temp.p('e')::uuid, pg_temp.entrada(v, date '2026-10-21'), pg_temp.lineas(12.10), null, 'Prueba S01q·7', null);
  if nullif(r->>'id', '') is null then raise exception 'PRUEBA S01q·7 · 4: la S01Q7-001 (otra) no se apunta: %', r; end if;
  update public.supplier_invoice set not_duplicate_confirmed_at = now() where id = pg_temp.p('f1')::uuid;
  r := public._journal_entry_proponer(pg_temp.p('e')::uuid, pg_temp.entrada(pg_temp.p('f1')::uuid, date '2026-10-20'), pg_temp.lineas(120.99), null, 'Prueba S01q·7', null);
  if nullif(r->>'id', '') is null then raise exception 'PRUEBA S01q·7 · 4: con «No es repetida» no se apunta: %', r; end if;
  perform public._journal_entry_validar((r->>'id')::uuid, 'Prueba S01q·7');
  raise notice 'PRUEBA S01q·7 · 4: otro número que empieza igual se apunta; con «No es repetida», también la misma (y se valida).';
end $$;

-- 5 · Regla 2 · antes del corte: ni al proponer ni al cambiarle la fecha.
do $$
declare r jsonb; v_msg text; v_err text; v_corte date := pg_temp.p('corte')::date; v_id uuid;
begin
  begin
    r := public._journal_entry_proponer(pg_temp.p('e')::uuid,
           jsonb_build_object('series', 2, 'fecha', v_corte - 1, 'concepto', 'Asiento inventado S01q·7', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba.'),
           pg_temp.lineas(5), null, 'Prueba S01q·7', null);
  exception when others then v_msg := sqlerrm; v_err := sqlstate;
  end;
  if v_err is distinct from '23514' or v_msg not like format('No se apunta: el día %s es de antes del corte (%s). Ese periodo lo lleva %%',
                                                            to_char(v_corte - 1, 'DD/MM/YYYY'), to_char(v_corte, 'DD/MM/YYYY')) then
    raise exception 'PRUEBA S01q·7 · 5: un asiento de antes del corte se propone, o no lo dice: % / % / %', r, v_err, v_msg;
  end if;
  raise notice 'PRUEBA S01q·7 · 5 (proponer): «%»', v_msg;
  r := public._journal_entry_proponer(pg_temp.p('e')::uuid,
         jsonb_build_object('series', 2, 'fecha', v_corte + 1, 'concepto', 'Asiento inventado S01q·7', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba.'),
         pg_temp.lineas(5), null, 'Prueba S01q·7', null);
  v_id := (r->>'id')::uuid;
  v_msg := null;
  begin
    update public.journal_entry set entry_date = v_corte - 1 where id = v_id;
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is null or v_msg not like 'No se apunta: el día % es de antes del corte%' then
    raise exception 'PRUEBA S01q·7 · 5: cambiarle la fecha a antes del corte se deja: %', v_msg;
  end if;
  raise notice 'PRUEBA S01q·7 · 5 (cambiar la fecha): «%»', v_msg;
end $$;

-- 6 · Regla 3 · una factura emitida, un asiento: dos emitidas (en borrador) con el mismo asiento.
do $$
declare v_entry uuid; v_a uuid; v_b uuid; v_msg text; v_err text;
begin
  select id into v_entry from public.journal_entry where company_id = pg_temp.p('e')::uuid and status <> 'anulado' order by created_at desc limit 1;
  insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, issue_date, customer, base, tax, surcharge, surcharge_amount, withholding_amount, total, number_text, entry_id)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, 'borrador', 'factura', 'a_mano', 'S7', date '2026-10-22', '{"nombre": "Cliente inventado"}', 10, 2.1, false, 0, 0, 12.1, 'S7-0001', v_entry)
  returning id into v_a;
  begin
    insert into public.customer_invoice (account_id, company_id, status, doc_type, origin, series_code, issue_date, customer, base, tax, surcharge, surcharge_amount, withholding_amount, total, number_text, entry_id)
    values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, 'borrador', 'factura', 'a_mano', 'S7', date '2026-10-22', '{"nombre": "Cliente inventado"}', 20, 4.2, false, 0, 0, 24.2, 'S7-0002', v_entry)
    returning id into v_b;
  exception when others then v_msg := sqlerrm; v_err := sqlstate;
  end;
  if v_err is distinct from '23505' or v_msg <> 'Este asiento ya es el de la factura S7-0001 del 22/10/2026. Una factura, un asiento.' then
    raise exception 'PRUEBA S01q·7 · 6: dos emitidas con el mismo asiento: % / %', v_err, v_msg;
  end if;
  insert into _p values ('ci', v_a);
  raise notice 'PRUEBA S01q·7 · 6: «%»', v_msg;
end $$;

-- 7 · Regla 4 · un pago o un cobro no pasa del total.
do $$
declare v uuid; v_msg text; v_err text;
begin
  -- Pagada entera (120,99 €), y otra vez.
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, pg_temp.p('f1')::uuid, date '2026-10-26', 120.99, 'transfer', 'Prueba S01q·7');
  begin
    insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
    values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, pg_temp.p('f1')::uuid, date '2026-10-27', 120.99, 'transfer', 'Prueba S01q·7');
  exception when others then v_msg := sqlerrm; v_err := sqlstate;
  end;
  if v_err is distinct from '23505' or v_msg <> 'Esta factura ya está pagada: 120,99 € el 26/10 por transferencia. Para pagarla otra vez, deshaz antes ese pago.' then
    raise exception 'PRUEBA S01q·7 · 7: un pago de más pasa: % / %', v_err, v_msg;
  end if;
  raise notice 'PRUEBA S01q·7 · 7 (pagada): «%»', v_msg;
  -- Pagada en parte (60 de 121): un pago de 70 pasa del total; uno de 61 cabe.
  v := pg_temp.factura('S01Q7-0004', date '2026-10-22', 100);
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, v, date '2026-10-26', 60, 'transfer', 'Prueba S01q·7');
  v_msg := null;
  begin
    insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
    values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, v, date '2026-10-27', 70, 'transfer', 'Prueba S01q·7');
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is distinct from 'Esta factura es de 121,00 € y ya tiene 60,00 € pagados: este pago de 70,00 € pasa del total.' then
    raise exception 'PRUEBA S01q·7 · 7: un pago que pasa del total en parte: %', v_msg;
  end if;
  insert into public.supplier_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, v, date '2026-10-27', 61, 'transfer', 'Prueba S01q·7');
  raise notice 'PRUEBA S01q·7 · 7 (en parte): «%»; el que cabe, entra.', v_msg;
  -- Cobrada entera (12,10 €), y otra vez.
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, pg_temp.p('ci')::uuid, date '2026-10-28', 12.10, 'transfer', 'Prueba S01q·7');
  v_msg := null;
  begin
    insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method, created_by_name)
    values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, pg_temp.p('ci')::uuid, date '2026-10-29', 12.10, 'transfer', 'Prueba S01q·7');
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is distinct from 'Esta factura ya está cobrada: 12,10 € el 28/10 por transferencia. Para cobrarla otra vez, deshaz antes ese cobro.' then
    raise exception 'PRUEBA S01q·7 · 7: un cobro de más pasa: %', v_msg;
  end if;
  raise notice 'PRUEBA S01q·7 · 7 (cobrada): «%»', v_msg;
end $$;

-- 9 · S01q·8 · El borrado dice en qué declaración está un asiento: en borrador, «sácalo del
--     borrador y recalcúlalo después»; presentada, «ya presentado». En los dos, no borra.
do $$
declare r jsonb; v_id uuid; v_linea uuid; v_b uuid; v_f uuid; v_msg text;
begin
  r := public._journal_entry_proponer(pg_temp.p('e')::uuid,
         jsonb_build_object('series', 2, 'fecha', pg_temp.p('corte')::date + 3, 'concepto', 'Asiento inventado S01q·8', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba.'),
         pg_temp.lineas(7), null, 'Prueba S01q·8', null);
  v_id := (r->>'id')::uuid;
  perform public._journal_entry_validar(v_id, 'Prueba S01q·8');
  select id into v_linea from public.journal_line where entry_id = v_id order by position limit 1;
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, sequence)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, '303', 2026, 'quarterly', '4T', date '2027-01-30', 'draft', 9) returning id into v_b;
  insert into public.tax_return_line (tax_return_id, account_id, company_id, journal_line_id, frozen)
  values (v_b, pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, v_linea, '{"libro": "received"}');
  begin
    perform public._conta_asientos_borrar(pg_temp.p('e')::uuid, array[v_id], 'Prueba S01q·8.', 'Prueba S01q·8');
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is null or v_msg not like 'No se borra nada. El asiento 2/% está en el borrador del 303 del 4T de 2026: no se borra mientras esté ahí. Sácalo del borrador y recalcúlalo después.' then
    raise exception 'PRUEBA S01q·8 · 9: en un borrador, no lo dice o lo borra: %', v_msg;
  end if;
  raise notice 'PRUEBA S01q·8 · 9 (borrador): «%»', v_msg;
  delete from public.tax_return_line where tax_return_id = v_b;
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, sequence,
                                 filed_at, filed_via, aeat_csv, result_kind, amount)
  values (pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, '303', 2026, 'quarterly', '4T', date '2027-01-30', 'filed', 10,
          now(), 'outside', 'CSVINVENTADO0000', 'zero', 0) returning id into v_f;
  insert into public.tax_return_line (tax_return_id, account_id, company_id, journal_line_id, frozen)
  values (v_f, pg_temp.p('acc')::uuid, pg_temp.p('e')::uuid, v_linea, '{"libro": "received"}');
  v_msg := null;
  begin
    perform public._conta_asientos_borrar(pg_temp.p('e')::uuid, array[v_id], 'Prueba S01q·8.', 'Prueba S01q·8');
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg is null or v_msg not like 'No se borra nada. El asiento 2/% está en el 303 del 4T de 2026, ya presentado: no se borra.' then
    raise exception 'PRUEBA S01q·8 · 9: en una presentada, no lo dice o lo borra: %', v_msg;
  end if;
  if not exists (select 1 from public.journal_entry where id = v_id) then raise exception 'PRUEBA S01q·8 · 9: el asiento se ha borrado.'; end if;
  raise notice 'PRUEBA S01q·8 · 9 (presentada): «%»', v_msg;
end $$;

-- 8 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261102T2011_s01q_no_duplicar.down.sql
\i supabase/vuelta-atras/20261102T2010_s01q_borrar_vercel_supabase.down.sql
\i supabase/vuelta-atras/20261102T2139_s01q_borrar_dice_borrador.down.sql
do $$ begin
  if pg_get_functiondef('public._conta_asientos_borrar(uuid,uuid[],text,text)'::regprocedure) like '%%S01q·8%%' then
    raise exception 'PRUEBA S01q·7 · 8: la vuelta atrás no devuelve _conta_asientos_borrar a la de antes.';
  end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_journal_entry_factura_una_vez', 'trg_journal_entry_no_antes_del_corte', 'trg_customer_invoice_un_asiento',
                                                        'trg_supplier_invoice_payment_tope', 'trg_customer_invoice_payment_tope'))
     or to_regclass('public.ux_customer_invoice_entry') is not null then
    raise exception 'PRUEBA S01q·7 · 8: la vuelta atrás no quita las reglas.';
  end if;
  raise notice 'PRUEBA S01q·7 · 8: la vuelta atrás quita las cuatro reglas.';
end $$;
-- Delante otra vez: lo que la prueba ha dejado (la factura con dos asientos, tras «No es repetida») no lo impide.
\i supabase/migrations/20261102T2139_s01q_borrar_dice_borrador.sql
\i supabase/migrations/20261102T2011_s01q_no_duplicar.sql

rollback;
