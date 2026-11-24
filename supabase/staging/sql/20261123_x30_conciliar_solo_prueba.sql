-- supabase/staging/sql/20261123_x30_conciliar_solo_prueba.sql
--
-- SOLO STAGING. Prueba del X30 (20261123T2050_x30_conciliar_solo_anade, 20261123T2051_x30_orden_y_seguridad y
-- 20261123T2052_x30_reglas_de_partida), que el ensayo de staging pone delante en la misma sesión. Todo en una
-- transacción con ROLLBACK: staging no cambia. Lo que cambia: public.bank_importar (escribe el orden de cada línea),
-- public.bank_match (el disparador del porcentaje) y public.treasury_account (el disparador de las reglas de partida).
--
-- En la gestoría de ejemplo del núcleo (semillas K02, K04 y K05), con su «Banco principal», como el usuario del núcleo.
-- Datos inventados. Los caminos (regla 10), por las funciones que usa la pantalla y el agente:
--   1. Leer un extracto que viene de la más nueva a la más antigua (bank_importar): cada línea con su orden, de la más
--      antigua a la más nueva.
--   2. Una regla nueva aplicada hacia atrás (bank_regla_guardar, bank_regla_desde sin fecha y bank_casar con la regla,
--      como «Crear regla con este»): concilia los dos pagos que casan y ninguno más (ni el ingreso con el mismo texto,
--      ni el pago con otro texto).
--   3. Una propuesta por encima del umbral (97 %) se concilia sola, como hace el agente (bank_proponer y bank_casar de
--      Sumied): queda con su 97 % y por Sumied; y se deshace (bank_deshacer).
--   4. Una por debajo del umbral (60 %) queda en ámbar: propuesta, sin conciliar.
--   5. Lo «seguro» de siempre se concilia con un 99 %.
--   6. Las reglas de partida: el primer banco de una empresa se las pone, desde ese momento, sin conciliar nada; no se
--      repiten. Y una regla con fecha no mira lo de antes (applies_from guardado).
--   7. El umbral y los días del aviso, por empresa (bank_ajustes_conciliar): se guardan, y fuera de rango no.
--   8. Regla 31: lo ya conciliado de toda la base, igual antes y después (la misma vara).
--   9. La vuelta atrás: bank_importar como antes, sin disparadores, sin reglas de partida y sin lo nuevo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X30: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public.bank_regla_desde(uuid,timestamptz)') is null
     or not exists (select 1 from information_schema.columns where table_name = 'bank_movement' and column_name = 'position') then
    raise exception 'PRUEBA X30 · 0: faltan la 2050, la 2051 y la 2052 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _x30 (k text primary key, v text) on commit drop;
grant all on _x30 to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x30 where _x30.k = $1 $$;

create function pg_temp.vara() returns text language sql stable as $f$
  select count(distinct m.id) || ' · ' || coalesce(md5(string_agg(concat_ws('|', m.id, m.status, b.journal_entry_id, e.number, e.status, l.position, l.company_account_id, l.debit, l.credit),
                                                          ',' order by m.id, l.position)), '-')
    from public.bank_movement m join public.bank_match b on b.movement_id = m.id and b.status = 'vivo'
    join public.journal_entry e on e.id = b.journal_entry_id join public.journal_line l on l.entry_id = e.id
   where m.fingerprint not like 'x30-%'
$f$;
insert into _x30 values ('vara', pg_temp.vara());

-- 0 · Preparar (inventado): una 62600000 si no está.
do $$
declare a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
begin
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select a, emp, 'pymes', '62600000', '626', 'Servicios bancarios (prueba X30)', 'own', 'manual'
   where not exists (select 1 from public.company_account o where o.company_id = emp and o.code = '62600000');
