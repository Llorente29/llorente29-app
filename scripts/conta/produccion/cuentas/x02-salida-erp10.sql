-- scripts/conta/produccion/cuentas/x02-salida-erp10.sql
--
-- X02 · La base de la salida a ERP10 (1010, 1011) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo crea cuatro tablas y cinco funciones nuevas: no cambia ni una fila de lo que existe, y en
-- particular nada de Diez (decisión 1 de Julio: external_send no se toca). Se mide que lo de Diez y el
-- libro siguen igual. Las cifras son de la TABLA ENTERA, a propósito (regla 9, excepción: la huella de
-- «esto no se ha movido» es más fuerte así), y se etiquetan como tal.
-- Corte fijo (el #241): solo lo creado antes del 17/11/2026 a las 00:00 de Madrid, para que lo que entre
-- a mitad del ensayo no lo pare sin culpa de la tanda.
select clave, valor from (
  -- corte: envíos a Diez creados antes del 17/11 a las 00:00
  select 1 o, 'tabla entera · external_send ' || status clave, count(*)::text valor
    from public.external_send where created_at < timestamptz '2026-11-17 00:00:00+01' group by status
  union all
  -- el interruptor de Diez: tabla pequeña, entera (cambiado_en antes del corte)
  select 2, 'tabla entera · conta_diez_envio_empresa encendidas', count(*)::text
    from public.conta_diez_envio_empresa where enviar and cambiado_en < timestamptz '2026-11-17 00:00:00+01'
  union all
  -- corte: asientos creados antes del 17/11 a las 00:00
  select 3, 'tabla entera · journal_entry ' || status, count(*)::text
    from public.journal_entry where created_at < timestamptz '2026-11-17 00:00:00+01' group by status
  union all
  -- las de Diez que leen lo que ha salido, igual que antes
  select 4, 'funciones · _conta_traspaso_va y conta_traspaso_lista', count(*)::text
    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_conta_traspaso_va', 'conta_traspaso_lista')
) t order by o, clave;
