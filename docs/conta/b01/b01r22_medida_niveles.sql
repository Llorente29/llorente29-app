-- B01r_22 · punto 4 · La regla de niveles de las propuestas del banco, medida contra lo casado
-- y VALIDADO de octubre y noviembre en Foodint (regla 31: contra la población real).
-- Solo lectura. Para cada movimiento: la última propuesta del motor ANTES de casarlo
-- (bank_activity_log, por folvy), contra qué se casó al final (bank_match + su asiento), el nivel
-- que le habría dado la regla y si acertó.
--   · Coincide al céntimo (regla de Julio, 13/11): UNA factura (de tipo factura: nunca un albarán
--     ni un abono), aprobada, por el importe del movimiento; y si el concepto del banco nombra un
--     número de factura, ésa.
--   · Confirmado: lo que va contra una cuenta (no una factura), con el mismo tercero validado
--     contra la misma cuenta las 3 últimas veces SEGUIDAS y sin corrección por medio (historia
--     de Foodint de cualquier fecha; corrección = lo último que propuso el motor antes de casarlo
--     no iba contra esas cuentas).
--   · Casado solo por Folvy: lo casó el motor sin proponerlo (traspasos con pareja, la
--     referencia de la factura…). No es «No lo sé»: hasta el 13/11 esta consulta los contaba ahí.
--   · Nunca sola: más de 1.000 €, impuestos o préstamos, o una cuenta de nóminas (465, 640, 642),
--     socios (551, 553), Hacienda y SS (475, 476) o préstamos (170, 520). El mes cerrado no se
--     mide aquí: octubre se cerró después de casarlo.
--   · No lo sé: el motor no propuso nada (por aclarar).
with t as (
with todos as (
  select bm.movement_id, upper(coalesce(m.counterparty, '')) cp, je.validated_at,
    (select array_agg(distinct ca.code order by ca.code) filter (where ca.code not like '57%') from journal_line jl join company_account ca on ca.id = jl.company_account_id where jl.entry_id = bm.journal_entry_id) cuentas,
    coalesce((select case when p.action = 'por_aclarar' or jsonb_typeof(p.detail->'destino') is distinct from 'object' then false
                          when p.detail->'destino'->>'tipo' not in ('cuenta', 'anticipo') then true
                          else (select array_agg(distinct e->>'cuenta' order by e->>'cuenta') from jsonb_array_elements(p.detail->'destino'->'lineas') e)
                               is distinct from (select array_agg(distinct ca.code order by ca.code) filter (where ca.code not like '57%') from journal_line jl join company_account ca on ca.id = jl.company_account_id where jl.entry_id = bm.journal_entry_id) end
                from bank_activity_log p where p.movement_id = bm.movement_id and p.by_who = 'folvy' and p.action in ('propuesto', 'por_aclarar') and p.created_at <= bm.created_at
               order by p.created_at desc limit 1), false) corregido
  from bank_match bm join bank_movement m on m.id = bm.movement_id join journal_entry je on je.id = bm.journal_entry_id
  where bm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and bm.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and bm.status = 'vivo' and je.validated_at is not null
), pob as (
  select m.id, m.op_date, m.amount, upper(coalesce(m.counterparty, '')) cp, bm.id match_id, bm.created_at casado_at, bm.kind, bm.by_who, bm.journal_entry_id, je.validated_at
  from bank_match bm join bank_movement m on m.id = bm.movement_id join journal_entry je on je.id = bm.journal_entry_id
  where bm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and bm.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
    and bm.status = 'vivo' and je.validated_at is not null and m.op_date >= '2026-10-01' and m.op_date < '2026-12-01'
    -- el corte de la medida del 12/11 (257 movimientos): lo validado hasta las 22:55Z
    and je.validated_at <= timestamptz '2026-11-12 22:55:00+00'
), prop as (
  select distinct on (p.id) p.*, l.action antes, l.detail d
  from pob p left join bank_activity_log l on l.movement_id = p.id and l.by_who = 'folvy' and l.action in ('propuesto', 'por_aclarar') and l.created_at <= p.casado_at
  order by p.id, l.created_at desc
), items as (
  select p.id, array_agg(distinct i.supplier_invoice_id::text) filter (where i.supplier_invoice_id is not null) facs,
         array_agg(distinct i.channel_settlement_id::text) filter (where i.channel_settlement_id is not null) liqs
  from prop p left join bank_match_item i on i.match_id = p.match_id group by p.id
), x as (
  select p.*, h.cuentas, it.facs, it.liqs, (select coalesce(nullif(mm.bank_concept, ''), mm.clean_concept) from bank_movement mm where mm.id = p.id) txt_banco,
    p.d->'destino'->>'tipo' tipo,
    (select array_agg(distinct e->>'cuenta' order by e->>'cuenta') from jsonb_array_elements(coalesce(p.d->'destino'->'lineas', '[]')) e) cuentas_prop,
    (select array_agg(distinct e->>'id') from jsonb_array_elements(coalesce(p.d->'destino'->'facturas', '[]')) e) facs_prop,
    (select round(sum((e->>'importe')::numeric), 2) from jsonb_array_elements(coalesce(p.d->'destino'->'facturas', '[]')) e) suma_facs
  from prop p join todos h on h.movement_id = p.id join items it using (id)
), juzgado as (
  select x.*,
    case when antes is distinct from 'propuesto' then null
         when tipo = 'factura_recibida' then coalesce(facs_prop <@ facs and facs <@ facs_prop, false)
         when tipo = 'liquidacion' then coalesce((d->'destino'->>'liquidacion_id') = any(liqs), false)
         when tipo in ('cuenta', 'anticipo') then coalesce(cuentas_prop <@ cuentas and cuentas <@ cuentas_prop, false)
         when d->>'origen' = 'traspaso' then kind = 'traspaso'
         else null end acierta,
    (abs(amount) > 1000 or d->>'origen' in ('impuesto', 'contrato') or kind = 'contrato'
      or exists (select 1 from unnest(coalesce(cuentas_prop, cuentas)) c where c ~ '^(465|640|642|551|553|475|476|170|520)')) nunca_sola,
    (tipo = 'factura_recibida' and cardinality(facs_prop) = 1 and suma_facs = abs(amount) and coalesce(d->>'que', '') !~* 'en parte|diferencia|sin aprobar'
      and (select si.doc_kind = 'invoice' from supplier_invoice si where si.id::text = facs_prop[1])
      and not exists (  -- el banco nombra un número de factura que no es el de la propuesta
        select 1 from regexp_matches(coalesce(x.txt_banco, ''), '(?:FACTURAS?|FACT|FRAS?)\.?\s*(?:N[º°O]?\.?\s*)?:?\s*([A-Z0-9][A-Z0-9/.-]*\d[A-Z0-9/.-]*)', 'gi') r
         where regexp_replace(upper(r[1]), '[^A-Z0-9]', '', 'g') <> coalesce((select regexp_replace(upper(si.invoice_number), '[^A-Z0-9]', '', 'g') from supplier_invoice si where si.id::text = facs_prop[1]), ''))) al_centimo
  from x
), con_historia as (
  -- la racha: las últimas validaciones SEGUIDAS del mismo tercero contra las mismas cuentas, sin corrección
  select j.*, (
    select count(*) from (
      select k.cuentas, k.corregido, sum(case when k.cuentas is distinct from coalesce(j.cuentas_prop, j.cuentas) or k.corregido then 1 else 0 end)
               over (order by k.validated_at desc rows unbounded preceding) cortes
        from todos k where k.cp <> '' and k.cp = j.cp and k.validated_at < j.casado_at) h
     where h.cortes = 0) veces_antes
  from juzgado j
)
select *,
  case when antes is null and by_who = 'folvy' then '0 · Casado solo por Folvy'
       when antes is distinct from 'propuesto' then '5 · No lo sé'
       when nunca_sola then '4 · Nunca sola'
       when al_centimo then '1 · Seguro · coincide al céntimo'
       when veces_antes >= 3 and tipo in ('cuenta', 'anticipo') then '2 · Seguro · confirmado 3 veces'
       else '3 · Míralo · ' || case when tipo in ('cuenta', 'anticipo') then least(veces_antes, 2) || ' de 3' else 'factura, liquidación o traspaso' end end nivel
from con_historia
)
select nivel, count(*) n, count(*) filter (where acierta) acierta, count(*) filter (where acierta = false) falla
from t group by nivel order by nivel;
