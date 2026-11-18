-- scripts/conta/produccion/cuentas/e03-de-quien-es.sql
--
-- E03 · ¿De quién es? (1833, 1835 y 1836) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por CUENTA (account_id, regla 9) y por caso, con la MISMA vara a los dos lados
-- (regla 31): el caso se calcula aquí, sin nada que cree la tanda (la respuesta se
-- lee con to_jsonb, que no falla si la columna aún no existe).
--
--   caso    otra_sociedad (el NIF leído es el de otra sociedad de la cuenta),
--           fuera (un NIF que no es de ninguna), sin_leer (no se leyó),
--           empresa, sin_iva (va a otro y no lleva IVA).
--   estado  marcada_sola (no deducible «no va a nombre» sin que lo dijera nadie),
--           marcada_persona (lo dijo alguien en la ficha), contestada (respuesta E03),
--           sin_marca.
--   asiento validado | sin validar.
-- Corte fijo (el #241): solo las recibidas creadas antes del 18/11/2026 a las 00:00 de Madrid.
-- Lo esperado: las «marcada_sola · sin validar» pasan a «sin_marca · sin validar»;
-- las «· validado», igual; el total de cada cuenta, igual.
with base as (
  select si.id, si.account_id, si.vat_non_deductible, si.vat_non_deductible_reason,
         to_jsonb(si)->>'recipient_answer' as respuesta,
         public._conta_nif_clave(c.tax_id) as emp,
         public._conta_nif_clave(si.reading->'factura'->'destinatario'->>'nif') as dest,
         exists (select 1 from public.supplier_invoice_tax t where t.supplier_invoice_id = si.id and coalesce(t.vat_pct, 0) > 0 and coalesce(t.vat_amount, 0) <> 0) as con_iva,
         exists (select 1 from public.journal_entry e where e.account_id = si.account_id and e.source_type = 'supplier_invoice'
                   and e.source_id = si.id and e.status = 'validado') as validado,
         exists (select 1 from public.supplier_invoice_change h where h.supplier_invoice_id = si.id
                   and h.cambios @> '[{"campo": "iva_no_deducible"}]'::jsonb) as persona
    from public.supplier_invoice si
    join public.company c on c.id = si.company_id and c.account_id = si.account_id
   -- corte (el #241): solo las recibidas creadas antes del 18/11/2026 a las 00:00 de Madrid.
   where si.created_at < timestamptz '2026-11-18 00:00:00+01'
     and coalesce(si.reading, '{}'::jsonb) ? 'factura' and coalesce(si.source, '') not in ('lote', 'liquidacion', 'traida')
     and si.status not in ('anulada', 'descartada', 'repetida')
     and public._conta_nif_clave(c.tax_id) is not null
), casos as (
  select b.*,
         case when b.dest = b.emp then 'empresa'
              when b.dest is not null and exists (select 1 from public.company o where o.account_id = b.account_id
                                                   and public._conta_nif_clave(o.tax_id) = b.dest) then 'otra_sociedad'
              when not b.con_iva then 'sin_iva'
              when b.dest is null then 'sin_leer'
              else 'fuera' end as caso,
         case when b.respuesta is not null then 'contestada'
              when b.vat_non_deductible and b.vat_non_deductible_reason = 'no_a_nombre' and not b.persona then 'marcada_sola'
              when b.vat_non_deductible and b.persona then 'marcada_persona'
              else 'sin_marca' end as estado
    from base b
)
select clave, valor from (
  select 1 o, 'cuenta ' || account_id || ' · ' || caso || ' · ' || estado || ' · ' || case when validado then 'validado' else 'sin validar' end clave,
         count(*)::text valor
    from casos where caso <> 'empresa' group by account_id, caso, estado, validado
  union all
  select 2, 'cuenta ' || account_id || ' · total leídas de su papel', count(*)::text from casos group by account_id
) t order by o, clave;
