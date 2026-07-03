-- 20260703T2580_mirror_state.sql
-- Aplicada: (pendiente)
--
-- G2·D5 (parte 1) — Estado combinado del par original/espejo para la ficha de la
-- Carta. La UI necesita distinguir "oculto por espejo" (el original se esconde a
-- propósito porque su versión promo está activa) de "agotado" (86). swap_mirror ya
-- existe (20260703T2500); esto solo LEE el par y su disponibilidad para pintar el
-- estado y el botón "Usar versión promo" / "Volver al original".
--
-- Devuelve claves camelCase (las consume directo el cliente TS). role:
--   'none'     -> el item no participa en ningún par espejo.
--   'original' -> el item es el original y tiene un espejo.
--   'mirror'   -> el item ES el espejo (su original es mirror_of_item_id).
-- usingMirror = el espejo es el que está visible (is_available=true).

begin;

create or replace function public.mirror_state(p_account uuid, p_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_item menu_item%rowtype;
  v_orig menu_item%rowtype;
  v_mir  menu_item%rowtype;
begin
  if not (p_account = any(current_user_account_ids())) then raise exception 'forbidden'; end if;

  select * into v_item from menu_item where id = p_item and account_id = p_account;
  if v_item.id is null then return jsonb_build_object('role', 'none'); end if;

  if v_item.mirror_of_item_id is not null then
    -- p_item ES el espejo: su original es mirror_of_item_id.
    select * into v_orig from menu_item where id = v_item.mirror_of_item_id and account_id = p_account;
    if v_orig.id is null then return jsonb_build_object('role', 'none'); end if;
    return jsonb_build_object(
      'role', 'mirror',
      'originalId', v_orig.id, 'originalName', v_orig.name, 'originalAvailable', coalesce(v_orig.is_available, false),
      'mirrorId', v_item.id, 'mirrorName', v_item.name, 'mirrorAvailable', coalesce(v_item.is_available, false),
      'usingMirror', coalesce(v_item.is_available, false)
    );
  end if;

  -- p_item es (posible) original: buscar su espejo.
  select * into v_mir from menu_item where mirror_of_item_id = p_item and account_id = p_account limit 1;
  if v_mir.id is null then return jsonb_build_object('role', 'none'); end if;

  return jsonb_build_object(
    'role', 'original',
    'originalId', v_item.id, 'originalName', v_item.name, 'originalAvailable', coalesce(v_item.is_available, false),
    'mirrorId', v_mir.id, 'mirrorName', v_mir.name, 'mirrorAvailable', coalesce(v_mir.is_available, false),
    'usingMirror', coalesce(v_mir.is_available, false)
  );
end;
$fn$;

grant execute on function public.mirror_state(uuid, uuid) to authenticated;

commit;
