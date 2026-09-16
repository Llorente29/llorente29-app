# El método del parte diario — las consultas, tal cual las usa la tarea de cada mañana

**Origen:** viene del proyecto de Claude, no del repositorio; lo pegó Julio el
16/09/2026 en respuesta al RECON (`claude/folvy_recon_parte_diario_almacen_20260916.md`).
Se guarda aquí porque **el repositorio es donde se lee**.

`AAAA-MM-DD` = el día del parte. Cuenta de referencia: Foodint
`51ad1792-6629-4ef7-833a-b57b09a86710`.

**Cómo se prueba `parte_del_dia` contra esto:** los dos, la función y el SQL de
aquí, **ejecutados en el mismo momento**, para el 15/09 y el 14/09. No contra
cifras congeladas: si se toca una ficha, las cifras se mueven (regla 31 — la
misma vara a los dos lados).

---

## 1 · Resumen y cuadre de almacén

```sql
with p as (select '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid acc, date 'AAAA-MM-DD' d),
s as (select s.* from sale s, p where s.account_id=p.acc and s.sold_at >= (p.d::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p.d+1)::timestamp at time zone 'Europe/Madrid')),
viva as (select * from s where coalesce(status,'')<>'cancelled' and coalesce(order_status,'') not in ('cancelled','rejected') and coalesce(is_active,true)),
esp as (select sl.sale_id, r.raw_item_id item, sum(r.qty_base) q from sale_line sl join viva v on v.id=sl.sale_id cross join lateral _sale_line_raw_consumption(sl.id) r
  where coalesce(sl.line_type,'product')='product' and sl.ignored_at is null and (sl.menu_item_id is not null or exists(select 1 from sale_line c where c.parent_sale_line_id=sl.id and c.line_type='combo_item')) group by 1,2 having sum(r.qty_base)<>0),
esc as (select m.source_id sale_id, m.recipe_item_id item, -sum(m.qty_base) q from stock_movement m join s on s.id=m.source_id where m.source_type='sale' and m.movement_type='consumo' group by 1,2),
skip as (select k.sale_id, k.recipe_item_id item from sale_consumption_skip k join s on s.id=k.sale_id),
cuadre as (select coalesce(e.sale_id,w.sale_id) sale_id, e.item e_item, w.item w_item, e.q eq, w.q wq, k.item k_item from esp e full join esc w on w.sale_id=e.sale_id and w.item=e.item left join skip k on k.sale_id=coalesce(e.sale_id,w.sale_id) and k.item=coalesce(e.item,w.item))
select
 (select count(*) from viva) pedidos, (select round(sum(total),2) from viva) importe,
 (select count(*) from s where id not in (select id from viva)) anulados,
 (select count(*) from cuadre where e_item is not null and w_item is not null and abs(eq-wq)<0.001) ok,
 (select count(*) from cuadre c where e_item is not null and w_item is null and k_item is null) faltan,
 (select count(*) from cuadre c where e_item is not null and w_item is null and k_item is not null) protegidos,
 (select count(*) from cuadre c where e_item is not null and w_item is not null and abs(eq-wq)>=0.001) cantidad_distinta,
 (select count(*) from cuadre c join viva v on v.id=c.sale_id where e_item is null) de_mas_en_vivas,
 (select count(*) from cuadre c where c.sale_id not in (select id from viva)) movs_en_anuladas;
```

**«Retenido» no calcula ningún corte.** Es el par (venta viva, artículo) que se
esperaba, sin movimiento, **y con fila en `sale_consumption_skip`** para esa
venta y ese artículo, con cualquier motivo. Se lee la nota que dejó el escritor,
no se recalcula la regla 6.

---

## 2 · Lo que no descuenta, con su causa

