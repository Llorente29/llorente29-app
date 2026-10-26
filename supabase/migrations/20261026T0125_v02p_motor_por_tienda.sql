-- supabase/migrations/20261026T0125_v02p_motor_por_tienda.sql
--
-- V02 · Entrega 2 · Pantallas · El motor, por TIENDA (Julio, 26/10). Medido en
-- producción, solo leyendo, con la tanda del #332 aplicada: el motor comparaba
-- cada liquidación de Uber (que es de UNA tienda: una marca en un local) con lo
-- vendido por Uber en TODO el local, y salían «diferencias» de miles de euros que
-- no existen (47.262 € en 10 filas). Las tres plataformas liquidan por tienda.
--
-- cambia: public.conta_liquidaciones · prueba: supabase/staging/sql/20261026_v02p_motor_por_tienda_prueba.sql
-- cambia: public.conta_liquidacion_resolver · prueba: supabase/staging/sql/20261026_v02p_motor_por_tienda_prueba.sql
-- cambia: public.conta_liquidacion_resolucion · prueba: supabase/staging/sql/20261026_v02p_motor_por_tienda_prueba.sql
--
--   1. conta_liquidaciones (misma firma): una fila por intermediario, local,
--      MARCA (la tienda) y periodo. Lo vendido sale de los pedidos cerrados de esa
--      marca, ese canal y ese local (hora de Madrid), no del cierre del local
--      entero (que no separa marcas). Sin marca (lo apuntado a mano por local), lo
--      del local entero. Los periodos sin liquidación se piden por tienda, de las
--      marcas propias (las cedidas las cobra el socio). Una liquidación de antes
--      del corte (de referencia) ya no sale como «Diferencia»: la lleva Diez.
--   2. conta_liquidacion_resolucion.brand_id (columna nueva, admite vacío): la
--      diferencia resuelta es de su tienda; los dos índices únicos, con el mismo
--      nombre, la incluyen (la tabla tiene 0 filas). Antes, resolver la de una marca habría resuelto la de las
--      demás marcas del mismo local y semana, y el índice no dejaba resolver la
--      segunda.
--   3. conta_liquidacion_resolver gana p_marca: DROP + CREATE (regla 2: nunca
--      una sobrecarga). Guarda la diferencia él mismo (gasto con su asiento, o
--      reclamación), por canal o por contacto. No la llama ninguna pantalla todavía.
--   4. Lo vendido se compara con lo que SUMAN LOS PEDIDOS de la liquidación, no
--      con sus «ventas» (que son a precio de carta, antes de promociones). Medido
--      en las 12 liquidaciones de Uber de Foodint desde julio: ventas + promociones
--      + otras ganancias = lo cobrado en caja, al céntimo, en 10 de 12; el
--      «Total del pedido (IVA incluido)» del informe de Uber, lo mismo. Las otras
--      dos son de verdad (un pedido del domingo por la noche que Uber pasa a la
--      semana siguiente, y dos pedidos que Uber paga y en caja están cancelados).
--
-- Nada de esto está en el camino del pedido: el motor solo LEE pedidos.
-- Vuelta atrás: supabase/vuelta-atras/20261026T0125_v02p_motor_por_tienda.down.sql

-- 2 · La marca de una diferencia resuelta --------------------------------------------------------
alter table public.conta_liquidacion_resolucion add column if not exists brand_id uuid references public.brand(id) on delete set null;
comment on column public.conta_liquidacion_resolucion.brand_id is 'V02 · E2. La marca (la tienda, con el local) de la diferencia resuelta: cada tienda se resuelve por separado.';
-- Los dos índices únicos, con el mismo nombre y ahora con la marca.
drop index if exists public.conta_liquidacion_resolucion_uq;
create unique index conta_liquidacion_resolucion_uq on public.conta_liquidacion_resolucion
  (company_id, channel_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
   period_from, period_to, coalesce(sale_id, '00000000-0000-0000-0000-000000000000'::uuid));
