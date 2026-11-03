-- supabase/staging/sql/20261103_s01q_liquidaciones_prueba.sql
--
-- SOLO STAGING. Prueba del S01q·10 (0741, 0742, 0743 y 0744). Todo en una
-- transacción con ROLLBACK. Datos inventados, en la empresa A (Glovo: su 430,
-- la 43000001; su 410, la 41000002). La 0743 es de Foodint y en staging no
-- hace nada. Nombra lo que toca, para el analizador: conta_impuesto_303_cajas,
-- _conta_proponer_plataforma, _conta_plataforma_entrada, journal_line,
-- journal_entry, channel_settlement.
--   1. El fallo de las 27: la liquidación se propone al entrar, con la
--      comisión; al enlazarle su factura (ya contabilizada), la propuesta se
--      REHACE sola: solo compensa.
--   2. Su factura sin contabilizar: la liquidación espera, y lo dice con el
--      porqué de la factura («difieren en 170,61 €»).
--   3. Pasa a ser de referencia: su propuesta se quita y se dice por qué.
--   4. Una VALIDADA no se toca nunca, aunque luego le llegue su factura.
--   5. La regla hermana de la 1: ni gasto ni IVA soportado en el asiento de una
--      liquidación con su factura contabilizada, ni asiento si es de referencia.
--   6. El 303: una recibida con IVA no deducible de un proveedor de fuera no se
--      marca «sin autoliquidar»; una deducible, sí.
--   7. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01q·10 liquidaciones: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: las liquidaciones entran como entra el Excel (el disparador, sin nadie); la regla se prueba como una tanda.

\i supabase/migrations/20261103T0741_s01q_303_no_deducible.sql
\i supabase/migrations/20261103T0742_s01q_plataforma_rehace.sql
\i supabase/migrations/20261103T0743_s01q_glovo_rehacer.sql
\i supabase/migrations/20261103T0744_s01q_liquidacion_no_repite.sql

create temp table _p (k text primary key, v text) on commit drop;
insert into _p values ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('glovo', 'e0200000-0000-4000-8000-00000000a0c1'), ('centro', 'c01a0000-0000-4000-8000-0000000000a2'),
  ('proveedor', 'c0300000-0000-4000-8000-000000000001');
create function pg_temp.p(k text) returns uuid language sql as $$ select v::uuid from _p where _p.k = $1 $$;
create function pg_temp.lineas(p uuid) returns text language sql as $$
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by jl.position)
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = p
$$;
create function pg_temp.asiento(p_liq uuid) returns public.journal_entry language sql as $$
  select * from public.journal_entry where company_id = pg_temp.p('empresa') and source_type = 'channel_settlement' and source_id = p_liq
     and status <> 'anulado' order by created_at desc limit 1
$$;
create function pg_temp.pendiente(p_liq uuid) returns text language sql as $$
  select porque from public.conta_propuesta_pendiente where company_id = pg_temp.p('empresa') and origen = 'channel_settlement' and origen_id = p_liq::text
$$;
-- Una factura de comisión de Glovo (inventada); contabilizada si se pide.
create function pg_temp.factura(p_num text, p_total numeric, p_contabilizar boolean) returns uuid language plpgsql as $$
declare v uuid; r jsonb;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, tax_base_total, tax_total, grand_total, status, source, created_by_name)
  values (pg_temp.p('cuenta'), pg_temp.p('empresa'), pg_temp.p('proveedor'), p_num, date '2026-10-18', round(p_total / 1.21, 2), p_total - round(p_total / 1.21, 2), p_total,
          'aprobada', 'manual', 'Prueba S01q·10')
  returning id into v;
  if p_contabilizar then
    r := public._journal_entry_proponer(pg_temp.p('empresa'),
           jsonb_build_object('series', 2, 'fecha', date '2026-10-18', 'concepto', 'Factura Glovo · ' || p_num, 'source_type', 'supplier_invoice', 'source_id', v,
                              'confianza', 'seguro', 'porque', 'Prueba S01q·10.', 'documento', p_num),
           jsonb_build_array(jsonb_build_object('cuenta', '62300000', 'debe', p_total, 'haber', 0, 'comun', true),
                             jsonb_build_object('cuenta', '41000002', 'debe', 0, 'haber', p_total, 'comun', true, 'documento', p_num)),
           null, 'Prueba S01q·10', null);
    perform public._journal_entry_validar((r->>'id')::uuid, 'Prueba S01q·10');
    insert into _p values ('asiento_' || p_num, r->>'id');
  end if;
  return v;
