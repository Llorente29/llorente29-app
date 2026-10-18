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
--   2. huecos        · numeración sin huecos por empresa, ejercicio y serie,
--                      desde el siguiente al último TRAÍDO (C06b, 15/10): la
--                      numeración traída es la del programa de antes, con sus
--                      saltos (C0008 salta del 431 al 998 el 01/07, también en
--                      Diez); lo que se mira es lo que numera Folvy.
--   3. cadena        · cada huella encadena con la anterior y es la de su contenido.
--   4. iva           · los apuntes de IVA llevan base, tipo y libro, y la cuota es la base por el tipo,
--                      con la MISMA tolerancia que journal_entry_validar: medio céntimo por factura
--                      de un resumen y, en cualquier apunte, un céntimo de redondeo (C06b, 16/10;
--                      tests/conta/agenteLibroIva.test.ts compara las dos).
--   5. ventas_dia    · el resumen del día suma lo mismo que sus tickets, y su asiento lo mismo que el resumen.
--   6. cedidas_70    · ninguna venta de una marca cedida en el grupo 70.
--   7. socio_gasto   · nada comprado a nombre del socio de marca como gasto (grupo 6).
--   8. resultado     · ningún 6/7 sin local ni «común»; lo común con su regla de reparto al 100 %.
--   9. mes_cerrado   · ningún asiento validado en un mes cerrado después de cerrarlo.
--  10. propuestas    · lo propuesto hace más de 7 días (aviso, no error).
--  11. cierre_dia    · ningún pedido de marca propia sigue abierto en un día ya
--                      cerrado (encargo del 09/10): si lo hay, el cierre del día
--                      no ha pasado o ha fallado; con el día de serie a las 2:00,
--                      ese día lleva más de 26 h sin cerrar. Por empresa: cuántos,
--                      el día más antiguo y las horas desde que acabó ese día.
--  12. dia_sin_asiento · ningún día cerrado se queda sin su resumen y su
--                      asiento propuesto más de 24 h después de su hora de
--                      cierre (encargo del 11/10: del 09/10 al 11/10 no se
--                      propuso nada y nadie lo vio). Solo días de un ejercicio
--                      abierto, después del corte, de un mes sin cerrar, sin
--                      descartar y de una empresa con su plan (con su 700).
--                      Por día y local: horas desde el cierre y si al menos
--                      hay resumen. El porqué de cada uno está en
--                      sales_day_proposal_log y en el Libro diario.
--                      Y si la empresa está en IGIC (Canarias): eso es «ya
--                      sabido» (#176), no rojo, mientras el cierre no lo sepa
--                      hacer.

-- El registro del cierre del día se lee solo si este rol puede (conta_lectura
-- lo recibe en 20261020T0140): así el agente sigue corriendo antes de esa tanda.
select to_regclass('public.sales_day_proposal_log') is not null
   and has_table_privilege('public.sales_day_proposal_log', 'select') as lee_registro \gset

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
            from (select account_id, company_id, fiscal_year_id, series,
                         max(number) filter (where source_type <> 'migrated') m,
                         coalesce(max(number) filter (where source_type = 'migrated'), 0) traido
                    from libro group by 1, 2, 3, 4
                  having count(*) filter (where source_type <> 'migrated') > 0) e
            cross join lateral generate_series(e.traido + 1, e.m) g
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
       -- I01b (0180): como en conta_motivos_para_validar, la liquidación de un 303
       -- (o su contraasiento) salda la 477 y la 472 sin tipo ni libro.
       when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null
            and not exists (select 1 from public.journal_entry o
                              join public.tax_return tr on tr.id = o.source_id and tr.company_id = o.company_id and tr.account_id = o.account_id
                             where o.id = case when e.source_type = 'reversal' then e.reverses_entry_id else e.id end
                               and o.company_id = e.company_id and o.source_type = 'vat_settlement' and tr.form_code = '303')
         then 'apunte de IVA sin base, tipo ni libro'
       when l.tax_rate_id is not null and (l.tax_base is null or l.vat_book is null) then 'IVA sin base o sin libro registro'
       when l.tax_rate_id is not null and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
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

  'dia_sin_asiento', (select coalesce(json_agg(json_build_object('account_id', x.account_id, 'company_id', x.company_id, 'local', x.location_id,
      'dia', x.dia, 'pedidos', x.pedidos, 'horas', x.horas, 'resumen', x.resumen,
      -- Ya sabido (#176): una empresa en IGIC (Canarias) no tiene asiento de
      -- ventas hasta que se construya el IGIC en el cierre (CONTEXTO_CLAUDE.md,
      -- «C06b · 16/10 — APARCADO: el IGIC en el cierre del día»).
      'igic', x.igic
\if :lee_registro
      -- Lo que apuntó el cierre del día la última vez (sales_day_proposal_log):
      -- el porqué viaja con el aviso, no hay que ir a buscarlo.
      , 'resultado', (select g.result from public.sales_day_proposal_log g where g.company_id = x.company_id and g.location_id = x.location_id and g.sales_day = x.dia),
      'porque', (select g.reason from public.sales_day_proposal_log g where g.company_id = x.company_id and g.location_id = x.location_id and g.sales_day = x.dia)
\endif
      ) order by x.dia, x.location_id), '[]')
    from (select c.account_id, c.id company_id, s.location_id, (s.sold_at at time zone 'Europe/Madrid')::date dia, count(*) pedidos,
                 round(extract(epoch from now() - ((((s.sold_at at time zone 'Europe/Madrid')::date + 1)::timestamp + coalesce(t.sales_day_close_time, time '02:00')) at time zone 'Europe/Madrid')) / 3600) horas,
                 exists (select 1 from public.sales_day_summary d where d.company_id = c.id and d.location_id = s.location_id
                            and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date) resumen,
                 coalesce(t.tax_territory = 'canarias' or t.sales_tax_rate_code like 'igic%', false) igic
            from public.company c
            left join public.company_tax_profile t on t.company_id = c.id
            join public.sale s on s.account_id = c.account_id
            left join public.brand b on b.id = s.brand_id
            join public.fiscal_year f on f.company_id = c.id and f.status = 'open'
                 and (s.sold_at at time zone 'Europe/Madrid')::date between f.starts_on and f.ends_on
                 and (f.imported_until is null or (s.sold_at at time zone 'Europe/Madrid')::date > f.imported_until)
           where s.is_active and s.status = 'closed' and coalesce(b.ownership_type, 'own') = 'own' and s.location_id is not null
             and s.sold_at > now() - interval '120 days'
             and exists (select 1 from public.company_account a where a.company_id = c.id and a.kind = 'template' and a.template_code = '700')
             -- Cerrado hace más de 24 h: el día D se cierra a la hora de cierre del día D + 1.
             and now() > ((((s.sold_at at time zone 'Europe/Madrid')::date + 1)::timestamp + coalesce(t.sales_day_close_time, time '06:00')) at time zone 'Europe/Madrid') + interval '24 hours'
             and not exists (select 1 from public.fiscal_period_lock k where k.company_id = c.id and k.reopened_at is null
                                and k.month = date_trunc('month', (s.sold_at at time zone 'Europe/Madrid')::date)::date)
             and not exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
                              where d.company_id = c.id and d.location_id = s.location_id and d.sales_day = (s.sold_at at time zone 'Europe/Madrid')::date
                                and e.status in ('propuesto', 'borrador', 'validado'))
             and not exists (select 1 from public.journal_dismissal x where x.company_id = c.id and x.source_type = 'sales_day'
                              and x.source_key = s.location_id || ':' || (s.sold_at at time zone 'Europe/Madrid')::date)
           group by 1, 2, 3, 4, 6, 7, 8) x),

  'propuestas', (select coalesce(json_agg(json_build_object('account_id', e.account_id, 'company_id', e.company_id, 'fecha', e.entry_date,
      'serie', e.series, 'origen', e.source_type, 'dias', current_date - e.created_at::date)), '[]')
    from public.journal_entry e
   where e.status in ('propuesto', 'borrador') and e.created_at < now() - interval '7 days')
);
