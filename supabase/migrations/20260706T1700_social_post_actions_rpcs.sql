-- 20260706T1700_social_post_actions_rpcs.sql
-- Módulo Social · Pieza 2a — Acciones de la cola
--
-- Todas las escrituras del módulo van por RPCs con puerta de admin (no se depende de
-- políticas de UPDATE sueltas; validación server-side y consistente). Guarda común:
-- no tocar un post en 'publishing'/'published'.
--   set_social_post_status     → Aprobar (approved) / Descartar (discarded)
--   update_social_post_content → Editar caption + hashtags
--   requeue_social_image       → Regenerar imagen (vuelve a N1-pendiente; el worker recompone)
--   regenerate_social_copy     → Regenerar texto (re-tira de pick_social_copy con el pilar correcto)
--
-- SECURITY DEFINER + current_user_is_admin_or_manager_of → NO probar desde el SQL Editor
-- (auth.uid() null → "no autorizado"); se prueban desde la app.

begin;

create or replace function public.set_social_post_status(p_post_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_cur text;
begin
  select account_id, status into v_acc, v_cur from social_post where id = p_post_id;
  if v_acc is null then raise exception 'post no encontrado'; end if;
  if not current_user_is_admin_or_manager_of(v_acc) then raise exception 'no autorizado'; end if;
  if p_status not in ('draft','approved','discarded') then raise exception 'estado no permitido: %', p_status; end if;
  if v_cur in ('publishing','published') then raise exception 'no se puede cambiar un post en publicacion'; end if;
  update social_post set status = p_status, updated_at = now() where id = p_post_id;
end $$;

create or replace function public.update_social_post_content(p_post_id uuid, p_copy text, p_hashtags text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_cur text;
begin
  select account_id, status into v_acc, v_cur from social_post where id = p_post_id;
  if v_acc is null then raise exception 'post no encontrado'; end if;
  if not current_user_is_admin_or_manager_of(v_acc) then raise exception 'no autorizado'; end if;
  if v_cur in ('publishing','published') then raise exception 'no editable en este estado'; end if;
  update social_post
     set payload = jsonb_set(
                     jsonb_set(payload, '{copy}',     to_jsonb(coalesce(p_copy,''))),
                     '{hashtags}', coalesce(to_jsonb(p_hashtags), '[]'::jsonb)),
         updated_at = now()
   where id = p_post_id;
end $$;

create or replace function public.requeue_social_image(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_cur text;
begin
  select account_id, status into v_acc, v_cur from social_post where id = p_post_id;
  if v_acc is null then raise exception 'post no encontrado'; end if;
  if not current_user_is_admin_or_manager_of(v_acc) then raise exception 'no autorizado'; end if;
  if v_cur in ('publishing','published') then raise exception 'no en este estado'; end if;
  update social_post set payload = jsonb_set(payload, '{image_level}', to_jsonb('N1-pendiente'::text)),
         updated_at = now() where id = p_post_id;
end $$;

create or replace function public.regenerate_social_copy(p_post_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_cur text; p jsonb; v_pillar text; v_plato text; v_marca text;
        v_anon boolean; v_tpl text; v_new text; v_pct numeric;
begin
  select account_id, status, payload into v_acc, v_cur, p from social_post where id = p_post_id;
  if v_acc is null then raise exception 'post no encontrado'; end if;
  if not current_user_is_admin_or_manager_of(v_acc) then raise exception 'no autorizado'; end if;
  if v_cur in ('publishing','published') then raise exception 'no en este estado'; end if;

  v_anon  := coalesce((p->>'brand_anonymous')::boolean, false);
  v_tpl   := coalesce(p->>'template', 'apetito');
  v_plato := coalesce(p->>'star_item', '');
  v_marca := coalesce(p->>'brand_name', '');
  v_pillar := case when v_anon then 'cedida'
                   when v_tpl = 'oferta' then 'oferta'
                   when v_tpl = 'curiosidad' then 'curiosidad'
                   else 'apetito' end;

  v_new := public.pick_social_copy(v_pillar, v_acc);
  if v_new is null then v_new := '{plato} — pídelo en foodint.es 🔥'; end if;

  select c.value into v_pct from coupon c where c.id = nullif(p->>'coupon_id','')::uuid;
  v_new := replace(replace(replace(v_new, '{plato}', v_plato), '{marca}', v_marca),
                   '{pct}', coalesce(v_pct::text, ''));

  update social_post set payload = jsonb_set(payload, '{copy}', to_jsonb(v_new)), updated_at = now()
   where id = p_post_id;
  return v_new;
end $$;

revoke all on function public.set_social_post_status(uuid, text)             from public, anon;
revoke all on function public.update_social_post_content(uuid, text, text[]) from public, anon;
revoke all on function public.requeue_social_image(uuid)                     from public, anon;
revoke all on function public.regenerate_social_copy(uuid)                   from public, anon;
grant execute on function public.set_social_post_status(uuid, text)             to authenticated;
grant execute on function public.update_social_post_content(uuid, text, text[]) to authenticated;
grant execute on function public.requeue_social_image(uuid)                     to authenticated;
grant execute on function public.regenerate_social_copy(uuid)                   to authenticated;

commit;
