-- supabase/staging/sql/20261124_q08_decisiones_externas_prueba.sql
--
-- SOLO STAGING. Prueba de la 20261124T1220 (Q08 · cargar las decisiones de QBO), con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. En la empresa A de staging (o en otra de la cuenta A, en la base local del W09), con
-- fichas y clientes de GoCardless inventados (T11).
--
--   0. Lo de antes: la 0938 y la 1110 del G06 (si esta base no las tiene, se aplican aquí) y la 1220 quitada si el
--      workflow ya la pasó.
--   1. La 1220 entra: las dos funciones.
--   2. Atar como dice QBO (conta_gc_enlace_decision_externa), como un administrador de la cuenta A: atado por una
--      persona, con «QBO, Excel del 12/11 · lo cargó …» como quien decidió y su porqué; los dos enlaces de antes,
--      escritos (lo hace conta_gc_enlace_confirmar).
--   3. Lo que no se entiende (conta_gc_enlace_pendiente_externo): «propuesto», sin ficha, con el texto de QBO entre
--      comillas. Y no pisa lo que ya decidió una persona (el del paso 2 sigue atado).
--   4. Sin origen, no deja; un usuario de otra cuenta no puede.
--   5. La vuelta atrás: ninguna de las dos funciones.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q08: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

select to_regclass('public.conta_gc_enlace') is null as falta_0938 \gset
\if :falta_0938
\i supabase/migrations/20261112T0938_g06_enlace_gocardless.sql
\endif
select to_regprocedure('public.conta_gc_enlace_confirmar(uuid,text,uuid)') is null as falta_1110 \gset
\if :falta_1110
\i supabase/migrations/20261112T1110_g06_confirmar_enlace.sql
\endif
select to_regprocedure('public.conta_gc_enlace_decision_externa(uuid,text,uuid,text)') is not null as esta_1220 \gset
\if :esta_1220
\i supabase/vuelta-atras/20261124T1220_q08_decisiones_externas.down.sql
\endif

create temp table _v (clave text primary key, v text) on commit drop;
grant select on _v to authenticated;
insert into _v values ('empresa', (select id::text from public.company
    where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by (id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') desc, id limit 1)),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('otro', 'c01a0000-0000-4000-8000-0000000000b1');
do $$
declare v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa'); v_id uuid;
begin
  if v_e is null then raise exception 'PRUEBA Q08 · 0: la cuenta A no tiene ninguna empresa.'; end if;
  insert into public.party (account_id, name) values (v_acc, 'Cliente Prueba Q08 1') returning id into v_id;
  insert into _v values ('P1', v_id::text);
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id, casado_por, mandatos_vivos, suscripciones_activas) values
    (v_e, 'Q08CV1', v_acc, 'CLIENTE PRUEBA Q08 1', null, null, 1, 1),
    (v_e, 'Q08CV2', v_acc, 'CLIENTE PRUEBA Q08 2', null, null, 1, 1);
  raise notice '0 · la 0938 y la 1110 están; nada de la 1220; dos clientes de GoCardless y una ficha, inventados';
end $$;

\i supabase/migrations/20261124T1220_q08_decisiones_externas.sql

-- 1 · Entra.
do $$ begin
  if to_regprocedure('public.conta_gc_enlace_decision_externa(uuid,text,uuid,text)') is null or to_regprocedure('public.conta_gc_enlace_pendiente_externo(uuid,text,text,text)') is null then
    raise exception 'PRUEBA Q08 · 1: falta alguna de las dos funciones.';
  end if;
  raise notice '1 · la 1220 entra: las dos funciones';
end $$;

-- 2 y 3 · Como un administrador de la cuenta A: atar como dice QBO, y lo que no se entiende.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.conta_gc_enlace_decision_externa((select v::uuid from _v where clave = 'empresa'), 'Q08CV1', (select v::uuid from _v where clave = 'P1'), 'QBO, Excel del 12/11')->>'frase' as atado \gset
select public.conta_gc_enlace_pendiente_externo((select v::uuid from _v where clave = 'empresa'), 'Q08CV2', 'paga la empresa de ejemplo, mirar en Bitrix24', 'QBO, Excel del 12/11')->>'frase' as pendiente \gset
select (public.conta_gc_enlace_pendiente_externo((select v::uuid from _v where clave = 'empresa'), 'Q08CV1', 'otra cosa', 'QBO, Excel del 12/11')->>'sin_cambios')::boolean as no_pisa \gset
reset role;
\echo 2 · :atado
\echo 3 · :pendiente
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); p1 uuid := (select v::uuid from _v where clave = 'P1'); r record;
begin
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'Q08CV1';
  if r.party_id is distinct from p1 or r.por <> 'persona' or r.estado <> 'atado' or r.quien_name not like 'QBO, Excel del 12/11 · lo cargó %'
     or r.porque <> 'QBO, Excel del 12/11: es «Cliente Prueba Q08 1».' or r.decidido_at is null then
    raise exception 'PRUEBA Q08 · 2: el atado como dice QBO (%).', row_to_json(r);
  end if;
  if (select party_id from public.conta_gc_cliente where company_id = v_e and gc_id = 'Q08CV1') is distinct from p1 then
    raise exception 'PRUEBA Q08 · 2: el enlace de antes (conta_gc_cliente) no se ha escrito.';
  end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'Q08CV2';
  if r.estado <> 'propuesto' or r.party_id is not null or r.por <> 'persona'
     or r.porque <> 'Pendiente de revisar. QBO, Excel del 12/11 escribió: «paga la empresa de ejemplo, mirar en Bitrix24».' then
    raise exception 'PRUEBA Q08 · 3: el pendiente de revisar (%).', row_to_json(r);
  end if;
  if (select estado from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'Q08CV1') <> 'atado' then
    raise exception 'PRUEBA Q08 · 3: el pendiente ha pisado lo que ya decidió una persona.';
  end if;
  raise notice '2 y 3 · atado como dice QBO, con quién lo decidió; lo que no se entiende, pendiente con su texto; no pisa lo decidido';
end $$;
\if :no_pisa
\echo 3 · el pendiente no pisa lo decidido
\else
select 1/0 as pendiente_piso_lo_decidido;
\endif

-- 4 · Sin origen, no; otra cuenta, no.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'otro'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_gc_enlace_pendiente_externo((select v::uuid from _v where clave = 'empresa'), 'Q08CV2', 'algo', 'QBO, Excel del 12/11');
    raise exception 'PRUEBA Q08 · 4: un usuario de otra cuenta ha podido escribir.';
  exception when others then
    if sqlerrm like 'PRUEBA Q08%' then raise; end if;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_gc_enlace_pendiente_externo((select v::uuid from _v where clave = 'empresa'), 'Q08CV2', 'algo', '  ');
    raise exception 'PRUEBA Q08 · 4: sin origen ha dejado escribir.';
  exception when sqlstate '22023' then null;
  end;
  raise notice '4 · sin origen, no; otra cuenta, no';
end $$;
reset role;

-- 5 · La vuelta atrás.
\i supabase/vuelta-atras/20261124T1220_q08_decisiones_externas.down.sql
do $$ begin
  if to_regprocedure('public.conta_gc_enlace_decision_externa(uuid,text,uuid,text)') is not null or to_regprocedure('public.conta_gc_enlace_pendiente_externo(uuid,text,text,text)') is not null then
    raise exception 'PRUEBA Q08 · 5: la vuelta atrás deja alguna función.';
  end if;
  raise notice '5 · la vuelta atrás: ninguna de las dos';
end $$;

rollback;
