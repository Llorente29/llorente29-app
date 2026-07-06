-- 20260706T1400_social_copy.sql
-- Tramo 4 · Pieza 1 — RRSS voz viva del agente
--
-- Banco de copys editable (no frases a fuego en el código). El agente lee de aquí por
-- rotación justa ponderada y rellena {plato}/{marca}/{pct}. Base para que la voz EVOLUCIONE
-- sin tocar código ni redesplegar.
--   account_id NULL = voz global (compartida por todos los clientes); no NULL = voz propia.
-- Guardarraíles POR CONSTRUCCIÓN (la BD los impone, no la confianza):
--   · una frase de 'cedida' NO puede contener {marca} (jamás se nombra la cedida).
--   · {pct} solo puede aparecer en pilar 'oferta' (anti-invención de precios).

begin;

create table if not exists public.social_copy (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references accounts(id) on delete cascade,   -- NULL = voz global (compartida)
  pillar      text not null check (pillar in
                ('apetito','curiosidad','cedida','evento_calor','evento_lluvia','evento_generico','oferta')),
  template    text not null default 'apetito' check (template in ('apetito','curiosidad','oferta')),
  text        text not null,
  is_active   boolean not null default true,
  weight      int not null default 1 check (weight >= 1),
  lang        text not null default 'es',
  times_used  int not null default 0,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  constraint social_copy_cedida_sin_marca check (pillar <> 'cedida' or position('{marca}' in text) = 0),
  constraint social_copy_pct_solo_oferta  check (pillar =  'oferta' or position('{pct}'  in text) = 0)
);

create index if not exists ix_social_copy_pick on public.social_copy (pillar, is_active, account_id);

alter table public.social_copy enable row level security;

drop policy if exists social_copy_select on public.social_copy;
create policy social_copy_select on public.social_copy
  for select using (account_id is null or belongs_to_account(account_id));

drop policy if exists social_copy_write on public.social_copy;
create policy social_copy_write on public.social_copy
  for all using (account_id is not null and current_user_is_admin_or_manager_of(account_id))
  with check (account_id is not null and current_user_is_admin_or_manager_of(account_id));

-- ── SEED de la voz de arranque (GLOBAL, account_id = NULL). Calle, humor, sin jerga.
insert into public.social_copy (account_id, pillar, template, text) values
(null,'apetito','apetito','Buah. {plato} de {marca} 🤤 Esto no es hambre, es ansia. Directo de cocina, sin intermediarios — link en la bio.'),
(null,'apetito','apetito','Ojito 👀 {plato} de {marca}. El que avisa no es traidor: como lo veas, lo pides. Link en la bio 🔥'),
(null,'apetito','apetito','Para de scrollear 🛑 {plato} de {marca} recién hecho. Directo a tu puerta, sin apps de por medio. Link en la bio.'),
(null,'apetito','apetito','{plato} de {marca} 🔥 Aviso: esto quita el hambre y pone el vicio. Pídelo directo en la bio 🛵'),
(null,'apetito','apetito','Esto es {plato} de {marca} 🤤 Y sí, está tan bueno como se ve. Link en la bio.'),
(null,'curiosidad','curiosidad','Dime que no se te ha ido el ojo 👀 {plato} de {marca}. Mentira, se te ha ido. Link en la bio.'),
(null,'curiosidad','curiosidad','¿{plato} de {marca}? Puede ser lo mejor que pidas hoy 😏 Tú decides. Link en la bio.'),
(null,'curiosidad','curiosidad','Adivina qué vas a cenar 👀 Pista: {plato} de {marca}. Link en la bio 🔥'),
(null,'curiosidad','curiosidad','Te presento a tu antojo de esta noche: {plato} de {marca} 🤤 Link en la bio.'),
(null,'cedida','apetito','Esto es delito 🔥 {plato} recién hecho, directo a tu puerta. Link en la bio.'),
(null,'cedida','apetito','Ojito con esto 👀 {plato}. Del horno a tu casa, sin intermediarios. Link en la bio 🛵'),
(null,'cedida','apetito','Para de scrollear 🛑 {plato} tal cual sale de cocina. Lo pides directo en la bio.'),
(null,'cedida','apetito','{plato} 🤤 No es hambre, es ansia. Directo a tu puerta — link en la bio.'),
(null,'evento_calor','apetito','Con este calor no enciendes tú el fuego ni de coña 🥵 {plato} de {marca} directo a tu puerta. Link en la bio 🛵'),
(null,'evento_calor','apetito','Hace un calor de morirse 🥵 Hoy no cocinas. {plato} de {marca} a domicilio — link en la bio.'),
(null,'evento_lluvia','apetito','Llueve y no piensas moverte ☔ Bien hecho. {plato} de {marca} directo a tu sofá. Link en la bio.'),
(null,'evento_lluvia','apetito','Día de manta y peli 🌧️ De cocinar, nada. {plato} de {marca} a tu puerta — link en la bio.'),
(null,'evento_generico','apetito','Hoy el plan es no cocinar 😎 {plato} de {marca} directo de cocina. Link en la bio 🛵'),
(null,'evento_generico','apetito','Modo ansia activado 🤤 {plato} de {marca} a tu puerta. Link en la bio.'),
(null,'oferta','oferta','{pct}% en {plato} de {marca} 🔥 Pero SOLO pidiendo directo en foodint.es. En las apps ni lo mires 😈'),
(null,'oferta','oferta','Ese {plato} de {marca} que te gusta, ahora {pct}% más barato 🤤 Solo en foodint.es — link en la bio.'),
(null,'oferta','oferta','{pct}% de descuentazo en {plato} de {marca} 🔥 Directo, sin intermediarios, en foodint.es 😈');

commit;
