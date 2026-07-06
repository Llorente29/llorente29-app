-- 20260706T1800_mark_social_post_published.sql
-- Módulo Social · Pieza 3a — Publicación
--
-- mark_social_post_published: cierre del flujo ASISTIDO (TikTok/Facebook, sin brazo automático).
-- El humano copia el caption + descarga la imagen, publica a mano en la red, y marca el post
-- como publicado. Admin-gated e idempotente. (Instagram publica solo vía social-publish.)
--
-- SECURITY DEFINER + current_user_is_admin_or_manager_of → NO probar desde el SQL Editor.

begin;

create or replace function public.mark_social_post_published(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_cur text;
begin
  select account_id, status into v_acc, v_cur from social_post where id = p_post_id;
  if v_acc is null then raise exception 'post no encontrado'; end if;
  if not current_user_is_admin_or_manager_of(v_acc) then raise exception 'no autorizado'; end if;
  if v_cur = 'published' then return; end if;   -- idempotente
  update social_post
     set status = 'published',
         published_at = coalesce(published_at, now()),
         updated_at = now()
   where id = p_post_id;
end $$;

revoke all on function public.mark_social_post_published(uuid) from public, anon;
grant  execute on function public.mark_social_post_published(uuid) to authenticated;

commit;
