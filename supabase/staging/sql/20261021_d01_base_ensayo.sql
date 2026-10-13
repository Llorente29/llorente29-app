-- supabase/staging/sql/20261021_d01_base_ensayo.sql
--
-- SOLO STAGING. El ENSAYO de 20261021T0200 y 0210 (D01) antes del real: los dos
-- ficheros enteros y su prueba dentro de UNA transacción que acaba en ROLLBACK.
-- Generado copiando los ficheros tal cual.

begin;
-- ============================================================================
-- D01 · Facturas recibidas, para cualquier empresa · LA BASE (tarea 3)
-- ----------------------------------------------------------------------------
-- Todo lo de este fichero AÑADE: tablas nuevas, columnas que admiten nulos,
-- funciones nuevas, un índice único sobre una tabla pequeña (supplier_invoice:
-- 6 filas en producción el 13/10, cero repetidas) y filas en una tabla que
-- nace aquí. No cambia ni borra nada que exista. Las tres ampliaciones de un
-- CHECK que hacen falta van aparte, declaradas, en la 0210.
--
-- NO es una tabla paralela de facturas (encargo D01, punto 1): la factura sigue
-- siendo supplier_invoice, la de Compras y Cocina. Lo que se añade es lo que
-- no existía:
--
--   1. company_purchase_setting: el ajuste de empresa «Recibe la mercancía con
--      Folvy» (R1, punto 6) y «apuntar solo lo seguro». Se siembra una fila por
--      empresa que existe: sí, si su cuenta tuvo recepciones en los últimos 90
--      días; no, si no. Después no se recalcula nunca solo.
--   2. company_inbound_address: la dirección de facturas de cada empresa,
--      facturas-<empresa>@entrada.folvy.app (R1, punto 3). <empresa> es un
--      identificador corto, nunca el NIF. Nace APAGADA (active = false): se
--      enciende cuando Julio dé de alta el dominio en Resend.
--   3. document_inbox: la bandeja de LLEGADAS. Cada fichero que entra (subido,
--      por correo, de Cocina, de un portal), con su huella para reconocer el
--      mismo PDF dos veces, su lectura y la factura que salió de él. También lo
--      que llega sin PDF («Falta el PDF: el correo trae un enlace») y lo que
--      llega a una dirección que no es de nadie: nada se pierde sin rastro.
--   4. supplier_invoice: cómo llegó (arrival_channel), la clave del número
--      (number_key, la misma regla que el núcleo de lectura), la confianza, la
--      lectura entera, el recargo y su llegada (inbox_id).
--      Y la REGLA ÚNICA de repetidas en la base (R1, punto 9): un índice único
--      por cuenta, proveedor y clave del número, salvo las anuladas y las que
--      una persona confirmó «No es repetida». Medido antes en producción: 0
--      grupos repetidos por número y 0 por fecha y total, en las 6 facturas
--      vivas (toda la tabla).
--   5. supplier_invoice_tax: bases, cuotas y recargo por tipo de IVA (hoy solo
--      había IVA por línea).
--   6. supplier_invoice_repetida(): la regla para TODOS los caminos (Compras,
--      Supply, la ficha y la bandeja): repetida = mismo proveedor y misma clave
--      de número; posible = mismo proveedor, misma fecha y mismo total con
--      otro número.
--   7. supplier_expected_invoice y supplier_invoice_request: las facturas fijas
--      esperadas (alquiler, luz, teléfono…) y lo que se le pide al proveedor
--      cuando no llega (R1, punto 5: el correo nunca sale sin que la persona lo
--      confirme).
--   8. document_activity: lo que ha hecho Folvy y lo que ha hecho cada
--      persona, con «Deshacer».
--   9. supplier.created_from: un proveedor dado de alta desde lo leído en una
--      factura («Traída de factura · por completar»).
--  10. banco_facturas_recibidas_pendientes(): la función de lectura para B
--      (Bancos), con su contrato estable (D01 T1, §7).
--
-- Lectura: los de la cuenta (RLS por current_user_account_ids). Escritura: por
-- las funciones de aquí (security definer, con la cuenta y el papel
-- comprobados) o por el servidor (service_role).
--
-- Vuelta atrás: supabase/vuelta-atras/20261021T0200_d01_recibidas.down.sql
-- Prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- ============================================================================

