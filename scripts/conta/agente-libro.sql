-- scripts/conta/agente-libro.sql
--
-- Agente «Libro diario» (C04 §8). SOLO LEE: corre con
-- default_transaction_read_only=on, en staging-conta y en producción (rol
-- conta_lectura). Devuelve un JSON con lo contado y, por comprobación, las
-- filas que fallan; lo revisa scripts/conta/lib/libro.mjs.
--
-- Regla 9: cada fila lleva su account_id y su company_id; el informe dice de
-- qué cuenta es cada cosa. Sin conceptos ni nombres: el informe va al resumen
-- de Actions de un repositorio público; basta serie, número e ids. Si public.journal_entry no existe (antes del C04),
-- el workflow no lanza este fichero.
--
-- Lo que se mira (encargo C04, agente):
--   1. cuadre        · todo asiento validado o anulado cuadra al céntimo.
--   2. huecos        · numeración sin huecos por empresa, ejercicio y serie.
--   3. cadena        · cada huella encadena con la anterior y es la de su contenido.
--   4. iva           · los apuntes de IVA llevan base, tipo y libro, y la cuota es la base por el tipo.
--   5. ventas_dia    · el resumen del día suma lo mismo que sus tickets, y su asiento lo mismo que el resumen.
--   6. cedidas_70    · ninguna venta de una marca cedida en el grupo 70.
--   7. socio_gasto   · nada comprado a nombre del socio de marca como gasto (grupo 6).
--   8. resultado     · ningún 6/7 sin local ni «común»; lo común con su regla de reparto al 100 %.
--   9. mes_cerrado   · ningún asiento validado en un mes cerrado después de cerrarlo.
--  10. propuestas    · lo propuesto hace más de 7 días (aviso, no error).
--  11. cierre_dia    · ningún pedido de marca propia sigue abierto en un día ya
--                      cerrado (encargo del 09/10): si lo hay, el cierre del día
--                      no ha pasado o ha fallado; con el día de serie a las 6:00,
--                      ese día lleva más de 30 h sin cerrar. Por empresa: cuántos,
--                      el día más antiguo y las horas desde que acabó ese día.

