-- supabase/vuelta-atras/20261025T1912_v02d_avisos.down.sql
--
-- Vuelta atrás de 20261025T1912_v02d_avisos: todo como estaba con la 1212.
--   · PARA, sin tocar nada, si alguien ya ha dicho «Ya lo tengo»
--     (conta_puerta_recibido con filas): es trabajo de una persona.
--   · _conta_puerta_llegadas, conta_puerta_fuentes y
--     conta_puerta_fuentes_proponer, las de la 1212 (copiadas de su fichero,
--     que es lo que hay en producción).
--   · Sin _conta_puerta_cubre, conta_puerta_al_dia, conta_puerta_ya_lo_tengo
--     ni la tabla conta_puerta_recibido.
-- Lo que conta_puerta_al_dia haya vuelto a aprender en supplier_expected_invoice
-- (el ritmo de lo que nadie tocó) se queda: son valores que la 1212 también acepta.
-- ANTES de esto, el front tiene que volver al de antes: el del V02d llama a
-- conta_puerta_al_dia y a conta_puerta_ya_lo_tengo.

do $$
declare v_hay boolean := false;
begin
  -- Dinámico: si la tabla aún no existe (la prueba empieza deshaciendo), no se puede ni planificar.
  if to_regclass('public.conta_puerta_recibido') is not null then
    execute 'select exists (select 1 from public.conta_puerta_recibido)' into v_hay;
  end if;
  if v_hay then
    raise exception 'VUELTA ATRÁS DEL V02d: hay «Ya lo tengo» apuntados (conta_puerta_recibido). No se deshace a ciegas.';
  end if;
end $$;

create or replace function public._conta_puerta_llegadas(p_x public.supplier_expected_invoice)
returns date[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct d order by d), '{}'::date[]) from (
    -- De un proveedor: sus facturas (las de Sumied y las del libro de recibidas, también las traídas de Diez).
    select i.invoice_date d from public.supplier_invoice i
     where i.account_id = p_x.account_id and i.status <> 'anulada' and i.invoice_date >= current_date - 150
       and (i.supplier_id = p_x.supplier_id
            or i.supplier_id in (select s.id from public.supplier s where s.account_id = p_x.account_id
                                    and s.tax_id = any (array(select jsonb_array_elements_text(coalesce(p_x.match->'nifs', '[]'::jsonb)))))
            or (p_x.match ? 'numero_prefijo' and i.invoice_number like (p_x.match->>'numero_prefijo') || '%'))
    union
    select v.issue_date from public.vat_book_entry v
     where v.account_id = p_x.account_id and v.company_id = p_x.company_id and v.book = 'received' and v.voided_at is null and v.issue_date >= current_date - 150
       and (v.counterpart_tax_id in (select s.tax_id from public.supplier s where s.id = p_x.supplier_id)
            or v.counterpart_tax_id = any (array(select jsonb_array_elements_text(coalesce(p_x.match->'nifs', '[]'::jsonb))))
            or (p_x.match ? 'numero_prefijo' and v.number like (p_x.match->>'numero_prefijo') || '%'))
    -- Riders: la quincena de Catcher subida.
    union
    select b.period_to from public.supplier_batch b
     where p_x.kind = 'riders' and b.account_id = p_x.account_id and b.company_id = p_x.company_id and b.provider = 'catcher' and b.period_to >= current_date - 150
    -- Intermediario: sus liquidaciones (el fin de su periodo).
    union
    select coalesce(c.period_to, c.settlement_date) from public.channel_settlement c
     where p_x.kind = 'intermediario' and c.account_id = p_x.account_id and c.channel_id::text = p_x.match->>'canal'
       and coalesce(c.period_to, c.settlement_date) >= current_date - 150
    -- Banco: el día en que se subió el extracto, o la última sincronización.
    union
    select s.imported_at::date from public.bank_statement s
     where p_x.kind = 'banco' and s.account_id = p_x.account_id and s.company_id = p_x.company_id
       and (p_x.match->>'tesoreria' is null or s.treasury_account_id::text = p_x.match->>'tesoreria') and s.imported_at >= current_date - 150
    union
    select l.last_sync_at::date from public.bank_aggregator_link l
     where p_x.kind = 'banco' and l.account_id = p_x.account_id and l.company_id = p_x.company_id and l.last_sync_at is not null
       and (p_x.match->>'tesoreria' is null or l.treasury_account_id::text = p_x.match->>'tesoreria')
    -- Nóminas: el día en que llegaron.
    union
    select n.created_at::date from public.payroll_inbox n
     where p_x.kind = 'nominas' and n.account_id = p_x.account_id and n.created_at >= current_date - 150
    -- Lo que llegó por la puerta y se enganchó a esta fuente.
    union
    select coalesce(d.email_received_at, d.created_at)::date from public.document_inbox d
     where d.expected_id = p_x.id and d.status <> 'descartado'
  ) x where d is not null
