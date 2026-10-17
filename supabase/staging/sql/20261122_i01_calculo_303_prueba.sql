-- supabase/staging/sql/20261122_i01_calculo_303_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0140_i01_calculo_303 (con la 0100 a la
-- 0130 delante). Todo se aplica DENTRO de la transacción (\i) y acaba en
-- ROLLBACK: staging no cambia.
--
-- Contra el libro de IVA de verdad de la empresa de prueba de la cuenta A
-- (regla 31), que tiene tres apuntes y los tres caen en el 4T de 2026:
--   · una recibida F1 con fecha 24/09 que llegó el 01/10: 1.166,50 al 10 %,
--     116,65 deducibles → [28] [29], y es «de otro periodo»;
--   · una rectificativa recibida (R1) del 02/10: −50,00 y −5,00 → [40] [41];
--   · la venta del día 04/10 (F4): 89,91 al 10 % y 8,99 → [04] [06].
-- O sea: [27] 8,99, [45] 111,65 y [46] −102,66, a compensar. Y en el diario,
-- la 472 del 4T no es [45], porque la recibida se apuntó el 24/09: el aviso
-- «el diario no dice lo mismo» tiene que salir.
--
--   1. El 4T, desde el libro: líneas con su foto, casillas, resultado y las
--      comprobaciones. El 3T, sin facturas.
--   2. Recalcular no duplica nada.
--   3. Lo que Sumied no sabe (un apunte inventado con recargo): error, con
--      motivo y cuántos; y entonces no hay fichero. [110] puesta a mano se
--      queda.
--   4. Una venta inventada al 21 % va a [07] [09]; el fichero (solo
--      service_role) sale «C», y su comprobación se apunta una vez.
--   5. Presentada no se recalcula; el 1T de 2027 arrastra a [110] lo que
--      quedó por compensar ([87] + el resultado del 4T).
--   6. Quién y qué periodo: la cuenta B no calcula la empresa de A; «13» y
--      un mes en una empresa trimestral, no.
--
-- Nada real: los apuntes inventados llevan «PRUEBA I01a» y el CSV es de
-- mentira.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 303: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261122T0100_i01_plazos.sql
\i supabase/migrations/20261122T0110_i01_modelo_datos.sql
\i supabase/migrations/20261122T0120_i01_obligaciones.sql
\i supabase/migrations/20261122T0130_i01_certificados.sql
\i supabase/migrations/20261122T0140_i01_calculo_303.sql

-- La población: si cambia el libro de la empresa A, la prueba lo dice antes de nada.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.vat_book_entry
   where account_id = 'c01a0000-0000-4000-8000-00000000000a' and company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and voided_at is null;
  if v_n <> 3 then raise exception 'PRUEBA 303: el libro de IVA de la empresa A tiene % apuntes y la prueba cuenta con 3. Revísala.', v_n; end if;
  if not exists (select 1 from public.tax_obligation where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and form_code = '303'
                    and valid_to is null and active and cadence = 'quarterly') then
    raise exception 'PRUEBA 303: la empresa A no tiene el 303 trimestral activo.';
  end if;
end $$;

-- ── 1 · El 4T y el 3T, como el administrador de A ─────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v jsonb; k text; x jsonb; r public.tax_return; ch record; v_472 numeric; v_mail int;
  v_espera constant jsonb := '{"04": 89.91, "06": 8.99, "28": 1166.50, "29": 116.65, "40": -50.00, "41": -5.00,
                               "27": 8.99, "45": 111.65, "46": -102.66, "64": -102.66, "65": 100, "66": -102.66,
                               "110": 0, "78": 0, "87": 0, "69": -102.66, "71": -102.66}';
