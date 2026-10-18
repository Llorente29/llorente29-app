-- supabase/staging/sql/20261122_i01b_asiento_303_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0180_i01b_asiento_303 (con la 0100 a la
-- 0150 delante), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Contra los 303 de 2026 de la empresa de prueba A, calculados de su libro de
-- IVA aquí dentro. El cargo del banco es un movimiento de prueba creado aquí
-- dentro, en el banco B01 · Norte de A.
--
--   1. La validación: un asiento manual con 477 sin tipo sigue sin validarse,
--      y uno «vat_settlement» que no sale de una declaración, tampoco.
--   2. Contabilizar: un 303 sin presentar no; presentado, sí: asiento de
--      General, validado, origen la declaración, que cuadra, 477 al debe por
--      la [27], 472 al haber por la [45], el resultado a la 4750. La
--      declaración, «Contabilizado». Dos veces no hace dos asientos. La
--      cuenta B no lo contabiliza.
--   3. El pago: el cargo sale en los posibles; casarlo deja «Pagado», el
--      casado con su declaración (bank_match_item.tax_return_id) y el asiento
--      del pago validado (4750 contra el banco). Uno por otro importe, no.
--   4. Deshacer el casado en Bancos: vuelve a «Contabilizado», sin casado.
--   5. Anular el asiento de liquidación: vuelve a «Presentado» (su
--      contraasiento se valida). Con el mes del fin del periodo cerrado, se
--      contabiliza otra vez al primer día abierto, y lo dice.
--   6. El 4T, a compensar: 477 y 472 por sus casillas, el resultado al debe
--      de la 4700, y «A compensar» (pasando por «Contabilizado»).
--   7. Una casilla que el asiento no sabe llevar ([68]): no se contabiliza y
--      dice cuál.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA asiento 303: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql
\i supabase/migrations/20261122T0120_i01_obligaciones.sql
\i supabase/migrations/20261122T0130_i01_certificados.sql
\i supabase/migrations/20261122T0140_i01_calculo_303.sql
\i supabase/migrations/20261122T0150_i01_presentar.sql

-- Lo que staging no tiene y la 0180 cambia (como en la prueba del S01): la
-- tanda de C, la M01 y la 0140 del S01, dentro de la transacción si faltan.
select not exists (select 1 from pg_proc where proname = 'tg_journal_entry_envio_por_aclarar' and pronamespace = 'public'::regnamespace) as falta_c06b \gset
\if :falta_c06b
\echo '>>> Staging aún no tiene la tanda de C: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql
\endif
select to_regprocedure('public.conta_motivos_para_validar(uuid)') is null as falta_m01 \gset
\if :falta_m01
\echo '>>> Staging aún no tiene «Esperan» (M01): se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261117T0100_m01_motivos_para_validar.sql
\endif
select to_regclass('public.conta_eje_analitico') is null as falta_s01_0130 \gset
\if :falta_s01_0130
\i supabase/migrations/20261121T0130_s01_ejes_analiticos.sql
\endif
\i supabase/migrations/20261121T0140_s01_regla5_eje_local.sql

\i supabase/migrations/20261122T0180_i01b_asiento_303.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated, service_role;

