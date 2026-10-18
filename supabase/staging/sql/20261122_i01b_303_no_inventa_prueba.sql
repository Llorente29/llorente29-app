-- supabase/staging/sql/20261122_i01b_303_no_inventa_prueba.sql
--
-- SOLO STAGING. Prueba de 20261122T0240_i01b_303_no_inventa, con \i dentro de
-- la transacción y ROLLBACK: staging no cambia. Nombra lo que cambia en
-- caliente: public.conta_impuesto_303_calcular, public.conta_impuesto_303_fichero
-- y public.conta_impuesto_fuera; y lo nuevo, public.conta_impuesto_casillas_poner.
--
-- Contra el 3T de 2026 de la empresa A, que en staging tiene el libro de IVA
-- del periodo vacío y la 472 del diario con IVA (si eso cambia, la prueba lo
-- dice y para: mide lo que cree medir, regla 5).
--   1. Calcular: «book_vs_303» en error (motivo libro_vacio, con la 477 y la
--      472), SIN resultado ni importe ni casillas calculadas, sin la
--      comparación del diario, y la [110] pedida en error (no hay 2T presentado).
--   2. Con eso no se revisa, no sale el fichero y no se apunta como presentado
--      fuera; y el aviso de la 0150 no se puede «dar por bueno» (es error).
--   3. Las casillas a mano: una que no es del 303 para; unas que no cuadran
--      paran; una negativa en la [110] para; B no escribe en A.
--   4. Las del justificante, con los TOTALES de la gestoría del 3T de Foodint
--      (solo totales: [27] 9.855,66 · [45] 13.579,10 · [110] 3.796,17 · [78] 0 ·
--      [87] 3.796,17 · [71] −3.723,44): sale 3.723,44 € a compensar, la [110]
--      en ok, el libro sigue en error (no se presenta desde Sumied ni sale el
--      fichero) y «Ya lo presenté fuera» SÍ se apunta.
--   5. El 4T arrastra lo de antes: [110] = [87] del 3T + su resultado = 7.519,61.
--   6. Un aviso sin dar por bueno para el fichero; dado por bueno, sale.
--   7. Quitar una casilla a mano (null) la quita, y la [110] vuelve a pedirse.
--   8. Su vuelta atrás quita casillas_poner y devuelve las tres de antes (la
--      [110] vuelve a ser aviso); y se vuelve a aplicar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA no inventa: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261122T0240_i01b_303_no_inventa.sql

create temporary table _p (k text primary key, val text) on commit drop;
grant all on _p to authenticated;

select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- ── 1 · El libro vacío con el diario lleno: no hay resultado ────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; r public.tax_return; k public.tax_return_check; n int;
begin
  if not exists (select 1 from public.tax_obligation where company_id = v_a and valid_to is null and active and form_code = '303') then
    perform public.conta_impuesto_obligaciones_calcular(v_a);
  end if;
  -- Lo que la prueba necesita: el 3T sin libro y con IVA en el diario, y el 2T sin presentar.
  if exists (select 1 from public.vat_book_entry v where v.company_id = v_a and v.voided_at is null
              and case when v.book in ('received', 'investment') then coalesce(v.received_date, v.issue_date) else coalesce(v.operation_date, v.issue_date) end
                  between '2026-07-01' and '2026-09-30') then
    raise exception 'PRUEBA no inventa · 1: el 3T de A ya tiene libro de IVA en staging: esta prueba ya no mide el libro vacío. Hay que elegir otro periodo.';
  end if;
  if exists (select 1 from public.tax_return where company_id = v_a and form_code = '303' and fiscal_year = 2026 and period = '2T' and status in ('filed', 'booked', 'paid', 'offset', 'refunded')) then
    raise exception 'PRUEBA no inventa · 1: el 2T de A ya está presentado en staging: la [110] ya no se pide.';
  end if;
  c := public.conta_impuesto_303_calcular(v_a, 2026, '3T');
  insert into _p values ('decl', c->>'declaracion');
  select * into r from public.tax_return where id = (c->>'declaracion')::uuid;
  select * into k from public.tax_return_check where tax_return_id = r.id and check_key = 'book_vs_303';
  if k.result <> 'error' or k.detail->'no_sabe'->0->>'motivo' <> 'libro_vacio' or (k.detail->'no_sabe'->0->>'cuenta_472')::numeric = 0 then
    raise exception 'PRUEBA no inventa · 1: el libro vacío sale % (%).', k.result, k.detail;
  end if;
  if r.result_kind is not null or r.amount is not null or (c->>'sabido')::boolean or c->>'importe' is not null then
    raise exception 'PRUEBA no inventa · 1: sin libro sale un resultado: % % (devuelve %).', r.result_kind, r.amount, c;
  end if;
  select count(*) into n from public.tax_return_box where tax_return_id = r.id and origin = 'calculated';
  if n > 0 then raise exception 'PRUEBA no inventa · 1: sin libro quedan % casillas calculadas (un cero parece un dato).', n; end if;
  if exists (select 1 from public.tax_return_check where tax_return_id = r.id and check_key = 'ledger_477_472') then
    raise exception 'PRUEBA no inventa · 1: con el libro vacío sigue la comparación con el diario.';
  end if;
  if (select result from public.tax_return_check where tax_return_id = r.id and check_key = 'previous_offset') <> 'error' then
    raise exception 'PRUEBA no inventa · 1: sin el 2T presentado, la [110] no se pide en error.';
  end if;
  raise notice 'PRUEBA no inventa · 1: sin resultado ni casillas. %', k.title;
