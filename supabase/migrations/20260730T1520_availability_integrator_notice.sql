-- 20260730T1520_availability_integrator_notice.sql
-- ============================================================================
-- AVISO MULTI-INTEGRADOR — al hacer Folvy un 86 (cualquier origen: manual hoy,
-- futuro auto-stock; producto, marca o local), si el local declara que usa
-- OTROS integradores además de Folvy (locations.availability_other_integrators),
-- se levanta un aviso: "[Producto] agotado → desconéctalo también en Last/Otter".
--
-- Folvy NO escribe en esos integradores (decisión de dueño por integración):
-- esto es un RECORDATORIO con acuse, no una integración nueva. Un mecanismo
-- para todos los casos (manual/producto/marca/local/futuro-auto), porque lo
-- inserta la RPC set_product_availability(_by_token) (próxima migración), NO
-- el frontend — así ningún origen del 86 se puede saltar el aviso.
--
-- Mismo patrón "banner con Enterado" que la alarma de reparto no entregado
-- (20260724T2300_kds_alarma_reparto_no_entregado.sql):
--   availability_integrator_notice              -- una fila por 86 avisado
--   availability_notices(location_id, token?)   -- lectura: avisos vivos (sin ack)
--   availability_ack_notice(notice_id, token?)  -- "Hecho": sella el acuse
--
-- Doble puerta (token de dispositivo | sesión) reutilizando kds_authorize
-- (20260613T2400_kds_capa1_b3b_acciones.sql) — es genérico, no exclusivo del
-- KDS: valida token de dispositivo O sesión con acceso al local, devuelve
-- account_id o lanza excepción.
--
-- SECURITY DEFINER. DDL sin BEGIN/COMMIT. Idempotente.
-- Aplicada: —
-- ============================================================================

create table if not exists public.availability_integrator_notice (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null,
  location_id     uuid not null references public.locations(id),

  product_name    text not null,
  external_id     text,          -- matrícula (si el producto físico tiene)
  recipe_item_id  uuid,          -- escandallo (si el producto físico tiene)
  brands          int not null default 0,

  integrators     text[] not null,   -- snapshot de availability_other_integrators en ese instante
  reason          text,              -- availability_reason del 86 que lo disparó (manual|stock_out|schedule)

  raised_at       timestamptz not null default now(),
  raised_by       uuid,              -- user_profiles.id (sesión) o null (token / futuro auto)

  ack_at          timestamptz,
  ack_by          uuid,

  created_at      timestamptz not null default now()
);

-- Solo avisos VIVOS (sin acuse) por local — lo que lee el overlay en bucle.
create index if not exists ix_availability_notice_open
  on public.availability_integrator_notice (location_id, raised_at desc)
  where ack_at is null;

alter table public.availability_integrator_notice enable row level security;

drop policy if exists availability_integrator_notice_read on public.availability_integrator_notice;
create policy availability_integrator_notice_read on public.availability_integrator_notice
  for select using (
    public.current_user_is_admin()
    or public.current_user_is_admin_or_manager_of(account_id)
  );

-- ── Lectura: avisos vivos de un local (doble puerta) ────────────────────────
create or replace function public.availability_notices(
  p_location_id uuid default null,
  p_token       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device kds_device;
  v_loc    uuid;
  v_result jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then raise exception 'availability_notices: token de dispositivo no válido'; end if;
    v_loc := v_device.location_id;
    update kds_device set last_seen_at = now() where id = v_device.id;
  else
    if p_location_id is null then raise exception 'availability_notices: falta location_id'; end if;
    v_loc := p_location_id;
    perform public.kds_authorize(v_loc, null); -- valida sesión (belongs_to_account)
  end if;

  select coalesce(jsonb_agg(row_to_json(n) order by n.raised_at desc), '[]'::jsonb)
    into v_result
  from (
    select id, product_name, external_id, recipe_item_id, brands, integrators, reason, raised_at
    from availability_integrator_notice
    where location_id = v_loc and ack_at is null
  ) n;

  return jsonb_build_object('location_id', v_loc, 'notices', v_result);
end;
$$;

-- ── "Hecho": sella el acuse ──────────────────────────────────────────────────
create or replace function public.availability_ack_notice(
  p_notice_id uuid,
  p_token     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loc  uuid;
  v_user uuid;
begin
  select location_id into v_loc from availability_integrator_notice where id = p_notice_id;
  if v_loc is null then raise exception 'availability_ack_notice: aviso inexistente'; end if;
  perform public.kds_authorize(v_loc, p_token);

  v_user := case when p_token is null then auth.uid() else null end;

  update availability_integrator_notice
  set ack_at = now(),
      ack_by = v_user
  where id = p_notice_id
    and ack_at is null;
end;
$$;
