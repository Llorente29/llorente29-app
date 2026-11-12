-- supabase/staging/sql/20261112_g06_confirmar_enlace_prueba.sql
--
-- SOLO STAGING. Prueba de la 1110 (G06 · tarea 3), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Cambia en caliente public.conta_gc_enlace (columna antes y el CHECK de estado, que solo amplía) y
-- public._conta_gestoria_juntar (misma firma); añade _conta_gc_enlace_guardar, conta_gc_enlace_confirmar,
-- conta_gc_enlace_sin_ficha y conta_gc_enlace_deshacer.
-- En la empresa A de staging (o en otra de la cuenta A, en la base local del W09), con fichas y clientes de
-- GoCardless inventados (T11).
--
--   0. Lo de antes: la 0938 (si no está, como en la base local, se aplica aquí), la 1110 quitada si el workflow ya la
--      pasó, y la huella de _conta_gestoria_juntar.
--   1. La 1110 entra: la columna antes y el estado «sin_ficha».
--   2. Lo que escribe la lectura (_conta_gc_enlace_guardar): la propuesta, lo automático, y la guarda: lo automático no
--      pisa lo de una persona ni un conflicto; lo de una persona más antiguo no pisa una decisión más nueva.
--   3. «Es esta» (conta_gc_enlace_confirmar), como un administrador de la cuenta A: el enlace de una persona con
--      quién y cuándo, los dos enlaces de antes, la decisión y la diferencia «sin ficha» cerrada. La lectura de
--      después no lo pisa.
--   4. Deshacer: todo como estaba (la propuesta, los dos de antes, sin decisión, la diferencia abierta).
--   5. «No tiene ficha en Bitrix24», y su deshacer; con un cliente atado por NIF, no deja; pasados 30 s, no se deshace.
--   6. Un usuario de otra cuenta no puede confirmar.
--   7. Juntar dos fichas: el enlace de una persona pasa a la que queda, y en las candidatas la que se va se cambia.
--   8. La vuelta atrás: nada de la 1110, el CHECK de antes y _conta_gestoria_juntar con la huella del principio.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA G06 · 3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 0 · La 0938, si esta base no la tiene (la local del W09); en staging ya está de verdad desde el #627.
select to_regclass('public.conta_gc_enlace') is null as falta_0938 \gset
\if :falta_0938
\i supabase/migrations/20261112T0938_g06_enlace_gocardless.sql
\endif
-- La 1110 puede estar ya en esta transacción (el workflow pasa la línea de la migración antes que su prueba): primero
-- su vuelta atrás, para probarla desde lo de antes.
select to_regprocedure('public.conta_gc_enlace_confirmar(uuid,text,uuid)') is not null as esta_1110 \gset
\if :esta_1110
\i supabase/vuelta-atras/20261112T1110_g06_confirmar_enlace.down.sql
\endif

create temp table _v (clave text primary key, v text) on commit drop;
grant select on _v to authenticated;
insert into _v values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', (select id::text from public.company
    where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by (id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') desc, id limit 1)),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('otro', 'c01a0000-0000-4000-8000-0000000000b1'),
  ('juntar', (select md5(prosrc) from pg_proc where oid = 'public._conta_gestoria_juntar(uuid,uuid,uuid,text)'::regprocedure));
do $$ begin
  if (select v from _v where clave = 'empresa') is null then raise exception 'PRUEBA G06 · 3 · 0: la cuenta A no tiene ninguna empresa.'; end if;
  if to_regprocedure('public.conta_gc_enlace_confirmar(uuid,text,uuid)') is not null then raise exception 'PRUEBA G06 · 3 · 0: la 1110 ya estaba.'; end if;
  raise notice '0 · la 0938 está; la huella de _conta_gestoria_juntar, tomada; nada de la 1110';
end $$;

-- Los datos inventados: cuatro fichas, cuatro clientes de GoCardless y una diferencia «sin ficha».
do $$
declare v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa'); i int; v_id uuid; v_l uuid;
begin
  for i in 1..4 loop
    insert into public.party (account_id, name) values (v_acc, 'Cliente Prueba G06c ' || i) returning id into v_id;
    insert into _v values ('P' || i, v_id::text);
  end loop;
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id, casado_por, mandatos_vivos, suscripciones_activas) values
    (v_e, 'G06CV1', v_acc, 'CLIENTE PRUEBA G06C 1', null, null, 1, 1),
    (v_e, 'G06CV2', v_acc, 'CLIENTE PRUEBA G06C 2', null, null, 1, 1),
    (v_e, 'G06CV3', v_acc, 'CLIENTE PRUEBA G06C 3', null, null, 1, 1),
    (v_e, 'G06CV4', v_acc, 'CLIENTE PRUEBA G06C 4', null, null, 1, 1);
  insert into public.conta_gestoria_lectura (account_id, origen, entorno, por, estado) values (v_acc, 'gocardless', 'pruebas', 'persona', 'bien') returning id into v_l;
  insert into public.conta_gestoria_diferencia (account_id, lectura_id, company_id, gc_cliente_id, tipo, porque_codigo, porque)
    values (v_acc, v_l, v_e, 'G06CV1', 'gocardless_sin_ficha', 'gocardless_sin_ficha', 'Prueba G06c: sin ficha.') returning id into v_id;
  insert into _v values ('dif', v_id::text);