-- ── 0 · Los 303 de A, calculados ────────────────────────────────────────────
-- En staging ningún 303 de A en 2026 sale a pagar (run 330: 1T, 2T y 3T sin
-- actividad; 4T a compensar 102,66). Para el camino del pago, una venta del
-- 3T apuntada y validada aquí dentro por su camino de siempre (el libro de IVA
-- lo llena el disparador al validar), con el tipo que ya usa A en su libro.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_tipo uuid; v jsonb;
begin
  select jl.tax_rate_id into v_tipo from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id
   where je.company_id = v_a and jl.vat_book = 'issued' and jl.tax_rate_id is not null limit 1;
  if v_tipo is null or (select rate from public.tax_rate where id = v_tipo) <> 10 then
    raise exception 'PRUEBA asiento 303 · 0: A no tiene en su libro el tipo del 10 %% con que se apunta la venta de prueba.';
  end if;
  v := public.journal_entry_proponer(v_a,
    jsonb_build_object('fecha', '2026-08-31', 'series', 1, 'concepto', 'PRUEBA I01b venta del 3T', 'source_type', 'manual', 'documento', 'PRUEBA-I01B-1',
                       'confianza', 'seguro', 'porque', 'PRUEBA I01b: la venta del 3T que hace salir el 303 a pagar'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '43000000', 'debe', 1100, 'haber', 0, 'comun', true),
      jsonb_build_object('cuenta', '70000000', 'debe', 0, 'haber', 1000, 'comun', true),
      jsonb_build_object('cuenta', '47700010', 'debe', 0, 'haber', 100, 'comun', true,
                         'iva', jsonb_build_object('tipo_id', v_tipo, 'base', 1000, 'libro', 'issued', 'facturas', 1))));
  perform public.journal_entry_validar((v->>'id')::uuid);
  if not exists (select 1 from public.vat_book_entry where entry_id = (v->>'id')::uuid and book = 'issued' and tax_amount = 100) then
    raise exception 'PRUEBA asiento 303 · 0: la venta de prueba no ha entrado en el libro de IVA.';
  end if;
end $$;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; p text; v jsonb; v_pagar uuid; v_compensar uuid; v_otra uuid;
begin
  foreach p in array array['1T', '2T', '3T', '4T'] loop
    v := public.conta_impuesto_303_calcular(v_a, 2026, p);
    raise notice 'PRUEBA asiento 303 · 0: % sale %, %.', p, v->>'resultado', v->>'importe';
    if v_pagar is null and v->>'resultado' = 'to_pay' then v_pagar := (v->>'declaracion')::uuid;
    elsif v_compensar is null and v->>'resultado' = 'to_offset' then v_compensar := (v->>'declaracion')::uuid;
    elsif v_otra is null then v_otra := (v->>'declaracion')::uuid; end if;
  end loop;
  if v_pagar is null or v_compensar is null or v_otra is null then
    raise exception 'PRUEBA asiento 303 · 0: hace falta un 303 a pagar, uno a compensar y otro (a pagar %, a compensar %, otro %).', v_pagar, v_compensar, v_otra;
  end if;
  insert into _p values ('pagar', v_pagar::text), ('compensar', v_compensar::text), ('otra', v_otra::text);
end $$;

-- ── 1 · La validación sigue pidiendo tipo a los demás ──────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; v_e uuid; v_m text;
begin
  foreach v_m in array array['manual', 'vat_settlement'] loop
    v := public.journal_entry_proponer(v_a,
      jsonb_build_object('fecha', '2026-11-30', 'series', 4, 'concepto', 'PRUEBA I01b sin tipo', 'source_type', v_m,
                         'source_id', case when v_m = 'vat_settlement' then gen_random_uuid() end,
                         'confianza', 'seguro', 'porque', 'PRUEBA I01b: 477 sin tipo'),
      '[{"cuenta":"47700000","debe":10,"haber":0,"comun":true},{"cuenta":"47500000","debe":0,"haber":10,"comun":true}]'::jsonb);
    v_e := (v->>'id')::uuid;
    if not exists (select 1 from public.conta_motivos_para_validar(v_e) m where m.codigo = 'apuntes' and m.motivo like '%un apunte de IVA lleva base, tipo y libro registro%') then
      raise exception 'PRUEBA asiento 303 · 1: un asiento % con 477 sin tipo se validaría.', v_m;
    end if;
  end loop;
  raise notice 'PRUEBA asiento 303 · 1: manual y vat_settlement sin declaración siguen sin validarse.';
end $$;

-- ── 2 · Contabilizar ────────────────────────────────────────────────────────
do $$
begin
  perform public.conta_impuesto_303_contabilizar((select val::uuid from _p where k = 'pagar'));
  raise exception 'PRUEBA asiento 303 · 2: se contabiliza un 303 sin presentar.';
