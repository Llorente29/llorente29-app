-- ============================================================================
-- Un componente de menú sin artículo no es una «ficha sin artículo» si Julio
-- ha decidido que su artículo lo pone el extra
-- ----------------------------------------------------------------------------
-- 27/09/2026. Encargo «un componente de menú a 0 € no es una ficha sin
-- artículo», de Julio, al decidir cómo descuenta el burrito de birria de Dos
-- Coyotes (opción A: la carne la pone el extra).
--
-- PROPUESTA, SIN APLICAR.
--
-- ENSAYADA el 27/09 ~16:00 (solo lectura, la clasificación con la misma
-- vara que la función, sobre 30 días de Foodint, 27/08–26/09):
--   · antes: 61 líneas «FICHA SIN ARTÍCULO» de 16 fichas;
--   · con solo el burrito: 7 líneas dejan de ser causa; 54 de 15 fichas igual;
--   · con el burrito y los 7 combos (lista definitiva, 27/09 ~17:30): 49
--     líneas dejan de ser causa (7 burrito + 42 combos) y 12 siguen como
--     «FICHA SIN ARTÍCULO» (PLATO Kebaba y Doble Scandal incluidas). La
--     guarda de la migración, con sus mismos filtros, deja pasar las 8;
--   · U645: 0 líneas; U645 sin su extra de ternera (simulado, sin tocar la
--     venta): «COMPONENTE SIN CARNE ELEGIDA».
-- El aviso `venta_producto_sin_casar` (sales_unmapped_watchdog) NO comparte
-- esta lógica: mira productos sin ficha, no fichas sin artículo. No se toca.
--
-- ── EL CASO, MEDIDO ────────────────────────────────────────────────────────
-- U645 (26/09, Alcalá, 40bdbea8-…):
--   MENÚ PA 1 (DC)                    product     ficha de9f41e6
--   ├ Burrito de birria (Dos Coyotes)  combo_item  ficha 97ac7a7e, SIN artículo
--   │ └ Racion BurritoTernera          modifier    af998219 → add_item confirmado
--   └ Coca Cola Zero                   combo_item  con artículo
-- Hoy `_parte_del_dia_raw(Foodint, null, 26/09)` devuelve una sola línea en
-- «no_descuenta»: esa ficha, como «FICHA SIN ARTÍCULO». Falso positivo.
--
-- ── POR QUÉ NO LA REGLA DEL ENCARGO TAL CUAL ─────────────────────────────
-- El encargo pedía callar la ficha sin artículo si ALGÚN extra del pedido
-- aporta artículo (add_item o bundle confirmado). Medido sobre 30 días
-- (27/08–26/09, Foodint): eso callaba 51 líneas, no 7. Las del burrito y las
-- de los combos que montan su contenido con extras, sí. Pero también:
--   · PLATO Kebaba de Ternera con patatas: el único extra que aporta es la
--     salsa yogur. La carne y las patatas no descuentan, y se callaba.
--   · Doble Scandal Bacon Cheezy Burger: el único es «Sí, con patatas». La
--     burger no descuenta, y se callaba.
-- Todos los grupos implicados son obligatorios (min 1) y `product_type` no
-- separa el burrito (item) del plato de kebab (item): ningún dato del catálogo
-- distingue «mi artículo lo pone el extra» de «a mi ficha le falta artículo».
-- Es una decisión por ficha, y la toma Julio (27/09: «marca por ficha»).
--
-- ── LO QUE HACE ───────────────────────────────────────────────────────────
-- 1. `menu_item_articulo_en_extra`: la lista de fichas cuyo artículo lo pone
--    un extra obligatorio, decidido a mano. Arranca con 8: el burrito de
--    birria de Dos Coyotes (97ac7a7e) y las 7 fichas de combo.
-- 2. En el parte, para una línea product/combo_item que no es combo y cuya
--    ficha no tiene artículo:
--      · ficha en la lista y el pedido trae un extra que aporta artículo
--        (impacto confirmado add_item o bundle) → NO es causa;
--      · ficha en la lista y el pedido NO lo trae →
--        «COMPONENTE SIN CARNE ELEGIDA»: se fue comida sin descontar;
--      · ficha fuera de la lista → «FICHA SIN ARTÍCULO», como siempre.
-- 3. El % de «descuenta» cuenta como que descuenta el primer caso, para que
--    el número y la causa no cuenten historias distintas (regla 7).
--
-- Burrito A Tu Manera y Keburger se quedan FUERA hasta que Julio los meta en
-- la lista: siguen saliendo como hasta hoy.
--
-- ── BANDA ─────────────────────────────────────────────────────────────────
-- La función del parte no está en el camino del pedido: la llama
-- `parte_del_dia`, a la que no llama nada (0 funciones, 0 crons, 0
-- disparadores, 0 usos en src/ ni supabase/functions); la lee la rutina del
-- parte a las 06:30. CREATE OR REPLACE de una función SQL: sin cierre.
-- PERO la tabla nueva lleva clave ajena a `menu_item`, y crearla toma SHARE
-- ROW EXCLUSIVE sobre `menu_item` mientras dura: frena las escrituras sobre
-- una tabla del catálogo que la ingesta puede tocar. La duda va a favor de
-- esperar: FUERA DE BANDA, después de las 00:30 (llega a tiempo para el parte
-- de las 06:30).
-- Misma firma (uuid, uuid, date) → jsonb: sin sobrecarga (regla 2).
-- ============================================================================