end $$;
create function pg_temp.liquidacion(p_id uuid, p_ref text) returns void language sql as $$
  insert into public.channel_settlement (id, account_id, channel_id, location_id, settlement_ref, settlement_date, period_from, period_to, flow_type, source, import_key,
                                         gross_sales, commission, delivery_transport, net_payout)
  values (p_id, pg_temp.p('cuenta'), pg_temp.p('glovo'), pg_temp.p('centro'), p_ref, '2026-10-20', '2026-10-12', '2026-10-18', 'own', 'import_csv_uber',
          'prueba-s01q10-' || p_ref, 200, -20, -5, 169.75)
$$;

-- 1 · El fallo de las 27: propuesta con la comisión y, al llegar su factura contabilizada, rehecha sola.
do $$
declare v_f uuid; je public.journal_entry; v_liq constant uuid := '5e01a000-0000-4000-8000-000000000001';
begin
  if not public.conta_dia_abierto(pg_temp.p('empresa'), '2026-10-20') then raise exception 'PRUEBA S01q·10: el 20/10 no está abierto en la empresa A.'; end if;
  v_f := pg_temp.factura('S01Q10-0001', 30.25, true);
  perform set_config('s01i.sin_buscar', 'si', true);
  perform pg_temp.liquidacion(v_liq, 'S01Q10-P1');
  perform set_config('s01i.sin_buscar', '', true);
  je := pg_temp.asiento(v_liq);
  if je.id is null or pg_temp.lineas(je.id) not like '62300000 20.00/0.00 · 62900000 5.00/0.00 · 47200021%' then
    raise exception 'PRUEBA S01q·10 · 1: al entrar sin su factura no se propuso con la comisión: %', pg_temp.lineas(je.id);
  end if;
  update public.channel_settlement set commission_invoice_id = v_f where id = v_liq;
  je := pg_temp.asiento(v_liq);
  if je.id is null or je.status <> 'propuesto' or pg_temp.lineas(je.id) <> '41000002 30.25/0.00 · 43000001 0.00/30.25' then
    raise exception 'PRUEBA S01q·10 · 1: con su factura contabilizada no se rehízo: % (%).', pg_temp.lineas(je.id), je.status;
  end if;
  if (select count(*) from public.journal_entry where source_type = 'channel_settlement' and source_id = v_liq) <> 1 then
    raise exception 'PRUEBA S01q·10 · 1: quedan dos propuestas de la misma liquidación.';
  end if;
  insert into _p values ('liq1', v_liq), ('prop1', je.id);
  raise notice 'PRUEBA S01q·10 · 1: rehecha sola al llegar su factura: %', pg_temp.lineas(je.id);
end $$;

-- 2 · Su factura sin contabilizar: espera, y lo dice.
do $$
declare v_f uuid; v_liq constant uuid := '5e01a000-0000-4000-8000-000000000002'; v_msg text;
begin
  v_f := pg_temp.factura('S01Q10-0002', 577.42, false);
  insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, porque)
  values (v_f, pg_temp.p('cuenta'), pg_temp.p('empresa'), 'no', 'La factura y su liquidación difieren en 170,61 € y no es la tarifa recurrente.');
  perform set_config('s01i.sin_buscar', 'si', true);
  perform pg_temp.liquidacion(v_liq, 'S01Q10-P2');
  perform set_config('s01i.sin_buscar', '', true);
  update public.channel_settlement set commission_invoice_id = v_f where id = v_liq;
  v_msg := pg_temp.pendiente(v_liq);
  if (pg_temp.asiento(v_liq)).id is not null
     or v_msg is distinct from 'Sin propuesta hasta que se aclare su factura de comisión S01Q10-0002: la factura y su liquidación difieren en 170,61 € y no es la tarifa recurrente.' then
    raise exception 'PRUEBA S01q·10 · 2: no espera a su factura o no lo dice: % / %', pg_temp.lineas((pg_temp.asiento(v_liq)).id), v_msg;
  end if;
  raise notice 'PRUEBA S01q·10 · 2: «%»', v_msg;
