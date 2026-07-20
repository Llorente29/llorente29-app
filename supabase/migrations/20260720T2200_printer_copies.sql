-- ============================================================================
-- Folvy · Copias por impresora (printer.copies) + ruteo por doc_types en la UI
-- Frente onboarding de impresión.
--
-- El ruteo por doc_types YA existía (auto-print/reprint enrutan por doc_types).
-- Esto añade `copies`: cuántas COPIAS de cada documento saca una impresora.
-- Implementación simple (decisión del encargo): N COPIAS = N print_jobs. El
-- worker ya imprime 1 papel por job → copies=2 saca 2 papeles, sin tocar el worker.
--
-- Cuerpos reescritos sobre el VIVO (verificado con pg_get_functiondef 20/07):
-- OJO, tg_auto_print_on_accept vivo dispara también en INSERT y deduplica por
-- source='auto' (difiere del fichero F1). Se conserva esa lógica + bucle copies.
-- ============================================================================

-- ── Columna copies (1..9) ────────────────────────────────────────────────────
alter table public.printer add column if not exists copies int not null default 1;
alter table public.printer drop constraint if exists printer_copies_chk;
alter table public.printer add constraint printer_copies_chk check (copies between 1 and 9);
comment on column public.printer.copies is 'Nº de copias por documento que saca esta impresora (1-9).';

-- ── list_printers / list_printers_by_token (+copies) ─────────────────────────
create or replace function public.list_printers(p_location_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        id,
           'name',      name,
           'transport', transport,
           'ip',        config->>'ip',
           'port',      coalesce((config->>'port')::int, 9100),
           'doc_types', to_jsonb(doc_types),
           'copies',    copies,
           'is_active', is_active
         ) order by name), '[]'::jsonb)
  from printer
  where location_id = p_location_id
    and public.belongs_to_account(account_id);
$function$;

create or replace function public.list_printers_by_token(p_device_token text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_device kds_device;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'list_printers_by_token: token no válido'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',        id,
             'name',      name,
             'transport', transport,
             'ip',        config->>'ip',
             'port',      coalesce((config->>'port')::int, 9100),
             'doc_types', to_jsonb(doc_types),
             'copies',    copies,
             'is_active', is_active
           ) order by name), '[]'::jsonb)
    from printer
    where location_id = v_device.location_id and account_id = v_device.account_id
  );
end;
$function$;

-- ── upsert_printer (drop+recreate: nueva firma con p_copies) ─────────────────
drop function if exists public.upsert_printer(uuid,uuid,uuid,text,text,jsonb,text[],boolean);
create or replace function public.upsert_printer(
  p_id uuid, p_account_id uuid, p_location_id uuid, p_name text,
  p_transport text, p_config jsonb, p_doc_types text[], p_is_active boolean,
  p_copies int default 1)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'upsert_printer: sin acceso a la cuenta %', p_account_id;
  end if;
  if p_transport is distinct from 'escpos_network' then
    raise exception 'upsert_printer: transport no soportado aún (sólo escpos_network): %', p_transport;
  end if;

  if p_id is null then
    insert into printer (account_id, location_id, name, transport, config, doc_types, is_active, copies)
    values (p_account_id, p_location_id, p_name, p_transport,
            coalesce(p_config,'{}'::jsonb),
            coalesce(p_doc_types, array['bag','kitchen','labels']),
            coalesce(p_is_active, true),
            greatest(1, least(9, coalesce(p_copies, 1))))
    returning id into v_id;
  else
    update printer set
      location_id = p_location_id,
      name        = p_name,
      transport   = p_transport,
      config      = coalesce(p_config, config),
      doc_types   = coalesce(p_doc_types, doc_types),
      is_active   = coalesce(p_is_active, is_active),
      copies      = greatest(1, least(9, coalesce(p_copies, copies))),
      updated_at  = now()
    where id = p_id and account_id = p_account_id
    returning id into v_id;
    if v_id is null then
      raise exception 'upsert_printer: impresora % no encontrada en la cuenta', p_id;
    end if;
  end if;
  return v_id;
end;
$function$;
grant execute on function public.upsert_printer(uuid,uuid,uuid,text,text,jsonb,text[],boolean,int) to authenticated;

-- ── upsert_printer_by_token (drop+recreate: nueva firma con p_copies) ────────
drop function if exists public.upsert_printer_by_token(text,uuid,text,jsonb,text[],boolean);
create or replace function public.upsert_printer_by_token(
  p_device_token text, p_id uuid, p_name text,
  p_config jsonb, p_doc_types text[], p_is_active boolean, p_copies int default 1)
 returns uuid language plpgsql security definer set search_path to 'public'
