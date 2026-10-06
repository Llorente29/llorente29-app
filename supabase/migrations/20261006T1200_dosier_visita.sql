-- Seguimiento de visitas del dosier comercial (https://dosier.folvy.app).
-- Dato de PLATAFORMA, no de cliente: sin account_id.
-- RLS activada SIN políticas: solo la Edge Function `dosier-track` (service role)
-- lee y escribe. anon/authenticated no ven nada.
-- No se guarda IP: solo visitor_hash = sha256(ip|user-agent|DOSIER_SALT).

create table if not exists public.dosier_visita (
  sid          uuid primary key,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  visitor_hash text not null,
  es_nuevo     boolean not null,
  dispositivo  text,
  navegador    text,
  origen       text,
  src          text,
  ancho        int,
  scroll_max   int,
  segundos     int,
  secciones    text[],
  pdf          boolean not null default false,
  avisado_at   timestamptz
);

create index if not exists dosier_visita_visitor_hash_idx
  on public.dosier_visita (visitor_hash);
create index if not exists dosier_visita_created_at_idx
  on public.dosier_visita (created_at desc);

alter table public.dosier_visita enable row level security;
-- Sin políticas, a propósito. Se retiran además los privilegios de tabla.
revoke all on public.dosier_visita from anon, authenticated;
