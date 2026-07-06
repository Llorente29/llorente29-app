-- 20260706T1210_social_image_job_rpcs.sql
-- Tramo 1 · Op 2a — RRSS fábrica de imágenes N1
--
-- RPCs que mueven el trabajo de composición. Las llama SOLO el Edge (service_role);
-- el worker residente nunca toca la BD directamente (solo habla por secreto con los Edges).
--   claim_next_image_job()  → coge atómico el siguiente borrador N1-pendiente (FOR UPDATE
--                             SKIP LOCKED), lo marca N1-procesando y devuelve lo necesario.
--   finish_image_job(post,url) → deja image_url = compuesta e image_level = 'N1'.
--   fail_image_job(post,err)   → marca N1-error con el motivo (no se queda colgado).
-- SECURITY DEFINER pero NO usan auth.uid() → seguras de crear en transacción; se verifican aparte.

begin;

create or replace function public.claim_next_image_job()
returns table(post_id uuid, account_id uuid, hero_url text, template text,
              dish text, brand_anonymous boolean, discount_pct numeric)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from social_post
   where status = 'draft' and payload->>'image_level' = 'N1-pendiente'
   order by created_at
   for update skip locked
   limit 1;
  if v_id is null then return; end if;

  update social_post
     set payload = jsonb_set(payload, '{image_level}', to_jsonb('N1-procesando'::text)),
         updated_at = now()
   where id = v_id;

  return query
    select sp.id, sp.account_id,
           sp.payload->>'image_url',
           coalesce(sp.payload->>'template', 'apetito'),
           sp.payload->>'star_item',
           coalesce((sp.payload->>'brand_anonymous')::boolean, false),
           c.value
      from social_post sp
      left join coupon c on c.id = nullif(sp.payload->>'coupon_id','')::uuid
     where sp.id = v_id;
end $$;

create or replace function public.finish_image_job(p_post_id uuid, p_public_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update social_post
     set payload = jsonb_set(
                     jsonb_set(payload, '{image_url}',   to_jsonb(p_public_url)),
                     '{image_level}', to_jsonb('N1'::text)),
         updated_at = now()
   where id = p_post_id;
end $$;

create or replace function public.fail_image_job(p_post_id uuid, p_err text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update social_post
     set payload = jsonb_set(
                     jsonb_set(payload, '{image_level}', to_jsonb('N1-error'::text)),
                     '{image_error}', to_jsonb(left(coalesce(p_err,''), 400))),
         updated_at = now()
   where id = p_post_id;
end $$;

revoke all on function public.claim_next_image_job()            from public, anon, authenticated;
revoke all on function public.finish_image_job(uuid, text)      from public, anon, authenticated;
revoke all on function public.fail_image_job(uuid, text)        from public, anon, authenticated;
grant execute on function public.claim_next_image_job()         to service_role;
grant execute on function public.finish_image_job(uuid, text)   to service_role;
grant execute on function public.fail_image_job(uuid, text)     to service_role;

commit;
