-- scripts/conta/produccion/cuentas/diez-autorizo-recibidas.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE LA RESPUESTA 8, TAREA 1 (20261111T0740),
-- antes y después. Lo declara el manifiesto y lo comparan deshacer.sh y el
-- ensayo de la vuelta atrás. SOLO LEE.
--
-- conta_diez_autorizo, TABLA ENTERA a propósito y dicho (regla 9): hoy, una
-- fila, la de Foodint (alcance asiento, C0008). Las autorizaciones no cambian.
select clave, valor from (
  select 1 o, 'columna conta_diez_autorizo.incluye_recibidas' clave,
    (select coalesce(max(data_type || ' · admite vacío ' || is_nullable || ' · por defecto ' || coalesce(column_default, '—')), 'no existe') from information_schema.columns
      where table_schema = 'public' and table_name = 'conta_diez_autorizo' and column_name = 'incluye_recibidas') valor union all
  select 2, 'autorizaciones (tabla entera) por alcance y base',
    coalesce((select string_agg(alcance || ' ' || nombre_bd || ' ' || n, ' · ' order by alcance, nombre_bd) from (select alcance, nombre_bd, count(*) n from public.conta_diez_autorizo group by 1, 2) x), 'ninguna') union all
  select 3, 'autorizaciones de Foodint', (select count(*) from public.conta_diez_autorizo where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
