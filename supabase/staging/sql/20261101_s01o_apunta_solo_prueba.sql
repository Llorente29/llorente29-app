-- supabase/staging/sql/20261101_s01o_apunta_solo_prueba.sql
--
-- SOLO STAGING. Prueba del S01o · lo que Sumied sabe al 100 % se apunta solo:
-- las facturas de comisión de las plataformas (20261101T1729, 1730, 1731 y
-- 1732). Todo en una transacción con ROLLBACK. Datos inventados, en la cuenta
-- D: una plataforma de prueba con su local, su tienda y sus liquidaciones.
-- Prueba lo que cambia en caliente: public.company_account_link (el papel
-- «publicidad») y public._conta_comision_buscar (primero por el número).
--
--   1. Sin cuenta de gasto en la ficha: no se apunta, «Falta la cuenta de gasto
--      en la ficha de …»; con el interruptor apagado, tampoco.
--   2. Ligada a la liquidación de su número y cuadra: se apunta sola (validada,
--      3 líneas, su local, pagada por compensación) y dice su porqué.
--   3. Incluye la tarifa recurrente: se apunta y lo dice.
--   4. No cuadra (otra diferencia): no se apunta, su motivo en una frase.
--   5. Ligada a la liquidación de OTRA factura: se religa a la de su número.
--   6. Rectificativa con UNA liquidación de su número: se liga y se apunta.
--      Rectificativa con DOS: se apunta sin ligar.
--   7. Publicidad: con la cuenta de publicidad en la ficha, la de «Tarifa
--      publicitaria» va a la suya; la que mezcla, «No sé si es comisión o publicidad».
--   8. Como persona: «Apuntadas solas» y «Deshacer» (contraasiento, vuelve a
--      «Por revisar» y no se apunta sola otra vez); la función interna no es suya.
--   9. La 1732 no hace nada sin Foodint; la vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01o: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- El workflow ya ha pasado la tanda de la rama; se puede pasar dos veces.
\i supabase/migrations/20261101T1729_s01o_ficha_publicidad.sql
\i supabase/migrations/20261101T1730_s01o_comision_por_numero.sql
\i supabase/migrations/20261101T1731_s01o_plataforma_apunta_sola.sql
\i supabase/migrations/20261101T1732_s01o_foodint.sql

-- Preparar (todo inventado): plataforma, proveedor con su subcuenta, local, tienda y el interruptor encendido.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_canal uuid; v_party uuid; v_sup uuid; v_loc uuid; v_t uuid; v_sub uuid;
begin
  insert into public.sales_channel (account_id, name, slug) values (v_acc, 'Plataforma S01o', 'plataforma-s01o') returning id into v_canal;
  insert into public.supplier (account_id, name, tax_id) values (v_acc, 'Plataforma de Prueba S01o, S.L.', 'B00000192') returning id into v_sup;
  select party_id into v_party from public.party_role where account_id = v_acc and role = 'supplier' and supplier_id = v_sup;
  if v_party is null then
    insert into public.party (account_id, name) values (v_acc, 'Plataforma de Prueba S01o, S.L.') returning id into v_party;
    insert into public.party_role (account_id, party_id, role, supplier_id) values (v_acc, v_party, 'supplier', v_sup);
  end if;
  insert into public.party_role (account_id, party_id, role, channel_id) values (v_acc, v_party, 'platform', v_canal);
  insert into public.locations (account_id, name, address) values (v_acc, 'Local Inventado S01o', 'Calle Inventada Este, 3') returning id into v_loc;
  insert into public.platform_store (account_id, company_id, provider, external_text, location_id)
  values (v_acc, v_e, 'glovo', 'Marca S01o (Calle Inventada Este 3)', v_loc) returning id into v_t;
  -- Su subcuenta en la ficha (la que pone el alta, o una nueva).
  if not exists (select 1 from public.company_account_link where company_id = v_e and entity = 'supplier' and entity_id = v_sup::text and role = 'principal') then
    insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
    values (v_acc, v_e, 'pymes', '41000992', '4100', 'Plataforma de Prueba S01o', 'own', 'manual') returning id into v_sub;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_acc, v_e, v_sub, 'supplier', v_sup::text, 'principal', 'manual');
  end if;
  -- El ejercicio de 2026 de D, si no lo tiene (la base local no trae ninguno).
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and current_date between starts_on and ends_on);
  insert into public.company_purchase_setting (company_id, account_id, receives_goods, post_safe_invoices)
  values (v_e, v_acc, true, true)
  on conflict (company_id) do update set post_safe_invoices = true;
  perform set_config('prueba.acc', v_acc::text, true);
  perform set_config('prueba.e', v_e::text, true);
  perform set_config('prueba.sup', v_sup::text, true);
  perform set_config('prueba.canal', v_canal::text, true);
  perform set_config('prueba.t', v_t::text, true);
  perform set_config('prueba.loc', v_loc::text, true);
