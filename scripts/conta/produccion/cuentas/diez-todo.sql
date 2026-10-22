-- scripts/conta/produccion/cuentas/diez-todo.sql
--
-- C07 · LO QUE CUENTA LA TANDA DE «TODO ASIENTO A DIEZ» (20261201T0430), antes
-- y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo comparan
-- deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- Lo de Foodint, con su account_id (regla 9). La 0430 añade tablas, columnas
-- y funciones, y deja a todas las empresas con «Enviar a Diez» APAGADO (sin
-- fila): no envía nada ni toca ninguna fila. Lo que hay en Diez, lo que Julio
-- ha autorizado tiene que salir igual. (Los asientos no se cuentan: se
-- proponen y se validan solos durante el servicio, y no son de esta tanda.)
select clave, valor from (
  select 1 o, 'Foodint · envíos a Diez por tipo y estado (no se tocan)' clave,
    (select coalesce(string_agg(kind || ' ' || status || ' ' || n, ' · ' order by kind, status), 'ninguno')
       from (select kind, status, count(*) n from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1, 2) x) valor union all
  select 2, 'Foodint · huella de los envíos (asiento, estado, número en Diez, intentos)',
    (select md5(coalesce(string_agg(entry_id::text || ':' || status || ':' || coalesce(ext_series, '') || '/' || coalesce(ext_number::text, '') || ':' || attempts, ',' order by entry_id), ''))
       from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 3, 'Foodint · lo autorizado en Diez (alcance, desde, recibidas)',
    (select coalesce(string_agg(alcance || ' ' || coalesce(desde::text, '—') || ' ' || coalesce(incluye_recibidas::text, '—'), ' · ' order by alcance, created_at), 'nada')
       from public.conta_diez_autorizo where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) t order by o;
