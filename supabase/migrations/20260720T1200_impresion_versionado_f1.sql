-- ============================================================================
-- Folvy · F1 — Versionado del pipeline de IMPRESIÓN + alta de impresora por RPC
-- Frente: onboarding de impresión de producto (app única, gateada por rol)
-- Encargo: claude/ENCARGO_CODE_impresion_onboarding.md
--
-- Deuda 0: este fichero reproduce desde cero, de forma IDEMPOTENTE, todo el SQL
-- de impresión que hasta hoy vivía SOLO en la BBDD (volcado verbatim el 20/07/2026
-- del proyecto xzmpnchlguibclvxyynt). Aplicar en prod es NO-OP sobre lo existente;
-- lo único nuevo son las RPC upsert_printer / delete_printer / list_printers.
--
-- Dependencias que ya existen en el esquema (NO se redefinen aquí):
--   current_user_is_admin(), current_user_is_admin_or_manager_of(uuid),
--   belongs_to_account(uuid), safe_jsonb(jsonb), fill_line_discounts(uuid),
--   y la tabla kds_device (dominio KDS/Estación).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) TABLAS
-- ----------------------------------------------------------------------------
create table if not exists public.printer (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id)  on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null,
  transport   text not null check (transport = any (array[
                'sunmi_cloud','escpos_network','epson_epos','bluetooth','browser_pdf'])),
  doc_types   text[] not null default array['bag','kitchen','labels'],
  config      jsonb  not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.print_job (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id)  on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  printer_id  uuid references public.printer(id) on delete set null,
  sale_id     uuid references public.sale(id)    on delete set null,
  doc_type    text not null check (doc_type = any (array['bag','kitchen','labels'])),
  payload     jsonb not null,
  status      text not null default 'pending'
              check (status = any (array['pending','sent','done','error','cancelled'])),
  source      text not null default 'auto'
              check (source = any (array['auto','manual','reprint'])),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  done_at     timestamptz
);

create index if not exists idx_print_job_pending
  on public.print_job (account_id, location_id, created_at)
  where status = 'pending';

-- ----------------------------------------------------------------------------
-- 2) RLS (calcada del patrón kds_device): lectura por cuenta, escritura admin/manager
-- ----------------------------------------------------------------------------
alter table public.printer   enable row level security;
alter table public.print_job enable row level security;

drop policy if exists printer_select on public.printer;
drop policy if exists printer_insert on public.printer;
drop policy if exists printer_update on public.printer;
drop policy if exists printer_delete on public.printer;
create policy printer_select on public.printer for select
  using (public.belongs_to_account(account_id));
create policy printer_insert on public.printer for insert
  with check (public.current_user_is_admin_or_manager_of(account_id));
create policy printer_update on public.printer for update
  using (public.current_user_is_admin_or_manager_of(account_id));
create policy printer_delete on public.printer for delete
  using (public.current_user_is_admin_or_manager_of(account_id));

drop policy if exists print_job_select on public.print_job;
drop policy if exists print_job_insert on public.print_job;
drop policy if exists print_job_update on public.print_job;
drop policy if exists print_job_delete on public.print_job;
create policy print_job_select on public.print_job for select
  using (public.belongs_to_account(account_id));
create policy print_job_insert on public.print_job for insert
  with check (public.current_user_is_admin_or_manager_of(account_id));
create policy print_job_update on public.print_job for update
  using (public.current_user_is_admin_or_manager_of(account_id));
create policy print_job_delete on public.print_job for delete
  using (public.current_user_is_admin_or_manager_of(account_id));

-- ----------------------------------------------------------------------------
-- 3) FUNCIÓN compartida (KDS): resolver dispositivo por token (verbatim)
-- ----------------------------------------------------------------------------
create or replace function public.kds_resolve_device(p_token text)
 returns public.kds_device
 language sql
 security definer
 set search_path to 'public'
as $function$
  select * from kds_device
  where token = p_token and is_active = true
  limit 1;
$function$;