$$;

create or replace function public.conta_puerta_fuentes(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company);
begin
  return jsonb_build_object(
    'ajustes', coalesce((select jsonb_build_object('lo_que_falta', a.lo_que_falta, 'margen', a.margen_dias) from public.conta_puerta_ajustes a where a.company_id = p_company),
                        jsonb_build_object('lo_que_falta', true, 'margen', 5)),
    -- Los locales de la empresa, para elegir el de cada fuente (con uno solo, no se pide nada).
    'locales', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.name, 'direccion', l.address, 'activo', l.active) order by l.name)
                           from public.location_company lc join public.locations l on l.id = lc.location_id
                          where lc.company_id = p_company and lc.account_id = v_acc), '[]'::jsonb),
    'fuentes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'clave', x.source_key, 'tipo', x.kind, 'nombre', coalesce(x.label, s.name, 'Sin nombre'), 'grupo', x.group_label,
        'proveedor_id', x.supplier_id, 'cadencia', x.cadence, 'dia', x.typical_day, 'dia_semana', x.weekday, 'cada', x.gap_days,
        'margen', x.margin_days, 'activa', x.active, 'origen', x.source, 'cubierta', x.covered_by_recurring_id is not null,
        'local', (select jsonb_build_object('id', l.id, 'nombre', l.name, 'direccion', l.address) from public.locations l where l.id = x.location_id),
        'llegadas', to_jsonb(public._conta_puerta_llegadas(x)),
        'pedida', (select jsonb_build_object('periodo', r.period, 'estado', r.status, 'a', r.to_email) from public.supplier_invoice_request r
                    where r.expected_id = x.id or (x.supplier_id is not null and r.supplier_id = x.supplier_id)
                    order by r.created_at desc limit 1))
      order by x.group_label nulls last, coalesce(x.label, s.name))
      from public.supplier_expected_invoice x left join public.supplier s on s.id = x.supplier_id
     where x.company_id = p_company and x.account_id = v_acc), '[]'::jsonb));
end $$;

