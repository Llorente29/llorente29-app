-- 20260730T1790_anomalous_brand_closures.sql
-- ============================================================================
-- CAP. B — PATA 3: aviso al cocinero en Pedidos. RPC de lectura para la
-- ESCALADA a alarma: cierres de marca ANÓMALOS (mismo criterio que ya usa
-- availability-watchdog por email — checkStaleBrandClosures — pero aquí
-- consultable desde el frontend para pintar un banner en pantalla, que hoy
-- NO existe: el watchdog solo manda email a operaciones, no hay superficie
-- en la app). Cierre correcto (con hora futura) -> NO aparece aquí (eso lo
-- cubre closed_brands, chip discreto). Solo indefinido >24h o vencido.
--
-- Doble puerta (sesión | token). DDL sin BEGIN/COMMIT (una sola función).
-- GUARD final: no dar por hecho el CREATE (aviso del runner, ver 1712/1713/1750).
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.anomalous_brand_closures(
  p_account_id uuid default null,
  p_token      text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_account uuid;
  v_result  jsonb;
begin
  if p_token is not null then
    v_device := public.kds_resolve_device(p_token);
    if v_device.id is null then
      raise exception 'anomalous_brand_closures: token de dispositivo no válido';
    end if;
    v_account := v_device.account_id;
  else
    if p_account_id is null then
      raise exception 'anomalous_brand_closures: falta account_id';
    end if;
    v_account := p_account_id;
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'anomalous_brand_closures: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id',   b.id,
           'brand_name', b.name,
           'resume_at',  b.closure_resume_at,
           'set_at',     b.closure_set_at,
           'reason',     b.closure_reason,
           'kind',       case when b.closure_resume_at is null then 'indefinite' else 'expired' end
         ) order by b.name), '[]'::jsonb)
    into v_result
  from brand b
  where b.account_id = v_account
    and b.closure_mode = 'paused'
    and (
      (b.closure_resume_at is null and b.closure_set_at < now() - interval '24 hours')
      or (b.closure_resume_at is not null and b.closure_resume_at < now())
    );

  return v_result;
end;
$function$;

do $$
begin
  if to_regprocedure('public.anomalous_brand_closures(uuid, text)') is null then
    raise exception 'anomalous_brand_closures no quedó creada con la firma esperada (uuid, text)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select id, name, closure_mode, closure_resume_at, closure_set_at from brand
-- where account_id = '<<ACCOUNT_ID>>' and closure_mode = 'paused';
-- Comparar contra select anomalous_brand_closures('<<ACCOUNT_ID>>', null) —
-- solo deben aparecer las indefinidas >24h o con resume_at ya pasado.
