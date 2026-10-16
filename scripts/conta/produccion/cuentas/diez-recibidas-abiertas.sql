-- scripts/conta/produccion/cuentas/diez-recibidas-abiertas.sql
--
-- C06b · LO QUE CUENTA LA TANDA DE DATOS 20261111T0760 (las recibidas abiertas
-- en C0008), antes y después. Lo declara el manifiesto y lo comparan
-- deshacer.sh y el ensayo de la vuelta atrás. SOLO LEE.
--
-- conta_diez_autorizo, TABLA ENTERA a propósito y dicho (regla 9) en la fila 1;
-- las demás, de la cuenta de Foodint. Los envíos no cambian con la tanda: se
-- cuentan para que se vea que no sale nada solo.
select clave, valor from (
  select 1 o, 'autorizaciones (tabla entera) por alcance, base y recibidas' clave,
    coalesce((select string_agg(alcance || ' ' || nombre_bd || ' recibidas ' || incluye_recibidas || ' ' || n, ' · ' order by alcance, nombre_bd, incluye_recibidas)
                from (select alcance, nombre_bd, incluye_recibidas, count(*) n from public.conta_diez_autorizo group by 1, 2, 3) x), 'ninguna') valor union all
  select 2, 'empresa de Foodint en C0008',
    coalesce((select string_agg('desde ' || coalesce(desde::text, 'siempre') || ' · recibidas ' || incluye_recibidas || ' · por ' || autorizado_por, ' | ')
                from public.conta_diez_autorizo where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and alcance = 'empresa' and upper(nombre_bd) = 'C0008'), 'no autorizada') union all
  select 3, 'motivo de la de empresa (md5)',
    coalesce((select md5(motivo) from public.conta_diez_autorizo where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and alcance = 'empresa' and upper(nombre_bd) = 'C0008'), '—') union all
  select 4, 'envíos de Foodint a Diez por origen y estado',
    coalesce((select string_agg(t, ' · ' order by t) from (select coalesce(je.source_type, '?') || ' ' || s.status || ' ' || count(*) t
                from public.external_send s left join public.journal_entry je on je.id = s.entry_id
               where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by je.source_type, s.status) x), 'ninguno')
) t order by o;
