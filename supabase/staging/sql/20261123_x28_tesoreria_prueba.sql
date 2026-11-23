-- supabase/staging/sql/20261123_x28_tesoreria_prueba.sql
--
-- SOLO STAGING. Prueba del X28 (20261123T0800_x28_tesoreria_modificar y 20261123T0801_x28_banco_con_marca), que el
-- ensayo de staging pone delante en la misma sesión. Todo en una transacción con ROLLBACK: staging no cambia.
-- Lo que cambia: public._bank_casar_nucleo (un trozo: marca y plataforma en las líneas). Lo que añade:
-- conta_tesoreria_a_mano (el «a mano» con local, marca y plataforma), conta_tesoreria_se_puede_modificar,
-- conta_tesoreria_modificar y conta_tesoreria_modificada. conta_banco_a_mano no cambia.
--
-- En la gestoría de ejemplo del núcleo (semillas K02, K04 y K05), con su «Banco principal» (57200001), como el usuario
-- del núcleo (rol authenticated). La empresa se pone de hostelería solo dentro de esta transacción. Datos inventados.
-- Los caminos (regla 10), cada uno por la función que usa la pantalla:
--   1. Pago de una factura recibida: bank_casar con la factura → la factura queda PAGADA y su asiento validado, serie 3.
--   2. Cobro de una plataforma contra su 430: bank_casar con la liquidación → la liquidación cobrada; la 43000081 al haber.
--   3. Un movimiento sin factura a una cuenta de gasto, con local común, marca y plataforma: las dos líneas las llevan.
--      Y uno escrito a mano (⊕ otro movimiento) con marca: igual. Sin marca ni plataforma, como hoy.
--   4. Modificar el del punto 3: otra subcuenta, otro concepto y otra marca → EL MISMO NÚMERO, los mismos importes, la
--      cadena íntegra y su registro. El del punto 1 (paga una factura): la subcuenta no, el concepto sí.
--   5. Lo que no deja: marca en una empresa que no es de hostelería; con el 4T presentado, modificar (con su frase).
--   6. Deshacer el del punto 3: el movimiento vuelve a estar sin contabilizar.
--   7. Regla 31: los movimientos que ya estaban conciliados en toda la base, iguales antes y después (la misma vara).
--   8. La vuelta atrás: el casado como antes, conta_banco_a_mano intacta y lo nuevo, quitado.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X28: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.conta_tesoreria_modificar(uuid,jsonb,text)') is null
     or to_regprocedure('public.conta_tesoreria_a_mano(uuid,date,text,text,numeric,text,uuid,uuid,uuid)') is null then
    raise exception 'PRUEBA X28 · 0: faltan la 0800 y la 0801 delante.';
  end if;
  if not exists (select 1 from public.treasury_account where id = 'c0e20000-0000-4000-8000-0000000000b0') then
    raise exception 'PRUEBA X28 · 0: falta el banco de la gestoría del núcleo (seed_k02_nucleo_staging.sql).';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _x28 (k text primary key, v text) on commit drop;
grant all on _x28 to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x28 where _x28.k = $1 $$;

-- La vara de la regla 31: los movimientos ya conciliados de TODA la base (huella de tabla entera, regla 9: es más fuerte así),
-- cuántos y la huella de sus asientos y líneas. En producción la mide la cuenta de la tanda, por cuenta (Foodint, la primera).
create function pg_temp.vara() returns text language sql stable as $f$
  select count(distinct m.id) || ' · ' || coalesce(md5(string_agg(concat_ws('|', m.id, m.status, b.journal_entry_id, e.number, e.status, e.concept,
                                                                    l.position, l.company_account_id, l.debit, l.credit, l.location_id, l.brand_id, l.channel_id),
                                                          ',' order by m.id, l.position)), '-')
    from public.bank_movement m
    join public.bank_match b on b.movement_id = m.id and b.status = 'vivo'
    join public.journal_entry e on e.id = b.journal_entry_id
    join public.journal_line l on l.entry_id = e.id
   where m.fingerprint not like 'x28-%'
$f$;
insert into _x28 values ('vara', pg_temp.vara());

