-- supabase/staging/sql/20261109_gd_banco_demo_prueba.sql
--
-- SOLO STAGING. La 1530 del GD (el banco de la demo termina en 56), sobre la
-- «Gestoría Demo» de staging (la 0110):
--   1. El banco por defecto de la sociedad termina en 56; el de la autónoma no
--      cambia; repetir no cambia nada más.
--   2. En una cuenta que no es demo, no (42501).
--   3. La vuelta atrás lo deja como estaba (termina en 01).
-- Todo acaba en ROLLBACK. Datos inventados (T11).
-- sin usuario: la siembra la llama la plataforma.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GD: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql
\i supabase/migrations/20261109T1530_gd_banco_demo.sql

do $$
declare v jsonb; aut text := (select iban from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000b9' and kind = 'bank');
begin
  if (select right(iban, 2) from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000a9' and kind = 'bank' and is_default) <> '56' then
    raise exception 'GD · 1: el banco de la sociedad no termina en 56.';
  end if;
  v := public.demo_gestoria_banco_sembrar('de000000-0000-4000-8000-0000000000a0');
  if v->>'frase' not like '%ya terminaba%' then raise exception 'GD · 1: repetir tenía que no cambiar nada: %', v->>'frase'; end if;
  if (select iban from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000b9' and kind = 'bank') is distinct from aut then
    raise exception 'GD · 1: ha cambiado el banco de la autónoma.';
  end if;
  raise notice 'GD · 1: el banco de la sociedad termina en 56 y repetir no cambia nada. OK';
  begin
    perform public.demo_gestoria_banco_sembrar('c01a0000-0000-4000-8000-00000000000a');
    raise exception 'GD · 2: en una cuenta que no es demo tenía que negarse.';
  exception when insufficient_privilege then raise notice 'GD · 2: en una cuenta que no es demo, no. OK';
  end;
end $$;

\i supabase/vuelta-atras/20261109T1530_gd_banco_demo.down.sql
do $$ begin
  if (select iban from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000a9' and kind = 'bank' and is_default) <> 'ES4299990001490000000101' then
    raise exception 'GD · 3: la vuelta atrás no deja el banco como estaba.';
  end if;
  if to_regprocedure('public.demo_gestoria_banco_sembrar(uuid)') is not null then raise exception 'GD · 3: la función sigue.'; end if;
  raise notice 'GD · 3: la vuelta atrás deja el banco como estaba. OK';
end $$;

rollback;
