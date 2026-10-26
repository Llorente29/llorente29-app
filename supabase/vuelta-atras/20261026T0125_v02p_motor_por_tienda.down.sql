-- supabase/vuelta-atras/20261026T0125_v02p_motor_por_tienda.down.sql
--
-- Vuelta atrás de 20261026T0125_v02p_motor_por_tienda. Deja todo como lo dejó
-- la tanda del #332 (2253 y 2254): el motor por local (su cuerpo, copiado de la
-- 2253), sin el resolutor por tienda (el de antes no se tocó), los dos índices
-- sin la marca (los de la 1650 del V01 y la 2254) y sin la columna brand_id. PARA si ya hay alguna
-- diferencia resuelta con su marca: no se pierde en silencio.

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_liquidacion_resolucion' and column_name = 'brand_id')
     and (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_liquidacion_resolucion where brand_id is not null', false, true, '')))[1]::text::int > 0 then
    raise exception 'VUELTA ATRÁS 0125: hay diferencias resueltas con su marca; no se pierden en silencio.';
  end if;
end $$;

drop function if exists public.conta_liquidacion_resolver_tienda(uuid, uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text);

create or replace function public.conta_liquidaciones(p_company uuid, p_desde date default null, p_hasta date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid; v_desde date; v_hasta date; v_hoy date := public.conta_hoy(); v_corte date; v_r jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  v_corte := public._conta_corte(p_company);
  v_hasta := coalesce(p_hasta, v_hoy);
  v_desde := coalesce(p_desde, v_hasta - 92);

  with roles as (
    select r.id as rol, r.party_id, r.channel_id, r.settlement_every as cada, coalesce(r.payout_days_after, 0) as dias,
           coalesce(r.payout_margin_days, 5) as margen, p.name as nombre
      from public.party_role r join public.party p on p.id = r.party_id
     where r.account_id = v_acc and r.role = 'platform'
  ),
  -- Las liquidaciones de la empresa (las de sus tiendas y las que no dicen tienda).
  liq as (
    select cs.*, ps.external_text as tienda,
           coalesce(cs.location_id, (select t.location_id from public.conta_tienda_en(cs.store_id, coalesce(cs.period_from, cs.settlement_date)) t)) as local_id,
           coalesce(cs.period_from, cs.proposed_period_from, cs.settlement_date) as d1,
           coalesce(cs.period_to, cs.proposed_period_to, cs.settlement_date) as d2,
           public._conta_intermediario_de(v_acc, cs.party_id, cs.channel_id) as rol
      from public.channel_settlement cs
      left join public.platform_store ps on ps.id = cs.store_id and ps.account_id = v_acc
     where cs.account_id = v_acc and coalesce(cs.flow_type, 'own') <> 'licensed'
       and (ps.id is null or ps.company_id = p_company)
  ), liq_sel as (
    select * from liq where d1 is not null and d1 <= v_hasta and d2 >= v_desde
  ),
  -- Los periodos con ventas y sin liquidación: de los intermediarios con canal y
  -- calendario, por sus cierres; de los que cobran facturas, por sus facturas.
  dias_venta as (
    select r.rol, d.location_id as local_id, public._conta_periodo_de(r.cada, d.sales_day) as per, d.total
      from roles r join public.sales_day_summary d on d.company_id = p_company and d.channel_id = r.channel_id
      left join public.journal_entry e on e.id = d.entry_id
     where r.channel_id is not null and r.cada is not null and d.sales_day between v_desde and v_hasta
       and coalesce(e.status, 'propuesto') <> 'anulado'
    union all
    select r.rol, ci.location_id, public._conta_periodo_de(coalesce(r.cada, 'monthly'), ci.issue_date), ci.total
      from roles r join public.payment_method pm on pm.party_id = r.party_id and pm.account_id = v_acc
      join public.customer_invoice ci on ci.payment_method_id = pm.id and ci.company_id = p_company and ci.status = 'emitida'
     where ci.issue_date between v_desde and v_hasta
  ), esperados as (
    select rol, local_id, lower(per) as d1, upper(per) - 1 as d2 from dias_venta
     group by rol, local_id, per having sum(total) <> 0
  ),
  grupos as (
    select rol, local_id, d1, d2 from liq_sel group by 1, 2, 3, 4
    union
    select e.rol, e.local_id, e.d1, e.d2 from esperados e
     where (v_corte is null or e.d2 >= v_corte)
       and not exists (select 1 from liq_sel l where l.rol is not distinct from e.rol and l.local_id is not distinct from e.local_id
                         and l.d1 <= e.d2 and l.d2 >= e.d1)
  ),
  filas as (
    select g.*, r.party_id, r.channel_id, r.nombre, r.dias, r.margen, r.cada,
           coalesce(ch.name, r.nombre, 'Intermediario') as canal, l.name as local, l.active as local_abierto,
           -- Lo vendido: cierres de su canal (o sus facturas, sin canal).
           (select jsonb_build_object('total', coalesce(sum(d.total), 0), 'dias', count(distinct d.sales_day),
                                      'por_validar', count(*) filter (where e.status in ('propuesto', 'borrador')))
              from public.sales_day_summary d left join public.journal_entry e on e.id = d.entry_id
             where r.channel_id is not null and g.local_id is not null and d.company_id = p_company and d.channel_id = r.channel_id
               and d.location_id = g.local_id and d.sales_day between g.d1 and g.d2 and coalesce(e.status, 'propuesto') <> 'anulado') as cierres,
           (select jsonb_build_object('total', coalesce(sum(s.total), 0), 'pedidos', count(*))
              from public.sale s join public.brand b on b.id = s.brand_id and b.account_id = v_acc and b.ownership_type = 'licensed'
             where r.channel_id is not null and g.local_id is not null and s.account_id = v_acc and s.channel_id = r.channel_id
               and s.location_id = g.local_id and s.status = 'closed' and coalesce(s.is_active, true)
               and (s.sold_at at time zone 'Europe/Madrid')::date between g.d1 and g.d2) as cedidas,
           (select jsonb_build_object('total', coalesce(sum(ci.total), 0), 'n', count(*))
              from public.payment_method pm join public.customer_invoice ci on ci.payment_method_id = pm.id
             where r.channel_id is null and pm.party_id = r.party_id and pm.account_id = v_acc and ci.company_id = p_company
               and ci.status = 'emitida' and ci.location_id is not distinct from g.local_id and ci.issue_date between g.d1 and g.d2) as facturas_vendidas,
           (select jsonb_agg(jsonb_build_object(
                     'id', s.id, 'tienda', s.tienda, 'ref', s.settlement_ref, 'fecha', s.settlement_date, 'origen', s.source, 'pedidos', s.orders_count,
                     'ventas', coalesce(s.gross_sales, 0), 'comision', abs(coalesce(s.commission, 0)), 'neto', s.net_payout,
                     'cobrado', s.collected_amount, 'cobrado_el', s.collected_on, 'referencia', coalesce(s.is_reference, false),
                     'por_aclarar', case when s.needs_review and not coalesce(s.is_reference, false) then s.review_note end,
                     'a_facturar', nullif((s.raw->'factura'->>'total')::numeric, 0),
                     'factura', case when si.id is not null then jsonb_build_object('id', si.id, 'numero', si.invoice_number, 'total', si.grand_total, 'estado', si.status) end,
                     'casada_en_banco', exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                                                  where i.channel_settlement_id = s.id and b.status = 'vivo'),
                     'facturas_cobradas', s.invoice_match_status, 'facturas_nota', s.invoice_match_note)
                   order by s.d1, s.tienda)
              from liq_sel s left join public.supplier_invoice si on si.id = s.commission_invoice_id and si.account_id = v_acc
             where s.rol is not distinct from g.rol and s.local_id is not distinct from g.local_id and s.d1 = g.d1 and s.d2 = g.d2) as liquidaciones,
           coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.kind, 'importe', x.importe, 'frase', x.frase, 'pedido', x.sale_id,
                                                         'quien', x.created_by_name, 'cuando', x.created_at, 'llego_el', x.arrived_on, 'llego', x.arrived_amount)
                                      order by x.created_at)
                       from public.conta_liquidacion_resolucion x
                      where x.company_id = p_company and x.location_id is not distinct from g.local_id and x.period_from = g.d1 and x.period_to = g.d2
                        and (x.channel_id = r.channel_id or (r.channel_id is null and x.party_id = r.party_id))), '[]'::jsonb) as resoluciones,
           (select jsonb_agg(jsonb_build_object('id', c.id, 'tienda', ps.external_text, 'tipo', c.kind, 'antes', c.antes, 'ahora', c.ahora) order by c.detected_at)
              from public.platform_store_cambio c join public.platform_store ps on ps.id = c.store_id
             where c.company_id = p_company and c.decided_at is null
               and c.store_id in (select s.store_id from liq_sel s where s.rol is not distinct from g.rol and s.local_id is not distinct from g.local_id
                                    and s.d1 = g.d1 and s.d2 = g.d2)) as cambios
      from grupos g
      left join roles r on r.rol = g.rol
      left join public.sales_channel ch on ch.id = r.channel_id and ch.account_id = v_acc
      left join public.locations l on l.id = g.local_id and l.account_id = v_acc
  ),
  cifras as (
    select f.*,
      coalesce(jsonb_array_length(f.liquidaciones), 0) as n_liq,
      (select coalesce(sum((x->>'ventas')::numeric), 0) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_ventas,
      (select coalesce(sum((x->>'comision')::numeric), 0) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_comision,
      (select case when bool_and(x->>'neto' is not null) then sum((x->>'neto')::numeric) end from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_pagan,
      (select case when count(*) filter (where x->>'cobrado' is not null) > 0 then sum((x->>'cobrado')::numeric) end from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_banco,
      (select count(*) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x
        where not (x->>'referencia')::boolean and x->>'cobrado' is null and coalesce((x->>'neto')::numeric, 0) > 0) as por_cobrar,
      (select count(*) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x
        where not (x->>'referencia')::boolean and coalesce((x->>'a_facturar')::numeric, 0) > 0 and x->>'factura' is null) as faltan_facturas,
      (select coalesce(bool_and((x->>'referencia')::boolean), false) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as todo_referencia,
      case when f.channel_id is not null then coalesce((f.cierres->>'total')::numeric, 0) + coalesce((f.cedidas->>'total')::numeric, 0)
           else coalesce((f.facturas_vendidas->>'total')::numeric, 0) end as vendido,
      (f.channel_id is null and coalesce((f.facturas_vendidas->>'n')::int, 0) = 0) as sin_vendido,
      greatest(1, coalesce(jsonb_array_length(f.liquidaciones), 0)) as tol,
      f.d2 + f.dias + f.margen as plazo,
      (select x from jsonb_array_elements(f.resoluciones) x where x->>'pedido' is null limit 1) as resuelta,
      (select coalesce(sum(abs((x->>'importe')::numeric)), 0) from jsonb_array_elements(f.resoluciones) x
        where x->>'tipo' = 'reclamacion' and x->>'llego_el' is null) as reclamado_sin_llegar
      from filas f
  ),
  dif as (
    select c.*,
      case when c.n_liq > 0 and (c.local_id is not null or c.channel_id is null) and not c.sin_vendido and abs(round((c.vendido - c.l_ventas) * 100)) > c.tol
           then round(c.vendido - c.l_ventas, 2) end as dif_ventas,
      case when c.n_liq > 0 and c.l_banco is not null and c.l_pagan is not null and c.por_cobrar = 0 and abs(round((c.l_pagan - c.l_banco) * 100)) > c.tol
           then round(c.l_pagan - c.l_banco, 2) end as dif_cobro
      from cifras c
  ),
  estado as (
    select d.*,
      case
        when d.n_liq = 0 then case when v_hoy > d.plazo then 'falta_liquidacion' else 'esperando_liquidacion' end
        when d.local_id is null and d.channel_id is not null and not d.todo_referencia then 'diferencia'
        when (d.dif_ventas is not null or d.dif_cobro is not null) and d.resuelta is null then 'diferencia'
        when d.faltan_facturas > 0 then 'falta_factura'
        when d.por_cobrar > 0 then 'esperando_cobro'
        else 'cuadra'
      end as estado
      from dif d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'clave', coalesce(e.rol::text, 'sin') || ':' || coalesce(e.local_id::text, 'sin') || ':' || e.d1 || ':' || e.d2,
      'intermediario_id', e.rol, 'intermediario', coalesce(e.nombre, e.canal), 'canal_id', e.channel_id, 'canal', e.canal,
      'local_id', e.local_id, 'local', e.local, 'desde', e.d1, 'hasta', e.d2,
      'estado', e.estado, 'cerrada', e.estado = 'cuadra' and e.reclamado_sin_llegar = 0,
      'diferencia', case when e.estado = 'diferencia' then coalesce(e.dif_ventas, e.dif_cobro, 0) end,
      'frase', case e.estado
        when 'esperando_liquidacion' then 'Aún a tiempo: ' || coalesce(e.nombre, e.canal) || ' suele pagar hacia el ' || to_char(e.d2 + e.dias, 'DD/MM') || '.'
        when 'falta_liquidacion' then 'Falta su liquidación: tenía que haber llegado hacia el ' || to_char(e.d2 + e.dias, 'DD/MM') ||
                                      ' y vendiste ' || public.conta_euros_exactos(e.vendido) || ' por ' || e.canal || '.'
        when 'diferencia' then case
          when e.local_id is null and e.channel_id is not null then 'No sé de qué local es: dale su local a la tienda y se compara con tus ventas.'
          when e.dif_ventas is not null then case when e.dif_ventas > 0
              then 'Vendiste ' || public.conta_euros_exactos(e.vendido) || ' y la liquidación dice ' || public.conta_euros_exactos(e.l_ventas) || ': liquida ' || public.conta_euros_exactos(e.dif_ventas) || ' de menos.'
              else 'La liquidación dice ' || public.conta_euros_exactos(e.l_ventas) || ' y vendiste ' || public.conta_euros_exactos(e.vendido) || ': liquida ' || public.conta_euros_exactos(-e.dif_ventas) || ' de más.' end
          else case when e.dif_cobro > 0
              then 'Dice que paga ' || public.conta_euros_exactos(e.l_pagan) || ' y al banco llegaron ' || public.conta_euros_exactos(e.l_banco) || ': faltan ' || public.conta_euros_exactos(e.dif_cobro) || '.'
              else 'Dice que paga ' || public.conta_euros_exactos(e.l_pagan) || ' y al banco llegaron ' || public.conta_euros_exactos(e.l_banco) || ': ' || public.conta_euros_exactos(-e.dif_cobro) || ' de más.' end end
        when 'falta_factura' then case when e.faltan_facturas = 1 then 'Falta su factura de comisión: cuando llegue a Compras, se engancha.'
                                       else 'Faltan ' || e.faltan_facturas || ' facturas de comisión: cuando lleguen a Compras, se enganchan.' end
        when 'esperando_cobro' then 'Esperando el cobro: ' || public.conta_euros_exactos(coalesce(e.l_pagan, 0)) ||
                                    case when v_hoy > e.plazo then ', y ya debería haber llegado al banco.' else '.' end
        else case when e.todo_referencia then 'De antes del cierre: de referencia (la lleva Diez).'
                  when e.reclamado_sin_llegar > 0 then 'Cuadra, con ' || public.conta_euros_exactos(e.reclamado_sin_llegar) || ' reclamados que aún no han llegado.'
                  when jsonb_array_length(e.resoluciones) > 0 then 'Cuadra, con ' || case when jsonb_array_length(e.resoluciones) = 1 then 'una diferencia resuelta' else jsonb_array_length(e.resoluciones) || ' diferencias resueltas' end || '.'
                  else 'Cuadra: lo vendido, la liquidación, su factura y el cobro.' end
      end,
      'piezas', jsonb_build_object(
        'vendido', jsonb_build_object('via', case when e.channel_id is not null then 'cierres' when e.sin_vendido then 'liquidacion' else 'facturas' end,
                                      'total', case when e.sin_vendido then null else e.vendido end, 'cierres', e.cierres, 'cedidas', e.cedidas, 'facturas', e.facturas_vendidas),
        'liquidacion', jsonb_build_object('n', e.n_liq, 'ventas', e.l_ventas, 'comision', e.l_comision, 'pagan', e.l_pagan,
                                          'otros', case when e.l_pagan is not null then round(e.l_ventas - e.l_comision - e.l_pagan, 2) end,
                                          'referencia', e.todo_referencia and e.n_liq > 0),
        'factura', jsonb_build_object('faltan', e.faltan_facturas),
        'cobro', jsonb_build_object('esperado', e.l_pagan, 'llegado', e.l_banco, 'por_cobrar', e.por_cobrar)),
      'liquidaciones', coalesce(e.liquidaciones, '[]'::jsonb),
      'resoluciones', e.resoluciones,
      'reclamado_sin_llegar', e.reclamado_sin_llegar,
      'avisos', (select coalesce(jsonb_agg(a), '[]'::jsonb) from (
                  select jsonb_build_object('tipo', 'local_cerrado', 'texto', 'Llegan ventas de ' || e.local || ', que está cerrado: revisa de qué local son.') a
                   where e.local_id is not null and e.local_abierto is false and e.n_liq > 0 and not e.todo_referencia
                  union all
                  select jsonb_build_object('tipo', 'tienda_cambiada', 'cambio_id', c->>'id',
                                            'texto', 'La tienda «' || (c->>'antes') || '» llega como «' || (c->>'ahora') || '»: confírmalo con un clic.')
                    from jsonb_array_elements(coalesce(e.cambios, '[]'::jsonb)) c) z),
      'plazo', e.plazo)
    order by e.d2 desc, e.canal, e.local nulls last), '[]'::jsonb)
    into v_r
    from estado e;
  return v_r;
end $$;
revoke all on function public.conta_liquidaciones(uuid, date, date) from public, anon;
grant execute on function public.conta_liquidaciones(uuid, date, date) to authenticated;
comment on function public.conta_liquidaciones(uuid, date, date) is 'V02 · E2. EL MOTOR: una fila por intermediario, local y periodo con sus cuatro piezas (lo vendido, la liquidación, su factura de comisión y el cobro), su estado y la frase. También los periodos con ventas y sin liquidación. Solo lee.';

drop index if exists public.conta_liquidacion_resolucion_uq;
create unique index conta_liquidacion_resolucion_uq on public.conta_liquidacion_resolucion
  (company_id, channel_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), period_from, period_to,
   coalesce(sale_id, '00000000-0000-0000-0000-000000000000'::uuid));
drop index if exists public.conta_liquidacion_resolucion_contacto_uq;
create unique index conta_liquidacion_resolucion_contacto_uq on public.conta_liquidacion_resolucion
  (company_id, party_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), period_from, period_to,
   coalesce(sale_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where channel_id is null;
alter table public.conta_liquidacion_resolucion drop column if exists brand_id;