-- 0 · Preparar (inventado): hostelería en esta transacción, una 62600000, tres movimientos, una factura y una liquidación.
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  banco constant uuid := 'c0e20000-0000-4000-8000-0000000000b0'; st uuid; v_m uuid; v_cs uuid;
begin
  update public.company set sector = 'hosteleria' where id = emp;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select a, emp, 'pymes', x.code, left(x.code, 3), x.name, 'own', 'manual'
    from (values ('62600000', 'Servicios bancarios (prueba X28)'), ('62900000', 'Otros servicios (prueba X28)')) x(code, name)
   where not exists (select 1 from public.company_account o where o.company_id = emp and o.code = x.code);
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, period_from, period_to,
                                     movements_count, new_count, repeated_count, continuity, unchecked_reason)
  values (a, emp, banco, 'fichero', 'n43', date '2026-11-02', date '2026-11-04', 3, 3, 0, 'sin_saldo', 'Prueba X28') returning id into st;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept,
                                    fingerprint, soft_fingerprint, status, reason)
  select a, emp, banco, st, x.f, x.f, x.i, x.c, x.c, 'x28-' || x.k, 'x28-' || x.k, 'propuesto', 'Prueba X28'
    from (values ('pago', date '2026-11-02', -121.00, 'RECIBO PROVEEDOR FICHA UNO'), ('cobro', date '2026-11-03', 500.00, 'TRANSFERENCIA PLATAFORMA'),
                 ('gasto', date '2026-11-04', -30.25, 'COMISION MANTENIMIENTO')) x(k, f, i, c);
  insert into _x28 select 'm_' || replace(fingerprint, 'x28-', ''), id from public.bank_movement where statement_id = st;
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, needs_review, created_by_name)
  values ('c0e70000-0000-4000-8000-0000000002b8', a, emp, 'c0e40000-0000-4000-8000-0000000000a1', 'invoice', 'X28-PRUEBA-1', date '2026-10-20',
          'aprobada', 'manual', 100, 21, 121, false, 'prueba X28');
  insert into public.channel_settlement (account_id, channel_id, settlement_ref, period_from, period_to, settlement_date, net_payout, source, import_key, created_by_name)
  values (a, 'c0e60000-0000-4000-8000-0000000000c0', 'X28-LIQ-1', date '2026-10-26', date '2026-11-01', date '2026-11-02', 500, 'manual', 'x28-prueba-liq', 'prueba X28')
  returning id into v_cs;
  insert into _x28 values ('liq', v_cs);
end $$;

-- 1, 2 y 3 · Los tres caminos de la pantalla, como el usuario del núcleo ----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.bank_casar(pg_temp.p('m_pago')::uuid, jsonb_build_object('tipo', 'factura_recibida',
         'facturas', jsonb_build_array(jsonb_build_object('id', 'c0e70000-0000-4000-8000-0000000002b8', 'importe', 121.00)), 'cuenta_tercero', '40000071'), 'seguro', 'Mismo importe que X28-PRUEBA-1', '[]', 'persona', null);
  insert into _x28 values ('e_pago', r->>'asiento'), ('b_pago', r->>'match');
  r := public.bank_casar(pg_temp.p('m_cobro')::uuid, jsonb_build_object('tipo', 'liquidacion', 'liquidacion_id', pg_temp.p('liq'), 'cuenta_cliente', '43000081'),
         'seguro', 'Cuadra con su liquidación', '[]', 'persona', null);
  insert into _x28 values ('e_cobro', r->>'asiento');
  r := public.bank_casar(pg_temp.p('m_gasto')::uuid, jsonb_build_object('tipo', 'cuenta', 'concepto', 'Comisión de mantenimiento',
         'lineas', jsonb_build_array(jsonb_build_object('cuenta', '62600000', 'importe', 30.25)),
         'marca_id', 'c0eb0000-0000-4000-8000-0000000000c1', 'canal_id', 'c0e60000-0000-4000-8000-0000000000c0'), 'seguro', 'Comisión del banco', '[]', 'persona', null);
  insert into _x28 values ('e_gasto', r->>'asiento'), ('b_gasto', r->>'match');
  r := public.conta_tesoreria_a_mano('c0e20000-0000-4000-8000-0000000000b0', date '2026-11-05', '62900000', 'Pago a mano X28', -10, 'Prueba X28',
                                 null, 'c0eb0000-0000-4000-8000-0000000000c2', null);
  insert into _x28 values ('e_mano', r->>'asiento_id');
  r := public.conta_tesoreria_a_mano('c0e20000-0000-4000-8000-0000000000b0', date '2026-11-05', '62900000', 'Pago a mano X28 sin marca', -11, 'Prueba X28');
  insert into _x28 values ('e_mano2', r->>'asiento_id');
