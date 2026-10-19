-- supabase/staging/sql/20261122_i01b_349_por_operaciones_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0250_i01b_349_por_operaciones, con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. Nombra lo que cambia
-- en caliente: public.conta_impuesto_reglas y public.conta_impuesto_calendario;
-- y lo nuevo, public.conta_paises_ue.
--
-- Con la empresa A (sin respuesta del ROI y, en staging, sin operaciones con
-- la UE: si eso cambia, la prueba lo dice y para):
--   1. Sin operaciones con la UE ni ROI: el 349 no le sale, y se dice: la
--      regla da su fila inactiva con el porqué, calcular no escribe nada y el
--      calendario la pinta en «no_presenta» («No te sale el 349: …»).
--   2. Una compra intracomunitaria en el libro (clave 09): sale, activo, con
--      «1 compra a empresas de la UE»; y calcular lo escribe como regla.
--   3. Quitarlo con motivo: queda quitado, y recalcular no lo pisa.
--   4. Una venta intracomunitaria (exenta E5) y «no estoy en el ROI»: cuenta
--      las dos y pide confirmarlo con el asesor.
--   5. Una compra de hace más de 12 meses no cuenta.
--   6. Su vuelta atrás (la regla de la 0120: con ops y sin ROI, no sale; el
--      calendario de la 0190, con su md5) y otra vez hacia delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA 349: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0250_i01b_349_por_operaciones.sql

create temporary table _p (k text primary key, val text) on commit drop;

-- ── 1 · Sin operaciones con la UE ni ROI: no sale ───────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if exists (select 1 from public.company_tax_facts where company_id = v_a and fact = 'roi_registered') then
    raise exception 'PRUEBA 349 · 1: A ya tiene respuesta del ROI en staging: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.vat_book_entry v where v.company_id = v_a and v.voided_at is null
              and (v.operation_key = '09' or v.exempt_cause = 'E5' or v.counterpart_country = any (public.conta_paises_ue()))) then
    raise exception 'PRUEBA 349 · 1: A ya tiene operaciones con la UE en staging: esta prueba ya no mide lo que cree.';
  end if;
  if exists (select 1 from public.tax_obligation where company_id = v_a and form_code = '349' and valid_to is null) then
    raise exception 'PRUEBA 349 · 1: A ya tiene el 349 escrito en staging: esta prueba ya no mide lo que cree.';
  end if;
  if not exists (select 1 from public.conta_impuesto_reglas(v_a) where form_code = '349' and not active and rule_key = 'roi_349'
                    and why = 'No tienes compras ni ventas con empresas de la UE en los últimos 12 meses.') then
    raise exception 'PRUEBA 349 · 1: sin operaciones con la UE ni ROI, la regla no dice que no sale (%).',
      (select jsonb_agg(to_jsonb(r)) from public.conta_impuesto_reglas(v_a) r where r.form_code = '349');
  end if;
  insert into _p values ('entry', (select id::text from public.journal_entry where company_id = v_a order by entry_date desc, id limit 1));
  raise notice 'PRUEBA 349 · 1: sin operaciones con la UE ni ROI, no sale, y la regla dice por qué.';
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb; k jsonb;
begin
  v := public.conta_impuesto_obligaciones_calcular(v_a);
  if (select x->>'hecho' from jsonb_array_elements(v) x where x->>'modelo' = '349') is distinct from 'no_toca'
     or exists (select 1 from public.tax_obligation where company_id = v_a and form_code = '349' and valid_to is null) then
    raise exception 'PRUEBA 349 · 1: calcular escribe un 349 que no sale (%).', v;
  end if;
  k := public.conta_impuesto_calendario(v_a);
  if not exists (select 1 from jsonb_array_elements(k->'no_presenta') x
                  where x->>'modelo' = '349' and x->>'por_que' = 'No tienes compras ni ventas con empresas de la UE en los últimos 12 meses.')
     or exists (select 1 from jsonb_array_elements(k->'modelos') x where x->>'modelo' = '349') then
    raise exception 'PRUEBA 349 · 1: el calendario no dice «No te sale el 349» (no_presenta: %).', k->'no_presenta';
  end if;
  raise notice 'PRUEBA 349 · 1: calcular no escribe nada y el calendario lo pinta: %', k->'no_presenta';
end $$;
reset role;

-- ── 2 · Una compra intracomunitaria: sale, y calcular la escribe ────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r record;
begin
  insert into public.vat_book_entry (account_id, company_id, entry_id, book, invoice_type, issue_date, received_date, operation_key, qualification,
                                     tax_base, tax_rate, tax_amount, deductible_amount, deductible_later, reverse_charge, investment_good, source_type)
  select c.account_id, v_a, (select val::uuid from _p where k = 'entry'), 'received', 'F1', current_date - 10, current_date - 10, '09', 'S2',
         100, 21, 21, 21, false, true, false, 'migrated'
    from public.company c where c.id = v_a;
  select * into r from public.conta_impuesto_reglas(v_a) where form_code = '349';
  if r.form_code is null or not r.active or r.rule_key <> 'roi_349' or r.why not like 'En los últimos 12 meses tienes 1 compra a empresas de la UE:%'
     or (r.rule_facts->>'compras_ue_12_meses')::int <> 1 then
    raise exception 'PRUEBA 349 · 2: con una compra intracomunitaria sale %.', to_jsonb(r);
  end if;
  raise notice 'PRUEBA 349 · 2: %', r.why;
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; o public.tax_obligation;
begin
  perform public.conta_impuesto_obligaciones_calcular(v_a);
  select * into o from public.tax_obligation where company_id = v_a and form_code = '349' and valid_to is null;
  if o.id is null or not o.active or o.origin <> 'rule' or o.rule_key <> 'roi_349' then
    raise exception 'PRUEBA 349 · 2: calcular no escribe el 349 como regla (%).', to_jsonb(o);
  end if;
  raise notice 'PRUEBA 349 · 2: calcular lo escribe: %', o.why;