-- ----------------------------------------------------------------------------
-- 4) PIPELINE DE IMPRESIÓN (verbatim del vivo)
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_print_job(p_account_id uuid, p_location_id uuid, p_sale_id uuid, p_doc_type text, p_payload jsonb, p_source text DEFAULT 'manual'::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count int := 0;
  v_printer record;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'enqueue_print_job: sin acceso a la cuenta %', p_account_id;
  end if;

  for v_printer in
    select id from printer
    where account_id = p_account_id
      and location_id = p_location_id
      and is_active
      and p_doc_type = any(doc_types)
  loop
    insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source)
    values (p_account_id, p_location_id, v_printer.id, p_sale_id, p_doc_type, p_payload, p_source);
    v_count := v_count + 1;
  end loop;

  return v_count;  -- nº de impresoras a las que se encoló
end;
$function$;

create or replace function public.claim_print_jobs(p_device_token text, p_limit integer DEFAULT 10)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_jobs    jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'claim_print_jobs: token no válido';
  end if;
  update kds_device set last_seen_at = now() where id = v_device.id;

  with pend as (
    select j.id
    from print_job j
    join printer p on p.id = j.printer_id
    where j.account_id  = v_device.account_id
      and j.location_id = v_device.location_id
      and j.status = 'pending'
      and p.is_active
      and p.transport = 'escpos_network'
    order by j.created_at
    limit p_limit
    for update skip locked
  ),
  upd as (
    update print_job j
    set status = 'sent', sent_at = now(), attempts = attempts + 1
    from pend
    where j.id = pend.id
    returning j.id, j.printer_id, j.doc_type, j.payload
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'job_id',   u.id,
           'doc_type', u.doc_type,
           'payload',  u.payload,
           'printer',  jsonb_build_object(
                         'id',   p.id,
                         'name', p.name,
                         'ip',   p.config->>'ip',
                         'port', coalesce((p.config->>'port')::int, 9100)
                       )
         )), '[]'::jsonb)
  into v_jobs
  from upd u
  join printer p on p.id = u.printer_id;

  return v_jobs;
end;
$function$;

create or replace function public.report_print_job(p_device_token text, p_job_id uuid, p_ok boolean, p_error text DEFAULT NULL::text)
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
    raise exception 'report_print_job: token no válido';
  end if;

  update print_job j
  set status   = case when p_ok then 'done' else 'error' end,
      done_at  = case when p_ok then now() else done_at end,
      last_error = case when p_ok then null else p_error end
  where j.id = p_job_id
    and j.account_id = v_device.account_id;
end;
$function$;