end $$;
reset role;
do $$
declare v_inv public.supplier_invoice; l text; e public.journal_entry;
begin
  select * into v_inv from public.supplier_invoice where id = 'c0e70000-0000-4000-8000-0000000002b8';
  select * into e from public.journal_entry where id = pg_temp.p('e_pago')::uuid;
  if v_inv.status <> 'pagada' or v_inv.paid_at <> date '2026-11-02' or v_inv.payment_entry_id <> e.id or e.status <> 'validado' or e.series <> 3 or e.number is null then
    raise exception 'PRUEBA X28 · 1: la factura no ha quedado pagada con su asiento validado de la serie 3 (% · % · % · %).', v_inv.status, e.status, e.series, e.number;
  end if;
  raise notice 'PRUEBA X28 · 1: la factura X28-PRUEBA-1, pagada el 02/11 con el asiento %/% validado.', e.series, e.number;
  select string_agg(c.code || ' ' || jl.debit || '/' || jl.credit, ', ' order by jl.position) into l
    from public.journal_line jl join public.company_account c on c.id = jl.company_account_id where jl.entry_id = pg_temp.p('e_cobro')::uuid;
  if l <> '57200001 500.00/0.00, 43000081 0.00/500.00' or (select collected_on from public.channel_settlement where id = pg_temp.p('liq')::uuid) <> date '2026-11-03'
     or (select status from public.journal_entry where id = pg_temp.p('e_cobro')::uuid) <> 'validado' then
    raise exception 'PRUEBA X28 · 2: el cobro de la plataforma no es 572 al debe y su 430 al haber, con la liquidación cobrada (%).', l;
  end if;
  raise notice 'PRUEBA X28 · 2: el cobro de la plataforma, %; la liquidación, cobrada el 03/11.', l;
  select string_agg(c.code || ' ' || jl.debit || '/' || jl.credit || ' ' || coalesce(left(jl.brand_id::text, 8) || '…' || right(jl.brand_id::text, 2), '-')
                    || ' ' || coalesce(right(jl.channel_id::text, 2), '-') || ' ' || jl.is_common, ', ' order by jl.position) into l
    from public.journal_line jl join public.company_account c on c.id = jl.company_account_id where jl.entry_id = pg_temp.p('e_gasto')::uuid;
  if l <> '57200001 0.00/30.25 c0eb0000…c1 c0 true, 62600000 30.25/0.00 c0eb0000…c1 c0 true' then
    raise exception 'PRUEBA X28 · 3: el gasto no lleva la marca y la plataforma en sus líneas: %.', l;
  end if;
  if (select count(*) from public.journal_line where entry_id = pg_temp.p('e_mano')::uuid and brand_id = 'c0eb0000-0000-4000-8000-0000000000c2' and channel_id is null and is_common) <> 2
     or (select count(*) from public.journal_line where entry_id = pg_temp.p('e_mano2')::uuid and brand_id is null and channel_id is null and is_common) <> 2 then
    raise exception 'PRUEBA X28 · 3: el escrito a mano no lleva su marca (o el de sin marca, sí).';
  end if;
  raise notice 'PRUEBA X28 · 3: el gasto, %; el escrito a mano con la marca Dos en sus dos líneas, y el de sin marca, como hoy.', l;
end $$;

