-- ---------------------------------------------------------------------------
-- LOS ALÉRGENOS Y EL RESOLUTOR DE LA CÁMARA · 20/09/2026
-- ---------------------------------------------------------------------------
--
-- Esto es lo que SOBREVIVE de `20260920073000_el_numero_del_dia.sql`, que se
-- retira entera. Aquella migración construía un contador diario
-- (`pase_day_counter`) para dar un número corto por local y día. A las 12:10
-- Julio cambió el número grande: ya no es un contador, son **las cuatro
-- últimas del código que pide el repartidor**, que es un dato que YA existe en
-- la venta. Un número derivado no necesita contador, ni columna, ni disparador.
--
-- 🔴 La migración retirada NUNCA se aplicó. Comprobado contra la base antes de
--    borrarla: no existen `sale.pase_numero`, `sale.pase_dia`,
--    `pase_day_counter`, `tg_sale_pase_numero` ni `label_token.pase_numero`.
--    Por eso se BORRA en vez de escribir una que la deshaga: no hay nada que
--    deshacer, y dejar en el repositorio una migración que no está en la base
--    es exactamente la deriva que la regla 17 prohíbe, del revés.
--
-- Y la ESTABILIDAD EN REIMPRESIÓN deja de necesitar código: el número sale del
-- código de pase, que no cambia entre la primera impresión y la segunda. Antes
-- había que garantizarla con un `pase_numero` asignado una vez; ahora se
-- cumple por construcción. Menos piezas, misma garantía.
--
-- ── BANDA DE SERVICIO ───────────────────────────────────────────────────────
--
-- 🔴 **Después de las 23:45.** Ya NO hay disparador ni columnas —la condición 2
--    se cumple de sobra, ningún ACCESS EXCLUSIVE sobre ninguna tabla— pero
--    `order_for_print` SÍ está en el camino del pedido: lo llama el worker de
--    impresión en cada trabajo. La condición 1 falla, y la banda dice que la
--    duda va siempre a favor de esperar. Contado, no supuesto:
--    `order_for_print` lo invoca `printWorker.ts` en cada `bag`, `kitchen` y
--    `labels` — 624 veces en los dos últimos días sólo en Alcalá.
--
-- ---------------------------------------------------------------------------

begin;

-- ── 1 · Los tres estados de los alérgenos ──────────────────────────────────
--
-- 🔴 UNA CAJA DE ALÉRGENOS VACÍA SE LEE COMO «ESTE PLATO NO TIENE ALÉRGENOS»,
--    y eso es una afirmación falsa sobre comida, impresa y pegada a la caja.
--
-- El encargo pedía una regla binaria: con ficha, o «sin datos». Medido
-- (Foodint, marcas propias activas, platos activos con ficha: 204; con
-- `contains`: 143; sin `contains`: 61 — el mismo 61 del encargo), esos 61 no
-- son una sola cosa:
--
--   47 platos → las 14 filas en `free`, CERO `unknown`. La ficha está COMPLETA
--               y dice que no lleva ninguno de los 14.
--   11 platos → cero filas. Nadie ha tocado la ficha.
--    3 platos → 1 `may_contain` y 13 `unknown`. Sólo una traza declarada.
--
-- Imprimir «sin datos» en los 47 sería falso en el sentido contrario, y además
-- tirar a la basura trabajo ya hecho — la regla 30. Así que la base manda el
-- ESTADO y el papel sólo pinta lo que diga:
--
--   'listed'  → hay `contains`: se listan.
--   'none'    → sin `contains` y sin ninguna `unknown`: «Ninguno de los 14».
--   'unknown' → todo lo demás: «Sin datos». Son 14 platos, listados en el parte.
--
-- La firma NO cambia, así que `create or replace` no crea sobrecarga (regla 2:
-- esa regla es para cambios de firma).