exception when sqlstate '22023' then null;
end $$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_u constant uuid := 'c01a0000-0000-4000-8000-0000000000a1'; v_k text; n int := 0;
begin
  foreach v_k in array array['pagar', 'compensar', 'otra'] loop
    n := n + 1;
    perform public.conta_impuesto_fuera((select val::uuid from _p where _p.k = v_k), v_u, 'PRUEBAI01BCSV00' || n, false, null, null, null);
  end loop;
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.conta_impuesto_303_contabilizar((select val::uuid from _p where k = 'pagar'));
  raise exception 'PRUEBA asiento 303 · 2: la cuenta B contabiliza un 303 de A.';
exception when insufficient_privilege then null;
end $$;

reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_r uuid := (select val::uuid from _p where k = 'pagar'); v jsonb; v2 jsonb; r public.tax_return; e public.journal_entry;
  v27 numeric; v45 numeric; v71 numeric; d477 numeric; h472 numeric; h4750 numeric; v_debe numeric; v_haber numeric;
begin
  v := public.conta_impuesto_303_contabilizar(v_r);
  select * into r from public.tax_return where id = v_r;
  select * into e from public.journal_entry where id = r.liquidation_entry_id;
  select max(value) filter (where box = '27'), max(value) filter (where box = '45'), max(value) filter (where box = '71')
    into v27, v45, v71 from public.tax_return_box where tax_return_id = v_r;
  select sum(l.debit - l.credit) filter (where ca.template_code like '477%'), sum(l.credit - l.debit) filter (where ca.template_code like '472%'),
         sum(l.credit - l.debit) filter (where ca.template_code = '4750'), sum(l.debit), sum(l.credit)
    into d477, h472, h4750, v_debe, v_haber
    from public.journal_line l join public.company_account ca on ca.id = l.company_account_id where l.entry_id = e.id;
  if r.status <> 'booked' or e.status <> 'validado' or e.series <> 4 or e.number is null or e.source_type <> 'vat_settlement' or e.source_id <> v_r
     or v_debe <> v_haber or coalesce(d477, 0) <> v27 or coalesce(h472, 0) <> v45 or coalesce(h4750, 0) <> v71
     or e.entry_date <> (select hasta from public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period)) then
    raise exception 'PRUEBA asiento 303 · 2: queda «%», asiento % %/% del % (%), 477 % de %, 472 % de %, 4750 % de %, Debe % Haber %.',
      r.status, e.status, e.series, e.number, e.entry_date, e.source_type, d477, v27, h472, v45, h4750, v71, v_debe, v_haber;
  end if;
  v2 := public.conta_impuesto_303_contabilizar(v_r);
  if not (v2->>'existente')::boolean or (select count(*) from public.journal_entry where source_type = 'vat_settlement' and source_id = v_r) <> 1 then
    raise exception 'PRUEBA asiento 303 · 2: contabilizar dos veces da %.', v2;
  end if;
  insert into _p values ('liquidacion', e.id::text);
  raise notice 'PRUEBA asiento 303 · 2: «%» · «%»', v->>'mensaje', v2->>'mensaje';
end $$;

-- ── 3 · El pago ─────────────────────────────────────────────────────────────
reset role;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'pagar'); r public.tax_return; v_m uuid; v_otro uuid; v_st uuid;
begin
  select * into r from public.tax_return where id = v_r;
  select id into v_st from public.bank_statement where treasury_account_id = 'b0100000-0000-4000-8000-0000000000b1' limit 1;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept, fingerprint, soft_fingerprint)
  values (r.account_id, r.company_id, 'b0100000-0000-4000-8000-0000000000b1', v_st, coalesce(r.due_date_direct_debit, r.due_date), coalesce(r.due_date_direct_debit, r.due_date),
          -r.amount, 'PRUEBA I01B AEAT 303', 'PRUEBA I01B AEAT 303', 'prueba-i01b-303-' || v_r, 'prueba-i01b-303-' || v_r)
  returning id into v_m;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, clean_concept, fingerprint, soft_fingerprint)
  values (r.account_id, r.company_id, 'b0100000-0000-4000-8000-0000000000b1', v_st, coalesce(r.due_date_direct_debit, r.due_date), coalesce(r.due_date_direct_debit, r.due_date),
          -r.amount - 1, 'PRUEBA I01B OTRO', 'PRUEBA I01B OTRO', 'prueba-i01b-otro-' || v_r, 'prueba-i01b-otro-' || v_r)
  returning id into v_otro;
  insert into _p values ('cargo', v_m::text), ('otro', v_otro::text);
