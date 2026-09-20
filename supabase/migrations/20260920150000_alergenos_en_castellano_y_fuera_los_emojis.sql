-- ---------------------------------------------------------------------------
-- ALÉRGENOS EN CASTELLANO Y FUERA LOS EMOJIS · 20/09/2026, 15:00
-- ---------------------------------------------------------------------------
--
-- 🔴 ESTO YA ESTÁ EN PRODUCCIÓN. Se aplicó A MANO a las 15:00, con el servicio
--    abierto y con el sí de Julio, porque era una reclamación del cliente de
--    hacía una semana: la pegatina decía «milk · sesame» y los nombres de los
--    platos salían con `??` donde el catálogo lleva un emoji.
--
--    Esta migración NO cambia nada: existe para que el REPOSITORIO diga lo
--    mismo que la base. Sin ella, el día que alguien reconstruya
--    `order_for_print` desde el repositorio, los alérgenos vuelven al inglés
--    sin que nadie se entere. Es la regla 1, literal: una corrección que sólo
--    vive en lo desplegado es una corrección con fecha de caducidad.
--
-- CÓMO SE COPIÓ, PARA QUE NO HAYA DUDA
--
--    El cuerpo NO está transcrito a mano. Se sacó con `pg_get_functiondef` y
--    se comprobó por huella: el fichero pesa 6.715 caracteres y su md5 es
--    `6ef9b0079af6492879dca7bfaf9b11a4`, EL MISMO que devuelve la base. Byte a
--    byte. Si algún día se vuelve a copiar, se comprueba igual.
--
-- QUÉ CAMBIÓ RESPECTO A LO QUE HABÍA EN EL REPOSITORIO
--
--    1. `allergen_code` → etiqueta en castellano, con los 14 del reglamento
--       (no sólo los 12 en uso hoy) y `initcap()` de red por si aparece uno
--       nuevo.
--    2. `product_name` → `btrim(regexp_replace(…, '[^ -ɏ€]', '', 'g'))`, que
--       deja pasar de U+0020 a U+024F más el euro y tira el resto.
--
-- 🔴 DOS EFECTOS DE ESE SEGUNDO FILTRO, MEDIDOS SOBRE EL PROPIO RANGO Y NO
--    SUPUESTOS. Ninguno es grave, los dos conviene tenerlos escritos:
--
--    a) Tira TODO lo que pase de U+024F, no sólo emojis. Ahí caen el apóstrofo
--       tipográfico `’` (U+2019), las comillas `“ ”`, la raya `—` y los puntos
--       suspensivos `…`. Un plato llamado «Mila’s» saldría «Milas» en el papel.
--       La base no se toca; sólo cambia lo que se imprime.
--    b) `btrim` sólo recorta las PUNTAS. Un emoji en medio —«Falafel 🌿
--       Crispy»— deja dos espacios seguidos dentro del nombre.
--
-- 🔴 Y UNA DEUDA QUE NACE AQUÍ, dicha en voz alta: la traducción de alérgenos
--    pasa a vivir en DOS sitios, este SQL y `src/modules/kitchen/lib/allergens.ts`,
--    que hasta hoy era la fuente única. Los renderizadores del papel siguen
--    traduciendo por su cuenta; hoy no hace daño porque `isAllergenCode('Gluten')`
--    es false y el texto pasa tal cual, pero es la misma regla en dos sitios y
--    un día dirán cosas distintas. Lo que toca es que el papel DEJE de traducir,
--    y eso va en el paquete de la tablet, no aquí.
--
-- VUELTA ATRÁS: volver a la definición anterior del repositorio. No toca datos.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_for_print(p_device_token text, p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_result      jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'order_for_print: token no válido';
  end if;
  v_account_id := v_device.account_id;

  -- Pobla descuento por línea (Last + HubRise) just-in-time. No falla si no hay.
  begin
    perform public.fill_line_discounts(p_sale_id);
    -- C9 L1: acuña los tokens de etiqueta si no existen. Idempotente: la
    -- reimpresion pasa por aqui otra vez y devuelve LOS MISMOS.
    perform public.ensure_label_tokens(p_sale_id);
  exception when others then
    null;  -- el ticket no se cae por un descuento mal formado
  end;

  with v as (
    select s.id, s.external_ref, s.external_tab_ref,
           s.platform_order_code, s.pos_short_code, s.platform_order_ref,
           s.order_status, s.status, s.service_type, s.source,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.customer_name, s.customer_phone, s.delivery_address,
           s.expected_time, s.customer_note,
           s.total, s.paid, s.payment_method, s.discount_amount, s.delivery_cost,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at, s.raw_tab
    from sale s
    where s.id = p_sale_id and s.account_id = v_account_id
  ),
  notas as (
    select v.id as sale_id, (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from v
    cross join lateral (select safe_jsonb(v.raw_tab) as tab) rt
    cross join lateral (select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products) p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.products)='array' then p.products else '[]'::jsonb end) as prod
    where nullif(btrim(prod->>'comments'),'') is not null and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, btrim(regexp_replace(sl.product_name, '[^ -ɏ€]', '', 'g')) as product_name, sl.quantity, sl.line_type,
           sl.menu_item_id, sl.external_product_id, sl.unit_price, sl.line_total,
           sl.original_unit_price, sl.discount_label,
           mi.category as menu_category, df.name as family, df.color as family_color, df.icon as family_icon,
           array(select case a.allergen_code when 'gluten' then 'Gluten' when 'milk' then 'Lácteos' when 'eggs' then 'Huevos' when 'sulphites' then 'Sulfitos' when 'mustard' then 'Mostaza' when 'soy' then 'Soja' when 'sesame' then 'Sésamo' when 'celery' then 'Apio' when 'nuts' then 'Frutos de cáscara' when 'fish' then 'Pescado' when 'molluscs' then 'Moluscos' when 'crustaceans' then 'Crustáceos' when 'peanuts' then 'Cacahuetes' when 'lupin' then 'Altramuces' else initcap(a.allergen_code) end from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join recipe_family df on df.id = ri.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id, btrim(regexp_replace(sl.product_name, '[^ -ɏ€]', '', 'g')) as product_name, sl.quantity,
           sl.line_type, sl.external_product_id, sl.menu_item_id, mg.group_type,
           dfh.name as family, dfh.color as family_color, mih.category as menu_category,
           case when sl.line_type='combo_item' then 1 when mg.group_type='removal' then 2
                when mg.group_type='extras' then 3 when mg.group_type in ('choice','side') then 4
                when mg.group_type in ('cross_sell','info') then 6 else 5 end as sort_rank
    from sale_line sl
    left join modifier_option mo on mo.id = sl.modifier_option_id
    left join modifier_group mg on mg.id = mo.modifier_group_id
    left join menu_item mih on mih.id = sl.menu_item_id
    left join recipe_item rih on rih.id = mih.recipe_item_id
    left join recipe_family dfh on dfh.id = rih.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is not null
  )
  select to_jsonb(t) into v_result from (
    select v.id as sale_id, v.external_ref, v.external_tab_ref,
           v.platform_order_code, v.pos_short_code, v.platform_order_ref, v.order_status, v.status, v.service_type, v.source,
           b.name as brand, b.logo_url as brand_logo_url, b.color as brand_color,
           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption, b.ownership_type as brand_ownership_type,
           public.label_token_bolsa(v.id) as bag_token,
           coalesce(ch.name, v.external_channel_text) as channel, v.channel_id,
           v.customer_name, v.customer_phone, v.delivery_address, v.expected_time, v.customer_note,
           v.total, v.paid, v.payment_method, v.discount_amount, v.delivery_cost, v.entro_at,
           safe_jsonb(v.raw_tab)->'delivery' as delivery_detail,
           (select jsonb_agg(jsonb_build_object(
              'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity, 'menu_item_id', l.menu_item_id,
              'unit_tokens', public.label_tokens_for(l.line_id),
              'unit_price', l.unit_price, 'line_total', l.line_total,
              'original_unit_price', l.original_unit_price, 'discount_label', l.discount_label,
              'allergens', l.allergens,
              'family', l.family, 'family_color', l.family_color, 'family_icon', l.family_icon,
              'menu_category', l.menu_category, 'has_recipe', (l.menu_item_id is not null),
              'customer_note', (select n.note from notas n where n.sale_id=l.sale_id and n.ext_pid=l.external_product_id limit 1),
              'children', coalesce((select jsonb_agg(jsonb_build_object(
                  'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity, 'line_type', h.line_type,
                  'unit_tokens', public.label_tokens_for(h.line_id),
                  'group_type', h.group_type, 'menu_item_id', h.menu_item_id, 'family', h.family,
                  'family_color', h.family_color, 'menu_category', h.menu_category
                ) order by h.sort_rank, h.product_name) from hijas h where h.parent_sale_line_id = l.line_id), '[]'::jsonb)
            ) order by l.product_name) from padres l) as lineas
    from v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  ) t;

  return v_result;
end;
$function$
;
