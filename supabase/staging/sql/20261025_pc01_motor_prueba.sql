-- supabase/staging/sql/20261025_pc01_motor_prueba.sql
--
-- SOLO STAGING. Prueba de la 0916 (añade) y la 0917 (cambia) del PC01 · E1, con
-- \i dentro de la transacción y ROLLBACK: staging no cambia. En la empresa A
-- (Taberna de Prueba Norte), con datos INVENTADOS que se siembra ella misma:
-- un canal «Plataforma PC01», dos marcas, ventas del 5 al 7/10/2026 en Norte
-- Centro, sus cierres con asiento y su factura.
--
-- Nombra lo que la 0917 cambia, para el analizador: customer_invoice_payment,
-- bank_match_item, bank_match, channel_settlement, platform_store,
-- customer_invoice, supplier_invoice, bank_casar, mark_supplier_invoice_paid,
-- unmark_supplier_invoice_paid y journal_entry_anular.
--
--   0. Lo de antes: las funciones que cambia la 0917, con su md5 (después de
--      las vueltas atrás, que dejan lo de producción).
--   1. Vencimientos: semanal, quincenal y mensual (conta_vence_por_plataforma);
--      la factura de un cierre de plataforma nace con el suyo (disparador de
--      customer_invoice); sin plataforma, el de siempre.
--   2. Liquidación por PERIODO (sin pedidos, como Uber por correo): sin marca en
--      su tienda, «a revisar»; con marca, cobra cada factura por lo que su
--      cierre cuenta de los pedidos de esa marca; descobrarla quita los cobros;
--      con otro número de pedidos, «a revisar» y nada cobrado.
--   3. Liquidación por PEDIDOS (channel_settlement_order con su venta).
--   4. Los estados (conta_factura_cobro y conta_recibida_pago), como usuario
--      (una de plataforma pasada de plazo y sin liquidación, «falta_liquidacion»;
--      con liquidación que no la cubre, «vencida»); y
--      guardar el plazo en la ficha (conta_plataforma_plazo_guardar) mueve el
--      vencimiento de sus facturas por cobrar, no el de las cobradas.
--   5. Recibida: al validarla, el plazo del proveedor; sin plazo, sin vencimiento.
--   6. Bancos, pago: casar una recibida escribe su pago con el asiento del
--      banco y la marca pagada; a mano no se marca (mark_supplier_invoice_paid);
--      unmark_supplier_invoice_paid no la deshace con el pago ahí; deshacer el
--      casado (bank_deshacer) quita el pago y la deja por pagar.
--   7. Bancos, cobro: bank_casar «factura_emitida» con «facturas» cobra la
--      factura con el asiento del banco; no se pasa; deshacer el casado (su
--      asiento propuesto se borra) quita el cobro; validar y anular ese asiento
--      (journal_entry_anular) también.
--   8. El lote de prepago: su asiento en la factura es su pago, y queda pagada.
--   9. Un cobro negativo cabe (CHECK de customer_invoice_payment).
--  10. Las vueltas atrás: las funciones como al principio (md5), sin
--      disparadores, sin tablas ni columnas del PC01.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 MOTOR: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';

-- El ensayo de la rama puede haber pasado ya la 0916 de verdad (solo añade):
-- primero las dos vueltas atrás, y desde ahí «lo de antes» es producción.
\i supabase/vuelta-atras/20261025T0917_pc01_motor_cambia.down.sql
\i supabase/vuelta-atras/20261025T0916_pc01_motor_cobros_pagos.down.sql

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated;
insert into _p values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('local', 'c01a0000-0000-4000-8000-0000000000a2'), ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'),
  ('banco', 'b0100000-0000-4000-8000-0000000000b3');
insert into _p select 'md5_' || p.proname, md5(pg_get_functiondef(p.oid)) from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('bank_casar', 'mark_supplier_invoice_paid', 'unmark_supplier_invoice_paid', 'journal_entry_anular');
do $$ begin
  if (select count(*) from _p where clave like 'md5_%') <> 4 then raise exception 'PRUEBA PC01 · 0: faltan funciones de partida.'; end if;
  raise notice '0 · lo de antes: las 4 funciones de partida, con su md5';
end $$;

\i supabase/migrations/20261025T0916_pc01_motor_cobros_pagos.sql
\i supabase/migrations/20261025T0917_pc01_motor_cambia.sql

-- ── Siembra (como el dueño) ─────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        l uuid := (select v::uuid from _p where clave = 'local'); c uuid; m1 uuid; m2 uuid; pa uuid; fy uuid; d date; ent uuid; s1 uuid; s2 uuid; s3 uuid;
        n int := 9000; tot numeric;