end $$;

set local role authenticated;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'pagar'); v_m uuid := (select val::uuid from _p where k = 'cargo'); v jsonb; r public.tax_return; e public.journal_entry;
begin
  if not exists (select 1 from public.conta_impuesto_cargos_posibles(v_r) c where c.movimiento = v_m)
     or exists (select 1 from public.conta_impuesto_cargos_posibles(v_r) c where c.movimiento = (select val::uuid from _p where k = 'otro')) then
    raise exception 'PRUEBA asiento 303 · 3: los cargos posibles no son el del importe.';
  end if;
  begin
    perform public.conta_impuesto_casar_cargo(v_r, (select val::uuid from _p where k = 'otro'));
    raise exception 'PRUEBA asiento 303 · 3: se casa un cargo de otro importe.';
  exception when sqlstate '22023' then null;
  end;
  v := public.conta_impuesto_casar_cargo(v_r, v_m);
  select * into r from public.tax_return where id = v_r;
  select * into e from public.journal_entry where id = r.payment_entry_id;
  if r.status <> 'paid' or r.bank_match_id is null or e.status <> 'validado'
     or not exists (select 1 from public.bank_match_item i where i.match_id = r.bank_match_id and i.tax_return_id = v_r)
     or not exists (select 1 from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
                     where l.entry_id = e.id and ca.template_code = '4750' and l.debit = r.amount)
     or (select status from public.bank_movement where id = v_m) <> 'casado' then
    raise exception 'PRUEBA asiento 303 · 3: el pago queda «%», asiento %, %.', r.status, e.status, v;
  end if;
  insert into _p values ('casado', r.bank_match_id::text);
  raise notice 'PRUEBA asiento 303 · 3: «%»', v->>'mensaje';
end $$;

-- ── 4 · Deshacer el casado ──────────────────────────────────────────────────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'pagar'); r public.tax_return;
begin
  perform public.bank_deshacer((select val::uuid from _p where k = 'casado'), 'PRUEBA I01b: no era este cargo');
  select * into r from public.tax_return where id = v_r;
  if r.status <> 'booked' or r.bank_match_id is not null or r.payment_entry_id is not null
     or not exists (select 1 from public.tax_return_event where tax_return_id = v_r and message like 'Se deshizo el casado del pago en Bancos: PRUEBA I01b%') then
    raise exception 'PRUEBA asiento 303 · 4: deshacer deja «%».', r.status;
  end if;
  raise notice 'PRUEBA asiento 303 · 4: deshecho, vuelve a «%».', public.conta_impuesto_estado_texto(r.status);
end $$;

-- ── 5 · Anular la liquidación; con su mes cerrado, al primer día abierto ────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'pagar'); v_e uuid := (select val::uuid from _p where k = 'liquidacion'); v jsonb; r public.tax_return;
begin
  v := public.journal_entry_anular(v_e, 'PRUEBA I01b: casilla mal');
  select * into r from public.tax_return where id = v_r;
  if r.status <> 'filed' or r.liquidation_entry_id is not null
     or (select status from public.journal_entry where id = (v->>'contraasiento')::uuid) <> 'validado' then
    raise exception 'PRUEBA asiento 303 · 5: anular deja «%», %.', r.status, v;
  end if;
  raise notice 'PRUEBA asiento 303 · 5: anulada, vuelve a «%».', public.conta_impuesto_estado_texto(r.status);
end $$;
reset role;
do $$
declare r public.tax_return; v_hasta date;
begin
  select * into r from public.tax_return where id = (select val::uuid from _p where k = 'pagar');
  select hasta into v_hasta from public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period);
  insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind)
  select r.account_id, r.company_id, y.id, date_trunc('month', v_hasta)::date, 'manual'
    from public.fiscal_year y where y.company_id = r.company_id and v_hasta between y.starts_on and y.ends_on;