drop index if exists public.conta_liquidacion_resolucion_contacto_uq;
create unique index conta_liquidacion_resolucion_contacto_uq on public.conta_liquidacion_resolucion
  (company_id, party_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(brand_id, '00000000-0000-0000-0000-000000000000'::uuid),
   period_from, period_to, coalesce(sale_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where channel_id is null;

-- 3 · Resolver una diferencia de una tienda ------------------------------------------------------
drop function if exists public.conta_liquidacion_resolver(uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text);
create or replace function public.conta_liquidacion_resolver(p_company uuid, p_intermediario uuid, p_local uuid, p_marca uuid, p_desde date, p_hasta date,
  p_tipo text, p_importe numeric, p_frase text, p_fecha date default null, p_lineas jsonb default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_r public.party_role; v_res jsonb := '{}'::jsonb; v_id uuid; v_nombre text; v_canal text; v_entry uuid; v_num jsonb;
        v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor());
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta resuelve diferencias.' using errcode = '42501';
  end if;
  select * into v_r from public.party_role where id = p_intermediario and account_id = v_acc and role = 'platform';
  if v_r.id is null then raise exception 'Ese intermediario no es de la cuenta.' using errcode = '23514'; end if;
  if p_tipo not in ('gasto', 'reclamacion') then raise exception 'Una diferencia se resuelve como gasto o como reclamación.' using errcode = '22023'; end if;
  if btrim(coalesce(p_frase, '')) = '' then raise exception 'Escribe en una frase por qué.' using errcode = '22023'; end if;
  if p_importe is null or p_importe = 0 then raise exception 'La diferencia tiene que tener importe.' using errcode = '22023'; end if;
  if p_local is not null and not exists (select 1 from public.locations where id = p_local and account_id = v_acc) then raise exception 'Ese local no es de la cuenta.' using errcode = '23514'; end if;
  if p_marca is not null and not exists (select 1 from public.brand where id = p_marca and account_id = v_acc) then raise exception 'Esa marca no es de la cuenta.' using errcode = '23514'; end if;
  select name into v_nombre from public.party where id = v_r.party_id;
  select name into v_canal from public.sales_channel where id = v_r.channel_id;
  if exists (select 1 from public.conta_liquidacion_resolucion x
              where x.company_id = p_company and x.sale_id is null and x.period_from = p_desde and x.period_to = p_hasta
                and x.location_id is not distinct from p_local and x.brand_id is not distinct from p_marca
                and (x.channel_id = v_r.channel_id or (v_r.channel_id is null and x.channel_id is null and x.party_id = v_r.party_id))) then
    raise exception 'Esa diferencia ya está resuelta.' using errcode = '23505';
  end if;
  if p_tipo = 'gasto' then
    if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) < 2 then raise exception 'Un gasto lleva su asiento.' using errcode = '22023'; end if;
    v_res := public._journal_entry_proponer(p_company,
      jsonb_build_object('series', 1, 'fecha', coalesce(p_fecha, p_hasta), 'source_type', 'manual',
        'concepto', 'Diferencia de la liquidación de ' || coalesce(v_canal, v_nombre, 'tu intermediario') || coalesce(' · ' || (select name from public.brand where id = p_marca), '') ||
                    ' (' || to_char(p_desde, 'DD/MM') || '–' || to_char(p_hasta, 'DD/MM/YYYY') || '): ' || btrim(p_frase),
        'confianza', 'seguro', 'porque', 'Diferencia resuelta como gasto en Ventas › Liquidaciones.'),
      p_lineas, null, v_quien, auth.uid());
    v_entry := (v_res->>'id')::uuid;
    v_num := public.journal_entry_validar(v_entry, v_quien)->'numero';
  end if;
  insert into public.conta_liquidacion_resolucion (account_id, company_id, channel_id, party_id, location_id, brand_id, period_from, period_to, kind, importe, frase,
                                                   entry_id, created_by, created_by_name)
  values (v_acc, p_company, v_r.channel_id, v_r.party_id, p_local, p_marca, p_desde, p_hasta, p_tipo, round(p_importe, 2), btrim(p_frase), v_entry, auth.uid(), v_quien)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'asiento', v_entry, 'numero_asiento', v_num, 'texto',
    case when p_tipo = 'reclamacion' then 'Apuntado: reclamas ' || public.conta_euros_exactos(abs(p_importe)) || ' a ' || coalesce(v_nombre, 'tu intermediario') || '. Te lo recuerdo hasta que llegue.'
         else 'Apuntado como gasto: ' || public.conta_euros_exactos(abs(p_importe)) || coalesce(', asiento ' || v_num::text, '') || '.' end);
end $$;
revoke all on function public.conta_liquidacion_resolver(uuid, uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text) from public, anon;
grant execute on function public.conta_liquidacion_resolver(uuid, uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text) to authenticated;
comment on function public.conta_liquidacion_resolver(uuid, uuid, uuid, uuid, date, date, text, numeric, text, date, jsonb, text) is 'V02 · E2. Resolver la diferencia de la liquidación de una tienda (intermediario, local, marca y periodo) en una frase: «Es un gasto» (con su asiento) o «Lo reclamo» (se recuerda hasta que llegue).';

