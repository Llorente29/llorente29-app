-- 20260725T1310_kpi_cocina_panel_rpc.sql
-- ============================================================================
-- KPI DE COCINA — RPC del PANEL DE TIEMPOS (server-side). PROPUESTA.
-- ============================================================================
-- TIEMPO DE COCINA = ready_at − accepted_at (minutos). Scope POR LOCAL (nunca un
-- número global que mezcle locales/marcas: "Alcalá vs Carabanchel" = la UI llama una
-- vez por local). SECURITY DEFINER + guard belongs_to_account.
--
-- EXCLUYE (obligatorio): cancelados/rechazados/fallidos; programados (heurística [D1]:
-- expected_time > accepted_at + 45'); y sin ready_at (sin gesto = sin medición, nunca
-- se rellena; solo cuentan en el denominador de adopción).
--
-- ADOPCIÓN destacada: % de pedidos elegibles con "Listo". < 80% => representativo=false
-- y el panel avisa de que el dato NO es fiable. [D2] objetivo = <= amber.
--
-- APLICADA en producción vía MCP el 25/07/2026 y verificada: el guard belongs_to_account
-- bloquea sin sesión; el cómputo produce forma válida y robusta en set vacío (medianas
-- null, divisiones protegidas). Idempotente.
-- ============================================================================

create or replace function public.kitchen_time_stats(
  p_location_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c_prog_gap constant interval := interval '45 minutes';
  v_account_id uuid;
  v_tz         text;
  v_cfg        kitchen_time_config;
  v_result     jsonb;
begin
  if p_location_id is null or p_from is null or p_to is null then
    raise exception 'kitchen_time_stats: faltan parámetros (location, from, to)';
  end if;
  select account_id into v_account_id from locations where id = p_location_id;
  if v_account_id is null then raise exception 'kitchen_time_stats: ubicación inexistente'; end if;
  if not belongs_to_account(v_account_id) then raise exception 'kitchen_time_stats: sin acceso'; end if;

  select coalesce(a.timezone, 'Europe/Madrid') into v_tz from accounts a where a.id = v_account_id;
  select * into v_cfg from kitchen_time_config where location_id = p_location_id;

  with base as (
    select
      s.id, s.brand_id, s.accepted_at, s.ready_at,
      (s.accepted_at at time zone v_tz) as accepted_local,
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
      and coalesce(s.accepted_at, s.sold_at, s.created_at) >= p_from
      and coalesce(s.accepted_at, s.sold_at, s.created_at) <  p_to
  ),
  medibles as (
    select b.*, b.cook_min as t
    from base b
    where b.elegible and b.cook_min is not null
      and b.cook_min >= coalesce(v_cfg.floor_minutes, 0)
  )
  select jsonb_build_object(
    'location_id', p_location_id,
    'from', p_from, 'to', p_to,
    'config', case when v_cfg.location_id is null then null else jsonb_build_object(
      'green_max_minutes', v_cfg.green_max_minutes,
      'amber_max_minutes', v_cfg.amber_max_minutes,
      'ceiling_minutes',   v_cfg.ceiling_minutes,
      'floor_minutes',     v_cfg.floor_minutes,
      'enabled',           v_cfg.enabled
    ) end,

    'summary', (
      select jsonb_build_object(
        'n_medidos',       count(*),
        'mediana_min',     round(percentile_cont(0.5) within group (order by t)::numeric, 1),
        'peor_min',        round(max(t)::numeric, 1),
        'pct_en_objetivo', case when count(*) = 0 then null
                                else round(100.0 * count(*) filter (where t <= v_cfg.amber_max_minutes) / count(*), 0) end,
        'pct_en_verde',    case when count(*) = 0 then null
                                else round(100.0 * count(*) filter (where t <= v_cfg.green_max_minutes) / count(*), 0) end,
        'pct_sobre_techo', case when count(*) = 0 then null
                                else round(100.0 * count(*) filter (where t > v_cfg.ceiling_minutes) / count(*), 0) end
      ) from medibles
    ),

    'adopcion', (
      select jsonb_build_object(
        'elegibles',      count(*) filter (where elegible),
        'con_listo',      count(*) filter (where elegible and ready_at is not null),
        'pct',            case when count(*) filter (where elegible) = 0 then null
                               else round(100.0 * count(*) filter (where elegible and ready_at is not null)
                                                / count(*) filter (where elegible), 0) end,
        'representativo', (count(*) filter (where elegible) > 0
                           and count(*) filter (where elegible and ready_at is not null)::numeric
                               / nullif(count(*) filter (where elegible), 0) >= 0.80)
      ) from base
    ),

    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', hh, 'n', n, 'mediana_min', med) order by hh)
      from (
        select extract(hour from accepted_local)::int as hh, count(*) as n,
               round(percentile_cont(0.5) within group (order by t)::numeric, 1) as med
        from medibles group by 1
      ) q
    ), '[]'::jsonb),

    'por_marca', coalesce((
      select jsonb_agg(jsonb_build_object('brand_id', brand_id, 'brand', brand_name, 'n', n, 'mediana_min', med) order by med desc)
      from (
        select m.brand_id, b.name as brand_name, count(*) as n,
               round(percentile_cont(0.5) within group (order by m.t)::numeric, 1) as med
        from medibles m left join brand b on b.id = m.brand_id
        group by m.brand_id, b.name
      ) q
    ), '[]'::jsonb),

    'tendencia_semanal', coalesce((
      select jsonb_agg(jsonb_build_object('semana', wk, 'n', n, 'mediana_min', med, 'pct_en_objetivo', pct_obj) order by wk)
      from (
        select date_trunc('week', accepted_local)::date as wk, count(*) as n,
               round(percentile_cont(0.5) within group (order by t)::numeric, 1) as med,
               round(100.0 * count(*) filter (where t <= v_cfg.amber_max_minutes) / count(*), 0) as pct_obj
        from medibles group by 1
      ) q
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

grant execute on function public.kitchen_time_stats(uuid, timestamptz, timestamptz) to authenticated;
