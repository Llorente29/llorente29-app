-- ============================================================================
-- PRUEBA (staging) · B02 · T4 (0220): «Espera el extracto» y el punto de
-- partida del cierre. Todo en una transacción con ROLLBACK. Ejecuta los
-- ficheros DE VERDAD (\ir): la tanda y su vuelta atrás. Un banco INVENTADO
-- en la empresa A, con su 572 propia, para no mezclarse con lo que
-- dejan las e2e en los bancos de la semilla. Su IBAN, inventado (mod 97 válido).
--
--   1. Antes de la 0220, bank_movement no admite «espera_extracto».
--   2. Con la 0220, bank_proponer lo acepta (y sigue rechazando lo demás) y el
--      movimiento queda en «espera_extracto», con su porqué y su propuesta.
--   3. _bank_mes_estado (por bank_meses_estado, como la pantalla):
--      (a) octubre, con corte el 01/10: parte del saldo del EXTRACTO a 30/09
--          (0,01), no del contable (290,01), y devuelve los dos en «apertura»;
--      (b) cuenta el que espera en «sueltos» y en «esperan», con «···0921»;
--      (c) con el corte el 02/10 no hay extracto a la víspera: el contable de
--          siempre, y «apertura» lo dice (saldo_banco null);
--      (d) septiembre, antes del corte: lo mismo que con la 0150, sin apertura.
--   4. bank_mes_cerrar ve lo mismo: con el traspaso sin casar no cierra, y la
--      diferencia es la del extracto, no la del contable.
--   5. La vuelta atrás: lo que esperaba queda por aclarar y en el registro,
--      el CHECK vuelve a sus siete estados y bank_proponer y _bank_mes_estado
--      a su cuerpo de la 0110 y la 0150 byte a byte (md5 de producción).
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

create temp table _r (que text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

-- ── 0 · Siembra (como el dueño): el banco inventado, su 572 y su apertura ───
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
        t constant uuid := 'b0200000-0000-4000-8000-0000000000e1'; v_ca uuid;
begin
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, keywords, kind, status, is_common, source, created_by_name)
  select ca.account_id, ca.company_id, ca.plan, '57200921', ca.template_code, 'Bancos · Banco B02 Espera', 'Banco B02 Espera', ca.keywords, ca.kind, ca.status, ca.is_common, ca.source, 'Prueba B02'
    from public.company_account ca
   where ca.company_id = emp and ca.code = '57200001'
     and not exists (select 1 from public.company_account y where y.company_id = emp and y.code = '57200921');
  select id into v_ca from public.company_account where company_id = emp and code = '57200921';
  if v_ca is null then raise exception 'PRUEBA B02 · 0220 · 0: la empresa A no tiene la 57200001 de la que copiar.'; end if;
  insert into public.treasury_account (id, account_id, company_id, kind, name, iban, pgc_hint, is_default, is_active)
  values (t, a, emp, 'bank', 'Banco B02 · Espera', 'ES4001829109210000000921', '572', false, true);
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (a, emp, v_ca, 'bank_account', t::text, 'principal', 'manual');
  -- El contable a 30/09 (290,01), distinto del extracto (0,01): como ···4525 en producción.
  perform public._journal_entry_proponer(emp,
    jsonb_build_object('fecha', '2026-09-30', 'series', 3, 'concepto', 'Saldo inicial del banco · Banco B02 Espera',
      'source_type', 'opening', 'source_id', t, 'confianza', 'seguro', 'porque', 'Prueba B02: el contable inventado el 30/09.'),
    jsonb_build_array(jsonb_build_object('cuenta', '57200921', 'debe', 290.01, 'haber', 0, 'comun', true),
                      jsonb_build_object('cuenta', '10000000', 'debe', 0, 'haber', 290.01, 'comun', true)),
    '{}', 'Prueba B02', null);
  insert into public.bank_settings (company_id, account_id, cutover_date) values (emp, a, '2026-10-01')
  on conflict (company_id) do update set cutover_date = excluded.cutover_date;
  raise notice '0 · banco inventado con su 572 (57200921), contable 290,01 a 30/09 y corte el 01/10';
end $$;

-- ── 1 · Antes de la 0220, «espera_extracto» no entra ───────────────────────
do $$
declare v_ok boolean := false;
begin
  begin
    update public.bank_movement set status = 'espera_extracto' where id = (select id from public.bank_movement limit 1);
    if not found then v_ok := true; end if;  -- staging sin movimientos: nada que comprobar aquí, lo dice el paso 5
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA B02 · 0220 · 1: el CHECK ya admitía «espera_extracto» antes de la tanda.'; end if;
  raise notice '1 · antes de la 0220, el CHECK rechaza «espera_extracto»';
