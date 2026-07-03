-- 20260703T2600_bogo_motor.sql
-- Aplicada: (pendiente)
--
-- G2c sub-lote A2 — MOTOR BOGO. Requiere 2590 (modelo + gestor).
--
--   (1) _shop_item_bogo(account, item): campaña 'bogo' activa en scope (mismo
--       predicado ventana/franja/canal/presupuesto/scope que _shop_item_offer).
--       Devuelve {campaignId, pct} o NULL (independiente de la cantidad).
--
--   (2) _shop_reprice_line: rama BOGO. Por cada PAR de unidades del mismo plato en
--       la LÍNEA (qty>=2), la 2ª lleva pct% -> descuento de LÍNEA
--       (floor(qty/2) uds). BOGO gana sobre item_percent (más promocional; se
--       documenta: un plato en ambas recibe solo la BOGO). unitPrice NO cambia
--       (el precio por unidad es honesto); el descuento va en lineTotal.
--
-- VÍA MENOS INVASIVA (place_shop_order INTACTO): el descuento viaja en el offer
-- como discountLine (para carta/carrito/checkout y A3) Y como
-- discountUnit = discountLine/qty. La contabilidad existente de place_shop_order
-- (v_item_promo += discountUnit*quantity; canje = round(., 2)) reconstruye
-- discountLine EXACTO (verificado con casos qty par e impar). Así el presupuesto y
-- el canje (is_cycle, por venta) funcionan por el mecanismo ya vivo, sin reescribir
-- la función de cobro de 23k.
--
-- DÓNDE MUERDE (decisión documentada): sobre la LÍNEA (mismo menu_item + misma
-- config, qty>=2). Emparejar unidades de líneas distintas (o cross-item) queda
-- FUERA de este lote. Cantidades: usar el paso de cantidad de la línea.
--
-- CREATE OR REPLACE sin cambio de firma (sin DROP). No se prueba en la tx que la crea.

begin;

-- (1) Helper BOGO (espejo del predicado de _shop_item_offer, sin precio ni tachado).
create or replace function public._shop_item_bogo(p_account uuid, p_menu_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cat    uuid;
  v_brand  uuid;
  v_camp   coupon%rowtype;
  v_nowmad timestamp;
begin
  select menu_category_id, brand_id into v_cat, v_brand from menu_item where id = p_menu_item_id;
  v_nowmad := (now() at time zone 'Europe/Madrid');

  select c.* into v_camp
  from coupon c
  where c.account_id = p_account and c.active and c.kind = 'bogo' and c.paused_at is null
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at   is null or c.ends_at   >  now())
    and 'shop' = any(c.channels)
    and (c.weekdays  is null or extract(isodow from v_nowmad)::smallint = any(c.weekdays))
    and (c.time_from is null or v_nowmad::time >= c.time_from)
    and (c.time_to   is null or v_nowmad::time <= c.time_to)
    and (c.budget_max is null or (
          select coalesce(sum(cr.discount_amount), 0) from coupon_redemption cr
          join sale s on s.id = cr.sale_id
          where cr.coupon_id = c.id and coalesce(s.status,'') <> 'cancelled'
        ) < c.budget_max)
    and exists (
      select 1 from campaign_scope sc
      where sc.coupon_id = c.id
        and (sc.menu_item_id = p_menu_item_id or sc.menu_category_id = v_cat or sc.brand_id = v_brand)
    )
  order by (
    case
      when exists (select 1 from campaign_scope sc where sc.coupon_id = c.id and sc.menu_item_id = p_menu_item_id) then 3
      when exists (select 1 from campaign_scope sc where sc.coupon_id = c.id and sc.menu_category_id = v_cat) then 2
      else 1
    end) desc, c.value desc
  limit 1;

  if v_camp.id is null then return null; end if;

  return jsonb_build_object('campaignId', v_camp.id, 'pct', v_camp.value);
end;
$function$;

grant execute on function public._shop_item_bogo(uuid, uuid) to authenticated;

