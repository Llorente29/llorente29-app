-- ============================================================================
-- EL PARTE DEL DÍA — §3.1 del encargo del 16/09. SOLO LECTURA.
--
-- Responde, para una cuenta, un local (o todos) y un día: qué se vendió, si
-- cuadra con el almacén, qué no descontó y por qué, cuánto descuenta y cómo va
-- el cruce con las plataformas.
--
-- DOS PIEZAS, como el par que ya existe (sales_unmapped_products /
-- _sales_unmapped_products_raw):
--   · _parte_del_dia_raw  — el cuerpo, SIN guarda. Lo llama el cron del aviso
--                           de las 08:30, que no tiene sesión de usuario.
--   · parte_del_dia       — guarda de cuenta + llamada al cuerpo. Es la que
--                           llama la pantalla.
--
-- DECISIONES, todas de Julio (16/09), para que nadie tenga que adivinarlas:
--   · Día natural de Madrid, de 00:00 a 24:00, por `sold_at`.
--   · «Retenido» NO recalcula la regla 6: es el par (venta viva, artículo) que
--     se esperaba, sin movimiento, y CON fila en `sale_consumption_skip`. Se
--     lee la nota que dejó el escritor; el corte vive en
--     generate_sale_consumption y en ningún sitio más.
--   · Cedida = venta de Last; propia = venta de HubRise.
--   · El cruce con las plataformas se hace DESDE DENTRO, con lo que ya está en
--     la base: `lastapp_webhook_log` (tab:cancelled) para las cedidas y
--     `external_webhook_log` (frontera-order-create / -update) para las
--     propias. No se llama a ninguna API desde aquí. El listado del día —lo
--     único que ve un pedido cuyo aviso nunca llegó— lo traerá la pasada
--     diaria del §3.3; mientras no esté, el parte lo dice en `no_puede_ver`.
--
-- MEDIDO ANTES DE APLICAR (banda de CLAUDE.md y §6 del encargo):
--   · Hora de la base al aplicar: 16/09 ~11:15 de Madrid — FUERA de la banda
--     (12:15–23:45), así que ni siquiera hacía falta la excepción.
--   · No está en el camino del pedido: función NUEVA. Cero funciones que la
--     llamen (pg_proc), cero crons (cron.job), cero disparadores (pg_trigger).
--   · No toma cierre sobre ninguna tabla: es `create function`, nada más.
--
-- LO QUE NO ESTÁ AQUÍ y va en su paso: la tabla `parte_plataformas` y su
-- pasada diaria (§3.3), el reproceso ampliado (§3.2), el aviso (§3.4), la foto
-- histórica (§3.5) y la pantalla (§4).
-- ============================================================================

