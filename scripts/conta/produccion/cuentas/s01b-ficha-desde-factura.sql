-- scripts/conta/produccion/cuentas/s01b-ficha-desde-factura.sql
--
-- S01b (28/10) · LO QUE CUENTA LA TANDA DEL PROVEEDOR DESDE LA FACTURA (1304 y
-- 1305), antes y después. SOLO LEE.
--   · La 1304 solo añade: la columna supplier.data_from_invoice y
--     conta_proveedor_iban_de_factura (no existen antes ni al deshacerla).
--   · La 1305 cambia _pc01e2b_iban_de_la_factura con la misma firma: su huella
--     (md5 del cuerpo) cambia con la tanda y vuelve a la de antes al
--     deshacerla. Una sola firma (regla 2).
--   · Lo que la tanda NO toca, igual a los dos lados: los IBAN «sin confirmar»
--     de las fichas (solo los escribía el disparador que cambia la 1305).
-- Del catálogo, o de filas que solo escribe lo que la tanda cambia: nada que
-- otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, '1304: supplier.data_from_invoice existe' clave,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier' and column_name = 'data_from_invoice')::text valor union all
  select 2, '1304: conta_proveedor_iban_de_factura existe',
    (to_regprocedure('public.conta_proveedor_iban_de_factura(uuid,uuid)') is not null)::text union all
  select 3, '1305: huella de _pc01e2b_iban_de_la_factura (md5 del cuerpo) · firmas',
    coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public._pc01e2b_iban_de_la_factura()')), 'no existe')
    || ' · ' || (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_pc01e2b_iban_de_la_factura') union all
  select 4, 'fichas con un IBAN «sin confirmar» (tabla entera)',
    -- quieta: solo lo escribía el disparador que cambia la 1305, y con la 1305 ya no lo escribe nadie; 0 el 28/10
    (select count(*) from public.supplier where iban_unconfirmed_invoice_id is not null)::text
) x order by o;
