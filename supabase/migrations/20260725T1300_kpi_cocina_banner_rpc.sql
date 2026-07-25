-- 20260725T1300_kpi_cocina_banner_rpc.sql
-- ============================================================================
-- KPI DE COCINA — BANNER DEL DÍA (media colectiva, server-side). PROPUESTA.
-- ============================================================================
-- El banner que ve la COCINA arriba de Pedidos: "🍳 Media de hoy: X min · N pedidos
-- · objetivo Y". COLECTIVO (nunca por persona). Del día en curso (business day, 4am
-- cutoff) y del local de la sesión/dispositivo. Dos variantes (sesión y token) para
-- que funcione también en la Estación por token. Devuelve también los UMBRALES del
-- local (el chip los toma de aquí, con fallback a defaults en el front).
--
-- GUARDA DE MUESTRA MÍNIMA (obligatoria): con pocos "Listo" pulsados la media miente
-- y premiaría no pulsar. `suficiente`=false si n_medidos < 10 O adopción < 50%. En
-- ese caso el front muestra "aún sin datos suficientes · N de M marcados".
--
-- TIEMPO DE COCINA = ready_at − accepted_at. Excluye cancelados, programados
-- (heurística [D1] expected_time > accepted_at + 45') y sin ready_at (sin gesto = sin
-- medición). Objetivo del banner = green_max (el ideal a batir; ajustado en prod tras
-- la primera prueba — el banner motiva hacia el verde, distinto del panel donde
-- "dentro de objetivo" = ≤ amber = "no tarde"). Idempotente.
--
-- APLICADA en producción vía MCP el 25/07/2026 y verificada en vivo: Alcalá hoy 14
-- medidos, mediana 22 min, 16 elegibles. Este fichero refleja la definición VIVA
-- (pg_get_functiondef), incluida la corrección objetivo→green_max.
-- ============================================================================

-- Helper interno: calcula el banner del día para un local. SECURITY DEFINER (lo llaman
-- las dos variantes con guarda propia; no se expone directamente sin guarda).
create or replace function public._kitchen_day_banner_for(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_min_sample   constant int      := 10;                 -- muestra mínima de "Listo"
  c_min_adoption constant numeric  := 0.5;                -- o >= 50% del día marcado
  c_prog_gap     constant interval := interval '45 minutes';
  v_account_id uuid;
  v_tz         text;
  v_cutoff     interval := make_interval(hours => 4);
  v_day_start  timestamptz;
  v_cfg        kitchen_time_config;
  v_n_medidos  int;
  v_n_elegibles int;
  v_mediana    numeric;
begin
  select account_id into v_account_id from locations where id = p_location_id;
  if v_account_id is null then return null; end if;
  select coalesce(a.timezone, 'Europe/Madrid') into v_tz from accounts a where a.id = v_account_id;
  v_day_start := (date_trunc('day', (now() at time zone v_tz) - v_cutoff) + v_cutoff) at time zone v_tz;
  select * into v_cfg from kitchen_time_config where location_id = p_location_id;

  with base as (
    select
      s.accepted_at, s.ready_at,
      case
        when s.order_status in ('cancelled','rejected','delivery_failed') then false
        when s.accepted_at is null then false
        when s.expected_time is not null and s.expected_time > s.accepted_at + c_prog_gap then false
        else true
      end as elegible,
      case when s.ready_at is not null and s.accepted_at is not null
           then extract(epoch from (s.ready_at - s.accepted_at)) / 60.0 end as cook_min
    from sale s
    where s.location_id = p_location_id
      and s.account_id  = v_account_id
      and coalesce(s.accepted_at, s.sold_at, s.created_at) >= v_day_start
      and coalesce(s.accepted_at, s.sold_at, s.created_at) <  v_day_start + interval '1 day'
  ),
  med as (
    select cook_min as t from base
    where elegible and cook_min is not null and cook_min >= coalesce(v_cfg.floor_minutes, 0)
  )
  select
    (select count(*) from med),
    (select count(*) from base where elegible),
    (select round(percentile_cont(0.5) within group (order by t)::numeric, 0) from med)
  into v_n_medidos, v_n_elegibles, v_mediana;

  return jsonb_build_object(
    'location_id',  p_location_id,
    'objetivo_min', v_cfg.green_max_minutes,
    'n_medidos',    coalesce(v_n_medidos, 0),
    'n_elegibles',  coalesce(v_n_elegibles, 0),
    'mediana_min',  v_mediana,
    'suficiente',   (coalesce(v_n_medidos,0) >= c_min_sample
                     and (coalesce(v_n_elegibles,0) = 0
                          or v_n_medidos::numeric / v_n_elegibles >= c_min_adoption)),
    'bajo_objetivo', case when v_mediana is null then null
                          else v_mediana <= v_cfg.green_max_minutes end,
    'config', case when v_cfg.location_id is null then null else jsonb_build_object(
      'green_max_minutes', v_cfg.green_max_minutes,
      'amber_max_minutes', v_cfg.amber_max_minutes,
      'ceiling_minutes',   v_cfg.ceiling_minutes,
      'floor_minutes',     v_cfg.floor_minutes,
      'enabled',           v_cfg.enabled
    ) end
  );
end;
$function$;

-- Variante SESIÓN (gestor/estación con login) — guard belongs_to_account.
create or replace function public.kitchen_day_banner(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_account_id uuid;
begin
  select account_id into v_account_id from locations where id = p_location_id;
  if v_account_id is null then raise exception 'kitchen_day_banner: ubicación inexistente'; end if;
  if not belongs_to_account(v_account_id) then raise exception 'kitchen_day_banner: sin acceso'; end if;
  return public._kitchen_day_banner_for(p_location_id);
end;
$function$;
grant execute on function public.kitchen_day_banner(uuid) to authenticated;

-- Variante TOKEN (Estación de tablet, sin sesión) — el local sale del dispositivo.
create or replace function public.kitchen_day_banner_by_token(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'kitchen_day_banner_by_token: token no válido'; end if;
  if v_device.location_id is null then raise exception 'kitchen_day_banner_by_token: dispositivo sin local'; end if;
  return public._kitchen_day_banner_for(v_device.location_id);
end;
$function$;
grant execute on function public.kitchen_day_banner_by_token(text) to anon, authenticated;
