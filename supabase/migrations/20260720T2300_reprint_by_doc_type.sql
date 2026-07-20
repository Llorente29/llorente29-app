-- ============================================================================
-- Folvy · Reimprimir SOLO el documento de la pestaña activa
-- Frente onboarding de impresión. Refinamiento (Julio 20/07).
--
-- reprint_order(_by_token) gana `p_doc_type text default null`:
--   · null  → reimprime TODOS los doc_types (comportamiento anterior; "todo").
--   · 'bag'|'kitchen'|'labels' → SOLO ese documento.
-- El front pasa el doc_type de la pestaña abierta en el modal de tickets.
-- Conserva el bucle de copias (printer.copies). Drop+recreate por cambio de firma.
-- ============================================================================

drop function if exists public.reprint_order(uuid);
create or replace function public.reprint_order(p_sale_id uuid, p_doc_type text default null)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_acc uuid; v_loc uuid; v_count int := 0; v_printer record; v_doc text; v_i int;
begin
  select account_id, location_id into v_acc, v_loc from sale where id = p_sale_id;
  if v_acc is null then raise exception 'reprint_order: pedido no encontrado'; end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_acc)) then
    raise exception 'reprint_order: sin acceso a la cuenta';
  end if;
  for v_printer in
    select id, doc_types, copies from printer
    where account_id = v_acc and location_id = v_loc and is_active
  loop
    foreach v_doc in array v_printer.doc_types loop
      if p_doc_type is not null and v_doc <> p_doc_type then continue; end if;
      for v_i in 1..greatest(1, coalesce(v_printer.copies, 1)) loop
        insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
        values (v_acc, v_loc, v_printer.id, p_sale_id, v_doc,
                jsonb_build_object('sale_id', p_sale_id, 'mode', 'by_order'), 'reprint', 'pending');
        v_count := v_count + 1;
      end loop;
    end loop;
  end loop;
  return v_count;
end;
$function$;
grant execute on function public.reprint_order(uuid, text) to authenticated;

drop function if exists public.reprint_order_by_token(text, uuid);
create or replace function public.reprint_order_by_token(p_device_token text, p_sale_id uuid, p_doc_type text default null)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_device kds_device; v_count int := 0; v_printer record; v_doc text; v_i int;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'reprint_order_by_token: token no válido'; end if;
  if not exists (select 1 from sale where id = p_sale_id
                   and account_id = v_device.account_id and location_id = v_device.location_id) then
    raise exception 'reprint_order_by_token: pedido no encontrado en el local del dispositivo';
  end if;
  for v_printer in
    select id, doc_types, copies from printer
    where account_id = v_device.account_id and location_id = v_device.location_id and is_active
  loop
    foreach v_doc in array v_printer.doc_types loop
      if p_doc_type is not null and v_doc <> p_doc_type then continue; end if;
      for v_i in 1..greatest(1, coalesce(v_printer.copies, 1)) loop
        insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
        values (v_device.account_id, v_device.location_id, v_printer.id, p_sale_id, v_doc,
                jsonb_build_object('sale_id', p_sale_id, 'mode', 'by_order'), 'reprint', 'pending');
        v_count := v_count + 1;
      end loop;
    end loop;
  end loop;
  return v_count;
end;
$function$;
grant execute on function public.reprint_order_by_token(text, uuid, text) to anon;
