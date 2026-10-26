-- scripts/conta/produccion/cuentas/v04-tique.sql
--
-- V04 · PR 1 (26/10) · LO QUE CUENTA LA TANDA DEL TIQUE DE LA BOLSA, antes y
-- después. SOLO LEE. Los pedidos y las bolsas son de Foodint (regla 9), con un
-- corte fijo (W06); las tablas de la serie son de la base entera, y se dice.
-- Las tablas que crea la tanda solo se nombran dentro de cadenas.
-- Lo que tiene que cambiar: las tablas de la serie (0 → 3 de 3) y la huella de
-- fiscal_for_print (6efe86f5 → la nueva). Lo demás, igual: los pedidos y las
-- bolsas de Foodint hasta el corte, y las funciones del camino que la 2309 usa.
select clave, valor from (
  select 1 o, 'pedidos de Foodint hasta el corte (propias / cedidas)' clave,
    (select count(*) filter (where b.ownership_type = 'own') || ' / ' || count(*) filter (where b.ownership_type = 'licensed')
       from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.created_at < timestamptz '2026-10-26 22:00:00+00') valor union all
  select 2, 'bolsas impresas de Foodint hasta el corte',
    (select count(*) from public.print_job where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and doc_type = 'bag'
        and status = 'done' and created_at < timestamptz '2026-10-26 22:00:00+00')::text union all
  select 3, 'tablas de la serie del tique (base entera)',
    (select count(*) from unnest(array['location_invoice_code', 'ticket_invoice_series', 'ticket_invoice']) t where to_regclass('public.' || t) is not null) || ' de 3' union all
  select 4, 'huella de fiscal_for_print',
    (select left(md5(pg_get_functiondef(p.oid)), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'fiscal_for_print') union all
  select 5, 'huella de las funciones del camino que usa la 2309',
    (select string_agg(p.proname || ' ' || left(md5(p.prosrc), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('kds_resolve_device', 'order_for_print', 'claim_print_jobs', 'report_print_job', 'close_sale', 'cancel_sale', 'encolar_alerta'))
) t order by o;
