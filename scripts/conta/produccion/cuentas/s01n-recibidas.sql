-- scripts/conta/produccion/cuentas/s01n-recibidas.sql
--
-- S01n · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. Sin nombres.
-- Lo que tiene que pasar: la huella del cuerpo de conta_documentos_recibidos
-- pasa de 3e5a1a7e… (S01g) a 6a1943f6… (S01n); las facturas no cambian.
select clave, valor from (
  select 1 o, 'huella de conta_documentos_recibidos' clave,
    -- quieta: es la huella del cuerpo de la función; solo la cambia una migración.
    (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_documentos_recibidos(uuid,date,date)')) valor union all
  select 2, 'facturas recibidas de Foodint',
    (select count(*)::text from public.supplier_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 10:40+00')
) q order by o;
