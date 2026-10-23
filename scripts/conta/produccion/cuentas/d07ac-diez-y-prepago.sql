-- scripts/conta/produccion/cuentas/d07ac-diez-y-prepago.sql
--
-- D07a · LO QUE CUENTA LA TANDA «LAS RECIBIDAS RECHAZADAS POR LA DESCRIPCIÓN,
-- OTRA VEZ A LA COLA» (0820), antes y después. SOLO LEE. Antes (medido el
-- 23/10 a las 13:17 UTC): 60 envíos de RIDERS de Foodint «pendiente» con el
-- error de la descripción, ninguno con el motivo de la 0820. Después: 0 con
-- intentos agotados por eso y los mismos con el motivo de la 0820 (o ya en
-- Diez, si la cola ha pasado). Y que no se mueve nada más: los envíos de
-- Foodint por estado. Todo de Foodint (regla 9).
-- Y la 0830 (D07c, «Saldo prepago» en todas las listas): antes, las dos
-- funciones con su md5 de producción, los tres CHECK sin «prepaid» y el
-- catálogo sin su fila; después, los md5 nuevos, los CHECK con «prepaid» y la
-- fila. Las facturas pagadas con «prepaid» y los clientes con «prepaid», de
-- todas las cuentas, dicho (0 y 0: la 0830 no toca filas).
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
         (select count(*) from public.external_send where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and attempts >= 3)::text union all
  select 5, 'md5 conta_recibida_guardar', md5(pg_get_functiondef('public.conta_recibida_guardar(uuid,jsonb,text)'::regprocedure)) union all
  select 6, 'md5 mark_supplier_invoice_paid', md5(pg_get_functiondef('public.mark_supplier_invoice_paid(uuid,date,text)'::regprocedure)) union all
  select 7, 'CHECK con prepaid (paid_method, customer_fiscal, payment_method.kind)',
         (select count(*) from pg_constraint where conname in ('supplier_invoice_paid_method_check', 'customer_fiscal_payment_method_check', 'payment_method_kind_check')
             and pg_get_constraintdef(oid) like '%prepaid%')::text union all
  select 8, 'fila «Saldo prepago» en el catálogo de Foodint', (select count(*) from public.payment_method where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'prepaid')::text union all
  select 9, 'facturas pagadas con prepaid y clientes con prepaid (todas las cuentas)',
         ((select count(*) from public.supplier_invoice where paid_method = 'prepaid') || ' y ' || (select count(*) from public.customer_fiscal where payment_method = 'prepaid'))
) t order by o;
