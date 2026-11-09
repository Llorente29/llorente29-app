-- scripts/conta/produccion/cuentas/gb-pestana-bitrix.sql
--
-- GB · La pestaña «Sumied» en la ficha de Bitrix24 · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. La misma vara a los dos lados (regla 31).
-- Medido antes el 09/11 a las 17:54 UTC (solo lectura). Lo que tiene que pasar:
--   1. La función conta_bitrix_pestana_leer: false → true.
--   2. Lo que lee NO cambia (la migración no la llama): fichas / clientes / conexiones del CRM igual antes y después.
-- Y la vuelta atrás deja todo como antes (el ensayo lo mide).
select clave, valor from (
  select 1 o, 'La función conta_bitrix_pestana_leer' clave,
    (to_regprocedure('public.conta_bitrix_pestana_leer(text,text,text,text)') is not null)::text valor union all
  select 2, 'Fichas / clientes con ficha / conexiones del CRM',
    -- huella de tabla entera, a propósito (regla 9): que nada se ha movido en ninguna cuenta
    concat_ws(' / ',
      (select count(*) from public.conta_gestoria_ficha),
      (select count(*) from public.conta_gestoria_cliente where id_externo is not null),
      (select count(*) from public.conta_crm))
) q order by o;
