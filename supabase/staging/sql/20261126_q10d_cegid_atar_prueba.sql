-- supabase/staging/sql/20261126_q10d_cegid_atar_prueba.sql
--
-- SOLO STAGING. La 0651 y la 0652 del Q10 · respuesta 4 (atar una ficha a su cliente de Cegid), en las cuentas A y B
-- de pruebas, con ROLLBACK:
--   1. Las dos, dos veces. La 0652 (las 19 fichas de QBO) no hace nada en una base sin la empresa de QBO.
--   2. La persona de A ata una ficha suya: queda el código en conta_cobro_cliente (el sitio único del X14) y el
--      apunte en conta_cegid_atado, con quién y el código de antes; otra vez, otro código: «tenía el …».
--   3. El mismo código en otra ficha de la empresa: no (no se ata a dos fichas).
--   4. La persona de B no puede atar en la empresa de A; y nadie escribe el apunte desde la pantalla.
--   5. Las vueltas atrás: la 0652 no toca lo que no ató ella; la 0651 deja la tabla si hay atados y la quita si no.
-- Datos inventados (T11). Nada sale a Cegid.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001', 'f4e8032d-510a-4e57-914c-4b67732d8655')) then
    raise exception 'PRUEBA Q10 ATAR: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261126T0651_q10d_cegid_atar.sql
\i supabase/migrations/20261126T0651_q10d_cegid_atar.sql
\i supabase/migrations/20261126T0652_q10d_fichas_a_cegid.sql
\i supabase/migrations/20261126T0652_q10d_fichas_a_cegid.sql
do $$ begin
  if to_regclass('public.conta_cegid_atado') is null or to_regprocedure('public.conta_cegid_atar(uuid, uuid, integer, text)') is null then
    raise exception 'Q10 ATAR · 1: falta algo de la 0651.';
  end if;
  if exists (select 1 from public.conta_cegid_atado) then raise exception 'Q10 ATAR · 1: la 0652 ha atado algo en una base sin QBO.'; end if;
  raise notice 'Q10 ATAR · 1: la 0651 y la 0652 cargan, dos veces, y la 0652 no hace nada aquí. OK';
end $$;

create temp table _c (clave text primary key, v text) on commit drop;
grant select on _c to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; v_e uuid; v_p1 uuid; v_p2 uuid;
begin
  select id into v_e from public.company where account_id = v_acc order by created_at limit 1;
  insert into public.party (account_id, name) values (v_acc, 'Ficha Prueba Atar Uno, S.L.') returning id into v_p1;
  insert into public.party (account_id, name) values (v_acc, 'Ficha Prueba Atar Dos, S.L.') returning id into v_p2;
  insert into _c values ('empresa', v_e::text), ('p1', v_p1::text), ('p2', v_p2::text);
end $$;

-- 2 y 3 · La persona de A ata; el mismo código en otra ficha, no.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01a0000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
do $$
declare v_e uuid := (select v::uuid from _c where clave = 'empresa'); v_p1 uuid := (select v::uuid from _c where clave = 'p1');
        v_p2 uuid := (select v::uuid from _c where clave = 'p2'); r jsonb;
begin
  r := public.conta_cegid_atar(v_e, v_p1, 98765, 'correo');
  if r->>'frase' <> 'Atada al cliente 98765 de Cegid.' then raise exception 'Q10 ATAR · 2: la frase es «%».', r->>'frase'; end if;
  r := public.conta_cegid_atar(v_e, v_p1, 98764, 'a_mano');
  if r->>'frase' <> 'Atada al cliente 98764 de Cegid (tenía el 98765).' then raise exception 'Q10 ATAR · 2: la segunda frase es «%».', r->>'frase'; end if;
  if (select count(*) from public.conta_cegid_atado where party_id = v_p1) <> 2 then raise exception 'Q10 ATAR · 2: A no ve sus dos apuntes.'; end if;
  begin
    perform public.conta_cegid_atar(v_e, v_p2, 98764, 'nombre');
    raise exception 'Q10 ATAR · 3: el mismo código ha quedado en dos fichas.';
  exception when unique_violation then null; end;
  begin
    insert into public.conta_cegid_atado (company_id, account_id, party_id, codigo, como) values (v_e, 'c01a0000-0000-4000-8000-00000000000a', v_p2, 1, 'a_mano');
    raise exception 'Q10 ATAR · 4: desde la pantalla se ha escrito un apunte.';
  exception when insufficient_privilege then null; end;
  raise notice 'Q10 ATAR · 2 y 3: A ata (y cambia el código, con el de antes apuntado); el mismo código en otra ficha, no. OK';
end $$;
reset role;
do $$ begin
  if (select codigo_cliente from public.conta_cobro_cliente where party_id = (select v::uuid from _c where clave = 'p1')) <> 98764 then
    raise exception 'Q10 ATAR · 2: el código no ha quedado en conta_cobro_cliente.';
  end if;
end $$;

-- 4 · La persona de B no ata en la empresa de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'c01b0000-0000-4000-8000-0000000000b1', true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_cegid_atar((select v::uuid from _c where clave = 'empresa'), (select v::uuid from _c where clave = 'p2'), 55555, 'a_mano');
    raise exception 'Q10 ATAR · 4: la cuenta B ha atado una ficha de la A.';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from public.conta_cegid_atado) then raise exception 'Q10 ATAR · 4: la cuenta B ve los apuntes de la A.'; end if;
  raise notice 'Q10 ATAR · 4: B ni ata ni ve lo de A. OK';
end $$;
reset role;

-- 5 · Las vueltas atrás.
\i supabase/vuelta-atras/20261126T0652_q10d_fichas_a_cegid.down.sql
do $$ begin
  if (select count(*) from public.conta_cegid_atado) <> 2 then raise exception 'Q10 ATAR · 5: la vuelta atrás de la 0652 ha tocado lo que no ató ella.'; end if;
end $$;
\i supabase/vuelta-atras/20261126T0651_q10d_cegid_atar.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_atado') is null then raise exception 'Q10 ATAR · 5: con atados, la vuelta atrás de la 0651 ha quitado la tabla.'; end if;
  if to_regprocedure('public.conta_cegid_atar(uuid, uuid, integer, text)') is not null then raise exception 'Q10 ATAR · 5: la vuelta atrás no quita la función.'; end if;
end $$;
delete from public.conta_cegid_atado;
\i supabase/vuelta-atras/20261126T0651_q10d_cegid_atar.down.sql
do $$ begin
  if to_regclass('public.conta_cegid_atado') is not null then raise exception 'Q10 ATAR · 5: sin atados, la vuelta atrás no quita la tabla.'; end if;
  raise notice 'Q10 ATAR · 5: las vueltas atrás respetan lo atado y, sin nada, lo dejan como estaba. OK';
end $$;
\i supabase/migrations/20261126T0651_q10d_cegid_atar.sql
\echo 'Q10 ATAR · 5: y otra vez la 0651. OK'

rollback;
