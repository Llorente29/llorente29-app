-- scripts/conta/produccion/cuentas/s01p-pdf-en-apuntada.sql
--
-- S01p·22 · LO QUE CUENTA LA TANDA (0831), antes y después. SOLO LEE: el catálogo, y las seis recibidas de
-- octubre de Foodint sin PDF por su id (la tanda no les pone nada: se suben desde la ficha).
select clave, valor from (
  -- quieta: las seis recibidas de octubre de Foodint sin PDF, todas con su asiento validado, por su id
  select 1 o, 'Foodint · las seis de octubre sin PDF (con PDF · con asiento validado)' clave,
    (select count(*) filter (where i.raw_document_url is not null) || ' · ' ||
            count(*) filter (where exists (select 1 from public.journal_entry e where e.account_id = i.account_id and e.source_type = 'supplier_invoice' and e.source_id = i.id and e.status = 'validado'))
       from public.supplier_invoice i
      where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and i.id in ('df26698f-fb48-4ab7-95de-b57b57aa4123', '75ca5504-8630-4c23-9efe-783849ab1194', '7f49f4db-b2e0-42bd-baa9-cd40d7ba05db',
                     'e84785f9-c615-4a8d-9312-22884820ac9e', '0036ec96-8595-4349-b110-8ec92cdb02bb', '61e8462c-26a7-4c82-a257-039c52a4f1ca')) valor
  union all
  select 2, 'conta_recibida_papel_poner admite el PDF de una apuntada sin PDF (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_recibida_papel_poner(uuid,text,text,text)'::regprocedure), 'S01p·22') > 0)::int::text
) t order by o;