end $$;

-- Una liquidación con el número y el total de su factura (como el Excel de Glovo).
create function pg_temp.liquidacion(p_clave text, p_num text, p_total numeric, p_desde date default '2026-10-01', p_hasta date default '2026-10-15')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, import_key, net_payout, commission, raw)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.canal')::uuid, current_setting('prueba.t')::uuid, p_desde, p_hasta,
          'S01o-' || p_clave, 500, -abs(p_total), jsonb_build_object('factura', jsonb_build_object('numero', p_num, 'total', p_total)))
  returning id into v;
  return v;
end $$;

-- Una factura de la plataforma por revisar, con sus líneas (texto y base) al 21 %.
create function pg_temp.factura(p_num text, p_lineas jsonb, p_fecha date default '2026-10-15')
returns uuid language plpgsql as $$
declare v uuid; v_base numeric; x jsonb; i int := 0;
begin
  select round(sum((e->>'base')::numeric), 2) into v_base from jsonb_array_elements(p_lineas) e;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name, reading)
  values (current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, current_setting('prueba.sup')::uuid, p_num, p_fecha,
          v_base, round(v_base * 0.21, 2), v_base + round(v_base * 0.21, 2), 'en_revision', 'manual', 'Prueba S01o', '{}'::jsonb)
  returning id into v;
  for x in select * from jsonb_array_elements(p_lineas) loop
    i := i + 1;
    insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, position, line_amount, vat_pct) values (v, x->>'texto', i, (x->>'base')::numeric, 21);
  end loop;
  update public.supplier_invoice set reading = reading where id = v;
  return v;
end $$;

-- 1 · Sin cuenta de gasto en la ficha, no; con el interruptor apagado, tampoco.
do $$
declare v uuid; r jsonb;
begin
  perform pg_temp.liquidacion('a', 'S01OA0001', 121.00);
  v := pg_temp.factura('S01OA0001', '[{"texto":"Comisión por pedidos 01/10/26 - 15/10/26","base":100}]');
  perform set_config('prueba.a', v::text, true);
  r := public._conta_plataforma_apuntar(v);
  if (r->>'apuntada')::boolean or r->>'motivo' <> 'Falta la cuenta de gasto en la ficha de Plataforma S01o.' then
    raise exception 'PRUEBA S01o · 1: sin cuenta de gasto en la ficha no dice lo que falta: %', r;
  end if;
  if (select porque from public.supplier_invoice_auto where invoice_id = v) is distinct from r->>'motivo' then
    raise exception 'PRUEBA S01o · 1: el motivo no queda guardado para «Por revisar».';
  end if;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, a.id, 'supplier', current_setting('prueba.sup'), 'gasto', 'manual'
    from public.company_account a where a.company_id = current_setting('prueba.e')::uuid and a.code = '62300000';
  update public.company_purchase_setting set post_safe_invoices = false where company_id = current_setting('prueba.e')::uuid;
  r := public._conta_plataforma_apuntar(v);
  if (r->>'apuntada')::boolean or r->>'motivo' not like '%apagado%' then
    raise exception 'PRUEBA S01o · 1: con el interruptor apagado se ha apuntado o no lo dice: %', r;
  end if;
  update public.company_purchase_setting set post_safe_invoices = true where company_id = current_setting('prueba.e')::uuid;
  raise notice 'PRUEBA S01o · 1: sin cuenta de gasto, «%»; con el interruptor apagado, «%».', 'Falta la cuenta de gasto en la ficha de Plataforma S01o.', r->>'motivo';
