-- scripts/conta/produccion/cuentas/e04-otra-sociedad-sola.sql
--
-- E04 · La factura de otra sociedad del grupo se pasa sola (1950, 1951 y 1952) ·
-- LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por CUENTA (account_id, regla 9), con la MISMA vara a los dos lados (regla 31):
-- a nombre de quién va cada recibida (_conta_de_quien, del E03, ya en producción)
-- y si tiene un apunte de Sumied «pasada sola» (supplier_invoice_change), sin nada
-- que cree la tanda.
-- Corte fijo (el #241): solo las recibidas creadas antes del 18/11/2026 a las 20:00 de Madrid.
--
--   otra sociedad · pregunta     las que esperan: se pasan al aplicar (si no tienen trabas)
--   otra sociedad · sin pregunta las de asiento validado o con respuesta: no se mueven
--   pasada sola                  las que Sumied ha pasado (al aplicar, la 1952)
-- Lo esperado: «otra sociedad · pregunta» pasa a 0 (o a las que tengan una traba), y
-- «pasada sola» sube lo mismo; el total de cada cuenta, igual.
with base as (
  select si.id, si.account_id, public._conta_de_quien(si.id) as q,
         exists (select 1 from public.supplier_invoice_change h where h.supplier_invoice_id = si.id and h.account_id = si.account_id
                   and h.by_name = 'Sumied' and h.cambios @> '[{"campo": "sociedad", "sola": true}]'::jsonb) as sola
    from public.supplier_invoice si
   -- corte (el #241): solo las recibidas creadas antes del 18/11/2026 a las 20:00 de Madrid.
   where si.created_at < timestamptz '2026-11-18 20:00:00+01'
     and coalesce(si.reading, '{}'::jsonb) ? 'factura'
)
select clave, valor from (
  select 1 o, 'cuenta ' || account_id || ' · otra sociedad · ' || case when (q->>'pregunta')::boolean then 'pregunta' else 'sin pregunta' end clave, count(*)::text valor
    from base where q->>'caso' = 'otra_sociedad' group by account_id, (q->>'pregunta')::boolean
  union all
  select 2, 'cuenta ' || account_id || ' · pasada sola', count(*)::text from base where sola group by account_id
  union all
  select 3, 'cuenta ' || account_id || ' · total leídas de su papel', count(*)::text from base group by account_id
) t order by o, clave;