create or replace function public._parte_del_dia_raw(
  p_account_id  uuid,
  p_location_id uuid default null,
  p_dia         date default null
) returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with r as (
  select p_account_id as acc,
         p_location_id as loc,
         coalesce(p_dia, ((now() at time zone 'Europe/Madrid')::date - 1)) as d
),
v as (
  select acc, loc, d,
         (d::timestamp at time zone 'Europe/Madrid')     as ini,
         ((d+1)::timestamp at time zone 'Europe/Madrid') as fin
  from r
),
-- Todas las ventas del día, vivas y anuladas.
s as (
  select sa.* from sale sa, v
  where sa.account_id = v.acc
    and sa.sold_at >= v.ini and sa.sold_at < v.fin
    and (v.loc is null or sa.location_id = v.loc)
),
viva as (
  select * from s
  where coalesce(status,'') <> 'cancelled'
    and coalesce(order_status,'') not in ('cancelled','rejected')
    and coalesce(is_active, true)
),
-- ── Cuadre: lo que DEBÍA restar contra lo que SE RESTÓ ──────────────────────
esp as (
  select sl.sale_id, x.raw_item_id as item, sum(x.qty_base) as q
  from sale_line sl
  join viva vv on vv.id = sl.sale_id
  cross join lateral public._sale_line_raw_consumption(sl.id) x
  where coalesce(sl.line_type,'product') = 'product'
    and sl.ignored_at is null
    and (sl.menu_item_id is not null
         or exists (select 1 from sale_line c
                     where c.parent_sale_line_id = sl.id and c.line_type = 'combo_item'))
  group by 1,2
  having sum(x.qty_base) <> 0
),
esc as (
  select m.source_id as sale_id, m.recipe_item_id as item, -sum(m.qty_base) as q
  from stock_movement m join s on s.id = m.source_id
  where m.source_type = 'sale' and m.movement_type = 'consumo'
  group by 1,2
),
nota as (
  select k.sale_id, k.recipe_item_id as item from sale_consumption_skip k join s on s.id = k.sale_id
),
cuadre as (
  select coalesce(e.sale_id, w.sale_id) as sale_id,
         e.item as e_item, w.item as w_item, e.q as eq, w.q as wq, k.item as k_item
  from esp e
  full join esc w on w.sale_id = e.sale_id and w.item = e.item
  left join nota k on k.sale_id = coalesce(e.sale_id, w.sale_id)
                  and k.item    = coalesce(e.item, w.item)
),
-- ── Lo que no descuenta, con su causa ──────────────────────────────────────
x as (
  select sl.*, vv.source, vv.brand_id as sbrand, vv.location_id as sloc, vv.pos_short_code,
         l.name as loc_nombre, b.name as marca,
         exists (select 1 from sale_line c
                  where c.parent_sale_line_id = sl.id and c.line_type = 'combo_item') as is_combo,
         mi.name as ficha, mi.recipe_item_id,
         case when mi.recipe_item_id is null then 0
              else (select count(*) from public.explode_recipe_to_raws(mi.recipe_item_id, 1)) end as n_raws,
         (select mri.impact_type from modifier_recipe_impact mri
           where mri.modifier_option_id = sl.modifier_option_id and mri.status = 'confirmed' limit 1) as imp
  from sale_line sl
  join viva vv on vv.id = sl.sale_id
  left join locations l on l.id = vv.location_id
  left join brand     b on b.id = vv.brand_id
  left join menu_item mi on mi.id = sl.menu_item_id
  where sl.ignored_at is null
),
y as (
  select x.*,
    case
     when line_type = 'product' and not is_combo and menu_item_id is null then
       case
         when external_product_id is null then 'SIN PLATO · la venta no trae código'
         when not exists (select 1 from menu_item m where m.account_id = (select acc from r)
                            and m.external_id = x.external_product_id and m.archived_at is null)
              and exists (select 1 from menu_item m where m.account_id = (select acc from r)
                            and m.external_id = x.external_product_id)
           then 'SIN PLATO · su código está en una ficha ARCHIVADA'
         when not exists (select 1 from menu_item m where m.account_id = (select acc from r)
                            and m.external_id = x.external_product_id)
           then 'SIN PLATO · no hay ficha con ese código'
         when (select count(*) from menu_item m where m.account_id = (select acc from r)
                 and m.external_source = 'lastapp' and m.external_id = x.external_product_id
                 and m.archived_at is null) = 1
              or exists (select 1 from menu_item m where m.account_id = (select acc from r)
                           and m.external_id = x.external_product_id and m.archived_at is null
                           and m.brand_id = x.sbrand)
           then 'SIN PLATO · su código ya tiene ficha viva: se puede recuperar'
         else 'SIN PLATO · hay ficha viva con ese código, pero de otra marca o en varias'
       end
     when line_type in ('product','combo_item') and not is_combo and menu_item_id is null then 'COMPONENTE SIN PLATO'
     when line_type in ('product','combo_item') and not is_combo and recipe_item_id is null then 'FICHA SIN ARTÍCULO'
     when line_type in ('product','combo_item') and not is_combo and n_raws = 0 then 'ARTÍCULO CON RECETA VACÍA'
     when line_type = 'modifier' and modifier_option_id is null then 'EXTRA SIN OPCIÓN'
     when line_type = 'modifier' and imp is null then 'EXTRA SIN DECIR QUÉ CONSUME'
    end as causa
  from x
),
-- Una fila por plato + local + marca, ordenadas por dinero.
arreglar as (
  select y.causa, y.loc_nombre, y.marca, y.source, y.product_name, coalesce(y.ficha,'') as ficha,
         count(*) as lineas, sum(y.quantity) as uds, round(coalesce(sum(y.line_total),0),2) as eur,
         array_agg(distinct y.pos_short_code) as pedidos
  from y where y.causa is not null
  group by 1,2,3,4,5,6
),
-- ── Cuánto descuenta ───────────────────────────────────────────────────────
platos as (
  select y.quantity, y.is_combo, y.n_raws
  from y where y.line_type in ('product','combo_item')
),
extras as (
  select y.quantity, (y.modifier_option_id is not null and y.imp is not null) as descuenta
  from y where y.line_type = 'modifier'
),
-- ── Cedidas: anulado en Last y vivo en Folvy, visto desde dentro ────────────
canceladas_last as (
  select distinct wl.payload->'data'->>'name' as code
  from lastapp_webhook_log wl, v
  where wl.note = 'frontera-tab-cancelled'
    and wl.received_at >= v.ini and wl.received_at < v.fin + interval '2 days'
),
last_vivas_anuladas as (
  select vv.id, vv.pos_short_code, vv.platform_order_code, vv.total, l.name as loc_nombre
  from viva vv
  join canceladas_last c on c.code = vv.platform_order_code
  left join locations l on l.id = vv.location_id
  where vv.source = 'lastapp'
),
-- ── Propias: avisos de HubRise contra ventas ────────────────────────────────
hub_avisos as (
  select distinct ew.payload->>'order_id' as oid
  from external_webhook_log ew, v
  where ew.source = 'hubrise' and ew.note = 'frontera-order-create'
    and ew.created_at >= v.ini and ew.created_at < v.fin
),
hub_estado as (
  select ew.payload->>'order_id' as oid,
         (array_agg(ew.payload->'new_state'->>'status' order by ew.created_at desc))[1] as ultimo
  from external_webhook_log ew, v
  where ew.source = 'hubrise' and ew.note = 'frontera-order-update'
    and ew.created_at >= v.ini and ew.created_at < v.fin + interval '6 hours'
  group by 1
),
hub_ventas as (select * from s where source = 'hubrise'),
hub_vivas_anuladas as (
  select hv.id, hv.pos_short_code, hv.external_ref, hv.total, l.name as loc_nombre
  from hub_estado he
  join hub_ventas hv on hv.external_ref = he.oid
  left join locations l on l.id = hv.location_id
  where he.ultimo in ('cancelled','rejected') and coalesce(hv.status,'') <> 'cancelled'
),
-- ── Los números que deciden el verde ───────────────────────────────────────
n as (
  select
    (select count(*) from cuadre where e_item is not null and w_item is null and k_item is null) as faltan,
    (select count(*) from cuadre where e_item is not null and w_item is not null and abs(eq-wq) >= 0.001) as cantidad_distinta,
    (select count(*) from cuadre c join viva vv on vv.id = c.sale_id where c.e_item is null) as de_mas_en_vivas,
    (select count(*) from cuadre where sale_id not in (select id from viva)) as movs_en_anuladas,
    (select count(*) from last_vivas_anuladas) as last_sin_anular,
    (select count(*) from hub_vivas_anuladas) as hub_sin_anular,
    (select count(*) from arreglar) as lineas_por_arreglar
)
select jsonb_build_object(
  'dia',            (select d from r),
  'cuenta_id',      (select acc from r),
  'local_id',       (select loc from r),
  'generado',       now(),
  'corte_del_dia',  'día natural de Madrid, de 00:00 a 24:00, por sold_at',

  'vendido', jsonb_build_object(
    'pedidos',         (select count(*) from viva),
    'importe',         (select round(coalesce(sum(total),0),2) from viva),
    'anulados',        (select count(*) from s where id not in (select id from viva)),
    'importe_anulado', (select round(coalesce(sum(total),0),2) from s where id not in (select id from viva)),
    'por_local', (select coalesce(jsonb_agg(jsonb_build_object(
                          'local_id', z.location_id, 'local', z.nombre,
                          'pedidos', z.n, 'importe', z.imp) order by z.imp desc), '[]'::jsonb)
                  from (select vv.location_id, max(l.name) as nombre, count(*) as n,
                               round(coalesce(sum(vv.total),0),2) as imp
                        from viva vv left join locations l on l.id = vv.location_id
                        group by vv.location_id) z),
    'por_canal', (select coalesce(jsonb_agg(jsonb_build_object(
                          'canal', z.canal, 'pedidos', z.n, 'importe', z.imp) order by z.imp desc), '[]'::jsonb)
                  from (select coalesce(c.name, vv.external_channel_text, 'sin canal') as canal,
                               count(*) as n, round(coalesce(sum(vv.total),0),2) as imp
                        from viva vv left join sales_channel c on c.id = vv.channel_id
                        group by 1) z),
    'por_marca', (select coalesce(jsonb_agg(jsonb_build_object(
                          'marca_id', z.brand_id, 'marca', z.marca, 'tipo', z.tipo,
                          'pedidos', z.n, 'importe', z.imp) order by z.imp desc), '[]'::jsonb)
                  from (select vv.brand_id, coalesce(max(b.name),'sin marca') as marca,
                               case when vv.source = 'lastapp' then 'cedida' else 'propia' end as tipo,
                               count(*) as n, round(coalesce(sum(vv.total),0),2) as imp
                        from viva vv left join brand b on b.id = vv.brand_id
                        group by vv.brand_id, 3) z)
  ),

  'cuadre_almacen', jsonb_build_object(
    'bien',              (select count(*) from cuadre where e_item is not null and w_item is not null and abs(eq-wq) < 0.001),
    'faltan',            (select faltan from n),
    'retenidos',         (select count(*) from cuadre where e_item is not null and w_item is null and k_item is not null),
    'cantidad_distinta', (select cantidad_distinta from n),
    'de_mas_en_vivas',   (select de_mas_en_vivas from n),
    'movs_en_anuladas',  (select movs_en_anuladas from n)
  ),

  'no_descuenta', (select coalesce(jsonb_agg(jsonb_build_object(
        'causa', a.causa,
        'frase', case a.causa
          when 'SIN PLATO · la venta no trae código'                                  then 'La venta llega sin el código del plato, así que no hay nada que descontar.'
          when 'SIN PLATO · su código está en una ficha ARCHIVADA'                     then 'Este plato llega con un código que está en una ficha archivada.'
          when 'SIN PLATO · no hay ficha con ese código'                               then 'No hay ninguna ficha con el código que trae la venta.'
          when 'SIN PLATO · su código ya tiene ficha viva: se puede recuperar'         then 'Ya hay una ficha viva con ese código: lo de este día se puede recuperar.'
          when 'SIN PLATO · hay ficha viva con ese código, pero de otra marca o en varias' then 'Hay una ficha viva con ese código, pero es de otra marca o está repetida en varias.'
          when 'COMPONENTE SIN PLATO'                                                  then 'Este trozo del menú no tiene ficha, así que no descuenta nada.'
          when 'FICHA SIN ARTÍCULO'                                                    then 'La ficha existe, pero no dice de qué artículo es.'
          when 'ARTÍCULO CON RECETA VACÍA'                                             then 'El artículo no tiene receta: no sabemos de qué está hecho.'
          when 'EXTRA SIN OPCIÓN'                                                      then 'Este extra llega sin opción, así que no se sabe qué es.'
          when 'EXTRA SIN DECIR QUÉ CONSUME'                                           then 'Este extra no dice qué descuenta del almacén.'
        end,
        'plato', a.product_name, 'ficha', a.ficha,
        'local', a.loc_nombre, 'marca', a.marca,
        'tipo_marca', case when a.source = 'lastapp' then 'cedida' else 'propia' end,
        'lineas', a.lineas, 'uds', a.uds, 'eur', a.eur,
        'pedidos', to_jsonb(a.pedidos)) order by a.eur desc nulls last), '[]'::jsonb)
      from arreglar a),

  'descuenta', jsonb_build_object(
    'uds_total',      (select coalesce(sum(quantity),0) from platos where not is_combo),
    'uds_descuentan', (select coalesce(sum(quantity),0) from platos where not is_combo and n_raws > 0),
    'pct',            (select case when coalesce(sum(quantity),0) = 0 then null
                             else round(100.0 * coalesce(sum(quantity) filter (where n_raws > 0),0)
                                              / sum(quantity), 1) end
                      from platos where not is_combo),
    'extras', jsonb_build_object(
      'uds_total',      (select coalesce(sum(quantity),0) from extras),
      'uds_descuentan', (select coalesce(sum(quantity) filter (where descuenta),0) from extras))
  ),

  'plataformas', jsonb_build_object(
    'origen', 'los avisos que ya están en la base; el listado del día todavía no',
    'cedidas', jsonb_build_object(
      'pedidos', (select count(*) from viva where source = 'lastapp'),
      'importe', (select round(coalesce(sum(total),0),2) from viva where source = 'lastapp'),
      'anulados_en_plataforma_y_vivos_aqui',
        (select coalesce(jsonb_agg(jsonb_build_object(
            'venta_id', t.id, 'pedido', t.pos_short_code, 'codigo', t.platform_order_code,
            'local', t.loc_nombre, 'importe', t.total) order by t.total desc), '[]'::jsonb)
         from last_vivas_anuladas t)),
    'propias', jsonb_build_object(
      'pedidos',          (select count(*) from viva where source = 'hubrise'),
      'importe',          (select round(coalesce(sum(total),0),2) from viva where source = 'hubrise'),
      'avisos',           (select count(*) from hub_avisos),
      'ventas',           (select count(*) from hub_ventas),
      'avisos_sin_venta', (select count(*) from hub_avisos a where not exists (select 1 from hub_ventas h where h.external_ref = a.oid)),
      'ventas_sin_aviso', (select count(*) from hub_ventas h where not exists (select 1 from hub_avisos a where a.oid = h.external_ref)),
      'anulados_en_plataforma_y_vivos_aqui',
        (select coalesce(jsonb_agg(jsonb_build_object(
            'venta_id', t.id, 'pedido', t.pos_short_code, 'codigo', t.external_ref,
            'local', t.loc_nombre, 'importe', t.total) order by t.total desc), '[]'::jsonb)
         from hub_vivas_anuladas t))
  ),

  'por_arreglar', (select lineas_por_arreglar + last_sin_anular + hub_sin_anular from n),

  -- El verde es honesto: dice que está limpio TODO lo que el parte puede ver, y
  -- al lado va siempre lo que no puede ver (regla 7 — un umbral ordena, no
  -- esconde; aquí: un verde no puede callar su propio alcance).
  'en_verde', (select faltan = 0 and cantidad_distinta = 0 and de_mas_en_vivas = 0
                  and movs_en_anuladas = 0 and last_sin_anular = 0 and hub_sin_anular = 0
                  and lineas_por_arreglar = 0 from n),

  'no_puede_ver', jsonb_build_array(
    'Las cedidas: solo se comparan con los avisos recibidos de Last, todavía no con el listado del día.',
    'HubRise: solo comparado con los avisos recibidos.')
)
$fn$;

comment on function public._parte_del_dia_raw(uuid, uuid, date) is
'El cuerpo del parte del día, SIN guarda de cuenta: para el cron del aviso de las 08:30, que no tiene sesión. La pantalla llama a parte_del_dia. Encargo del 16/09 §3.1.';

create or replace function public.parte_del_dia(
  p_account_id  uuid,
  p_location_id uuid default null,
  p_dia         date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'parte_del_dia: sin acceso a la cuenta %', p_account_id;
  end if;
  return public._parte_del_dia_raw(p_account_id, p_location_id, p_dia);
end;
$fn$;

comment on function public.parte_del_dia(uuid, uuid, date) is
'El parte del día: lo vendido, si cuadra con el almacén, qué no descontó y por qué, y el cruce con las plataformas. Día natural de Madrid por sold_at. Encargo del 16/09 §3.1.';

revoke all on function public._parte_del_dia_raw(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public._parte_del_dia_raw(uuid, uuid, date) to service_role;

revoke all on function public.parte_del_dia(uuid, uuid, date) from public, anon;
grant execute on function public.parte_del_dia(uuid, uuid, date) to authenticated, service_role;