create or replace function public.conta_puerta_fuentes_proponer(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company); v_desde date := (date_trunc('month', current_date) - interval '9 months')::date;
begin
  return coalesce((select jsonb_agg(x order by x->>'tipo', x->>'nombre') from (
    -- Proveedores con un ritmo (sin los riders, que van juntos).
    select jsonb_build_object(
      'clave', 'nif:' || r.nif, 'tipo', case when r.alquiler then 'alquiler' else 'proveedor' end,
      'nombre', r.nombre, 'proveedor_id', r.supplier_id, 'nifs', jsonb_build_array(r.nif),
      -- El local que llevaban sus facturas (el más repetido), si la empresa tiene
      -- más de uno: la persona lo confirma o lo cambia en los ajustes de la puerta.
      'local_id', case when (select count(*) from public.location_company lc where lc.company_id = p_company and lc.account_id = v_acc) > 1 then
                    (select mode() within group (order by i.location_id) from public.supplier_invoice i
                      where i.account_id = v_acc and i.supplier_id = r.supplier_id and i.status <> 'anulada'
                        and i.location_id in (select lc.location_id from public.location_company lc where lc.company_id = p_company and lc.account_id = v_acc)) end,
      'cadencia', case when r.por_mes > 1.5 then 'varias' else 'mensual' end,
      'dia', case when r.por_mes > 1.5 then null else r.dia end, 'cada', case when r.por_mes > 1.5 then 10 end,
      'meses', r.meses, 'por_mes', r.por_mes) as x
      from (
        select v.counterpart_tax_id nif, max(v.counterpart_name) nombre,
               count(distinct date_trunc('month', v.issue_date)) meses,
               round(count(distinct v.entry_id)::numeric / nullif(count(distinct date_trunc('month', v.issue_date)), 0), 1) por_mes,
               percentile_disc(0.5) within group (order by extract(day from v.issue_date)::int) dia,
               max(v.issue_date) ultima,
               (select s.id from public.supplier s where s.account_id = v_acc and s.tax_id = v.counterpart_tax_id order by s.created_at limit 1) supplier_id,
               -- Un alquiler: su gasto va a la 621 (arrendamientos), según su asiento.
               bool_or(exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                                where l.entry_id = v.entry_id and a.code like '621%')) alquiler
          from public.vat_book_entry v
         where v.account_id = v_acc and v.company_id = p_company and v.book = 'received' and v.voided_at is null
           and v.issue_date >= v_desde and coalesce(v.counterpart_tax_id, '') <> '' and coalesce(v.number, '') not like 'ES I%'
         group by v.counterpart_tax_id
      ) r
     where r.meses >= 6 and r.ultima >= (date_trunc('month', current_date) - interval '2 months')::date
    union all
    -- Los riders: una sola fuente, quincenal.
    select jsonb_build_object('clave', 'riders', 'tipo', 'riders', 'nombre', 'Riders de Catcher', 'cadencia', 'quincenal',
                              'numero_prefijo', 'ES I', 'facturas', count(*), 'personas', count(distinct v.counterpart_tax_id))
      from public.vat_book_entry v
     where v.account_id = v_acc and v.company_id = p_company and v.book = 'received' and v.voided_at is null
       and v.issue_date >= v_desde and v.number like 'ES I%'
    having count(*) > 0
    union all
    -- Intermediarios con liquidaciones en los últimos 4 meses.
    select jsonb_build_object('clave', 'canal:' || c.channel_id, 'tipo', 'intermediario', 'nombre', coalesce(ch.name, 'Intermediario') || ' · liquidaciones',
                              'canal', c.channel_id,
                              -- El ritmo de su ÚLTIMO periodo, no el más repetido: el histórico importado
                              -- (mensual, una fila por tienda) pesaba más que los resúmenes semanales de
                              -- Uber que entran desde el 11/10 (medido el 25/10). Empate el mismo día: el más fino.
                              'cadencia', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then 'semanal' when c.period_grain = 'quincena' then 'quincenal' else 'mensual' end
                                                     order by coalesce(c.period_to, c.settlement_date) desc,
                                                              case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              -- El día de la semana en que acaba su último periodo (Uber: el domingo) y, si es semanal, 1 día de margen (Julio, 25/10).
                              'dia_semana', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then extract(isodow from coalesce(c.period_to, c.settlement_date))::int end
                                                       order by coalesce(c.period_to, c.settlement_date) desc,
                                                                case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              'margen', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then 1 end
                                                   order by coalesce(c.period_to, c.settlement_date) desc,
                                                            case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              'liquidaciones', count(*))
      from public.channel_settlement c left join public.sales_channel ch on ch.id = c.channel_id and ch.account_id = c.account_id
     where c.account_id = v_acc and coalesce(c.is_reference, false) = false and coalesce(c.period_to, c.settlement_date) >= current_date - 120
     group by c.channel_id, ch.name
    union all
    -- El banco: cada cuenta con extractos o conexión.
    select jsonb_build_object('clave', 'banco:' || t.id, 'tipo', 'banco', 'nombre', 'Extracto · ' || coalesce(t.short_name, t.name, 'banco'),
                              'tesoreria', t.id, 'cadencia', 'semanal')
      from public.treasury_account t
     where t.company_id = p_company and t.account_id = v_acc and t.is_active
       and (exists (select 1 from public.bank_statement s where s.treasury_account_id = t.id)
            or exists (select 1 from public.bank_aggregator_link l where l.treasury_account_id = t.id))
    union all
    -- Las nóminas, si la cuenta las recibe (Laboral).
    select jsonb_build_object('clave', 'nominas', 'tipo', 'nominas', 'nombre', 'Nóminas' || coalesce(' · ' || p.gestoria_name, ''),
                              'cadencia', 'mensual', 'dia', 5)
      from public.payroll_settings p where p.account_id = v_acc
  ) z), '[]'::jsonb);
end $$;

revoke all on function public._conta_puerta_llegadas(public.supplier_expected_invoice) from public, anon, authenticated;
revoke all on function public.conta_puerta_fuentes(uuid) from public, anon;
grant execute on function public.conta_puerta_fuentes(uuid) to authenticated;
revoke all on function public.conta_puerta_fuentes_proponer(uuid) from public, anon;
grant execute on function public.conta_puerta_fuentes_proponer(uuid) to authenticated;

drop function if exists public.conta_puerta_ya_lo_tengo(uuid, date, text);
drop function if exists public.conta_puerta_al_dia(uuid);
drop function if exists public._conta_puerta_cubre(public.supplier_expected_invoice);
drop table if exists public.conta_puerta_recibido;