-- 1 · El motor, por tienda -----------------------------------------------------------------------
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
  -- Los locales de la empresa (si la cuenta no los reparte por empresa, todos los suyos).
  locs as (
    select lc.location_id from public.location_company lc where lc.company_id = p_company
    union
    select l.id from public.locations l
     where l.account_id = v_acc and not exists (select 1 from public.location_company lc where lc.company_id = p_company)
  ),
  -- Las liquidaciones de la empresa (las de sus tiendas y las que no dicen tienda).
  liq as (
    select cs.*, ps.external_text as tienda,
           coalesce(cs.location_id, (select t.location_id from public.conta_tienda_en(cs.store_id, coalesce(cs.period_from, cs.settlement_date)) t)) as local_id,
           coalesce(cs.brand_id, (select t.brand_id from public.conta_tienda_en(cs.store_id, coalesce(cs.period_from, cs.settlement_date)) t)) as marca_id,
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
  -- calendario, por sus pedidos de cada tienda; de los que cobran facturas, por sus facturas.
  dias_venta as (
    -- Las plataformas liquidan por tienda (marca y local): lo vendido, por sus
    -- pedidos cerrados de esa marca, ese canal y ese local (Madrid). Las marcas
    -- cedidas no: su dinero lo cobra el socio.
    select r.rol, s.location_id as local_id, s.brand_id as marca_id,
           public._conta_periodo_de(r.cada, (s.sold_at at time zone 'Europe/Madrid')::date) as per, s.total
      from roles r join public.sale s on s.account_id = v_acc and s.channel_id = r.channel_id
      join public.brand b on b.id = s.brand_id and b.account_id = v_acc and coalesce(b.ownership_type, 'own') <> 'licensed'
     where r.channel_id is not null and r.cada is not null and s.status = 'closed' and coalesce(s.is_active, true)
       and (s.sold_at at time zone 'Europe/Madrid')::date between v_desde and v_hasta
       and s.location_id in (select location_id from locs)
    union all
    select r.rol, ci.location_id, null::uuid, public._conta_periodo_de(coalesce(r.cada, 'monthly'), ci.issue_date), ci.total
      from roles r join public.payment_method pm on pm.party_id = r.party_id and pm.account_id = v_acc
      join public.customer_invoice ci on ci.payment_method_id = pm.id and ci.company_id = p_company and ci.status = 'emitida'
     where ci.issue_date between v_desde and v_hasta
  ), esperados as (
    select rol, local_id, marca_id, lower(per) as d1, upper(per) - 1 as d2 from dias_venta
     group by rol, local_id, marca_id, per having sum(total) <> 0
  ),
  grupos as (
    select rol, local_id, marca_id, d1, d2 from liq_sel group by 1, 2, 3, 4, 5
    union
    select e.rol, e.local_id, e.marca_id, e.d1, e.d2 from esperados e
     where (v_corte is null or e.d2 >= v_corte)
       and not exists (select 1 from liq_sel l where l.rol is not distinct from e.rol and l.local_id is not distinct from e.local_id
                         and l.marca_id is not distinct from e.marca_id and l.d1 <= e.d2 and l.d2 >= e.d1)
  ),
  filas as (
    select g.*, r.party_id, r.channel_id, r.nombre, r.dias, r.margen, r.cada,
           coalesce(ch.name, r.nombre, 'Intermediario') as canal, l.name as local, l.active as local_abierto, br.name as marca,
           -- Lo vendido: los pedidos cerrados de su canal, su local y su marca (la
           -- tienda); sin marca, los de todo el local (Madrid).
           (select jsonb_build_object('total', coalesce(sum(s.total), 0), 'pedidos', count(*), 'dias', count(distinct (s.sold_at at time zone 'Europe/Madrid')::date))
              from public.sale s
             where r.channel_id is not null and g.local_id is not null and s.account_id = v_acc and s.channel_id = r.channel_id
               and s.location_id = g.local_id and (g.marca_id is null or s.brand_id = g.marca_id)
               and s.status = 'closed' and coalesce(s.is_active, true)
               and (s.sold_at at time zone 'Europe/Madrid')::date between g.d1 and g.d2) as pedidos,
           (select jsonb_build_object('total', coalesce(sum(ci.total), 0), 'n', count(*))
              from public.payment_method pm join public.customer_invoice ci on ci.payment_method_id = pm.id
             where r.channel_id is null and pm.party_id = r.party_id and pm.account_id = v_acc and ci.company_id = p_company
               and ci.status = 'emitida' and ci.location_id is not distinct from g.local_id and ci.issue_date between g.d1 and g.d2) as facturas_vendidas,
           (select jsonb_agg(jsonb_build_object(
                     'id', s.id, 'tienda', s.tienda, 'ref', s.settlement_ref, 'fecha', s.settlement_date, 'origen', s.source, 'pedidos', s.orders_count,
                     'ventas', coalesce(s.gross_sales, 0), 'comision', abs(coalesce(s.commission, 0)), 'neto', s.net_payout,
                     -- Lo que suman sus pedidos, lo que se compara con la caja: el
                     -- «Total del pedido» del informe de Uber; del correo, las ventas
                     -- con sus promociones y las otras ganancias; si no, las ventas.
                     'pedidos_total', coalesce(nullif(s.raw->>'pedidos_total', '')::numeric,
                                               case when s.item_promotions is not null or s.other_earnings is not null
                                                    then coalesce(s.gross_sales, 0) + coalesce(s.item_promotions, 0) + coalesce(s.other_earnings, 0) end,
                                               coalesce(s.gross_sales, 0)),
                     'cobrado', s.collected_amount, 'cobrado_el', s.collected_on, 'referencia', coalesce(s.is_reference, false),
                     'por_aclarar', case when s.needs_review and not coalesce(s.is_reference, false) then s.review_note end,
                     'a_facturar', nullif((s.raw->'factura'->>'total')::numeric, 0),
                     'factura', case when si.id is not null then jsonb_build_object('id', si.id, 'numero', si.invoice_number, 'total', si.grand_total, 'estado', si.status) end,
                     'casada_en_banco', exists (select 1 from public.bank_match_item i join public.bank_match b on b.id = i.match_id
                                                  where i.channel_settlement_id = s.id and b.status = 'vivo'),
                     'facturas_cobradas', s.invoice_match_status, 'facturas_nota', s.invoice_match_note)
                   order by s.d1, s.tienda)
              from liq_sel s left join public.supplier_invoice si on si.id = s.commission_invoice_id and si.account_id = v_acc
             where s.rol is not distinct from g.rol and s.local_id is not distinct from g.local_id and s.marca_id is not distinct from g.marca_id
               and s.d1 = g.d1 and s.d2 = g.d2) as liquidaciones,
           coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tipo', x.kind, 'importe', x.importe, 'frase', x.frase, 'pedido', x.sale_id,
                                                         'quien', x.created_by_name, 'cuando', x.created_at, 'llego_el', x.arrived_on, 'llego', x.arrived_amount)
                                      order by x.created_at)
                       from public.conta_liquidacion_resolucion x
                      where x.company_id = p_company and x.location_id is not distinct from g.local_id and x.brand_id is not distinct from g.marca_id
                        and x.period_from = g.d1 and x.period_to = g.d2
                        and (x.channel_id = r.channel_id or (r.channel_id is null and x.party_id = r.party_id))), '[]'::jsonb) as resoluciones,
           (select jsonb_agg(jsonb_build_object('id', c.id, 'tienda', ps.external_text, 'tipo', c.kind, 'antes', c.antes, 'ahora', c.ahora) order by c.detected_at)
              from public.platform_store_cambio c join public.platform_store ps on ps.id = c.store_id
             where c.company_id = p_company and c.decided_at is null
               and c.store_id in (select s.store_id from liq_sel s where s.rol is not distinct from g.rol and s.local_id is not distinct from g.local_id
                                    and s.marca_id is not distinct from g.marca_id and s.d1 = g.d1 and s.d2 = g.d2)) as cambios
      from grupos g
      left join roles r on r.rol = g.rol
      left join public.sales_channel ch on ch.id = r.channel_id and ch.account_id = v_acc
      left join public.locations l on l.id = g.local_id and l.account_id = v_acc
      left join public.brand br on br.id = g.marca_id and br.account_id = v_acc
  ),
  cifras as (
    select f.*,
      coalesce(jsonb_array_length(f.liquidaciones), 0) as n_liq,
      (select coalesce(sum((x->>'ventas')::numeric), 0) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_ventas,
      (select coalesce(sum((x->>'pedidos_total')::numeric), 0) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_pedidos,
      (select coalesce(sum((x->>'comision')::numeric), 0) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_comision,
      (select case when bool_and(x->>'neto' is not null) then sum((x->>'neto')::numeric) end from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_pagan,
      (select case when count(*) filter (where x->>'cobrado' is not null) > 0 then sum((x->>'cobrado')::numeric) end from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as l_banco,
      (select count(*) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x
        where not (x->>'referencia')::boolean and x->>'cobrado' is null and coalesce((x->>'neto')::numeric, 0) > 0) as por_cobrar,
      (select count(*) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x
        where not (x->>'referencia')::boolean and coalesce((x->>'a_facturar')::numeric, 0) > 0 and x->>'factura' is null) as faltan_facturas,
      (select coalesce(bool_and((x->>'referencia')::boolean), false) from jsonb_array_elements(coalesce(f.liquidaciones, '[]')) x) as todo_referencia,
      case when f.channel_id is not null then coalesce((f.pedidos->>'total')::numeric, 0)
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
      case when c.n_liq > 0 and (c.local_id is not null or c.channel_id is null) and not c.sin_vendido and abs(round((c.vendido - c.l_pedidos) * 100)) > c.tol
           then round(c.vendido - c.l_pedidos, 2) end as dif_ventas,
      case when c.n_liq > 0 and c.l_banco is not null and c.l_pagan is not null and c.por_cobrar = 0 and abs(round((c.l_pagan - c.l_banco) * 100)) > c.tol
           then round(c.l_pagan - c.l_banco, 2) end as dif_cobro
      from cifras c
  ),
  estado as (
    select d.*,
      case
        when d.n_liq = 0 then case when v_hoy > d.plazo then 'falta_liquidacion' else 'esperando_liquidacion' end
        -- De antes del corte: la lleva Diez; sirve para contrastar, no pide nada.
        when d.todo_referencia then 'cuadra'
        when d.local_id is null and d.channel_id is not null and not d.todo_referencia then 'diferencia'
        when (d.dif_ventas is not null or d.dif_cobro is not null) and d.resuelta is null then 'diferencia'
        when d.faltan_facturas > 0 then 'falta_factura'
        when d.por_cobrar > 0 then 'esperando_cobro'
        else 'cuadra'
      end as estado
      from dif d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'clave', coalesce(e.rol::text, 'sin') || ':' || coalesce(e.local_id::text, 'sin') || ':' || coalesce(e.marca_id::text, 'sin') || ':' || e.d1 || ':' || e.d2,
      'marca_id', e.marca_id, 'marca', e.marca,
      'intermediario_id', e.rol, 'intermediario', coalesce(e.nombre, e.canal), 'canal_id', e.channel_id, 'canal', e.canal,
      'local_id', e.local_id, 'local', e.local, 'desde', e.d1, 'hasta', e.d2,
      'estado', e.estado, 'cerrada', e.estado = 'cuadra' and e.reclamado_sin_llegar = 0,
      'diferencia', case when e.estado = 'diferencia' then coalesce(e.dif_ventas, e.dif_cobro, 0) end,
      'frase', case e.estado
        when 'esperando_liquidacion' then 'Aún a tiempo: ' || coalesce(e.nombre, e.canal) || ' suele pagar hacia el ' || to_char(e.d2 + e.dias, 'DD/MM') || '.'
        when 'falta_liquidacion' then 'Falta su liquidación: tenía que haber llegado hacia el ' || to_char(e.d2 + e.dias, 'DD/MM') ||
                                      ' y vendiste ' || public.conta_euros_exactos(e.vendido) || ' por ' || e.canal || coalesce(' con ' || e.marca, '') || '.'
        when 'diferencia' then case
          when e.local_id is null and e.channel_id is not null then 'No sé de qué local es: dale su local a la tienda y se compara con lo que vendiste.'
          when e.dif_ventas is not null then case when e.dif_ventas > 0
              then 'Vendiste ' || public.conta_euros_exactos(e.vendido) || ' y la liquidación dice ' || public.conta_euros_exactos(e.l_pedidos) || ': liquida ' || public.conta_euros_exactos(e.dif_ventas) || ' de menos.'
              else 'La liquidación dice ' || public.conta_euros_exactos(e.l_pedidos) || ' y vendiste ' || public.conta_euros_exactos(e.vendido) || ': liquida ' || public.conta_euros_exactos(-e.dif_ventas) || ' de más.' end
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
        'vendido', jsonb_build_object('via', case when e.channel_id is not null then 'pedidos' when e.sin_vendido then 'liquidacion' else 'facturas' end,
                                      'total', case when e.sin_vendido then null else e.vendido end, 'pedidos', e.pedidos, 'facturas', e.facturas_vendidas),
        'liquidacion', jsonb_build_object('n', e.n_liq, 'ventas', e.l_ventas, 'pedidos_total', e.l_pedidos, 'comision', e.l_comision, 'pagan', e.l_pagan,
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
