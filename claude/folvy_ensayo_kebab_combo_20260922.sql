-- ============================================================================
-- ENSAYO POR CAMINOS del Kebab Combo Individual -> combo   (22/09/2026)
-- ----------------------------------------------------------------------------
-- Regla 10: un cambio que mueve stock se ensaya por sus CAMINOS, no por su
-- formula. Este cambio solo toca UN camino: el de la venta. `combo_slot`,
-- `combo_slot_option` y `menu_item.product_type` no los lee ni la recepcion de
-- albaran, ni la merma, ni la aprobacion de recuento — esos tres siguen
-- exactamente igual que antes y por eso no se ensayan aqui. Queda dicho.
--
-- Lo que SI se ensaya, y es el que importa: entra un pedido de HubRise con
-- deal, `adapt_hubrise_order` lo parte, y se mira que descuenta.
--
-- COMO SE PASA: pegar este bloque DENTRO de la transaccion de la migracion
-- 20260922T0030, justo antes del `rollback;`. Asi se ensaya sobre el catalogo
-- YA convertido y no se deja nada escrito.
-- ============================================================================

-- Pedido sintetico: mismo esqueleto que el G324 real de Smash (21/09 20:20),
-- que es el unico deal de HubRise que sabemos que funciona. Los `sku_ref` van
-- con el prefijo de marca porque asi los manda HubRise; `hubrise_strip_ns` los
-- limpia. El `ref` del deal va SIN prefijo, igual que en el G324.
with nueva as (
  insert into public.sale (account_id, brand_id, source, sold_at, total, status, external_ref, external_brand_text, raw_tab)
  values (
    '51ad1792-6629-4ef7-833a-b57b09a86710',
    '5a230c99-1de4-47ca-82fb-65d4af589176',
    'hubrise', now(), 12.50, 'open', 'ENSAYO-KEBAB-COMBO', 'The Urban Kebab',
    jsonb_build_object(
      'deals', jsonb_build_object('0', jsonb_build_object(
          'ref', 'd21e1cfa-33ba-4a7e-8d51-8ef947113688', 'name', 'Kebab Combo Individual')),
      'items', jsonb_build_array(
        jsonb_build_object(
          'product_name','Kebab de Pollo Gyros 🌯',
          'sku_ref','the-urban-kebab:fv_3288f6c415c948f584959e04e32522d1',
          'price','12.50 EUR', 'quantity','1',
          'deal_line', jsonb_build_object('deal_key','0'),
          'options', jsonb_build_array()),
        jsonb_build_object(
          'product_name','Patatas Harisa',
          'sku_ref','the-urban-kebab:65504778-e72f-4f6e-a758-427adf25d295',
          'price','0.00 EUR', 'quantity','1',
          'deal_line', jsonb_build_object('deal_key','0'),
          'options', jsonb_build_array())
      ))::text
  )
  returning id
)
select public.adapt_hubrise_order(id) as lineas_creadas, id as sale_id from nueva;
-- Esperado: 3 lineas (1 padre + 2 combo_item). Si sale 1, el deal NO ha casado.

-- ── E1. La forma del ticket ─────────────────────────────────────────────────
select sl.line_type, sl.product_name, sl.menu_item_id is not null as tiene_ficha,
       mi.recipe_item_id is not null as tiene_articulo,
       sl.map_source, coalesce(sl.unmapped_reason,'—') as motivo
  from public.sale s
  join public.sale_line sl on sl.sale_id=s.id and sl.account_id=s.account_id
  left join public.menu_item mi on mi.id=sl.menu_item_id and mi.account_id=s.account_id
 where s.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and s.external_ref='ENSAYO-KEBAB-COMBO'
 order by sl.parent_sale_line_id nulls first, sl.created_at;
-- Esperado: 1 `product` (el combo, con ficha) + 2 `combo_item`, los dos con
-- ficha Y con articulo, y `motivo` = '—' en las tres. Esto es literalmente la
-- comprobacion 1 del parte diario: "sale ok, sin faltan".

-- ── E2. Lo que descuenta de verdad ──────────────────────────────────────────
select ri.folvy_code, ri.name, round(c.qty_base::numeric,3) as cantidad
  from public.sale s
  join public.sale_line sl on sl.sale_id=s.id and sl.account_id=s.account_id and sl.line_type='product'
  cross join lateral public._sale_line_raw_consumption(sl.id) c
  join public.recipe_item ri on ri.id=c.raw_item_id and ri.account_id=s.account_id
 where s.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
   and s.external_ref='ENSAYO-KEBAB-COMBO'
 order by ri.folvy_code;
-- Esperado (medido en seco el 22/09, 13 articulos): los 9 del Kebab de Pollo
-- (RAW-00029 10,254 / RAW-00037 10 / RAW-00054 25 / RAW-00057 120 /
--  RAW-00060 26,316 / RAW-00127 30 / RAW-00134 12,028 / RAW-00136 1 /
--  RAW-00140 13,750) + los 4 de Patatas Harisa. HOY este mismo pedido
-- descuenta 100 g de RAW-00057 y 50 g de RAW-00127 y NADA mas.
--
-- Nota, y no es de este encargo: el empaquetado (`type='packaging'`) nunca sale
-- en la explosion — `explode_recipe_to_raws` solo para en 'raw'/'tool'/receta
-- stockable, y un 'packaging' sin lineas hijas devuelve cero filas. Y el aceite
-- RAW-00010 tampoco sale. Las dos cosas pasan YA hoy con el kebab suelto: no
-- las cambia esta migracion, pero quedan anotadas.

-- ── E3. Que no se ha colado en otra cuenta (regla 9) ────────────────────────
select count(*) as ventas_de_ensayo
  from public.sale
 where external_ref='ENSAYO-KEBAB-COMBO';
-- Esperado: 1. Si sale mas de 1, hay ensayos sin revertir de pasadas anteriores.

-- ← y ahora `rollback;` de la transaccion entera. Nada de esto se queda.