begin
  insert into public.sales_channel (account_id, name, slug) values (a, 'Plataforma PC01', 'pc01-plataforma') returning id into c;
  insert into public.brand (account_id, name, slug) values (a, 'Marca PC01 Uno', 'pc01-uno') returning id into m1;
  insert into public.brand (account_id, name, slug) values (a, 'Marca PC01 Dos', 'pc01-dos') returning id into m2;
  insert into public.party (account_id, name) values (a, 'Plataforma PC01') returning id into pa;
  insert into public.party_role (account_id, party_id, role, channel_id, settlement_every, payout_days_after) values (a, pa, 'platform', c, 'weekly', 1);
  insert into _p values ('canal', c), ('m1', m1), ('m2', m2), ('parte', pa);
  select id into fy from public.fiscal_year where company_id = e and date '2026-10-05' between starts_on and ends_on limit 1;
  if fy is null then raise exception 'PRUEBA PC01 · siembra: la empresa A no tiene ejercicio para octubre de 2026.'; end if;
  -- Ventas: lunes 5/10 (m1 10 €, m2 20 €), martes 6/10 (m1 15,50 €), miércoles 7/10 (m1 8 €).
  insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total, tax, taxable_base, status) values
    (a, l, m1, c, 'manual', '2026-10-05 13:00+02', 10.00, 0.91, 9.09, 'closed') returning id into s1;
  insert into _p values ('v1', s1);
  insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total, tax, taxable_base, status) values
    (a, l, m2, c, 'manual', '2026-10-05 14:00+02', 20.00, 1.82, 18.18, 'closed') returning id into s2;
  insert into _p values ('v2', s2);
  insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total, tax, taxable_base, status) values
    (a, l, m1, c, 'manual', '2026-10-06 23:30+02', 15.50, 1.41, 14.09, 'closed') returning id into s3;
  insert into _p values ('v3', s3);
  insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total, tax, taxable_base, status) values
    (a, l, m1, c, 'manual', '2026-10-07 12:00+02', 8.00, 0.73, 7.27, 'closed') returning id into s1;
  insert into _p values ('v4', s1);
  -- Un cierre por día con su asiento y su factura.
  foreach d in array array[date '2026-10-05', date '2026-10-06', date '2026-10-07'] loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
    values (a, e, fy, 1, d, 'Ventas PC01 ' || d, 'sales_day', 'borrador') returning id into ent;
    select coalesce(sum(p.total), 0) into tot from public.conta_pedidos_del_dia(e, l, d) p where p.canal_id = c;
    insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, entry_id, tickets_count, total, detail_hash, sale_ids, unit_key, channel_id)
    select a, e, l, d, ent, count(*), sum(p.total), 'pc01', array_agg(p.id), 'pc01:' || c::text, c from public.conta_pedidos_del_dia(e, l, d) p where p.canal_id = c;
    n := n + 1;
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date, customer, base, tax, total, entry_id)
    values (a, e, 'emitida', 'cierre_dia', 'PCT', 2026, n, 'PCT-' || n, d, d, '{"nombre": "Plataforma PC01", "consumidor_final": true}', tot, 0, tot, ent);
    insert into _p values ('f' || to_char(d, 'DD'), (select id from public.customer_invoice where company_id = e and series_code = 'PCT' and number = n));
  end loop;
  raise notice 'siembra: canal, dos marcas, 4 ventas y 3 cierres con su factura (5, 6 y 7/10)';
end $$;

