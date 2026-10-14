-- ============================================================================
-- PRUEBA (staging) · B01 · respuesta 4 y tarea 6 (20261101T0150 y los cambios
-- de bank_casar / bank_importar en la 0110). Todo en una transacción con
-- ROLLBACK: no deja nada. Fichero entero y como USUARIO (el administrador de
-- A con su rol «authenticated»). Datos inventados. Usa los bancos de la
-- semilla B01 (con su apertura a 30/09).
--
--   1. Alias: el nombre corto se guarda; de más de 24 letras, no.
--   2. Reglas: un «Sí» a lo que propone no cuenta; casar con otra cosa es una
--      corrección; a la segunda se apaga sola y lo dice en «Lo que ha hecho Folvy».
--   3. Cierre del mes: el mes en curso no se cierra; con un movimiento sin
--      casar, no, salvo a sabiendas y con su porqué; dos veces el mismo mes,
--      no; reabrir pide porqué; casado lo suelto, cierra solo con saldo igual.
--   4. Agente: cada pasada queda con su resumen y en «Lo que ha hecho Folvy»;
--      tras una pasada hoy, ya no toca la del día.
--   5. Agregador: el mismo movimiento por el agregador y por Norma 43 es el
--      mismo (no entra dos veces); entre dos ficheros sigue preguntando.
--   6. Consentimiento: caduca en 5 días → avisa; en 30 → aún no.
--   7. RLS: la cuenta de B no ve cierres, pasadas ni conexiones de A, ni cierra.
-- ============================================================================

begin;

