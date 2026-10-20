-- supabase/staging/sql/20261124_i01c_deducida_prueba.sql
--
-- SOLO STAGING. Prueba de 20261124T0290_i01c_deducida, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Nombra lo nuevo y lo cambiado:
-- public.conta_libro_iva_deducir_en y public.conta_impuesto_303_calcular.
--
-- Con la empresa A (Taberna de Prueba Norte, NIF inventado B28000016), que en
-- staging no tiene nada en 2026, y una recibida INVENTADA de Diez (asiento
-- 2026/2/90001, del 31/03: base 100,00, IVA al 21 %, 21,00), como las del 1T
-- de Foodint que la gestoría dedujo en el 2T:
--   1. Sin «deducida en», va en el 303 del 1T: [28] 100,00 y [29] 21,00; el
--      del 2T no la lleva.
--   2. La carga: con una clave que no es de A, no marca NINGUNA y dice cuál;
--      sin motivo, no; con la clave buena, la marca «deducida en el 2T».
--   3. Ahora va en el 2T ([28] 100,00, [29] 21,00) y no en el 1T; los dos lo
--      dicen en «out_of_period» (una que viene de otro periodo y una que se
--      fue a otro), y la línea del 2T guarda dónde y por qué.
--   4. Otra cuenta no puede marcar las de A.
--   5. La restricción: «deducida en» sin motivo, o en una expedida, no entra.
--   6. Quitarla (periodo null) la devuelve al 1T.
--   7. La vuelta atrás deja el cálculo del 303 BYTE A BYTE como la 0280 (md5
--      del cuerpo 34eb0727…) y sin columnas; y otra vez hacia delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DEDUCIDA: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261124T0290_i01c_deducida.sql

-- ── 0 · La recibida inventada (como postgres: es preparación, no lo probado) ──
do $$
declare
  v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_cuenta uuid; v_ej uuid; v_e uuid := 'd0290000-0000-4000-8000-000000090001';
begin
  select account_id into v_cuenta from public.company where id = v_a;
  if (select tax_id from public.company where id = v_a) <> 'B28000016' then
    raise exception 'PRUEBA DEDUCIDA: la empresa A ya no tiene el NIF inventado B28000016: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and fiscal_year = 2026)
     or exists (select 1 from public.vat_book_entry where company_id = v_a and coalesce(received_date, issue_date) between '2026-01-01' and '2026-06-30') then
    raise exception 'PRUEBA DEDUCIDA: A ya tiene 303 o libro de IVA del primer semestre de 2026 en staging: esta prueba ya no mide lo que cree.';
  end if;
  select id into v_ej from public.fiscal_year where company_id = v_a and code = '2026';
  insert into public.journal_entry (id, account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type,
                                    external_program, external_year, external_series, external_number)
  values (v_e, v_cuenta, v_a, v_ej, 2, '2026-03-31', 'Recibida inventada de la prueba 0290', 'migrated', 'diez', '2026', '2', '90001');
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values
    (v_cuenta, v_a, v_e, 1, (select id from public.company_account where company_id = v_a and code = '60000000'), 100.00, 0),
    (v_cuenta, v_a, v_e, 2, (select id from public.company_account where company_id = v_a and code = '47200021'), 21.00, 0),
    (v_cuenta, v_a, v_e, 3, (select id from public.company_account where company_id = v_a and code = '40000000'), 0, 121.00);
  insert into public.vat_book_entry (account_id, company_id, entry_id, book, invoice_type, number, issue_date, received_date,
                                     counterpart_name, tax_base, tax_rate, tax_amount, deductible_amount, source_type)
  values (v_cuenta, v_a, v_e, 'received', 'F1', 'PRUEBA-0290', '2026-03-31', '2026-03-31',
          'Proveedor inventado de la prueba', 100.00, 21, 21.00, 21.00, 'migrated');
end $$;

create or replace function pg_temp.cajas(p text) returns text language sql as $$
  select coalesce(string_agg(b.box || '=' || b.value, ' ' order by b.box), '(nada)')
    from public.tax_return r join public.tax_return_box b on b.tax_return_id = r.id
   where r.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and r.form_code = '303' and r.fiscal_year = 2026 and r.period = p
     and b.box in ('28', '29') and b.origin = 'calculated'
