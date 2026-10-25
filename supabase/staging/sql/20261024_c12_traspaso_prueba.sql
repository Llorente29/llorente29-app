-- supabase/staging/sql/20261024_c12_traspaso_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T1250_c12_traspaso_mensual y 1251 (el traspaso a
-- Diez una vez al mes), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. Septiembre de 2026 en la empresa de la cuenta A de pruebas, con
-- asientos manuales inventados (importes 11, 13, 17, 19 y 23 para reconocerlos):
--
--   1. Se pasa dos veces (se puede reaplicar).
--   2. El mes, con lo que pasa de verdad:
--        S (11) validado y YA en Diez, y después anulado → su anulación va;
--        N (13) validado SIN llegar a Diez, anulado y rehecho en R (17) →
--          ni N ni su anulación viajan; R va;
--        V (19) validado, sin enviar → va;
--        P (23) propuesto → «falta»: un asiento sin validar.
--   3. La lista y la revisión: lo que va (3), lo que ya estaba (1), lo que no
--      viaja (2), por tipo y por cuenta; los saldos que tienen que estar en
--      Diez (debe 11+17+19, haber 11 en la 62900000).
--   4. Confirmar: solo un administrador, solo un mes terminado; queda quién y
--      cuándo, y lo que faltaba.
--   5. Terminar: con fallos no cierra; sin cuadrar (o sin poder comprobar) no
--      cierra; fuera de orden no cierra; con los meses de antes cerrados y
--      cuadrando, cierra septiembre; terminado, no se vuelve a confirmar.
--   6. Quién ve qué: A ve su traspaso; B no; anon no ejecuta la revisión; un
--      usuario no ejecuta las del servidor.
--   7. Modo mensual: conta_diez_por_enviar deja de coger la empresa; al validar
--      (o sin modo), igual que antes.
--   8. La vuelta atrás para con un traspaso apuntado (o una empresa en mensual)
--      y, sin ellos, lo quita todo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C12: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · Dos veces.
\i supabase/migrations/20261024T1250_c12_traspaso_mensual.sql
\i supabase/migrations/20261024T1251_c12_por_enviar_modo.sql
\i supabase/migrations/20261024T1250_c12_traspaso_mensual.sql
\i supabase/migrations/20261024T1251_c12_por_enviar_modo.sql

-- Un asiento manual de A en septiembre, propuesto (y validado si toca) como lo hace una persona.
create or replace function pg_temp.asiento(p_concepto text, p_fecha date, p_importe numeric, p_validar boolean) returns uuid language plpgsql as $$
declare
  v_loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  r jsonb; v uuid;
begin
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 1, 'fecha', p_fecha, 'concepto', p_concepto, 'source_type', 'manual',
                       'confianza', 'seguro', 'porque', 'Prueba C12'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '62900000', 'debe', p_importe, 'haber', 0, 'local_id', v_loc, 'comun', false),
      jsonb_build_object('cuenta', '40000000', 'debe', 0, 'haber', p_importe, 'local_id', v_loc, 'comun', false)),
    null, 'Prueba C12');
  v := (r->>'id')::uuid;
  if p_validar then perform public.journal_entry_validar(v, 'Prueba C12'); end if;
  return v;
end $$;
grant execute on function pg_temp.asiento(text, date, numeric, boolean) to authenticated;

-- Lo que deja el envío a Diez (con la clave de servicio).
create or replace function pg_temp.enviado(p_entry uuid, p_doc int) returns void language sql as $$
  insert into public.external_send (entry_id, account_id, company_id, kind, ext_year, ext_series, ext_number, payload_hash, status, attempts, sent_at)
  select e.id, e.account_id, e.company_id, 'asiento', '2026', '1', p_doc, 'prueba-c12', 'enviado', 1, now()
    from public.journal_entry e where e.id = p_entry
$$;

