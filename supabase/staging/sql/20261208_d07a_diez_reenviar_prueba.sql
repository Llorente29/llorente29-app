-- supabase/staging/sql/20261208_d07a_diez_reenviar_prueba.sql
--
-- SOLO STAGING. Prueba de 20261208T0820_d07a_diez_reenviar_descripcion y de su
-- vuelta atrás, con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Las dos son datos de Foodint, que staging no tiene: lo que se prueba es que
-- en una base sin Foodint no tocan nada (ni una fila de external_send) y que
-- un usuario no puede leer los envíos de otra cuenta.
-- sin prueba con datos: los envíos rechazados son de Foodint; su recuento, antes
-- y después, lo da scripts/conta/produccion/cuentas/d07a-diez-reenviar.sql.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D07a: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _d07a_antes on commit drop as select id, attempts, next_try_at, last_error from public.external_send;

\i supabase/migrations/20261208T0820_d07a_diez_reenviar_descripcion.sql
\i supabase/vuelta-atras/20261208T0820_d07a_diez_reenviar_descripcion.down.sql

do $$ begin
  if exists (select 1 from public.external_send x left join _d07a_antes a on a.id = x.id
              where a.id is null or a.attempts is distinct from x.attempts or a.next_try_at is distinct from x.next_try_at or a.last_error is distinct from x.last_error) then
    raise exception 'PRUEBA D07a: sin Foodint, la 0820 o su vuelta atrás han tocado external_send.';
  end if;
  raise notice 'D07a: sin Foodint, la 0820 y su vuelta atrás no tocan ningún envío';
end $$;

-- Como usuario de B: no ve los envíos de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  if exists (select 1 from public.external_send where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA D07a: B ve los envíos a Diez de A.';
  end if;
  raise notice 'D07a: B no ve los envíos de A';
end $$;
reset role;

rollback;