begin
  v := public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  if (v->>'apuntes')::int <> 3 or v->>'resultado' <> 'to_offset' or (v->>'importe')::numeric <> 102.66 then
    raise exception 'PRUEBA 303 1: el 4T sale %.', v;
  end if;
  for k in select jsonb_object_keys(v_espera) loop
    if (v->'casillas'->>k)::numeric is distinct from (v_espera->>k)::numeric then
      raise exception 'PRUEBA 303 1: la casilla [%] da % y tenía que dar %.', k, v->'casillas'->>k, v_espera->>k;
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(v->'casillas')) <> (select count(*) from jsonb_object_keys(v_espera)) then
    raise exception 'PRUEBA 303 1: sobran casillas: %.', v->'casillas';
  end if;
  select * into r from public.tax_return where id = (v->>'declaracion')::uuid;
  if r.status <> 'draft' or r.due_date <> date '2027-01-30' or r.payment_mode is not null or r.calculated_at is null then
    raise exception 'PRUEBA 303 1: la declaración queda %, plazo %, pago %.', r.status, r.due_date, r.payment_mode;
  end if;
  -- La foto de lo declarado.
  select l.frozen into x from public.tax_return_line l where l.tax_return_id = r.id and l.boxes = array['28', '29'];
  if (x->>'base')::numeric <> 1166.50 or x->>'recibida' <> '2026-10-01' or x->>'expedida' <> '2026-09-24' or x->>'libro' <> 'received' then
    raise exception 'PRUEBA 303 1: la recibida queda congelada así: %.', x;
  end if;
  -- Lo comprobado.
  for ch in select check_key, result, title, detail from public.tax_return_check where tax_return_id = r.id order by check_key loop
    raise notice 'PRUEBA 303 1 · % · % · %', ch.check_key, ch.result, ch.title;
  end loop;
  if (select string_agg(check_key || '=' || result, ',' order by check_key) from public.tax_return_check where tax_return_id = r.id)
     not like 'book_vs_303=ok,ledger_477_472=warning,mail_invoices_missing=%,out_of_period=warning,previous_offset=warning' then
    raise exception 'PRUEBA 303 1: las comprobaciones salen %.',
      (select string_agg(check_key || '=' || result, ',' order by check_key) from public.tax_return_check where tax_return_id = r.id);
  end if;
  if (select title from public.tax_return_check where tax_return_id = r.id and check_key = 'out_of_period')
     <> '1 factura recibida tiene fecha de antes del periodo, pero llegó en él: va en este 303.' then
    raise exception 'PRUEBA 303 1: «de otro periodo» no dice lo que tiene que decir.';
  end if;
  -- La 472, contada aparte: lo del 4T en el diario (la recibida está apuntada el 24/09).
  select coalesce(sum(jl.debit - jl.credit), 0) into v_472
    from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id join public.company_account ca on ca.id = jl.company_account_id
   where je.company_id = v_a and je.account_id = 'c01a0000-0000-4000-8000-00000000000a' and je.status = 'validado'
     and je.entry_date between '2026-10-01' and '2026-12-31' and ca.code like '472%';
  select detail into x from public.tax_return_check where tax_return_id = r.id and check_key = 'ledger_477_472';
  if (x->>'cuenta_472')::numeric <> v_472 or v_472 = 111.65 or (x->>'casilla_45')::numeric <> 111.65 then
    raise exception 'PRUEBA 303 1: la 472 % (contada aparte, %) frente a [45]: %.', x->>'cuenta_472', v_472, x;
  end if;
  select count(*) into v_mail from public.supplier_invoice
   where company_id = v_a and arrival_channel = 'correo' and journal_entry_id is null and status not in ('anulada', 'descartada') and invoice_date <= '2026-12-31';
  if jsonb_array_length((select detail->'facturas' from public.tax_return_check where tax_return_id = r.id and check_key = 'mail_invoices_missing')) <> v_mail then
    raise exception 'PRUEBA 303 1: por correo sin apuntar no cuenta %.', v_mail;
  end if;
  -- El 3T: ninguna factura (la recibida llegó en octubre), y el diario sí tiene su 472.
  v := public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  if (v->>'apuntes')::int <> 0 or v->>'resultado' <> 'no_activity' or (v->>'importe')::numeric <> 0 then
    raise exception 'PRUEBA 303 1: el 3T sale %.', v;
  end if;
  raise notice 'PRUEBA 303 1: 4T con 3 apuntes, [46] −102,66 a compensar; 472 del diario %; % por correo sin apuntar; 3T sin facturas.', v_472, v_mail;
end $$;

-- ── 2 · Otra vez: lo mismo, sin duplicar ───────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v1 jsonb; v2 jsonb; v_id uuid;
begin
  v1 := public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  v2 := public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  v_id := (v2->>'declaracion')::uuid;
  if v1->'casillas' <> v2->'casillas' or v1->>'declaracion' <> v2->>'declaracion' then raise exception 'PRUEBA 303 2: recalcular cambia % → %.', v1, v2; end if;
  if (select count(*) from public.tax_return_line where tax_return_id = v_id) <> 3
     or (select count(*) from public.tax_return_check where tax_return_id = v_id) <> 5
     or (select count(*) from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2026 and period = '4T') <> 1 then
    raise exception 'PRUEBA 303 2: recalcular duplica filas.';
  end if;
  raise notice 'PRUEBA 303 2: recalcular deja 1 declaración, 3 líneas y 5 comprobaciones.';
