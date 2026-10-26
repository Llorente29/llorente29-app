-- scripts/conta/produccion/cuentas/pc01-e2.sql
--
-- PC01 · Entrega 2 (26/10) · LO QUE CUENTA LA TANDA DE COMPRAS › PAGOS, antes
-- y después. SOLO LEE. La 0915 solo añade: antes de la tanda y después de
-- deshacerla, todo «no existe» o 0; con la tanda, las tablas, las funciones y
-- el disparador, y la columna del sufijo del banco (respuesta 7).
--
-- Todo es del catálogo o de tablas que crea la propia tanda (miradas con
-- to_regclass): nada que otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, 'tablas de remesas de pagos (de 3)' clave,
    ((to_regclass('public.conta_pago_remesa') is not null)::int + (to_regclass('public.conta_pago_remesa_linea') is not null)::int
     + (to_regclass('public.conta_pago_remesa_evento') is not null)::int)::text valor union all
  select 2, 'remesas de pagos (base entera)',
    case when to_regclass('public.conta_pago_remesa') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_pago_remesa', false, true, '')))[1]::text end union all
  select 3, 'vistas del estado de las remesas (de 2)',
    ((to_regclass('public.conta_pago_remesa_estado') is not null)::int + (to_regclass('public.conta_pago_remesa_linea_estado') is not null)::int)::text union all
  select 4, 'funciones de Compras › Pagos (conta_remesa*, conta_pago_a_mano, conta_pagos_lista, conta_recibidas_poner_vencimiento, _pc01e2_*)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and (p.proname like 'conta\_remesa%' or p.proname like '\_pc01e2\_%' or p.proname in ('conta_pago_a_mano', 'conta_pagos_lista', 'conta_recibidas_poner_vencimiento')))::text union all
  select 5, 'disparador que apunta el cambio de IBAN de un proveedor',
    (select count(*) from pg_trigger where tgname = 'pc01e2_proveedor_iban_cambiado' and tgrelid = 'public.supplier'::regclass)::text union all
  select 6, 'columna del sufijo del banco (treasury_account.sepa_suffix, de 1)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'treasury_account' and column_name = 'sepa_suffix')::text
) x order by o;
