-- 20260621T2100_availability_86.sql
-- ============================================================================
-- 86 / DISPONIBILIDAD — capa canónica (Fase 1).
-- Acción única "agotar / reactivar un producto" que:
--   (a) cascadea CROSS-BRAND: afecta a todos los menu_item de la cuenta que
--       comparten el PRODUCTO FÍSICO = mismo recipe_item_id (platos compartidos)
--       O misma matrícula external_id (bebidas / reventa compartidas);
--   (b) dispara el empuje al canal (Last hoy; HubRise/Otter mañana, mismo dato).
-- reason (manual|stock_out|schedule) deja entrar auto-86 sin tocar la firma.
-- available_until: timer (Fase 2 pg_cron en Last / nativo en HubRise).
--
-- SECURITY DEFINER: esta migración CREA la función pero NO la ejecuta
-- (sin SELECT de prueba) -> segura en el SQL Editor. Se verifica desde la app.
-- Aplicada: 2026-06-21
-- ============================================================================

-- 1) Columnas (defecto null = comportamiento actual intacto) --------------------
alter table public.menu_item
  add column if not exists availability_reason text,
  add column if not exists available_until     timestamptz;

alter table public.menu_item
  drop constraint if exists menu_item_availability_reason_check;
alter table public.menu_item
  add constraint menu_item_availability_reason_check
  check (availability_reason is null
         or availability_reason in ('manual','stock_out','schedule'));

-- 2) Log del empuje (lo escribe el edge availability-dispatch con service_role) --
create table if not exists public.availability_push_log (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null,
  external_org_id         uuid,
  external_catalog_id     uuid,
  catalog_product_id      uuid,
  organization_product_id uuid,            -- matrícula
  enable                  boolean,
  ok                      boolean,
  http_status             int,
  error                   text,
  created_at              timestamptz not null default now()
);

alter table public.availability_push_log enable row level security;

drop policy if exists availability_push_log_read on public.availability_push_log;
create policy availability_push_log_read on public.availability_push_log
  for select using (
    public.current_user_is_admin()
    or public.current_user_is_admin_or_manager_of(account_id)
  );

-- 3) RPC canónica ---------------------------------------------------------------
create or replace function public.set_product_availability(
  p_menu_item_id    uuid,
  p_is_available    boolean,
  p_reason          text        default 'manual',
  p_available_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account_id     uuid;
  v_recipe_item_id uuid;
  v_external_id    text;
  v_matriculas     text[];
  v_affected       int;
  v_brands         int;
  v_channels       int;
begin
  -- resolver producto + identidad física
  select mi.account_id, mi.recipe_item_id, mi.external_id
    into v_account_id, v_recipe_item_id, v_external_id
  from menu_item mi
  where mi.id = p_menu_item_id;

  if v_account_id is null then
    raise exception 'set_product_availability: producto % no encontrado', p_menu_item_id;
  end if;

  -- guard (idéntico a set_order_status / set_menu_item_override)
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_account_id)) then
    raise exception 'set_product_availability: sin acceso a la cuenta %', v_account_id;
  end if;

  if p_reason is null or p_reason not in ('manual','stock_out','schedule') then
    raise exception 'set_product_availability: reason no válido %', p_reason;
  end if;

  -- conjunto hermano CROSS-BRAND (mismo producto físico) + escritura del estado
  with sib as (
    select mi.id
    from menu_item mi
    where mi.account_id = v_account_id
      and (
        (v_recipe_item_id is not null and mi.recipe_item_id = v_recipe_item_id)
        or (v_external_id is not null and mi.external_id = v_external_id)
        or mi.id = p_menu_item_id
      )
  ),
  upd as (
    update menu_item mi
    set is_available        = p_is_available,
        availability_reason = case when p_is_available then null else p_reason end,
        available_until     = case when p_is_available then null else p_available_until end,
        updated_at          = now()
    from sib
    where mi.id = sib.id
    returning mi.brand_id, mi.external_id
  )
  select count(*),
         count(distinct brand_id),
         array_agg(distinct external_id) filter (where external_id is not null)
    into v_affected, v_brands, v_matriculas
  from upd;

  -- canales reales que se tocarán en Last (catálogos por canal de esas matrículas)
  if v_matriculas is not null and array_length(v_matriculas, 1) > 0 then
    select count(distinct ecp.external_channel)
      into v_channels
    from external_catalog_product ecp
    where ecp.account_id = v_account_id
      and ecp.organization_product_id::text = any(v_matriculas);

    -- empuje fire-and-forget al despachador (resuelve catálogos y hace el PUT a Last)
    perform net.http_post(
      url     := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/availability-dispatch',
      headers := jsonb_build_object(
        'Content-Type',                    'application/json',
        'x-availability-dispatch-secret',  '__DISPATCH_SECRET__'
      ),
      body    := jsonb_build_object(
        'account_id', v_account_id,
        'matriculas', to_jsonb(v_matriculas),
        'enable',     p_is_available,
        'reason',     p_reason,
        'internal',   true
      )
    );
  end if;

  return jsonb_build_object(
    'affected_items', coalesce(v_affected, 0),
    'brands',         coalesce(v_brands, 0),
    'channels',       coalesce(v_channels, 0),
    'matriculas',     coalesce(array_length(v_matriculas, 1), 0)
  );
end;
$function$;