end $$;

\i supabase/migrations/20261112T1110_g06_confirmar_enlace.sql

-- 1 · Entra.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_enlace' and column_name = 'antes') then
    raise exception 'PRUEBA G06 · 3 · 1: falta la columna antes.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'conta_gc_enlace_estado_check' and conrelid = 'public.conta_gc_enlace'::regclass)) not like '%sin_ficha%' then
    raise exception 'PRUEBA G06 · 3 · 1: el CHECK de estado no admite sin_ficha.';
  end if;
  raise notice '1 · la 1110 entra: la columna antes y el estado sin_ficha';
end $$;

-- 2 · Lo que escribe la lectura.
do $$
declare
  v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa'); r record; n int;
  p1 uuid := (select v::uuid from _v where clave = 'P1'); p2 uuid := (select v::uuid from _v where clave = 'P2');
  p3 uuid := (select v::uuid from _v where clave = 'P3'); p4 uuid := (select v::uuid from _v where clave = 'P4');
begin
  -- Lo que ya había: CV3 de una persona (hoy) y CV4 en conflicto.
  insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, quien_name, decidido_at) values
    (v_e, 'G06CV3', v_acc, p3, 'persona', 'atado', 'Persona Prueba', now());
  insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado, candidatas, porque) values
    (v_e, 'G06CV4', v_acc, null, 'correo', 'conflicto', array[p3, p4], 'Prueba: dos fichas.');
  n := public._conta_gc_enlace_guardar(jsonb_build_array(
    jsonb_build_object('company_id', v_e, 'gc_cliente_id', 'G06CV1', 'account_id', v_acc, 'party_id', null, 'por', 'nombre', 'estado', 'propuesto',
                       'candidatas', jsonb_build_array(p1, p2), 'porque', 'Se llama igual que 2 fichas.'),
    jsonb_build_object('company_id', v_e, 'gc_cliente_id', 'G06CV2', 'account_id', v_acc, 'party_id', p1, 'por', 'nif', 'estado', 'atado', 'candidatas', '[]'::jsonb),
    jsonb_build_object('company_id', v_e, 'gc_cliente_id', 'G06CV3', 'account_id', v_acc, 'party_id', p2, 'por', 'correo', 'estado', 'atado', 'candidatas', '[]'::jsonb),
    jsonb_build_object('company_id', v_e, 'gc_cliente_id', 'G06CV4', 'account_id', v_acc, 'party_id', p4, 'por', 'correo', 'estado', 'atado', 'candidatas', '[]'::jsonb),
    jsonb_build_object('company_id', v_e, 'gc_cliente_id', 'G06CV3', 'account_id', v_acc, 'party_id', p4, 'por', 'persona', 'estado', 'atado',
                       'candidatas', '[]'::jsonb, 'decidido_at', now() - interval '1 day')));
  if n <> 2 then raise exception 'PRUEBA G06 · 3 · 2: la lectura tenía que escribir 2 filas (la propuesta y la de NIF) y ha escrito %.', n; end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV1';
  if r.estado <> 'propuesto' or r.party_id is not null or r.candidatas <> array[p1, p2] or r.porque is null then raise exception 'PRUEBA G06 · 3 · 2: la propuesta (%).', row_to_json(r); end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV3';
  if r.party_id is distinct from p3 or r.por <> 'persona' then raise exception 'PRUEBA G06 · 3 · 2: lo automático o una decisión más antigua ha pisado lo de una persona (%).', row_to_json(r); end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV4';
  if r.estado <> 'conflicto' then raise exception 'PRUEBA G06 · 3 · 2: lo automático ha pisado un conflicto (%).', row_to_json(r); end if;
  raise notice '2 · la lectura: la propuesta y lo de NIF, sí; lo de una persona y el conflicto, no se pisan';
end $$;