as $function$
declare v_device kds_device; v_id uuid;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'upsert_printer_by_token: token no válido'; end if;

  if p_id is null then
    insert into printer (account_id, location_id, name, transport, config, doc_types, is_active, copies)
    values (v_device.account_id, v_device.location_id, p_name, 'escpos_network',
            coalesce(p_config,'{}'::jsonb),
            coalesce(p_doc_types, array['bag','kitchen','labels']),
            coalesce(p_is_active, true),
            greatest(1, least(9, coalesce(p_copies, 1))))
    returning id into v_id;
  else
    update printer set
      name       = p_name,
      config     = coalesce(p_config, config),
      doc_types  = coalesce(p_doc_types, doc_types),
      is_active  = coalesce(p_is_active, is_active),
      copies     = greatest(1, least(9, coalesce(p_copies, copies))),
      updated_at = now()
    where id = p_id and account_id = v_device.account_id and location_id = v_device.location_id
    returning id into v_id;
    if v_id is null then
      raise exception 'upsert_printer_by_token: impresora % no encontrada en el local del dispositivo', p_id;
    end if;
  end if;
  return v_id;
end;
$function$;
grant execute on function public.upsert_printer_by_token(text,uuid,text,jsonb,text[],boolean,int) to anon;

-- ── enqueue_print_job (+ bucle de copias) ────────────────────────────────────
create or replace function public.enqueue_print_job(p_account_id uuid, p_location_id uuid, p_sale_id uuid, p_doc_type text, p_payload jsonb, p_source text DEFAULT 'manual'::text)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_count int := 0; v_printer record; v_i int;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'enqueue_print_job: sin acceso a la cuenta %', p_account_id;
  end if;

  for v_printer in
    select id, copies from printer
    where account_id = p_account_id and location_id = p_location_id
      and is_active and p_doc_type = any(doc_types)
  loop
    for v_i in 1..greatest(1, coalesce(v_printer.copies, 1)) loop
      insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source)
      values (p_account_id, p_location_id, v_printer.id, p_sale_id, p_doc_type, p_payload, p_source);
      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;  -- nº de jobs encolados (impresoras × copias)
end;
$function$;

-- ── tg_auto_print_on_accept (VIVO + bucle de copias) ─────────────────────────
create or replace function public.tg_auto_print_on_accept()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare v_printer record; v_doc text; v_i int; v_fire boolean := false;
begin
  if new.order_status = 'accepted' then
    if TG_OP = 'INSERT' then v_fire := true;
    elsif old.order_status is distinct from new.order_status then v_fire := true;
    end if;
  end if;

  if v_fire
     and not exists (select 1 from print_job pj where pj.sale_id = new.id and pj.source = 'auto') then
    begin
      for v_printer in
        select id, doc_types, copies from printer
        where account_id = new.account_id and location_id = new.location_id and is_active
      loop
        foreach v_doc in array v_printer.doc_types loop
          for v_i in 1..greatest(1, coalesce(v_printer.copies, 1)) loop
            insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
            values (new.account_id, new.location_id, v_printer.id, new.id, v_doc,
                    jsonb_build_object('sale_id', new.id, 'mode', 'by_order'),
                    'auto', 'pending');
          end loop;
        end loop;
      end loop;
    exception when others then
      null; -- nunca romper la entrada del pedido por un fallo de impresión
    end;
  end if;

  return new;
end;
$function$;

-- ── reprint_order / reprint_order_by_token (+ bucle de copias) ───────────────
create or replace function public.reprint_order(p_sale_id uuid)
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

create or replace function public.reprint_order_by_token(p_device_token text, p_sale_id uuid)
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_device kds_device; v_count int := 0; v_printer record; v_doc text; v_i int;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'reprint_order_by_token: token no válido'; end if;
  if not exists (
    select 1 from sale where id = p_sale_id
      and account_id = v_device.account_id and location_id = v_device.location_id
  ) then
    raise exception 'reprint_order_by_token: pedido no encontrado en el local del dispositivo';
  end if;
  for v_printer in
    select id, doc_types, copies from printer
    where account_id = v_device.account_id and location_id = v_device.location_id and is_active
  loop
    foreach v_doc in array v_printer.doc_types loop
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