end $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 1 · Un extracto de la más nueva a la más antigua: cada línea, con su orden de la más antigua a la más nueva ------------
do $$
declare r jsonb; v_movs jsonb; v_orden text;
begin
  v_movs := jsonb_build_array(
    jsonb_build_object('fecha', '2026-11-18', 'importe', -22.00, 'concepto_banco', 'PRUEBA X30 OTRA COSA', 'huella', 'x30-otra', 'huella_suave', 'x30s-otra'),
    jsonb_build_object('fecha', '2026-11-17', 'importe', 30.00, 'concepto_banco', 'PRUEBA X30 CASAXTREINTA ABONO', 'huella', 'x30-abono', 'huella_suave', 'x30s-abono'),
    jsonb_build_object('fecha', '2026-11-17', 'importe', -21.00, 'concepto_banco', 'PRUEBA X30 CASAXTREINTA DOS', 'huella', 'x30-dos', 'huella_suave', 'x30s-dos'),
    jsonb_build_object('fecha', '2026-11-16', 'importe', -20.00, 'concepto_banco', 'PRUEBA X30 CASAXTREINTA UNO', 'huella', 'x30-uno', 'huella_suave', 'x30s-uno'),
    jsonb_build_object('fecha', '2026-11-16', 'importe', -5.00, 'concepto_banco', 'PRUEBA X30 SEGURO', 'huella', 'x30-seguro', 'huella_suave', 'x30s-seguro'));
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'norma43', 'x30-prueba-1.n43', repeat('b', 64), date '2026-11-16', date '2026-11-18',
                            null, null, 'Prueba X30', null, v_movs);
  if (r->>'nuevos')::int <> 5 then raise exception 'PRUEBA X30 · 1: %', r; end if;
  insert into _x30 select 'm_' || replace(fingerprint, 'x30-', ''), id from public.bank_movement where treasury_account_id = 'c0e20000-0000-4000-8000-0000000000b0' and fingerprint like 'x30-%';
  select string_agg(replace(fingerprint, 'x30-', '') || '=' || position, ' ' order by position) into v_orden
    from public.bank_movement where treasury_account_id = 'c0e20000-0000-4000-8000-0000000000b0' and fingerprint like 'x30-%';
  if v_orden <> 'seguro=1 uno=2 dos=3 abono=4 otra=5' then raise exception 'PRUEBA X30 · 1: el orden es «%»', v_orden; end if;
  raise notice 'PRUEBA X30 · 1: leído al revés y ordenado de la más antigua a la más nueva: %.', v_orden;
end $$;

-- 2 · Una regla nueva, aplicada hacia atrás: concilia los dos pagos que casan y ninguno más --------------------------------
do $$
declare v_regla uuid; r jsonb; n int; m record;
begin
  v_regla := public.bank_regla_guardar('c0e20000-0000-4000-8000-0000000000e3', null, 'CASAXTREINTA',
               '{"contiene":"CASAXTREINTA","signo":-1}', '{"cuenta":"62600000","concepto":"Prueba X30"}', 'persona', 'activa');
  perform public.bank_regla_desde(v_regla, now());
  if (select applies_from from public.bank_rule where id = v_regla) is null then raise exception 'PRUEBA X30 · 2: la fecha de la regla no se ha guardado'; end if;
  perform public.bank_regla_desde(v_regla, null);   -- «aplicarla hacia atrás»
  if (select applies_from from public.bank_rule where id = v_regla) is not null then raise exception 'PRUEBA X30 · 2: hacia atrás, sigue con fecha'; end if;
  insert into _x30 values ('regla', v_regla);
  -- Lo que hace la pantalla con los pendientes que casan (el concepto contiene el texto y es un pago), uno a uno.
  for m in select id, amount from public.bank_movement where treasury_account_id = 'c0e20000-0000-4000-8000-0000000000b0' and fingerprint like 'x30-%'
             and status not in ('casado', 'ignorado') and bank_concept ilike '%CASAXTREINTA%' and amount < 0 order by position loop
    r := public.bank_casar(m.id, jsonb_build_object('tipo', 'cuenta', 'concepto', 'Prueba X30', 'lineas', jsonb_build_array(jsonb_build_object('cuenta', '62600000', 'importe', abs(m.amount)))),
                           'probable', 'Regla: CASAXTREINTA', '[]', 'persona', v_regla);
  end loop;
  select count(*) into n from public.bank_match where rule_id = v_regla and status = 'vivo';
  if n <> 2 or (select status from public.bank_movement where id = pg_temp.p('m_abono')::uuid) = 'casado'
     or (select status from public.bank_movement where id = pg_temp.p('m_otra')::uuid) = 'casado' then
    raise exception 'PRUEBA X30 · 2: la regla ha conciliado % (esperados 2: uno y dos).', n;
  end if;
  raise notice 'PRUEBA X30 · 2: la regla, hacia atrás, concilia los 2 pagos que casan; el ingreso y el otro pago, no.';