```sql
with p as (select '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid acc, date 'AAAA-MM-DD' d),
s as (select s.* from sale s, p where s.account_id=p.acc and s.sold_at >= (p.d::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p.d+1)::timestamp at time zone 'Europe/Madrid')
      and coalesce(s.status,'')<>'cancelled' and coalesce(s.order_status,'') not in ('cancelled','rejected') and coalesce(s.is_active,true)),
x as (
 select sl.*, s.source, s.brand_id sbrand, l.name loc, b.name marca, s.pos_short_code,
  exists(select 1 from sale_line c where c.parent_sale_line_id=sl.id and c.line_type='combo_item') is_combo,
  mi.name ficha, mi.recipe_item_id,
  case when mi.recipe_item_id is null then 0 else (select count(*) from explode_recipe_to_raws(mi.recipe_item_id,1)) end n_raws,
  (select mri.impact_type from modifier_recipe_impact mri where mri.modifier_option_id=sl.modifier_option_id and mri.status='confirmed' limit 1) imp
 from sale_line sl join s on s.id=sl.sale_id left join locations l on l.id=s.location_id left join brand b on b.id=s.brand_id left join menu_item mi on mi.id=sl.menu_item_id
 where sl.ignored_at is null),
y as (
 select x.*,
  case
   when line_type='product' and not is_combo and menu_item_id is null then
     case when external_product_id is null then 'SIN PLATO · la venta no trae código'
          when not exists(select 1 from menu_item m join p on m.account_id=p.acc where m.external_id=x.external_product_id and m.archived_at is null)
               and exists(select 1 from menu_item m join p on m.account_id=p.acc where m.external_id=x.external_product_id)
            then 'SIN PLATO · su código está en una ficha ARCHIVADA'
          when not exists(select 1 from menu_item m join p on m.account_id=p.acc where m.external_id=x.external_product_id)
            then 'SIN PLATO · no hay ficha con ese código'
          when (select count(*) from menu_item m join p on m.account_id=p.acc where m.external_source='lastapp' and m.external_id=x.external_product_id and m.archived_at is null)=1
               or exists(select 1 from menu_item m join p on m.account_id=p.acc where m.external_id=x.external_product_id and m.archived_at is null and m.brand_id=x.sbrand)
            then 'SIN PLATO · su código ya tiene ficha viva: se puede recuperar'
          else 'SIN PLATO · hay ficha viva con ese código, pero de otra marca o en varias' end
   when line_type in ('product','combo_item') and not is_combo and menu_item_id is null then 'COMPONENTE SIN PLATO'
   when line_type in ('product','combo_item') and not is_combo and recipe_item_id is null then 'FICHA SIN ARTÍCULO'
   when line_type in ('product','combo_item') and not is_combo and n_raws=0 then 'ARTÍCULO CON RECETA VACÍA'
   when line_type='modifier' and modifier_option_id is null then 'EXTRA SIN OPCIÓN'
   when line_type='modifier' and imp is null then 'EXTRA SIN DECIR QUÉ CONSUME'
  end causa
 from x)
select causa, loc, marca, source, product_name, coalesce(ficha,'') ficha, count(*) lineas, sum(quantity) uds, round(sum(line_total),2) eur, string_agg(distinct pos_short_code, ',') pedidos
from y where causa is not null group by 1,2,3,4,5,6 order by 1, eur desc nulls last;
```

**Nota:** el caso «hay ficha viva con ese código» sigue la misma regla que
`adapt_lastapp_order`: una sola ficha viva con ese código, o varias y una de
ellas de la marca del pedido.

---

## 2b · Cuánto descuenta

