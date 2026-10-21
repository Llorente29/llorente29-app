-- supabase/staging/sql/20261122_i01b_declaracion_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0200_i01b_declaracion (la 0100 a la 0150 y
-- la 0190 ya están en staging de verdad), con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. Como usuario de la empresa A y de la cuenta B.
--
--   1. Sin calcular (1T de 2027): el periodo, sus dos plazos y la declaración vacía.
--   2. Calculado el 3T: la declaración, sus casillas (la [71] con el
--      resultado), lo comprobado, quién presenta y los bancos de A (los
--      cuatro últimos del IBAN, nunca entero).
--   3. El pago: «pagar yo» se guarda y queda en el registro con quién;
--      domiciliar lo que no sale a pagar, o pedir la devolución de lo que no
--      sale a devolver, para con su frase.
--   4. B no ve ni decide el pago de A.
--   5. Su vuelta atrás quita las dos funciones, y se puede volver a aplicar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA declaración: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

select to_regprocedure('public.conta_impuesto_plazo_si_hay(text, text, int, text)') is null as falta_0190 \gset
\if :falta_0190
\echo '>>> Staging aún no tiene la 0190 (el calendario): se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261122T0190_i01b_calendario.sql
\endif
\i supabase/migrations/20261122T0200_i01b_declaracion.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · Sin calcular (el 1T de 2027: nadie lo ha calculado todavía) ─────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v jsonb;
begin
  if not exists (select 1 from public.tax_obligation where company_id = v_a and valid_to is null and active and form_code = '303') then
    perform public.conta_impuesto_obligaciones_calcular(v_a);
  end if;
  v := public.conta_impuesto_declaracion_ver(v_a, 2027, '1T');
  if jsonb_typeof(v->'declaracion') <> 'null' or v->>'presentacion' <> '2027-04-20' or v->>'domiciliacion' <> '2027-04-15'
     or v->>'desde' <> '2027-01-01' or v->>'hasta' <> '2027-03-31' or not (v->>'presenta_303')::boolean then
    raise exception 'PRUEBA declaración · 1: sin calcular sale %.', v;
  end if;
  raise notice 'PRUEBA declaración · 1: sin calcular, del % al %, hasta el % (domiciliado, el %).', v->>'desde', v->>'hasta', v->>'presentacion', v->>'domiciliacion';
end $$;

-- ── 2 · Calculado ────────────────────────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; v jsonb; n int;
begin
  c := public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  insert into _p values ('decl', c->>'declaracion');
  v := public.conta_impuesto_declaracion_ver(v_a, 2026, '3T');
  if v->'declaracion'->>'id' <> c->>'declaracion' or v->'declaracion'->>'estado' <> 'draft' or v->'declaracion'->>'resultado' <> c->>'resultado' then
    raise exception 'PRUEBA declaración · 2: la declaración sale %.', v->'declaracion';
  end if;
  if not exists (select 1 from jsonb_array_elements(v->'casillas') x where x->>'casilla' = '71')
     or jsonb_array_length(v->'comprobaciones') = 0 then
    raise exception 'PRUEBA declaración · 2: faltan la [71] o lo comprobado (% casillas, % comprobaciones).', jsonb_array_length(v->'casillas'), jsonb_array_length(v->'comprobaciones');
  end if;
  select count(*) into n from jsonb_array_elements(v->'bancos') x where length(x->>'final') <> 4 or x ? 'iban';
  if n > 0 then raise exception 'PRUEBA declaración · 2: % bancos salen con algo más que los cuatro últimos del IBAN.', n; end if;
  if v->'presentador'->>'modo' not in ('company', 'advisor') then raise exception 'PRUEBA declaración · 2: quién presenta sale %.', v->'presentador'; end if;
  raise notice 'PRUEBA declaración · 2: % (% %), % casillas, % comprobaciones, % bancos.', v->'declaracion'->>'estado_texto',
    v->'declaracion'->>'resultado', v->'declaracion'->>'importe', jsonb_array_length(v->'casillas'), jsonb_array_length(v->'comprobaciones'), jsonb_array_length(v->'bancos');
end $$;

-- ── 3 · El pago ──────────────────────────────────────────────────────────────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl'); v jsonb; r public.tax_return; v_banco uuid;
begin
  v := public.conta_impuesto_pago_poner(v_r, 'self', null);
  select * into r from public.tax_return where id = v_r;
  if r.payment_mode is not null or r.payment_treasury_account_id is not null
     or not exists (select 1 from public.tax_return_event where tax_return_id = v_r and kind = 'note' and message = v->>'mensaje' and by_name is not null) then
    raise exception 'PRUEBA declaración · 3: «pagar yo» deja %/% sin su apunte.', r.payment_mode, r.payment_treasury_account_id;
  end if;
  select id into v_banco from public.treasury_account where company_id = r.company_id and kind = 'bank' and iban is not null limit 1;
  if r.result_kind <> 'to_pay' then
    begin
      perform public.conta_impuesto_pago_poner(v_r, 'direct_debit', v_banco);
      raise exception 'PRUEBA declaración · 3: se domicilia un 303 que sale «%».', r.result_kind;
    exception when invalid_parameter_value then
      raise notice 'PRUEBA declaración · 3: domiciliar lo que sale «%» para: %', r.result_kind, sqlerrm;
    end;
  end if;
  if r.result_kind <> 'to_refund' then
    begin
      perform public.conta_impuesto_pago_poner(v_r, 'refund', v_banco);
      raise exception 'PRUEBA declaración · 3: se pide devolver un 303 que sale «%».', r.result_kind;
    exception when invalid_parameter_value then
      raise notice 'PRUEBA declaración · 3: pedir la devolución de lo que sale «%» para: %', r.result_kind, sqlerrm;
    end;
  end if;
  raise notice 'PRUEBA declaración · 3: %', v->>'mensaje';
end $$;

-- ── 4 · B no ve ni decide ────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v_r uuid := (select val::uuid from _p where k = 'decl');
begin
  begin
    perform public.conta_impuesto_declaracion_ver(v_a, 2026, '3T');
    raise exception 'PRUEBA declaración · 4: B ve la declaración de A.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_impuesto_pago_poner(v_r, 'self', null);
    raise exception 'PRUEBA declaración · 4: B decide el pago de A.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA declaración · 4: B no ve ni decide el pago de A.';
end $$;

-- ── 5 · Su vuelta atrás ──────────────────────────────────────────────────────
reset role;
\i supabase/vuelta-atras/20261122T0200_i01b_declaracion.down.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_declaracion_ver(uuid, int, text)') is not null or to_regprocedure('public.conta_impuesto_pago_poner(uuid, text, uuid)') is not null then
    raise exception 'PRUEBA declaración · 5: la vuelta atrás deja funciones de la 0200.';
  end if;
  raise notice 'PRUEBA declaración · 5: vuelta atrás, fuera las dos funciones.';
end $$;
\i supabase/migrations/20261122T0200_i01b_declaracion.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_declaracion_ver(uuid, int, text)') is null then raise exception 'PRUEBA declaración · 5: no se vuelve a aplicar.'; end if;
  raise notice 'PRUEBA declaración · 5: y otra vez delante.';
end $$;

\echo '>>> Prueba de la declaración (0200) en verde. ROLLBACK: no queda nada.'
rollback;