end $$;

-- ── 2 · Sin resultado: ni revisar, ni dar por bueno, ni «fuera» ─────────────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl'); v_k uuid;
begin
  begin
    perform public.conta_impuesto_revisar(v_r);
    raise exception 'PRUEBA no inventa · 2: se revisa un 303 sin libro.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 2: revisar para: %', sqlerrm;
  end;
  select id into v_k from public.tax_return_check where tax_return_id = v_r and check_key = 'book_vs_303';
  begin
    perform public.conta_impuesto_aviso_aceptar(v_k, 'prueba');
    raise exception 'PRUEBA no inventa · 2: se da por bueno el libro vacío.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 2: dar por bueno para: %', sqlerrm;
  end;
end $$;
reset role;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl');
begin
  begin
    perform public.conta_impuesto_303_fichero(v_r);
    raise exception 'PRUEBA no inventa · 2: sale el fichero de un 303 sin libro.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 2: el fichero para: %', sqlerrm;
  end;
  begin
    perform public.conta_impuesto_fuera(v_r, 'c01a0000-0000-4000-8000-0000000000a1', 'ABCDEFGH12345678', false, null, now(), null);
    raise exception 'PRUEBA no inventa · 2: se apunta fuera un 303 sin libro y sin casillas.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 2: «fuera» para: %', sqlerrm;
  end;
end $$;
set local role authenticated;

-- ── 3 · Casillas a mano que no valen ─────────────────────────────────────────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl');
begin
  begin
    perform public.conta_impuesto_casillas_poner(v_r, '{"65": 50}', 'prueba');
    raise exception 'PRUEBA no inventa · 3: se escribe la [65].';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 3: %', sqlerrm;
  end;
  begin
    perform public.conta_impuesto_casillas_poner(v_r, '{"27": 9855.66, "45": 13579.10, "78": 0, "71": -3700}', 'prueba');
    raise exception 'PRUEBA no inventa · 3: se escriben casillas que no cuadran.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 3: %', sqlerrm;
  end;
  begin
    perform public.conta_impuesto_casillas_poner(v_r, '{"110": -1}', 'prueba');
    raise exception 'PRUEBA no inventa · 3: se escribe una [110] negativa.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 3: %', sqlerrm;
  end;
  begin
    perform public.conta_impuesto_casillas_poner(v_r, '{"110": 0}', '  ');
    raise exception 'PRUEBA no inventa · 3: se escribe sin motivo.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 3: %', sqlerrm;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl');
begin
  perform public.conta_impuesto_casillas_poner(v_r, '{"110": 0}', 'prueba');
  raise exception 'PRUEBA no inventa · 3: B escribe casillas de A.';
exception when insufficient_privilege then raise notice 'PRUEBA no inventa · 3: B no escribe en A.';
end $$;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- ── 4 · Las del justificante (los totales de la gestoría) ───────────────────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl'); v jsonb; r public.tax_return;
begin
  v := public.conta_impuesto_casillas_poner(v_r,
    '{"27": 9855.66, "45": 13579.10, "110": 3796.17, "78": 0, "87": 3796.17, "71": -3723.44}', 'Casillas del justificante (presentado fuera)');
  select * into r from public.tax_return where id = v_r;
  if r.result_kind <> 'to_offset' or r.amount <> 3723.44 then
    raise exception 'PRUEBA no inventa · 4: con el justificante sale % % (esperado to_offset 3723.44).', r.result_kind, r.amount;
  end if;
  if (select result from public.tax_return_check where tax_return_id = v_r and check_key = 'previous_offset') <> 'ok'
     or (select result from public.tax_return_check where tax_return_id = v_r and check_key = 'book_vs_303') <> 'error' then
    raise exception 'PRUEBA no inventa · 4: con el justificante, la [110] o el libro no salen como deben.';
  end if;
  if (select count(*) from public.tax_return_box where tax_return_id = v_r and origin = 'manual' and manual_reason like 'Casillas del justificante%') <> 6 then
    raise exception 'PRUEBA no inventa · 4: no están las seis casillas a mano con su motivo.';
  end if;
  if not exists (select 1 from public.tax_return_event where tax_return_id = v_r and kind = 'note' and message like '%escribió a mano%') then
    raise exception 'PRUEBA no inventa · 4: no queda en el registro quién escribió las casillas.';
  end if;
  raise notice 'PRUEBA no inventa · 4: %', v->>'mensaje';