create temp table _r (que text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

-- ── 0 · Siembra (como el dueño): dos conexiones del agregador para Sur ─────
do $$
declare a constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
        sur constant uuid := 'b0100000-0000-4000-8000-0000000000b2';
begin
  if not exists (select 1 from public.journal_entry where source_type = 'opening' and source_id = 'b0100000-0000-4000-8000-0000000000b3') then
    raise exception 'PRUEBA B01 R4 · 0: falta la apertura de la semilla B01 (seed_b01_staging.sql después de la 0150).';
  end if;
  insert into public.bank_aggregator_link (account_id, company_id, treasury_account_id, provider, external_account_id, consent_id, consent_valid_until)
  values (a, emp, sur, 'simulado', 'sim-prueba-1', 'consent-prueba-1', now() + interval '5 days'),
         (a, emp, sur, 'enable_banking', 'eb-prueba-2', 'consent-prueba-2', now() + interval '30 days');
  raise notice '0 · apertura de la semilla presente; dos conexiones del agregador (5 y 30 días)';
end $$;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ── 1 · Alias ───────────────────────────────────────────────────────────────
do $$
declare norte constant uuid := 'b0100000-0000-4000-8000-0000000000b1'; v_ok boolean := false;
begin
  perform public.bank_cuenta_alias(norte, '  Norte  ');
  if (select short_name from public.treasury_account where id = norte) <> 'Norte' then raise exception 'PRUEBA B01 R4 · 1: el alias no quedó «Norte».'; end if;
  begin
    perform public.bank_cuenta_alias(norte, repeat('x', 25));
  exception when others then v_ok := sqlerrm like 'El nombre corto, de 24 letras como mucho%';
  end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 1: entró un alias de 25 letras.'; end if;
  perform public.bank_cuenta_alias(norte, '');
  if (select short_name from public.treasury_account where id = norte) is not null then raise exception 'PRUEBA B01 R4 · 1: vaciar el alias no lo quitó.'; end if;
  raise notice '1 · alias guardado sin espacios, de 25 letras rechazado, vacío lo quita';
end $$;

-- ── 2 · Reglas: dos correcciones la apagan ─────────────────────────────────
do $$
declare
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; norte constant uuid := 'b0100000-0000-4000-8000-0000000000b1';
  v_regla uuid; v_r jsonb; m1 uuid; m2 uuid; m3 uuid; v_prop jsonb;
begin
  v_regla := public.bank_regla_guardar(emp, null, 'Cuando el concepto tenga «PAPELERIA PRUEBA» → Comisiones', '{"contiene":"PAPELERIA PRUEBA"}',
                                       '{"cuenta":"62600000"}', 'persona', 'activa');
  v_r := public.bank_importar(norte, 'fichero', 'csv:bbva', 'reglas-r4.xlsx', repeat('7', 64), '2026-09-10', '2026-09-12', null, null, 'El fichero no trae saldos.', null, '[
    {"fecha":"2026-09-10","importe":-10.00,"concepto_banco":"PAPELERIA PRUEBA 1","huella":"r4-1","huella_suave":"r4s-1"},
    {"fecha":"2026-09-11","importe":-11.00,"concepto_banco":"PAPELERIA PRUEBA 2","huella":"r4-2","huella_suave":"r4s-2"},
    {"fecha":"2026-09-12","importe":-12.00,"concepto_banco":"PAPELERIA PRUEBA 3","huella":"r4-3","huella_suave":"r4s-3"}]');
  select id into m1 from public.bank_movement where treasury_account_id = norte and fingerprint = 'r4-1';
  select id into m2 from public.bank_movement where treasury_account_id = norte and fingerprint = 'r4-2';
  select id into m3 from public.bank_movement where treasury_account_id = norte and fingerprint = 'r4-3';
  v_prop := jsonb_build_object('que', 'Comisiones', 'reglaId', v_regla, 'destino', jsonb_build_object('tipo', 'cuenta', 'lineas', jsonb_build_array(jsonb_build_object('cuenta', '62600000', 'importe', 10))));
  perform public.bank_proponer(m1, 'propuesto', 'probable', 'Regla: …', v_prop);
  perform public.bank_proponer(m2, 'propuesto', 'probable', 'Regla: …', v_prop);
  perform public.bank_proponer(m3, 'propuesto', 'probable', 'Regla: …', v_prop);
  -- «Sí» a lo que propone la regla: no es corrección.
  perform public.bank_casar(m1, '{"tipo":"cuenta","lineas":[{"cuenta":"62600000","importe":10}]}', 'probable', 'Regla', '[]', 'persona', v_regla);
  if coalesce((select corrections from public.bank_rule where id = v_regla), 0) <> 0 then raise exception 'PRUEBA B01 R4 · 2: un «Sí» contó como corrección.'; end if;
  -- Otra cosa: una corrección; sigue encendida.
  perform public.bank_casar(m2, '{"tipo":"cuenta","lineas":[{"cuenta":"62900000","importe":11}]}', 'probable', 'Lo dijiste tú', '[]', 'persona', null);
  if (select corrections from public.bank_rule where id = v_regla) <> 1 or (select status from public.bank_rule where id = v_regla) <> 'activa' then
    raise exception 'PRUEBA B01 R4 · 2: la primera corrección no quedó (o la apagó).';
  end if;
  -- La segunda: se apaga sola y lo dice.
  perform public.bank_casar(m3, '{"tipo":"cuenta","lineas":[{"cuenta":"62900000","importe":12}]}', 'probable', 'Lo dijiste tú', '[]', 'persona', null);
  if (select status from public.bank_rule where id = v_regla) <> 'apagada' then raise exception 'PRUEBA B01 R4 · 2: dos correcciones y la regla sigue encendida.'; end if;
  if not exists (select 1 from public.bank_activity_log where movement_id = m3 and action = 'regla' and by_who = 'folvy'
                  and summary like 'He apagado la regla «Cuando el concepto tenga «PAPELERIA PRUEBA»%la has corregido dos veces%') then
    raise exception 'PRUEBA B01 R4 · 2: el apagado no quedó en «Lo que ha hecho Folvy».';
  end if;
  if not exists (select 1 from public.bank_rule_log where rule_id = v_regla and action = 'apagada' and created_by_name = 'Folvy') then
    raise exception 'PRUEBA B01 R4 · 2: el apagado no quedó en el registro de la regla.';
  end if;
  raise notice '2 · un «Sí» no corrige; una corrección la deja encendida; la segunda la apaga, en su registro y en «Lo que ha hecho Folvy»';
end $$;

-- ── 3 · Cierre del mes ──────────────────────────────────────────────────────
do $$
declare
  mercado constant uuid := 'b0100000-0000-4000-8000-0000000000b3'; v_r jsonb; v_ok boolean := false; m uuid; v_c uuid;
begin
  -- Septiembre de Mercado: empieza en la apertura (2.500,00) y un pago de 100,00 → el banco dice 2.400,00.
  v_r := public.bank_importar(mercado, 'fichero', 'norma43', 'mercado-sept.n43', repeat('8', 64), '2026-09-01', '2026-09-30', 2500.00, 2400.00, null, null,
    '[{"fecha":"2026-09-20","importe":-100.00,"concepto_banco":"RECIBO PRUEBA CIERRE","comun":"03","huella":"r4c-1","huella_suave":"r4cs-1"}]');
  select id into m from public.bank_movement where treasury_account_id = mercado and fingerprint = 'r4c-1';
  -- El mes en curso no se cierra.
  begin perform public.bank_mes_cerrar(mercado, date_trunc('month', now())::date, false, null);
  exception when others then v_ok := sqlerrm like 'El mes aún no ha terminado%'; end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 3: se cerró el mes en curso.'; end if;
  -- Con un movimiento sin casar, no.
  v_ok := false;
  begin perform public.bank_mes_cerrar(mercado, '2026-09-01', false, null);
  exception when others then v_ok := sqlerrm like 'Quedan 1 movimientos sin casar en «Banco B01 · Mercado» (−100,00 €%'; end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 3: se cerró septiembre con un movimiento sin casar.'; end if;
  -- A sabiendas sin porqué, tampoco.
  v_ok := false;
  begin perform public.bank_mes_cerrar(mercado, '2026-09-01', true, '  ');
  exception when others then v_ok := sqlerrm like 'Cerrar a sabiendas pide el porqué%'; end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 3: se cerró a sabiendas sin porqué.'; end if;
  -- A sabiendas con porqué: sí, y queda lo que explica la diferencia.
  v_r := public.bank_mes_cerrar(mercado, '2026-09-01', true, 'El recibo está reclamado al banco');
  v_c := (v_r->>'cierre')::uuid;
  if (select row(bank_balance, book_balance, difference, loose_count, loose_amount, knowingly)::text from public.bank_month_close where id = v_c)
     <> '(2400.00,2500.00,-100.00,1,-100.00,t)' then
    raise exception 'PRUEBA B01 R4 · 3: el cierre a sabiendas no guardó lo que explica la diferencia: %', v_r;
  end if;
  v_ok := false;
  begin perform public.bank_mes_cerrar(mercado, '2026-09-01', true, 'otra vez');
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 3: se cerró dos veces el mismo mes.'; end if;
  v_ok := false;
  begin perform public.bank_mes_reabrir(v_c, '');
  exception when others then v_ok := sqlerrm like 'Reabrir un mes pide el porqué%'; end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 3: se reabrió sin porqué.'; end if;
  perform public.bank_mes_reabrir(v_c, 'El banco devolvió el recibo: lo caso');
  -- Casado lo suelto: cierra solo, con el saldo igual al céntimo.
  perform public.bank_casar(m, '{"tipo":"cuenta","lineas":[{"cuenta":"62600000","importe":100}]}', 'probable', 'Lo dijiste tú', '[]', 'persona', null);
  v_r := public.bank_mes_cerrar(mercado, '2026-09-01', false, null);
  if (v_r->>'diferencia')::numeric <> 0 or (v_r->>'sueltos')::int <> 0 or (v_r->>'a_sabiendas')::boolean then
    raise exception 'PRUEBA B01 R4 · 3: el cierre limpio no cuadra: %', v_r;
  end if;
  if (select count(*) from public.bank_activity_log where action in ('cierre', 'reabierto') and summary like '%09/2026%') <> 3 then
    raise exception 'PRUEBA B01 R4 · 3: los dos cierres y la reapertura no están en «Lo que ha hecho Folvy».';
  end if;
  raise notice '3 · mes en curso no; suelto no; a sabiendas sin porqué no; con porqué sí (2.400 / 2.500 / −100 y 1 suelto); dos veces no; reabrir con porqué; casado, cierra igual al céntimo';
end $$;

-- ── 4 · Agente ──────────────────────────────────────────────────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc'; v uuid; v_ok boolean := false;
begin
  begin perform public.bank_agente_registrar(emp, 'cada hora', '{}');
  exception when others then v_ok := sqlerrm like 'El agente corre después de un extracto o una vez al día%'; end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 4: el agente aceptó otro disparo.'; end if;
  v := public.bank_agente_registrar(emp, 'extracto', '{"casados":3,"propuestos":2,"por_aclarar":4,"fallos":0}');
  if (select summary from public.bank_agent_run where id = v) <> 'He casado yo 3; te propongo 2 y quedan 4 por aclarar.' then
    raise exception 'PRUEBA B01 R4 · 4: el resumen de la pasada no es el esperado.';
  end if;
  if not exists (select 1 from public.bank_activity_log where action = 'agente' and by_who = 'folvy' and summary = 'Al subir el extracto: He casado yo 3; te propongo 2 y quedan 4 por aclarar.') then
    raise exception 'PRUEBA B01 R4 · 4: la pasada no quedó en «Lo que ha hecho Folvy».';
  end if;
  if public.bank_agente_toca_hoy(emp) then raise exception 'PRUEBA B01 R4 · 4: tras una pasada hoy, aún «toca» la del día.'; end if;
  raise notice '4 · disparo raro rechazado; la pasada con su resumen y en «Lo que ha hecho Folvy»; hoy ya no toca';
end $$;

-- ── 5 · Agregador: el mismo movimiento por dos caminos ─────────────────────
do $$
declare sur constant uuid := 'b0100000-0000-4000-8000-0000000000b2'; v_r jsonb;
begin
  v_r := public.bank_importar(sur, 'fichero', 'norma43', 'sur-sept.n43', repeat('9', 64), '2026-09-02', '2026-09-02', null, null, 'Sin saldos en la prueba.', null,
    '[{"fecha":"2026-09-02","importe":-45.30,"concepto_banco":"RECIBO TELEFONO PRUEBA","ref1":"000123","huella":"agr-n43","huella_suave":"agr-s1"}]');
  if (v_r->>'nuevos')::int <> 1 then raise exception 'PRUEBA B01 R4 · 5: el Norma 43 no entró: %', v_r; end if;
  -- El agregador trae el mismo, sin la referencia del Norma 43: otra huella entera, la misma suave.
  v_r := public.bank_importar(sur, 'agregador:simulado', 'agregador', null, null, '2026-09-02', '2026-09-02', null, null, 'El agregador no da saldo de cierre.', null,
    '[{"fecha":"2026-09-02","importe":-45.30,"concepto_banco":"Recibo telefono prueba","huella":"agr-eb","huella_suave":"agr-s1"}]');
  if (v_r->>'nuevos')::int <> 0 or (v_r->>'repetidos')::int <> 1 then raise exception 'PRUEBA B01 R4 · 5: el del agregador entró dos veces: %', v_r; end if;
  -- Entre dos ficheros, sigue siendo «¿es el mismo?».
  v_r := public.bank_importar(sur, 'fichero', 'csv:bbva', 'sur-sept.xlsx', repeat('a', 63) || 'b', '2026-09-02', '2026-09-02', null, null, 'Sin saldos.', null,
    '[{"fecha":"2026-09-02","importe":-45.30,"concepto_banco":"RECIBO TELEFONO","huella":"agr-xls","huella_suave":"agr-s1"}]');
  if (v_r->>'posibles_repetidos')::int <> 1 then raise exception 'PRUEBA B01 R4 · 5: entre dos ficheros dejó de preguntar: %', v_r; end if;
  raise notice '5 · Norma 43 y agregador: el mismo, no entra dos veces; dos ficheros: «¿es el mismo?»';
end $$;

-- ── 6 · Consentimiento ──────────────────────────────────────────────────────
do $$
declare emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if (select string_agg(provider || ':' || dias, ' ') from public.bank_consentimientos_por_caducar(emp, 7)) is distinct from 'simulado:5' then
    raise exception 'PRUEBA B01 R4 · 6: el aviso de los 7 días no es el esperado: %', (select string_agg(provider || ':' || dias, ' ') from public.bank_consentimientos_por_caducar(emp, 7));
  end if;
  raise notice '6 · caduca en 5 días → avisa; en 30 → aún no';
end $$;
reset role;

-- ── 7 · RLS ─────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  if (select count(*) from public.bank_month_close) + (select count(*) from public.bank_agent_run) + (select count(*) from public.bank_aggregator_link) <> 0 then
    raise exception 'PRUEBA B01 R4 · 7: B ve cierres, pasadas o conexiones de A.';
  end if;
  begin perform public.bank_mes_cerrar('b0100000-0000-4000-8000-0000000000b3', '2026-08-01', true, 'intrusa');
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'PRUEBA B01 R4 · 7: B cerró un mes de un banco de A.'; end if;
  raise notice '7 · B no ve nada de A y no puede cerrar (42501)';
end $$;
reset role;

do $$ begin raise notice 'PRUEBA B01 · respuesta 4 y tarea 6 en verde: 7 de 7.'; end $$;
rollback;
