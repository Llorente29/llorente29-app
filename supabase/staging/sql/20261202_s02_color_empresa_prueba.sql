-- supabase/staging/sql/20261202_s02_color_empresa_prueba.sql
--
-- SOLO STAGING. La 0460 del S02 (el color de la empresa), por sus caminos:
--   1. Si staging aún no la tiene, se aplica aquí, dentro de la transacción.
--   2. La columna (nula) y su comprobación; ninguna empresa trae color.
--   3. COMO USUARIO de A (administrador de A): pone el color de su empresa,
--      lo quita (null: el de serie), y un color mal escrito no entra (23514).
--      No puede poner el color de una empresa de B.
--   4. La vuelta atrás, de verdad: con un color puesto PARA sin tocar nada; sin
--      él, quita la comprobación y la columna.
--
-- Cambia: company.color (columna nueva) y company_color_formato. Todo acaba en
-- ROLLBACK: staging no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S02 0460: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- 1 · La 0460, si falta.
select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'color') as falta_0460 \gset
\if :falta_0460
\echo '>>> Staging aún no tiene la 0460 del S02: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261202T0460_s02_color_empresa.sql
\endif

-- 2 · Lo que añade.
do $$
declare c record;
begin
  select is_nullable, data_type into c from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'color';
  if c.is_nullable <> 'YES' or c.data_type <> 'text' then raise exception 'PRUEBA S02 0460: company.color no es text nula: %', row_to_json(c); end if;
  if not exists (select 1 from pg_constraint where conname = 'company_color_formato' and conrelid = 'public.company'::regclass) then
    raise exception 'PRUEBA S02 0460: falta company_color_formato.';
  end if;
  raise notice 'S02 0460 2: columna nula y su comprobación.';
end $$;

-- 3 · Como usuario de A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare e uuid; b uuid; n int;
begin
  select id into e from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1;
  if e is null then raise exception 'PRUEBA S02 0460 3: A no tiene empresa en staging.'; end if;
  update public.company set color = '#0B6B67' where id = e;
  if (select color from public.company where id = e) is distinct from '#0B6B67' then raise exception 'PRUEBA S02 0460 3a: A no ha podido poner el color de su empresa.'; end if;
  update public.company set color = null where id = e;
  if (select color from public.company where id = e) is not null then raise exception 'PRUEBA S02 0460 3b: A no ha podido quitar el color.'; end if;
  raise notice 'S02 0460 3a: A pone el color de su empresa y lo quita.';
  begin
    update public.company set color = 'verde' where id = e;
    raise exception 'PRUEBA S02 0460 3c: ha entrado un color mal escrito.';
  exception when check_violation then raise notice 'S02 0460 3c: un color mal escrito no entra (23514).';
  end;
  -- La empresa de B: A no la ve (RLS), así que el update no toca ninguna fila.
  select id into b from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' limit 1;
  update public.company set color = '#A3361F' where account_id = 'c01b0000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'PRUEBA S02 0460 3d: A ha cambiado el color de % empresas de B.', n; end if;
  raise notice 'S02 0460 3d: A no toca el color de las empresas de B (0 filas).';
end $$;
reset role;

-- 4 · La vuelta atrás, de verdad.
update public.company set color = '#1E63C9' where id = (select id from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at, id limit 1);
savepoint guarda;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261202T0460_s02_color_empresa.down.sql
\set guarda_fallo :ERROR
\set ON_ERROR_STOP 1
rollback to savepoint guarda;
\if :guarda_fallo
\echo 'S02 0460 4 guarda: con un color puesto, la vuelta atrás para y no toca nada.'
\else
do $$ begin raise exception 'PRUEBA S02 0460 4: con un color puesto, la vuelta atrás no ha parado.'; end $$;
\endif
update public.company set color = null where color is not null;
\i supabase/vuelta-atras/20261202T0460_s02_color_empresa.down.sql
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'color')
     or exists (select 1 from pg_constraint where conname = 'company_color_formato') then
    raise exception 'PRUEBA S02 0460 4: la vuelta atrás no ha quitado la columna o la comprobación.';
  end if;
  raise notice 'S02 0460 4: vuelta atrás, sin columna y sin comprobación.';
end $$;

rollback;