end $$;
reset role;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl'); v jsonb;
begin
  begin
    perform public.conta_impuesto_303_fichero(v_r);
    raise exception 'PRUEBA no inventa · 4: sale el fichero con el libro vacío (aunque haya casillas a mano).';
  exception when invalid_parameter_value then null;
  end;
  v := public.conta_impuesto_fuera(v_r, 'c01a0000-0000-4000-8000-0000000000a1', 'ABCDEFGH12345678', false, null, now(), null);
  if (select status from public.tax_return where id = v_r) <> 'filed' then raise exception 'PRUEBA no inventa · 4: «fuera» no deja presentado.'; end if;
  raise notice 'PRUEBA no inventa · 4: %', v->>'mensaje';
end $$;
set local role authenticated;

-- ── 5 · El 4T arrastra lo de antes ───────────────────────────────────────────
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb; k public.tax_return_check;
begin
  c := public.conta_impuesto_303_calcular(v_a, 2026, '4T');
  select * into k from public.tax_return_check where tax_return_id = (c->>'declaracion')::uuid and check_key = 'previous_offset';
  if k.result <> 'ok' or (k.detail->>'casilla_110')::numeric <> 7519.61 then
    raise exception 'PRUEBA no inventa · 5: el 4T arrastra % (%), esperado 7519.61 en ok.', k.detail->>'casilla_110', k.result;
  end if;
  insert into _p values ('decl4', c->>'declaracion');
  raise notice 'PRUEBA no inventa · 5: %', k.title;
end $$;

-- ── 6 · Un aviso sin mirar para el fichero ───────────────────────────────────
reset role;
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl4'); v_k uuid;
begin
  -- Solo aquí, dentro de la transacción: el 4T sin errores y con un aviso.
  update public.tax_return_check set result = 'ok' where tax_return_id = v_r and result = 'error';
  update public.tax_return set result_kind = 'zero', amount = 0 where id = v_r and result_kind is null;
  update public.tax_return_check set result = 'warning', accepted_at = null where tax_return_id = v_r and check_key = 'out_of_period' returning id into v_k;
  update public.tax_return_check set result = 'ok' where tax_return_id = v_r and result = 'warning' and id <> v_k;
  begin
    perform public.conta_impuesto_303_fichero(v_r);
    raise exception 'PRUEBA no inventa · 6: sale el fichero con un aviso sin mirar.';
  exception when invalid_parameter_value then raise notice 'PRUEBA no inventa · 6: %', sqlerrm;
  end;
  update public.tax_return_check set accepted_at = now(), accepted_by_name = 'Prueba', accepted_reason = 'prueba' where id = v_k;
  perform public.conta_impuesto_303_fichero(v_r);
  raise notice 'PRUEBA no inventa · 6: dado por bueno, el fichero sale.';
end $$;
set local role authenticated;

-- ── 7 · Quitar una casilla a mano ────────────────────────────────────────────
do $$
declare v_r uuid := (select val::uuid from _p where k = 'decl4');
begin
  perform public.conta_impuesto_casillas_poner(v_r, '{"110": 0}', 'prueba');
  if (select result from public.tax_return_check where tax_return_id = v_r and check_key = 'previous_offset') <> 'ok'
     or (select origin from public.tax_return_box where tax_return_id = v_r and box = '110') <> 'manual' then
    raise exception 'PRUEBA no inventa · 7: la [110] a mano no queda.';
  end if;
  perform public.conta_impuesto_casillas_poner(v_r, '{"110": null}', 'prueba');
  if exists (select 1 from public.tax_return_box where tax_return_id = v_r and box = '110' and origin = 'manual') then
    raise exception 'PRUEBA no inventa · 7: null no quita la [110] a mano.';
  end if;
  raise notice 'PRUEBA no inventa · 7: la [110] a mano se pone y se quita (y vuelve a salir del 3T).';
end $$;

-- ── 8 · Vuelta atrás, y otra vez hacia delante ───────────────────────────────
reset role;
\i supabase/vuelta-atras/20261122T0240_i01b_303_no_inventa.down.sql
do $$
declare v_a constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; c jsonb;
begin
  if to_regprocedure('public.conta_impuesto_casillas_poner(uuid, jsonb, text)') is not null then
    raise exception 'PRUEBA no inventa · 8: la vuelta atrás no quita casillas_poner.';
  end if;
  if position('libro_vacio' in pg_get_functiondef('public.conta_impuesto_303_calcular(uuid, int, text)'::regprocedure)) > 0
     or position('aviso sin mirar' in pg_get_functiondef('public.conta_impuesto_303_fichero(uuid)'::regprocedure)) > 0
     or position('casillas del justificante' in pg_get_functiondef('public.conta_impuesto_fuera(uuid, uuid, text, boolean, text, timestamptz, uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA no inventa · 8: la vuelta atrás deja algo de la 0240.';
  end if;
  raise notice 'PRUEBA no inventa · 8: vuelta atrás hecha: las tres como antes y sin casillas_poner.';
end $$;
\i supabase/migrations/20261122T0240_i01b_303_no_inventa.sql
do $$ begin
  if to_regprocedure('public.conta_impuesto_casillas_poner(uuid, jsonb, text)') is null then
    raise exception 'PRUEBA no inventa · 8: no se vuelve a aplicar.';
  end if;
  raise notice 'PRUEBA no inventa · 8: y se vuelve a aplicar.';
end $$;

rollback;
