-- scripts/conta/produccion/cuentas/e05-nucleo-bancos.sql
--
-- E05 · Bancos del núcleo (2248, «Escribir uno a mano») · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE.
-- Por CUENTA (account_id, regla 9), con la MISMA vara a los dos lados (regla 31):
-- los asientos de cada cuenta y, de ellos, los de la serie 3 escritos a mano en
-- Bancos (los que dejaría la función nueva). La tanda solo añade una función: lo
-- esperado es que no cambie nada.
-- Corte fijo (el #241): solo los asientos creados antes del 19/11/2026 a las 00:00 de Madrid.
with base as (
  select je.account_id, je.series, je.source_type, je.reasons
    from public.journal_entry je
   -- corte (el #241): solo los asientos creados antes del 19/11/2026 a las 00:00 de Madrid.
   where je.created_at < timestamptz '2026-11-19 00:00:00+01'
)
select clave, valor from (
  select 1 o, 'cuenta ' || account_id || ' · asientos' clave, count(*)::text valor from base group by account_id
  union all
  select 2, 'cuenta ' || account_id || ' · escritos a mano en Bancos', count(*)::text
    from base where series = 3 and source_type = 'manual' and reasons @> '[{"decision": "Escrito a mano"}]'::jsonb group by account_id
) t order by o, clave;
