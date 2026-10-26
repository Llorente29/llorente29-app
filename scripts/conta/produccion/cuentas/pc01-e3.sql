-- scripts/conta/produccion/cuentas/pc01-e3.sql
--
-- PC01 · Entrega 3 (26/10) · LO QUE CUENTA LA TANDA DE VENTAS › COBROS, antes
-- y después. SOLO LEE. La 2142 solo añade: antes de la tanda y después de
-- deshacerla, todo «no existe» o 0; con la tanda, las tablas, las vistas y las
-- funciones de los mandatos y las remesas de recibos.
--
-- Todo es del catálogo o de tablas que crea la propia tanda (miradas con
-- to_regclass): nada que otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, 'tablas de mandatos y remesas de recibos (de 4)' clave,
    ((to_regclass('public.conta_mandato') is not null)::int + (to_regclass('public.conta_cobro_remesa') is not null)::int
     + (to_regclass('public.conta_cobro_remesa_linea') is not null)::int + (to_regclass('public.conta_cobro_remesa_evento') is not null)::int)::text valor union all
  select 2, 'remesas de recibos (base entera)',
    case when to_regclass('public.conta_cobro_remesa') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_cobro_remesa', false, true, '')))[1]::text end union all
  select 3, 'mandatos (base entera)',
    case when to_regclass('public.conta_mandato') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_mandato', false, true, '')))[1]::text end union all
  select 4, 'vistas del estado de las remesas de recibos (de 2)',
    ((to_regclass('public.conta_cobro_remesa_estado') is not null)::int + (to_regclass('public.conta_cobro_remesa_linea_estado') is not null)::int)::text union all
  select 5, 'funciones de Ventas › Cobros (_pc01e3_*, conta_mandato_*, conta_remesa(s)_cobros*, conta_cobros_*, conta_recibo_devuelto)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and (p.proname like '\_pc01e3\_%' or p.proname like 'conta\_mandato\_%' or p.proname like 'conta\_remesa\_cobros%' or p.proname like 'conta\_remesas\_cobros%'
            or p.proname in ('conta_cobros_lista', 'conta_cobros_para_casar', 'conta_recibo_devuelto')))::text
) x order by o;