end $$;

-- 2 · Ligada a la de su número y cuadra: se apunta sola.
do $$
declare v uuid := current_setting('prueba.a')::uuid; r jsonb; f public.supplier_invoice; e public.journal_entry; n int;
begin
  if not exists (select 1 from public.channel_settlement_invoice k join public.channel_settlement cs on cs.id = k.settlement_id
                  where k.supplier_invoice_id = v and cs.import_key = 'S01o-a') then
    raise exception 'PRUEBA S01o · 2: la factura no se ha ligado a la liquidación de su número.';
  end if;
  r := public._conta_plataforma_apuntar(v);
  if not coalesce((r->>'apuntada')::boolean, false) then raise exception 'PRUEBA S01o · 2: la que cuadra no se ha apuntado: %', r; end if;
  select * into f from public.supplier_invoice where id = v;
  select * into e from public.journal_entry where id = (r->>'asiento')::uuid;
  if e.status <> 'validado' or e.series <> 2 or e.source_type <> 'supplier_invoice' or e.source_id <> v then
    raise exception 'PRUEBA S01o · 2: el asiento no está validado en Compras con su factura: % % %', e.status, e.series, e.source_type;
  end if;
  select count(*) into n from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = e.id and l.location_id = current_setting('prueba.loc')::uuid
     and ((a.code = '62300000' and l.debit = 100 and l.credit = 0)
       or (a.code = '47200021' and l.debit = 21 and l.tax_base = 100 and l.vat_book = 'received')
       or (a.code = '41000992' and l.credit = 121 and l.debit = 0));
  if n <> 3 or (select count(*) from public.journal_line where entry_id = e.id) <> 3 then
    raise exception 'PRUEBA S01o · 2: las líneas no son 623 al debe, 472 y la subcuenta al haber, con su local (% de 3).', n;
  end if;
  if f.status <> 'pagada' or f.paid_method <> 'compensation' or f.approved_by_name <> 'Folvy (apunta solo · plataforma)' then
    raise exception 'PRUEBA S01o · 2: no queda aprobada por Folvy y pagada por compensación: % % %', f.status, f.paid_method, f.approved_by_name;
  end if;
  if (select porque from public.supplier_invoice_auto where invoice_id = v and estado = 'apuntada') not like 'Factura de Plataforma S01o de su liquidación del 1–15/10 de Local Inventado S01o (mismo número); cuadra al céntimo.' then
    raise exception 'PRUEBA S01o · 2: su porqué no es el esperado: %', r->>'porque';
  end if;
  r := public._conta_plataforma_apuntar(v);
  if (r->>'apuntada')::boolean then raise exception 'PRUEBA S01o · 2: se ha apuntado dos veces.'; end if;
  raise notice 'PRUEBA S01o · 2: apuntada sola, validada y pagada por compensación: «%»', (select porque from public.supplier_invoice_auto where invoice_id = v);
end $$;

-- 3 · Con la tarifa recurrente, que el Excel no cuenta como comisión.
do $$
declare v uuid; r jsonb;
begin
  perform pg_temp.liquidacion('b', 'S01OB0001', 121.00, '2026-10-16', '2026-10-31');
  v := pg_temp.factura('S01OB0001', '[{"texto":"Comisión por pedidos 16/10/26 - 31/10/26","base":100},{"texto":"Tarifa recurrente por utilizar la plataforma","base":10}]', '2026-10-31');
  r := public._conta_plataforma_apuntar(v);
  if not coalesce((r->>'apuntada')::boolean, false) or r->>'porque' not like '%la factura incluye la tarifa recurrente (12,10 €), que el Excel no cuenta como comisión.' then
    raise exception 'PRUEBA S01o · 3: la de la tarifa recurrente no se apunta o no lo dice: %', r;
  end if;
  raise notice 'PRUEBA S01o · 3: «%»', r->>'porque';