create or replace function public.fiscal_for_print(p_device_token text, p_sale_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device  kds_device;
  v_acc     uuid;
  v_a       accounts%ROWTYPE;
  v_raw     jsonb;
  v_num     text;
  v_addr    text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then raise exception 'fiscal_for_print: token no válido'; end if;
  v_acc := v_device.account_id;

  select * into v_a from accounts where id = v_acc;

  select safe_jsonb(raw_tab) into v_raw from sale where id = p_sale_id and account_id = v_acc;
  v_num := coalesce(v_raw->'bills'->0->>'number', v_raw->>'number');

  -- Dirección desde billing_address jsonb {street, postalCode, city, province}
  v_addr := nullif(btrim(concat_ws(', ',
              nullif(v_a.billing_address->>'street',''),
              nullif(concat_ws(' ', v_a.billing_address->>'postalCode', v_a.billing_address->>'city'), ''),
              nullif(v_a.billing_address->>'province',''))), '');

  return jsonb_build_object(
    'legalName', coalesce(v_a.legal_name, v_a.name),
    'taxId', v_a.cif,
    'address', v_addr,
    'ticketNumber', v_num
  );
end;
$function$;

create or replace function public.order_for_print(p_device_token text, p_sale_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_device      kds_device;
  v_account_id  uuid;
  v_result      jsonb;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'order_for_print: token no válido';
  end if;
  v_account_id := v_device.account_id;

  -- Pobla descuento por línea (Last + HubRise) just-in-time. No falla si no hay.
  begin
    perform public.fill_line_discounts(p_sale_id);
  exception when others then
    null;  -- el ticket no se cae por un descuento mal formado
  end;

  with v as (
    select s.id, s.external_ref, s.external_tab_ref,
           s.platform_order_code, s.pos_short_code,
           s.order_status, s.status, s.service_type, s.source,
           s.brand_id, s.channel_id, s.external_channel_text,
           s.customer_name, s.customer_phone, s.delivery_address,
           s.expected_time, s.customer_note,
           s.total, s.paid, s.payment_method, s.discount_amount, s.delivery_cost,
           coalesce(s.opened_at, s.sold_at, s.created_at) as entro_at, s.raw_tab
    from sale s
    where s.id = p_sale_id and s.account_id = v_account_id
  ),
  notas as (
    select v.id as sale_id, (prod->>'organizationProductId') as ext_pid,
           nullif(btrim(prod->>'comments'), '') as note
    from v
    cross join lateral (select safe_jsonb(v.raw_tab) as tab) rt
    cross join lateral (select coalesce(rt.tab -> 'products', rt.tab -> 'bills' -> 0 -> 'products') as products) p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.products)='array' then p.products else '[]'::jsonb end) as prod
    where nullif(btrim(prod->>'comments'),'') is not null and (prod->>'organizationProductId') is not null
  ),
  padres as (
    select sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity, sl.line_type,
           sl.menu_item_id, sl.external_product_id, sl.unit_price, sl.line_total,
           sl.original_unit_price, sl.discount_label,
           mi.category as menu_category, df.name as family, df.color as family_color, df.icon as family_icon,
           array(select allergen_code from recipe_item_allergen a where a.recipe_item_id = ri.id and a.state='contains') as allergens
    from sale_line sl
    left join menu_item mi on mi.id = sl.menu_item_id
    left join recipe_item ri on ri.id = mi.recipe_item_id
    left join recipe_family df on df.id = ri.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is null
  ),
  hijas as (
    select sl.parent_sale_line_id, sl.sale_id, sl.id as line_id, sl.product_name, sl.quantity,
           sl.line_type, sl.external_product_id, sl.menu_item_id, mg.group_type,
           dfh.name as family, dfh.color as family_color, mih.category as menu_category,
           case when sl.line_type='combo_item' then 1 when mg.group_type='removal' then 2
                when mg.group_type='extras' then 3 when mg.group_type in ('choice','side') then 4
                when mg.group_type in ('cross_sell','info') then 6 else 5 end as sort_rank
    from sale_line sl
    left join modifier_option mo on mo.id = sl.modifier_option_id
    left join modifier_group mg on mg.id = mo.modifier_group_id
    left join menu_item mih on mih.id = sl.menu_item_id
    left join recipe_item rih on rih.id = mih.recipe_item_id
    left join recipe_family dfh on dfh.id = rih.family_id
    where sl.sale_id = p_sale_id and sl.parent_sale_line_id is not null
  )
  select to_jsonb(t) into v_result from (
    select v.id as sale_id, v.external_ref, v.external_tab_ref,
           v.platform_order_code, v.pos_short_code, v.order_status, v.status, v.service_type, v.source,
           b.name as brand, b.logo_url as brand_logo_url, b.color as brand_color,
           b.shop_url as brand_shop_url, b.qr_caption as brand_qr_caption, b.ownership_type as brand_ownership_type,
           coalesce(ch.name, v.external_channel_text) as channel, v.channel_id,
           v.customer_name, v.customer_phone, v.delivery_address, v.expected_time, v.customer_note,
           v.total, v.paid, v.payment_method, v.discount_amount, v.delivery_cost, v.entro_at,
           safe_jsonb(v.raw_tab)->'delivery' as delivery_detail,
           (select jsonb_agg(jsonb_build_object(
              'line_id', l.line_id, 'name', l.product_name, 'qty', l.quantity, 'menu_item_id', l.menu_item_id,
              'unit_price', l.unit_price, 'line_total', l.line_total,
              'original_unit_price', l.original_unit_price, 'discount_label', l.discount_label,
              'allergens', l.allergens,
              'family', l.family, 'family_color', l.family_color, 'family_icon', l.family_icon,
              'menu_category', l.menu_category, 'has_recipe', (l.menu_item_id is not null),
              'customer_note', (select n.note from notas n where n.sale_id=l.sale_id and n.ext_pid=l.external_product_id limit 1),
              'children', coalesce((select jsonb_agg(jsonb_build_object(
                  'line_id', h.line_id, 'name', h.product_name, 'qty', h.quantity, 'line_type', h.line_type,
                  'group_type', h.group_type, 'menu_item_id', h.menu_item_id, 'family', h.family,
                  'family_color', h.family_color, 'menu_category', h.menu_category
                ) order by h.sort_rank, h.product_name) from hijas h where h.parent_sale_line_id = l.line_id), '[]'::jsonb)
            ) order by l.product_name) from padres l) as lineas
    from v
    left join brand b on b.id = v.brand_id
    left join sales_channel ch on ch.id = v.channel_id
  ) t;

  return v_result;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 5) TRIGGER de auto-impresión al ACEPTAR el pedido (verbatim)