-- ── 1 · Vencimientos ────────────────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); c uuid := (select v::uuid from _p where clave = 'canal');
begin
  -- Semanal, paga al día siguiente de cerrar (lunes), margen 5: la semana del 5 al 11/10 vence el 17/10.
  if public.conta_vence_por_plataforma(a, c, '2026-10-07') <> date '2026-10-17' then raise exception 'PRUEBA PC01 · 1: semanal dio %.', public.conta_vence_por_plataforma(a, c, '2026-10-07'); end if;
  if (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f05')) <> date '2026-10-17' then
    raise exception 'PRUEBA PC01 · 1: la factura del cierre del 5/10 nació con vencimiento %.', (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f05'));
  end if;
  update public.party_role set settlement_every = 'fortnightly', payout_days_after = 4, payout_margin_days = 2 where channel_id = c;
  if public.conta_vence_por_plataforma(a, c, '2026-10-10') <> date '2026-10-21' or public.conta_vence_por_plataforma(a, c, '2026-10-20') <> date '2026-11-06' then
    raise exception 'PRUEBA PC01 · 1: quincenal dio % y %.', public.conta_vence_por_plataforma(a, c, '2026-10-10'), public.conta_vence_por_plataforma(a, c, '2026-10-20');
  end if;
  update public.party_role set settlement_every = 'monthly', payout_days_after = 10, payout_margin_days = null where channel_id = c;
  if public.conta_vence_por_plataforma(a, c, '2026-02-03') <> date '2026-03-15' then raise exception 'PRUEBA PC01 · 1: mensual dio %.', public.conta_vence_por_plataforma(a, c, '2026-02-03'); end if;
  if public.conta_vence_de_factura((select v::uuid from _p where clave = 'f06')) <> date '2026-11-15' then raise exception 'PRUEBA PC01 · 1: conta_vence_de_factura dio %.', public.conta_vence_de_factura((select v::uuid from _p where clave = 'f06')); end if;
  update public.party_role set settlement_every = 'weekly', payout_days_after = 1, payout_margin_days = null where channel_id = c;
  if public.conta_vence_por_plataforma(a, (select id from public.sales_channel where account_id = a and id <> c limit 1), '2026-10-07') is not null then
    raise exception 'PRUEBA PC01 · 1: un canal sin plataforma con plazo tenía que dar vacío.';
  end if;
  raise notice '1 · vencimientos: semanal 17/10, quincenal 21/10 y 06/11, mensual 15/03; la factura del cierre nace con el suyo; sin plazo, vacío';
end $$;

-- ── 2 · Liquidación por periodo (sin pedidos) ───────────────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        l uuid := (select v::uuid from _p where clave = 'local'); c uuid := (select v::uuid from _p where clave = 'canal');
        st uuid; cs uuid; r public.channel_settlement; n int; t numeric;
begin
  insert into public.platform_store (account_id, company_id, provider, external_text, channel_id, location_id)
  values (a, e, 'uber', 'Marca PC01 Uno (Norte Centro) · prueba', c, l) returning id into st;
  insert into _p values ('tienda', st);
  insert into public.channel_settlement (account_id, channel_id, store_id, period_from, period_to, orders_count, gross_sales, net_payout, source, import_key)
  values (a, c, st, '2026-10-05', '2026-10-11', 3, 33.50, 20.00, 'manual', 'pc01-prueba-periodo') returning id into cs;
  insert into _p values ('liq', cs);
  update public.channel_settlement set collected_on = '2026-10-12', collected_amount = 20.00 where id = cs;
  select * into r from public.channel_settlement where id = cs;
  if r.invoice_match_status is distinct from 'a_revisar' or r.invoice_match_note not like '%no tiene marca%' or exists (select 1 from public.customer_invoice_payment where settlement_id = cs) then
    raise exception 'PRUEBA PC01 · 2: sin marca tenía que quedar a revisar sin cobros: % · %.', r.invoice_match_status, r.invoice_match_note;
  end if;
  -- Con marca (platform_store), se vuelve a mirar sola.
  update public.platform_store set brand_id = (select v::uuid from _p where clave = 'm1') where id = st;
  select * into r from public.channel_settlement where id = cs;
  select count(*), sum(amount) into n, t from public.customer_invoice_payment where settlement_id = cs;
  if r.invoice_match_status is distinct from 'cobradas' or n <> 3 or t <> 33.50 then
    raise exception 'PRUEBA PC01 · 2: con marca tenía que cobrar 3 facturas por 33,50 y quedó % (% cobros, %): %.', r.invoice_match_status, n, t, r.invoice_match_note;
  end if;
  if (select amount from public.customer_invoice_payment where settlement_id = cs and invoice_id = (select v::uuid from _p where clave = 'f05')) <> 10.00
     or (select method from public.customer_invoice_payment where settlement_id = cs limit 1) <> 'plataforma' then
    raise exception 'PRUEBA PC01 · 2: la factura del 5/10 tenía que cobrar solo su pedido de la marca 1 (10 €), «plataforma».';
  end if;
  if not exists (select 1 from public.customer_invoice_event where invoice_id = (select v::uuid from _p where clave = 'f05') and kind = 'cobro' and text like 'Cobrados 10,00 € de 1 pedido por la liquidación de Plataforma PC01%') then
    raise exception 'PRUEBA PC01 · 2: el historial de la factura no dice el cobro con su importe.';
  end if;
  -- Descobrarla quita los cobros.
  update public.channel_settlement set collected_on = null, collected_amount = null where id = cs;
  if exists (select 1 from public.customer_invoice_payment where settlement_id = cs) or (select invoice_match_status from public.channel_settlement where id = cs) is not null then
    raise exception 'PRUEBA PC01 · 2: descobrar la liquidación tenía que quitar sus cobros.';
  end if;
  -- Con otro número de pedidos: a revisar, nada cobrado.
  update public.channel_settlement set orders_count = 4 where id = cs;
  update public.channel_settlement set collected_on = '2026-10-12', collected_amount = 20.00 where id = cs;
  select * into r from public.channel_settlement where id = cs;
  if r.invoice_match_status is distinct from 'a_revisar' or r.invoice_match_note <> 'A revisar: trae 4 pedidos y en Folvy hay 3. No he cobrado ninguna factura.'
     or exists (select 1 from public.customer_invoice_payment where settlement_id = cs) then
    raise exception 'PRUEBA PC01 · 2: con 4 pedidos tenía que quedar a revisar sin cobros: % · %.', r.invoice_match_status, r.invoice_match_note;
  end if;
  update public.channel_settlement set orders_count = 3, collected_on = null, collected_amount = null where id = cs;
  update public.channel_settlement set collected_on = '2026-10-12', collected_amount = 20.00 where id = cs;
  if (select invoice_match_status from public.channel_settlement where id = cs) <> 'cobradas' then raise exception 'PRUEBA PC01 · 2: con 3 pedidos otra vez, tenía que cobrar.'; end if;
  raise notice '2 · por periodo: sin marca, a revisar; con marca, 3 facturas por 33,50 € (solo los pedidos de su marca); descobrar quita; con 4 pedidos, a revisar y nada';
end $$;

-- ── 3 · Liquidación por pedidos ────────────────────────────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); c uuid := (select v::uuid from _p where clave = 'canal'); cs uuid; r public.channel_settlement;
begin
  insert into public.channel_settlement (account_id, channel_id, period_from, period_to, net_payout, source, import_key)
  values (a, c, '2026-10-05', '2026-10-11', 12.00, 'manual', 'pc01-prueba-pedidos') returning id into cs;
  insert into public.channel_settlement_order (account_id, channel_id, settlement_id, platform_order_code, sale_id, import_key)
  values (a, c, cs, 'PC01-V2', (select v::uuid from _p where clave = 'v2'), 'pc01-prueba-pedido-1');
  update public.channel_settlement set collected_on = '2026-10-13', collected_amount = 12.00 where id = cs;
  select * into r from public.channel_settlement where id = cs;
  if r.invoice_match_status <> 'cobradas' or (select amount from public.customer_invoice_payment where settlement_id = cs and invoice_id = (select v::uuid from _p where clave = 'f05')) <> 20.00 then
    raise exception 'PRUEBA PC01 · 3: por pedidos tenía que cobrar 20 € a la factura del 5/10: % · %.', r.invoice_match_status, r.invoice_match_note;
  end if;
  -- Un pedido sin venta en Folvy: a revisar.
  update public.channel_settlement set collected_on = null, collected_amount = null where id = cs;
  insert into public.channel_settlement_order (account_id, channel_id, settlement_id, platform_order_code, import_key) values (a, c, cs, 'PC01-SIN', 'pc01-prueba-pedido-2');
  update public.channel_settlement set collected_on = '2026-10-13', collected_amount = 12.00 where id = cs;
  if (select invoice_match_status from public.channel_settlement where id = cs) <> 'a_revisar' then raise exception 'PRUEBA PC01 · 3: con un pedido sin venta tenía que quedar a revisar.'; end if;
  insert into _p values ('liq2', cs);
  raise notice '3 · por pedidos: 20 € a la factura del 5/10; con un pedido que no está en Folvy, a revisar';
end $$;

-- ── 4 · Los estados, como usuario de A ──────────────────────────────────────
-- Antes, como el dueño: una venta y su cierre del lunes 28/09 (semana del 28/09
-- al 4/10, vence el 10/10), que no cubre ninguna liquidación.
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa');
        l uuid := (select v::uuid from _p where clave = 'local'); c uuid := (select v::uuid from _p where clave = 'canal');
        fy uuid; ent uuid; d date := '2026-09-28';
begin
  insert into public.sale (account_id, location_id, brand_id, channel_id, source, sold_at, total, tax, taxable_base, status) values
    (a, l, (select v::uuid from _p where clave = 'm2'), c, 'manual', '2026-09-28 13:00+02', 5.00, 0.45, 4.55, 'closed');
  select id into fy from public.fiscal_year where company_id = e and d between starts_on and ends_on limit 1;
  if fy is null then raise exception 'PRUEBA PC01 · 4: la empresa A no tiene ejercicio para el 28/09/2026.'; end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status)
  values (a, e, fy, 1, d, 'Ventas PC01 ' || d, 'sales_day', 'borrador') returning id into ent;
  insert into public.sales_day_summary (account_id, company_id, location_id, sales_day, entry_id, tickets_count, total, detail_hash, sale_ids, unit_key, channel_id)
  select a, e, l, d, ent, count(*), sum(p.total), 'pc01', array_agg(p.id), 'pc01:' || c::text, c from public.conta_pedidos_del_dia(e, l, d) p where p.canal_id = c;
  insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date, customer, base, tax, total, entry_id)
  values (a, e, 'emitida', 'cierre_dia', 'PCT', 2026, 8999, 'PCT-8999', d, d, '{"nombre": "Plataforma PC01", "consumidor_final": true}', 5.00, 0, 5.00, ent);
  insert into _p values ('f28', (select id from public.customer_invoice where company_id = e and series_code = 'PCT' and number = 8999));
  if (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f28')) <> date '2026-10-10' then
    raise exception 'PRUEBA PC01 · 4: la factura del 28/09 nació con vencimiento %.', (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f28'));
  end if;
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare x record;
begin
  -- Hoy (Madrid) es después del 17/10: con algo pendiente, vencidas; la del 5/10 tiene 10 de 30 cobrados.
  select * into x from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f05');
  if x.cobrado <> 10.00 or x.pendiente <> 20.00 or not x.de_plataforma or x.estado <> (case when public.conta_hoy() > date '2026-10-17' then 'vencida' else 'cobrada_parte' end) then
    raise exception 'PRUEBA PC01 · 4: la factura del 5/10 salió % (cobrado %, pendiente %).', x.estado, x.cobrado, x.pendiente;
  end if;
  select * into x from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f06');
  if x.estado <> 'cobrada' or x.pendiente <> 0 then raise exception 'PRUEBA PC01 · 4: la del 6/10 tenía que salir cobrada y salió %.', x.estado; end if;
  -- Pasado su plazo y sin ninguna liquidación: «Falta su liquidación», no vencida (Julio, 25/10).
  select * into x from public.conta_factura_cobro where invoice_id = (select v::uuid from _p where clave = 'f28');
  if x.estado <> (case when public.conta_hoy() > date '2026-10-10' then 'falta_liquidacion' else 'esperando_liquidacion' end) or x.pendiente <> 5.00 then
    raise exception 'PRUEBA PC01 · 4: la del 28/09, sin liquidación, salió %.', x.estado;
  end if;
  raise notice '4 · estados como usuario: la del 5/10 vencida o en parte (10 de 30, su liquidación no la cubre), la del 6/10 cobrada, la del 28/09 %', x.estado;
end $$;
-- 4b · Guardar el plazo desde la ficha: las por cobrar lo siguen (la del 5/10 y la del 28/09: las otras dos están cobradas).
do $$
declare r jsonb; pa uuid := (select v::uuid from _p where clave = 'parte');
begin
  r := public.conta_plataforma_plazo_guardar(pa, 'weekly', 2, 0);
  if (r->>'facturas')::int <> 2 or (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f05')) <> date '2026-10-13'
     or (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f28')) <> date '2026-10-06'
     or (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f06')) <> date '2026-10-17' then
    raise exception 'PRUEBA PC01 · 4b: guardar el plazo tenía que mover la del 5/10 al 13/10 y la del 28/09 al 6/10, no las cobradas: %.', r;
  end if;
  r := public.conta_plataforma_plazo_guardar(pa, 'weekly', 1, null);
  if (select due_date from public.customer_invoice where id = (select v::uuid from _p where clave = 'f05')) <> date '2026-10-17' then raise exception 'PRUEBA PC01 · 4b: no volvió al 17/10.'; end if;
  raise notice '4b · guardar el plazo en la ficha mueve el vencimiento de sus facturas por cobrar (2) y no el de las cobradas';
end $$;
reset role;

-- ── 5 · Recibida: el plazo del proveedor al validarla ───────────────────────
do $$
declare a uuid := (select v::uuid from _p where clave = 'cuenta'); e uuid := (select v::uuid from _p where clave = 'empresa'); s1 uuid; s2 uuid; f uuid;
begin
  insert into public.supplier (account_id, name, payment_terms_days) values (a, 'Proveedor PC01 con plazo', 30) returning id into s1;
  insert into public.supplier (account_id, name) values (a, 'Proveedor PC01 sin plazo') returning id into s2;
  insert into _p values ('prov', s1);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status)
  values (a, e, s1, 'PC01-R1', '2026-10-01', 100.00, 'en_revision') returning id into f; insert into _p values ('r1', f);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status)
  values (a, e, s2, 'PC01-R2', '2026-10-01', 50.00, 'en_revision') returning id into f; insert into _p values ('r2', f);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status)
  values (a, e, s1, 'PC01-R3', '2026-10-02', 77.00, 'en_revision') returning id into f; insert into _p values ('r3', f);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
update public.supplier_invoice set status = 'aprobada' where id in (select v::uuid from _p where clave in ('r1', 'r2', 'r3'));
reset role;
do $$
declare f public.supplier_invoice;
begin
  select * into f from public.supplier_invoice where id = (select v::uuid from _p where clave = 'r1');
  if f.due_date is distinct from date '2026-10-31' or f.due_date_set_name is distinct from 'Sumied · plazo del proveedor (30 días)' then
    raise exception 'PRUEBA PC01 · 5: con plazo de 30 días quedó % («%»).', f.due_date, f.due_date_set_name;
  end if;
  if (select due_date from public.supplier_invoice where id = (select v::uuid from _p where clave = 'r2')) is not null then raise exception 'PRUEBA PC01 · 5: sin plazo tenía que quedar sin vencimiento.'; end if;
  if (select estado from public.conta_recibida_pago where invoice_id = (select v::uuid from _p where clave = 'r2')) <> 'sin_vencimiento' then raise exception 'PRUEBA PC01 · 5: el estado sin vencimiento no sale.'; end if;
  -- Para el 7: la liquidación del 2 se descobra, y la factura del 7/10 queda sin cobrar.
  update public.channel_settlement set collected_on = null, collected_amount = null where id = (select v::uuid from _p where clave = 'liq');
  raise notice '5 · recibida validada: con plazo, vence el 31/10 y dice de dónde; sin plazo, «sin vencimiento»';
end $$;

-- ── 6 · Bancos, el pago de una recibida ──────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; mv jsonb := '[]'::jsonb; i int; m record; f public.supplier_invoice; v_err text; c400 text; c430 text; x jsonb;
begin
  select code into c400 from public.company_account where company_id = (select v::uuid from _p where clave = 'empresa') and code like '400%' order by code limit 1;
  select code into c430 from public.company_account where company_id = (select v::uuid from _p where clave = 'empresa') and code like '430%' order by code limit 1;
  if c400 is null or c430 is null then raise exception 'PRUEBA PC01 · 6: staging no tiene 400 o 430 en la empresa A.'; end if;
  insert into _p values ('c400', c400), ('c430', c430);
  for i in 1..3 loop
    mv := mv || jsonb_build_array(jsonb_build_object('fecha', '2026-10-22', 'importe', (array[-100.00, 30.00, 18.00])[i],
      'concepto_banco', 'TRANSFERENCIA PC01 ' || i, 'concepto_limpio', 'Transferencia pc01 ' || i, 'contraparte', 'PROVEEDOR PC01', 'tipo', 'TRANSFERENCIAS',
      'huella', 'pc01-motor-' || i, 'huella_suave', 'pc01-motor-s' || i));
  end loop;
  r := public.bank_importar((select v::uuid from _p where clave = 'banco'), 'fichero', 'csv:bbva', 'prueba-pc01.xlsx', repeat('c', 64),
    date '2026-10-22', date '2026-10-22', null, null, 'prueba', null, mv);
  -- Cada movimiento, por su concepto (el importador guarda su propia huella, y el
  -- extracto puede traer otros de staging del mismo día).
  for m in select * from public.bank_movement where statement_id = (r->>'extracto')::uuid and bank_concept like 'TRANSFERENCIA PC01 _' loop
    insert into _p values ('m' || right(m.bank_concept, 1), m.id);
  end loop;
  if (select count(*) from _p where clave in ('m1', 'm2', 'm3')) <> 3 then raise exception 'PRUEBA PC01 · 6: el extracto no trae los 3 movimientos.'; end if;
  -- A mano no se marca pagada.
  begin
    perform public.mark_supplier_invoice_paid((select v::uuid from _p where clave = 'r1'), '2026-10-22', 'transfer');
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'La factura PC01-R1 no se marca pagada a mano%' then raise exception 'PRUEBA PC01 · 6: marcarla a mano dijo «%».', v_err; end if;
  -- Casarla: su pago, con el asiento del banco, y pagada.
  x := public.bank_casar((select v::uuid from _p where clave = 'm1'), jsonb_build_object('tipo', 'factura_recibida',
    'facturas', jsonb_build_array(jsonb_build_object('id', (select v from _p where clave = 'r1'), 'importe', 100.00)),
    'cuenta_tercero', c400, 'tercero_id', null, 'concepto', 'Pago a Proveedor PC01'), 'probable', 'prueba', '[]'::jsonb, 'persona', null);
  insert into _p values ('casado1', x->>'match');
  select * into f from public.supplier_invoice where id = (select v::uuid from _p where clave = 'r1');
  if f.status <> 'pagada' then raise exception 'PRUEBA PC01 · 6: casada entera quedó %.', f.status; end if;
  if not exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = f.id and p.amount = 100.00 and p.entry_id = (x->>'asiento')::uuid and p.bank_match_id = (x->>'match')::uuid) then
    raise exception 'PRUEBA PC01 · 6: el pago no quedó con el asiento del banco.';
  end if;
  if (select estado from public.conta_recibida_pago where invoice_id = f.id) <> 'pagada' then raise exception 'PRUEBA PC01 · 6: el estado no sale pagada.'; end if;
  v_err := null;
  begin
    perform public.unmark_supplier_invoice_paid(f.id);
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'La factura PC01-R1 tiene su pago con asiento%' then raise exception 'PRUEBA PC01 · 6: deshacer a mano con el pago ahí dijo «%».', v_err; end if;
  -- Deshacer el casado: el pago se va y vuelve a por pagar.
  perform public.bank_deshacer((x->>'match')::uuid, 'Prueba PC01');
  if exists (select 1 from public.supplier_invoice_payment where invoice_id = f.id) or (select status from public.supplier_invoice where id = f.id) <> 'aprobada' then
    raise exception 'PRUEBA PC01 · 6: deshacer el casado tenía que quitar el pago y dejarla aprobada.';
  end if;
  raise notice '6 · pago: a mano no; casarla, pagada con el asiento del banco; deshacer a mano no; deshacer el casado, por pagar';
end $$;

-- ── 7 · Bancos, el cobro de una emitida ──────────────────────────────────────
do $$
declare x jsonb; v_err text; f uuid := (select v::uuid from _p where clave = 'f07'); p public.customer_invoice_payment; ent uuid;
begin
  -- La del 7/10 (8 €) está sin cobrar. Un cobro de 30 € no cabe.
  begin
    perform public.bank_casar((select v::uuid from _p where clave = 'm2'), jsonb_build_object('tipo', 'factura_emitida', 'concepto', 'Cobro PC01',
      'lineas', jsonb_build_array(jsonb_build_object('cuenta', (select v from _p where clave = 'c430'), 'importe', 30.00)),
      'facturas', jsonb_build_array(jsonb_build_object('id', f, 'importe', 30.00))), 'probable', 'prueba', '[]'::jsonb, 'persona', null);
  exception when others then v_err := sqlerrm; end;
  if v_err not like 'La factura PCT-% ya tiene cobrados 0,00 € de 8,00 €: este cobro la pasaría.' then raise exception 'PRUEBA PC01 · 7: cobrar de más dijo «%».', v_err; end if;
  -- 18 €: 8 a la factura y 10 a cuenta (las líneas, a la 430). Primero se casa y se deshace
  -- (su asiento propuesto se borra, y el cobro con él); después, otra vez, para validar y anular.
  x := public.bank_casar((select v::uuid from _p where clave = 'm3'), jsonb_build_object('tipo', 'factura_emitida', 'concepto', 'Cobro PC01',
      'lineas', jsonb_build_array(jsonb_build_object('cuenta', (select v from _p where clave = 'c430'), 'importe', 18.00)),
      'facturas', jsonb_build_array(jsonb_build_object('id', f, 'importe', 8.00))), 'probable', 'prueba', '[]'::jsonb, 'persona', null);
  if not exists (select 1 from public.customer_invoice_payment where invoice_id = f and bank_match_id = (x->>'match')::uuid) then raise exception 'PRUEBA PC01 · 7: casar no escribió el cobro.'; end if;
  perform public.bank_deshacer((x->>'match')::uuid, 'Prueba PC01: no era este cobro');
  if exists (select 1 from public.customer_invoice_payment where invoice_id = f) then raise exception 'PRUEBA PC01 · 7: deshacer el casado no quitó el cobro.'; end if;
  if not exists (select 1 from public.customer_invoice_event where invoice_id = f and kind = 'cobro_deshecho') then raise exception 'PRUEBA PC01 · 7: el historial no dice el cobro deshecho.'; end if;
  x := public.bank_casar((select v::uuid from _p where clave = 'm3'), jsonb_build_object('tipo', 'factura_emitida', 'concepto', 'Cobro PC01',
      'lineas', jsonb_build_array(jsonb_build_object('cuenta', (select v from _p where clave = 'c430'), 'importe', 18.00)),
      'facturas', jsonb_build_array(jsonb_build_object('id', f, 'importe', 8.00))), 'probable', 'prueba', '[]'::jsonb, 'persona', null);
  select * into p from public.customer_invoice_payment where invoice_id = f;
  if p.amount <> 8.00 or p.entry_id <> (x->>'asiento')::uuid or p.bank_match_id <> (x->>'match')::uuid then raise exception 'PRUEBA PC01 · 7: el cobro no quedó con el asiento y el casado.'; end if;
  if (select estado from public.conta_factura_cobro where invoice_id = f) <> 'cobrada' then raise exception 'PRUEBA PC01 · 7: la del 7/10 no sale cobrada.'; end if;
  -- Validar y anular su asiento deshace el cobro.
  ent := (x->>'asiento')::uuid;
  perform public.journal_entry_validar(ent, 'Prueba PC01');
  perform public.journal_entry_anular(ent, 'Prueba PC01', null, 'Prueba PC01');
  if exists (select 1 from public.customer_invoice_payment where invoice_id = f) then raise exception 'PRUEBA PC01 · 7: anular el asiento del banco no quitó el cobro.'; end if;
  if not exists (select 1 from public.customer_invoice_event where invoice_id = f and kind = 'cobro_anulado' and text like 'Cobro de 8_00 € anulado desde Contabilidad%') then
    raise exception 'PRUEBA PC01 · 7: el historial no dice el cobro anulado.';
  end if;
  raise notice '7 · cobro: de más, no; 8 € a la factura con el asiento del banco; deshacer el casado lo quita; otra vez, cobrada; anular su asiento lo quita';
end $$;
reset role;

-- ── 8 · El lote de prepago ──────────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); ent uuid; f public.supplier_invoice;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  select (select v::uuid from _p where clave = 'cuenta'), e, fy.id, 3, '2026-10-15', 'Pago desde el saldo prepago · PC01', 'supplier_payment', 'borrador', 'Prueba PC01'
    from public.fiscal_year fy where fy.company_id = e and date '2026-10-15' between fy.starts_on and fy.ends_on limit 1
  returning id into ent;
  update public.supplier_invoice set payment_entry_id = ent where id = (select v::uuid from _p where clave = 'r3');
  select * into f from public.supplier_invoice where id = (select v::uuid from _p where clave = 'r3');
  if f.status <> 'pagada' or f.paid_method <> 'prepaid'
     or not exists (select 1 from public.supplier_invoice_payment where invoice_id = f.id and entry_id = ent and amount = 77.00 and method = 'prepaid') then
    raise exception 'PRUEBA PC01 · 8: con el asiento del lote, tenía que quedar pagada con su pago prepago (quedó %).', f.status;
  end if;
  raise notice '8 · el lote de prepago: su asiento es su pago, y la factura queda pagada';