end $$;

-- 4 · Otra diferencia: se queda, con su motivo.
do $$
declare v uuid; r jsonb;
begin
  perform pg_temp.liquidacion('c', 'S01OC0001', 100.00, '2026-09-16', '2026-09-30');
  v := pg_temp.factura('S01OC0001', '[{"texto":"Comisión por pedidos 16/09/26 - 30/09/26","base":100}]', '2026-09-30');
  r := public._conta_plataforma_apuntar(v);
  if (r->>'apuntada')::boolean or r->>'motivo' <> 'La factura y su liquidación difieren en 21,00 € y no es la tarifa recurrente.'
     or exists (select 1 from public.journal_entry where source_type = 'supplier_invoice' and source_id = v)
     or (select status from public.supplier_invoice where id = v) <> 'en_revision' then
    raise exception 'PRUEBA S01o · 4: la que no cuadra se ha apuntado o no dice por qué: %', r;
  end if;
  raise notice 'PRUEBA S01o · 4: se queda en «Por revisar»: «%»', r->>'motivo';
end $$;

-- 5 · Ligada a la liquidación de otra factura: _conta_comision_buscar la religa a la de su número.
do $$
declare v uuid; l_otra uuid; l_suya uuid;
begin
  l_otra := pg_temp.liquidacion('d1', 'S01OX0009', 50.00, '2026-08-01', '2026-08-15');
  v := pg_temp.factura('S01OD0001', '[{"texto":"Comisión por pedidos 01/08/26 - 15/08/26","base":50}]', '2026-08-15');
  delete from public.channel_settlement_invoice where supplier_invoice_id = v;
  perform public._conta_comision_ligar(v, l_otra, 'sumied', 'Prueba S01o');
  l_suya := pg_temp.liquidacion('d2', 'S01OD0001', 60.50, '2026-08-01', '2026-08-15');
  -- Primero buscar, y después mirar: en la misma consulta no se verían sus cambios.
  if public._conta_comision_buscar(v) <> 'ligada' then raise exception 'PRUEBA S01o · 5: _conta_comision_buscar no dice «ligada».'; end if;
  if not exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v and settlement_id = l_suya)
     or exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v and settlement_id = l_otra) then
    raise exception 'PRUEBA S01o · 5: no se ha religado a la liquidación de su número.';
  end if;
  raise notice 'PRUEBA S01o · 5: la que estaba ligada a la liquidación de otra factura se liga a la de su número.';
end $$;

-- 6 · Rectificativas: con una liquidación de su número, ligada y apuntada; con dos, apuntada sin ligar.
do $$
declare v1 uuid; v2 uuid; r1 jsonb; r2 jsonb; n int;
begin
  perform pg_temp.liquidacion('e', 'S01OE0001', -24.20, '2026-07-01', '2026-07-15');
  v1 := pg_temp.factura('S01OE0001', '[{"texto":"Abono de comisión","base":-20}]', '2026-07-15');
  if not exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v1) then
    raise exception 'PRUEBA S01o · 6: la rectificativa con una liquidación de su número no se ha ligado.';
  end if;
  r1 := public._conta_plataforma_apuntar(v1);
  if not coalesce((r1->>'apuntada')::boolean, false) or r1->>'porque' not like '%Ligado a su liquidación del 1–15/07.' then
    raise exception 'PRUEBA S01o · 6: la rectificativa ligada no se apunta o no lo dice: %', r1;
  end if;
  select count(*) into n from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = (r1->>'asiento')::uuid
     and ((a.code = '62300000' and l.credit = 20) or (a.code = '47200021' and l.credit = 4.20 and l.tax_base = 20) or (a.code = '41000992' and l.debit = 24.20));
  if n <> 3 then raise exception 'PRUEBA S01o · 6: el abono no va al revés (% de 3 líneas).', n; end if;
  perform pg_temp.liquidacion('f1', 'S01OF0001', -12.10, '2026-07-16', '2026-07-31');
  perform pg_temp.liquidacion('f2', 'S01OF0001', -12.10, '2026-07-16', '2026-07-31');
  v2 := pg_temp.factura('S01OF0001', '[{"texto":"Abono de comisión","base":-10}]', '2026-07-31');
  r2 := public._conta_plataforma_apuntar(v2);
  if exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v2)
     or not coalesce((r2->>'apuntada')::boolean, false) or r2->>'porque' not like '%Sin liquidación ligada.' then
    raise exception 'PRUEBA S01o · 6: la rectificativa con dos liquidaciones se ha ligado o no se ha apuntado: %', r2;
  end if;
  raise notice 'PRUEBA S01o · 6: «%» · «%»', r1->>'porque', r2->>'porque';
