-- scripts/conta/produccion/cuentas/g04-indices.sql
--
-- G04 · URGENTE (nº 17) · LO QUE CUENTA LA TANDA de la 2057, antes, con la
-- tanda (en el ensayo, que se deshace) y después del real. SOLO LEE.
--   1. Los siete índices nuevos: 0 → 7.
--   2-6. Cuánto tarda cada vista de las pantallas de Clientes y Tarifa, leída
--        como la lee el front: la primera página de 1.000 filas de QBO, en su
--        orden, como authenticated (con RLS y security_invoker) con el usuario
--        administrador de QBO. El límite del rol es 8 s (statement_timeout).
-- El tiempo sale en tramos con margen («menos de 2 s», «de 2 a 6 s», «más de
-- 6 s»), no en milisegundos: el ensayo de la vuelta atrás exige que la cuenta
-- salga igual antes y después de deshacer, y los milisegundos cambian solos de
-- una vez a otra (el primer ensayo, 42518253741, paró por eso). Medido el
-- 08/11: la lista, 7,7 y 8,8 s (más de 6 s); las demás, por debajo de 1,1 s.
-- El rol y los «claims» se ponen solo para estas medidas y se quitan al final
-- (role «none»): lo que venga después corre como antes.
select clave, valor from (
  select 0 o, 'Índices nuevos de la 2057' clave,
    (select count(*)::text from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relkind = 'i' and relname in (
      'conta_gc_mandato_cliente_idx', 'conta_gc_suscripcion_cliente_idx', 'conta_gc_suscripcion_mandato_idx', 'conta_gestoria_diferencia_cliente_idx',
      'conta_cobro_cliente_gc_idx', 'conta_gc_cobro_suscripcion_idx', 'conta_precio_tramo_precio_idx')) valor
) q;
select clave, valor from (select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
  (select user_id::text from public.user_profiles where account_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' and active and role = 'admin' order by created_at limit 1))::text, false) as x) p,
  lateral (select 'Medido como' clave, 'authenticated, el administrador de QBO' valor) y;
select 'Rol de las medidas' clave, set_config('role', 'authenticated', false) valor;
select clave, valor from (
  -- quieta: un tramo de tiempo, no un recuento; antes, con la tanda y después (la fila entera, x::text, para que no se salte ninguna columna)
  select 1 o, 'Tiempo · conta_consulta_cliente_empresa (1.ª página de 1.000, como authenticated)' clave, (
    with t0 as materialized (select clock_timestamp() t),
         n as materialized (select count(*) c, sum(length(x::text)) b from t0, lateral (select * from public.conta_consulta_cliente_empresa where cuenta_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' order by cliente_id nulls first, empresa_id nulls first limit 1000) x),
         t1 as materialized (select clock_timestamp() t from n)
    select case when t1.t - t0.t < interval '2 s' then 'menos de 2 s' when t1.t - t0.t < interval '6 s' then 'de 2 a 6 s' else 'más de 6 s' end || ' · ' || n.c || ' filas' from t0, n, t1) valor
  union all
  -- quieta: un tramo de tiempo, no un recuento; antes, con la tanda y después (la fila entera, x::text, para que no se salte ninguna columna)
  select 2 o, 'Tiempo · conta_consulta_que_hacer (1.ª página de 1.000, como authenticated)' clave, (
    with t0 as materialized (select clock_timestamp() t),
         n as materialized (select count(*) c, sum(length(x::text)) b from t0, lateral (select * from public.conta_consulta_que_hacer where cuenta_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' order by empresa_id nulls first, tipo nulls first limit 1000) x),
         t1 as materialized (select clock_timestamp() t from n)
    select case when t1.t - t0.t < interval '2 s' then 'menos de 2 s' when t1.t - t0.t < interval '6 s' then 'de 2 a 6 s' else 'más de 6 s' end || ' · ' || n.c || ' filas' from t0, n, t1) valor
  union all
  -- quieta: un tramo de tiempo, no un recuento; antes, con la tanda y después (la fila entera, x::text, para que no se salte ninguna columna)
  select 3 o, 'Tiempo · conta_consulta_cargo_devuelto (1.ª página de 1.000, como authenticated)' clave, (
    with t0 as materialized (select clock_timestamp() t),
         n as materialized (select count(*) c, sum(length(x::text)) b from t0, lateral (select * from public.conta_consulta_cargo_devuelto where cuenta_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' order by empresa_id nulls first, gc_id nulls first limit 1000) x),
         t1 as materialized (select clock_timestamp() t from n)
    select case when t1.t - t0.t < interval '2 s' then 'menos de 2 s' when t1.t - t0.t < interval '6 s' then 'de 2 a 6 s' else 'más de 6 s' end || ' · ' || n.c || ' filas' from t0, n, t1) valor
  union all
  -- quieta: un tramo de tiempo, no un recuento; antes, con la tanda y después (la fila entera, x::text, para que no se salte ninguna columna)
  select 4 o, 'Tiempo · conta_consulta_asignacion (1.ª página de 1.000, como authenticated)' clave, (
    with t0 as materialized (select clock_timestamp() t),
         n as materialized (select count(*) c, sum(length(x::text)) b from t0, lateral (select * from public.conta_consulta_asignacion where cuenta_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' order by cliente_id nulls first, id nulls first limit 1000) x),
         t1 as materialized (select clock_timestamp() t from n)
    select case when t1.t - t0.t < interval '2 s' then 'menos de 2 s' when t1.t - t0.t < interval '6 s' then 'de 2 a 6 s' else 'más de 6 s' end || ' · ' || n.c || ' filas' from t0, n, t1) valor
  union all
  -- quieta: un tramo de tiempo, no un recuento; antes, con la tanda y después (la fila entera, x::text, para que no se salte ninguna columna)
  select 5 o, 'Tiempo · conta_consulta_tarifa_precio (1.ª página de 1.000, como authenticated)' clave, (
    with t0 as materialized (select clock_timestamp() t),
         n as materialized (select count(*) c, sum(length(x::text)) b from t0, lateral (select * from public.conta_consulta_tarifa_precio where cuenta_id = 'f4e8032d-510a-4e57-914c-4b67732d8655' order by id nulls first limit 1000) x),
         t1 as materialized (select clock_timestamp() t from n)
    select case when t1.t - t0.t < interval '2 s' then 'menos de 2 s' when t1.t - t0.t < interval '6 s' then 'de 2 a 6 s' else 'más de 6 s' end || ' · ' || n.c || ' filas' from t0, n, t1) valor
) q order by o;
select 'Rol al acabar' clave, set_config('role', 'none', false) || ' · claims ' || coalesce(nullif(set_config('request.jwt.claims', '', false), ''), 'quitados') valor;
