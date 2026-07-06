-- 20260706T1405_pick_social_copy.sql
-- Tramo 4 · Pieza 2 — RRSS voz viva
--
-- Devuelve una frase del banco (social_copy) por ROTACIÓN JUSTA PONDERADA (menos usada primero,
-- respetando weight), prefiriendo la voz PROPIA de la cuenta sobre la global, y suma el uso.
-- La llama el social-agent con service_role. SECURITY DEFINER, no usa auth.uid().

begin;

create or replace function public.pick_social_copy(
  p_pillar text, p_account_id uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_text text;
  v_has_own boolean;
begin
  select exists(
    select 1 from social_copy
     where pillar = p_pillar and is_active and account_id = p_account_id
  ) into v_has_own;

  select id, text into v_id, v_text
    from social_copy
   where pillar = p_pillar and is_active
     and ( (v_has_own and account_id = p_account_id)
        or (not v_has_own and account_id is null) )
   order by (times_used::numeric / greatest(weight,1)) asc, random()
   limit 1;

  if v_id is null then
    return null;
  end if;

  update social_copy set times_used = times_used + 1 where id = v_id;
  return v_text;
end $$;

revoke all on function public.pick_social_copy(text, uuid) from public, anon, authenticated;
grant execute on function public.pick_social_copy(text, uuid) to service_role;

commit;