-- Los totales de la 62900000 en lo que devuelven revisar y saldos (para medir antes y después).
create or replace function pg_temp.cuenta(p jsonb, p_cuenta text, p_campo text) returns numeric language sql as $$
  select coalesce(sum((x->>p_campo)::numeric), 0) from jsonb_array_elements(p->'por_cuenta') x where x->>'cuenta' = p_cuenta
$$;
create or replace function pg_temp.tipo(p jsonb, p_tipo text) returns int language sql as $$
  select coalesce(sum((x->>'n')::int), 0)::int from jsonb_array_elements(p->'por_tipo') x where x->>'tipo' = p_tipo
$$;
create or replace function pg_temp.falta(p jsonb, p_codigo text) returns int language sql as $$
  select coalesce(sum((x->>'n')::int), 0)::int from jsonb_array_elements(p->'faltan') x where x->>'codigo' = p_codigo
$$;
grant execute on function pg_temp.cuenta(jsonb, text, text), pg_temp.tipo(jsonb, text), pg_temp.falta(jsonb, text) to authenticated;

do $$
declare v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if public.conta_mes_cerrado(v_e, '2026-09-10') then
    raise exception 'PRUEBA C12: septiembre de 2026 está cerrado en A: esta prueba ya no puede validar.';
  end if;
  if exists (select 1 from public.conta_diez_traspaso where company_id = v_e) then
    raise exception 'PRUEBA C12: A ya tiene traspasos apuntados en staging.';
  end if;
  -- Lo que hay antes en la 62900000 de septiembre (staging ya tiene asientos de A).
  perform set_config('c12.saldo_debe', coalesce((select debe from public.conta_traspaso_saldos(v_e, '2026-09-01') where cuenta = '62900000'), 0)::text, true);
  perform set_config('c12.saldo_haber', coalesce((select haber from public.conta_traspaso_saldos(v_e, '2026-09-01') where cuenta = '62900000'), 0)::text, true);
end $$;

