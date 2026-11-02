-- supabase/migrations/20261102T1216_s01q_motor_mes.sql
--
-- S01q · Liquidaciones de un mes, como las ve quien no sabe contabilidad (Julio,
-- 02/11). AÑADE conta_liquidaciones_mes: lee el motor de siempre
-- (conta_liquidaciones, por tienda desde el V02p) y lo dice en cuatro estados:
--   · completa     — las cuatro piezas, y cuadran;
--   · aun_no_toca  — todavía no es su fecha (con la fecha);
--   · te_necesita  — falta algo, y qué hacer («Pídela», «Súbela», «Elige el local»…);
--   · no_cuadra    — las cifras no coinciden, con la diferencia.
-- Un periodo es del mes en que acaba. Cada fila lleva sus tiendas con el nombre
-- que les pone la plataforma, y su marca y su local de Sumied.
-- Las tiendas SIN local, o con local y SIN marca, no se comparan con lo vendido
-- (sería todo el local): piden su local o su marca, y se cuadran por tienda.
-- GLOVO (Julio, 02/11): liquida los productos a precio de carta; nuestra caja
-- guarda lo cobrado (con el envío y menos los descuentos que paga Glovo). Lo
-- vendido de una tienda de Glovo es la suma de las LÍNEAS DE PRODUCTO de sus
-- pedidos, y con eso se compara (medido en octubre: Mila's 218,00 = 218,00;
-- Bendito 39,30 = 39,30). Las promociones a cargo del local se enseñan, no se
-- restan: Glovo liquida el precio de carta igual.
-- Las MARCAS CEDIDAS van aparte: no esperan liquidación de plataforma; las
-- liquida su socio una vez al mes, por local (licensed_settlement). Nunca son
-- «falta la liquidación».
-- No cambia nada de lo que existe: la pantalla de hoy sigue con el motor de siempre.