-- 1. «Recibe la mercancía con Folvy» -------------------------------------------
create table if not exists public.company_purchase_setting (
  company_id uuid primary key references public.company(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  receives_goods boolean not null,
  receives_goods_reason text,
  post_safe_invoices boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text
);
comment on table public.company_purchase_setting is
  'D01 · Ajustes de compras de una empresa: «Recibe la mercancía con Folvy» (casado con Cocina y «De Cocina» en la bandeja) y «apuntar solo lo seguro». Valor inicial por el dato; después solo lo cambia una persona.';
alter table public.company_purchase_setting enable row level security;
drop policy if exists company_purchase_setting_read on public.company_purchase_setting;
create policy company_purchase_setting_read on public.company_purchase_setting for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.company_purchase_setting from anon, authenticated;
grant select on public.company_purchase_setting to authenticated;

-- La siembra: una fila por empresa que existe hoy, con el porqué.
insert into public.company_purchase_setting (company_id, account_id, receives_goods, receives_goods_reason)
select c.id, c.account_id,
       exists (select 1 from public.goods_receipt g where g.account_id = c.account_id and g.receipt_date >= current_date - 90 and g.status <> 'anulado'),
       case when exists (select 1 from public.goods_receipt g where g.account_id = c.account_id and g.receipt_date >= current_date - 90 and g.status <> 'anulado')
            then 'Tuvo recepciones de mercancía en Folvy en los 90 días antes del ' || to_char(current_date, 'DD/MM/YYYY') || '.'
            else 'No tuvo recepciones de mercancía en Folvy en los 90 días antes del ' || to_char(current_date, 'DD/MM/YYYY') || '.' end
  from public.company c
on conflict (company_id) do nothing;

create or replace function public.conta_recibe_mercancia(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.receives_goods from public.company_purchase_setting s where s.company_id = p_company), false)
$$;
comment on function public.conta_recibe_mercancia(uuid) is 'D01 · ¿Recibe la mercancía con Folvy? Sin fila (empresa nueva, o cuenta solo de contabilidad): no.';
revoke all on function public.conta_recibe_mercancia(uuid) from public, anon;
grant execute on function public.conta_recibe_mercancia(uuid) to authenticated;

