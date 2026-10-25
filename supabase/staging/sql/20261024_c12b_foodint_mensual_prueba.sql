-- supabase/staging/sql/20261024_c12b_foodint_mensual_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T1631_c12b_foodint_mensual (Foodint a modo
-- mensual), con \i dentro de la transacción y ROLLBACK: staging no cambia.
--   1. Sin la tanda del C12 (conta_diez_por_enviar sin el modo), para y no toca nada.
--   2. Con la 1251 y sin Foodint, para: «se esperaba 1 empresa… y hay 0»; ni
--      una empresa pasa a mensual ni un envío pierde su reintento.
-- sin usuario: el cambio y su vuelta atrás los aplica la tanda con la clave de
-- la base, no los llama ninguna pantalla ni ningún usuario.
--   3. Sin la copia de antes, la vuelta atrás para y no toca nada.
--   4. C12c (25/10) · El camino de verdad, con una Foodint DE MENTIRA dentro de
--      esta transacción (staging no tiene la de verdad): su empresa con Diez
--      encendido y al validar, y tres pendientes como los de producción, dos con
--      reintento y uno sin él (la recibida sin IVA, con menos de 3 intentos).
--      La 1631 la pasa a mensual, quita el reintento y guarda la copia; la
--      vuelta atrás deja la empresa y los tres envíos EXACTOS (modo, quién y
--      cuándo; next_try_at y updated_at, al segundo) y borra la copia. Es lo
--      que el ensayo del run #220 vio mal: la de antes ponía reintento también
--      a la que no lo tenía y cambiaba las fechas.
-- La condición del traspaso a medias se queda como estaba, contra la tabla.

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

-- 3 · Sin la copia de antes, la vuelta atrás para y no toca nada.
savepoint sin_copia;
\set ON_ERROR_STOP 0
\i supabase/vuelta-atras/20261024T1631_c12b_foodint_mensual.down.sql
\set ON_ERROR_STOP 1
rollback to savepoint sin_copia;
select (:'LAST_ERROR_MESSAGE' = 'C12b · vuelta atrás: no está la copia de antes (conta_c12b_antes). Sin ella no se deja exacto: no se toca nada.') as freno_copia_ok \gset
\echo 'Sin copia dijo:' :'LAST_ERROR_MESSAGE'
\if :freno_copia_ok
\else
  do $$ begin raise exception 'PRUEBA C12b · 3: sin la copia de antes, la vuelta atrás no ha parado con su mensaje.'; end $$;
\endif
do $$ begin
  if (select count(*) from public.conta_diez_envio_empresa where modo = 'mensual') <> (select mensual from _c12b_antes)
     or (select count(*) from public.external_send where status = 'pendiente' and next_try_at is not null) <> (select con_reintento from _c12b_antes) then
    raise exception 'PRUEBA C12b · 3: la vuelta atrás ha cambiado algo sin su copia.';
  end if;
end $$;

-- 4 · Con una Foodint de mentira: la 1631 y su vuelta atrás, exactas.
insert into public.accounts (id, name, slug) values ('51ad1792-6629-4ef7-833a-b57b09a86710', 'Foodint de prueba (C12c)', 'prueba-c12c-foodint');
insert into public.company (id, account_id) values ('c12b0000-0000-4000-8000-0000000000c0', '51ad1792-6629-4ef7-833a-b57b09a86710');
insert into public.conta_diez_envio_empresa (company_id, account_id, enviar, modo, cambiado_por_nombre, cambiado_en)
  values ('c12b0000-0000-4000-8000-0000000000c0', '51ad1792-6629-4ef7-833a-b57b09a86710', true, null, 'Prueba (antes)', '2026-10-01 10:00:00+00');
