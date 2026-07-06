-- 20260706T2200_social_scene.sql
-- Módulo Social · N2 · Capa 1a — biblioteca de escenas (editable, reversible)
--
-- Filosofía "voz viva" aplicada a las escenas: prompts editables desde Ajustes, activar/
-- desactivar sin borrar, añadir las propias, ajustar pesos. Dos modos:
--   dress → VESTIR: Gemini cambia solo el entorno; el plato es el REAL, intocable.
--   mood  → AMBIENTE: la IA imagina la escena (persona comiendo, calle...); la comida de esa
--           imagen es GENERADA = contenido de marca, se etiqueta como tal, uso con mesura.
-- n2_mood_ratio: 1 de cada N publicaciones es mood (0 = nunca mood, solo vestir).

begin;

alter table public.social_config
  add column if not exists n2_mood_ratio int not null default 5;

create table if not exists public.social_scene (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) on delete cascade,   -- NULL = global
  mode        text not null check (mode in ('dress','mood')),
  label       text not null,
  prompt      text not null,
  is_active   boolean not null default true,
  weight      int not null default 1 check (weight >= 1),
  lang        text not null default 'es',
  times_used  int not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists ix_social_scene_pick on public.social_scene (mode, is_active, account_id);

alter table public.social_scene enable row level security;
drop policy if exists social_scene_select on public.social_scene;
create policy social_scene_select on public.social_scene
  for select using (account_id is null or belongs_to_account(account_id));
drop policy if exists social_scene_write on public.social_scene;
create policy social_scene_write on public.social_scene
  for all using (account_id is not null and current_user_is_admin_or_manager_of(account_id))
  with check (account_id is not null and current_user_is_admin_or_manager_of(account_id));

create or replace function public.pick_social_scene(p_mode text, p_account_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_prompt text; v_has_own boolean;
begin
  select exists(select 1 from social_scene where mode = p_mode and is_active and account_id = p_account_id)
    into v_has_own;
  select id, prompt into v_id, v_prompt from social_scene
   where mode = p_mode and is_active
     and ((v_has_own and account_id = p_account_id) or (not v_has_own and account_id is null))
   order by (times_used::numeric / greatest(weight,1)) asc, random()
   limit 1;
  if v_id is null then return null; end if;
  update social_scene set times_used = times_used + 1 where id = v_id;
  return v_prompt;
end $$;
revoke all on function public.pick_social_scene(text, uuid) from public, anon, authenticated;
grant  execute on function public.pick_social_scene(text, uuid) to service_role;

insert into public.social_scene (account_id, mode, label, prompt) values
(null,'dress','Mesa oscura de local','Keep the exact same dish completely untouched and identical; only replace the plain studio background with a dark moody restaurant table, warm ambient lighting, soft shadows, shallow depth of field, photorealistic.'),
(null,'dress','Neón urbano','Keep the food exactly as-is, do not alter the dish; replace only the background with a dark urban scene lit by subtle warm neon glow, night vibe, cinematic, photorealistic.'),
(null,'dress','Tabla de madera','Preserve the dish exactly; place it on a rustic dark wooden board with moody warm side lighting and a hint of steam, blurred dark background, photorealistic.'),
(null,'dress','Barra street food','Keep the dish identical and untouched; set it on a street-food counter at night with blurred city bokeh lights behind, warm tones, photorealistic.'),
(null,'mood','Chica joven comiendo','A young person joyfully taking a bite of street food similar to the reference, candid urban style, natural warm light, shallow depth of field, photorealistic lifestyle shot.'),
(null,'mood','Puesto callejero nocturno','A vibrant night street-food stall serving food similar to the reference, glowing neon signs, lively crowd in the background, cinematic, photorealistic.'),
(null,'mood','Amigos de noche','A group of friends sharing street food similar to the reference on an urban rooftop at night, laughing, warm string lights, candid lifestyle, photorealistic.');

commit;