create or replace function public.order_for_print(p_device_token text, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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

  begin
    perform public.fill_line_discounts(p_sale_id);
    perform public.ensure_label_tokens(p_sale_id);
  exception when others then
    null;
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
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity, sl.line_type,
           sl.menu_item_id, sl.external_product_id, sl.unit_price, sl.line_total,
           sl.original_unit_price, sl.discount_label,
           mi.category as menu_category, df.name as family, df.color as family_color, df.icon as family_icon,
           array(select allergen_code from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='contains') as allergens,
           case
             when ri.id is null then 'unknown'
             when exists (select 1 from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='contains') then 'listed'
             when exists (select 1 from recipe_item_allergen a where a.recipe_item_id = ri.id)
              and not exists (select 1 from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='unknown') then 'none'
             else 'unknown'
           end as allergens_state
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join recipe_family df on df.id = ri.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
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
              'allergens_state', l.allergens_state,
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
$$;

-- ── 2 · El resolutor de texto del SEGUNDO LECTOR de la cámara ──────────────
--
-- 🔴 LO QUE HAY QUE DECIR ANTES: la cámara del §4 de C9 NO EXISTE todavía.
--    Está el sitio donde guardar la foto (`sale_capture`, los buckets y la
--    purga, del 04/09) y está el PRIMER lector, que es el QR. El SEGUNDO —el
--    que lee el texto impreso cuando el QR no se deja leer— no tenía función
--    ninguna: se buscó `pos_short_code` en `supabase/functions` y en `src` y
--    no aparece ni un resolutor. Esto no «actualiza» uno existente: lo CREA.
--
-- Y retirar el contador lo SIMPLIFICA en vez de debilitarlo. Antes hacían
-- falta dos vías —el número del día por un lado, el código por otro—; ahora el
-- número grande ES las cuatro últimas del código, así que una sola vía resuelve
-- las dos cosas: se acepta el código entero o sus cuatro últimas.
--
-- 🔴 DEUDA DECLARADA, y no me gusta: esto repite en SQL la regla de
--    `passCode.ts` (Uber → `platform_order_code`; el resto →
--    `pos_short_code`). La misma regla en dos sitios es una regla que un día
--    dice dos cosas — es literalmente lo que dice la cabecera de `passCode.ts`.
--    No hay forma de evitarlo hoy: la cámara resuelve en la base y la regla
--    vive en TypeScript. Queda escrito aquí para que, el día que la regla
--    cambie, alguien busque «passCode» y encuentre ESTE fichero también.
--
-- Y si hay más de un candidato lo DICE en vez de elegir: un verificador que
-- desempata solo es un verificador que un día pega la etiqueta en la bolsa de
-- otro. Cuatro caracteres repiten más que el código entero, así que esto no es
-- teórico — medido en Alcalá, 30 días: cero choques de las cuatro últimas en
-- 45 minutos, pero DOCE en 3 horas.

create or replace function public.pase_resolver_texto(p_device_token text, p_texto text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_device  kds_device;
  v_cuenta  uuid;
  v_local   uuid;
  v_txt     text;
  v_res     jsonb;
  v_n       int;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_resolver_texto: token de dispositivo no válido';
  end if;
  v_cuenta := v_device.account_id;
  v_local  := v_device.location_id;

  v_txt := upper(regexp_replace(coalesce(p_texto, ''), '[^0-9A-Za-z]', '', 'g'));
  if length(v_txt) < 3 then
    -- Menos de tres caracteres no identifica nada: mejor cero que una adivinanza.
    return jsonb_build_object('via', null, 'candidatos', 0, 'pedido', null);
  end if;

  with vivos as (
    select s.id, s.sold_at, s.customer_name, b.name as marca,
           upper(case when coalesce(ch.name, s.external_channel_text) ilike '%uber%'
                      then coalesce(nullif(btrim(s.platform_order_code), ''), nullif(btrim(s.pos_short_code), ''))
                      else coalesce(nullif(btrim(s.pos_short_code), ''), nullif(btrim(s.platform_order_code), ''))
                 end) as pase
      from sale s
      left join brand b on b.id = s.brand_id
      left join sales_channel ch on ch.id = s.channel_id
     where s.account_id = v_cuenta and s.location_id = v_local
       and s.sold_at >= now() - interval '12 hours'
       and coalesce(s.status, '') <> 'cancelled'
  )
  select count(*), (array_agg(jsonb_build_object(
           'sale_id', id, 'codigo', pase, 'marca', marca, 'cliente', customer_name
         ) order by sold_at desc))[1]
    into v_n, v_res
    from vivos
   where pase is not null
     and (pase = v_txt or (length(v_txt) = 4 and right(pase, 4) = v_txt));

  return jsonb_build_object(
    'via', case when length(v_txt) = 4 then 'cuatro_ultimas' else 'codigo' end,
    'candidatos', v_n,
    'pedido', case when v_n = 1 then v_res else null end);
end;
$$;

revoke all on function public.pase_resolver_texto(text, text) from public, anon;
grant execute on function public.pase_resolver_texto(text, text) to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- VUELTA ATRÁS, en la misma ventana:
--
--   · `pase_resolver_texto`: `drop function if exists
--     public.pase_resolver_texto(text, text);` — no la llama nadie todavía.
--   · `order_for_print`: volver a la definición anterior, que es ésta misma
--     sin `allergens_state`. Quitarlo sólo devuelve la caja de alérgenos a su
--     regla binaria; no rompe el papel.
--
-- Ninguna de las dos toca datos, así que la vuelta atrás no pierde nada.
-- ---------------------------------------------------------------------------