-- (2) Reprecio de línea: reproducción fiel del texto vivo + rama BOGO.
create or replace function public._shop_reprice_line(p_account_id uuid, p_line jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_mi          menu_item%rowtype;
  v_unit        numeric;
  v_qty         numeric;
  v_m           jsonb;
  v_c           jsonb;
  v_opt_impact  numeric;
  v_cso_impact  numeric;
  v_offer       jsonb;              -- G2a: oferta item_percent (o NULL)
  v_bogo        jsonb;              -- G2c: campaña bogo en scope (o NULL)
  v_line_disc   numeric := 0;
  v_pairs       numeric;
  v_bpct        numeric;
begin
  v_qty := coalesce((p_line->>'quantity')::numeric, 1);

  select * into v_mi
  from menu_item mi
  where mi.id = (p_line->>'menuItemId')::uuid
    and mi.account_id = p_account_id
    and mi.archived_at is null
    and mi.is_active is not false
    and mi.is_available is not false;

  if not found then
    return jsonb_build_object(
      'menuItemId', p_line->>'menuItemId',
      'name', coalesce(p_line->>'name','(no disponible)'),
      'valid', false, 'unitPrice', 0, 'quantity', v_qty, 'lineTotal', 0
    );
  end if;

  v_unit := coalesce(v_mi.price, 0);

  -- modificadores base (asignados a este menu_item)
  if jsonb_typeof(p_line->'modifiers') = 'array' then
    for v_m in select * from jsonb_array_elements(p_line->'modifiers')
    loop
      select mo.price_impact into v_opt_impact
      from modifier_option mo
      join modifier_group mg on mg.id = mo.modifier_group_id
      join modifier_group_assignment mga on mga.modifier_group_id = mg.id
      where mo.id = (v_m->>'optionId')::uuid
        and mga.menu_item_id = v_mi.id
        and mo.is_active and mg.is_active
      limit 1;
      if v_opt_impact is not null then
        v_unit := v_unit + v_opt_impact * coalesce((v_m->>'qty')::numeric, 1);
      end if;
      v_opt_impact := null;
    end loop;
  end if;

  -- combo: opciones de slot + modificadores anidados
  if jsonb_typeof(p_line->'combo') = 'array' then
    for v_c in select * from jsonb_array_elements(p_line->'combo')
    loop
      select cso.price_impact into v_cso_impact
      from combo_slot_option cso
      join combo_slot cs on cs.id = cso.combo_slot_id
      where cs.combo_item_id = v_mi.id
        and cs.id = (v_c->>'slotId')::uuid
        and cso.menu_item_id = (v_c->>'menuItemId')::uuid
        and cso.is_active and cs.is_active
      limit 1;
      if v_cso_impact is not null then
        v_unit := v_unit + v_cso_impact;
      end if;
      v_cso_impact := null;

      if jsonb_typeof(v_c->'modifiers') = 'array' then
        for v_m in select * from jsonb_array_elements(v_c->'modifiers')
        loop
          select mo.price_impact into v_opt_impact
          from modifier_option mo
          join modifier_group mg on mg.id = mo.modifier_group_id
          join modifier_group_assignment mga on mga.modifier_group_id = mg.id
          where mo.id = (v_m->>'optionId')::uuid
            and mga.menu_item_id = (v_c->>'menuItemId')::uuid
            and mo.is_active and mg.is_active
          limit 1;
          if v_opt_impact is not null then
            v_unit := v_unit + v_opt_impact * coalesce((v_m->>'qty')::numeric, 1);
          end if;
          v_opt_impact := null;
        end loop;
      end if;
    end loop;
  end if;

  -- G2c: BOGO gana sobre item_percent. Por cada PAR de uds del mismo plato en la
  -- línea, la 2ª lleva v_bpct%. Descuento de LÍNEA (floor(qty/2) uds); unitPrice
  -- NO cambia. discountUnit=discountLine/qty para que la contabilidad de
  -- place_shop_order (discountUnit*qty, redondeada al canje) reconstruya el exacto.
  v_bogo := public._shop_item_bogo(p_account_id, v_mi.id);
  if v_bogo is not null then
    v_bpct := (v_bogo->>'pct')::numeric;
    v_pairs := floor(v_qty / 2);
    v_line_disc := round(v_pairs * v_unit * v_bpct / 100.0, 2);
    return jsonb_build_object(
      'menuItemId', v_mi.id,
      'name', v_mi.name,
      'brandId', v_mi.brand_id,
      'valid', true,
      'unitPrice', round(v_unit, 2),
      'quantity', v_qty,
      'lineTotal', round(v_unit * v_qty - v_line_disc, 2),
      'offer', jsonb_build_object(
        'kind',         'bogo',
        'campaignId',   v_bogo->>'campaignId',
        'pct',          v_bpct,
        'freeUnits',    v_pairs,
        'discountLine', v_line_disc,
        'discountUnit', case when v_qty > 0 then v_line_disc / v_qty else 0 end,
        'wasPrice',     null
      )
    );
  end if;

  -- G2a: oferta item_percent sobre el precio vigente (base + mods). Fuente única.
  v_offer := public._shop_item_offer(p_account_id, v_mi.id, v_unit);
  if v_offer is not null then
    v_unit := (v_offer->>'discountedPrice')::numeric;
  end if;

  return jsonb_build_object(
    'menuItemId', v_mi.id,
    'name', v_mi.name,
    'brandId', v_mi.brand_id,
    'valid', true,
    'unitPrice', round(v_unit, 2),
    'quantity', v_qty,
    'lineTotal', round(v_unit * v_qty, 2),
    'offer', v_offer
  );
end;
$function$;

commit;
