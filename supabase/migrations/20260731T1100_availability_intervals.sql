-- 20260731T1100_availability_intervals.sql
-- ============================================================================
-- DISPONIBILIDAD · C3a — EMPAREJADO DE INTERVALOS (§1). Convierte el log
-- append-only `availability_event` (C1) en INTERVALOS cerrados por target:
-- para cada 'close', el fin = el siguiente 'open' del MISMO target
-- (account_id, scope, target_key) por occurred_at; sin 'open' posterior ->
-- sigue cerrado (fin = now()).
--
-- target_key = coalesce(target_id::text, target_ext) — la MISMA clave con la
-- que el diseño de C3a identifica un target (local/marca = target_id;
-- producto = target_ext, ya normalizado en C1 a coalesce(external_id,
-- recipe_item_id)).
--
-- ROBUSTEZ (nota del review C1 — la emisión NO es idempotente):
--   · 'close' seguidos sin 'open' intermedio -> el PRIMER close cuenta como
--     inicio del intervalo; los redundantes se ignoran (detectado con
--     lag(action) sobre la partición target: si el evento anterior también
--     fue 'close', este 'close' no abre un intervalo nuevo).
--   · 'open' sin 'close' previo -> nunca genera un intervalo por sí solo (los
--     intervalos SOLO nacen de un 'close'); si acaso, sirve de fin a un
--     'close' anterior real, que es el uso correcto.
--   · Nunca duraciones negativas ni doble conteo: cada 'close' no-redundante
--     empareja como mucho con UN 'open' (el primero posterior).
--
-- FILTROS: origin/location_id/brand_id/scope se aplican DESPUÉS del
-- emparejado (sobre el intervalo ya resuelto), nunca sobre los eventos crudos
-- ANTES de emparejar — filtrar antes rompería el emparejado si el close y el
-- open que lo cierra difieren en esos campos (p.ej. cerrado desde 'oficina'
-- y reabierto desde 'cocina': mismo intervalo, dos orígenes distintos).
--
-- location_id: para scope='brand'/'product' suele venir NULL (el cierre es
-- de cuenta, no de un local concreto — ver C1). El filtro por local NUNCA
-- oculta un intervalo por falta de atribución: solo excluye los que SÍ tienen
-- un location_id conocido y no coincide.
--
-- SECURITY INVOKER (solo lectura, RLS de availability_event ya exige
-- manager/admin de la cuenta — igual que team_demand_profile).
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.availability_intervals(
  p_account_id  uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_scope       text default null,
  p_location_id uuid default null,
  p_brand_id    uuid default null,
  p_origin      text default null
)
returns table (
  scope        text,
  target_key   text,
  target_id    uuid,
  target_ext   text,
  target_label text,
  location_id  uuid,
  origin       text,
  reason_code  text,
  actor_id     uuid,
  started_at   timestamptz,
  ended_at     timestamptz,
  resume_at    timestamptz,
  duration_min numeric
)
language sql
stable
as $function$
  with events as (
    select
      ae.id, ae.scope,
      coalesce(ae.target_id::text, ae.target_ext) as target_key,
      ae.target_id, ae.target_ext, ae.target_label, ae.location_id,
      ae.origin, ae.reason_code, ae.actor_id, ae.action, ae.resume_at, ae.occurred_at
    from public.availability_event ae
    where ae.account_id = p_account_id
  ),
  tagged as (
    select e.*,
      lag(e.action) over (partition by e.scope, e.target_key order by e.occurred_at, e.id) as prev_action
    from events e
  ),
  closes as (
    select * from tagged
    where action = 'close' and prev_action is distinct from 'close'
  ),
  paired as (
    select
      c.scope, c.target_key, c.target_id, c.target_ext, c.target_label, c.location_id,
      c.origin, c.reason_code, c.actor_id, c.resume_at,
      c.occurred_at as started_at,
      coalesce(
        (select min(o.occurred_at) from events o
         where o.scope = c.scope and o.target_key = c.target_key
           and o.action = 'open' and o.occurred_at > c.occurred_at),
        now()
      ) as ended_at
    from closes c
  )
  select
    p.scope, p.target_key, p.target_id, p.target_ext, p.target_label, p.location_id,
    p.origin, p.reason_code, p.actor_id,
    p.started_at, p.ended_at, p.resume_at,
    round((extract(epoch from (p.ended_at - p.started_at)) / 60)::numeric, 1) as duration_min
  from paired p
  where p.started_at < p_to and p.ended_at > p_from
    and (p_scope is null or p.scope = p_scope)
    and (p_location_id is null or p.location_id = p_location_id or p.location_id is null)
    and (p_brand_id is null or (p.scope = 'brand' and p.target_id = p_brand_id))
    and (p_origin is null or p.origin = p_origin)
$function$;

grant execute on function public.availability_intervals(uuid, timestamptz, timestamptz, text, uuid, uuid, text) to authenticated;

-- GUARD: no dar por hecho el CREATE.
do $$
begin
  if to_regprocedure('public.availability_intervals(uuid, timestamptz, timestamptz, text, uuid, uuid, text)') is null then
    raise exception 'availability_intervals no quedó creada con la firma esperada';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- 1) Cierres/reaperturas reales de un local de prueba en el último día:
-- select * from availability_intervals('<<ACCOUNT_ID>>', now() - interval '2 days', now())
-- order by started_at desc limit 20;
--
-- 2) Duración = ended_at - started_at, nunca negativa:
-- select count(*) from availability_intervals('<<ACCOUNT_ID>>', now() - interval '30 days', now())
-- where duration_min < 0;  -- debe ser 0
--
-- 3) Cierres dobles consecutivos (forzar con dos 'close' seguidos en availability_event
-- de prueba) -> confirmar que solo aparece UN intervalo, no dos.