with libro as (
  select e.* from public.journal_entry e where e.status in ('validado', 'anulado')
),
sumas as (
  select l.entry_id, sum(l.debit) debe, sum(l.credit) haber, count(*) n from public.journal_line l group by l.entry_id
),
cadena as (
  select e.account_id, e.company_id, e.id, e.series, e.number, e.chain_seq, e.prev_hash, e.hash,
         lag(e.hash) over (partition by e.company_id order by e.chain_seq) as anterior,
         public.journal_huella(e.prev_hash, public.journal_entry_canonico(e.id)) as esperada
    from libro e where e.chain_seq is not null
)
select json_build_object(
  'contado', (select json_build_object(
      'asientos', count(*),
      'validados', count(*) filter (where status = 'validado'),
      'anulados', count(*) filter (where status = 'anulado'),
      'propuestos', (select count(*) from public.journal_entry where status in ('propuesto', 'borrador')),
      'empresas', count(distinct company_id),
      'apuntes', (select count(*) from public.journal_line l join libro e on e.id = l.entry_id))
    from libro),

  'cuadre', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'serie', e.series,
      'numero', e.number, 'debe', s.debe, 'haber', s.haber, 'apuntes', s.n)), '[]')
    from libro e left join sumas s on s.entry_id = e.id
   where s.entry_id is null or s.debe <> s.haber or s.n < 2),

  'huecos', (select coalesce(json_agg(json_build_object('account_id', x.account_id, 'company_id', x.company_id, 'ejercicio', x.fiscal_year_id,
      'serie', x.series, 'falta', x.falta)), '[]')
    from (select e.account_id, e.company_id, e.fiscal_year_id, e.series, g as falta
            from (select account_id, company_id, fiscal_year_id, series, max(number) m
                    from libro where source_type <> 'migrated' group by 1, 2, 3, 4) e
            cross join lateral generate_series(1, e.m) g
           where not exists (select 1 from libro x where x.company_id = e.company_id and x.fiscal_year_id = e.fiscal_year_id
                               and x.series = e.series and x.number = g)) x),

  'cadena', (select coalesce(json_agg(json_build_object('account_id', c.account_id, 'company_id', c.company_id, 'serie', c.series,
      'numero', c.number, 'orden', c.chain_seq,
      'motivo', case when c.prev_hash is distinct from c.anterior then 'no encadena con el anterior' else 'su contenido no es el que se validó' end)), '[]')
    from cadena c where c.prev_hash is distinct from c.anterior or c.hash is distinct from c.esperada),

  'iva', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'serie', e.series,
      'numero', e.number, 'cuenta', a.code, 'motivo', m.motivo)), '[]')
    from libro e
    join public.journal_line l on l.entry_id = e.id
    join public.company_account a on a.id = l.company_account_id
    left join public.tax_rate t on t.id = l.tax_rate_id
    cross join lateral (select case
       when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null then 'apunte de IVA sin base, tipo ni libro'
       when l.tax_rate_id is not null and (l.tax_base is null or l.vat_book is null) then 'IVA sin base o sin libro registro'
       when l.tax_rate_id is not null and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > floor(l.tax_documents / 2.0) / 100
         then format('cuota %s y base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
       end as motivo) m
   where e.source_type <> 'migrated' and m.motivo is not null),

  'ventas_dia', (select coalesce(json_agg(json_build_object('account_id', d.account_id, 'company_id', d.company_id, 'local', d.location_id,
      'dia', d.sales_day, 'resumen', d.total, 'tickets', d.tickets_count, 'pedidos', d.n_ids, 'suma_pedidos', d.suma, 'asiento_cobro', d.cobro,
      'motivo', d.motivo)), '[]')
    from (select s.account_id, s.company_id, s.location_id, s.sales_day, s.total, s.tickets_count, cardinality(s.sale_ids) n_ids,
                 (select sum(x.total) from public.sale x where x.id = any(s.sale_ids) and x.account_id = s.account_id) suma,
                 (select sum(l.debit) - sum(l.credit) from public.journal_line l join public.company_account a on a.id = l.company_account_id
                   where l.entry_id = s.entry_id and a.template_code like '43%') cobro,
                 case
                   when cardinality(s.sale_ids) <> s.tickets_count then 'los tickets no son los pedidos guardados'
                   when cardinality(s.sale_ids) > 0 and (select sum(x.total) from public.sale x where x.id = any(s.sale_ids) and x.account_id = s.account_id) is distinct from s.total
                     then 'el resumen no suma lo de sus tickets'
                 end motivo
            from public.sales_day_summary s
            join libro e on e.id = s.entry_id and e.status = 'validado') d
   where d.motivo is not null),

  'cedidas_70', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'serie', e.series,
      'numero', e.number, 'cuenta', a.code, 'marca', b.id, 'importe', l.credit - l.debit)), '[]')
    from libro e
    join public.journal_line l on l.entry_id = e.id
    join public.company_account a on a.id = l.company_account_id
    join public.brand b on b.id = l.brand_id and b.account_id = l.account_id
   where a.template_code like '70%' and b.ownership_type = 'licensed' and e.source_type not in ('migrated', 'reversal')),

  'socio_gasto', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'serie', e.series,
      'numero', e.number, 'cuenta', a.code, 'importe', l.debit - l.credit)), '[]')
    from libro e
    join public.journal_line l on l.entry_id = e.id
    join public.company_account a on a.id = l.company_account_id
   where a.template_code like '6%' and e.source_type not in ('migrated', 'reversal')
     and (exists (select 1 from public.party_role r where r.role = 'brand_partner' and r.account_id = e.account_id
                    and r.party_id = coalesce(l.party_id, e.party_id))
       or (e.source_type = 'supplier_invoice' and exists (
             select 1 from public.supplier_invoice i join public.party_role ps on ps.supplier_id = i.supplier_id and ps.account_id = i.account_id
               join public.party_role pb on pb.party_id = ps.party_id and pb.role = 'brand_partner'
              where i.id = e.source_id and i.account_id = e.account_id)))),

  'resultado', (select coalesce(json_agg(r), '[]') from (
      select json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'serie', e.series, 'numero', e.number,
             'cuenta', a.code, 'motivo', '6/7 sin local ni común') r
        from libro e join public.journal_line l on l.entry_id = e.id join public.company_account a on a.id = l.company_account_id
       where (a.template_code like '6%' or a.template_code like '7%') and l.location_id is null and not l.is_common and e.source_type <> 'migrated'
      union all
      select json_build_object('account_id', c.account_id, 'company_id', c.company_id, 'motivo',
             format('hay gastos o ingresos comunes y su regla de reparto suma %s %%', coalesce(c.pct, 0)))
        from (select l.account_id, l.company_id,
                     (select sum(r.pct) from public.allocation_rule r where r.company_id = l.company_id
                        and current_date between r.valid_from and coalesce(r.valid_to, current_date)) pct
                from public.journal_line l join libro e on e.id = l.entry_id
                join public.company_account a on a.id = l.company_account_id
               where l.is_common and (a.template_code like '6%' or a.template_code like '7%')
               group by 1, 2) c
       where c.pct is distinct from 100) z),

  'mes_cerrado', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'serie', e.series,
      'numero', e.number, 'fecha', e.entry_date, 'cerrado', k.locked_at, 'validado', e.validated_at)), '[]')
    from libro e
    join public.fiscal_period_lock k on k.company_id = e.company_id and k.month = date_trunc('month', e.entry_date)::date
   where e.source_type not in ('migrated') and e.validated_at > k.locked_at and (k.reopened_at is null or e.validated_at < k.reopened_at)),

  'cierre_dia', (select coalesce(json_agg(json_build_object('account_id', x.account_id, 'company_id', x.company_id,
      'pedidos', x.pedidos, 'importe', x.importe, 'dia', x.dia,
      'horas', round(extract(epoch from now() - ((x.dia + 1)::timestamp at time zone 'Europe/Madrid')) / 3600))), '[]')
    from (select c.account_id, c.id company_id, count(*) pedidos, sum(s.total) importe, min((s.sold_at at time zone 'Europe/Madrid')::date) dia
            from public.company c
            join public.sale s on s.account_id = c.account_id
            left join public.brand b on b.id = s.brand_id
           where s.status = 'open' and s.is_active and coalesce(b.ownership_type, 'own') = 'own'
             and s.sold_at < public.conta_cerrado_hasta(c.id)
           group by 1, 2) x),

  'propuestas', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'fecha', e.entry_date,
      'serie', e.series, 'origen', e.source_type, 'dias', current_date - e.created_at::date)), '[]')
    from public.journal_entry e
   where e.status in ('propuesto', 'borrador') and e.created_at < now() - interval '7 days')
);
