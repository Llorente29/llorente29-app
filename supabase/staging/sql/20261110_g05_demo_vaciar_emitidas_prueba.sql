-- supabase/staging/sql/20261110_g05_demo_vaciar_emitidas_prueba.sql
--
-- SOLO STAGING. La 1452 (G05 · nº 86: «Volver a empezar» de la demo puede vaciar
-- sus facturas emitidas y sus asientos validados), con datos inventados (T11), en
-- una transacción con ROLLBACK. Por los DOS lados:
--   1. La 1452, dos veces.
--   2. En la cuenta A (de demostración, solo dentro de esta prueba) y en la B (no
--      lo es): una factura emitida con su línea y un asiento validado con su
--      apunte en cada una. Se montan con los disparadores apagados y se vuelven a
--      encender antes de probar nada.
--   3. La regla sigue para todos: sin la marca, ni en la demo se borra nada; con la
--      marca de OTRA cuenta, tampoco; en la cuenta B, ni con su marca puesta a
--      mano; y _conta_demo_permitir_vaciar no deja marcar la B.
--   4. Nadie de fuera puede poner la marca: authenticated no puede llamar a
--      _conta_demo_permitir_vaciar ni a _conta_demo_vaciando.
--   5. En la demo, con la marca: se borran la línea, la factura, el apunte y el
--      asiento. Y la B sigue entera.
--   6. La vuelta atrás de la 1452 (las cuatro como estaban: en la demo con la marca
--      ya no se borra), y otra vez la 1452.
-- sin usuario: lo que se prueba son disparadores, que saltan igual para cualquiera; el punto 4 entra como usuario.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA G05 VACIAR: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

-- 1 · La 1452, dos veces.
\i supabase/migrations/20261110T1452_g05_demo_vaciar_emitidas.sql
\i supabase/migrations/20261110T1452_g05_demo_vaciar_emitidas.sql
do $$ begin
  if to_regprocedure('public._conta_demo_vaciando(uuid)') is null or to_regprocedure('public._conta_demo_permitir_vaciar(uuid)') is null then
    raise exception 'G05 VACIAR · 1: falta algo de la 1452.';
  end if;
  raise notice 'G05 VACIAR · 1: la 1452 carga, y dos veces. OK';
end $$;

-- 2 · Lo de antes, inventado: A de demostración (solo aquí), B no.
create temp table _g (clave text primary key, v text) on commit drop;
update public.accounts set is_demo = true where id = 'c01a0000-0000-4000-8000-00000000000a';
update public.accounts set is_demo = false where id = 'c01b0000-0000-4000-8000-00000000000b';
set local session_replication_role = replica;
do $$
declare cta uuid; e uuid; c uuid; f uuid; j uuid; k text;
begin
  foreach k in array array['a', 'b'] loop
    cta := case k when 'a' then 'c01a0000-0000-4000-8000-00000000000a'::uuid else 'c01b0000-0000-4000-8000-00000000000b'::uuid end;
    select id into e from public.company where account_id = cta order by created_at limit 1;
    if e is null then raise exception 'PRUEBA G05 VACIAR · 0: la cuenta % no tiene empresa.', k; end if;
    insert into public.party (account_id, name, tax_id) values (cta, 'Cliente Prueba Vaciar ' || k, 'B0000098' || case k when 'a' then '6' else '7' end) returning id into c;
    insert into public.customer_invoice (account_id, company_id, party_id, status, number, number_text, fiscal_year, base, total)
    values (cta, e, c, 'emitida', 9001, 'PRUEBA/V' || k, 2026, 100, 121) returning id into f;
    insert into public.customer_invoice_line (account_id, company_id, invoice_id, position, concept, tax_rate_id, tax_pct, revenue_account_id, amount)
    values (cta, e, f, 1, 'Servicio prueba', gen_random_uuid(), 21, gen_random_uuid(), 100);
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, number, validated_at, hash, chain_seq)
    values (cta, e, gen_random_uuid(), 1, '2026-11-10', 'Asiento prueba vaciar', 'sales_day', 'validado', 9001, now(), 'prueba', 9001) returning id into j;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit) values (cta, e, j, 1, gen_random_uuid(), 121);
    insert into _g values ('f' || k, f), ('j' || k, j);
  end loop;
end $$;
set local session_replication_role = origin;

-- 3 · La regla sigue: sin la marca, con la de otra cuenta, y en una cuenta que no es demo.
do $$
declare fa uuid := (select v::uuid from _g where clave = 'fa'); ja uuid := (select v::uuid from _g where clave = 'ja');
        fb uuid := (select v::uuid from _g where clave = 'fb'); jb uuid := (select v::uuid from _g where clave = 'jb'); m text; quien text;
