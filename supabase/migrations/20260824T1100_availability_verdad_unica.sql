-- 20260824T1100_availability_verdad_unica.sql
--
-- PROBLEMA
-- El 86 tiene DOS verdades y solo se mantiene una:
--   * product_availability  -> la que escribe el motor (_set_product_availability_core)
--   * menu_item.is_available -> la que LEEN todas las pantallas (ficha "En carta",
--     badge y toggle de la lista de carta)
-- _set_product_availability_core nunca ha tocado menu_item.is_available. Por eso
-- "Agotado · reactivar" no responde: la RPC se ejecuta, borra el override, devuelve
-- OK, y la ficha vuelve a leer is_available=false porque nadie lo pone a true.
-- Medido: 8 eventos 'open' correctos hoy sobre «Birria Beef Bowl (AMB)» y su
-- updated_at sigue siendo el 14/08. 217 de 510 fichas vivas discrepan.
--
-- DECISIÓN
-- product_availability es la verdad (es lo único que mira availability_panel, la
-- pantalla de Disponibilidad). menu_item.is_available pasa a ser DERIVADO de ella:
-- disponible = no hay ningún override que lo apague. Así cada lector actual sigue
-- leyendo donde ya lee, y deja de mentir.
--
-- LOS ESPEJOS QUEDAN FUERA, A PROPÓSITO
-- swap_mirror sí escribe menu_item.is_available: oculta el original mientras la
-- promo está activa. Eso NO es un agotado y no debe recalcularse, o agotar un
-- producto con espejo destaparía la promo. Se excluyen las dos patas del par.

begin;