create or replace function public.conta_ajustes_compras_guardar(p_company uuid, p_recibe boolean, p_apuntar_seguro boolean, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia los ajustes de compras.' using errcode = '42501';
  end if;
  insert into public.company_purchase_setting (company_id, account_id, receives_goods, receives_goods_reason, post_safe_invoices, updated_at, updated_by, updated_by_name)
  values (p_company, v_acc, p_recibe, 'Lo decidió ' || coalesce(p_quien_nombre, 'una persona') || ' el ' || to_char(now() at time zone 'Europe/Madrid', 'DD/MM/YYYY') || '.',
          p_apuntar_seguro, now(), auth.uid(), p_quien_nombre)
  on conflict (company_id) do update
     set receives_goods = excluded.receives_goods, receives_goods_reason = excluded.receives_goods_reason,
         post_safe_invoices = excluded.post_safe_invoices, updated_at = now(), updated_by = auth.uid(), updated_by_name = p_quien_nombre;
  return (select to_jsonb(s) from public.company_purchase_setting s where s.company_id = p_company);
end $$;
revoke all on function public.conta_ajustes_compras_guardar(uuid, boolean, boolean, text) from public, anon;
grant execute on function public.conta_ajustes_compras_guardar(uuid, boolean, boolean, text) to authenticated;

-- 2. La dirección de facturas de cada empresa ----------------------------------
create table if not exists public.company_inbound_address (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  kind text not null default 'facturas' check (kind in ('facturas')),
  local_part text not null check (local_part ~ '^facturas-[a-z0-9][a-z0-9-]{1,40}$'),
  domain text not null default 'entrada.folvy.app' check (domain ~ '^[a-z0-9.-]+$'),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  unique (company_id, kind)
);
create unique index if not exists company_inbound_address_uq on public.company_inbound_address (lower(local_part), lower(domain));
comment on table public.company_inbound_address is
  'D01 · La dirección propia de facturas de cada empresa (facturas-<empresa>@entrada.folvy.app), a la que se reenvían las facturas desde cualquier buzón. Nace apagada: se enciende cuando el dominio está dado de alta en Resend.';
alter table public.company_inbound_address enable row level security;
drop policy if exists company_inbound_address_read on public.company_inbound_address;
create policy company_inbound_address_read on public.company_inbound_address for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.company_inbound_address from anon, authenticated;
grant select on public.company_inbound_address to authenticated;

-- El identificador corto: del nombre comercial (o la razón social), en
-- minúsculas, sin tildes ni signos; si ya lo tiene otra empresa, con un sufijo.
create or replace function public.conta_direccion_facturas(p_company uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.company;
  v_base text; v_lp text; v_i int := 1;
  v_x public.company_inbound_address;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into v_x from public.company_inbound_address where company_id = p_company and kind = 'facturas';
  if v_x.id is not null then return to_jsonb(v_x) || jsonb_build_object('direccion', v_x.local_part || '@' || v_x.domain, 'ya_estaba', true); end if;
  if not public.current_user_is_admin_or_manager_of(v_c.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta crea la dirección de facturas.' using errcode = '42501';
  end if;
  v_base := regexp_replace(lower(translate(coalesce(nullif(v_c.trade_name, ''), v_c.legal_name, 'empresa'),
                                           'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç', 'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc')), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  v_base := left(regexp_replace(v_base, '-(s-?l-?u?|s-?a|s-?c-?p|s-?l-?l)$', ''), 30);
  if length(v_base) < 2 then v_base := 'empresa'; end if;
  v_lp := 'facturas-' || v_base;
  while exists (select 1 from public.company_inbound_address where lower(local_part) = v_lp and domain = 'entrada.folvy.app') loop
    v_i := v_i + 1; v_lp := 'facturas-' || v_base || '-' || v_i;
  end loop;
  insert into public.company_inbound_address (account_id, company_id, local_part, created_by, created_by_name)
  values (v_c.account_id, v_c.id, v_lp, auth.uid(), p_quien_nombre) returning * into v_x;
  return to_jsonb(v_x) || jsonb_build_object('direccion', v_x.local_part || '@' || v_x.domain, 'ya_estaba', false);
end $$;
revoke all on function public.conta_direccion_facturas(uuid, text) from public, anon;
grant execute on function public.conta_direccion_facturas(uuid, text) to authenticated;

-- 3. La bandeja de llegadas ------------------------------------------------------
create table if not exists public.document_inbox (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid references public.company(id) on delete cascade,
  channel text not null check (channel in ('subida', 'correo', 'cocina', 'portal')),
  status text not null default 'recibido'
    check (status in ('recibido', 'leyendo', 'leido', 'factura', 'falta_pdf', 'repetida', 'sin_destino', 'no_es_factura', 'error', 'descartado')),
  -- El correo (si llegó por correo).
  email_id text,
  email_to text,
  email_from text,
  email_subject text,
  email_received_at timestamptz,
  link_url text,
  -- El fichero (si lo hay): el original, donde entra.
  file_bucket text not null default 'receipt-uploads' check (file_bucket in ('receipt-uploads')),
  file_path text,
  file_name text,
  mime_type text,
  size_bytes integer check (size_bytes is null or size_bytes > 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  -- Lo que salió de él.
  ai_session_id uuid,
  supplier_invoice_id uuid references public.supplier_invoice(id) on delete set null,
  duplicate_of_invoice_id uuid references public.supplier_invoice(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now(),
  check (channel <> 'correo' or email_id is not null),
  check (status <> 'falta_pdf' or (file_path is null and link_url is not null)),
  check (status <> 'factura' or supplier_invoice_id is not null),
  check (status <> 'repetida' or duplicate_of_invoice_id is not null),
  check (file_path is null or file_path like account_id::text || '/%')
);
create unique index if not exists document_inbox_fichero_uq on public.document_inbox (file_bucket, file_path) where file_path is not null;
-- El mismo PDF dos veces se reconoce (encargo E: «cada documento tiene una huella»).
create unique index if not exists document_inbox_huella_uq on public.document_inbox (account_id, sha256) where sha256 is not null and status <> 'descartado';
-- El mismo adjunto del mismo correo, una vez.
create unique index if not exists document_inbox_correo_uq on public.document_inbox (email_id, coalesce(file_name, ''), coalesce(link_url, '')) where email_id is not null;
create index if not exists document_inbox_empresa_idx on public.document_inbox (company_id, created_at desc);
comment on table public.document_inbox is
  'D01 · La bandeja de llegadas: cada fichero (o enlace) que entra, por donde entre, con su huella, su lectura y la factura que salió de él. No es otra tabla de facturas: la factura es supplier_invoice.';
alter table public.document_inbox enable row level security;
drop policy if exists document_inbox_read on public.document_inbox;
create policy document_inbox_read on public.document_inbox for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.document_inbox from anon, authenticated;
grant select on public.document_inbox to authenticated;

-- 4. Lo que le faltaba a la factura ----------------------------------------------
alter table public.supplier_invoice add column if not exists arrival_channel text check (arrival_channel in ('subida', 'correo', 'cocina', 'portal'));
alter table public.supplier_invoice add column if not exists number_key text
  generated always as (nullif(case when upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(SN|SINNUMERO|SINNUM|0+)$' then ''
                                   else upper(regexp_replace(coalesce(invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) end, '')) stored;
alter table public.supplier_invoice add column if not exists reading_confidence text check (reading_confidence in ('seguro', 'probable', 'duda'));
alter table public.supplier_invoice add column if not exists reading jsonb;
alter table public.supplier_invoice add column if not exists surcharge_total numeric(14,2);
alter table public.supplier_invoice add column if not exists inbox_id uuid references public.document_inbox(id) on delete set null;
comment on column public.supplier_invoice.number_key is 'D01 · La clave del número para las repetidas: mayúsculas y solo letras y números («s/n» y «0» no son número). La misma regla que _shared/lecturaFactura.ts.';
comment on column public.supplier_invoice.reading is 'D01 · La lectura comprobada (lecturaFactura): lo leído, cada comprobación con su frase, la confianza y su porqué.';

-- La regla única de repetidas, en la base: no entran dos facturas vivas del
-- mismo proveedor con la misma clave de número, salvo que una persona haya
-- dicho «No es repetida» (not_duplicate_confirmed_at).
create unique index if not exists supplier_invoice_numero_uq
  on public.supplier_invoice (account_id, supplier_id, number_key)
  where number_key is not null and supplier_id is not null and status <> 'anulada' and not_duplicate_confirmed_at is null;

-- 5. Bases y cuotas por tipo -----------------------------------------------------
create table if not exists public.supplier_invoice_tax (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  tax_rate_id uuid references public.tax_rate(id),
  vat_pct numeric(5,2) not null,
  base numeric(14,2) not null,
  vat_amount numeric(14,2) not null,
  surcharge_pct numeric(5,2),
  surcharge_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (supplier_invoice_id, vat_pct)
);
comment on table public.supplier_invoice_tax is 'D01 · El cuadro de impuestos de una factura recibida: base, cuota y recargo por tipo de IVA.';
alter table public.supplier_invoice_tax enable row level security;
drop policy if exists supplier_invoice_tax_read on public.supplier_invoice_tax;
create policy supplier_invoice_tax_read on public.supplier_invoice_tax for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_invoice_tax from anon, authenticated;
grant select on public.supplier_invoice_tax to authenticated;

-- 6. La regla de repetidas, para todos los caminos ------------------------------
create or replace function public.supplier_invoice_repetida(
  p_account uuid, p_supplier uuid, p_nif text, p_numero text, p_fecha date, p_total numeric, p_excluir uuid default null)
returns table (nivel text, invoice_id uuid, invoice_number text, invoice_date date, grand_total numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  v_clave text := nullif(case when upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g')) ~ '^(SN|SINNUMERO|SINNUM|0+)$' then ''
                              else upper(regexp_replace(coalesce(p_numero, ''), '[^A-Za-z0-9]', '', 'g')) end, '');
  v_nif text := nullif(regexp_replace(upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', ''), '');
begin
  if not (public.belongs_to_account(p_account) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa cuenta no es tuya.' using errcode = '42501';
  end if;
  return query
  with vivas as (
    select i.* from public.supplier_invoice i
      left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
     where i.account_id = p_account and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
       and (p_excluir is null or i.id <> p_excluir)
       and ((p_supplier is not null and i.supplier_id = p_supplier)
            or (v_nif is not null and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif))
  )
  (select 'repetida'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from vivas v
    where v_clave is not null and v.number_key = v_clave order by v.created_at limit 1)
  union all
  (select 'posible'::text, v.id, v.invoice_number, v.invoice_date, v.grand_total from vivas v
    where p_fecha is not null and p_total is not null and v.invoice_date = p_fecha and round(v.grand_total * 100) = round(p_total * 100)
      and (v_clave is null or v.number_key is distinct from v_clave)
      and not exists (select 1 from vivas w where v_clave is not null and w.number_key = v_clave)
    order by v.created_at limit 1);
end $$;
comment on function public.supplier_invoice_repetida(uuid, uuid, text, text, date, numeric, uuid) is
  'D01 · La regla única de repetidas: repetida = mismo proveedor (o su NIF) y misma clave de número; posible = mismo proveedor, misma fecha y mismo total con otro número. Para Compras, Supply, la ficha y la bandeja.';
revoke all on function public.supplier_invoice_repetida(uuid, uuid, text, text, date, numeric, uuid) from public, anon;
grant execute on function public.supplier_invoice_repetida(uuid, uuid, text, text, date, numeric, uuid) to authenticated, service_role;

-- 7. Las facturas fijas esperadas, y lo que se pide --------------------------------
create table if not exists public.supplier_expected_invoice (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  supplier_id uuid not null references public.supplier(id) on delete cascade,
  cadence text not null default 'mensual' check (cadence in ('mensual')),
  typical_day smallint check (typical_day between 1 and 31),
  typical_total numeric(14,2),
  label text,
  source text not null check (source in ('aprendido', 'a_mano')),
  reason text,
  active boolean not null default true,
  since date,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  unique (company_id, supplier_id)
);
comment on table public.supplier_expected_invoice is
  'D01 · Lo que llega todos los meses del mismo proveedor (alquiler, luz, teléfono, seguros…). Si a mitad del mes siguiente no ha llegado, sale en «Esperadas y no llegadas».';
alter table public.supplier_expected_invoice enable row level security;
drop policy if exists supplier_expected_invoice_read on public.supplier_expected_invoice;
create policy supplier_expected_invoice_read on public.supplier_expected_invoice for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_expected_invoice from anon, authenticated;
grant select on public.supplier_expected_invoice to authenticated;

create table if not exists public.supplier_invoice_request (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  supplier_id uuid not null references public.supplier(id) on delete cascade,
  expected_id uuid references public.supplier_expected_invoice(id) on delete set null,
  period date not null check (extract(day from period) = 1),
  to_email text not null check (to_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject text not null,
  body text not null,
  status text not null default 'borrador' check (status in ('borrador', 'confirmado', 'enviado', 'error')),
  confirmed_at timestamptz,
  confirmed_by uuid,
  confirmed_by_name text,
  sent_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  -- El correo nunca sale sin que una persona lo confirme (R1, punto 5).
  check (status not in ('confirmado', 'enviado') or (confirmed_at is not null and confirmed_by_name is not null)),
  check (status <> 'enviado' or sent_at is not null)
);
create unique index if not exists supplier_invoice_request_mes_uq on public.supplier_invoice_request (supplier_id, period) where status in ('confirmado', 'enviado');
comment on table public.supplier_invoice_request is 'D01 · «Pedírsela»: el correo al contacto de facturación del proveedor cuando una factura esperada no llega. Lo confirma una persona antes de que salga.';
alter table public.supplier_invoice_request enable row level security;
drop policy if exists supplier_invoice_request_read on public.supplier_invoice_request;
create policy supplier_invoice_request_read on public.supplier_invoice_request for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_invoice_request from anon, authenticated;
grant select on public.supplier_invoice_request to authenticated;

-- Las esperadas y no llegadas: pasada la mitad del mes, la del mes anterior
-- que no ha llegado. Lee de supplier_invoice (las de Folvy) y del libro (lo
-- traído de Diez en la serie 2, por la subcuenta del proveedor): las dos son
-- la misma factura vista desde dos sitios.
create or replace function public.conta_esperadas_no_llegadas(p_company uuid, p_hoy date default (now() at time zone 'Europe/Madrid')::date)
returns table (expected_id uuid, supplier_id uuid, supplier_name text, label text, periodo date, ultima date, pedida text)
language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid; v_mes date;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  -- Antes del día 15 todavía se espera la del mes anterior; desde el 15, falta.
  v_mes := (date_trunc('month', p_hoy) - interval '1 month')::date;
  if extract(day from p_hoy) < 15 then return; end if;
  return query
  select x.id, x.supplier_id, s.name, coalesce(x.label, s.name), v_mes,
         greatest((select max(i.invoice_date) from public.supplier_invoice i where i.account_id = v_acc and i.supplier_id = x.supplier_id and i.status <> 'anulada'),
                  (select max(e.entry_date) from public.journal_entry e
                     join public.journal_line l on l.entry_id = e.id and l.account_id = v_acc
                     join public.company_account_link k on k.company_id = p_company and k.entity = 'supplier' and k.role = 'principal'
                                                        and k.entity_id = x.supplier_id::text and k.company_account_id = l.company_account_id
                    where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado')),
         (select r.status from public.supplier_invoice_request r where r.supplier_id = x.supplier_id and r.period = v_mes order by r.created_at desc limit 1)
    from public.supplier_expected_invoice x
    join public.supplier s on s.id = x.supplier_id and s.account_id = v_acc
   where x.company_id = p_company and x.account_id = v_acc and x.active
     and not exists (select 1 from public.supplier_invoice i where i.account_id = v_acc and i.supplier_id = x.supplier_id and i.status <> 'anulada'
                        and i.invoice_date >= v_mes and i.invoice_date < (v_mes + interval '1 month')::date)
     and not exists (select 1 from public.journal_entry e
                       join public.journal_line l on l.entry_id = e.id and l.account_id = v_acc
                       join public.company_account_link k on k.company_id = p_company and k.entity = 'supplier' and k.role = 'principal'
                                                          and k.entity_id = x.supplier_id::text and k.company_account_id = l.company_account_id
                      where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado'
                        and e.entry_date >= v_mes and e.entry_date < (v_mes + interval '1 month')::date)
   order by s.name;
end $$;
revoke all on function public.conta_esperadas_no_llegadas(uuid, date) from public, anon;
grant execute on function public.conta_esperadas_no_llegadas(uuid, date) to authenticated, service_role;

-- Las que se aprenden: los proveedores con una factura por mes en cada uno de
-- los tres últimos meses cerrados (del libro: Folvy y lo traído de Diez).
-- Propone, no pisa: lo que ya está (también lo desactivado a mano) no se toca.
create or replace function public.conta_esperadas_aprender(p_company uuid, p_hoy date default (now() at time zone 'Europe/Madrid')::date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_n integer;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not (public.current_user_is_admin_or_manager_of(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Solo un administrador o un encargado de la cuenta.' using errcode = '42501';
  end if;
  with meses as (select (date_trunc('month', p_hoy) - (n || ' month')::interval)::date m from generate_series(1, 3) n),
  por_mes as (
    select k.entity_id::uuid as supplier_id, date_trunc('month', e.entry_date)::date m, count(distinct e.id) n, max(extract(day from e.entry_date))::smallint dia
      from public.journal_entry e
      join public.journal_line l on l.entry_id = e.id and l.account_id = v_acc
      join public.company_account_link k on k.company_id = p_company and k.entity = 'supplier' and k.role = 'principal' and k.company_account_id = l.company_account_id
     where e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.status = 'validado'
       and e.entry_date >= (select min(m) from meses) and e.entry_date < date_trunc('month', p_hoy)::date
     group by 1, 2
  ),
  fijas as (select supplier_id, max(dia) dia from por_mes where n = 1 group by 1 having count(*) = 3)
  insert into public.supplier_expected_invoice (account_id, company_id, supplier_id, typical_day, source, reason, since)
  select v_acc, p_company, f.supplier_id, f.dia, 'aprendido',
         'Ha llegado una factura suya cada mes de los tres últimos meses.', (select min(m) from meses)
    from fijas f join public.supplier s on s.id = f.supplier_id and s.account_id = v_acc
  on conflict (company_id, supplier_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.conta_esperadas_aprender(uuid, date) from public, anon;
grant execute on function public.conta_esperadas_aprender(uuid, date) to authenticated, service_role;

-- 8. Lo que ha hecho Folvy, y cada persona --------------------------------------------
create table if not exists public.document_activity (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid references public.company(id) on delete cascade,
  inbox_id uuid references public.document_inbox(id) on delete cascade,
  supplier_invoice_id uuid references public.supplier_invoice(id) on delete set null,
  journal_entry_id uuid references public.journal_entry(id) on delete set null,
  actor text not null check (actor in ('folvy', 'persona')),
  actor_name text,
  action text not null check (action in ('recibida', 'leida', 'repetida', 'proveedor_propuesto', 'casada', 'propuesta', 'apuntada_sola', 'apuntada', 'corregida', 'deshecha', 'pedida', 'descartada', 'error')),
  text text not null,
  detail jsonb not null default '{}'::jsonb,
  undo_of uuid references public.document_activity(id) on delete set null,
  created_at timestamptz not null default now(),
  check (actor <> 'persona' or actor_name is not null)
);
create index if not exists document_activity_empresa_idx on public.document_activity (company_id, created_at desc);
comment on table public.document_activity is 'D01 · «Lo que ha hecho Folvy» y lo que hace cada persona en la bandeja, en palabras y con lo que se puede deshacer.';
alter table public.document_activity enable row level security;
drop policy if exists document_activity_read on public.document_activity;
create policy document_activity_read on public.document_activity for select
  using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.document_activity from anon, authenticated;
grant select on public.document_activity to authenticated;

-- 9. El proveedor traído de una factura ---------------------------------------------
alter table public.supplier add column if not exists created_from text check (created_from in ('factura'));
comment on column public.supplier.created_from is 'D01 · «factura»: dado de alta desde lo leído en una factura («Traída de factura · por completar»).';

-- 10. Para B (Bancos): las facturas recibidas pendientes de pago -----------------------
-- CONTRATO ESTABLE (D01 T1 §7). Si B pide más, se AÑADEN columnas al final;
-- lo que ya devuelve no cambia de nombre, de tipo ni de orden. Lo fija la
-- prueba de staging.
create or replace function public.banco_facturas_recibidas_pendientes(p_company uuid, p_hasta date default null)
returns table (
  invoice_id uuid, supplier_id uuid, supplier_name text, supplier_tax_id text,
  invoice_number text, invoice_date date, due_date date,
  total numeric, pending numeric, read_iban text, journal_entry_id uuid, status text)
language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  return query
  select i.id, i.supplier_id, s.name, s.tax_id, i.invoice_number, i.invoice_date, i.due_date,
         i.grand_total, i.grand_total, i.read_iban, i.journal_entry_id, i.status
    from public.supplier_invoice i
    left join public.supplier s on s.id = i.supplier_id and s.account_id = v_acc
   where i.account_id = v_acc and (i.company_id = p_company or i.company_id is null)
     and i.status in ('en_revision', 'aprobada', 'con_discrepancias') and i.paid_at is null
     and i.doc_kind = 'invoice'
     and (p_hasta is null or coalesce(i.due_date, i.invoice_date) <= p_hasta)
   order by coalesce(i.due_date, i.invoice_date), i.invoice_number;
end $$;
comment on function public.banco_facturas_recibidas_pendientes(uuid, date) is
  'D01 · Para B (Bancos): facturas recibidas de una empresa que no están pagadas, con su vencimiento e IBAN leído. Contrato estable: solo se añaden columnas al final.';
revoke all on function public.banco_facturas_recibidas_pendientes(uuid, date) from public, anon;
grant execute on function public.banco_facturas_recibidas_pendientes(uuid, date) to authenticated, service_role;

-- conta_lectura (los agentes) lee lo nuevo, si existe el rol (en staging no).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.company_purchase_setting, public.company_inbound_address, public.document_inbox, public.supplier_invoice_tax,
      public.supplier_expected_invoice, public.supplier_invoice_request, public.document_activity to conta_lectura;
  end if;
end $$;

-- Comprobación ----------------------------------------------------------------------------
do $verif$
declare v_n int;
begin
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('company_purchase_setting', 'company_inbound_address', 'document_inbox', 'supplier_invoice_tax',
                                               'supplier_expected_invoice', 'supplier_invoice_request', 'document_activity') and c.relrowsecurity;
  if v_n <> 7 then raise exception 'D01: % de 7 tablas nuevas con RLS.', v_n; end if;
  if (select count(*) from public.company_purchase_setting) < (select count(*) from public.company) then
    raise exception 'D01: falta el ajuste de compras de alguna empresa.';
  end if;
  raise notice 'D01: 7 tablas con RLS; ajuste de compras en % empresa(s) (% recibe(n) mercancía); % dirección(es) de facturas.',
    (select count(*) from public.company_purchase_setting), (select count(*) from public.company_purchase_setting where receives_goods),
    (select count(*) from public.company_inbound_address);
end
$verif$;

-- ============================================================================
-- D01 · Tres CHECK que se AMPLÍAN (solo admiten más; nada de lo que vale hoy
-- deja de valer). Van aparte de la 0200 porque son «cambiar en caliente»:
--
-- cambia: public.supplier_contact · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- cambia: public.company_account_link · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
-- cambia: public.journal_entry_document · prueba: supabase/staging/sql/20261021_d01_base_prueba.sql
--
--   1. supplier_contact.role + 'billing' («Facturación»): a quién se le pide la
--      factura que no llega (R1, punto 5).
--   2. company_account_link.source + 'aprendido_diez': «Sus facturas se apuntan
--      en» rellenado desde el histórico de Diez al confirmar (R1, punto 2).
--   3. journal_entry_document.kind + 'factura_recibida': el PDF de la factura
--      recibida, enlazado a su asiento en conta-documentos (R1, punto 4). La
--      prueba comprueba que 'resumen_ventas' sigue valiendo igual, y la del
--      R15 (20261021_conta_documentos_prueba.sql) vuelve a pasar después.
--
-- Cada CHECK se quita y se vuelve a poner en la MISMA transacción, con los
-- valores de antes y uno más. Las tres tablas son pequeñas.
-- Vuelta atrás: supabase/vuelta-atras/20261021T0210_d01_amplia.down.sql
-- ============================================================================

alter table public.supplier_contact drop constraint if exists supplier_contact_role_check;
alter table public.supplier_contact add constraint supplier_contact_role_check
  check (role = any (array['orders', 'sales', 'admin', 'delivery', 'other', 'billing']));

alter table public.company_account_link drop constraint if exists company_account_link_source_check;
alter table public.company_account_link add constraint company_account_link_source_check
  check (source = any (array['serie', 'manual', 'ai_accepted', 'migrated', 'aprendido_diez']));

alter table public.journal_entry_document drop constraint if exists journal_entry_document_kind_check;
alter table public.journal_entry_document add constraint journal_entry_document_kind_check
  check (kind = any (array['resumen_ventas', 'factura_recibida']));

-- supabase/staging/sql/20261021_d01_base_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0200 (la base de Facturas recibidas) y de
-- 20261021T0210 (los tres CHECK que se amplían: public.supplier_contact,
-- public.company_account_link, public.journal_entry_document). Todo en una
-- transacción con ROLLBACK. Como administrador de A y como el de B (RLS A/B).
--
--   1. El ajuste «Recibe la mercancía con Folvy»: sembrado para la empresa de
--      A, lo cambia su administrador; el de B no puede.
--   2. La dirección de facturas: facturas-<empresa>@entrada.folvy.app, nace
--      apagada, no lleva el NIF y la segunda vez devuelve la misma.
--   3. La regla única de repetidas: el mismo número normalizado del mismo
--      proveedor no entra dos veces; con «No es repetida», sí. La función dice
--      repetida y posible igual que el núcleo de lectura.
--   4. La función para B: devuelve la factura pendiente con su contrato
--      (nombres, tipos y orden de las columnas, fijados aquí).
--   5. Los tres CHECK: 'billing', 'aprendido_diez' y 'factura_recibida' valen;
--      lo de antes sigue valiendo; lo que no existe, no.
--   6. Las esperadas: aprender y «no llegadas» corren como usuario.
--   7. Escribir directamente en las tablas nuevas: no. Y B no ve nada de A.

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('prueba.empresa', (select id::text from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a' order by created_at limit 1), true);
select set_config('prueba.empresa_b', (select id::text from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' order by created_at limit 1), true);

-- ── 0 · Lo que crean las dos migraciones ─────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.company_purchase_setting where company_id = current_setting('prueba.empresa')::uuid) then
    raise exception 'PRUEBA D01 · 0: la empresa de A no tiene su ajuste de compras sembrado.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'supplier_contact_role_check')) not like '%billing%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'company_account_link_source_check')) not like '%aprendido_diez%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_document_kind_check')) not like '%factura_recibida%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_entry_document_kind_check')) not like '%resumen_ventas%' then
    raise exception 'PRUEBA D01 · 0: algún CHECK no está ampliado como dice la 0210.';
  end if;
  raise notice 'PRUEBA D01 · 0: ajuste sembrado (recibe mercancía: %), y los tres CHECK ampliados sin perder lo de antes.',
    (select receives_goods from public.company_purchase_setting where company_id = current_setting('prueba.empresa')::uuid);
end $$;

-- ── 1 a 6 · Como administrador de A ──────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := current_setting('prueba.empresa')::uuid;
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_prov constant uuid := 'c01a0000-0000-4000-8000-0000000000a3'; -- Hermanos Ruiz, de A (semilla)
  r jsonb; v_i1 uuid; v_i2 uuid; v_n int; v_t record; v_res text;
begin
  -- 1 · el ajuste
  r := public.conta_ajustes_compras_guardar(v_e, true, false, 'Prueba D01');
  if (r->>'receives_goods')::boolean is not true or r->>'updated_by_name' <> 'Prueba D01' then raise exception 'PRUEBA D01 · 1: el ajuste no se ha guardado: %', r; end if;
  if public.conta_recibe_mercancia(v_e) is not true then raise exception 'PRUEBA D01 · 1: conta_recibe_mercancia no dice lo guardado.'; end if;
  raise notice 'PRUEBA D01 · 1: «Recibe la mercancía con Folvy» guardado por su administrador, con su porqué: %', r->>'receives_goods_reason';

  -- 2 · la dirección
  r := public.conta_direccion_facturas(v_e, 'Prueba D01');
  if r->>'direccion' !~ '^facturas-[a-z0-9-]+@entrada\.folvy\.app$' or (r->>'active')::boolean or (r->>'ya_estaba')::boolean then
    raise exception 'PRUEBA D01 · 2: la dirección no es la esperada: %', r;
  end if;
  if r->>'direccion' ~ (select lower(coalesce(nullif(regexp_replace(tax_id, '[^A-Za-z0-9]', '', 'g'), ''), 'nonif')) from public.company where id = v_e) then
    raise exception 'PRUEBA D01 · 2: la dirección lleva el NIF.';
  end if;
  if not (public.conta_direccion_facturas(v_e, 'Prueba D01')->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 · 2: la segunda vez ha hecho otra.'; end if;
  raise notice 'PRUEBA D01 · 2: dirección %, apagada hasta que el dominio exista; la segunda vez, la misma.', r->>'direccion';

  -- 3 · repetidas
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name)
  values (v_acc, v_prov, v_e, 'D01/0001-A', '2026-09-30', 'en_revision', 'manual', 110, 100, 10, 'Prueba D01') returning id into v_i1;
  begin
    insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name)
    values (v_acc, v_prov, v_e, 'd01 0001 a', '2026-10-01', 'en_revision', 'manual', 999, 'Prueba D01');
    raise exception 'PRUEBA D01 · 3: ha entrado la misma factura con el número escrito de otra forma.';
  exception when unique_violation then raise notice 'PRUEBA D01 · 3: «d01 0001 a» no entra: es «D01/0001-A» del mismo proveedor.'; end;
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, created_by_name, not_duplicate_confirmed_at, not_duplicate_confirmed_by_name)
  values (v_acc, v_prov, v_e, 'd01 0001 a', '2026-10-01', 'en_revision', 'manual', 999, 'Prueba D01', now(), 'Prueba D01') returning id into v_i2;
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, 'D01-0001/A', null, null);
  if v_res is distinct from 'repetida' then raise exception 'PRUEBA D01 · 3: la función no dice repetida (%).', v_res; end if;
  select nivel into v_res from public.supplier_invoice_repetida(v_acc, v_prov, null, 'D01/0002', '2026-09-30', 110);
  if v_res is distinct from 'posible' then raise exception 'PRUEBA D01 · 3: misma fecha y total con otro número no es «posible» (%).', v_res; end if;
  select count(*) into v_n from public.supplier_invoice_repetida(v_acc, v_prov, null, 'D01/0003', '2026-10-31', 110);
  if v_n <> 0 then raise exception 'PRUEBA D01 · 3: el mismo total otro día sale como repetida.'; end if;
  raise notice 'PRUEBA D01 · 3: con «No es repetida» sí entra; la función dice repetida, posible y nada, como el núcleo.';

  -- 4 · la función para B
  if pg_get_function_result('public.banco_facturas_recibidas_pendientes(uuid,date)'::regprocedure) <> 'TABLE(invoice_id uuid, supplier_id uuid, supplier_name text, supplier_tax_id text, invoice_number text, invoice_date date, due_date date, total numeric, pending numeric, read_iban text, journal_entry_id uuid, status text)' then
    raise exception 'PRUEBA D01 · 4: el contrato de la función para B ha cambiado: %', pg_get_function_result('public.banco_facturas_recibidas_pendientes(uuid,date)'::regprocedure);
  end if;
  select * into v_t from public.banco_facturas_recibidas_pendientes(v_e) where invoice_id = v_i1;
  if v_t.invoice_id is null or v_t.pending <> 110 or v_t.invoice_number <> 'D01/0001-A' then raise exception 'PRUEBA D01 · 4: la factura pendiente no sale bien: %', to_jsonb(v_t); end if;
  raise notice 'PRUEBA D01 · 4: la función para B devuelve la pendiente con su contrato de 12 columnas.';

  -- 5 · los CHECK, como usuario
  insert into public.supplier_contact (account_id, supplier_id, name, role, email) values (v_acc, v_prov, 'Facturación Prueba', 'billing', 'facturas@ejemplo.test');
  begin
    insert into public.supplier_contact (account_id, supplier_id, name, role) values (v_acc, v_prov, 'Otro', 'no_existe');
    raise exception 'PRUEBA D01 · 5: ha entrado un papel de contacto que no existe.';
  exception when check_violation then null; end;
  raise notice 'PRUEBA D01 · 5: el contacto de facturación entra; un papel que no existe, no.';

  -- 6 · esperadas
  v_n := public.conta_esperadas_aprender(v_e, '2026-10-20');
  select count(*) into v_n from public.conta_esperadas_no_llegadas(v_e, '2026-10-20');
  raise notice 'PRUEBA D01 · 6: esperadas aprendidas y «no llegadas» corren como usuario (% no llegadas en staging).', v_n;

  -- 7 · escribir directamente en lo nuevo: no
  begin
    insert into public.document_inbox (account_id, channel) values (v_acc, 'subida');
    raise exception 'PRUEBA D01 · 7: ha dejado escribir en document_inbox directamente.';
  exception when insufficient_privilege then raise notice 'PRUEBA D01 · 7: escribir en la bandeja directamente: no.'; end;
  perform set_config('prueba.factura', v_i1::text, true);
end $$;
reset role;

-- ── 7 · Como administrador de B ──────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := current_setting('prueba.empresa')::uuid; v_n int;
begin
  begin
    perform public.conta_ajustes_compras_guardar(v_e, false, true, 'B');
    raise exception 'PRUEBA D01 · 7: B ha cambiado el ajuste de A.';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.banco_facturas_recibidas_pendientes(v_e);
    raise exception 'PRUEBA D01 · 7: B ha leído las pendientes de A.';
  exception when sqlstate 'P0002' then null; end;
  select (select count(*) from public.company_purchase_setting where company_id = v_e) + (select count(*) from public.company_inbound_address where company_id = v_e)
       + (select count(*) from public.supplier_invoice_tax) + (select count(*) from public.document_inbox where account_id = 'c01a0000-0000-4000-8000-00000000000a')
       + (select count(*) from public.supplier_invoice where id = current_setting('prueba.factura')::uuid) into v_n;
  if v_n <> 0 then raise exception 'PRUEBA D01 · 7: B ve % fila(s) de A.', v_n; end if;
  begin
    perform * from public.supplier_invoice_repetida('c01a0000-0000-4000-8000-00000000000a', null, null, 'X', null, null);
    raise exception 'PRUEBA D01 · 7: B ha preguntado por repetidas de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 · 7: B no cambia ni lee nada de A (ajuste, dirección, facturas, pendientes, repetidas).';
end $$;
reset role;

rollback;
