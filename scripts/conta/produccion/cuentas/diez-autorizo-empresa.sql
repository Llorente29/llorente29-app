-- scripts/conta/produccion/cuentas/diez-autorizo-empresa.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE DATOS DE LA RESPUESTA 8, TAREA 1
-- (20261111T0750), antes y después. Lo declara el manifiesto y lo comparan
-- deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- conta_diez_autorizo, TABLA ENTERA a propósito y dicho (regla 9) en la fila 1;
-- las demás, de la cuenta de Foodint. Los envíos no cambian con la tanda: se
-- cuentan para que se vea que no sale nada solo.
select clave, valor from (
  select 1 o, 'autorizaciones (tabla entera) por alcance y base' clave,
    coalesce((select string_agg(alcance || ' ' || nombre_bd || ' ' || n, ' · ' order by alcance, nombre_bd) from (select alcance, nombre_bd, count(*) n from public.conta_diez_autorizo group by 1, 2) x), 'ninguna') valor union all
  select 2, 'empresa de Foodint en C0008',
    coalesce((select string_agg('desde ' || coalesce(desde::text, 'siempre') || ' · recibidas ' || incluye_recibidas || ' · por ' || autorizado_por, ' | ')
                from public.conta_diez_autorizo where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and alcance = 'empresa' and upper(nombre_bd) = 'C0008'), 'no autorizada') union all
  select 3, 'autorizaciones de asiento de Foodint en C0008',
    (select count(*) from public.conta_diez_autorizo where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and alcance = 'asiento' and upper(nombre_bd) = 'C0008')::text union all
  select 4, 'envíos de Foodint a Diez por estado',
    coalesce((select string_agg(status || ' ' || n, ' · ' order by status) from (select status, count(*) n from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1) x), 'ninguno')
) t order by o;
