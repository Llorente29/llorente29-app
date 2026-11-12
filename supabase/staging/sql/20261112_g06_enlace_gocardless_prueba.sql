-- supabase/staging/sql/20261112_g06_enlace_gocardless_prueba.sql
--
-- SOLO STAGING. Prueba de la 0938 (G06, solo añade), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- En la empresa A de staging (o en otra de la cuenta A, en la base local del W09), con clientes de GoCardless y fichas inventados (T11).
--
--   0. Lo de antes: la huella de los dos enlaces de ahora (conta_gc_cliente.party_id y
--      conta_cobro_cliente.gc_cliente_id) de la cuenta A, y nada de la 0938 (tras su vuelta atrás, por si W05 la dejó).
--   1. El relleno, caso a caso:
--      · G06CU1: los dos enlaces dicen P1 → atado, por correo;
--      · G06CU2: solo conta_cobro_cliente lo ata (el caso de los 108 de QBO) → atado a P2;
--      · G06CU3: conta_gc_cliente dice P3 y conta_cobro_cliente P4 → conflicto, con las dos candidatas y sin ficha;
--      · G06CU4: conta_gc_cliente dice P3, pero una persona lo enlazó a P5 → atado a P5, por persona, con quién y cuándo;
--      · G06CU5: conta_gc_cliente dice P1 (por NIF), con más mandatos vivos que G06CU1.
--   2. La vista del elegido: de P1, G06CU5 (más mandatos vivos); de P5, G06CU4 (persona); P3 y P4 no tienen elegido.
--   3. «Atado» sin ficha no se puede guardar.
--   4. Quién lee: un usuario de la cuenta A ve sus enlaces; uno de otra cuenta, ninguno (también en la vista).
--   5. La vuelta atrás: nada de la 0938, y los dos enlaces de ahora con la huella del principio.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA G06: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- Solo añade y puede estar ya de verdad (W05): primero su vuelta atrás.
\i supabase/vuelta-atras/20261112T0938_g06_enlace_gocardless.down.sql

create temp table _v (clave text primary key, v text) on commit drop;
grant select on _v to authenticated;
-- La empresa A de staging (3b34403a…); en una base sin ella (la local del W09), otra de la cuenta A.
insert into _v values ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', (select id::text from public.company
    where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by (id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') desc, id limit 1)),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1'), ('otro', 'c01a0000-0000-4000-8000-0000000000b1');
create temp table _huella on commit drop as
  select (select md5(coalesce(string_agg(g.company_id || g.gc_id || coalesce(g.party_id::text, '-') || coalesce(g.casado_por, '-'), ',' order by g.company_id, g.gc_id), ''))
            from public.conta_gc_cliente g where g.account_id = 'c01a0000-0000-4000-8000-00000000000a') gc,
         (select md5(coalesce(string_agg(c.company_id || c.party_id::text || coalesce(c.gc_cliente_id, '-') || coalesce(c.gc_casado_por, '-'), ',' order by c.company_id, c.party_id), ''))
            from public.conta_cobro_cliente c where c.account_id = 'c01a0000-0000-4000-8000-00000000000a') cc;
do $$ begin
  if to_regclass('public.conta_gc_enlace') is not null or to_regclass('public.conta_gc_enlace_elegido') is not null then
    raise exception 'PRUEBA G06 · 0: lo de la 0938 ya estaba antes de aplicarla.';
  end if;
  if (select v from _v where clave = 'empresa') is null then
    raise exception 'PRUEBA G06 · 0: la cuenta A no tiene ninguna empresa.';
  end if;
  raise notice '0 · la huella de los dos enlaces de ahora, tomada; nada de la 0938';
end $$;

-- Los datos inventados: cinco fichas y cinco clientes de GoCardless de la empresa A.
do $$
declare v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; i int; v_id uuid;
begin
  for i in 1..5 loop
    if not exists (select 1 from _v where clave = 'P' || i) then
      insert into public.party (account_id, name) values (v_acc, 'Cliente Prueba G06 ' || i) returning id into v_id;
      insert into _v values ('P' || i, v_id::text);
    end if;
  end loop;
end $$;

do $$
declare
  v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa');
  p1 uuid := (select v::uuid from _v where clave = 'P1'); p2 uuid := (select v::uuid from _v where clave = 'P2'); p3 uuid := (select v::uuid from _v where clave = 'P3');
  p4 uuid := (select v::uuid from _v where clave = 'P4'); p5 uuid := (select v::uuid from _v where clave = 'P5');
