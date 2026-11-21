-- scripts/conta/produccion/cuentas/x24-proveedor-nunca-repetido.sql
--
-- X24 · Un proveedor nunca se da de alta dos veces (1700 y 1710) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Regla 31, por cuenta (regla 9: cada cifra con su account_id; sin nombres ni NIF, el registro es público):
--   · cuántos proveedores y cuántos sin NIF;
--   · cuántas recibidas con proveedor;
--   · cuántos NIF repetidos (limpios, _conta_nif_clave) hay: la medida del punto 2, que la 1710 exige a cero.
-- Y las huellas del texto de las dos funciones que cambia la 1700, y qué índice único guarda el NIF.
-- Corte fijo: lo creado antes del 22/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || s.account_id || ' · proveedores' clave, count(*)::text valor
    from public.supplier s where s.created_at < timestamptz '2026-11-22 00:00:00+01' group by s.account_id
  union all
  select 2, 'cuenta ' || s.account_id || ' · proveedores sin NIF', count(*)::text
    from public.supplier s where s.created_at < timestamptz '2026-11-22 00:00:00+01' and public._conta_nif_clave(s.tax_id) is null group by s.account_id
  union all
  select 3, 'cuenta ' || i.account_id || ' · recibidas con proveedor', count(*)::text
    from public.supplier_invoice i where i.created_at < timestamptz '2026-11-22 00:00:00+01' and i.supplier_id is not null group by i.account_id
  union all
  select 4, 'cuenta ' || g.account_id || ' · NIF repetidos (limpios)', count(*)::text
    from (select s.account_id from public.supplier s
           where s.created_at < timestamptz '2026-11-22 00:00:00+01' and public._conta_nif_clave(s.tax_id) is not null
           group by s.account_id, public._conta_nif_clave(s.tax_id) having count(*) > 1) g group by g.account_id
  union all
  select 5, 'todas las cuentas · NIF repetidos (limpios)', count(*)::text
    from (select 1 from public.supplier s
           where s.created_at < timestamptz '2026-11-22 00:00:00+01' and public._conta_nif_clave(s.tax_id) is not null
           group by s.account_id, public._conta_nif_clave(s.tax_id) having count(*) > 1) g
  union all
  select 6, 'función · ' || p.oid::regprocedure::text, md5(p.prosrc)
    from pg_proc p where p.oid in ('public._conta_proveedor_solo(uuid,text)'::regprocedure, 'public._conta_proveedor_solo_deshacer(uuid,text)'::regprocedure)
  union all
  select 7, 'índice único del NIF de supplier', coalesce(string_agg(i.indexname, ', ' order by i.indexname), '-')
    from pg_indexes i where i.schemaname = 'public' and i.tablename = 'supplier' and i.indexname in ('ux_supplier_account_tax_id', 'ux_supplier_account_nif_clave')
) t order by o, clave;