end $$;

-- 3 · Pasa a ser de referencia: su propuesta se quita, y se dice.
do $$
declare v_liq constant uuid := '5e01a000-0000-4000-8000-000000000003';
begin
  perform set_config('s01i.sin_buscar', 'si', true);
  perform pg_temp.liquidacion(v_liq, 'S01Q10-P3');
  perform set_config('s01i.sin_buscar', '', true);
  if (pg_temp.asiento(v_liq)).id is null then raise exception 'PRUEBA S01q·10 · 3: al entrar no se propuso.'; end if;
  update public.channel_settlement set is_reference = true where id = v_liq;
  if (pg_temp.asiento(v_liq)).id is not null or pg_temp.pendiente(v_liq) not like 'De referencia%' then
    raise exception 'PRUEBA S01q·10 · 3: siendo de referencia sigue su propuesta, o no se dice: %', pg_temp.pendiente(v_liq);
  end if;
  insert into _p values ('liq3', v_liq);
  raise notice 'PRUEBA S01q·10 · 3: de referencia, sin propuesta: «%»', pg_temp.pendiente(v_liq);
end $$;

-- 4 · Una validada no se toca nunca.
do $$
declare v_f uuid; je public.journal_entry; v_liq constant uuid := '5e01a000-0000-4000-8000-000000000004'; v_antes text;
begin
  perform set_config('s01i.sin_buscar', 'si', true);
  perform pg_temp.liquidacion(v_liq, 'S01Q10-P4');
  perform set_config('s01i.sin_buscar', '', true);
  je := pg_temp.asiento(v_liq);
  perform public._journal_entry_validar(je.id, 'Prueba S01q·10');
  v_antes := pg_temp.lineas(je.id);
  v_f := pg_temp.factura('S01Q10-0004', 30.25, true);
  update public.channel_settlement set commission_invoice_id = v_f where id = v_liq;
  if (pg_temp.asiento(v_liq)).id <> je.id or (pg_temp.asiento(v_liq)).status <> 'validado' or pg_temp.lineas(je.id) <> v_antes then
    raise exception 'PRUEBA S01q·10 · 4: una validada se ha tocado.';
  end if;
  raise notice 'PRUEBA S01q·10 · 4: la validada sigue igual: %', v_antes;
end $$;

-- 5 · La regla hermana de la 1.
do $$
declare v_msg text; v_err text; v_n text;
begin
  select e.series || '/' || e.number into v_n from public.journal_entry e where e.id = (select v::uuid from _p where k = 'asiento_S01Q10-0001');
  begin
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit)
    values (pg_temp.p('cuenta'), pg_temp.p('empresa'), (select v::uuid from _p where k = 'prop1'), 9,
            (select id from public.company_account where company_id = pg_temp.p('empresa') and code = '62300000'), 1, 0);
  exception when others then v_msg := sqlerrm; v_err := sqlstate;
  end;
  if v_err is distinct from '23505' or v_msg is distinct from format('La comisión de esta liquidación ya está contabilizada en el asiento %s del 18/10/2026 (su factura S01Q10-0001): aquí solo se compensa.', v_n) then
    raise exception 'PRUEBA S01q·10 · 5: la comisión se apunta otra vez: % / %', v_err, v_msg;
  end if;
  raise notice 'PRUEBA S01q·10 · 5 (comisión): «%»', v_msg;
  v_msg := null; v_err := null;
  begin
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, created_by_name)
    values (pg_temp.p('cuenta'), pg_temp.p('empresa'), (select id from public.fiscal_year where company_id = pg_temp.p('empresa') and date '2026-10-20' between starts_on and ends_on),
            3, date '2026-10-20', 'Liquidación de referencia (prueba)', 'channel_settlement', (select v::uuid from _p where k = 'liq3'), 'borrador', 'Prueba S01q·10');
  exception when others then v_msg := sqlerrm; v_err := sqlstate;
  end;
  if v_err is distinct from '23514' or v_msg not like 'Esta liquidación es de referencia (de antes del corte, el %): no lleva asiento.' then
    raise exception 'PRUEBA S01q·10 · 5: una de referencia lleva asiento: % / %', v_err, v_msg;
  end if;
  raise notice 'PRUEBA S01q·10 · 5 (referencia): «%»', v_msg;
