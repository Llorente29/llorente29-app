-- ============================================================================
-- Folvy · F4 — "Imprimir prueba" (encolado DIRIGIDO a UNA impresora)
-- Frente: onboarding de impresión. Encargo: claude/ENCARGO_CODE_impresion_onboarding.md
--
-- enqueue_print_job (F1) hace FAN-OUT a todas las impresoras del local que saquen
-- un doc_type. Para el botón "Imprimir prueba" necesitamos encolar a UNA impresora
-- concreta, con un ticket de prueba renderizable por el worker (TicketDoc, mode
-- distinto de by_order → el worker hace renderDoc(payload) directo).
--
-- Dos puertas, mismo patrón que F1/F3:
--   · enqueue_test_print(printer_id)                  — sesión (admin/manager)
--   · enqueue_test_print_by_token(token, printer_id)  — Estación (anon, by-token)
-- El payload PRUEBA se construye en el SERVIDOR (fuente única del ticket).
-- ============================================================================

-- ── Helper: construye el TicketDoc "PRUEBA" (bloques que entiende renderDoc) ──
create or replace function public._build_test_ticket(p_name text, p_ip text, p_port int)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'title', 'PRUEBA',
    'widthMm', 80,
    'blocks', jsonb_build_array(
      jsonb_build_object('kind','banner','text','PRUEBA'),
      jsonb_build_object('kind','text','text','Folvy','align','center','size',2,'bold',true),
      jsonb_build_object('kind','rule'),
      jsonb_build_object('kind','row','left','Impresora','right', coalesce(p_name,'-')),
      jsonb_build_object('kind','row','left','IP','right',
        coalesce(p_ip,'-') || ':' || coalesce(p_port, 9100)::text),
      jsonb_build_object('kind','row','left','Hora','right',
        to_char(now() at time zone 'Europe/Madrid', 'DD/MM HH24:MI:SS')),
      jsonb_build_object('kind','space','lines',1),
      jsonb_build_object('kind','text','text','Si ves este ticket, la impresora esta conectada.','align','center'),
      jsonb_build_object('kind','cut')
    )
  );
$function$;

-- ── Sesión: encola prueba a una impresora de mi cuenta ───────────────────────
create or replace function public.enqueue_test_print(p_printer_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_p   printer;
  v_doc text;
  v_job uuid;
begin
  select * into v_p from printer where id = p_printer_id;
  if v_p.id is null then
    raise exception 'enqueue_test_print: impresora no encontrada';
  end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_p.account_id)) then
    raise exception 'enqueue_test_print: sin acceso a la cuenta';
  end if;

  v_doc := coalesce(v_p.doc_types[1], 'kitchen');
  insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
  values (v_p.account_id, v_p.location_id, v_p.id, null, v_doc,
          public._build_test_ticket(v_p.name, v_p.config->>'ip',
                                     coalesce((v_p.config->>'port')::int, 9100)),
          'manual', 'pending')
  returning id into v_job;

  return v_job;
end;
$function$;

-- ── By-token: encola prueba a una impresora del local del dispositivo ─────────
create or replace function public.enqueue_test_print_by_token(p_device_token text, p_printer_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device kds_device;
  v_p      printer;
  v_doc    text;
  v_job    uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'enqueue_test_print_by_token: token no válido';
  end if;

  select * into v_p from printer
  where id = p_printer_id
    and account_id  = v_device.account_id
    and location_id = v_device.location_id;
  if v_p.id is null then
    raise exception 'enqueue_test_print_by_token: impresora no encontrada en el local del dispositivo';
  end if;

  v_doc := coalesce(v_p.doc_types[1], 'kitchen');
  insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
  values (v_device.account_id, v_device.location_id, v_p.id, null, v_doc,
          public._build_test_ticket(v_p.name, v_p.config->>'ip',
                                     coalesce((v_p.config->>'port')::int, 9100)),
          'manual', 'pending')
  returning id into v_job;

  return v_job;
end;
$function$;

-- ── GRANTS ───────────────────────────────────────────────────────────────────
grant execute on function public.enqueue_test_print(uuid)                       to authenticated;
grant execute on function public.enqueue_test_print_by_token(text, uuid)        to anon;

-- ============================================================================
-- FIN F4 (backend prueba). El autodescubrimiento LAN es nativo (plugin Android
-- EscposPrinter.discover) — no necesita SQL. F5: device_mode + IP estable.
-- ============================================================================