-- La revisión de antes, con el usuario administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select set_config('c12.antes', public.conta_traspaso_revisar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-15')::text, true);

-- 2 · El mes: S, N, V validados; P propuesto.
select set_config('c12.s', pg_temp.asiento('Prueba C12 · S, llegó a Diez y se anula', '2026-09-10', 11, true)::text, true);
select set_config('c12.n', pg_temp.asiento('Prueba C12 · N, no llegó a Diez y se anula', '2026-09-11', 13, true)::text, true);
select set_config('c12.v', pg_temp.asiento('Prueba C12 · V, validado sin enviar', '2026-09-12', 19, true)::text, true);
select set_config('c12.p', pg_temp.asiento('Prueba C12 · P, propuesto', '2026-09-13', 23, false)::text, true);
reset role;
-- S llega a Diez antes de anularse.
select pg_temp.enviado(current_setting('c12.s')::uuid, 9121);
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.journal_entry_anular(current_setting('c12.s')::uuid, 'Prueba C12: S se anula', '2026-09-20', 'Prueba C12');
  perform set_config('c12.contra_s', r->>'contraasiento', true);
  r := public.journal_entry_anular(current_setting('c12.n')::uuid, 'Prueba C12: N se rehace', '2026-09-20', 'Prueba C12');
  perform set_config('c12.contra_n', r->>'contraasiento', true);
end $$;
select set_config('c12.r', pg_temp.asiento('Prueba C12 · R, el rehecho de N', '2026-09-21', 17, true)::text, true);
select set_config('c12.despues', public.conta_traspaso_revisar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01')::text, true);
reset role;

-- 3 · La lista, la revisión y los saldos.
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  a jsonb := current_setting('c12.antes')::jsonb; d jsonb := current_setting('c12.despues')::jsonb;
  v_lista uuid[]; v_debe numeric; v_haber numeric;
begin
  if (select status from public.journal_entry where id = current_setting('c12.s')::uuid) <> 'anulado'
     or (select status from public.journal_entry where id = current_setting('c12.n')::uuid) <> 'anulado'
     or (select status from public.journal_entry where id = current_setting('c12.r')::uuid) <> 'validado'
     or current_setting('c12.contra_s', true) is null or current_setting('c12.contra_n', true) is null then
    raise exception 'PRUEBA C12 · 2: los asientos del mes no están como tocaba.';
  end if;
  select array_agg(entry_id) into v_lista from public.conta_traspaso_lista(v_e, '2026-09-30');
  if not (current_setting('c12.contra_s')::uuid = any(v_lista)) then raise exception 'PRUEBA C12 · 3: la anulación de S (que estaba en Diez) no va.'; end if;
  if not (current_setting('c12.r')::uuid = any(v_lista)) then raise exception 'PRUEBA C12 · 3: el rehecho R no va.'; end if;
  if not (current_setting('c12.v')::uuid = any(v_lista)) then raise exception 'PRUEBA C12 · 3: V, validado sin enviar, no va.'; end if;
  if current_setting('c12.s')::uuid = any(v_lista) then raise exception 'PRUEBA C12 · 3: S, que ya estaba en Diez, va otra vez.'; end if;
  if current_setting('c12.n')::uuid = any(v_lista) then raise exception 'PRUEBA C12 · 3: N, anulado sin llegar a Diez, va.'; end if;
  if current_setting('c12.contra_n')::uuid = any(v_lista) then raise exception 'PRUEBA C12 · 3: la anulación de N (que nunca llegó) va.'; end if;
  if current_setting('c12.p')::uuid = any(v_lista) then raise exception 'PRUEBA C12 · 3: P, propuesto, va.'; end if;
  if (select tipo from public.conta_traspaso_lista(v_e, '2026-09-01') where entry_id = current_setting('c12.contra_s')::uuid) <> 'anulacion'
     or (select tipo from public.conta_traspaso_lista(v_e, '2026-09-01') where entry_id = current_setting('c12.r')::uuid) <> 'manuales' then
    raise exception 'PRUEBA C12 · 3: los tipos no son anulación y manuales.';
  end if;
  if exists (select 1 from public.conta_traspaso_lista(v_e, '2026-10-01') where entry_id = any(v_lista)) then
    raise exception 'PRUEBA C12 · 3: lo de septiembre sale en octubre.';
  end if;

  -- La revisión: lo mismo, contado.
  if (d->>'van')::int - (a->>'van')::int <> 3 then raise exception 'PRUEBA C12 · 3: van % más, no 3.', (d->>'van')::int - (a->>'van')::int; end if;
  if (d->>'ya_en_diez')::int - (a->>'ya_en_diez')::int <> 1 then raise exception 'PRUEBA C12 · 3: ya en Diez, % más, no 1 (S).', (d->>'ya_en_diez')::int - (a->>'ya_en_diez')::int; end if;
  if (d->>'no_viajan')::int - (a->>'no_viajan')::int <> 2 then raise exception 'PRUEBA C12 · 3: no viajan % más, no 2 (N y su anulación).', (d->>'no_viajan')::int - (a->>'no_viajan')::int; end if;
  if pg_temp.tipo(d, 'anulacion') - pg_temp.tipo(a, 'anulacion') <> 1 or pg_temp.tipo(d, 'manuales') - pg_temp.tipo(a, 'manuales') <> 2 then
    raise exception 'PRUEBA C12 · 3: por tipo no salen 1 anulación y 2 manuales más (%).', d->'por_tipo';
  end if;
  if pg_temp.falta(d, 'asientos') - pg_temp.falta(a, 'asientos') <> 1 then raise exception 'PRUEBA C12 · 3: P no sale como asiento sin validar.'; end if;
  if exists (select 1 from jsonb_array_elements(d->'faltan') x where (x->>'n')::int = 0) then raise exception 'PRUEBA C12 · 3: «faltan» trae cosas con 0.'; end if;
  -- Por cuenta (lo que va): debe R+V = 36; haber, la anulación de S = 11.
  if pg_temp.cuenta(d, '62900000', 'debe') - pg_temp.cuenta(a, '62900000', 'debe') <> 36
     or pg_temp.cuenta(d, '62900000', 'haber') - pg_temp.cuenta(a, '62900000', 'haber') <> 11 then
    raise exception 'PRUEBA C12 · 3: por cuenta, la 62900000 no suma debe 36 y haber 11 (%).', d->'por_cuenta';
  end if;
  if d->>'modo' <> 'al_validar' or (d->>'mes')::date <> '2026-09-01' or (d->>'mes_cerrado')::boolean or d->'traspaso' <> 'null'::jsonb then
    raise exception 'PRUEBA C12 · 3: la cabecera de la revisión no es la de un mes abierto sin traspaso (%).', d - 'por_cuenta' - 'por_tipo';
  end if;
  -- Los saldos que tienen que estar en Diez: S (11, ya estaba) + R + V al debe; la anulación de S al haber.
  select debe, haber into v_debe, v_haber from public.conta_traspaso_saldos(v_e, '2026-09-01') where cuenta = '62900000';
  if v_debe - current_setting('c12.saldo_debe')::numeric <> 47 or v_haber - current_setting('c12.saldo_haber')::numeric <> 11 then
    raise exception 'PRUEBA C12 · 3: los saldos de la 62900000 no suben debe 47 y haber 11 (debe %, haber %).', v_debe, v_haber;
  end if;
  raise notice 'C12 · 1-3: se pasa dos veces; va la anulación de lo que estaba en Diez, el rehecho y lo validado sin enviar; no va lo que ya estaba, ni lo anulado sin llegar ni su anulación; revisión y saldos cuadran';
end $$;

-- 4 · Confirmar: un encargado no; un mes sin terminar no; el administrador sí.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a6","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_traspaso_confirmar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01');
    raise exception 'PRUEBA C12 · 4: un encargado ha confirmado el traspaso.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare r jsonb; v_mes_en_curso date := date_trunc('month', (now() at time zone 'Europe/Madrid'))::date;
begin
  begin
    perform public.conta_traspaso_confirmar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', v_mes_en_curso);
    raise exception 'PRUEBA C12 · 4: se ha confirmado el mes en curso.';
  exception when check_violation then null;
  end;
  r := public.conta_traspaso_confirmar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-30');
  if (r->>'mes')::date <> '2026-09-01' or (r->>'van')::int <> (current_setting('c12.despues')::jsonb->>'van')::int or (r->>'faltaban')::int < 1 then
    raise exception 'PRUEBA C12 · 4: confirmar devuelve %.', r;
  end if;
  perform set_config('c12.traspaso', r->>'id', true);
  -- Se puede volver a confirmar mientras no ha empezado (la misma fila).
  if (public.conta_traspaso_confirmar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01')->>'id') <> r->>'id' then
    raise exception 'PRUEBA C12 · 4: confirmar dos veces hace dos traspasos.';
  end if;
end $$;
reset role;
do $$
declare t public.conta_diez_traspaso;
begin
  select * into t from public.conta_diez_traspaso where id = current_setting('c12.traspaso')::uuid;
  if t.confirmado_por <> 'c01a0000-0000-4000-8000-0000000000a1' or t.confirmado_por_nombre is null or t.confirmado_en is null
     or t.estado <> 'confirmado' or t.account_id <> 'c01a0000-0000-4000-8000-00000000000a' then
    raise exception 'PRUEBA C12 · 4: no queda quién y cuándo (%).', t;
  end if;
  if pg_temp.falta(jsonb_build_object('faltan', t.faltaba), 'asientos') < 1 then
    raise exception 'PRUEBA C12 · 4: no queda que faltaba P (%).', t.faltaba;
  end if;
  if (t.resumen->>'no_viajan') is null or jsonb_typeof(t.resumen->'por_cuenta') <> 'array' then
    raise exception 'PRUEBA C12 · 4: el resumen no se guarda (%).', t.resumen;
  end if;
  raise notice 'C12 · 4: confirma solo el administrador y un mes terminado; queda quién, cuándo, lo que faltaba y el resumen';
end $$;

-- 5 · Terminar.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_t uuid := current_setting('c12.traspaso')::uuid; r jsonb; t public.conta_diez_traspaso;
begin
  -- Llegan 2 y 1 no: con fallos, sin cerrar.
  perform public.conta_traspaso_apuntar(v_t, 2, 1, '[{"motivo":"Prueba C12"}]'::jsonb);
  select * into t from public.conta_diez_traspaso where id = v_t;
  if t.estado <> 'traspasando' or t.llegaron <> 2 or t.no_llegaron <> 1 then raise exception 'PRUEBA C12 · 5: apuntar deja %.', t; end if;
  r := public.conta_traspaso_terminar(v_t, '[]'::jsonb, false);
  select * into t from public.conta_diez_traspaso where id = v_t;
  if (r->>'mes_cerrado')::boolean or t.estado <> 'con_fallos' or t.mes_cerrado or t.cierre_motivo not like 'No se cierra el mes: 1 no han llegado%' then
    raise exception 'PRUEBA C12 · 5: con uno sin llegar, termina %.', t;
  end if;
  -- Llega el que faltaba, pero Diez no cuadra (o no se ha podido mirar): no cierra.
  perform public.conta_traspaso_apuntar(v_t, 0, 0, '[]'::jsonb);
  r := public.conta_traspaso_terminar(v_t, '{"diferencias":[{"cuenta":"62900000"}]}'::jsonb, false);
  select * into t from public.conta_diez_traspaso where id = v_t;
  if (r->>'mes_cerrado')::boolean or t.estado <> 'terminado' or t.cierre_motivo <> 'No se cierra el mes: Diez no cuadra con Sumied.' then
    raise exception 'PRUEBA C12 · 5: sin cuadrar, termina %.', t;
  end if;
  r := public.conta_traspaso_terminar(v_t, '{"error":"Diez no contesta"}'::jsonb, null);
  if (r->>'mes_cerrado')::boolean or r->>'motivo' <> 'No se cierra el mes: no se ha podido comprobar con Diez.' then
    raise exception 'PRUEBA C12 · 5: sin poder comprobar, termina %.', r;
  end if;
  -- Cuadra, pero en A el primer mes abierto es enero: no cierra.
  perform public.conta_traspaso_apuntar(v_t, 1, 0, '[]'::jsonb);
  r := public.conta_traspaso_terminar(v_t, '{"diferencias":[]}'::jsonb, true);
  select * into t from public.conta_diez_traspaso where id = v_t;
  if (r->>'mes_cerrado')::boolean or t.estado <> 'terminado' or t.llegaron <> 3 or not t.cuadra or t.cierre_motivo not like '%los meses se cierran en orden%' then
    raise exception 'PRUEBA C12 · 5: fuera de orden, termina %.', t;
  end if;
  if exists (select 1 from public.fiscal_period_lock where company_id = t.company_id and month = '2026-09-01' and reopened_at is null) then
    raise exception 'PRUEBA C12 · 5: fuera de orden ha cerrado septiembre.';
  end if;
end $$;
reset role;
-- Enero a agosto, cerrados (solo en esta transacción).
insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, locked_by, locked_by_name)
select 'c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', y.id, m::date, 'c01a0000-0000-4000-8000-0000000000a1', 'Prueba C12'
  from public.fiscal_year y, generate_series('2026-01-01'::date, '2026-08-01'::date, interval '1 month') m
 where y.company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and y.starts_on = '2026-01-01'
   and not exists (select 1 from public.fiscal_period_lock k where k.company_id = y.company_id and k.month = m::date and k.reopened_at is null);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare v_t uuid := current_setting('c12.traspaso')::uuid; r jsonb; t public.conta_diez_traspaso; k record;
begin
  r := public.conta_traspaso_terminar(v_t, '[{"cuenta":"62900000"}]'::jsonb, true);
  select * into t from public.conta_diez_traspaso where id = v_t;
  if not (r->>'mes_cerrado')::boolean or not t.mes_cerrado or t.cierre_motivo is not null or t.terminado_en is null then
    raise exception 'PRUEBA C12 · 5: con los meses de antes cerrados, no cierra septiembre (%).', t;
  end if;
  select * into k from public.fiscal_period_lock where company_id = t.company_id and month = '2026-09-01' and reopened_at is null;
  if k.locked_by is distinct from 'c01a0000-0000-4000-8000-0000000000a1'::uuid or k.locked_by_name is null then
    raise exception 'PRUEBA C12 · 5: el cierre no dice quién (%).', k;
  end if;
  -- Otra vez: ya estaba cerrado, no inserta otro.
  r := public.conta_traspaso_terminar(v_t, '[]'::jsonb, true);
  if not (r->>'mes_cerrado')::boolean or r->>'motivo' <> 'El mes ya estaba cerrado.' then raise exception 'PRUEBA C12 · 5: terminar dos veces dice %.', r; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare d jsonb;
begin
  begin
    perform public.conta_traspaso_confirmar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01');
    raise exception 'PRUEBA C12 · 5: un mes ya traspasado se ha vuelto a confirmar.';
  exception when unique_violation then null;
  end;
  -- Con el mes cerrado ya no se valida nada en él: lo que se corrija va al siguiente.
  if not public.conta_mes_cerrado('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-15') then
    raise exception 'PRUEBA C12 · 5: conta_mes_cerrado no ve septiembre cerrado.';
  end if;
  d := public.conta_traspaso_revisar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01');
  if not (d->>'mes_cerrado')::boolean or d->'traspaso'->>'estado' <> 'terminado' or d->'traspaso' ? 'detalle' then
    raise exception 'PRUEBA C12 · 5: la revisión no dice terminado y cerrado (%).', d->'traspaso';
  end if;
  -- A lee su traspaso.
  if not exists (select 1 from public.conta_diez_traspaso where id = current_setting('c12.traspaso')::uuid) then
    raise exception 'PRUEBA C12 · 6: A no ve su traspaso.';
  end if;
  -- Un usuario no ejecuta las del servidor.
  begin
    perform * from public.conta_traspaso_lista('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01');
    raise exception 'PRUEBA C12 · 6: un usuario ha ejecutado conta_traspaso_lista.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_traspaso_terminar(current_setting('c12.traspaso')::uuid, '[]'::jsonb, true);
    raise exception 'PRUEBA C12 · 6: un usuario ha ejecutado conta_traspaso_terminar.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_traspaso_apuntar(current_setting('c12.traspaso')::uuid, 1, 0, '[]'::jsonb);
    raise exception 'PRUEBA C12 · 6: un usuario ha ejecutado conta_traspaso_apuntar.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'C12 · 5: con fallos no cierra; fuera de orden no cierra; en orden cierra septiembre con quién; terminado no se vuelve a confirmar';
end $$;
reset role;

-- 6 · B no ve ni revisa lo de A; anon no ejecuta.
select set_config('request.jwt.claims', '{"sub":"c01b0000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_diez_traspaso where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') then
    raise exception 'PRUEBA C12 · 6: B ve el traspaso de A.';
  end if;
  begin
    perform public.conta_traspaso_revisar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01');
    raise exception 'PRUEBA C12 · 6: B ha revisado el mes de A.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.conta_traspaso_saldos('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-09-01');
    raise exception 'PRUEBA C12 · 6: B ha leído los saldos de A.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.conta_traspaso_confirmar('3b34403a-a7d6-4a48-a8d7-737e8cababdc', '2026-08-01');
    raise exception 'PRUEBA C12 · 6: B ha confirmado un traspaso de A.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- anon y los usuarios: el permiso, mirado directamente (un 42501 de dentro de la función no lo distingue).
do $$
declare f text;
begin
  foreach f in array array['public.conta_traspaso_revisar(uuid, date)', 'public.conta_traspaso_confirmar(uuid, date)', 'public.conta_traspaso_saldos(uuid, date)',
                           'public.conta_traspaso_lista(uuid, date)', 'public.conta_traspaso_apuntar(uuid, integer, integer, jsonb)',
                           'public.conta_traspaso_terminar(uuid, jsonb, boolean)', 'public._conta_traspaso_va(uuid)', 'public._conta_traspaso_en_diez(uuid)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA C12 · 6: anon puede ejecutar %.', f; end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'PRUEBA C12 · 6: el servidor no puede ejecutar %.', f; end if;
  end loop;
  foreach f in array array['public.conta_traspaso_lista(uuid, date)', 'public.conta_traspaso_apuntar(uuid, integer, integer, jsonb)',
                           'public.conta_traspaso_terminar(uuid, jsonb, boolean)', 'public._conta_traspaso_va(uuid)', 'public._conta_traspaso_en_diez(uuid)'] loop
    if has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA C12 · 6: un usuario puede ejecutar %.', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.conta_diez_traspaso', 'select') or has_table_privilege('authenticated', 'public.conta_diez_traspaso', 'insert')
     or has_table_privilege('authenticated', 'public.conta_diez_traspaso', 'update') then
    raise exception 'PRUEBA C12 · 6: anon lee o un usuario escribe conta_diez_traspaso directamente.';
  end if;
end $$;
do $$ begin raise notice 'C12 · 6: A ve lo suyo; B no ve, no revisa, no lee saldos ni confirma lo de A; anon, nada'; end $$;

-- 7 · El modo mensual: conta_diez_por_enviar deja de coger la empresa.
insert into public.conta_diez_envio_empresa (company_id, account_id, enviar, desde)
values ('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-00000000000a', true, '2000-01-01')
on conflict (company_id) do update set enviar = true, desde = '2000-01-01', modo = null;
-- V con un reintento vencido y quieto: le toca salir (al validar).
insert into public.external_send (entry_id, account_id, company_id, kind, payload_hash, status, attempts, next_try_at, updated_at)
select e.id, e.account_id, e.company_id, 'asiento', 'sin-enviar', 'pendiente', 0, now() - interval '1 minute', now() - interval '5 minutes'
  from public.journal_entry e where e.id = current_setting('c12.v')::uuid;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if not exists (select 1 from public.conta_diez_por_enviar(50) where entry_id = current_setting('c12.v')::uuid) then
    raise exception 'PRUEBA C12 · 7: sin modo (al validar), V no sale.';
  end if;
  -- Pendiente no es «en Diez»: V sigue en el traspaso.
  if not public._conta_traspaso_va(current_setting('c12.v')::uuid) then
    raise exception 'PRUEBA C12 · 7: un envío pendiente saca a V del traspaso.';
  end if;
end $$;
reset role;
update public.conta_diez_envio_empresa set modo = 'al_validar' where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if not exists (select 1 from public.conta_diez_por_enviar(50) where entry_id = current_setting('c12.v')::uuid) then
    raise exception 'PRUEBA C12 · 7: en «al validar», V no sale.';
  end if;
end $$;
reset role;
update public.conta_diez_envio_empresa set modo = 'mensual' where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if exists (select 1 from public.conta_diez_por_enviar(50) where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA C12 · 7: en mensual, sigue saliendo algo de A al momento.';
  end if;
  if exists (select 1 from public.conta_diez_reclamar(50) where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA C12 · 7: en mensual, la cola sigue cogiendo lo de A.';
  end if;
  raise notice 'C12 · 7: sin modo o al validar, sale al momento; en mensual, ni por_enviar ni reclamar cogen la empresa';
end $$;
reset role;
do $$ begin
  begin
    update public.conta_diez_envio_empresa set modo = 'cada_dia' where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
    raise exception 'PRUEBA C12 · 7: ha entrado un modo que no existe.';
  exception when check_violation then null;
  end;
end $$;

-- 8 · La vuelta atrás: con un traspaso apuntado, para y no quita nada.
savepoint antes_de_frenar;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261024T1250_c12_traspaso_mensual.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint antes_de_frenar;
select (:'LAST_ERROR_MESSAGE' = 'C12 · vuelta atrás: ya hay traspasos apuntados. No se borra su registro.') as freno_c12_ok \gset
\echo 'El freno de la vuelta atrás dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_c12_ok
\else
  do $$ begin raise exception 'PRUEBA C12 · 8: con un traspaso apuntado, la vuelta atrás NO ha parado.'; end $$;
\endif
-- Sin traspasos pero con una empresa en mensual: también para.
delete from public.conta_diez_traspaso where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
do $$ begin
  if exists (select 1 from public.conta_diez_traspaso) then
    raise exception 'PRUEBA C12 · 8: staging tiene traspasos de otras cuentas; la vuelta atrás no se puede probar aquí.';
  end if;
end $$;
savepoint antes_de_frenar_modo;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261024T1250_c12_traspaso_mensual.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint antes_de_frenar_modo;
select (:'LAST_ERROR_MESSAGE' = 'C12 · vuelta atrás: hay empresas en modo mensual. Primero se devuelven a «al validar».') as freno_modo_ok \gset
\echo 'El freno de la vuelta atrás dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_modo_ok
\else
  do $$ begin raise exception 'PRUEBA C12 · 8: con una empresa en mensual, la vuelta atrás NO ha parado.'; end $$;
\endif
do $$ begin
  if to_regprocedure('public.conta_traspaso_revisar(uuid, date)') is null or to_regclass('public.conta_diez_traspaso') is null then
    raise exception 'PRUEBA C12 · 8: la vuelta atrás ha quitado algo aunque ha parado.';
  end if;
end $$;
-- Sin nada de eso, lo quita todo y conta_diez_por_enviar vuelve a coger la empresa.
update public.conta_diez_envio_empresa set modo = null where modo = 'mensual';
\i supabase/vuelta-atras/20261024T1250_c12_traspaso_mensual.down.sql
do $$ begin
  if to_regclass('public.conta_diez_traspaso') is not null
     or to_regprocedure('public.conta_traspaso_revisar(uuid, date)') is not null
     or to_regprocedure('public.conta_traspaso_confirmar(uuid, date)') is not null
     or to_regprocedure('public.conta_traspaso_lista(uuid, date)') is not null
     or to_regprocedure('public.conta_traspaso_saldos(uuid, date)') is not null
     or to_regprocedure('public.conta_traspaso_apuntar(uuid, integer, integer, jsonb)') is not null
     or to_regprocedure('public.conta_traspaso_terminar(uuid, jsonb, boolean)') is not null
     or to_regprocedure('public._conta_traspaso_va(uuid)') is not null
     or to_regprocedure('public._conta_traspaso_en_diez(uuid)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_diez_envio_empresa' and column_name = 'modo') then
    raise exception 'PRUEBA C12 · 8: la vuelta atrás no lo ha quitado todo.';
  end if;
  if position('modo' in pg_get_functiondef('public.conta_diez_por_enviar(integer)'::regprocedure)) > 0 then
    raise exception 'PRUEBA C12 · 8: conta_diez_por_enviar sigue mirando el modo.';
  end if;
end $$;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$ begin
  if not exists (select 1 from public.conta_diez_por_enviar(50) where entry_id = current_setting('c12.v')::uuid) then
    raise exception 'PRUEBA C12 · 8: después de la vuelta atrás, V no vuelve a salir.';
  end if;
  raise notice 'PRUEBA C12 en verde: va solo lo definitivo del mes; confirma el administrador y queda quién; cierra en orden; en mensual no sale nada al momento; la vuelta atrás para con historia y sin ella lo quita.';
end $$;
reset role;

rollback;
