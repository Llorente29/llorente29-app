-- scripts/conta/produccion/cuentas/d07a-diez-reenviar.sql
--
-- D07a · LO QUE CUENTA LA TANDA «LAS RECIBIDAS RECHAZADAS POR LA DESCRIPCIÓN,
-- OTRA VEZ A LA COLA» (0820), antes y después. SOLO LEE. Antes (medido el
-- 23/10 a las 13:17 UTC): 60 envíos de RIDERS de Foodint «pendiente» con el
-- error de la descripción, ninguno con el motivo de la 0820. Después: 0 con
-- intentos agotados por eso y los mismos con el motivo de la 0820 (o ya en
-- Diez, si la cola ha pasado). Y que no se mueve nada más: los envíos de
-- Foodint por estado. Todo de Foodint (regla 9).
select clave, valor from (
  select 1 o, 'envíos de RIDERS pendientes por la descripción' clave,
         (select count(*) from public.external_send x join public.journal_entry e on e.id = x.entry_id and e.account_id = x.account_id
            join public.supplier_invoice i on i.id = e.source_id and i.account_id = x.account_id
           where x.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and i.supplier_id = 'cbe3ddb1-5d3a-4aa7-a907-38f362e922b1'
             and x.status = 'pendiente' and x.last_error not like 'Se vuelve a mandar%'
             and (x.last_error ilike '%factura.Descripcion%' or x.last_error ilike '%intento anterior: Diez no ha aceptado la factura%'))::text valor union all
  select 2, 'con el motivo de la 0820',
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
             and last_error like 'Se vuelve a mandar con la descripción en 40 caracteres (D07a).%')::text union all
  select 3, 'envíos de Foodint por estado',
         (select coalesce(json_object_agg(status, n), '{}')::text from (select status, count(*) n from public.external_send
           where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by status) s) union all
  select 4, 'envíos de Foodint con 3 intentos o más',
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and attempts >= 3)::text
) t order by o;