-- 4 · Modificar: el mismo número --------------------------------------------------------------------------------------
insert into _x28 select 'num_gasto', number::text from public.journal_entry where id = pg_temp.p('e_gasto')::uuid;
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_se jsonb; v_msg text;
begin
  v_se := public.conta_tesoreria_se_puede_modificar(pg_temp.p('e_gasto')::uuid);
  if not (v_se->>'puede')::boolean or not (v_se->>'subcuenta')::boolean then raise exception 'PRUEBA X28 · 4: el gasto se debería poder modificar entero (%).', v_se; end if;
  r := public.conta_tesoreria_modificar(pg_temp.p('e_gasto')::uuid,
         jsonb_build_object('cuenta', '62900000', 'concepto', 'Comisión de mantenimiento noviembre', 'marca', 'c0eb0000-0000-4000-8000-0000000000c2'), 'Prueba X28');
  insert into _x28 values ('mod', r::text);
  v_se := public.conta_tesoreria_se_puede_modificar(pg_temp.p('e_pago')::uuid);
  if not (v_se->>'puede')::boolean or (v_se->>'subcuenta')::boolean or v_se->>'subcuenta_porque' <> 'Paga o cobra una factura recibida: su subcuenta es la de ese documento.' then
    raise exception 'PRUEBA X28 · 4: el pago de la factura, la subcuenta no (%).', v_se;
  end if;
  begin perform public.conta_tesoreria_modificar(pg_temp.p('e_pago')::uuid, '{"cuenta": "62900000"}', 'Prueba X28');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from v_se->>'subcuenta_porque' then raise exception 'PRUEBA X28 · 4: el pago de la factura cambió de subcuenta (%).', v_msg; end if;
  r := public.conta_tesoreria_modificar(pg_temp.p('e_pago')::uuid, '{"cuenta": "40000071", "concepto": "Pago X28-PRUEBA-1"}', 'Prueba X28');
  if (r->>'cambiadas')::int <> 1 then raise exception 'PRUEBA X28 · 4: el concepto del pago (%).', r; end if;
end $$;
reset role;
do $$
declare l text; e public.journal_entry; r jsonb := pg_temp.p('mod')::jsonb;
begin
  select * into e from public.journal_entry where id = pg_temp.p('e_gasto')::uuid;
  select string_agg(c.code || ' ' || jl.debit || '/' || jl.credit || ' ' || right(jl.brand_id::text, 2) || ' ' || right(jl.channel_id::text, 2) || ' ' || jl.concept, ', ' order by jl.position) into l
    from public.journal_line jl join public.company_account c on c.id = jl.company_account_id where jl.entry_id = e.id;
  if e.number::text <> pg_temp.p('num_gasto') or e.status <> 'validado' or e.concept <> 'Comisión de mantenimiento noviembre'
     or l <> '57200001 0.00/30.25 c2 c0 Comisión de mantenimiento noviembre, 62900000 30.25/0.00 c2 c0 Comisión de mantenimiento noviembre' then
    raise exception 'PRUEBA X28 · 4: modificado no es el mismo asiento con lo nuevo (% · %).', e.number, l;
  end if;
  if public._conta_cadena_rota('c0e20000-0000-4000-8000-0000000000e3') <> 0 then raise exception 'PRUEBA X28 · 4: la cadena no cuadra después de modificar.'; end if;
  if (select count(*) from public.conta_tesoreria_modificada where entry_id = e.id and numero = e.number and quien = 'Prueba X28') <> 1 then
    raise exception 'PRUEBA X28 · 4: el cambio no queda en su registro.';
  end if;
  raise notice 'PRUEBA X28 · 4: «%»; %; la cadena íntegra y su registro. El pago de la factura: la subcuenta no, el concepto sí.', r->>'texto', l;
end $$;

-- 5 · Lo que no deja --------------------------------------------------------------------------------------------------
update public.company set sector = 'general' where id = 'c0e20000-0000-4000-8000-0000000000e3';
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_msg text; n int := 0;
begin
  begin perform public.conta_tesoreria_a_mano('c0e20000-0000-4000-8000-0000000000b0', date '2026-11-05', '62900000', 'No debe quedar', -5, null, null,
                                          'c0eb0000-0000-4000-8000-0000000000c2', null);
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from 'La marca y la plataforma son de una empresa de hostelería: esta no lo es.' then raise exception 'PRUEBA X28 · 5: a mano con marca fuera de hostelería (%).', v_msg; end if;
  n := n + 1; v_msg := null;
  begin perform public.conta_tesoreria_modificar(pg_temp.p('e_gasto')::uuid, '{"plataforma": "c0e60000-0000-4000-8000-0000000000c0", "marca": "c0eb0000-0000-4000-8000-0000000000c1"}', 'Prueba X28');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from 'La marca y la plataforma son de una empresa de hostelería: esta no lo es.' then raise exception 'PRUEBA X28 · 5: modificar con marca fuera de hostelería (%).', v_msg; end if;
  n := n + 1;
  raise notice 'PRUEBA X28 · 5: % de 2 con marca fuera de hostelería, con su frase.', n;
