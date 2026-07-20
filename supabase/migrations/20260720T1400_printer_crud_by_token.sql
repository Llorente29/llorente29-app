-- ============================================================================
-- Folvy · F3 — CRUD de impresoras POR TOKEN (pantalla "Impresoras" in-app)
-- Frente: onboarding de impresión (app única, gateada por rol)
-- Encargo: claude/ENCARGO_CODE_impresion_onboarding.md
--
-- PROPONGO / Julio revisa y aplica. NO aplicada aún.
--
-- Motivo: las RPC de F1 (list_printers/upsert_printer/delete_printer) son de
-- SESIÓN (guard current_user_is_admin_or_manager_of + RLS belongs_to_account).
-- La Estación (/estacion) opera SIN login, identificándose por kds_device.token,
-- igual que availability_*_by_token / order_for_print. Para que el cliente
-- "conecte la impresora desde la app" en la propia tablet, añadimos variantes
-- by-token que derivan cuenta+local DEL DISPOSITIVO (no las reciben del cliente):
-- una tablet SOLO puede ver/editar/borrar impresoras de SU local.
--
-- Reutiliza kds_resolve_device (F1). Mismo cuerpo que las de sesión, cambiando
-- la guarda (token en vez de sesión) y la fuente de account_id/location_id.
-- ============================================================================

-- ── LISTAR (by-token): impresoras del local del dispositivo ──────────────────
create or replace function public.list_printers_by_token(p_device_token text)
 returns jsonb
 language plpgsql
 security definer
 stable
 set search_path to 'public'
as $function$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'list_printers_by_token: token no válido';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',        id,
             'name',      name,
             'transport', transport,
             'ip',        config->>'ip',
             'port',      coalesce((config->>'port')::int, 9100),
             'doc_types', to_jsonb(doc_types),
             'is_active', is_active
           ) order by name), '[]'::jsonb)
    from printer
    where location_id = v_device.location_id
      and account_id  = v_device.account_id
  );
end;
$function$;

-- ── ALTA / EDICIÓN (by-token) ────────────────────────────────────────────────
-- Sin p_account_id/p_location_id: se derivan del dispositivo. En edición, la
-- impresora debe pertenecer al MISMO local del dispositivo (no puede tocar otro).
create or replace function public.upsert_printer_by_token(
  p_device_token text, p_id uuid, p_name text,
  p_config jsonb, p_doc_types text[], p_is_active boolean)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_id     uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'upsert_printer_by_token: token no válido';
  end if;

  if p_id is null then
    insert into printer (account_id, location_id, name, transport, config, doc_types, is_active)
    values (v_device.account_id, v_device.location_id, p_name, 'escpos_network',
            coalesce(p_config,'{}'::jsonb),
            coalesce(p_doc_types, array['bag','kitchen','labels']),
            coalesce(p_is_active, true))
    returning id into v_id;
  else
    update printer set
      name       = p_name,
      config     = coalesce(p_config, config),
      doc_types  = coalesce(p_doc_types, doc_types),
      is_active  = coalesce(p_is_active, is_active),
      updated_at = now()
    where id = p_id
      and account_id  = v_device.account_id
      and location_id = v_device.location_id
    returning id into v_id;
    if v_id is null then
      raise exception 'upsert_printer_by_token: impresora % no encontrada en el local del dispositivo', p_id;
    end if;
  end if;

  return v_id;
end;
$function$;

-- ── BAJA (by-token) ──────────────────────────────────────────────────────────
create or replace function public.delete_printer_by_token(p_device_token text, p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'delete_printer_by_token: token no válido';
  end if;

  if not exists (
    select 1 from printer
    where id = p_id
      and account_id  = v_device.account_id
      and location_id = v_device.location_id
  ) then
    -- idempotente: si no existe en su local, no hay nada que borrar
    return;
  end if;

  if exists (select 1 from print_job where printer_id = p_id and status = 'pending') then
    raise exception 'delete_printer_by_token: la impresora tiene trabajos pendientes; cancélalos primero';
  end if;

  delete from printer where id = p_id;
end;
$function$;

-- ── GRANTS: la tablet usa clave anon (misma puerta que el resto de by-token) ──
grant execute on function public.list_printers_by_token(text)                        to anon;
grant execute on function public.upsert_printer_by_token(text, uuid, text, jsonb, text[], boolean) to anon;
grant execute on function public.delete_printer_by_token(text, uuid)                 to anon;

-- ============================================================================
-- FIN F3 (backend). El frontend (PrintersSettingsPage en modo token + pairing
-- por QR + arranque de worker) va aparte. F4: descubrimiento LAN + prueba.
-- ============================================================================