-- 3 · «Es esta», como un administrador de la cuenta A.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.conta_gc_enlace_confirmar((select v::uuid from _v where clave = 'empresa'), 'G06CV1', (select v::uuid from _v where clave = 'P2'))->>'frase' as frase \gset
reset role;
\echo 3 · «Es esta»: :frase
do $$
declare
  v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa'); r record;
  p1 uuid := (select v::uuid from _v where clave = 'P1'); p2 uuid := (select v::uuid from _v where clave = 'P2');
begin
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV1';
  if r.party_id is distinct from p2 or r.por <> 'persona' or r.estado <> 'atado' or r.quien is distinct from (select v::uuid from _v where clave = 'usuario')
     or r.decidido_at is null or r.antes->'enlace'->>'estado' <> 'propuesto' or r.candidatas <> array[p1, p2] then
    raise exception 'PRUEBA G06 · 3 · 3: el enlace de una persona (%).', row_to_json(r);
  end if;
  if (select party_id from public.conta_gc_cliente where company_id = v_e and gc_id = 'G06CV1') is distinct from p2
     or (select gc_cliente_id from public.conta_cobro_cliente where company_id = v_e and party_id = p2) is distinct from 'G06CV1' then
    raise exception 'PRUEBA G06 · 3 · 3: los dos enlaces de antes no se han escrito.';
  end if;
  if not exists (select 1 from public.conta_gestoria_decision where company_id = v_e and gc_cliente_id = 'G06CV1' and tipo = 'enlace' and party_id = p2) then
    raise exception 'PRUEBA G06 · 3 · 3: falta la decisión.';
  end if;
  if (select vigente from public.conta_gestoria_diferencia where id = (select v::uuid from _v where clave = 'dif')) then
    raise exception 'PRUEBA G06 · 3 · 3: la diferencia «sin ficha» sigue abierta.';
  end if;
  -- La lectura de después vuelve a proponer CV1: no lo pisa.
  perform public._conta_gc_enlace_guardar(jsonb_build_array(jsonb_build_object('company_id', v_e, 'gc_cliente_id', 'G06CV1', 'account_id', v_acc,
    'party_id', null, 'por', 'nombre', 'estado', 'propuesto', 'candidatas', jsonb_build_array(p1, p2), 'porque', 'Otra vez.')));
  if (select por from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV1') <> 'persona' then
    raise exception 'PRUEBA G06 · 3 · 3: la lectura ha pisado la confirmación.';
  end if;
  raise notice '3 · «Es esta»: de una persona, con quién y cuándo; los dos de antes, la decisión y la diferencia cerrada; la lectura no lo pisa';
end $$;

-- 4 · Deshacer.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.conta_gc_enlace_deshacer((select v::uuid from _v where clave = 'empresa'), 'G06CV1')->>'frase' as frase \gset
reset role;
\echo 4 · deshacer: :frase
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); r record;
  p1 uuid := (select v::uuid from _v where clave = 'P1'); p2 uuid := (select v::uuid from _v where clave = 'P2');
begin
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV1';
  if r.estado <> 'propuesto' or r.por <> 'nombre' or r.party_id is not null or r.candidatas <> array[p1, p2] or r.antes is not null then
    raise exception 'PRUEBA G06 · 3 · 4: la propuesta no ha vuelto como estaba (%).', row_to_json(r);
  end if;
  if (select party_id from public.conta_gc_cliente where company_id = v_e and gc_id = 'G06CV1') is not null
     or exists (select 1 from public.conta_cobro_cliente where company_id = v_e and party_id = p2)
     or exists (select 1 from public.conta_gestoria_decision where company_id = v_e and gc_cliente_id = 'G06CV1')
     or not (select vigente from public.conta_gestoria_diferencia where id = (select v::uuid from _v where clave = 'dif')) then
    raise exception 'PRUEBA G06 · 3 · 4: los dos de antes, la decisión o la diferencia no han vuelto como estaban.';
  end if;
  raise notice '4 · deshacer: la propuesta, los dos de antes, sin decisión y la diferencia abierta, como estaban';
end $$;

