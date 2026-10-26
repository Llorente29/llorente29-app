-- scripts/conta/produccion/cuentas/pc01-e2b.sql
--
-- PC01 · Entrega 2b (26/10) · LO QUE CUENTA LA TANDA DEL IBAN DE LAS FACTURAS,
-- antes y después. SOLO LEE. Antes de la tanda y después de deshacerla: sin
-- columnas, disparador ni funciones nuevas, y las seis funciones que cambia
-- con la huella de producción medida el 26/10. Con la tanda: las cuatro
-- columnas, el disparador, las tres funciones nuevas y las seis con otra huella.
--
-- Todo es del catálogo: nada que otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, 'columnas nuevas de supplier (iban_set_*, iban_unconfirmed_invoice_id, de 4)' clave,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'supplier'
       and column_name in ('iban_set_at', 'iban_set_by', 'iban_set_by_name', 'iban_unconfirmed_invoice_id'))::text valor union all
  select 2, 'disparador que pone el IBAN leído de una factura (de 1)',
    (select count(*) from pg_trigger where tgname = 'pc01e2b_iban_de_la_factura' and tgrelid = 'public.supplier_invoice'::regclass)::text union all
  select 3, 'funciones nuevas (_pc01e2b_*, conta_proveedor_iban_poner, de 3)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like '\_pc01e2b\_%' or p.proname = 'conta_proveedor_iban_poner'))::text union all
  select 4, 'de las seis que cambia, cuántas tienen la huella de producción del 26/10 (de 6)',
    (select count(*) from (values
      ('conta_factura_desde_lectura(uuid,uuid)', '2279355e38145dd73f902a03e92e2808'),
      ('_pc01e2_iban_como_esta(uuid,text)', 'f0296a5809ca955149a68a924daccf27'),
      ('_pc01e2_proveedor_iban_cambiado()', '7f425beb5411a47bbdfe9c1c2201eaea'),
      ('conta_remesa_pagos_crear(uuid,uuid,date,jsonb)', '97c8712b380de46a8f39eb6e93193c62'),
      ('conta_remesa_iban_confirmar(uuid)', '7892fb85f132dd1271c490d6609fbc31'),
      ('conta_pagos_lista(uuid,date)', 'f0385838d4fdf0e733460db4aec0b335')) x(f, h)
      where md5(pg_get_functiondef(('public.' || x.f)::regprocedure)) = x.h)::text
) x order by o;
