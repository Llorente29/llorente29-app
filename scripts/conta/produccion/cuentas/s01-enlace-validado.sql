-- scripts/conta/produccion/cuentas/s01-enlace-validado.sql
--
-- S01 · PR 3 (28/10) · LO QUE CUENTA LA TANDA DEL COBRO POR EL ENLACE VALIDADO
-- (0735), y de la base y las nóminas de las propuestas sin botón (0753 y
-- 0800), antes y después. SOLO LEE. La 0753 y la 0800 solo añaden: antes y al
-- deshacerlas, «no existe» o 0.
--   · La 0735 añade _journal_entry_validar (no existe antes ni al deshacerla) y
--     cambia journal_entry_validar y _s01_asiento_cobro con la misma firma: su
--     huella (md5 del cuerpo) cambia con la tanda y vuelve a la de antes al
--     deshacerla. Una sola firma de cada una (regla 2).
--   · Lo que la tanda NO toca, igual a los dos lados: los asientos de cobro por
--     el enlace (hoy 0, tabla entera) y los asientos validados de hoy.
-- Del catálogo, o de filas que solo escribe lo que la tanda cambia: nada que
-- otro proceso escriba a mitad del ensayo (W06).
select clave, valor from (
  select 1 o, '_journal_entry_validar existe' clave,
    (to_regprocedure('public._journal_entry_validar(uuid,text)') is not null)::text valor union all
  select 2, 'huella de journal_entry_validar y _s01_asiento_cobro (md5 de los cuerpos)',
    (select md5(string_agg(p.proname || ':' || md5(p.prosrc), ',' order by p.proname)) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('journal_entry_validar', '_s01_asiento_cobro')) union all
  select 3, 'firmas de journal_entry_validar, _journal_entry_validar y _s01_asiento_cobro',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('journal_entry_validar', '_journal_entry_validar', '_s01_asiento_cobro'))::text union all
  select 4, 'asientos de cobro por el enlace (customer_payment, tabla entera)',
    -- quieta: solo los escribe _s01_asiento_cobro al cobrar por el enlace, y el cobro está apagado en producción (0 enlaces de pago el 28/10)
    (select count(*) from public.journal_entry where source_type = 'customer_payment')::text union all
  select 5, 'respaldos de la 0735 (funcion_respaldo)',
    (select count(*) from public.funcion_respaldo where migracion = '20261028T0735_s01_enlace_validado')::text union all
  select 6, '0753: «Lo que no he podido proponer» (filas, o no existe)',
    case when to_regclass('public.conta_propuesta_pendiente') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_propuesta_pendiente', false, true, '')))[1]::text end union all
  select 7, '0753 y 0800: funciones nuevas (de 7)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('conta_dia_abierto', '_conta_proponer', '_conta_no_propuesta', 'conta_propuesta_nomina', 'conta_proponer_nominas', 'tg_conta_nomina_proponer'))::text union all
  select 8, '0800: disparador de las nóminas',
    (select count(*) from pg_trigger where tgname = 'conta_nomina_proponer')::text union all
  select 9, 'nóminas y sus asientos (payroll_summary, journal_entry payroll; tabla entera)',
    -- quieta: payroll_summary está vacía en producción (Laboral aún no la escribe) y solo la 0800 propone nóminas solas
    ((select count(*) from public.payroll_summary) || ' · ' || (select count(*) from public.journal_entry where source_type = 'payroll'))
) x order by o;
