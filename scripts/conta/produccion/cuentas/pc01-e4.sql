-- scripts/conta/produccion/cuentas/pc01-e4.sql
--
-- PC01 · Entrega 4 (27/10) · LO QUE CUENTA LA TANDA DE LOS RECORDATORIOS, antes
-- y después. SOLO LEE. La 0641 solo añade: antes de la tanda y después de
-- deshacerla, todo «no existe» o 0; con la tanda, sus tres tablas (vacías al
-- aplicarse), sus funciones y, solo donde está el cron_secret, su cron.
--
-- Todo es del catálogo o de tablas que crea la propia tanda (miradas con
-- to_regclass): nada que otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, 'tablas de los recordatorios (de 3)' clave,
    ((to_regclass('public.conta_cobro_ajuste') is not null)::int + (to_regclass('public.conta_cobro_cliente') is not null)::int
     + (to_regclass('public.conta_recordatorio') is not null)::int)::text valor union all
  select 2, 'recordatorios apuntados (base entera)',
    case when to_regclass('public.conta_recordatorio') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_recordatorio', false, true, '')))[1]::text end union all
  select 3, 'funciones de los recordatorios (_pc01e4_*, conta_recordatorio*, conta_cobro_ajustes_guardar)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and (p.proname like '\_pc01e4\_%' or p.proname like 'conta\_recordatorio%' or p.proname = 'conta_cobro_ajustes_guardar'))::text union all
  select 4, 'cron conta-recordatorios-despertar',
    case when to_regclass('cron.job') is null then 'sin pg_cron'
         else (select count(*) from cron.job where jobname = 'conta-recordatorios-despertar')::text end
) x order by o;
