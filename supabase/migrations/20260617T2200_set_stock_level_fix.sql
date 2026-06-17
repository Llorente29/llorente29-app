-- supabase/migrations/20260617T2200_set_stock_level_fix.sql
--
-- Fix de set_stock_level. Dos problemas en la primera versión:
--   1) Tipos: los params number|null no encajaban con los generados.
--   2) DISEÑO (el grave): el upsert reescribía las 5 columnas a la vez, así que
--      guardar min/par desde la UI ponía a NULL reorder_point/lead_time/safety
--      → habría borrado la config del MRP II cada vez que el cocinero toca un nivel.
--
-- Esta función gestiona SOLO min_qty y par_qty (lo que toca la pantalla). El
-- upsert NO toca reorder_point/lead_time_days/safety_qty: los deja como estén,
-- para que el MRP II los administre por su lado sin pisarse con la UI.
-- p_min/p_par con default null: omitir = null = borrar ese nivel (vaciar el campo).
--
-- DROP de la firma anterior (10 args) primero, para no dejar sobrecarga duplicada.

drop function if exists public.set_stock_level(uuid, uuid, uuid, numeric, numeric, numeric, integer, numeric, uuid, text);

create or replace function public.set_stock_level(
  p_account uuid,
  p_location uuid,
  p_recipe_item uuid,
  p_min numeric default null,
  p_par numeric default null,
  p_user_id uuid default null,
  p_user_name text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not current_user_is_admin_or_manager_of(p_account) then
    raise exception 'set_stock_level: sin permiso sobre la cuenta %', p_account;
  end if;
  insert into public.stock_level(
    account_id, location_id, recipe_item_id,
    min_qty, par_qty, updated_at, updated_by, updated_by_name
  ) values (
    p_account, p_location, p_recipe_item,
    p_min, p_par, now(), p_user_id, p_user_name
  )
  on conflict (account_id, location_id, recipe_item_id) do update set
    min_qty = p_min,            -- solo min y par; NO se tocan reorder/lead/safety
    par_qty = p_par,
    updated_at = now(),
    updated_by = p_user_id,
    updated_by_name = p_user_name;
end;
$function$;

grant execute on function public.set_stock_level(uuid, uuid, uuid, numeric, numeric, uuid, text) to authenticated;