```sql
with p as (select '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid acc, date 'AAAA-MM-DD' d),
viva as (select s.* from sale s, p where s.account_id=p.acc and s.sold_at >= (p.d::timestamp at time zone 'Europe/Madrid') and s.sold_at < ((p.d+1)::timestamp at time zone 'Europe/Madrid')
         and coalesce(s.status,'')<>'cancelled' and coalesce(s.order_status,'') not in ('cancelled','rejected') and coalesce(s.is_active,true)),
lin as (select sl.*, exists(select 1 from sale_line c where c.parent_sale_line_id=sl.id and c.line_type='combo_item') is_combo,
   (select count(*) from menu_item mi cross join lateral explode_recipe_to_raws(mi.recipe_item_id,1) e where mi.id=sl.menu_item_id) n_raws
   from sale_line sl join viva v on v.id=sl.sale_id where sl.ignored_at is null and sl.line_type in ('product','combo_item'))
select sum(quantity) filter (where not is_combo) uds_total,
       sum(quantity) filter (where not is_combo and n_raws>0) uds_descuentan
from lin;
```

---

## 3 · Cedidas: Folvy contra Last

- **Folvy:** ventas `source='lastapp'` del día con `platform_order_code`,
  `pos_short_code`, `total`, `status`, `order_status`.
- **Last (Cube, zona Europe/Madrid):**
  - pedidos: `Tabs.total` (céntimos) por `Tabs.locationName`, `Tabs.name`,
    `Tabs.code`, `Tabs.brandName`, con `Tabs.activationTime` = el día;
  - anulados: `DeliveryOrderStatuses.cancelledCount > 0` por `tabName`,
    `tabCode`, `cancelTime`, `locationName`.
- **Se casa `Tabs.name` = `platform_order_code`.** Nunca por código corto.
- Referencia 15/09: Alcalá 40 / 821,43 €, Carabanchel 33 / 713,39 € (Kitchen
  Grill fuera). Anulados: J180 (no está en Folvy), G379 y G895.
- **Desde dentro, sin salir a la API:** `lastapp_webhook_log` con
  `note='frontera-tab-cancelled'`, casando `payload->'data'->>'name'` con
  `platform_order_code`.

---

## 4 · Propias: avisos de HubRise contra ventas

```sql
with p as (select '51ad1792-6629-4ef7-833a-b57b09a86710'::uuid acc,
  (date 'AAAA-MM-DD')::timestamp at time zone 'Europe/Madrid' ini, (date 'AAAA-MM-DD'+1)::timestamp at time zone 'Europe/Madrid' fin),
w as (select distinct payload->>'order_id' oid from external_webhook_log, p where source='hubrise' and note='frontera-order-create' and created_at >= p.ini and created_at < p.fin),
wu as (select payload->>'order_id' oid, (array_agg(payload->'new_state'->>'status' order by created_at desc))[1] ultimo from external_webhook_log, p where source='hubrise' and note='frontera-order-update' and created_at >= p.ini and created_at < p.fin + interval '6 hours' group by 1),
hs as (select s.* from sale s, p where s.account_id=p.acc and s.source='hubrise' and s.sold_at >= p.ini and s.sold_at < p.fin)
select
 (select count(*) from w) avisos_hubrise, (select count(*) from hs) ventas_hubrise,
 (select count(*) from w where not exists(select 1 from hs where hs.external_ref=w.oid)) avisos_sin_venta,
 (select count(*) from hs where not exists(select 1 from w where w.oid=hs.external_ref)) ventas_sin_aviso,
 (select string_agg(wu.oid, ',') from wu join hs on hs.external_ref=wu.oid where wu.ultimo in ('cancelled','rejected') and coalesce(hs.status,'')<>'cancelled') anuladas_hubrise_no_aplicadas;
```

El aviso de HubRise se casa por `payload->>'order_id'` contra
`sale.external_ref` (24 de 24 el 15/09).

---

## «En verde»

Se cumplen **todas**:

- `faltan` = 0 y las tres averías (cantidad distinta, de más en vivas, movimientos
  en anuladas) a 0;
- ningún anulado sin aplicar, ni de Last ni de HubRise;
- Folvy = Last en pedidos e importe;
- avisos = ventas en HubRise;
- ninguna línea en la comprobación 2, salvo la Heura.

---

## El corte del día

**Día natural de Madrid, de 00:00 a 24:00, por `sold_at`** (decisión de Julio,
16/09). El pie del parte lo dice.
