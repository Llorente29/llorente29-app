-- 20260730T1780_closed_brands.sql
-- ============================================================================
-- CAP. B — indicador AMBIENTAL de marcas cerradas (§9-C). Antes el estado de
-- una marca solo se veía DENTRO del modal de BrandCloseControl, tras
-- buscarla a mano. Esta RPC lista las marcas EFECTIVAMENTE cerradas ahora,
-- para mostrarlas siempre visibles en Disponibilidad — mismo espíritu que
-- location_status/LocationStatusCard para el cierre de local (Cap. C).
--
-- "Efectivamente cerrada" = closure_mode='paused' Y (resume_at es NULL O
-- resume_at aún no ha pasado). Un cierre con duración que ya venció
-- desaparece solo de esta lista aunque brand.closure_mode no se haya
-- reescrito todavía (HubRise ya la reabrió sola vía expires_at) — mismo
-- patrón de lectura-corrige-sin-cron que Cap. C, sin necesitar un cron
-- para poner closure_mode='normal'.
--
-- Doble puerta (sesión | token). DDL sin BEGIN/COMMIT (una sola función).
-- GUARD final: no dar por hecho el CREATE (aviso del runner, ver 1712/1713/1750).
-- Aplicada: —
-- ============================================================================

begin;

create or replace function public.closed_brands(
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
      raise exception 'closed_brands: token de dispositivo no válido';
    end if;
    v_account := v_device.account_id;
  else
    if p_account_id is null then
      raise exception 'closed_brands: falta account_id';
    end if;
    v_account := p_account_id;
    if not (public.current_user_is_admin()
            or public.current_user_is_admin_or_manager_of(v_account)) then
      raise exception 'closed_brands: sin acceso a la cuenta %', v_account;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'brand_id',   b.id,
           'brand_name', b.name,
           'mode',       b.closure_mode,
           'resume_at',  b.closure_resume_at,
           'reason',     b.closure_reason,
           'set_at',     b.closure_set_at
         ) order by b.name), '[]'::jsonb)
    into v_result
  from brand b
  where b.account_id = v_account
    and b.closure_mode = 'paused'
    and (b.closure_resume_at is null or b.closure_resume_at > now());

  return v_result;
end;
$function$;

do $$
begin
  if to_regprocedure('public.closed_brands(uuid, text)') is null then
    raise exception 'closed_brands no quedó creada con la firma esperada (uuid, text)';
  end if;
end $$;

commit;

-- ── VERIFICACIÓN (ejecutar y revisar) ───────────────────────────────────────
-- select id, name, closure_mode, closure_resume_at, closure_set_at from brand
-- where account_id = '<<ACCOUNT_ID>>' and closure_mode = 'paused';
-- Comparar contra select closed_brands('<<ACCOUNT_ID>>', null) — las filas con
-- closure_resume_at ya pasado NO deben aparecer en el jsonb.