end $$;
reset role;
update public.company set sector = 'hosteleria' where id = 'c0e20000-0000-4000-8000-0000000000e3';

-- 6 · Deshacer (para quitar, no para cambiar): el gasto vuelve a estar sin contabilizar ---------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.bank_deshacer(pg_temp.p('b_gasto')::uuid, 'Prueba X28: deshacer desde Tesorería');
  insert into _x28 values ('deshacer', r::text);
end $$;
reset role;
do $$ begin
  if (select status from public.bank_movement where id = pg_temp.p('m_gasto')::uuid) in ('casado')
     or exists (select 1 from public.bank_match where movement_id = pg_temp.p('m_gasto')::uuid and status = 'vivo') then
    raise exception 'PRUEBA X28 · 6: deshecho, el movimiento sigue contabilizado.';
  end if;
  raise notice 'PRUEBA X28 · 6: deshecho («%»); el movimiento queda %.', pg_temp.p('deshacer'),
    (select status from public.bank_movement where id = pg_temp.p('m_gasto')::uuid);
end $$;

-- 5 bis · Con el 4T presentado, modificar no ------------------------------------------------------------------------
insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
values ('c0e20000-0000-4000-8000-0000000000e0', 'c0e20000-0000-4000-8000-0000000000e3', '303', 2026, 'quarterly', '4T', date '2027-01-30', 'filed', 'zero', 0, now(), 'outside', 'PRUEBAX28CSV0000');
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_se jsonb; v_msg text;
begin
  v_se := public.conta_tesoreria_se_puede_modificar(pg_temp.p('e_pago')::uuid);
  if (v_se->>'puede')::boolean or v_se->>'porque' <> 'El IVA del 4T ya está presentado: este movimiento no se puede modificar.' then
    raise exception 'PRUEBA X28 · 5: con el 4T presentado (%).', v_se;
  end if;
  begin perform public.conta_tesoreria_modificar(pg_temp.p('e_pago')::uuid, '{"concepto": "No debe cambiar"}', 'Prueba X28');
  exception when others then v_msg := sqlerrm; end;
  if v_msg is distinct from v_se->>'porque' then raise exception 'PRUEBA X28 · 5: con el 4T presentado, modificar (%).', v_msg; end if;
  raise notice 'PRUEBA X28 · 5: con el 4T presentado, «%».', v_msg;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 7 · Regla 31: lo ya conciliado, igual -------------------------------------------------------------------------------
do $$ begin
  if pg_temp.vara() <> pg_temp.p('vara') then
    raise exception 'PRUEBA X28 · 7: lo ya conciliado ha cambiado: antes %, después %.', pg_temp.p('vara'), pg_temp.vara();
  end if;
  raise notice 'PRUEBA X28 · 7: los movimientos ya conciliados de toda la base, antes % y después %.', pg_temp.p('vara'), pg_temp.vara();
end $$;

-- 8 · La vuelta atrás ---------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261123T0801_x28_banco_con_marca.down.sql
\i supabase/vuelta-atras/20261123T0800_x28_tesoreria_modificar.down.sql
do $$ begin
  if to_regprocedure('public.conta_tesoreria_modificar(uuid,jsonb,text)') is not null or to_regclass('public.conta_tesoreria_modificada') is not null
     or to_regprocedure('public.conta_tesoreria_a_mano(uuid,date,text,text,numeric,text,uuid,uuid,uuid)') is not null
     or to_regprocedure('public.conta_banco_a_mano(uuid,date,text,text,numeric,text)') is null
     or strpos(pg_get_functiondef('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)'::regprocedure), 'X28 ·') > 0 then
    raise exception 'PRUEBA X28 · 8: la vuelta atrás no deja las dos funciones como antes.';
  end if;
  if public._conta_cadena_rota('c0e20000-0000-4000-8000-0000000000e3') <> 0 then raise exception 'PRUEBA X28 · 8: la cadena no cuadra después.'; end if;
  raise notice 'PRUEBA X28 · 8: la vuelta atrás deja el casado como antes, el «a mano» de siempre intacto, y quita lo nuevo; la cadena, íntegra.';
  raise notice 'PRUEBA X28: 8 de 8 bien.';
end $$;

rollback;