begin;

create table public.menu_item_articulo_en_extra (
  menu_item_id     uuid primary key references public.menu_item(id) on delete cascade,
  account_id       uuid not null references public.accounts(id) on delete cascade,
  decidido_at      timestamptz not null default now(),
  decidido_by_name text,
  nota             text
);

alter table public.menu_item_articulo_en_extra enable row level security;
create policy menu_item_articulo_en_extra_select on public.menu_item_articulo_en_extra
  for select using (public.belongs_to_account(account_id));

comment on table public.menu_item_articulo_en_extra is
  'Fichas cuyo artículo lo pone un extra obligatorio (la carne del burrito, la '
  'base de un «a tu manera»). Decidido a mano por Julio, ficha a ficha. El parte '
  'diario no las cuenta como «ficha sin artículo» si el pedido trae ese extra, y '
  'avisa «componente sin carne elegida» si no lo trae.';

-- Las fichas, por id (regla 9: por nombre hay homónimos, archivadas y vivas)
-- y comprobando que cada una es la que se cree: cuenta, nombre y sin artículo.
-- 1 burrito (27/09, opción A) + 7 fichas de combo (27/09, Julio: «mete también
-- los combos»). Medido: las 7 montan su contenido con extras obligatorios.
--   · Smash vivos (f3185ba5, 3f924443): hoy llegan como combo de verdad, con
--     sus componentes; no caen en esta rama. Quedan en la lista por si vuelven
--     a llegar con extras.
--   · Kebab Combo Individual (39c33485): vivo, llega con extras que aportan.
--   · Smash antiguos (489af7f1, 43b22f0d) y Mila's (63eb87b0, 85ebfa0e):
--     archivados; solo cuentan al rehacer el parte de días pasados.
insert into public.menu_item_articulo_en_extra (menu_item_id, account_id, decidido_by_name, nota)
select mi.id, mi.account_id, 'Julio', f.nota
  from (values
    ('97ac7a7e-c238-43bc-ae9e-ca50cadffe73'::uuid, 'Burrito de birria (Dos Coyotes).',
     'Opción A del 27/09: la carne la pone el extra «Escoge Tu Proteina Burrito - Dos Coyotes**».'),
    ('f3185ba5-ddd9-4818-a24c-8559f035dfed'::uuid, 'Combo Duo Smash',        'Combo: el contenido lo ponen sus extras (27/09).'),
    ('3f924443-b0b0-45ed-b704-06d71448ae75'::uuid, 'Combo Individual Smash', 'Combo: el contenido lo ponen sus extras (27/09).'),
    ('39c33485-b04a-4f08-8db2-97dafb2e0565'::uuid, 'Kebab Combo Individual', 'Combo: el contenido lo ponen sus extras (27/09).'),
    ('489af7f1-cb2e-4c45-9b1b-4a0a50fdbe27'::uuid, 'Combo Individual Smash', 'Combo (ficha archivada): el contenido lo ponían sus extras (27/09).'),
    ('43b22f0d-f02b-489b-9350-e07df15ceb84'::uuid, 'Combo Duo Smash',        'Combo (ficha archivada): el contenido lo ponían sus extras (27/09).'),
    ('63eb87b0-96f2-40d7-bc29-8e3daf1cd5d5'::uuid, 'Combo Individual',       'Combo (ficha archivada): el contenido lo ponían sus extras (27/09).'),
    ('85ebfa0e-cd6d-4ca6-b650-fabd2aa8b96f'::uuid, 'Combo Doble',            'Combo (ficha archivada): el contenido lo ponían sus extras (27/09).')
  ) as f(id, nombre, nota)
  join public.menu_item mi on mi.id = f.id
 where mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and mi.name = f.nombre
   and mi.recipe_item_id is null;