end $$;

-- ── 9 · Un cobro negativo cabe ──────────────────────────────────────────────
do $$
begin
  insert into public.customer_invoice_payment (account_id, company_id, invoice_id, paid_on, amount, method)
  values ((select v::uuid from _p where clave = 'cuenta'), (select v::uuid from _p where clave = 'empresa'), (select v::uuid from _p where clave = 'f07'), '2026-10-20', -1.00, 'prueba');
  delete from public.customer_invoice_payment where invoice_id = (select v::uuid from _p where clave = 'f07') and amount = -1.00;
  raise notice '9 · un cobro negativo cabe';
end $$;

-- ── 10 · Las vueltas atrás ──────────────────────────────────────────────────
-- Antes, lo que el motor escribió en esta prueba (en producción lo quita la vuelta atrás de la 0918).
delete from public.customer_invoice_payment where settlement_id is not null or bank_match_id is not null;
delete from public.supplier_invoice_payment;
\i supabase/vuelta-atras/20261025T0917_pc01_motor_cambia.down.sql
\i supabase/vuelta-atras/20261025T0916_pc01_motor_cobros_pagos.down.sql
do $$
declare k text;
begin
  for k in select clave from _p where clave like 'md5_%' loop
    if (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = substr(k, 5)) is distinct from (select v from _p where clave = k) then
      raise exception 'PRUEBA PC01 · 10: % no vuelve a como estaba.', substr(k, 5);
    end if;
  end loop;
  if exists (select 1 from pg_trigger where tgname like 'pc01\_%' and not tgisinternal) or to_regclass('public.supplier_invoice_payment') is not null
     or to_regclass('public.conta_factura_cobro') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'party_role' and column_name = 'payout_days_after') then
    raise exception 'PRUEBA PC01 · 10: las vueltas atrás dejan algo del PC01.';
  end if;
  raise notice '10 · vueltas atrás: las 4 funciones como estaban (md5) y nada del PC01';
end $$;

rollback;