end $$;

-- 6 · El 303: IVA no deducible de un proveedor de fuera.
do $$
declare v_nd public.vat_book_entry; v_d public.vat_book_entry;
begin
  v_nd := jsonb_populate_record(null::public.vat_book_entry,
            '{"book": "received", "invoice_type": "F1", "reverse_charge": false, "operation_key": "01", "counterpart_country": "IE", "tax_rate": 21, "tax_base": 10.09, "tax_amount": 2.12, "deductible_amount": 0}');
  v_d := jsonb_populate_record(null::public.vat_book_entry,
            '{"book": "received", "invoice_type": "F1", "reverse_charge": false, "operation_key": "01", "counterpart_country": "IE", "tax_rate": 21, "tax_base": 10.09, "tax_amount": 2.12, "deductible_amount": 2.12}');
  if (select no_sabe from public.conta_impuesto_303_cajas(v_nd)) is not null or (select cajas from public.conta_impuesto_303_cajas(v_nd)) <> '{}'::text[] then
    raise exception 'PRUEBA S01q·10 · 6: la no deducible de fuera sigue marcada: %', (select no_sabe from public.conta_impuesto_303_cajas(v_nd));
  end if;
  if (select no_sabe from public.conta_impuesto_303_cajas(v_d)) is distinct from 'extranjera_sin_isp' then
    raise exception 'PRUEBA S01q·10 · 6: la deducible de fuera ya no se marca.';
  end if;
  raise notice 'PRUEBA S01q·10 · 6: la no deducible de fuera no entra en el 303; la deducible sigue marcada.';
end $$;

-- 7 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261103T0744_s01q_liquidacion_no_repite.down.sql
\i supabase/vuelta-atras/20261103T0743_s01q_glovo_rehacer.down.sql
\i supabase/vuelta-atras/20261103T0742_s01q_plataforma_rehace.down.sql
\i supabase/vuelta-atras/20261103T0741_s01q_303_no_deducible.down.sql
do $$ begin
  if exists (select 1 from pg_trigger where tgname in ('trg_journal_line_liquidacion_no_repite', 'trg_journal_entry_liquidacion_no_repite'))
     or strpos(pg_get_functiondef('public._conta_plataforma_entrada(uuid,uuid)'::regprocedure), 'fa_espera') > 0
     or strpos(pg_get_functiondef('public._conta_proponer_plataforma(uuid,uuid,text)'::regprocedure), 'S01q·10') > 0
     or strpos(pg_get_functiondef('public.conta_impuesto_303_cajas(public.vat_book_entry)'::regprocedure), 'S01q·10') > 0 then
    raise exception 'PRUEBA S01q·10 · 7: la vuelta atrás no lo deja como estaba.';
  end if;
  raise notice 'PRUEBA S01q·10 · 7: la vuelta atrás lo deja como estaba.';
end $$;
\i supabase/migrations/20261103T0741_s01q_303_no_deducible.sql
\i supabase/migrations/20261103T0742_s01q_plataforma_rehace.sql
\i supabase/migrations/20261103T0744_s01q_liquidacion_no_repite.sql

rollback;
