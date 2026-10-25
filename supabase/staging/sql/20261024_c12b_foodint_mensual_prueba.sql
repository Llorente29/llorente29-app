-- supabase/staging/sql/20261024_c12b_foodint_mensual_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T1631_c12b_foodint_mensual (Foodint a modo
-- mensual), con \i dentro de la transacción y ROLLBACK: staging no cambia.
-- Staging no tiene la cuenta de Foodint, así que lo que se prueba son los frenos:
--   1. Sin la tanda del C12 (conta_diez_por_enviar sin el modo), para y no toca nada.
--   2. Con la 1251 y sin Foodint, para: «se esperaba 1 empresa… y hay 0»; ni
--      una empresa pasa a mensual ni un envío pierde su reintento.
-- sin usuario: el cambio y su vuelta atrás los aplica la tanda con la clave de
-- la base, no los llama ninguna pantalla ni ningún usuario.
--   3. La vuelta atrás se puede pasar (sin Foodint, no cambia nada) y para si
--      hay un traspaso a medias (la condición, contra la tabla).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C12b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.conta_diez_traspaso') is null then
    raise exception 'PRUEBA C12b: staging no tiene la 1250 del C12.';
  end if;
end $$;
set local statement_timeout = '60s';
create temp table _c12b_antes on commit drop as
  select (select count(*) from public.conta_diez_envio_empresa where modo = 'mensual') mensual,
         (select count(*) from public.external_send where status = 'pendiente' and next_try_at is not null) con_reintento;

-- 1 · Sin la tanda del C12, para. En la sesión de staging la 1250 y la 1251
-- ya van delante (son nuevas en la rama), así que se quitan aquí, dentro del
-- savepoint, con la vuelta atrás de la 1250: devuelve conta_diez_por_enviar al
-- cuerpo de hoy en producción y quita conta_traspaso_confirmar y el modo, lo
-- mismo que mira la guarda. El rollback to savepoint lo deja todo como estaba.
savepoint sin_1251;
\i supabase/vuelta-atras/20261024T1250_c12_traspaso_mensual.down.sql
\set ON_ERROR_STOP 0
\i supabase/migrations/20261024T1631_c12b_foodint_mensual.sql
\set ON_ERROR_STOP 1
rollback to savepoint sin_1251;
select (:'LAST_ERROR_MESSAGE' = 'C12b · primero la tanda del C12 (1250 y 1251), después este cambio.') as freno_1251_ok \gset
\echo 'Sin la 1251 dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_1251_ok
\else
  do $$ begin raise exception 'PRUEBA C12b · 1: sin la 1251 no ha parado.'; end $$;
\endif

-- 2 · Con la 1251 y sin Foodint, para.
\i supabase/migrations/20261024T1251_c12_por_enviar_modo.sql
savepoint sin_foodint;
\set ON_ERROR_STOP 0
\i supabase/migrations/20261024T1631_c12b_foodint_mensual.sql
\set ON_ERROR_STOP 1
rollback to savepoint sin_foodint;
select (:'LAST_ERROR_MESSAGE' = 'C12b · se esperaba 1 empresa de Foodint con Diez encendido y al validar, y hay 0.') as freno_foodint_ok \gset
\echo 'Sin Foodint dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_foodint_ok
\else
  do $$ begin raise exception 'PRUEBA C12b · 2: sin Foodint no ha parado con su mensaje.'; end $$;
\endif
do $$ begin
  if (select count(*) from public.conta_diez_envio_empresa where modo = 'mensual') <> (select mensual from _c12b_antes)
     or (select count(*) from public.external_send where status = 'pendiente' and next_try_at is not null) <> (select con_reintento from _c12b_antes) then
    raise exception 'PRUEBA C12b · 2: ha parado, pero algo ha cambiado.';
  end if;
end $$;

-- 3 · La vuelta atrás se pasa y no cambia nada sin Foodint.
\i supabase/vuelta-atras/20261024T1631_c12b_foodint_mensual.down.sql
do $$ begin
  if (select count(*) from public.conta_diez_envio_empresa where modo = 'mensual') <> (select mensual from _c12b_antes)
     or (select count(*) from public.external_send where status = 'pendiente' and next_try_at is not null) <> (select con_reintento from _c12b_antes) then
    raise exception 'PRUEBA C12b · 3: la vuelta atrás ha cambiado algo sin Foodint.';
  end if;
  raise notice 'PRUEBA C12b en verde: para sin la 1251 y sin Foodint, sin tocar nada; la vuelta atrás se pasa limpia.';
end $$;

rollback;
