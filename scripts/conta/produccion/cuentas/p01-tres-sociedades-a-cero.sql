-- scripts/conta/produccion/cuentas/p01-tres-sociedades-a-cero.sql
--
-- P01 · Las tres sociedades del P01 a cero (1015) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. Dentro de las tres (y del proveedor de su cuenta): cada tabla que se borra → 0.
--   2. Las tres, contadas como LO QUE FALTA (0 después; y 0 también donde no existen, como en staging):
--      con trade_name distinto de legal_name, sin el ejercicio del 01/11/2026, con _conta_corte distinto
--      de 2026-11-01, y sin sus 10 meses (enero a octubre) cerrados como traídos.
--   3. Fuera de las tres, cada tabla tocada: como antes. Corte fijo (el #241): lo creado antes del
--      17/11/2026 a las 00:00 de Madrid, para que lo que entre a mitad del ensayo no lo pare sin culpa.
--   4. Los ficheros de la cuenta en el almacén: como antes (SQL no puede borrarlos; los borra Julio).
with tres(id) as (values ('328360db-736f-4d45-b4ee-ecf1ca96fa15'::uuid), ('bd73d3ae-2a43-4896-a70a-73f92b62c065'::uuid),
                         ('86d8022d-7a92-4f9d-9cf9-d53729e96ef1'::uuid))
select clave, valor from (
  -- quieta: las tres sociedades del P01; si les entra correo entre el ensayo y el real, para la guarda de la 1015
  select 101 o, 'Las tres · supplier_invoice' clave, count(*)::text valor from public.supplier_invoice where company_id in (select id from tres)
  union all
  -- quieta: las líneas de las facturas de las tres
  select 102, 'Las tres · supplier_invoice_line', count(*)::text from public.supplier_invoice_line
   where supplier_invoice_id in (select id from public.supplier_invoice where company_id in (select id from tres))
  union all
  -- quieta: el IVA de las facturas de las tres
  select 103, 'Las tres · supplier_invoice_tax', count(*)::text from public.supplier_invoice_tax
   where supplier_invoice_id in (select id from public.supplier_invoice where company_id in (select id from tres))
  union all
  -- quieta: los cambios de las facturas de las tres
  select 104, 'Las tres · supplier_invoice_change', count(*)::text from public.supplier_invoice_change
   where supplier_invoice_id in (select id from public.supplier_invoice where company_id in (select id from tres))
  union all
  -- quieta: la bandeja de las tres
  select 105, 'Las tres · document_inbox', count(*)::text from public.document_inbox where company_id in (select id from tres)
  union all
  -- quieta: la actividad de las tres
  select 106, 'Las tres · document_activity', count(*)::text from public.document_activity where company_id in (select id from tres)
  union all
  -- quieta: los correos de las tres
  select 107, 'Las tres · inbound_email_log', count(*)::text from public.inbound_email_log where company_id in (select id from tres)
  union all
  -- quieta: las propuestas pendientes de las tres
  select 108, 'Las tres · conta_propuesta_pendiente', count(*)::text from public.conta_propuesta_pendiente where company_id in (select id from tres)
  union all
  -- quieta: las facturas esperadas de las tres
  select 109, 'Las tres · supplier_expected_invoice', count(*)::text from public.supplier_expected_invoice where company_id in (select id from tres)
  union all
  -- quieta: los proveedores de la cuenta de las tres
  select 110, 'Su cuenta · supplier', count(*)::text from public.supplier where account_id = 'a175c0b8-2eaf-4285-9688-53042910a86e'
  union all
  -- quieta: los enlaces contables de un proveedor, en las tres
  select 111, 'Las tres · company_account_link de proveedor', count(*)::text from public.company_account_link
   where company_id in (select id from tres) and entity = 'supplier'
  union all
  -- quieta: las tres por su id
  select 201, 'Las tres · con trade_name distinto de legal_name', count(*)::text
    from public.company where id in (select id from tres) and trade_name is distinct from legal_name
  union all
  -- quieta: las tres por su id
  select 202, 'Las tres · sin el ejercicio del 01/11/2026', count(*)::text from public.company c
   where c.id in (select id from tres)
     and not exists (select 1 from public.fiscal_year f where f.company_id = c.id and date '2026-11-01' between f.starts_on and f.ends_on)
  union all
  -- quieta: las tres por su id
  select 203, 'Las tres · con _conta_corte distinto de 2026-11-01', count(*)::text from public.company c
   where c.id in (select id from tres) and public._conta_corte(c.id) is distinct from date '2026-11-01'
  union all
  -- quieta: las tres por su id
  select 204, 'Las tres · sin sus 10 meses cerrados como traídos', count(*)::text from public.company c
   where c.id in (select id from tres)
     and (select count(*) from public.fiscal_period_lock l where l.company_id = c.id and l.kind = 'migrated' and l.reopened_at is null
           and l.month between date '2026-01-01' and date '2026-10-01') <> 10
  union all
  -- corte: facturas recibidas creadas antes del 17/11 a las 00:00
  select 301, 'Fuera de las tres · supplier_invoice', count(*)::text from public.supplier_invoice
   where company_id not in (select id from tres) and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: líneas creadas antes del 17/11 a las 00:00
  select 302, 'Fuera de las tres · supplier_invoice_line', count(*)::text from public.supplier_invoice_line l
   where l.created_at < timestamptz '2026-11-17 00:00:00+01'
     and l.supplier_invoice_id not in (select id from public.supplier_invoice where company_id in (select id from tres))
  union all
  -- corte: IVA creado antes del 17/11 a las 00:00
  select 303, 'Fuera de las tres · supplier_invoice_tax', count(*)::text from public.supplier_invoice_tax t
   where t.created_at < timestamptz '2026-11-17 00:00:00+01'
     and t.supplier_invoice_id not in (select id from public.supplier_invoice where company_id in (select id from tres))
  union all
  -- corte: cambios hechos antes del 17/11 a las 00:00
  select 304, 'Fuera de las tres · supplier_invoice_change', count(*)::text from public.supplier_invoice_change c
   where c.at < timestamptz '2026-11-17 00:00:00+01'
     and c.supplier_invoice_id not in (select id from public.supplier_invoice where company_id in (select id from tres))
  union all
  -- corte: bandeja creada antes del 17/11 a las 00:00
  select 305, 'Fuera de las tres · document_inbox', count(*)::text from public.document_inbox
   where (company_id is null or company_id not in (select id from tres)) and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: actividad creada antes del 17/11 a las 00:00
  select 306, 'Fuera de las tres · document_activity', count(*)::text from public.document_activity
   where (company_id is null or company_id not in (select id from tres)) and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: correos recibidos antes del 17/11 a las 00:00
  select 307, 'Fuera de las tres · inbound_email_log', count(*)::text from public.inbound_email_log
   where (company_id is null or company_id not in (select id from tres)) and received_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: propuestas de antes del 17/11 a las 00:00
  select 308, 'Fuera de las tres · conta_propuesta_pendiente', count(*)::text from public.conta_propuesta_pendiente
   where (company_id is null or company_id not in (select id from tres)) and at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: esperadas creadas antes del 17/11 a las 00:00
  select 309, 'Fuera de las tres · supplier_expected_invoice', count(*)::text from public.supplier_expected_invoice
   where (company_id is null or company_id not in (select id from tres)) and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: proveedores creados antes del 17/11 a las 00:00
  select 310, 'Fuera de su cuenta · supplier', count(*)::text from public.supplier
   where account_id <> 'a175c0b8-2eaf-4285-9688-53042910a86e' and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: contactos creados antes del 17/11 a las 00:00
  select 311, 'Fuera de su cuenta · supplier_contact', count(*)::text from public.supplier_contact
   where account_id <> 'a175c0b8-2eaf-4285-9688-53042910a86e' and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: papeles creados antes del 17/11 a las 00:00
  select 312, 'Fuera de su cuenta · party_role', count(*)::text from public.party_role
   where account_id <> 'a175c0b8-2eaf-4285-9688-53042910a86e' and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: terceros creados antes del 17/11 a las 00:00
  select 313, 'Fuera de su cuenta · party', count(*)::text from public.party
   where account_id <> 'a175c0b8-2eaf-4285-9688-53042910a86e' and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: enlaces creados antes del 17/11 a las 00:00
  select 314, 'Fuera de las tres · company_account_link', count(*)::text from public.company_account_link
   where (company_id is null or company_id not in (select id from tres)) and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: historial de cuentas de antes del 17/11 a las 00:00
  select 315, 'Fuera de las tres · company_account_log', count(*)::text from public.company_account_log
   where (company_id is null or company_id not in (select id from tres)) and done_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: empresas creadas antes del 17/11 a las 00:00 (su nombre, en huella: ni un nombre aquí)
  select 316, 'Fuera de las tres · company · huella de trade_name', md5(coalesce(string_agg(id::text || ':' || coalesce(trade_name, ''), '|' order by id), ''))
    from public.company where id not in (select id from tres) and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: ejercicios creados antes del 17/11 a las 00:00
  select 317, 'Fuera de las tres · fiscal_year · huella', md5(coalesce(string_agg(id::text || ':' || origin || ':' || coalesce(origin_program, '') || ':' || coalesce(imported_until::text, ''), '|' order by id), ''))
    from public.fiscal_year where company_id not in (select id from tres) and created_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: meses cerrados antes del 17/11 a las 00:00
  select 318, 'Fuera de las tres · fiscal_period_lock', count(*)::text from public.fiscal_period_lock
   where company_id not in (select id from tres) and locked_at < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- quieta: los ficheros de su cuenta (SQL no puede borrarlos; los borra Julio desde el almacén)
  select 401, 'Su cuenta · ficheros en receipt-uploads', count(*)::text from storage.objects
   where bucket_id = 'receipt-uploads' and name like 'a175c0b8-2eaf-4285-9688-53042910a86e/%'
) t order by o;