end $$;

-- 7 · Publicidad: a su cuenta si la ficha la tiene; si mezcla, no adivina.
do $$
declare v1 uuid; v2 uuid; v3 uuid; r1 jsonb; r2 jsonb; r3 jsonb;
begin
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select current_setting('prueba.acc')::uuid, current_setting('prueba.e')::uuid, a.id, 'supplier', current_setting('prueba.sup'), 'publicidad', 'manual'
    from public.company_account a where a.company_id = current_setting('prueba.e')::uuid and a.code = '62700000';
  perform pg_temp.liquidacion('g', 'S01OG0001', 36.30, '2026-06-01', '2026-06-15');
  v1 := pg_temp.factura('S01OG0001', '[{"texto":"Tarifa publicitaria","base":30}]', '2026-06-15');
  r1 := public._conta_plataforma_apuntar(v1);
  if not coalesce((r1->>'apuntada')::boolean, false) or r1->>'porque' not like 'Factura de publicidad de Plataforma S01o%'
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                     where l.entry_id = (r1->>'asiento')::uuid and a.code = '62700000' and l.debit = 30) then
    raise exception 'PRUEBA S01o · 7: la de publicidad no va a la cuenta de publicidad de su ficha: %', r1;
  end if;
  perform pg_temp.liquidacion('h', 'S01OH0001', 48.40, '2026-06-16', '2026-06-30');
  v2 := pg_temp.factura('S01OH0001', '[{"texto":"Comisión por pedidos","base":30},{"texto":"Glovo Ads","base":10}]', '2026-06-30');
  r2 := public._conta_plataforma_apuntar(v2);
  if (r2->>'apuntada')::boolean or r2->>'motivo' <> 'No sé si es comisión o publicidad.' then
    raise exception 'PRUEBA S01o · 7: la que mezcla comisión y publicidad se ha apuntado: %', r2;
  end if;
  perform pg_temp.liquidacion('i', 'S01OI0001', 12.10, '2026-05-01', '2026-05-15');
  v3 := pg_temp.factura('S01OI0001', '[{"texto":"Comisión por pedidos","base":10}]', '2026-05-15');
  r3 := public._conta_plataforma_apuntar(v3);
  if not coalesce((r3->>'apuntada')::boolean, false)
     or not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                     where l.entry_id = (r3->>'asiento')::uuid and a.code = '62300000' and l.debit = 10) then
    raise exception 'PRUEBA S01o · 7: con la cuenta de publicidad en la ficha, la de comisión no va a la de gasto: %', r3;
  end if;
  raise notice 'PRUEBA S01o · 7: «%» · la que mezcla: «%»', r1->>'porque', r2->>'motivo';
end $$;