end $$;

-- ── 3 · Lo que no sabe, y [110] a mano ─────────────────────────────────────
reset role;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_r uuid; v_e uuid;
begin
  select id into v_r from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2026 and period = '4T';
  insert into public.tax_return_box (tax_return_id, account_id, company_id, box, value, origin, manual_reason)
  values (v_r, 'c01a0000-0000-4000-8000-00000000000a', v_a, '110', 20, 'manual', 'PRUEBA I01a: lo que dijo el asesor del 303 de antes.');
  select entry_id into v_e from public.vat_book_entry where company_id = v_a and book = 'issued' limit 1;
  insert into public.vat_book_entry (account_id, company_id, entry_id, book, invoice_type, number, issue_date, counterpart_name, qualification,
                                     tax_base, tax_rate, tax_amount, surcharge_rate, surcharge_amount, source_type)
  values ('c01a0000-0000-4000-8000-00000000000a', v_a, v_e, 'issued', 'F1', 'PRUEBA-I01A-1', '2026-11-05', 'PRUEBA I01a', 'S1',
          100, 10, 10, 1.4, 1.40, 'manual');
end $$;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; ch record;
begin
  v := public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  select * into ch from public.tax_return_check where tax_return_id = (v->>'declaracion')::uuid and check_key = 'book_vs_303';
  if ch.result <> 'error' or ch.title not like '%1 con recargo de equivalencia: Sumied todavía no lo declara.%'
     or ch.detail->'no_sabe' <> '[{"motivo": "recargo", "apuntes": 1, "texto": "1 con recargo de equivalencia: Sumied todavía no lo declara."}]'::jsonb then
    raise exception 'PRUEBA 303 3: lo que no sabe sale %, «%», %.', ch.result, ch.title, ch.detail;
  end if;
  -- Lo que no sabe no se cuela en las casillas: siguen las del libro de verdad.
  if (v->'casillas'->>'06')::numeric <> 8.99 or (v->'casillas'->>'27')::numeric <> 8.99 then raise exception 'PRUEBA 303 3: el recargo entra en %.', v->'casillas'; end if;
  -- [110] la puso una persona: se queda, y se dice.
  if (v->'casillas'->>'110')::numeric <> 20 or (v->'casillas'->>'87')::numeric <> 20 or (v->'casillas'->>'78')::numeric <> 0
     or (select result || ' · ' || title from public.tax_return_check where tax_return_id = (v->>'declaracion')::uuid and check_key = 'previous_offset')
        <> 'ok · Las cuotas a compensar de antes las puso una persona: 20,00 €.' then
    raise exception 'PRUEBA 303 3: [110] a mano queda %.', v->'casillas';
  end if;
  -- El fichero no es para la persona.
  begin
    perform public.conta_impuesto_303_fichero((v->>'declaracion')::uuid);
    raise exception 'PRUEBA 303 3: una persona pide el fichero.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_impuesto_303_fichero_comprobado((v->>'declaracion')::uuid, true, '[]', 'x');
    raise exception 'PRUEBA 303 3: una persona apunta la comprobación del fichero.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA 303 3: «%»', ch.title;
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_r uuid;
begin
  select id into v_r from public.tax_return where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and form_code = '303' and fiscal_year = 2026 and period = '4T';
  begin
    perform public.conta_impuesto_303_fichero(v_r);
    raise exception 'PRUEBA 303 3: con algo que no sabe, sale el fichero.';
  exception when sqlstate '22023' then
    raise notice 'PRUEBA 303 3: sin fichero: «%»', sqlerrm;
  end;
end $$;