end $$;

-- 3 · Por encima del umbral: se concilia solo, con su porcentaje, y se deshace ---------------------------------------------
do $$
declare r jsonb; b public.bank_match;
begin
  perform public.bank_proponer(pg_temp.p('m_otra')::uuid, 'propuesto', 'probable', 'Las 30 anteriores fueron 62600000.',
    '{"origen":"historial","seguridad":97,"destino":{"tipo":"cuenta","concepto":"Otra cosa","lineas":[{"cuenta":"62600000","importe":22}]}}');
  r := public.bank_casar(pg_temp.p('m_otra')::uuid, '{"tipo":"cuenta","concepto":"Otra cosa","lineas":[{"cuenta":"62600000","importe":22}]}',
                         'probable', 'Las 30 anteriores fueron 62600000.', '[]', 'folvy', null);
  select * into b from public.bank_match where id = (r->>'match')::uuid;
  if b.confidence_pct is distinct from 97::smallint or b.by_who <> 'folvy' then raise exception 'PRUEBA X30 · 3: %, por %', b.confidence_pct, b.by_who; end if;
  perform public.bank_deshacer(b.id, 'Deshacer alguno (prueba X30)');
  if (select status from public.bank_movement where id = pg_temp.p('m_otra')::uuid) = 'casado' then raise exception 'PRUEBA X30 · 3: deshecho, sigue conciliado'; end if;
  raise notice 'PRUEBA X30 · 3: con 97 %%, conciliado por Sumied con su 97 %%; deshecho, vuelve a estar sin conciliar.';
end $$;

-- 4 · Por debajo del umbral: propuesta en ámbar, sin conciliar ---------------------------------------------------------------
do $$ begin
  perform public.bank_proponer(pg_temp.p('m_abono')::uuid, 'propuesto', 'probable', 'Como 1 ant.',
    '{"origen":"historial","seguridad":60,"destino":{"tipo":"cuenta","concepto":"Abono","lineas":[{"cuenta":"62600000","importe":30}]}}');
  if (select status from public.bank_movement where id = pg_temp.p('m_abono')::uuid) <> 'propuesto'
     or exists (select 1 from public.bank_match where movement_id = pg_temp.p('m_abono')::uuid) then
    raise exception 'PRUEBA X30 · 4: con 60 %% no ha quedado propuesta sin conciliar';
  end if;
  raise notice 'PRUEBA X30 · 4: con 60 %%, propuesta en ámbar y sin conciliar.';
end $$;

-- 5 · Lo «seguro» de siempre: 99 % -------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := public.bank_casar(pg_temp.p('m_seguro')::uuid, '{"tipo":"cuenta","concepto":"Seguro","lineas":[{"cuenta":"62600000","importe":5}]}',
                         'seguro', 'Regla confirmada 3 veces.', '[]', 'folvy', null);
  if (select confidence_pct from public.bank_match where id = (r->>'match')::uuid) is distinct from 99::smallint then raise exception 'PRUEBA X30 · 5: no es 99'; end if;
  raise notice 'PRUEBA X30 · 5: lo seguro, con 99 %%.';
end $$;