do $$
begin
  if (select count(*) from public.menu_item_articulo_en_extra) <> 8 then
    raise exception 'alguna ficha no es la esperada (esperaba 8): no se aplica nada';
  end if;
end
$$;

CREATE OR REPLACE FUNCTION public._parte_del_dia_raw(p_account_id uuid, p_location_id uuid DEFAULT NULL::uuid, p_dia date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
x as (
  select sl.*, vv.source, vv.brand_id as sbrand, vv.location_id as sloc, vv.pos_short_code,
         l.name as loc_nombre, b.name as marca,
         exists (select 1 from sale_line c
                  where c.parent_sale_line_id = sl.id and c.line_type = 'combo_item') as is_combo,
         mi.name as ficha, mi.recipe_item_id,
         case when mi.recipe_item_id is null then 0
              else (select count(*) from public.explode_recipe_to_raws(mi.recipe_item_id, 1)) end as n_raws,
         (select mri.impact_type from modifier_recipe_impact mri
           where mri.modifier_option_id = sl.modifier_option_id and mri.status = 'confirmed' limit 1) as imp,
         -- (27/09) Julio ha decidido que el artículo de esta ficha lo pone un
         -- extra (menu_item_articulo_en_extra).
         exists (select 1 from menu_item_articulo_en_extra ae
                  where ae.menu_item_id = sl.menu_item_id) as espera_extra,
         -- (27/09) Y el pedido trae un extra que pone artículo: impacto
         -- confirmado add_item o bundle.
         exists (select 1 from sale_line ch
                   join modifier_recipe_impact mri on mri.modifier_option_id = ch.modifier_option_id
                  where ch.parent_sale_line_id = sl.id
                    and ch.line_type = 'modifier'
                    and ch.ignored_at is null
                    and mri.status = 'confirmed'
                    and mri.impact_type in ('add_item','bundle')) as aporta_extra
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
     -- (27/09) El artículo lo pone el extra, y el pedido lo trae: no falta nada.
     when line_type in ('product','combo_item') and not is_combo and recipe_item_id is null
          and espera_extra and aporta_extra then null
     -- (27/09) El artículo lo pone el extra, y el pedido llegó sin él.
     when line_type in ('product','combo_item') and not is_combo and recipe_item_id is null
          and espera_extra then 'COMPONENTE SIN CARNE ELEGIDA'
     when line_type in ('product','combo_item') and not is_combo and recipe_item_id is null then 'FICHA SIN ARTÍCULO'
     when line_type in ('product','combo_item') and not is_combo and n_raws = 0 then 'ARTÍCULO CON RECETA VACÍA'
     when line_type = 'modifier' and modifier_option_id is null then 'EXTRA SIN OPCIÓN'
     when line_type = 'modifier' and imp is null then 'EXTRA SIN DECIR QUÉ CONSUME'
    end as causa
  from x
),
arreglar as (
  select y.causa, y.loc_nombre, y.marca, y.source, y.product_name, coalesce(y.ficha,'') as ficha,
         count(*) as lineas, sum(y.quantity) as uds, round(coalesce(sum(y.line_total),0),2) as eur,
         array_agg(distinct y.pos_short_code) as pedidos
  from y where y.causa is not null
  group by 1,2,3,4,5,6
),
platos as (
  -- (27/09) Un componente cuyo artículo lo pone el extra también descuenta.
  select y.quantity, y.is_combo,
         (y.n_raws > 0 or (y.recipe_item_id is null and y.espera_extra and y.aporta_extra)) as descuenta
  from y where y.line_type in ('product','combo_item')
),
extras as (
  select y.quantity, (y.modifier_option_id is not null and y.imp is not null) as descuenta
  from y where y.line_type = 'modifier'
),
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
ref as (
  select m.source_id as sale_id, max(m.created_at) as ultimo_mov
  from stock_movement m join s on s.id = m.source_id
  where m.source_type = 'sale' and m.movement_type = 'consumo'
  group by 1
),
tocado as (
  select sl.sale_id,
         coalesce(mi.name, sl.product_name) as nombre,
         t.cual, t.ts
  from sale_line sl
  join viva vv on vv.id = sl.sale_id
  left join ref rf on rf.sale_id = sl.sale_id
  left join menu_item mi on mi.id = sl.menu_item_id
  left join modifier_recipe_impact mri
         on mri.modifier_option_id = sl.modifier_option_id and mri.status = 'confirmed'
  cross join lateral (values ('ficha', mi.updated_at),
                            ('extra', mri.updated_at)) t(cual, ts)
  where sl.ignored_at is null
    and t.ts is not null
    and t.ts > coalesce(rf.ultimo_mov, vv.created_at)
),
descuadre as (
  select c.sale_id, c.e_item, c.w_item, c.eq, c.wq,
         vv.pos_short_code, vv.total, vv.location_id,
         (exists (select 1 from tocado t where t.sale_id = c.sale_id)
          or coalesce((select ri.updated_at > coalesce(rf.ultimo_mov, vv.created_at)
                         from recipe_item ri where ri.id = c.e_item), false)) as recuperable
  from cuadre c
  join viva vv on vv.id = c.sale_id
  left join ref rf on rf.sale_id = c.sale_id
  where c.e_item is not null
    and c.k_item is null
    and (c.w_item is null or abs(c.eq - c.wq) >= 0.001)
),
por_pedido as (
  select d.sale_id, d.pos_short_code, d.total, d.location_id, d.recuperable,
         count(*) as pares,
         array_agg(distinct ri.name) filter (where ri.name is not null) as articulos
  from descuadre d left join recipe_item ri on ri.id = d.e_item
  group by 1,2,3,4,5
),
n as (
  select
    (select count(*) from cuadre where e_item is not null and w_item is null and k_item is null) as faltan,
    (select count(*) from cuadre where e_item is not null and w_item is not null and abs(eq-wq) >= 0.001) as cantidad_distinta,
    (select count(*) from cuadre c join viva vv on vv.id = c.sale_id where c.e_item is null) as de_mas_en_vivas,
    (select count(*) from cuadre where sale_id not in (select id from viva)) as movs_en_anuladas,
    (select count(*) from last_vivas_anuladas) as last_sin_anular,
    (select count(*) from hub_vivas_anuladas) as hub_sin_anular,
    (select count(*) from arreglar) as lineas_por_arreglar,
    (select count(*) from descuadre where recuperable) as descuadres_recuperables,
    (select count(*) from descuadre where not recuperable) as descuadres_averia
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
    'movs_en_anuladas',  (select movs_en_anuladas from n),
    'se_puede_recuperar',(select descuadres_recuperables from n),
    'averia',            (select descuadres_averia from n)
  ),
  'recuperar', (select coalesce(jsonb_agg(jsonb_build_object(
        'venta_id', pp.sale_id, 'pedido', pp.pos_short_code, 'local', l.name,
        'importe', pp.total, 'articulos_sin_descontar', pp.pares,
        'que_se_toco_despues', (select coalesce(jsonb_agg(distinct z.txt), '[]'::jsonb) from (
              select t.nombre || ' · ' || t.cual || ' (' || to_char(t.ts at time zone 'Europe/Madrid','DD/MM HH24:MI') || ')' as txt
                from tocado t where t.sale_id = pp.sale_id
              union
              select ri.name || ' · artículo (' || to_char(ri.updated_at at time zone 'Europe/Madrid','DD/MM HH24:MI') || ')'
                from descuadre d2
                join recipe_item ri on ri.id = d2.e_item
                left join ref rf2 on rf2.sale_id = d2.sale_id
                join viva v2 on v2.id = d2.sale_id
               where d2.sale_id = pp.sale_id
                 and ri.updated_at > coalesce(rf2.ultimo_mov, v2.created_at)) z),
        'articulos', to_jsonb(pp.articulos),
        'frase', 'Se puede recuperar: la ficha se arregló después de la venta.'
      ) order by pp.total desc), '[]'::jsonb)
    from por_pedido pp left join locations l on l.id = pp.location_id
    where pp.recuperable),
  'averias', (select coalesce(jsonb_agg(jsonb_build_object(
        'venta_id', pp.sale_id, 'pedido', pp.pos_short_code, 'local', l.name,
        'importe', pp.total, 'articulos_sin_descontar', pp.pares,
        'articulos', to_jsonb(pp.articulos),
        'frase', 'Debía descontar y no lo hizo. Nada cambió después: esto hay que mirarlo.'
      ) order by pp.total desc), '[]'::jsonb)
    from por_pedido pp left join locations l on l.id = pp.location_id
    where not pp.recuperable),
  'no_descuenta', (select coalesce(jsonb_agg(jsonb_build_object(
        'causa', a.causa,
        'frase', case a.causa
          when 'SIN PLATO · la venta no trae código'                                  then 'La venta llega sin el código del plato, así que no hay nada que descontar.'
          when 'SIN PLATO · su código está en una ficha ARCHIVADA'                     then 'Este plato llega con un código que está en una ficha archivada.'
          when 'SIN PLATO · no hay ficha con ese código'                               then 'No hay ninguna ficha con el código que trae la venta.'
          when 'SIN PLATO · su código ya tiene ficha viva: se puede recuperar'         then 'Ya hay una ficha viva con ese código: lo de este día se puede recuperar.'
          when 'SIN PLATO · hay ficha viva con ese código, pero de otra marca o en varias' then 'Hay una ficha viva con ese código, pero es de otra marca o está repetida en varias.'
          when 'COMPONENTE SIN PLATO'                                                  then 'Este trozo del menú no tiene ficha, así que no descuenta nada.'
          when 'COMPONENTE SIN CARNE ELEGIDA'                                          then 'Este trozo del menú saca su artículo de un extra obligatorio (la carne, la base), y el pedido llegó sin elegirlo: se ha ido comida sin descontar.'
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
    'uds_descuentan', (select coalesce(sum(quantity),0) from platos where not is_combo and descuenta),
    'pct',            (select case when coalesce(sum(quantity),0) = 0 then null
                             else round(100.0 * coalesce(sum(quantity) filter (where descuenta),0)
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
  'en_verde', (select faltan = 0 and cantidad_distinta = 0 and de_mas_en_vivas = 0
                  and movs_en_anuladas = 0 and last_sin_anular = 0 and hub_sin_anular = 0
                  and lineas_por_arreglar = 0 from n),
  'no_puede_ver', jsonb_build_array(
    'Las cedidas: solo se comparan con los avisos recibidos de Last, todavía no con el listado del día.',
    'HubRise: solo comparado con los avisos recibidos.',
    'Lo que sale como «se puede recuperar» se decide por si se tocó la ficha o el extra del pedido, o el artículo que falta. Una ficha tocada por otra razón puede colarse: por eso se enseñan todas las tocadas y se ve cuál manda.')
)
$function$;

commit;