$$;
grant execute on function pg_temp.cajas(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;


-- ── 1 · Sin «deducida en»: en el 1T ──────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  perform public.conta_impuesto_303_calcular(v_a, 2026, '1T');
  perform public.conta_impuesto_303_calcular(v_a, 2026, '2T');
  if pg_temp.cajas('1T') <> '28=100.00 29=21.00' or pg_temp.cajas('2T') <> '(nada)' then
    raise exception 'PRUEBA DEDUCIDA · 1: sin «deducida en», el 1T da «%» y el 2T «%».', pg_temp.cajas('1T'), pg_temp.cajas('2T');
  end if;
  raise notice 'PRUEBA DEDUCIDA · 1: sin «deducida en», la recibida del 31/03 va en el 1T ([28] 100,00, [29] 21,00).';
end $$;

-- ── 2 · La carga: todas o ninguna, con motivo ────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r jsonb;
begin
  r := public.conta_libro_iva_deducir_en(v_a, '[{"e":"2026","s":"2","n":"90001"},{"e":"2026","s":"2","n":"99999"}]', 2026, '2T', 'Prueba');
  if (r->>'marcadas')::int <> 0 or r->'faltan' <> '[{"e":"2026","s":"2","n":"99999"}]'::jsonb
     or exists (select 1 from public.vat_book_entry where company_id = v_a and deduction_period is not null) then
    raise exception 'PRUEBA DEDUCIDA · 2: con una clave que no es de A, da % (y tendría que no marcar ninguna).', r;
  end if;
  begin
    perform public.conta_libro_iva_deducir_en(v_a, '[{"e":"2026","s":"2","n":"90001"}]', 2026, '2T', '  ');
    raise exception 'PRUEBA DEDUCIDA · 2: marca sin motivo.';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.conta_libro_iva_deducir_en(v_a, '[{"e":"2026","s":"2","n":"90001"}]', 2026, '5T', 'Prueba');
    raise exception 'PRUEBA DEDUCIDA · 2: acepta el periodo 5T.';
  exception when sqlstate '22023' then null;
  end;
  r := public.conta_libro_iva_deducir_en(v_a, '[{"e":"2026","s":"2","n":"90001"}]', 2026, '2T', 'Libro registro de la gestoría (prueba)');
  -- El testigo: A no tiene 303 presentados de 2026, así que el 1T y el 2T se
  -- dicen sin comparar (presentado: no) y la carga NO casa.
  if (r->>'marcadas')::int <> 1 or jsonb_array_length(r->'testigo') <> 2 or (r->>'casa')::boolean
     or exists (select 1 from jsonb_array_elements(r->'testigo') x where (x->>'presentado')::boolean)
     or (select (x->>'libro_29')::numeric from jsonb_array_elements(r->'testigo') x where x->>'periodo' = '2T/2026') <> 21.00 then
    raise exception 'PRUEBA DEDUCIDA · 2: con la clave buena da %.', r;
  end if;
  raise notice 'PRUEBA DEDUCIDA · 2: una clave ajena no marca ninguna; sin motivo o con 5T, no; con la buena, «%».', r->>'texto';
end $$;

-- ── 3 · Ahora en el 2T, y los dos lo dicen ───────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; k1 jsonb; k2 jsonb; l jsonb;
begin
  perform public.conta_impuesto_303_calcular(v_a, 2026, '1T');
  perform public.conta_impuesto_303_calcular(v_a, 2026, '2T');
  if pg_temp.cajas('1T') <> '(nada)' or pg_temp.cajas('2T') <> '28=100.00 29=21.00' then
    raise exception 'PRUEBA DEDUCIDA · 3: deducida en el 2T, el 1T da «%» y el 2T «%».', pg_temp.cajas('1T'), pg_temp.cajas('2T');
  end if;
  select to_jsonb(k) into k1 from public.tax_return_check k join public.tax_return r on r.id = k.tax_return_id
   where r.company_id = v_a and r.fiscal_year = 2026 and r.period = '1T' and k.check_key = 'out_of_period';
  select to_jsonb(k) into k2 from public.tax_return_check k join public.tax_return r on r.id = k.tax_return_id
   where r.company_id = v_a and r.fiscal_year = 2026 and r.period = '2T' and k.check_key = 'out_of_period';
  if k1->>'result' <> 'warning' or (k1->'detail'->>'de_aqui_deducidas_en_otro')::int <> 1 or k1->>'title' not like '%se dedujo en otro%'
     or k2->>'result' <> 'warning' or (k2->'detail'->>'deducidas_aqui_de_otro_periodo')::int <> 1 or k2->>'title' not like '%se dedujo en este%' then
    raise exception 'PRUEBA DEDUCIDA · 3: «out_of_period» da % (1T) y % (2T).', k1, k2;
  end if;
  select l.frozen into l from public.tax_return_line l join public.tax_return r on r.id = l.tax_return_id
   where r.company_id = v_a and r.fiscal_year = 2026 and r.period = '2T';
  if l->>'deducida_en' <> '2T/2026' or l->>'deducida_porque' <> 'Libro registro de la gestoría (prueba)' or l->>'recibida' <> '2026-03-31' then
    raise exception 'PRUEBA DEDUCIDA · 3: la línea del 2T guarda %.', l;
  end if;
  raise notice 'PRUEBA DEDUCIDA · 3: va en el 2T y no en el 1T; los dos lo dicen; la línea guarda dónde y por qué; la fecha de recepción sigue siendo el 31/03.';
end $$;

-- ── 4 · Otra cuenta no puede ─────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  perform set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
  begin
    perform public.conta_libro_iva_deducir_en(v_a, '[{"e":"2026","s":"2","n":"90001"}]', null, null, null);
    raise exception 'PRUEBA DEDUCIDA · 4: otra cuenta cambia dónde se dedujo una recibida de A.';
  exception when sqlstate '42501' then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  raise notice 'PRUEBA DEDUCIDA · 4: otra cuenta no puede.';
end $$;

-- ── 5 · La restricción ───────────────────────────────────────────────────────
reset role;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  begin
    update public.vat_book_entry set deduction_reason = null where company_id = v_a and deduction_period is not null;
    raise exception 'PRUEBA DEDUCIDA · 5: deja «deducida en» sin motivo.';
  exception when check_violation then null;
  end;
  begin
    update public.vat_book_entry set book = 'issued' where company_id = v_a and deduction_period is not null;
    raise exception 'PRUEBA DEDUCIDA · 5: deja «deducida en» en una expedida.';
  exception when check_violation then null;
  end;
  raise notice 'PRUEBA DEDUCIDA · 5: sin motivo, o en una expedida, no entra.';
end $$;
set local role authenticated;

-- ── 6 · Quitarla la devuelve al 1T ───────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r jsonb;
begin
  r := public.conta_libro_iva_deducir_en(v_a, '[{"e":"2026","s":"2","n":"90001"}]', null, null, null);
  perform public.conta_impuesto_303_calcular(v_a, 2026, '1T');
  perform public.conta_impuesto_303_calcular(v_a, 2026, '2T');
  if (r->>'marcadas')::int <> 1 or pg_temp.cajas('1T') <> '28=100.00 29=21.00' or pg_temp.cajas('2T') <> '(nada)'
     or exists (select 1 from public.vat_book_entry where company_id = v_a and deduction_reason is not null) then
    raise exception 'PRUEBA DEDUCIDA · 6: quitada, da % (1T «%», 2T «%»).', r, pg_temp.cajas('1T'), pg_temp.cajas('2T');
  end if;
  raise notice 'PRUEBA DEDUCIDA · 6: quitada, vuelve al 1T: «%».', r->>'texto';
end $$;

-- ── 7 · Vuelta atrás (byte a byte la 0280) y otra vez hacia delante ─────────
reset role;
\i supabase/vuelta-atras/20261124T0290_i01c_deducida.down.sql
do $$ begin
  if md5((select prosrc from pg_proc where oid = 'public.conta_impuesto_303_calcular(uuid,integer,text)'::regprocedure)) <> '34eb07273e5020aea7f270dc0ecd4254' then
    raise exception 'PRUEBA DEDUCIDA · 7: la vuelta atrás no deja el cálculo del 303 byte a byte como la 0280.';
  end if;
  if to_regprocedure('public.conta_libro_iva_deducir_en(uuid,jsonb,integer,text,text)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vat_book_entry' and column_name like 'deduction_%') then
    raise exception 'PRUEBA DEDUCIDA · 7: la vuelta atrás deja la función o las columnas.';
  end if;
end $$;
\i supabase/migrations/20261124T0290_i01c_deducida.sql
do $$ begin
  if to_regprocedure('public.conta_libro_iva_deducir_en(uuid,jsonb,integer,text,text)') is null
     or (select prosrc from pg_proc where oid = 'public.conta_impuesto_303_calcular(uuid,integer,text)'::regprocedure) not like '%0290%' then
    raise exception 'PRUEBA DEDUCIDA · 7: hacia delante otra vez no vuelve todo.';
  end if;
end $$;

\echo '>>> PRUEBA DEDUCIDA (0290): en verde. ROLLBACK: staging no cambia.'
rollback;