end $$;
set local role authenticated;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'pagar'); v_viejo uuid := (select val::uuid from _p where k = 'liquidacion');
        v jsonb; r public.tax_return; e public.journal_entry; v_hasta date;
begin
  v := public.conta_impuesto_303_contabilizar(v_r);
  select * into r from public.tax_return where id = v_r;
  select * into e from public.journal_entry where id = r.liquidation_entry_id;
  select hasta into v_hasta from public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period);
  if r.status <> 'booked' or e.id is null or e.id = v_viejo or e.status <> 'validado'
     or e.entry_date <> public.conta_primer_dia_abierto(r.company_id, v_hasta + 1)
     or v->>'mensaje' not like '%Con fecha ' || to_char(e.entry_date, 'DD/MM/YYYY') || ': el ' || to_char(v_hasta, 'DD/MM/YYYY') || ' no se puede apuntar%' then
    raise exception 'PRUEBA asiento 303 · 5: con el mes cerrado queda «%», asiento del % (fin %): %.', r.status, e.entry_date, v_hasta, v;
  end if;
  raise notice 'PRUEBA asiento 303 · 5: «%»', v->>'mensaje';
end $$;

-- ── 6 · A compensar ─────────────────────────────────────────────────────────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'compensar'); v jsonb; r public.tax_return; e public.journal_entry;
        v27 numeric; v45 numeric; v71 numeric; d477 numeric; h472 numeric; d4700 numeric; v_debe numeric; v_haber numeric;
begin
  v := public.conta_impuesto_303_contabilizar(v_r);
  select * into r from public.tax_return where id = v_r;
  select * into e from public.journal_entry where id = r.liquidation_entry_id;
  select max(value) filter (where box = '27'), max(value) filter (where box = '45'), max(value) filter (where box = '71')
    into v27, v45, v71 from public.tax_return_box where tax_return_id = v_r;
  select sum(l.debit - l.credit) filter (where ca.template_code like '477%'), sum(l.credit - l.debit) filter (where ca.template_code like '472%'),
         sum(l.debit - l.credit) filter (where ca.template_code = '4700'), sum(l.debit), sum(l.credit)
    into d477, h472, d4700, v_debe, v_haber
    from public.journal_line l join public.company_account ca on ca.id = l.company_account_id where l.entry_id = e.id;
  if r.status <> 'offset' or e.status <> 'validado' or v_debe <> v_haber or v71 >= 0
     or coalesce(d477, 0) <> v27 or coalesce(h472, 0) <> v45 or coalesce(d4700, 0) <> -v71
     or not exists (select 1 from public.tax_return_event where tax_return_id = v_r and kind = 'status' and to_status = 'booked') then
    raise exception 'PRUEBA asiento 303 · 6: queda «%», 477 % de %, 472 % de %, 4700 % de %, Debe % Haber %.',
      r.status, d477, v27, h472, v45, d4700, v71, v_debe, v_haber;
  end if;
  raise notice 'PRUEBA asiento 303 · 6: % «%»: «%»', r.period, public.conta_impuesto_estado_texto(r.status), v->>'mensaje';
end $$;

-- ── 7 · Una casilla que no sabe llevar ──────────────────────────────────────
reset role;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'otra');
begin
  if v_r is null then return; end if;
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, origin, manual_reason)
  select id, account_id, company_id, '68', 10, 'manual', 'PRUEBA I01b: regularización' from public.tax_return where id = v_r
  on conflict (tax_return_id, box) do update set value = 10, origin = 'manual', manual_reason = 'PRUEBA I01b: regularización';
end $$;
set local role authenticated;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'otra');
begin
  if v_r is null then raise notice 'PRUEBA asiento 303 · 7: no hay un tercer 303.'; return; end if;
  perform public.conta_impuesto_303_contabilizar(v_r);
  raise exception 'PRUEBA asiento 303 · 7: se contabiliza con la [68].';
exception when sqlstate '22023' then
  if sqlerrm not like '%[68]%' then raise exception 'PRUEBA asiento 303 · 7: el motivo no dice la casilla: %', sqlerrm; end if;
  raise notice 'PRUEBA asiento 303 · 7: «%»', sqlerrm;
end $$;

rollback;
