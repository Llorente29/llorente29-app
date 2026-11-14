-- B01r_22 · Los «No lo sé» de octubre y noviembre en Foodint, agrupados por lo que le faltaba al
-- motor: lo siguiente que hay que atacar (Julio, 13/11). Solo lectura. La misma población que
-- b01r22_medida_niveles.sql (lo casado y validado hasta las 22:55Z del 12/11: 257 movimientos),
-- sin lo que casó solo Folvy (71: eso no es «No lo sé»).
with pob as (
  select m.id, m.amount, coalesce(m.clean_concept, m.bank_concept) txt, bm.created_at casado_at, bm.kind, bm.by_who, bm.journal_entry_id
  from bank_match bm join bank_movement m on m.id = bm.movement_id join journal_entry je on je.id = bm.journal_entry_id
  where bm.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and bm.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
    and bm.status = 'vivo' and je.validated_at is not null and je.validated_at <= timestamptz '2026-11-12 22:55:00+00'
    and m.op_date >= '2026-10-01' and m.op_date < '2026-12-01'
), prop as (
  select distinct on (p.id) p.*, l.action antes, l.detail d
  from pob p left join bank_activity_log l on l.movement_id = p.id and l.by_who = 'folvy' and l.action in ('propuesto', 'por_aclarar') and l.created_at <= p.casado_at
  order by p.id, l.created_at desc
)
select coalesce(d->>'falta', '(una persona lo casó antes de la primera pasada)') falta, kind casado_como, count(*) n, round(sum(abs(amount)), 2) euros,
       min(left(txt, 55)) ejemplo
from prop p where antes is distinct from 'propuesto' and not (antes is null and by_who = 'folvy')
group by 1, 2 order by 3 desc;