end $$;

\ir ../../migrations/20261101T0220_b02_espera_extracto.sql

-- ── 2 · Como USUARIO: el extracto de octubre y el traspaso que espera ──────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare t constant uuid := 'b0200000-0000-4000-8000-0000000000e1'; m uuid; v_ok boolean := false;
begin
  perform public.bank_importar(t, 'fichero', 'norma43', 'espera-oct.n43', repeat('e', 64), '2026-10-01', '2026-10-31', 0.01, -9.99, null, null,
    '[{"fecha":"2026-10-05","importe":-10.00,"concepto_banco":"TRASPASO A CUENTA PROPIA INVENTADA","comun":"04","huella":"b02e-1","huella_suave":"b02es-1"}]');
  select id into m from public.bank_movement where treasury_account_id = t and fingerprint = 'b02e-1';
  insert into _r values ('m', m);
  begin perform public.bank_proponer(m, 'otra_cosa', 'duda', 'x', '{}');
  exception when others then v_ok := sqlerrm like 'Estado de propuesta no válido%'; end;
  if not v_ok then raise exception 'PRUEBA B02 · 0220 · 2: bank_proponer aceptó un estado inventado.'; end if;
  perform public.bank_proponer(m, 'espera_extracto', 'duda',
    'El banco lo llama traspaso y aún no está subido el extracto de ···0921 de esos días: cuando lo subas, le busco su pareja.',
    '{"que":"Traspaso a tu cuenta ···0921","origen":"traspaso","esperaExtracto":"···0921"}');
  if (select row(status, confidence, proposal->>'esperaExtracto')::text from public.bank_movement where id = m) <> '(espera_extracto,duda,···0921)' then
    raise exception 'PRUEBA B02 · 0220 · 2: el movimiento no quedó esperando el extracto: %', (select row(status, confidence, proposal)::text from public.bank_movement where id = m);
  end if;
  raise notice '2 · bank_proponer rechaza un estado inventado y deja el traspaso en «espera_extracto» (···0921)';
end $$;

-- ── 3 · _bank_mes_estado, por bank_meses_estado ─────────────────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; t constant uuid := 'b0200000-0000-4000-8000-0000000000e1'; e jsonb;
begin
  -- (a) y (b): octubre con corte el 01/10.
  select estado into e from public.bank_meses_estado(emp, '2026-10-01') where treasury_account_id = t;
  if (e->>'saldo_banco')::numeric <> -9.99 or (e->>'saldo_contable')::numeric <> 290.01 or (e->>'saldo_libro')::numeric <> 0.01
     or (e->>'diferencia')::numeric <> -10.00 then
    raise exception 'PRUEBA B02 · 0220 · 3a: octubre no parte del extracto a 30/09: %', e;
  end if;
  if e->'apertura' <> '{"fecha": "2026-09-30", "saldo_banco": 0.01, "saldo_libro": 290.01}'::jsonb then
    raise exception 'PRUEBA B02 · 0220 · 3a: la apertura no dice los dos saldos: %', e->'apertura';
  end if;
  if (e->>'sueltos')::int <> 1 or (e->>'esperan')::int <> 1 or e->'esperan_de' <> '["···0921"]'::jsonb then
    raise exception 'PRUEBA B02 · 0220 · 3b: el que espera no cuenta como debe: %', e;
  end if;
  raise notice '3a/3b · octubre: banco −9,99, contabilidad 0,01 (extracto a 30/09; el contable dice 290,01), diferencia −10,00, 1 suelto que espera ···0921';
end $$;

-- (c): con el corte el 02/10 no hay extracto que empiece ese día ni que acabe el 01/10.
reset role;
update public.bank_settings set cutover_date = '2026-10-02' where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
set local role authenticated;
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; t constant uuid := 'b0200000-0000-4000-8000-0000000000e1'; e jsonb;
begin
  select estado into e from public.bank_meses_estado(emp, '2026-10-01') where treasury_account_id = t;
  if (e->>'saldo_libro')::numeric <> 290.01 or e->'apertura'->>'saldo_banco' is not null or (e->'apertura'->>'saldo_libro')::numeric <> 290.01
     or e->'apertura'->>'fecha' <> '2026-10-01' then
    raise exception 'PRUEBA B02 · 0220 · 3c: sin extracto a la víspera no parte del contable: %', e;
  end if;
  raise notice '3c · corte el 02/10, sin extracto a la víspera: parte del contable (290,01) y la apertura lo dice';