-- Tres asientos cualesquiera de staging, solo para la clave ajena.
insert into public.external_send (id, account_id, company_id, entry_id, kind, payload_hash, status, attempts, next_try_at, updated_at)
select v.id::uuid, '51ad1792-6629-4ef7-833a-b57b09a86710', 'c12b0000-0000-4000-8000-0000000000c0', e.id, v.kind, v.h, 'pendiente', v.att, v.nta::timestamptz, v.upd::timestamptz
  from (values (1, 'c12b0000-0000-4000-8000-0000000000e1', 'asiento', 'prueba-c12c-1', 0, '2026-10-25 05:06:00+00', '2026-10-22 08:00:00+00'),
               (2, 'c12b0000-0000-4000-8000-0000000000e2', 'asiento', 'prueba-c12c-2', 1, '2026-10-25 05:08:00+00', '2026-10-24 09:00:00+00'),
               (3, 'c12b0000-0000-4000-8000-0000000000e3', 'factura', 'prueba-c12c-3', 0, null,                     '2026-10-24 10:00:00+00')) v(n, id, kind, h, att, nta, upd)
  join (select id, row_number() over (order by id) n from public.journal_entry order by id limit 3) e on e.n = v.n;
-- La huella de lo que toca la 1631, con todos sus campos.
create temp view _c12b_huella as
  select (select string_agg(company_id::text || '|' || coalesce(modo, '-') || '|' || coalesce(cambiado_por_nombre, '-') || '|' || cambiado_en::text, ',' order by company_id)
            from public.conta_diez_envio_empresa where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') empresa,
         (select string_agg(id::text || '|' || coalesce(next_try_at::text, '-') || '|' || updated_at::text || '|' || attempts, ',' order by id)
            from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pendiente') envios;
create temp table _c12b_huella_antes on commit drop as select * from _c12b_huella;
\echo 'Antes:' 
select * from _c12b_huella_antes;

\i supabase/migrations/20261024T1631_c12b_foodint_mensual.sql
do $$ begin
  if (select modo from public.conta_diez_envio_empresa where company_id = 'c12b0000-0000-4000-8000-0000000000c0') is distinct from 'mensual' then
    raise exception 'PRUEBA C12b · 4: la 1631 no ha pasado la empresa a mensual.';
  end if;
  if exists (select 1 from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status = 'pendiente' and next_try_at is not null) then
    raise exception 'PRUEBA C12b · 4: la 1631 ha dejado algún pendiente con reintento.';
  end if;
  if (select count(*) from public.conta_c12b_antes) <> 4
     or (select count(*) from public.conta_c12b_antes where tabla = 'external_send') <> 3 then
    raise exception 'PRUEBA C12b · 4: la copia de antes no tiene la empresa y los tres pendientes (tiene %).', (select count(*) from public.conta_c12b_antes);
  end if;
end $$;

\i supabase/vuelta-atras/20261024T1631_c12b_foodint_mensual.down.sql
\echo 'Después de la tanda y su vuelta atrás:'
select * from _c12b_huella;
do $$ begin
  if (select empresa from _c12b_huella) is distinct from (select empresa from _c12b_huella_antes) then
    raise exception 'PRUEBA C12b · 4: la vuelta atrás no deja la empresa exacta: % ≠ %', (select empresa from _c12b_huella), (select empresa from _c12b_huella_antes);
  end if;
  if (select envios from _c12b_huella) is distinct from (select envios from _c12b_huella_antes) then
    raise exception 'PRUEBA C12b · 4: la vuelta atrás no deja los envíos exactos: % ≠ %', (select envios from _c12b_huella), (select envios from _c12b_huella_antes);
  end if;
  if (select next_try_at from public.external_send where id = 'c12b0000-0000-4000-8000-0000000000e3') is not null then
    raise exception 'PRUEBA C12b · 4: la que no tenía reintento ha salido con él (el fallo del run #220).';
  end if;
  if to_regclass('public.conta_c12b_antes') is not null then
    raise exception 'PRUEBA C12b · 4: la vuelta atrás no ha borrado la copia de antes.';
  end if;
  raise notice 'PRUEBA C12b en verde: para sin la 1251, sin Foodint y sin copia, sin tocar nada; con una Foodint de mentira, la 1631 y su vuelta atrás dejan la empresa y los tres pendientes exactos, y la copia borrada.';
end $$;

rollback;