-- 7 · El umbral y los días del aviso ---------------------------------------------------------------------------------------
do $$
declare r jsonb; ok boolean := false;
begin
  r := public.bank_ajustes_conciliar('c0e20000-0000-4000-8000-0000000000e3', 97::smallint, 7::smallint);
  if (select auto_threshold from public.bank_settings where company_id = 'c0e20000-0000-4000-8000-0000000000e3') <> 97
     or (select aviso_dias from public.bank_settings where company_id = 'c0e20000-0000-4000-8000-0000000000e3') <> 7 then
    raise exception 'PRUEBA X30 · 7: no se ha guardado (%)', r;
  end if;
  begin perform public.bank_ajustes_conciliar('c0e20000-0000-4000-8000-0000000000e3', 79::smallint, 7::smallint); exception when others then ok := true; end;
  if not ok then raise exception 'PRUEBA X30 · 7: un 79 %% ha pasado'; end if;
  raise notice 'PRUEBA X30 · 7: «%»; un 79 %% no pasa.', r->>'texto';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · Las reglas de partida: el primer banco de una empresa se las pone, sin conciliar nada --------------------------------
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; n int; n2 int; m int;
begin
  select count(*) into m from public.bank_match where status = 'vivo';
  delete from public.bank_rule where company_id = emp and seed = 'partida';
  insert into public.treasury_account (account_id, company_id, kind, name, iban)
  values ('c0e20000-0000-4000-8000-0000000000e0', emp, 'bank', 'Banco de prueba X30', 'ES0099990000000000000030');
  select count(*) into n from public.bank_rule where company_id = emp and seed = 'partida' and status = 'activa' and confirmations = 0
     and applies_from >= now() - interval '1 minute';
  if n = 0 then raise exception 'PRUEBA X30 · 6: el primer banco no ha puesto ninguna regla de partida'; end if;
  insert into public.treasury_account (account_id, company_id, kind, name, iban)
  values ('c0e20000-0000-4000-8000-0000000000e0', emp, 'bank', 'Otro banco de prueba X30', 'ES0099990000000000000031');
  select count(*) into n2 from public.bank_rule where company_id = emp and seed = 'partida';
  if n2 <> n then raise exception 'PRUEBA X30 · 6: el segundo banco las ha repetido (% y %)', n, n2; end if;
  if (select count(*) from public.bank_match where status = 'vivo') <> m then raise exception 'PRUEBA X30 · 6: poner las reglas de partida ha conciliado algo'; end if;
  if exists (select 1 from public.bank_rule where company_id = emp and seed = 'partida' and (target->>'cuenta') like '476%') then
    raise exception 'PRUEBA X30 · 6: hay una de partida a la Seguridad Social';
  end if;
  raise notice 'PRUEBA X30 · 6: el primer banco pone % reglas de partida (desde ahora, sin confirmar, sin conciliar nada); el segundo, ninguna más.', n;
end $$;

-- 8 · Regla 31 --------------------------------------------------------------------------------------------------------------
do $$ begin
  if pg_temp.vara() <> pg_temp.p('vara') then raise exception 'PRUEBA X30 · 8: lo ya conciliado ha cambiado: antes %, después %.', pg_temp.p('vara'), pg_temp.vara(); end if;
  raise notice 'PRUEBA X30 · 8: lo ya conciliado de toda la base, antes % y después %.', pg_temp.p('vara'), pg_temp.vara();
end $$;

-- 9 · La vuelta atrás -------------------------------------------------------------------------------------------------------
-- Lo conciliado por la prueba se deshace antes (la vuelta atrás de la 2052 solo borra las de partida sin conciliados).
\i supabase/vuelta-atras/20261123T2052_x30_reglas_de_partida.down.sql
\i supabase/vuelta-atras/20261123T2051_x30_orden_y_seguridad.down.sql
\i supabase/vuelta-atras/20261123T2050_x30_conciliar_solo_anade.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_name in ('bank_movement', 'bank_rule', 'bank_match', 'bank_settings')
              and column_name in ('position', 'applies_from', 'seed', 'confidence_pct', 'auto_threshold', 'aviso_dias'))
     or exists (select 1 from pg_trigger where tgname in ('trg_bank_match_seguridad', 'trg_bank_reglas_de_partida'))
     or to_regprocedure('public.bank_regla_desde(uuid,timestamptz)') is not null
     or strpos(pg_get_functiondef('public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)'::regprocedure), 'X30') > 0 then
    raise exception 'PRUEBA X30 · 9: la vuelta atrás no lo deja como antes.';
  end if;
  raise notice 'PRUEBA X30 · 9: la vuelta atrás deja bank_importar como antes, sin disparadores, sin reglas de partida y sin lo nuevo.';
  raise notice 'PRUEBA X30: 9 de 9 bien.';
end $$;

rollback;