end $$;
reset role;
update public.bank_settings set cutover_date = '2026-10-01' where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
set local role authenticated;

-- (d): septiembre, antes del corte.
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; t constant uuid := 'b0200000-0000-4000-8000-0000000000e1'; e jsonb;
begin
  select estado into e from public.bank_meses_estado(emp, '2026-09-01') where treasury_account_id = t;
  if (e->>'saldo_libro')::numeric <> 290.01 or e->'apertura' <> 'null'::jsonb or (e->>'esperan')::int <> 0 or e->'esperan_de' <> '[]'::jsonb then
    raise exception 'PRUEBA B02 · 0220 · 3d: septiembre no es lo de siempre: %', e;
  end if;
  raise notice '3d · septiembre, antes del corte: lo de siempre, sin apertura ni esperas';
end $$;

-- ── 4 · bank_mes_cerrar ve lo mismo ─────────────────────────────────────────
do $$
declare t constant uuid := 'b0200000-0000-4000-8000-0000000000e1'; v_ok boolean := false; v_r jsonb; v_c uuid;
begin
  begin perform public.bank_mes_cerrar(t, '2026-09-01', false, null);
  exception when others then v_ok := sqlerrm like 'Falta el extracto con el saldo de fin de mes%'; end;
  if not v_ok then raise exception 'PRUEBA B02 · 0220 · 4: septiembre, sin extracto, no pidió el extracto.'; end if;
  -- Octubre aún no ha terminado en el reloj de staging (16/10/2026) o sí: según el día, una u otra razón; nunca cierra limpio.
  v_ok := false;
  begin perform public.bank_mes_cerrar(t, '2026-10-01', false, null);
  exception when others then v_ok := sqlerrm like 'El mes aún no ha terminado%' or sqlerrm like 'Quedan 1 movimientos sin casar%'; end;
  if not v_ok then raise exception 'PRUEBA B02 · 0220 · 4: octubre cerró con el traspaso esperando.'; end if;
  if date_trunc('month', now() at time zone 'Europe/Madrid')::date > '2026-10-01' then
    v_r := public.bank_mes_cerrar(t, '2026-10-01', true, 'Prueba: el traspaso espera el extracto de la otra cuenta');
    v_c := (v_r->>'cierre')::uuid;
    if (select row(bank_balance, book_balance, difference, loose_count)::text from public.bank_month_close where id = v_c) <> '(-9.99,0.01,-10.00,1)' then
      raise exception 'PRUEBA B02 · 0220 · 4: el cierre a sabiendas no guardó el punto de partida del extracto.';
    end if;
  end if;
  raise notice '4 · bank_mes_cerrar: septiembre pide el extracto; octubre no cierra limpio con el traspaso esperando';
end $$;

-- ── 5 · La vuelta atrás (como el dueño) ─────────────────────────────────────
reset role;
\ir ../../vuelta-atras/20261101T0220_b02_espera_extracto.down.sql
do $$
declare m uuid := (select id from _r where que = 'm'); v_ok boolean := false;
begin
  if (select status from public.bank_movement where id = m) <> 'por_aclarar' then
    raise exception 'PRUEBA B02 · 0220 · 5: lo que esperaba no quedó por aclarar.';
  end if;
  if not exists (select 1 from public.bank_activity_log where movement_id = m and action = 'por_aclarar' and summary like 'Vuelta atrás B02 · 0220%') then
    raise exception 'PRUEBA B02 · 0220 · 5: la vuelta atrás no quedó en el registro.';
  end if;
  begin update public.bank_movement set status = 'espera_extracto' where id = m;
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA B02 · 0220 · 5: el CHECK sigue admitiendo «espera_extracto».'; end if;
  if (select md5(prosrc) from pg_proc where oid = 'public.bank_proponer(uuid, text, text, text, jsonb)'::regprocedure) <> '6213b8534c5dcf13f850f8181d5a630c'
     or (select md5(prosrc) from pg_proc where oid = 'public._bank_mes_estado(uuid, date)'::regprocedure) <> 'a4c3169e7d5755d8ca62cabcd95a5de3' then
    raise exception 'PRUEBA B02 · 0220 · 5: bank_proponer o _bank_mes_estado no volvieron a su cuerpo de antes.';
  end if;
  raise notice '5 · vuelta atrás: por aclarar y en el registro; CHECK de siete estados; bank_proponer y _bank_mes_estado byte a byte (md5 de producción)';
end $$;

rollback;
