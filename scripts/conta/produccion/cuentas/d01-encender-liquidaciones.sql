-- scripts/conta/produccion/cuentas/d01-encender-liquidaciones.sql
--
-- D01 · LO QUE CUENTA LA TANDA QUE ENCIENDE liquidaciones-foodint@, antes y
-- después. SOLO LEE. Recuentos de Foodint (regla 9); ningún nombre, dirección
-- de correo de nadie ni importe. Lo esperado: la primera pasa de 0 a 1; las
-- demás no se mueven (la tanda no recibe correos ni lee nada).
select clave, valor from (
  select 1 o, 'dirección de liquidaciones de Foodint (filas / encendidas)' clave,
    (select count(*) || ' / ' || count(*) filter (where active) from public.company_inbound_address
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'liquidaciones' and lower(local_part) = 'liquidaciones-foodint') valor union all
  select 2, 'direcciones de entrada de Foodint (todas / encendidas)',
    (select count(*) || ' / ' || count(*) filter (where active) from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 3, 'correos en el registro de entrada (todos)', (select count(*) from public.inbound_email_log)::text union all
  select 4, 'liquidaciones de Foodint leídas de un correo', (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source like 'correo\_%')::text
) t order by o;
