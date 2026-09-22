-- ============================================================================
-- Casar por id, no por nombre — las consultas del parte del 22/09/2026
-- Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710. SOLO LECTURA.
-- Acompanan a claude/folvy_casar_por_id_medidas_20260922.md
-- ============================================================================

-- ── C1 · ¿Que rescata el id, y que rescata el nombre? ──────────────────────
-- La casilla A es la unica que mide el valor PROPIO de casar por id.
-- Medido el 22/09: A=0 lineas. El id no recupera nada hacia atras.
with l as (
  select sl.id, sl.external_product_id, coalesce(sl.product_name,sl.raw_text) as nombre,
         sl.line_total, s.brand_id
  from public.sale_line sl
  join public.sale s on s.id = sl.sale_id
  where sl.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and s.account_id  = '51ad1792-6629-4ef7-833a-b57b09a86710'   -- regla 9
    and s.source = 'lastapp'
    and sl.map_source = 'unmapped'
    and coalesce(sl.unmapped_reason,'') not in ('ignored','delisted')
    and s.sold_at >= now() - interval '30 days'
), m as (
  select l.*,
    (select count(*) from public.menu_item mi
      where mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and mi.external_source = 'lastapp' and mi.archived_at is null
        and mi.external_id = l.external_product_id) as n_id,
    (select count(*) from public.menu_item mi
      where mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and mi.archived_at is null and mi.brand_id = l.brand_id
        and lower(public.unaccent(mi.name)) = lower(public.unaccent(l.nombre))) as n_nom
  from l
)
select case when n_id>=1 and n_nom=0  then 'A · SOLO por id  (lo que aporta el arreglo)'
            when n_id>=1 and n_nom>=1 then 'B · por id y por nombre (el nombre ya bastaba)'
            when n_id=0  and n_nom>=1 then 'C · solo por nombre'
            else                           'D · por ninguna de las dos' end as via,
       count(*) as lineas, round(sum(line_total),2) as euros, count(distinct nombre) as productos
from m group by 1 order by 1;

-- ── C2 · ¿Cuanto de lo rescatable cae por DEBAJO del ultimo conteo? ────────
-- Lo que decide si el punto 3 es inocuo. Medido el 22/09: 553 de 553.
with corte as (
  select max(ic.closed_at) as c from public.inventory_count ic
   where ic.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and ic.status in ('aprobado','en_revision')
)
select to_char((select c from corte) at time zone 'Europe/Madrid','DD/MM/YY HH24:MI') as ultimo_conteo,
       count(*) filter (where s.sold_at <= (select c from corte)) as lineas_bajo_corte,
       round(sum(sl.line_total) filter (where s.sold_at <= (select c from corte)),2) as euros_bajo_corte,
       count(*) filter (where s.sold_at >  (select c from corte)) as lineas_sobre_corte,
       round(sum(sl.line_total) filter (where s.sold_at >  (select c from corte)),2) as euros_sobre_corte
from public.sale_line sl
join public.sale s on s.id = sl.sale_id
where sl.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
  and s.source = 'lastapp' and sl.map_source = 'unmapped'
  and coalesce(sl.unmapped_reason,'') not in ('ignored','delisted')
  and s.sold_at >= now() - interval '30 days';

-- ── C3 · Duplicados de carta, y si es seguro aflojar el normalizador ───────
-- Un grupo con fichas DISTINTAS no se puede resolver con un LIMIT 1.
-- Medido el 22/09: 43 grupos / 88 articulos; 28 seguros, 12 combos, 3 peligrosos.
with norm as (
  select mi.id, mi.name, mi.brand_id, b.name as marca, mi.recipe_item_id,
         mi.external_id, mi.is_active, mi.created_at,
         btrim(regexp_replace(regexp_replace(lower(public.unaccent(mi.name)),
               '[()\[\]]','','g'),'\s+',' ','g')) as n_suave
  from public.menu_item mi
  left join public.brand b on b.id = mi.brand_id
  where mi.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
    and mi.archived_at is null
),
g as (
  select marca, brand_id, n_suave, count(*) as arts,
         count(distinct recipe_item_id) as fichas,
         count(*) filter (where recipe_item_id is null) as sin_ficha
  from norm group by 1,2,3 having count(*) > 1
)
select g.marca, g.n_suave, g.arts, g.fichas,
       case when g.fichas >= 2 then 'PELIGROSO: fichas distintas'
            when g.fichas = 1 and g.sin_ficha = 0 then 'seguro: misma ficha'
            else 'combo / sin ficha propia' end as veredicto,
       -- coalesce OBLIGATORIO: sin el, un external_id nulo se come la fila entera
       -- del string_agg y la lista miente por omision (mordio el 22/09).
       (select string_agg(n.name||' ['||coalesce(n.external_id,'sin id')||' '
                          ||to_char(n.created_at at time zone 'Europe/Madrid','DD/MM')||']',
                          '  ||  ' order by n.created_at)
          from norm n where n.brand_id = g.brand_id and n.n_suave = g.n_suave) as articulos
from g order by (g.fichas >= 2) desc, g.marca, g.n_suave;

-- ── C4 · El disparador que bloquea el punto 3 ──────────────────────────────
-- Tocar menu_item_id ES mover stock. No hay recasado en frio sin desarmarlo.
select pg_get_triggerdef(t.oid) as def
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'sale_line'
  and not t.tgisinternal and t.tgname = 'trg_sale_line_consumption';
