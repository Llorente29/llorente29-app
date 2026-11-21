-- scripts/conta/produccion/cuentas/k07-cambiar-documento.sql
--
-- K07 · Cambiar el documento de una recibida contabilizada (2004) · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La tanda añade una tabla y una función nuevas y no cambia ninguna otra. Se mide que los
-- documentos de los asientos, los de las recibidas y su historial siguen igual (tabla entera, a
-- propósito: regla 9, excepción). Corte fijo: lo creado antes del 21/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'tabla entera · journal_entry_document de recibidas (filas · huella)' clave,
         count(*)::text || ' · ' || coalesce(md5(string_agg(id::text || storage_path, ',' order by id)), '-') valor
    from public.journal_entry_document where kind = 'factura_recibida' and created_at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 2, 'tabla entera · supplier_invoice con documento (filas · huella)',
         count(*)::text || ' · ' || coalesce(md5(string_agg(id::text || raw_document_url, ',' order by id)), '-')
    from public.supplier_invoice where raw_document_url is not null and created_at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 3, 'tabla entera · supplier_invoice_change del documento', count(*)::text
    from public.supplier_invoice_change where what = 'papel' and at < timestamptz '2026-11-21 00:00:00+01'
  union all
  select 4, 'funciones · conta_recibida_papel_poner y conta_documento_factura_guardar (md5)',
         md5(pg_get_functiondef('public.conta_recibida_papel_poner(uuid,text,text,text)'::regprocedure)
             || pg_get_functiondef('public.conta_documento_factura_guardar(uuid,text,text,text,integer,text)'::regprocedure))
) x order by o;