end $$;

-- ── 3 · Quitarlo con motivo: recalcular no lo pisa ──────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; o public.tax_obligation; v jsonb;
begin
  perform public.conta_impuesto_obligacion_decidir(v_a, '349', false, 'La gestoría no lo presenta (prueba)');
  v := public.conta_impuesto_obligaciones_calcular(v_a);
  select * into o from public.tax_obligation where company_id = v_a and form_code = '349' and valid_to is null;
  if o.active or o.origin <> 'removed'
     or (select x->>'hecho' from jsonb_array_elements(v) x where x->>'modelo' = '349') <> 'lo_decidio_una_persona' then
    raise exception 'PRUEBA 349 · 3: lo quitado a mano no se queda (% · %).', to_jsonb(o), v;
  end if;
  raise notice 'PRUEBA 349 · 3: quitado con motivo, y recalcular no lo pisa: %', o.why;
end $$;
reset role;

-- ── 4 · Una venta intracomunitaria y «no estoy en el ROI» ───────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r record;
begin
  insert into public.vat_book_entry (account_id, company_id, entry_id, book, invoice_type, issue_date, operation_key, exempt_cause,
                                     tax_base, tax_rate, tax_amount, deductible_later, reverse_charge, investment_good, source_type)
  select c.account_id, v_a, (select val::uuid from _p where k = 'entry'), 'issued', 'F1', current_date - 5, '01', 'E5',
         500, 0, 0, false, false, false, 'migrated'
    from public.company c where c.id = v_a;
  insert into public.company_tax_facts (company_id, account_id, fact, value, origin)
  select v_a, c.account_id, 'roi_registered', 'false'::jsonb, 'ajustes' from public.company c where c.id = v_a;
  select * into r from public.conta_impuesto_reglas(v_a) where form_code = '349';
  if not r.active or r.why not like '%1 compra a empresas de la UE y 1 venta a empresas de la UE:%' or r.why not like '%confírmalo con tu asesor.' then
    raise exception 'PRUEBA 349 · 4: con compra, venta y «no estoy en el ROI» sale %.', r.why;
  end if;
  raise notice 'PRUEBA 349 · 4: %', r.why;
end $$;

-- ── 5 · Lo de hace más de 12 meses no cuenta ────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; r record;
begin
  update public.vat_book_entry set issue_date = current_date - 400, received_date = current_date - 400, operation_date = null
   where company_id = v_a and source_type = 'migrated' and (operation_key = '09' or exempt_cause = 'E5');
  select * into r from public.conta_impuesto_reglas(v_a) where form_code = '349';
  if r.active or r.why <> 'No estás en el Registro de Operadores Intracomunitarios ni tienes operaciones con la UE en los últimos 12 meses.' then
    raise exception 'PRUEBA 349 · 5: lo de hace más de 12 meses cuenta (%).', to_jsonb(r);
  end if;
  raise notice 'PRUEBA 349 · 5: lo de hace más de 12 meses no cuenta: %', r.why;
end $$;

-- ── 6 · Vuelta atrás, y otra vez hacia delante ──────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  -- Otra vez con una compra de este año y sin respuesta del ROI: la 0250 la propone; la 0120 no.
  update public.vat_book_entry set issue_date = current_date - 10, received_date = current_date - 10
   where company_id = v_a and source_type = 'migrated' and operation_key = '09';
  delete from public.company_tax_facts where company_id = v_a and fact = 'roi_registered';
end $$;
\i supabase/vuelta-atras/20261122T0250_i01b_349_por_operaciones.down.sql
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if to_regprocedure('public.conta_paises_ue()') is not null then raise exception 'PRUEBA 349 · 6: la vuelta atrás deja conta_paises_ue.'; end if;
  if exists (select 1 from public.conta_impuesto_reglas(v_a) where form_code = '349') then
    raise exception 'PRUEBA 349 · 6: después de la vuelta atrás, el 349 sigue saliendo por operaciones (la regla de la 0120 solo mira el ROI).';
  end if;
  -- Las dos, byte a byte las de antes (medidas en staging y en producción el 19/10).
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_calendario(uuid,date)'::regprocedure) <> 'ff7dbd56eb80d04833821665c0e012c1'
     or (select md5(prosrc) from pg_proc where oid = 'public.conta_impuesto_reglas(uuid)'::regprocedure) <> 'c327986c6c692e35680e88e04c562f6c' then
    raise exception 'PRUEBA 349 · 6: la vuelta atrás no deja el calendario de la 0190 y la regla de la 0120 tal cual.';
  end if;
  if position('compras_ue_12_meses' in pg_get_functiondef('public.conta_impuesto_reglas(uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA 349 · 6: la vuelta atrás no devuelve la regla de la 0120.';
  end if;
  raise notice 'PRUEBA 349 · 6: vuelta atrás hecha: la regla de la 0120, el calendario de la 0190 y sin conta_paises_ue.';
end $$;
\i supabase/migrations/20261122T0250_i01b_349_por_operaciones.sql
do $$ begin
  if not exists (select 1 from public.conta_impuesto_reglas('3b34403a-a7d6-4a48-a8d7-737e8cababdc') where form_code = '349' and active) then
    raise exception 'PRUEBA 349 · 6: no se vuelve a aplicar.';
  end if;
  raise notice 'PRUEBA 349 · 6: y se vuelve a aplicar.';
end $$;

rollback;