-- ── 4 · Una venta al 21 % y el fichero ─────────────────────────────────────
reset role;
update public.vat_book_entry set surcharge_rate = null, surcharge_amount = null, tax_rate = 21, tax_amount = 21
 where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and number = 'PRUEBA-I01A-1';

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.conta_impuesto_303_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T');
  -- [27] 8,99 + 21,00; [46] 29,99 − 111,65; [110] 20 a mano, [78] 0 porque sale negativo.
  if (v->'casillas'->>'07')::numeric <> 100 or (v->'casillas'->>'09')::numeric <> 21 or (v->'casillas'->>'27')::numeric <> 29.99
     or (v->'casillas'->>'46')::numeric <> -81.66 or (v->'casillas'->>'71')::numeric <> -81.66 or (v->'casillas'->>'87')::numeric <> 20
     or v->>'resultado' <> 'to_offset' or (v->>'importe')::numeric <> 81.66 or jsonb_array_length(v->'no_sabe') <> 0 then
    raise exception 'PRUEBA 303 4: con la venta al 21 %%: %.', v;
  end if;
  raise notice 'PRUEBA 303 4: [07] 100, [09] 21, [46] −81,66 a compensar, [87] 20.';
end $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_r uuid; f jsonb;
begin
  select id into v_r from public.tax_return where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and form_code = '303' and fiscal_year = 2026 and period = '4T';
  f := public.conta_impuesto_303_fichero(v_r);
  if f->>'tipo' <> 'C' or f->>'periodo' <> '4T' or (f->>'ejercicio')::int <> 2026 or f->'iban' <> 'null'::jsonb
     or coalesce(f->>'nif', '') = '' or coalesce(f->>'nombre', '') = '' or (f->'casillas'->>'71')::numeric <> -81.66 then
    raise exception 'PRUEBA 303 4: el fichero pide %.', f - 'nif' - 'nombre';
  end if;
  perform public.conta_impuesto_303_fichero_comprobado(v_r, false, '["PRUEBA I01a: un fallo"]', 'huella-1');
  perform public.conta_impuesto_303_fichero_comprobado(v_r, true, '[]', 'huella-2');
  if (select count(*) from public.tax_return_check where tax_return_id = v_r and check_key = 'file_layout') <> 1
     or (select result || ' · ' || (detail->>'huella') from public.tax_return_check where tax_return_id = v_r and check_key = 'file_layout') <> 'ok · huella-2' then
    raise exception 'PRUEBA 303 4: la comprobación del fichero queda mal.';
  end if;
  raise notice 'PRUEBA 303 4: fichero «C» sin cuenta; comprobado una vez (la última).';
end $$;

-- ── 5 · Presentada: no se recalcula, y el 1T de 2027 arrastra ──────────────
reset role;
update public.tax_return set status = 'filed', filed_at = now(), filed_via = 'outside', aeat_csv = 'PRUEBAI01ACSVDEMENTIRA'
 where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and form_code = '303' and fiscal_year = 2026 and period = '4T';

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb;
begin
  begin
    perform public.conta_impuesto_303_calcular(v_a, 2026, '4T');
    raise exception 'PRUEBA 303 5: se recalcula una presentada.';
  exception when sqlstate '22023' then
    if sqlerrm <> 'El 303 del 4T de 2026 ya está «Presentado»: no se recalcula.' then raise; end if;
  end;
  v := public.conta_impuesto_303_calcular(v_a, 2027, '1T');
  -- [110] = [87] del 4T (20) + su resultado a compensar (81,66).
  if (v->'casillas'->>'110')::numeric <> 101.66 or (v->'casillas'->>'87')::numeric <> 101.66 or v->>'resultado' <> 'no_activity'
     or (select result || ' · ' || title from public.tax_return_check where tax_return_id = (v->>'declaracion')::uuid and check_key = 'previous_offset')
        <> 'ok · Del 303 del 4T/2026 quedaron 101,66 € por compensar.' then
    raise exception 'PRUEBA 303 5: el 1T de 2027 sale %.', v;
  end if;
  raise notice 'PRUEBA 303 5: la presentada no se recalcula; el 1T de 2027 arrastra 101,66 a [110].';
end $$;

-- ── 6 · Quién y qué periodo ────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; p text;
begin
  foreach p in array array['13', '01'] loop
    begin
      perform public.conta_impuesto_303_calcular(v_a, 2026, p);
      raise exception 'PRUEBA 303 6: «%» se calcula.', p;
    exception when sqlstate '22023' then null;
    end;
  end loop;
end $$;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
begin
  perform public.conta_impuesto_303_calcular('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 2026, '4T');
  raise exception 'PRUEBA 303 6: la cuenta B calcula el 303 de una empresa de A.';
exception when insufficient_privilege then
  raise notice 'PRUEBA 303 6: «13» y «01» no son periodos de una trimestral; la cuenta B no calcula los impuestos de A.';
end $$;

rollback;
