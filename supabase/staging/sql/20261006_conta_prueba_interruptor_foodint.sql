-- ============================================================================
-- Prueba en staging-conta del interruptor de Foodint (tanda propia).
-- Todo en una transacción que acaba en ROLLBACK: no queda nada.
--
-- staging-conta no tiene la cuenta de Foodint: se crea aquí, con el MISMO id
-- y un nombre que dice que es de prueba, solo para que la clave ajena exista.
-- Ningún dato de Foodint pasa por staging: solo su uuid.
--
--   1. Antes: la cuenta no tiene fila 'conta'.
--   2. Se aplica el fichero de producción, tal cual (\ir).
--   3. Queda UNA fila, igual que la de la cuenta A (enabled, manual_grant,
--      sin caducidad, granted_by null), y no toca ninguna otra cuenta.
--   4. Volver a lanzarlo no cambia nada (on conflict do nothing).
--   5. La vuelta atrás la quita, y solo a ella: feature_flags queda como antes.
--
-- Lo que NO prueba aquí: que el fichero pare si la fila existiera apagada. Su
-- «raise» saldría dentro del \ir y psql abortaría la prueba entera sin poder
-- comprobarlo; la guarda es la última consulta del fichero, legible.
-- ============================================================================
begin;

do $$ begin
  if exists (select 1 from public.accounts where id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception 'staging-conta ya tiene una cuenta con el id de Foodint: la prueba no la pisa.';
  end if;
end $$;

insert into public.accounts (id, name, slug)
values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'Prueba interruptor (no es Foodint)', 'prueba-interruptor-conta');

create temp table antes_ff on commit drop as
select account_id, feature_key, enabled, source, expires_at, granted_by from public.feature_flags;

do $$ begin
  if exists (select 1 from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception '1 · La cuenta de prueba ya tiene interruptores.';
  end if;
end $$;

-- 2 · El fichero de producción, tal cual.
\ir ../../migrations/20261006T1300_conta_interruptor_foodint_datos.sql

do $$
declare n int; f record; a record;
begin
  select count(*) into n from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
  if n <> 1 then raise exception '3 · Esperaba 1 fila para la cuenta y hay %.', n; end if;
  select * into f from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
  select * into a from public.feature_flags where account_id = 'c01a0000-0000-4000-8000-00000000000a' and feature_key = 'conta';
  if (f.feature_key, f.enabled, f.source, f.expires_at, f.granted_by) is distinct from (a.feature_key, a.enabled, a.source, a.expires_at, a.granted_by) then
    raise exception '3 · La fila no es como la de la cuenta A: % / %', row(f.feature_key, f.enabled, f.source, f.expires_at, f.granted_by), row(a.feature_key, a.enabled, a.source, a.expires_at, a.granted_by);
  end if;
  -- Ninguna otra cuenta cambia.
  if exists (
    (select account_id, feature_key, enabled, source, expires_at, granted_by from public.feature_flags where account_id <> '51ad1792-6629-4ef7-833a-b57b09a86710'
     except select * from antes_ff)
    union all
    (select * from antes_ff except
     select account_id, feature_key, enabled, source, expires_at, granted_by from public.feature_flags where account_id <> '51ad1792-6629-4ef7-833a-b57b09a86710')
  ) then raise exception '3 · Ha cambiado algún interruptor de otra cuenta.'; end if;
  raise notice '3 · OK: una fila conta · enabled · manual_grant, igual que la cuenta A; las demás cuentas, igual.';
end $$;

-- 4 · Otra vez: no cambia nada.
\ir ../../migrations/20261006T1300_conta_interruptor_foodint_datos.sql
do $$ begin
  if (select count(*) from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') <> 1 then
    raise exception '4 · Lanzarlo dos veces no deja una sola fila.';
  end if;
  raise notice '4 · OK: lanzarlo dos veces deja la misma fila.';
end $$;

-- 5 · La vuelta atrás quita esa fila, y solo esa.
\ir ../../vuelta-atras/20261006T1300_conta_interruptor_foodint_datos.down.sql
do $$ begin
  if exists (select 1 from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception '5 · La vuelta atrás no ha quitado la fila.';
  end if;
  if exists ((select account_id, feature_key, enabled, source, expires_at, granted_by from public.feature_flags except select * from antes_ff)
             union all (select * from antes_ff except select account_id, feature_key, enabled, source, expires_at, granted_by from public.feature_flags)) then
    raise exception '5 · Después de la vuelta atrás, feature_flags no es como antes.';
  end if;
  raise notice '5 · OK: la vuelta atrás deja feature_flags exactamente como antes.';
end $$;

rollback;