begin
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id, casado_por, mandatos_vivos, suscripciones_activas) values
    (v_e, 'G06CU1', v_acc, 'CLIENTE PRUEBA G06 1', p1, 'correo', 1, 1),
    (v_e, 'G06CU2', v_acc, 'CLIENTE PRUEBA G06 2', null, null, 1, 1),
    (v_e, 'G06CU3', v_acc, 'CLIENTE PRUEBA G06 3', p3, 'nif', 1, 1),
    (v_e, 'G06CU4', v_acc, 'CLIENTE PRUEBA G06 4', p3, 'correo', 0, 1),
    (v_e, 'G06CU5', v_acc, 'CLIENTE PRUEBA G06 5', p1, 'nif', 3, 1);
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, gc_cliente_id, gc_casado_por) values
    (v_e, p1, v_acc, 'G06CU1', 'correo'), (v_e, p2, v_acc, 'G06CU2', 'correo'), (v_e, p4, v_acc, 'G06CU3', 'correo')
  on conflict (company_id, party_id) do update set gc_cliente_id = excluded.gc_cliente_id, gc_casado_por = excluded.gc_casado_por;
  insert into public.conta_gestoria_decision (account_id, company_id, tipo, party_id, gc_cliente_id, frase, quien, quien_name, cuando)
    values (v_acc, v_e, 'enlace', p5, 'G06CU4', 'Prueba G06: enlazado a mano.', 'c01a0000-0000-4000-8000-0000000000a1', 'Persona Prueba', '2026-11-11 10:00:00+00');
end $$;

\i supabase/migrations/20261112T0938_g06_enlace_gocardless.sql

-- 1 · El relleno, caso a caso.
do $$
declare
  v_e uuid := (select v::uuid from _v where clave = 'empresa'); r record;
  p1 uuid := (select v::uuid from _v where clave = 'P1'); p2 uuid := (select v::uuid from _v where clave = 'P2'); p3 uuid := (select v::uuid from _v where clave = 'P3');
  p4 uuid := (select v::uuid from _v where clave = 'P4'); p5 uuid := (select v::uuid from _v where clave = 'P5');
begin
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CU1';
  if r.party_id is distinct from p1 or r.estado <> 'atado' or r.por <> 'correo' then raise exception 'PRUEBA G06 · 1: G06CU1 (%).', row_to_json(r); end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CU2';
  if r.party_id is distinct from p2 or r.estado <> 'atado' then raise exception 'PRUEBA G06 · 1: G06CU2, el caso de los 108 (%).', row_to_json(r); end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CU3';
  if r.estado <> 'conflicto' or r.party_id is not null or not (r.candidatas @> array[p3, p4] and cardinality(r.candidatas) = 2) or r.porque is null then
    raise exception 'PRUEBA G06 · 1: G06CU3 tenía que quedar en conflicto con P3 y P4 (%).', row_to_json(r);
  end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CU4';
  if r.party_id is distinct from p5 or r.por <> 'persona' or r.estado <> 'atado' or r.quien_name <> 'Persona Prueba' or r.decidido_at is null then
    raise exception 'PRUEBA G06 · 1: G06CU4, lo de una persona manda (%).', row_to_json(r);
  end if;
  select * into r from public.conta_gc_enlace where company_id = v_e and gc_cliente_id = 'G06CU5';
  if r.party_id is distinct from p1 or r.por <> 'nif' then raise exception 'PRUEBA G06 · 1: G06CU5 (%).', row_to_json(r); end if;
  raise notice '1 · el relleno: los que coinciden, el de los 108, el conflicto (P3 y P4) y el de una persona, cada uno en su sitio';
end $$;

-- 2 · La vista del elegido.
do $$
declare
  v_e uuid := (select v::uuid from _v where clave = 'empresa');
  p1 uuid := (select v::uuid from _v where clave = 'P1'); p3 uuid := (select v::uuid from _v where clave = 'P3');
  p4 uuid := (select v::uuid from _v where clave = 'P4'); p5 uuid := (select v::uuid from _v where clave = 'P5');