-- ----------------------------------------------------------------------------
create or replace function public.tg_auto_print_on_accept()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_printer record;
  v_doc text;
begin
  -- solo al PASAR a accepted (no en cada update)
  if new.order_status = 'accepted'
     and (old.order_status is distinct from new.order_status) then

    for v_printer in
      select id, doc_types from printer
      where account_id = new.account_id
        and location_id = new.location_id
        and is_active
    loop
      foreach v_doc in array v_printer.doc_types loop
        insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
        values (new.account_id, new.location_id, v_printer.id, new.id, v_doc,
                jsonb_build_object('sale_id', new.id, 'mode', 'by_order'),
                'auto', 'pending');
      end loop;
    end loop;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_auto_print_on_accept on public.sale;
create trigger trg_auto_print_on_accept
  after update on public.sale
  for each row execute function public.tg_auto_print_on_accept();

-- ----------------------------------------------------------------------------
-- 6) NUEVO — alta/edición/baja de impresora por RPC (para la pantalla del admin)
--    Reemplaza el INSERT manual por SQL. Guarda admin/manager. Sólo escpos_network
--    por ahora (otros transportes = frente futuro Vía A / Bluetooth).
-- ----------------------------------------------------------------------------
create or replace function public.upsert_printer(
  p_id uuid, p_account_id uuid, p_location_id uuid, p_name text,
  p_transport text, p_config jsonb, p_doc_types text[], p_is_active boolean)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
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
    insert into printer (account_id, location_id, name, transport, config, doc_types, is_active)
    values (p_account_id, p_location_id, p_name, p_transport,
            coalesce(p_config,'{}'::jsonb),
            coalesce(p_doc_types, array['bag','kitchen','labels']),
            coalesce(p_is_active, true))
    returning id into v_id;
  else
    update printer set
      location_id = p_location_id,
      name        = p_name,
      transport   = p_transport,
      config      = coalesce(p_config, config),
      doc_types   = coalesce(p_doc_types, doc_types),
      is_active   = coalesce(p_is_active, is_active),
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

create or replace function public.delete_printer(p_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_acc uuid;
begin
  select account_id into v_acc from printer where id = p_id;
  if v_acc is null then return; end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_acc)) then
    raise exception 'delete_printer: sin acceso';
  end if;
  if exists (select 1 from print_job where printer_id = p_id and status = 'pending') then
    raise exception 'delete_printer: la impresora tiene trabajos pendientes; cancélalos primero';
  end if;
  delete from printer where id = p_id;
end;
$function$;

create or replace function public.list_printers(p_location_id uuid)
 returns jsonb
 language sql
 security definer
 stable
 set search_path to 'public'
as $function$
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
  where location_id = p_location_id
    and public.belongs_to_account(account_id);
$function$;

-- ----------------------------------------------------------------------------
-- 7) GRANTS (fieles al uso vivo): la tablet usa clave anon (worker); el admin, sesión.
-- ----------------------------------------------------------------------------
grant execute on function public.claim_print_jobs(text, integer)            to anon;
grant execute on function public.report_print_job(text, uuid, boolean, text) to anon;
grant execute on function public.order_for_print(text, uuid)                to anon;
grant execute on function public.fiscal_for_print(text, uuid)               to anon;

grant execute on function public.enqueue_print_job(uuid, uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.upsert_printer(uuid, uuid, uuid, text, text, jsonb, text[], boolean) to authenticated;
grant execute on function public.delete_printer(uuid)  to authenticated;
grant execute on function public.list_printers(uuid)   to authenticated;

-- ============================================================================
-- FIN F1. Siguiente: F2 (pantalla "Impresoras" en el admin) — encargo a Code.
-- ============================================================================
