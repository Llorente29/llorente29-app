-- supabase/staging/sql/20261121_s01_esqueleto_prueba.sql
--
-- SOLO STAGING. La tanda del S01 (el esqueleto), por sus caminos:
--   1. Si staging aún no tiene la 0100, se aplica aquí, dentro de la
--      transacción.
--   2. La 0110 sobre datos: se quita la marca a todas las empresas y se vuelve
--      a poner con la 0110. Las de cuentas de hostelería (A y B, restaurante)
--      quedan en sí; las de otra actividad (las cuentas solas, la de Diez), en
--      no. Y una que ya tenía marca puesta a mano no se toca.
--   3. COMO USUARIO de A (set local role authenticated, con su sub): guarda y
--      lee SU fila de preferencias; no ve la de B; no puede escribir una fila a
--      nombre de B ni en la cuenta B; un nivel que no existe, no entra.
--   4. Las dos vueltas atrás, de verdad y en orden inverso: la 0110 deja la
--      marca nula; la 0100 quita la tabla, su función y la columna.
--
-- Todo acaba en ROLLBACK: staging es compartido y no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · La 0100, si falta.
select to_regclass('public.conta_user_pref') is null as falta_0100 \gset
\if :falta_0100
\echo '>>> Staging aún no tiene la 0100 del S01: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261121T0100_s01_esqueleto.sql
\endif

-- 2 · La 0110 sobre datos.
update public.company set is_hospitality = null;
-- Una empresa de A con la marca puesta a mano (en contra de su actividad): no se toca.
update public.company set is_hospitality = false
 where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
\i supabase/migrations/20261121T0110_s01_hosteleria_de_hoy.sql
do $$
declare n_a_si int; n_a_no int; n_b int; n_otra int; n_otra_si int;
begin
  select count(*) filter (where is_hospitality), count(*) filter (where not is_hospitality) into n_a_si, n_a_no
    from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a';
  select count(*) into n_b from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' and is_hospitality;
  select count(*), count(*) filter (where c.is_hospitality) into n_otra, n_otra_si
    from public.company c join public.accounts a on a.id = c.account_id where a.business_type = 'otra_actividad';
  if n_a_no <> 1 or n_a_si <> (select count(*) - 1 from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA S01 0110: en A se esperaba la marcada a mano en «no» y las demás en «sí»; hay % sí y % no.', n_a_si, n_a_no;
  end if;
  if n_b <> 1 then raise exception 'PRUEBA S01 0110: B (restaurante) debía quedar de hostelería; % empresas lo son.', n_b; end if;
  if n_otra = 0 then raise exception 'PRUEBA S01 0110: no hay ninguna empresa de otra actividad con la que probar el «no».'; end if;
  if n_otra_si <> 0 then raise exception 'PRUEBA S01 0110: % empresa(s) de otra actividad quedaron de hostelería.', n_otra_si; end if;
  if exists (select 1 from public.company where is_hospitality is null) then
    raise exception 'PRUEBA S01 0110: quedan empresas sin marca.';
  end if;
  raise notice 'S01 0110: A % sí y la de a mano en no · B sí · % de otra actividad en no.', n_a_si, n_otra;
end $$;

-- 3 · Como usuario de A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare n int; f jsonb;
begin
  insert into public.conta_user_pref (account_id, user_id, nivel, favoritos)
  values ('c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a1', 'experto', '["asiento.expedida"]')
  on conflict (account_id, user_id) do update set nivel = excluded.nivel, favoritos = excluded.favoritos;
  update public.conta_user_pref set cinta_oculta = true
   where account_id = 'c01a0000-0000-4000-8000-00000000000a' and user_id = 'c01a0000-0000-4000-8000-0000000000a1';
  select count(*), max(favoritos::text)::jsonb into n, f from public.conta_user_pref;
  if n <> 1 or f <> '["asiento.expedida"]'::jsonb then
    raise exception 'PRUEBA S01: A tenía que ver solo su fila con su favorito; ve % fila(s): %.', n, f;
  end if;
  raise notice 'S01 3a: A guarda y lee su fila (nivel experto, un favorito, cinta oculta).';
end $$;

do $$
begin
  begin
    insert into public.conta_user_pref (account_id, user_id) values ('c01b0000-0000-4000-8000-00000000000b', 'c01a0000-0000-4000-8000-0000000000a1');
    raise exception 'PRUEBA S01: A ha podido escribir en la cuenta B.';
  exception when insufficient_privilege then raise notice 'S01 3b: A no escribe en la cuenta B (42501).';
  end;
  begin
    insert into public.conta_user_pref (account_id, user_id) values ('c01a0000-0000-4000-8000-00000000000a', 'c01b0000-0000-4000-8000-0000000000b1');
    raise exception 'PRUEBA S01: A ha podido escribir una fila a nombre de B.';
  exception when insufficient_privilege then raise notice 'S01 3c: A no escribe a nombre de otro (42501).';
  end;
  begin
    update public.conta_user_pref set nivel = 'guru' where user_id = 'c01a0000-0000-4000-8000-0000000000a1';
    raise exception 'PRUEBA S01: entró un nivel que no existe.';
  exception when check_violation then raise notice 'S01 3d: un nivel que no existe no entra (23514).';
  end;
end $$;
reset role;

-- B tiene su fila; A no la ve.
insert into public.conta_user_pref (account_id, user_id, nivel) values ('c01b0000-0000-4000-8000-00000000000b', 'c01b0000-0000-4000-8000-0000000000b1', 'sin_experiencia')
on conflict (account_id, user_id) do nothing;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
begin
  if exists (select 1 from public.conta_user_pref where user_id = 'c01b0000-0000-4000-8000-0000000000b1') then
    raise exception 'PRUEBA S01: A ve la fila de B.';
  end if;
  raise notice 'S01 3e: A no ve la fila de B.';
end $$;
reset role;

-- 4 · Las vueltas atrás, en orden inverso.
\i supabase/vuelta-atras/20261121T0110_s01_hosteleria_de_hoy.down.sql
do $$ begin
  if exists (select 1 from public.company where is_hospitality is not null) then
    raise exception 'PRUEBA S01: tras la vuelta atrás de la 0110 quedan marcas puestas.';
  end if;
  raise notice 'S01 4a: vuelta atrás de la 0110, todas las marcas nulas.';
end $$;
\i supabase/vuelta-atras/20261121T0100_s01_esqueleto.down.sql
do $$ begin
  if to_regclass('public.conta_user_pref') is not null or to_regprocedure('public.conta_user_pref_al_dia()') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'is_hospitality') then
    raise exception 'PRUEBA S01: la vuelta atrás de la 0100 no lo ha quitado todo.';
  end if;
  raise notice 'S01 4b: vuelta atrás de la 0100, sin tabla, sin función y sin columna.';
end $$;

rollback;
