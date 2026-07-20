-- ============================================================================
-- Folvy · F5 — Modo de dispositivo (gate autoritativo del worker) + IP estable
-- Frente: onboarding de impresión. Encargo: claude/ENCARGO_CODE_impresion_onboarding.md
--
-- F3 ya gatea el worker en CLIENTE (localStorage folvy_device_mode). F5 añade el
-- respaldo AUTORITATIVO en BBDD: kds_device.device_mode. La enforcement fuerte
-- vive en claim_print_jobs: un dispositivo que NO es 'estacion' no reclama cola
-- (aunque su worker arrancase por localStorage manipulado, el servidor no le da
-- trabajo). Un móvil de trabajador (modo 'equipo') queda dormido de verdad.
--
-- device_mode default 'estacion' → todos los kds_device existentes siguen
-- imprimiendo sin cambios. Sólo un modo != estacion apaga el worker.
-- ============================================================================

-- ── 1) Columna device_mode en kds_device ─────────────────────────────────────
alter table public.kds_device
  add column if not exists device_mode text not null default 'estacion';

alter table public.kds_device drop constraint if exists kds_device_device_mode_chk;
alter table public.kds_device add constraint kds_device_device_mode_chk
  check (device_mode in ('estacion','equipo','gestion'));

comment on column public.kds_device.device_mode is
  'Modo del dispositivo: estacion (imprime/cocina) | equipo | gestion. Sólo estacion reclama la cola de impresión.';

-- ── 2) claim_print_jobs re-versionado (verbatim de F1 + gate por device_mode) ─
create or replace function public.claim_print_jobs(p_device_token text, p_limit integer DEFAULT 10)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_jobs    jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'claim_print_jobs: token no válido';
  end if;

  -- GATE F5: sólo una estación reclama cola. Otros modos (equipo/gestion) → nada.
  if v_device.device_mode is distinct from 'estacion' then
    return '[]'::jsonb;
  end if;

  update kds_device set last_seen_at = now() where id = v_device.id;

  with pend as (
    select j.id
    from print_job j
    join printer p on p.id = j.printer_id
    where j.account_id  = v_device.account_id
      and j.location_id = v_device.location_id
      and j.status = 'pending'
      and p.is_active
      and p.transport = 'escpos_network'
    order by j.created_at
    limit p_limit
    for update skip locked
  ),
  upd as (
    update print_job j
    set status = 'sent', sent_at = now(), attempts = attempts + 1
    from pend
    where j.id = pend.id
    returning j.id, j.printer_id, j.doc_type, j.payload
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id',   u.id,
           'doc_type', u.doc_type,
           'payload',  u.payload,
           'printer',  jsonb_build_object(
                         'id',   p.id,
                         'name', p.name,
                         'ip',   p.config->>'ip',
                         'port', coalesce((p.config->>'port')::int, 9100)
                       )
         )), '[]'::jsonb)
  into v_jobs
  from upd u
  join printer p on p.id = u.printer_id;

  return v_jobs;
end;
$function$;

-- ── 3) Setter by-token: la Estación estampa su modo en BBDD al vincular ───────
create or replace function public.set_device_mode_by_token(p_device_token text, p_mode text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device kds_device;
begin
  if p_mode not in ('estacion','equipo','gestion') then
    raise exception 'set_device_mode_by_token: modo no válido: %', p_mode;
  end if;
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'set_device_mode_by_token: token no válido';
  end if;
  update kds_device set device_mode = p_mode, updated_at = now() where id = v_device.id;
end;
$function$;

grant execute on function public.set_device_mode_by_token(text, text) to anon;

-- ============================================================================
-- FIN F5 (backend). El aviso de "reservar IP fija" (DHCP por MAC) va en la
-- pantalla de impresoras (frontend). F6: regenerar database.ts + distribución.
-- ============================================================================
