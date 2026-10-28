-- scripts/conta/produccion/cuentas/s01-enlace-validado.sql
--
-- S01 · PR 3 (28/10) · LO QUE CUENTA LA TANDA DEL COBRO POR EL ENLACE VALIDADO
-- (0735), antes y después. SOLO LEE.
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
    (select count(*) from public.funcion_respaldo where migracion = '20261028T0735_s01_enlace_validado')::text
) x order by o;