begin
  foreach m in array array['', 'c01b0000-0000-4000-8000-00000000000b', 'c01c0000-0000-4000-8000-00000000000c'] loop
    perform set_config('folvy.demo_vaciando', m, true);
    quien := case when m = '' then 'sin la marca' else 'con la marca de otra cuenta' end;
    begin delete from public.customer_invoice_line where invoice_id = fa; raise exception 'G05 VACIAR · 3: la demo, %, ha borrado una línea de factura emitida.', quien;
    exception when sqlstate '23514' then null; end;
    begin delete from public.customer_invoice where id = fa; raise exception 'G05 VACIAR · 3: la demo, %, ha borrado una factura emitida.', quien;
    exception when sqlstate '23514' then null; end;
    begin delete from public.journal_line where entry_id = ja; raise exception 'G05 VACIAR · 3: la demo, %, ha borrado un apunte validado.', quien;
    exception when sqlstate '42501' then null; end;
    begin delete from public.journal_entry where id = ja; raise exception 'G05 VACIAR · 3: la demo, %, ha borrado un asiento validado.', quien;
    exception when sqlstate '42501' then null; end;
  end loop;
  -- La B, con su propia marca puesta a mano: no es de demostración, la regla manda.
  perform set_config('folvy.demo_vaciando', 'c01b0000-0000-4000-8000-00000000000b', true);
  begin delete from public.customer_invoice_line where invoice_id = fb; raise exception 'G05 VACIAR · 3: la cuenta B ha borrado una línea de factura emitida.';
  exception when sqlstate '23514' then null; end;
  begin delete from public.customer_invoice where id = fb; raise exception 'G05 VACIAR · 3: la cuenta B ha borrado una factura emitida.';
  exception when sqlstate '23514' then null; end;
  begin delete from public.journal_line where entry_id = jb; raise exception 'G05 VACIAR · 3: la cuenta B ha borrado un apunte validado.';
  exception when sqlstate '42501' then null; end;
  begin delete from public.journal_entry where id = jb; raise exception 'G05 VACIAR · 3: la cuenta B ha borrado un asiento validado.';
  exception when sqlstate '42501' then null; end;
  begin update public.customer_invoice set total = 1 where id = fb; raise exception 'G05 VACIAR · 3: la cuenta B ha cambiado una factura emitida.';
  exception when sqlstate '23514' then null; end;
  begin perform public._conta_demo_permitir_vaciar('c01b0000-0000-4000-8000-00000000000b'); raise exception 'G05 VACIAR · 3: se ha dejado marcar una cuenta que no es demo.';
  exception when sqlstate '42501' then null; end;
  perform set_config('folvy.demo_vaciando', '', true);
  raise notice 'G05 VACIAR · 3: sin la marca, con la de otra cuenta y en una cuenta que no es demo, la regla sigue (nada se borra ni se cambia). OK';
end $$;

-- 4 · Nadie de fuera puede poner la marca.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$ begin
  begin perform public._conta_demo_permitir_vaciar('c01a0000-0000-4000-8000-00000000000a'); raise exception 'G05 VACIAR · 4: un usuario ha podido poner la marca.';
  exception when insufficient_privilege then null; end;
  begin perform public._conta_demo_vaciando('c01a0000-0000-4000-8000-00000000000a'); raise exception 'G05 VACIAR · 4: un usuario ha podido llamar a _conta_demo_vaciando.';
  exception when insufficient_privilege then null; end;
  raise notice 'G05 VACIAR · 4: un usuario no puede poner la marca. OK';
end $$;
reset role;

-- 5 · En la demo, con la marca: se va todo. La B, entera.
do $$
declare fa uuid := (select v::uuid from _g where clave = 'fa'); ja uuid := (select v::uuid from _g where clave = 'ja');
        fb uuid := (select v::uuid from _g where clave = 'fb'); jb uuid := (select v::uuid from _g where clave = 'jb');
begin
  perform public._conta_demo_permitir_vaciar('c01a0000-0000-4000-8000-00000000000a');
  delete from public.customer_invoice_line where invoice_id = fa;
  delete from public.customer_invoice where id = fa;
  delete from public.journal_line where entry_id = ja;
  delete from public.journal_entry where id = ja;
  if exists (select 1 from public.customer_invoice where id = fa) or exists (select 1 from public.journal_entry where id = ja)
     or exists (select 1 from public.customer_invoice_line where invoice_id = fa) or exists (select 1 from public.journal_line where entry_id = ja) then
    raise exception 'G05 VACIAR · 5: en la demo con la marca ha quedado algo.';
  end if;
  if not exists (select 1 from public.customer_invoice where id = fb) or not exists (select 1 from public.journal_entry where id = jb)
     or not exists (select 1 from public.customer_invoice_line where invoice_id = fb) or not exists (select 1 from public.journal_line where entry_id = jb) then
    raise exception 'G05 VACIAR · 5: se ha borrado algo de la cuenta B.';
  end if;
  perform set_config('folvy.demo_vaciando', '', true);
  raise notice 'G05 VACIAR · 5: la demo con la marca se vacía (factura, línea, asiento y apunte); la B, entera. OK';
end $$;

-- 6 · La vuelta atrás: las cuatro como estaban. Y otra vez la 1452.
\i supabase/vuelta-atras/20261110T1452_g05_demo_vaciar_emitidas.down.sql
do $$
declare fb uuid := (select v::uuid from _g where clave = 'fb');
begin
  if to_regprocedure('public._conta_demo_permitir_vaciar(uuid)') is not null or to_regprocedure('public._conta_demo_vaciando(uuid)') is not null then
    raise exception 'G05 VACIAR · 6: la vuelta atrás ha dejado las funciones de la marca.';
  end if;
  if pg_get_functiondef('public.customer_invoice_inalterable()'::regprocedure) ~ 'demo_vaciando'
     or pg_get_functiondef('public.journal_entry_inalterable()'::regprocedure) ~ 'demo_vaciando'
     or pg_get_functiondef('public.customer_invoice_line_inalterable()'::regprocedure) ~ 'demo_vaciando'
     or pg_get_functiondef('public.journal_line_inalterable()'::regprocedure) ~ 'demo_vaciando' then
    raise exception 'G05 VACIAR · 6: la vuelta atrás no ha dejado las protecciones como estaban.';
  end if;
  begin delete from public.customer_invoice where id = fb; raise exception 'G05 VACIAR · 6: después de la vuelta atrás se ha borrado una factura emitida.';
  exception when sqlstate '23514' then null; end;
end $$;
\i supabase/migrations/20261110T1452_g05_demo_vaciar_emitidas.sql
do $$ begin raise notice 'G05 VACIAR · 6: vuelta atrás (las cuatro como estaban) y otra vez la 1452. OK'; end $$;

rollback;
