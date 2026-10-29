-- supabase/staging/sql/20261028_ls1_laboral_prueba.sql
--
-- SOLO STAGING. Prueba de la 2224 (LS1: Laboral en Sumied, encendido en
-- Foodint) y de su vuelta atrás, con \i dentro de la transacción y ROLLBACK:
-- staging no cambia.
--
-- En staging no está Foodint: se crea DENTRO de la transacción una cuenta con
-- su id, para que la 2224 tenga sobre qué escribir.
--
--   1 · sin la cuenta, la 2224 no hace nada (como en staging de verdad);
--   2 · con la cuenta: pone conta_laboral encendido, «manual_grant»;
--   3 · pasada dos veces, sigue habiendo una sola fila;
--   4 · si alguien ya la hubiera apagado a mano, la 2224 no la toca;
--   5 · la vuelta atrás quita la suya, y no la que se puso a mano.
--
-- sin usuario: la 2224 no crea ni cambia nada que llame una persona; solo
-- escribe una fila de feature_flags, que fuera de una migración solo escribe
-- la plataforma (su RLS no ha cambiado). Lo que ve la persona con el
-- interruptor encendido lo prueba la e2e (tests/e2e/laboral/ls1-sumied.spec.ts).

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA LS1: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

-- 1 · Sin la cuenta: nada.
\i supabase/migrations/20261028T2224_ls1_laboral_en_foodint.sql
do $$ begin
  if exists (select 1 from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception 'PRUEBA LS1 · 1: sin la cuenta, la 2224 ha escrito algo';
  end if;
  raise notice '1 · sin la cuenta, la 2224 no hace nada';
end $$;

-- 2 · Con la cuenta (inventada aquí, con el id de Foodint).
insert into public.accounts (id, name, slug, status, business_type)
values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'Foodint de la prueba LS1', 'ls1-prueba-foodint', 'active', 'restaurante');
\i supabase/migrations/20261028T2224_ls1_laboral_en_foodint.sql
do $$ declare r record; begin
  select enabled, source into r from public.feature_flags
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and feature_key = 'conta_laboral';
  if not found or not r.enabled or r.source <> 'manual_grant' then
    raise exception 'PRUEBA LS1 · 2: conta_laboral no ha quedado encendido como manual_grant (%)', r;
  end if;
  raise notice '2 · con la cuenta, conta_laboral encendido (manual_grant)';
end $$;

-- 3 · Dos veces: una sola fila.
\i supabase/migrations/20261028T2224_ls1_laboral_en_foodint.sql
do $$ begin
  if (select count(*) from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and feature_key = 'conta_laboral') <> 1 then
    raise exception 'PRUEBA LS1 · 3: pasada dos veces no deja una sola fila';
  end if;
  raise notice '3 · pasada dos veces, una sola fila';
end $$;

-- 5 (primero la suya) · La vuelta atrás quita la fila que puso la 2224.
\i supabase/vuelta-atras/20261028T2224_ls1_laboral_en_foodint.down.sql
do $$ begin
  if exists (select 1 from public.feature_flags where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and feature_key = 'conta_laboral') then
    raise exception 'PRUEBA LS1 · 5: la vuelta atrás no ha quitado la fila de la 2224';
  end if;
  raise notice '5 · la vuelta atrás quita la fila de la 2224';
end $$;

-- 4 · Una fila puesta a mano (apagada): la 2224 no la toca, y la vuelta atrás tampoco.
insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'conta_laboral', false, 'manual_grant', 'puesta a mano (prueba LS1)');
\i supabase/migrations/20261028T2224_ls1_laboral_en_foodint.sql
\i supabase/vuelta-atras/20261028T2224_ls1_laboral_en_foodint.down.sql
do $$ declare r record; begin
  select enabled, grant_reason into r from public.feature_flags
   where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and feature_key = 'conta_laboral';
  if not found or r.enabled or r.grant_reason <> 'puesta a mano (prueba LS1)' then
    raise exception 'PRUEBA LS1 · 4: la fila puesta a mano ha cambiado (%)', r;
  end if;
  raise notice '4 · la fila puesta a mano sigue como estaba (ni la 2224 ni la vuelta atrás la tocan)';
end $$;

rollback;