create or replace function public.conta_liquidaciones_mes(p_company uuid, p_mes date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid; v_hoy date := public.conta_hoy();
  v_ini date := date_trunc('month', coalesce(p_mes, public.conta_hoy()))::date;
  v_fin date; v_motor jsonb; v_filas jsonb; v_cedidas jsonb;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  v_fin := (v_ini + interval '1 month')::date - 1;
  -- Desde 5 semanas antes: lo vendido de un periodo que empezó el mes anterior.
  v_motor := public.conta_liquidaciones(p_company, v_ini - 35, v_fin);

  with m as (
    select x from jsonb_array_elements(coalesce(v_motor, '[]'::jsonb)) x
     where (x->>'hasta')::date between v_ini and v_fin
  ), t as (
    -- Las tiendas de cada fila: las de sus liquidaciones, o (si no ha llegado
    -- ninguna) las de su canal, su marca y su local.
    select m.x,
      coalesce(
        (select jsonb_agg(distinct jsonb_build_object('id', ps.id, 'nombre', ps.external_text))
           from jsonb_array_elements(m.x->'liquidaciones') l
           join public.channel_settlement cs on cs.id = (l->>'id')::uuid and cs.account_id = v_acc
           join public.platform_store ps on ps.id = cs.store_id),
        (select jsonb_agg(jsonb_build_object('id', ps.id, 'nombre', ps.external_text))
           from public.platform_store ps
          where ps.account_id = v_acc and ps.company_id = p_company and ps.channel_id = (m.x->>'canal_id')::uuid
            and ps.brand_id = (m.x->>'marca_id')::uuid and ps.location_id = (m.x->>'local_id')::uuid),
        '[]'::jsonb) as tiendas,
      coalesce((select b.ownership_type = 'licensed' from public.brand b where b.id = (m.x->>'marca_id')::uuid and b.account_id = v_acc), false) as cedida,
      -- Glovo: todas sus liquidaciones son de Glovo, y la tienda tiene local y marca.
      (jsonb_array_length(coalesce(m.x->'liquidaciones', '[]'::jsonb)) > 0 and m.x->>'canal_id' is not null
        and m.x->>'local_id' is not null and m.x->>'marca_id' is not null
        and not exists (select 1 from jsonb_array_elements(m.x->'liquidaciones') l where coalesce(l->>'origen', '') !~ 'glovo')) as glovo
      from m
  ), g as (
    select t.*,
      case when t.glovo then (
        select coalesce(round(sum(sl.quantity * sl.unit_price), 2), 0)
          from public.sale s join public.sale_line sl on sl.sale_id = s.id
         where s.account_id = v_acc and s.channel_id = (t.x->>'canal_id')::uuid and s.location_id = (t.x->>'local_id')::uuid
           and s.brand_id = (t.x->>'marca_id')::uuid and s.status = 'closed' and coalesce(s.is_active, true)
           and (s.sold_at at time zone 'Europe/Madrid')::date between (t.x->>'desde')::date and (t.x->>'hasta')::date) end as v_prod,
      coalesce((t.x->'piezas'->'liquidacion'->>'ventas')::numeric, 0) as l_prod,
      greatest(1, jsonb_array_length(coalesce(t.x->'liquidaciones', '[]'::jsonb))) as tol,
      (select coalesce(sum((cs.raw->>'promociones_local')::numeric), 0) from jsonb_array_elements(coalesce(t.x->'liquidaciones', '[]'::jsonb)) l
         join public.channel_settlement cs on cs.id = (l->>'id')::uuid and cs.account_id = v_acc) as promos,
      (select sum((l->>'pedidos')::int) from jsonb_array_elements(coalesce(t.x->'liquidaciones', '[]'::jsonb)) l) as ped_liq,
      exists (select 1 from jsonb_array_elements(coalesce(t.x->'resoluciones', '[]'::jsonb)) r where r->>'pedido' is null) as resuelta
      from t
  ), h as (
    select g.*,
      case when g.glovo and abs(round((g.v_prod - g.l_prod) * 100)) > g.tol then round(g.v_prod - g.l_prod, 2) end as dif_v,
      case when g.glovo and g.x->'piezas'->'cobro'->>'esperado' is not null and g.x->'piezas'->'cobro'->>'llegado' is not null
                and coalesce((g.x->'piezas'->'cobro'->>'por_cobrar')::int, 0) = 0
                and abs(round(((g.x->'piezas'->'cobro'->>'esperado')::numeric - (g.x->'piezas'->'cobro'->>'llegado')::numeric) * 100)) > g.tol
           then round((g.x->'piezas'->'cobro'->>'esperado')::numeric - (g.x->'piezas'->'cobro'->>'llegado')::numeric, 2) end as dif_c
      from g
  ), k as (
    -- El estado del motor, y en Glovo el mismo orden con lo vendido por productos.
    select h.*,
      case
        when not h.glovo or h.x->>'estado' in ('esperando_liquidacion', 'falta_liquidacion') then h.x->>'estado'
        when coalesce((h.x->'piezas'->'liquidacion'->>'referencia')::boolean, false) then 'cuadra'
        when (h.dif_v is not null or h.dif_c is not null) and not h.resuelta then 'diferencia'
        when coalesce((h.x->'piezas'->'factura'->>'faltan')::int, 0) > 0 then 'falta_factura'
        when coalesce((h.x->'piezas'->'cobro'->>'por_cobrar')::int, 0) > 0 then 'esperando_cobro'
        else 'cuadra'
      end as est
      from h
  ), e as (
    select k.*,
      case
        when k.est = 'cuadra' then 'completa'
        when k.est = 'esperando_liquidacion' then 'aun_no_toca'
        when k.est = 'falta_liquidacion' then 'te_necesita'
        when k.est = 'falta_factura' then case when v_hoy > (k.x->>'plazo')::date then 'te_necesita' else 'aun_no_toca' end
        when k.est = 'esperando_cobro' then case when v_hoy > (k.x->>'plazo')::date then 'te_necesita' else 'aun_no_toca' end
        when k.est = 'diferencia' and k.x->>'canal_id' is not null and (k.x->>'local_id' is null or k.x->>'marca_id' is null) then 'te_necesita'
        when k.est = 'diferencia' then 'no_cuadra'
        else 'te_necesita'
      end as estado,
      case
        when k.est = 'falta_liquidacion' then 'pidela'
        when k.est = 'falta_factura' then 'subela'
        when k.est = 'esperando_cobro' then 'mira_el_banco'
        when k.est = 'diferencia' and k.x->>'canal_id' is not null and k.x->>'local_id' is null then 'elige_local'
        when k.est = 'diferencia' and k.x->>'canal_id' is not null and k.x->>'marca_id' is null then 'elige_marca'
        when k.est = 'diferencia' then 'ver_por_que'
      end as accion
      from k
  )
  select coalesce(jsonb_agg(
      (e.x - 'estado' - 'frase' - 'diferencia')
      || jsonb_build_object(
        'estado', e.estado,
        'estado_motor', e.x->>'estado',
        'comparado', case when e.glovo then jsonb_build_object('como', 'productos', 'vendido', e.v_prod, 'liquidacion', e.l_prod,
                                   'pedidos_nuestros', (e.x->'piezas'->'vendido'->'pedidos'->>'pedidos')::int, 'pedidos_liquidacion', e.ped_liq,
                                   'promociones_local', e.promos) end,
        'accion', case when e.estado in ('te_necesita', 'no_cuadra') then e.accion end,
        'cuando', case when e.estado = 'aun_no_toca' then e.x->>'plazo' end,
        'tiendas', e.tiendas,
        'sin_local', e.x->>'canal_id' is not null and e.x->>'local_id' is null,
        'grupo', case when e.cedida then 'cedida' else 'plataforma' end,
        'diferencia', case when e.estado = 'no_cuadra' then case when e.glovo then coalesce(e.dif_v, e.dif_c) else (e.x->>'diferencia')::numeric end end,
        'frase', case
          when e.estado = 'te_necesita' and e.accion = 'elige_local' then 'No sé de qué local es esta tienda: dímelo una vez y vale para todas sus liquidaciones. Mientras, se cuadra por tienda.'
          when e.estado = 'te_necesita' and e.accion = 'elige_marca' then 'No sé de qué marca es esta tienda: dímelo una vez y se compara con lo que vendió esa marca en ese local.'
          when e.estado = 'te_necesita' and e.accion = 'pidela' then 'No ha llegado su liquidación, y vendiste ' || public.conta_euros_exactos(coalesce((e.x->'piezas'->'vendido'->>'total')::numeric, 0))
               || coalesce(' en ' || ((e.x->'piezas'->'vendido'->'pedidos'->>'pedidos')) || ' pedidos', '') || '. La plataforma la manda al correo de esta tienda: pide que la reenvíen a tu buzón de Sumied.'
          when e.estado = 'te_necesita' and e.accion = 'subela' then 'Falta su factura de comisión, y ya tendría que haber llegado: súbela o pídesela a la plataforma.'
          when e.estado = 'te_necesita' and e.accion = 'mira_el_banco' then 'El cobro ya tendría que estar en el banco: ' || public.conta_euros_exactos(coalesce((e.x->'piezas'->'cobro'->>'esperado')::numeric, 0)) || '. Mira si ha llegado con otro concepto.'
          when e.estado = 'no_cuadra' and e.glovo and e.dif_v is not null then
               'Tus ' || coalesce((e.x->'piezas'->'vendido'->'pedidos'->>'pedidos'), '0') || ' pedidos suman ' || public.conta_euros_exactos(e.v_prod)
               || ' en productos a precio de carta y Glovo liquida ' || coalesce(e.ped_liq::text || ' pedidos por ', '') || public.conta_euros_exactos(e.l_prod) || ': '
               || case when e.dif_v > 0 then public.conta_euros_exactos(e.dif_v) || ' de menos.' else public.conta_euros_exactos(-e.dif_v) || ' de más.' end
               || case when e.ped_liq is not null and e.ped_liq <> coalesce((e.x->'piezas'->'vendido'->'pedidos'->>'pedidos')::int, 0)
                       then ' No coinciden los pedidos: mira cuáles faltan.' else ' Los pedidos coinciden: mira el precio de alguno.' end
          when e.estado = 'no_cuadra' and e.glovo then
               'Glovo dice que paga ' || public.conta_euros_exactos((e.x->'piezas'->'cobro'->>'esperado')::numeric) || ' y al banco llegaron '
               || public.conta_euros_exactos((e.x->'piezas'->'cobro'->>'llegado')::numeric) || '.'
          when e.estado = 'completa' and e.glovo and e.x->>'estado' <> 'cuadra' then 'Cuadra: lo vendido (por productos), la liquidación, su factura y el cobro.'
          when e.estado = 'aun_no_toca' then 'Aún no toca: hacia el ' || to_char((e.x->>'plazo')::date, 'DD/MM') || '. No tienes que hacer nada.'
          else e.x->>'frase'
        end)
      order by e.x->>'canal', e.x->>'local' nulls first, e.x->>'marca', e.x->>'desde'), '[]'::jsonb)
    into v_filas
    from e;

  -- Las marcas cedidas: una fila por socio, local y mes, con lo vendido de sus
  -- marcas (todos los canales) y la liquidación mensual del socio.
  with ag as (
    select a.brand_id, a.party_id from public.brand_licensing_agreement a
     where a.account_id = v_acc and coalesce(a.is_active, true) and a.archived_at is null
  ), v as (
    select ag.party_id, s.location_id, count(*) as pedidos, sum(s.total) as total,
           jsonb_agg(distinct b.name) as marcas
      from public.sale s join ag on ag.brand_id = s.brand_id
      join public.brand b on b.id = s.brand_id and b.account_id = v_acc
     where s.account_id = v_acc and s.status = 'closed' and coalesce(s.is_active, true)
       and (s.sold_at at time zone 'Europe/Madrid')::date between v_ini and v_fin
       and s.location_id in (select lc.location_id from public.location_company lc where lc.company_id = p_company
                             union select l.id from public.locations l where l.account_id = v_acc
                               and not exists (select 1 from public.location_company lc where lc.company_id = p_company))
     group by ag.party_id, s.location_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'socio_id', v.party_id, 'socio', p.name, 'local_id', v.location_id, 'local', l.name,
      'desde', v_ini, 'hasta', v_fin, 'marcas', v.marcas,
      'vendido', jsonb_build_object('pedidos', v.pedidos, 'total', round(v.total, 2)),
      'liquidacion', case when ls.id is not null then jsonb_build_object('id', ls.id, 'importe', coalesce(ls.amount, ls.net_settlement), 'confirmada', ls.confirmed_at is not null) end,
      'estado', case when ls.id is not null then 'completa' when v_hoy <= v_fin + 15 then 'aun_no_toca' else 'te_necesita' end,
      'cuando', case when ls.id is null and v_hoy <= v_fin + 15 then v_fin + 15 end,
      'frase', case when ls.id is not null then 'Se cuadra con la liquidación de ' || coalesce(p.name, 'su socio') || ' de este mes.'
                    when v_hoy <= v_fin + 15 then coalesce(p.name, 'Su socio') || ' liquida una vez al mes, por local: hacia el ' || to_char(v_fin + 15, 'DD/MM') || '. No tienes que hacer nada.'
                    else 'Falta la liquidación del mes de ' || coalesce(p.name, 'su socio') || ': pídesela.' end,
      'grupo', 'cedida')
      order by p.name, l.name), '[]'::jsonb)
    into v_cedidas
    from v left join public.party p on p.id = v.party_id and p.account_id = v_acc
    left join public.locations l on l.id = v.location_id and l.account_id = v_acc
    left join lateral (
      select x.* from public.licensed_settlement x
       where x.account_id = v_acc and (x.company_id is null or x.company_id = p_company)
         and x.location_id = v.location_id and (x.party_id is null or x.party_id = v.party_id)
         and x.period_from <= v_fin and x.period_to >= v_ini
       order by x.period_to desc limit 1) ls on true;

  return jsonb_build_object(
    'mes', v_ini, 'desde', v_ini, 'hasta', v_fin,
    'filas', (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(v_filas) f where f->>'grupo' = 'plataforma'),
    'cedidas', v_cedidas || (select coalesce(jsonb_agg(f), '[]'::jsonb) from jsonb_array_elements(v_filas) f where f->>'grupo' = 'cedida'),
    'resumen', (select jsonb_build_object(
        'total', count(*),
        'completa', count(*) filter (where f->>'estado' = 'completa'),
        'aun_no_toca', count(*) filter (where f->>'estado' = 'aun_no_toca'),
        'te_necesita', count(*) filter (where f->>'estado' = 'te_necesita'),
        'no_cuadra', count(*) filter (where f->>'estado' = 'no_cuadra'))
      from jsonb_array_elements(v_filas) f where f->>'grupo' = 'plataforma'));
end $$;
revoke all on function public.conta_liquidaciones_mes(uuid, date) from public, anon;
grant execute on function public.conta_liquidaciones_mes(uuid, date) to authenticated, service_role;
comment on function public.conta_liquidaciones_mes(uuid, date) is 'S01q · Las liquidaciones de un mes en cuatro estados (completa, aun_no_toca, te_necesita, no_cuadra), por tienda, con las marcas cedidas aparte (las liquida su socio).';
