-- supabase/staging/sql/20261109_gd_cuenta_demo_prueba.sql
--
-- SOLO STAGING. La 0110 del GD («Gestoría Demo»), por sus caminos:
--   1. La 0110 dos veces: la segunda no hace nada.
--   2. La cuenta es de demostración (no sale fuera), Sumied y asesoría; sus dos
--      empresas en sector Gestoría con el alta terminada, su banco del 9999 y
--      los cambios de tarifa encendidos.
--   3. No toca otras cuentas: las demás, las mismas y sin cambiar.
--   4. La vuelta atrás quita la cuenta y todo lo suyo, y nada más.
-- Todo acaba en ROLLBACK. Datos inventados (T11).
-- sin usuario: la cuenta la crea la plataforma (una migración), no una persona;
-- lo que verá la administración lo prueban las pantallas del G04.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GD: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

create temp table _antes on commit drop as
select id, md5(to_jsonb(a)::text) huella from public.accounts a where id <> 'de000000-0000-4000-8000-0000000000a0';

\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql
\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql

do $$
declare c constant uuid := 'de000000-0000-4000-8000-0000000000a0'; n int;
begin
  if not exists (select 1 from public.accounts where id = c and is_demo and product_brand = 'sumied' and tax_advisor_since is not null) then
    raise exception 'GD · 2: la cuenta no es demo, Sumied y asesoría.';
  end if;
  if public.cuenta_puede_salir(c) then raise exception 'GD · 2: una cuenta demo no puede salir fuera.'; end if;
  select count(*) into n from public.company where account_id = c and sector = 'gestoria' and setup_completed_at is not null;
  if n <> 2 then raise exception 'GD · 2: tenía que haber dos empresas de Gestoría con el alta terminada y hay %.', n; end if;
  select count(*) into n from public.treasury_account where account_id = c and iban like 'ES__9999%';
  if n <> 2 then raise exception 'GD · 2: tenía que haber dos bancos del 9999 y hay %.', n; end if;
  select count(*) into n from public.conta_gestoria_ajustes where account_id = c and cambios_de_tarifa;
  if n <> 2 then raise exception 'GD · 2: los cambios de tarifa tenían que estar encendidos en las dos y hay %.', n; end if;
  raise notice 'GD · 1 y 2: la cuenta demo, sus dos empresas de Gestoría, sus bancos y los cambios de tarifa encendidos. OK';
  if exists (select 1 from _antes x left join public.accounts a on a.id = x.id where a.id is null or md5(to_jsonb(a)::text) <> x.huella) then
    raise exception 'GD · 3: ha cambiado alguna otra cuenta.';
  end if;
  raise notice 'GD · 3: las demás cuentas, igual. OK';
end $$;

\i supabase/vuelta-atras/20261109T0110_gd_cuenta_demo.down.sql
do $$ begin
  if exists (select 1 from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0')
     or exists (select 1 from public.company where account_id = 'de000000-0000-4000-8000-0000000000a0') then
    raise exception 'GD · 4: la vuelta atrás ha dejado algo de la cuenta.';
  end if;
  if (select count(*) from public.accounts) <> (select count(*) from _antes) then raise exception 'GD · 4: la vuelta atrás ha tocado otras cuentas.'; end if;
  raise notice 'GD · 4: la vuelta atrás quita la cuenta y nada más. OK';
end $$;

rollback;
