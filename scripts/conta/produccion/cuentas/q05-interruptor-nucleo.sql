-- scripts/conta/produccion/cuentas/q05-interruptor-nucleo.sql
--
-- Q05 · «Pantallas nuevas» en la ficha de la cuenta (2029) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La tanda solo reemplaza dos funciones con la misma firma: no cambia ni una fila. Se mide que los
-- interruptores de Sumied siguen igual (de la TABLA ENTERA, a propósito: la huella de «esto no se ha
-- movido» es más fuerte así; regla 9, excepción) y que las dos funciones siguen estando, una de cada.
-- Corte fijo (el #241): solo lo cambiado antes del 18/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  -- corte: interruptores de Sumied cambiados antes del 18/11 a las 00:00
  select 1 o, 'tabla entera · feature_flags ' || feature_key || ' ' || case when enabled then 'encendidos' else 'apagados' end clave, count(*)::text valor
    from public.feature_flags
   where feature_key in ('conta', 'conta_impuestos', 'conta_laboral', 'conta_nucleo') and updated_at < timestamptz '2026-11-18 00:00:00+01'
   group by feature_key, enabled
  union all
  -- las dos funciones de la ficha, con su misma firma
  select 2, 'funciones · conta_interruptores_de_cuenta y conta_interruptor_cambiar', count(*)::text
    from pg_proc where pronamespace = 'public'::regnamespace and proname in ('conta_interruptores_de_cuenta', 'conta_interruptor_cambiar')
) t order by o, clave;