begin
  if (select gc_cliente_id from public.conta_gc_enlace_elegido where company_id = v_e and party_id = p1) is distinct from 'G06CU5' then
    raise exception 'PRUEBA G06 · 2: el elegido de P1 tenía que ser G06CU5 (más mandatos vivos).';
  end if;
  if (select gc_cliente_id from public.conta_gc_enlace_elegido where company_id = v_e and party_id = p5) is distinct from 'G06CU4' then
    raise exception 'PRUEBA G06 · 2: el elegido de P5 tenía que ser G06CU4.';
  end if;
  if exists (select 1 from public.conta_gc_enlace_elegido where company_id = v_e and party_id in (p3, p4)) then
    raise exception 'PRUEBA G06 · 2: un conflicto no tiene elegido.';
  end if;
  if (select count(*) from public.conta_gc_enlace_elegido where company_id = v_e and party_id = p1) <> 1 then
    raise exception 'PRUEBA G06 · 2: una ficha, un elegido por empresa.';
  end if;
  raise notice '2 · el elegido: el de más mandatos vivos, el de una persona, y ninguno en un conflicto';
end $$;

-- 3 · «Atado» sin ficha no se puede guardar.
do $$ begin
  begin
    insert into public.conta_gc_enlace (company_id, gc_cliente_id, account_id, party_id, por, estado)
      values ((select v::uuid from _v where clave = 'empresa'), 'G06CU9', 'c01a0000-0000-4000-8000-00000000000a', null, 'correo', 'atado');
    raise exception 'PRUEBA G06 · 3: se ha guardado un enlace atado sin ficha.';
  exception when check_violation then null;
  end;
  raise notice '3 · atado sin ficha: no se guarda';
end $$;

-- 4 · Quién lee.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.conta_gc_enlace where company_id = (select v::uuid from _v where clave = 'empresa') and gc_cliente_id like 'G06CU%') <> 5 then
    raise exception 'PRUEBA G06 · 4: el usuario de la cuenta A no ve sus enlaces.';
  end if;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _v where clave = 'otro'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.conta_gc_enlace where company_id = (select v::uuid from _v where clave = 'empresa'))
     or exists (select 1 from public.conta_gc_enlace_elegido where company_id = (select v::uuid from _v where clave = 'empresa')) then
    raise exception 'PRUEBA G06 · 4: un usuario de otra cuenta ve los enlaces de la A.';
  end if;
  raise notice '4 · quién lee: la cuenta A ve los suyos; otra cuenta, ninguno (tabla y vista)';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 5 · La vuelta atrás. Los datos inventados se quitan antes, para comparar la huella con la del principio.
do $$
declare v_acc uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid := (select v::uuid from _v where clave = 'empresa');
begin
  delete from public.conta_gestoria_decision where company_id = v_e and gc_cliente_id = 'G06CU4' and frase = 'Prueba G06: enlazado a mano.';
  delete from public.conta_cobro_cliente where company_id = v_e and gc_cliente_id like 'G06CU%';
  delete from public.conta_gc_cliente where company_id = v_e and gc_id like 'G06CU%';
end $$;
\i supabase/vuelta-atras/20261112T0938_g06_enlace_gocardless.down.sql
do $$ begin
  if to_regclass('public.conta_gc_enlace') is not null or to_regclass('public.conta_gc_enlace_elegido') is not null then
    raise exception 'PRUEBA G06 · 5: la vuelta atrás deja algo de la 0938.';
  end if;
  if (select md5(coalesce(string_agg(g.company_id || g.gc_id || coalesce(g.party_id::text, '-') || coalesce(g.casado_por, '-'), ',' order by g.company_id, g.gc_id), ''))
        from public.conta_gc_cliente g where g.account_id = 'c01a0000-0000-4000-8000-00000000000a') is distinct from (select gc from _huella)
     or (select md5(coalesce(string_agg(c.company_id || c.party_id::text || coalesce(c.gc_cliente_id, '-') || coalesce(c.gc_casado_por, '-'), ',' order by c.company_id, c.party_id), ''))
        from public.conta_cobro_cliente c where c.account_id = 'c01a0000-0000-4000-8000-00000000000a') is distinct from (select cc from _huella) then
    raise exception 'PRUEBA G06 · 5: los dos enlaces de ahora no han quedado como estaban.';
  end if;
  raise notice '5 · la vuelta atrás: nada de la 0938, y los dos enlaces de ahora con su huella del principio';
end $$;

rollback;
