-- scripts/conta/produccion/cuentas/diez-autorizo-desde.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE LA RESPUESTA 8, TAREA 1, PASO 1
-- (20261111T0730), antes y después. Lo declara el manifiesto («cuenta: <este
-- fichero>») y lo comparan deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- conta_diez_autorizo, TABLA ENTERA a propósito y dicho (regla 9): hoy, una
-- fila, la de Foodint (alcance asiento, C0008). Las autorizaciones no cambian
-- con la tanda: tienen que salir iguales antes y después.
select clave, valor from (
  select 1 o, 'columna conta_diez_autorizo.desde' clave,
    (select coalesce(max(data_type || ' · admite vacío ' || is_nullable), 'no existe') from information_schema.columns
      where table_schema = 'public' and table_name = 'conta_diez_autorizo' and column_name = 'desde') valor union all
  select 2, 'restricción conta_diez_autorizo_desde_check',
    coalesce((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.conta_diez_autorizo'::regclass and conname = 'conta_diez_autorizo_desde_check'), 'no existe') union all
  select 3, 'autorizaciones (tabla entera) por alcance y base',
    coalesce((select string_agg(alcance || ' ' || nombre_bd || ' ' || n, ' · ' order by alcance, nombre_bd) from (select alcance, nombre_bd, count(*) n from public.conta_diez_autorizo group by 1, 2) x), 'ninguna') union all
  select 4, 'autorizaciones de Foodint', (select count(*) from public.conta_diez_autorizo where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
