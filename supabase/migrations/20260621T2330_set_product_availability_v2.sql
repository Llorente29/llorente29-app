-- 20260621T2330_set_product_availability_v2.sql
-- ============================================================================
-- 86 POR LOCAL — RPC v2. Sustituye la v1 (que apagaba en TODOS los locales).
--
-- Cambios:
--   · +p_location_id: el 86 es por LOCAL (NULL = todos los locales / descatalogar).
--   · escribe/borra fila en product_availability por (producto físico × local);
--     NO toca menu_item.is_available (eso es la "base de marca / Last").
--   · resuelve las N external_location_id del local vía external_location_map
--     (1→N: cada local físico tiene propia Foodint + cedida Cloudtown).
--   · set_by = auth.uid() (en una RPC DEFINER da el usuario real, no como el SQL Editor).
--   · empuje filtrado por local: pasa matriculas + external_location_ids al despachador.
--
-- DROP de la v1 obligatorio antes de versionar (cambia la firma; regla del proyecto).
-- Crea la función pero NO la ejecuta -> segura en el SQL Editor.
-- ⚠️ Rellenar el placeholder __DISPATCH_SECRET__ con el mismo AVAILABILITY_DISPATCH_SECRET
--    (cópialo de la migración 20260621T2100_availability_86.sql, donde ya lo pusiste).
-- Aplicada: 2026-06-21
-- ============================================================================

-- v1 fuera (firma vieja: menu_item, bool, reason, until)
drop function if exists public.set_product_availability(uuid, boolean, text, timestamptz);

create or replace function public.set_product_availability(
  p_menu_item_id    uuid,
  p_is_available    boolean,
  p_location_id     uuid        default null,
  p_reason          text        default 'manual',
  p_available_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id     uuid;
  v_recipe_item_id uuid;
  v_external_id    text;
  v_user           uuid := auth.uid();
  v_matriculas     text[];
  v_brands         int;
  v_ext_locs       text[];
  v_channels       int;
begin
  -- identidad del producto físico
  select mi.account_id, mi.recipe_item_id, mi.external_id
    into v_account_id, v_recipe_item_id, v_external_id
  from menu_item mi
  where mi.id = p_menu_item_id;

  if v_account_id is null then
    raise exception 'set_product_availability: producto % no encontrado', p_menu_item_id;
  end if;

  -- guard (idéntico a set_order_status)
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_product_availability: sin acceso a la cuenta %', v_account_id;
  end if;

  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_product_availability: reason no válido %', p_reason;
  end if;

  -- matrículas hermanas (cascada cross-brand: mismo escandallo O misma matrícula)
  select array_agg(distinct mi.external_id) filter (where mi.external_id is not null),
         count(distinct mi.brand_id)
    into v_matriculas, v_brands
  from menu_item mi
  where mi.account_id = v_account_id
    and (
      (v_recipe_item_id is not null and mi.recipe_item_id = v_recipe_item_id)
      or (v_external_id is not null and mi.external_id = v_external_id)
      or mi.id = p_menu_item_id
    );

  -- escribir / borrar la fila de disponibilidad por (producto físico × local)
  -- (delete-then-insert: idempotente, sin líos de ON CONFLICT con índices parciales)
  delete from product_availability pa
  where pa.account_id = v_account_id
    and (
      (v_external_id    is not null and pa.external_id    = v_external_id)
      or (v_recipe_item_id is not null and pa.recipe_item_id = v_recipe_item_id)
    )
    and pa.location_id is not distinct from p_location_id;

  if not p_is_available then
    insert into product_availability
      (account_id, external_id, recipe_item_id, location_id,
       is_available, reason, available_until, set_by)
    values
      (v_account_id, v_external_id, v_recipe_item_id, p_location_id,
       false, p_reason, p_available_until, v_user);
  end if;

  -- external_location_id de Last para ese local (1→N propia+cedida); NULL = todas
  if p_location_id is null then
    select array_agg(distinct elm.external_location_id)
      into v_ext_locs
    from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active;
  else
    select array_agg(distinct elm.external_location_id)
      into v_ext_locs
    from external_location_map elm
    where elm.account_id = v_account_id and elm.source = 'lastapp' and elm.is_active
      and elm.location_id = p_location_id;
  end if;

  -- canales reales que se tocarán (catálogos por canal de esas matrículas en ese local)
  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_account_id
      and ecp.organization_product_id::text = any(v_matriculas)
      and (v_ext_locs is null or ecp.external_location_id::text = any(v_ext_locs));

    -- empuje fire-and-forget al despachador, ACOTADO al local
    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
      headers := jsonb_build_object(
        'Content-Type',                   'application/json',
        'x-availability-dispatch-secret', 'fv_avl_240b04bce3cb5513f29a71f778654ab8'
      ),
      body    := jsonb_build_object(
        'account_id',            v_account_id,
        'matriculas',            to_jsonb(v_matriculas),
        'external_location_ids', to_jsonb(coalesce(v_ext_locs, array[]::text[])),
        'enable',                p_is_available,
        'reason',                p_reason
      )
    );
  end if;

  return jsonb_build_object(
    'brands',             coalesce(v_brands, 0),
    'channels',           coalesce(v_channels, 0),
    'matriculas',         coalesce(array_length(v_matriculas, 1), 0),
    'location_id',        p_location_id,
    'external_locations', coalesce(array_length(v_ext_locs, 1), 0)
  );
end;
$function$;