-- 8 · Como persona (administrador de la cuenta D): «Apuntadas solas» y «Deshacer».
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v uuid := current_setting('prueba.a')::uuid; r jsonb; d jsonb;
begin
  r := public.conta_apuntadas_solas(current_setting('prueba.e')::uuid);
  if (r->>'semana')::int < 5 or not exists (select 1 from jsonb_array_elements(r->'filas') x where (x->>'id')::uuid = v)
     or r->'motivos'->>(current_setting('prueba.a')) is not null then
    raise exception 'PRUEBA S01o · 8: «Apuntadas solas» no la enseña con su porqué: %', r;
  end if;
  d := public.conta_apuntada_sola_deshacer(v, 'Prueba S01o');
  if d->>'texto' not like 'Devuelta a «Por revisar»: S01OA0001. Su asiento queda anulado con su contraasiento.' then
    raise exception 'PRUEBA S01o · 8: «Deshacer» no dice lo que ha hecho: %', d;
  end if;
  begin
    perform public._conta_plataforma_apuntar(v);
    raise exception 'PRUEBA S01o · 8: la persona puede llamar a la función interna.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA S01o · 8: como persona: % apuntadas solas esta semana; «%»', r->>'semana', d->>'texto';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare v uuid := current_setting('prueba.a')::uuid; f public.supplier_invoice; r jsonb;
begin
  select * into f from public.supplier_invoice where id = v;
  if f.status <> 'en_revision' or f.paid_at is not null
     or exists (select 1 from public.supplier_invoice_payment where invoice_id = v)
     or not exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = v and e.status = 'anulado' and e.voided_by_entry_id is not null) then
    raise exception 'PRUEBA S01o · 8: deshecha no vuelve a «Por revisar» sin pago o su asiento no queda anulado: % %', f.status, f.paid_at;
  end if;
  r := public._conta_plataforma_apuntar(v);
  if (r->>'apuntada')::boolean or r->>'motivo' not like '%no se apunta sola otra vez%' then
    raise exception 'PRUEBA S01o · 8: deshecha por una persona, se ha vuelto a apuntar sola: %', r;
  end if;
  raise notice 'PRUEBA S01o · 8: deshecha: en «Por revisar», asiento anulado con su contraasiento, y «%»', r->>'motivo';
end $$;

-- 9 · La pasada entera de la empresa y la vuelta atrás, y otra vez delante.
do $$
declare r jsonb;
begin
  r := public._conta_plataformas_apuntar(current_setting('prueba.e')::uuid);
  if r->>'apuntadas' is null or r->>'quedan' is null then raise exception 'PRUEBA S01o · 9: la pasada no dice cuántas: %', r; end if;
  raise notice 'PRUEBA S01o · 9: la pasada de la empresa: %', r;
  -- El papel «publicidad» se quita antes que su CHECK (lo hace la vuelta atrás de la 1732 con las que puso).
  delete from public.company_account_link where company_id = current_setting('prueba.e')::uuid and role = 'publicidad';
end $$;
\i supabase/vuelta-atras/20261101T1732_s01o_foodint.down.sql
\i supabase/vuelta-atras/20261101T1731_s01o_plataforma_apunta_sola.down.sql
\i supabase/vuelta-atras/20261101T1730_s01o_comision_por_numero.down.sql
\i supabase/vuelta-atras/20261101T1729_s01o_ficha_publicidad.down.sql
do $$ begin
  if to_regclass('public.supplier_invoice_auto') is not null or to_regclass('public.s01o_ficha_puesta') is not null
     or to_regprocedure('public._conta_plataforma_seguro(uuid)') is not null or to_regprocedure('public._conta_comision_de_su_numero(uuid)') is not null
     or pg_get_functiondef('public._conta_comision_buscar(uuid)'::regprocedure) like '%S01o%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'company_account_link_role_check')) like '%publicidad%' then
    raise exception 'PRUEBA S01o · 9: la vuelta atrás no deja las cosas como estaban.';
  end if;
  raise notice 'PRUEBA S01o · 9: la vuelta atrás quita lo de la 1729 a la 1732 y devuelve _conta_comision_buscar.';
end $$;
\i supabase/migrations/20261101T1729_s01o_ficha_publicidad.sql
\i supabase/migrations/20261101T1730_s01o_comision_por_numero.sql
\i supabase/migrations/20261101T1731_s01o_plataforma_apunta_sola.sql

rollback;