-- 5 · «No tiene ficha en Bitrix24», y su deshacer; con uno atado por NIF no deja; pasados 30 s, no se deshace.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.conta_gc_enlace_sin_ficha((select v::uuid from _v where clave = 'empresa'), 'G06CV1')->>'frase' as frase \gset
\echo 5 · sin ficha: :frase
do $$
declare v_e uuid := (select v::uuid from _v where clave = 'empresa'); r record;
begin
  select estado, por, party_id into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV1';
  if r.estado <> 'sin_ficha' or r.por <> 'persona' or r.party_id is not null then raise exception 'PRUEBA G06 · 3 · 5: sin ficha (%).', row_to_json(r); end if;
  begin
    perform public.conta_gc_enlace_sin_ficha(v_e, 'G06CV2');
    raise exception 'PRUEBA G06 · 3 · 5: ha dejado decir «sin ficha» de uno atado por NIF.';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Está enlazado con%' then raise; end if;
  end;
  perform public.conta_gc_enlace_deshacer(v_e, 'G06CV1');
  if (select estado from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV1') <> 'propuesto' then
    raise exception 'PRUEBA G06 · 3 · 5: el deshacer de «sin ficha».';
  end if;
  perform public.conta_gc_enlace_sin_ficha(v_e, 'G06CV1');
end $$;
reset role;
update public.conta_gc_enlace set decidido_at = now() - interval '1 minute' where gc_cliente_id = 'G06CV1';
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_gc_enlace_deshacer((select v::uuid from _v where clave = 'empresa'), 'G06CV1');
    raise exception 'PRUEBA G06 · 3 · 5: se ha deshecho pasado el plazo.';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Ya no se puede deshacer%' then raise; end if;
  end;
  raise notice '5 · sin ficha: se guarda y se deshace; con uno atado por NIF no deja; pasados 30 s, no se deshace';
end $$;
reset role;

-- 6 · Otra cuenta no confirma.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'otro'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_gc_enlace_confirmar((select v::uuid from _v where clave = 'empresa'), 'G06CV2', (select v::uuid from _v where clave = 'P2'));
    raise exception 'PRUEBA G06 · 3 · 6: un usuario de otra cuenta ha confirmado.';
  exception when insufficient_privilege then null;
  end;
  raise notice '6 · un usuario de otra cuenta no confirma';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 7 · Juntar: P4 se va y queda P1. Antes, una persona ata CV2 a P4.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.conta_gc_enlace_confirmar((select v::uuid from _v where clave = 'empresa'), 'G06CV2', (select v::uuid from _v where clave = 'P4')) is not null as ok \gset
reset role;
select set_config('request.jwt.claims', '', true);
do $$
declare v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa'); r record; j jsonb;
  p1 uuid := (select v::uuid from _v where clave = 'P1'); p3 uuid := (select v::uuid from _v where clave = 'P3'); p4 uuid := (select v::uuid from _v where clave = 'P4');
begin
  j := public._conta_gestoria_juntar(v_acc, p1, p4, 'prueba G06');
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV2';
  if r.party_id is distinct from p1 or r.por <> 'persona' or r.estado <> 'atado' then raise exception 'PRUEBA G06 · 3 · 7: el enlace de una persona no ha pasado a la que queda (%).', row_to_json(r); end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CV4';
  if r.candidatas <> (select array_agg(c order by c) from unnest(array[p1, p3]) c) then raise exception 'PRUEBA G06 · 3 · 7: las candidatas (%).', row_to_json(r); end if;
  if not (select moved ? 'conta_gc_enlace' and moved ? 'conta_gc_enlace_candidatas' from public.conta_gestoria_union where id = (j->>'union')::uuid) then
    raise exception 'PRUEBA G06 · 3 · 7: el rastro de la unión no guarda los enlaces como estaban.';
  end if;
  raise notice '7 · juntar: %', j->>'resumen';
end $$;

-- 8 · La vuelta atrás.
\i supabase/vuelta-atras/20261112T1110_g06_confirmar_enlace.down.sql
do $$ begin
  if to_regprocedure('public.conta_gc_enlace_confirmar(uuid,text,uuid)') is not null or to_regprocedure('public.conta_gc_enlace_deshacer(uuid,text)') is not null
     or to_regprocedure('public.conta_gc_enlace_sin_ficha(uuid,text)') is not null or to_regprocedure('public._conta_gc_enlace_guardar(jsonb)') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_gc_enlace' and column_name = 'antes') then
    raise exception 'PRUEBA G06 · 3 · 8: la vuelta atrás deja algo de la 1110.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'conta_gc_enlace_estado_check' and conrelid = 'public.conta_gc_enlace'::regclass)) like '%sin_ficha%' then
    raise exception 'PRUEBA G06 · 3 · 8: el CHECK de estado no ha vuelto.';
  end if;
  if (select md5(prosrc) from pg_proc where oid = 'public._conta_gestoria_juntar(uuid,uuid,uuid,text)'::regprocedure) is distinct from (select v from _v where clave = 'juntar') then
    raise exception 'PRUEBA G06 · 3 · 8: _conta_gestoria_juntar no ha vuelto a la de antes (huella distinta).';
  end if;
  raise notice '8 · la vuelta atrás: nada de la 1110, el CHECK de antes y _conta_gestoria_juntar con su huella del principio';
end $$;

rollback;