create or replace function public._set_product_availability_core(
  p_menu_item_id uuid, p_is_available boolean, p_location_id uuid, p_reason text,
  p_available_until timestamp with time zone, p_reason_code text, p_account_id uuid,
  p_actor uuid, p_origin text, p_surface text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_account_id uuid; v_recipe_item_id uuid; v_external_id text; v_stock_group_id uuid;
  v_product_name text; v_matriculas text[]; v_affected_ids uuid[]; v_brands int;
  v_action text; v_reason_code text;
begin
  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception '_set_product_availability_core: reason no valido %', p_reason;
  end if;
  if p_reason_code is not null and p_reason_code not in
     ('sin_stock','incidencia','fin_servicio','promocion','mantenimiento','otro') then
    raise exception '_set_product_availability_core: reason_code no valido %', p_reason_code;
  end if;

  select mi.account_id, mi.recipe_item_id, mi.external_id, mi.name, mi.stock_group_id
    into v_account_id, v_recipe_item_id, v_external_id, v_product_name, v_stock_group_id
  from menu_item mi where mi.id = p_menu_item_id;

  if v_account_id is null then
    raise exception '_set_product_availability_core: producto % no encontrado', p_menu_item_id;
  end if;
  if v_account_id <> p_account_id then
    raise exception '_set_product_availability_core: producto % no pertenece a la cuenta %', p_menu_item_id, p_account_id;
  end if;

  with sib as (
    select mi.id, mi.brand_id, mi.external_id from menu_item mi
    where mi.account_id = v_account_id
      and ( mi.id = p_menu_item_id
        or (v_recipe_item_id is not null and mi.recipe_item_id = v_recipe_item_id)
        or (v_stock_group_id is not null and mi.stock_group_id = v_stock_group_id) )
  )
  select array_agg(distinct external_id) filter (where external_id is not null),
         count(distinct brand_id), array_agg(distinct id)
    into v_matriculas, v_brands, v_affected_ids from sib;

  if p_is_available then
    if p_location_id is null then
      delete from product_availability pa where pa.account_id = v_account_id
        and ( (v_external_id is not null and pa.external_id = v_external_id)
           or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id) );
    else
      delete from product_availability pa where pa.account_id = v_account_id
        and ( (v_external_id is not null and pa.external_id = v_external_id)
           or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id) )
        and (pa.location_id = p_location_id or pa.location_id is null);
    end if;
  else
    delete from product_availability pa where pa.account_id = v_account_id
      and ( (v_external_id is not null and pa.external_id = v_external_id)
         or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id) )
      and pa.location_id is not distinct from p_location_id;

    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id, is_available, reason, available_until, set_by)
    values
      (v_account_id, v_external_id, v_recipe_item_id, p_location_id, false, p_reason, p_available_until, p_actor);

    if p_location_id is not null then
      insert into availability_integrator_notice
        (account_id, location_id, product_name, external_id, recipe_item_id, brands, integrators, reason, raised_by)
      select v_account_id, l.id, coalesce(v_product_name, '(producto)'), v_external_id, v_recipe_item_id,
             coalesce(v_brands, 0), l.availability_other_integrators, p_reason, p_actor
      from locations l
      where l.id = p_location_id and l.account_id = v_account_id
        and coalesce(array_length(l.availability_other_integrators, 1), 0) > 0
        and not exists ( select 1 from availability_integrator_notice x
          where x.location_id = l.id and x.ack_at is null
            and coalesce(x.external_id, '') = coalesce(v_external_id, '')
            and coalesce(x.recipe_item_id::text, '') = coalesce(v_recipe_item_id::text, '') );
    else
      insert into availability_integrator_notice
        (account_id, location_id, product_name, external_id, recipe_item_id, brands, integrators, reason, raised_by)
      select v_account_id, l.id, coalesce(v_product_name, '(producto)'), v_external_id, v_recipe_item_id,
             coalesce(v_brands, 0), l.availability_other_integrators, p_reason, p_actor
      from locations l
      where l.account_id = v_account_id and l.active
        and coalesce(array_length(l.availability_other_integrators, 1), 0) > 0
        and not exists ( select 1 from availability_integrator_notice x
          where x.location_id = l.id and x.ack_at is null
            and coalesce(x.external_id, '') = coalesce(v_external_id, '')
            and coalesce(x.recipe_item_id::text, '') = coalesce(v_recipe_item_id::text, '') );
    end if;
  end if;

  -- ── LO NUEVO: menu_item.is_available deja de quedarse atrás ──────────────
  -- Se RECALCULA (no se asigna p_is_available a pelo) para que un 86 puesto en
  -- otro local, o un override que siga vivo, no se pierda al reactivar aquí.
  -- Solo sobre los afectados, solo si cambia, y nunca sobre un par espejo.
  update menu_item mi
     set is_available = not exists (
           select 1 from product_availability pa
            where pa.account_id = mi.account_id
              and pa.is_available = false
              and ( (mi.external_id is not null and pa.external_id = mi.external_id)
                 or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) ) )
   where mi.id = any(v_affected_ids)
     and mi.mirror_of_item_id is null
     and not exists (select 1 from menu_item m2 where m2.mirror_of_item_id = mi.id)
     and mi.is_available is distinct from ( not exists (
           select 1 from product_availability pa
            where pa.account_id = mi.account_id
              and pa.is_available = false
              and ( (mi.external_id is not null and pa.external_id = mi.external_id)
                 or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) ) ) );

  v_action := case when p_is_available then 'open' else 'close' end;
  v_reason_code := case when v_action = 'close' then coalesce(p_reason_code,
    case p_reason when 'stock_out' then 'sin_stock' when 'schedule' then 'fin_servicio'
                  when 'manual' then 'otro' else null end) else null end;
  begin
    insert into availability_event
      (account_id, scope, target_ext, target_label, location_id, action, origin,
       reason_code, reason_note, actor_id, surface, resume_at)
    values
      (v_account_id, 'product', coalesce(v_external_id, v_recipe_item_id::text), v_product_name,
       p_location_id, v_action, p_origin, v_reason_code, null, p_actor, p_surface,
       case when v_action = 'close' then p_available_until else null end);
  exception when others then
    raise warning '_set_product_availability_core: fallo insertando availability_event: %', sqlerrm;
  end;

  return jsonb_build_object(
    'matriculas', coalesce(to_jsonb(v_matriculas), '[]'::jsonb),
    'affected_ids', coalesce(to_jsonb(v_affected_ids), '[]'::jsonb),
    'brands', coalesce(v_brands, 0));
end;
$function$;

-- ── Reparación de una vez: las 217 fichas que hoy mienten ────────────────────
-- Mismo criterio que arriba. Sin esto, los productos ya reactivados seguirían
-- pintándose "agotado" para siempre (nadie vuelve a llamar a la RPC sobre ellos).
update menu_item mi
   set is_available = not exists (
         select 1 from product_availability pa
          where pa.account_id = mi.account_id
            and pa.is_available = false
            and ( (mi.external_id is not null and pa.external_id = mi.external_id)
               or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) ) )
 where mi.archived_at is null
   and mi.mirror_of_item_id is null
   and not exists (select 1 from menu_item m2 where m2.mirror_of_item_id = mi.id)
   and mi.is_available is distinct from ( not exists (
         select 1 from product_availability pa
          where pa.account_id = mi.account_id
            and pa.is_available = false
            and ( (mi.external_id is not null and pa.external_id = mi.external_id)
               or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id) ) ) );

commit;
