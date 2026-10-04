-- ============================================================================
-- C01 · Ficha de proveedor completa — ESTRUCTURA
-- ----------------------------------------------------------------------------
-- Encargo C01 (01/10/2026), respuestas 1 y 2 de Julio. Módulo de contabilidad.
--
-- SOLO AÑADE. No se borra ni se renombra nada. Las columnas antiguas
-- supplier.email / phone / address se quedan (deuda a borrar en un encargo
-- posterior, ver PR); a partir de aquí ningún código las lee ni las escribe.
--
-- Orden de aplicación: staging-conta primero; producción solo con el PR
-- aprobado. Toma ACCESS EXCLUSIVE breve sobre supplier, supplier_invoice y
-- compliance_document (añadir columnas y CHECK): fuera de la banda 12:15–00:30.
-- ============================================================================

-- ── 1 · Catálogo GLOBAL de tipos de gasto ───────────────────────────────────
-- Excepción declarada a «toda tabla nueva lleva account_id»: es un catálogo de
-- Folvy para todas las cuentas (como vat_category). Cada empresa oculta los que
-- no use en general_row_setting (C00), que sí lleva account_id. C02 lo enlazará
-- con el plan contable de cada cuenta; pgc_account_hint es la cuenta del PGC.
create table if not exists public.expense_category (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  pgc_account_hint text not null,
  sort_order       smallint not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);
comment on table public.expense_category is
  'C01. Tipos de gasto (catálogo global de Folvy). pgc_account_hint = cuenta del PGC (RD 1514/2007) que le corresponde; C02 lo enlaza con el plan contable de cada cuenta.';

-- Solo los que faltan (C00 R7): así el fichero se puede volver a aplicar
-- después del C00, cuya 0120 exige más campos a las filas de serie (la
-- restricción expense_category_serie se comprueba antes que el on conflict).
-- La primera vez, la tabla está vacía y entran los doce, como antes.
insert into public.expense_category (code, name, pgc_account_hint, sort_order)
select v.code, v.name, v.pgc_account_hint, v.sort_order from (values
  ('food_beverage',      'Comida y bebida',                     '600', 10),
  ('packaging',          'Envases, embalajes y desechables',    '602', 20),
  ('cleaning_tableware', 'Limpieza y menaje',                   '602', 30),
  ('rent',               'Alquiler',                            '621', 40),
  ('repairs',            'Reparaciones y mantenimiento',        '622', 50),
  ('professional',       'Asesoría y servicios profesionales',  '623', 60),
  ('transport',          'Transporte',                          '624', 70),
  ('insurance',          'Seguros',                             '625', 80),
  ('bank_platform_fees', 'Comisiones de bancos y plataformas',  '626', 90),
  ('advertising',        'Publicidad',                          '627', 100),
  ('utilities',          'Luz, agua, gas y teléfono',           '628', 110),
  ('other_services',     'Otros servicios',                     '629', 120)
) as v(code, name, pgc_account_hint, sort_order)
where not exists (select 1 from public.expense_category e where e.code = v.code)
on conflict (code) do nothing;

alter table public.expense_category enable row level security;
drop policy if exists expense_category_select on public.expense_category;
create policy expense_category_select on public.expense_category
  for select to authenticated using (true);
revoke all on table public.expense_category from anon, authenticated;
grant select on table public.expense_category to authenticated;

-- (Aquí estaba expense_category_hidden, la forma del C01 de que una cuenta
-- ocultara tipos de gasto. Quitada antes de llegar a producción por decisión de
-- Julio, respuesta 2 del C00: el C00 ya oculta filas de cualquier tabla general
-- por empresa, en general_row_setting, y una segunda tabla solo para tipos de
-- gasto sería un cadáver desde el primer día. La ficha del C01 lee de ahí.)

-- ── 2 · supplier: columnas nuevas ───────────────────────────────────────────
alter table public.supplier
  add column if not exists legal_name                 text,
  add column if not exists tax_id_type                text,
  add column if not exists country_code               text not null default 'ES',
  add column if not exists entity_kind                text,
  add column if not exists tax_id_verified_at         timestamptz,
  add column if not exists tax_id_check_status        text,
  add column if not exists tax_id_checked_at          timestamptz,
  add column if not exists fiscal_street              text,
  add column if not exists fiscal_postal_code         text,
  add column if not exists fiscal_city                text,
  add column if not exists fiscal_province            text,
  add column if not exists vat_regime                 text,
  add column if not exists usual_vat_rates            numeric[] not null default '{}',
  add column if not exists irpf_withholding_pct       numeric,
  add column if not exists expense_category_id        uuid references public.expense_category(id),
  add column if not exists default_location_id        uuid references public.locations(id),
  add column if not exists payment_method             text,
  add column if not exists payment_terms_days         integer,
  add column if not exists payment_fixed_days         smallint[] not null default '{}',
  add column if not exists iban                       text,
  add column if not exists iban_verified_at           timestamptz,
  add column if not exists bank_name                  text,
  add column if not exists ledger_account_code        text,
  -- Comparación con Holded (respuesta 2, punto 5). No cuentan para el %.
  add column if not exists website                    text,
  add column if not exists tags                       text[] not null default '{}',
  add column if not exists bic                        text,
  add column if not exists sepa_mandate_ref           text,
  add column if not exists sepa_mandate_date          date,
  add column if not exists currency                   text not null default 'EUR',
  add column if not exists early_payment_discount_pct numeric;

alter table public.supplier
  drop constraint if exists supplier_tax_id_type_check,
  add constraint supplier_tax_id_type_check check (tax_id_type is null or tax_id_type in ('nif_es','vat_eu','foreign')),
  drop constraint if exists supplier_entity_kind_check,
  add constraint supplier_entity_kind_check check (entity_kind is null or entity_kind in ('company','self_employed')),
  drop constraint if exists supplier_tax_id_check_status_check,
  add constraint supplier_tax_id_check_status_check check (tax_id_check_status is null or tax_id_check_status in ('valid','invalid','pending')),
  drop constraint if exists supplier_vat_regime_check,
  add constraint supplier_vat_regime_check check (vat_regime is null or vat_regime in
    ('general','recargo_equivalencia','intracomunitario','exento','inversion_sujeto_pasivo','extranjero')),
  drop constraint if exists supplier_payment_method_check,
  add constraint supplier_payment_method_check check (payment_method is null or payment_method in ('transfer','direct_debit','card','cash')),
  drop constraint if exists supplier_country_code_check,
  add constraint supplier_country_code_check check (country_code ~ '^[A-Z]{2}$'),
  drop constraint if exists supplier_currency_check,
  add constraint supplier_currency_check check (currency ~ '^[A-Z]{3}$'),
  drop constraint if exists supplier_iban_format_check,
  add constraint supplier_iban_format_check check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  drop constraint if exists supplier_payment_terms_check,
  add constraint supplier_payment_terms_check check (payment_terms_days is null or payment_terms_days between 0 and 365),
  drop constraint if exists supplier_irpf_check,
  add constraint supplier_irpf_check check (irpf_withholding_pct is null or irpf_withholding_pct between 0 and 100),
  drop constraint if exists supplier_early_discount_check,
  add constraint supplier_early_discount_check check (early_payment_discount_pct is null or early_payment_discount_pct between 0 and 100);

comment on column public.supplier.legal_name is 'C01. Razón social. name sigue siendo el nombre comercial que se ve en la app.';
comment on column public.supplier.tax_id_check_status is 'C01. valid/invalid/pending. pending = VIES no contestó; la ficha dice «Comprobando con la UE…» y se reintenta. No bloquea.';
comment on column public.supplier.iban is 'C01. Sin espacios y en mayúsculas. Validado ISO 13616 (módulo 97) en el núcleo antes de guardar.';
comment on column public.supplier.ledger_account_code is 'C01. Vacío hasta C02 (plan contable): «Se asigna al activar el plan contable».';
-- C00 R7 (03/10/2026): aquí marcaba supplier.email/phone/address como
-- OBSOLETAS. Ya no: el C01 se separó del PR #138 y Cocina las sigue leyendo y
-- escribiendo (pantalla de Proveedores de siempre, alta desde el albarán,
-- compliance_docs_due). Se marcarán con la ficha nueva, en su encargo.

-- ── 3 · supplier_contact ────────────────────────────────────────────────────
create table if not exists public.supplier_contact (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  supplier_id     uuid not null references public.supplier(id) on delete cascade,
  name            text not null,
  role            text not null default 'other' check (role in ('orders','sales','admin','delivery','other')),
  phone           text,
  email           text,
  is_primary      boolean not null default false,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text
);
comment on table public.supplier_contact is
  'C01. Personas de contacto de un proveedor, cada una con su papel. Hasta la ficha nueva (C01), el email y el teléfono que usa Cocina siguen en supplier.email/phone.';
create index if not exists idx_supplier_contact_supplier on public.supplier_contact (supplier_id);
create index if not exists idx_supplier_contact_account on public.supplier_contact (account_id);
-- Un solo contacto principal por proveedor.
create unique index if not exists ux_supplier_contact_primary on public.supplier_contact (supplier_id) where is_primary;

drop trigger if exists trg_supplier_contact_updated_at on public.supplier_contact;
create trigger trg_supplier_contact_updated_at before update on public.supplier_contact
  for each row execute function set_updated_at();

-- El contacto y su proveedor son de la misma cuenta (RLS mira account_id).
create or replace function public.supplier_contact_misma_cuenta()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from supplier s where s.id = new.supplier_id and s.account_id = new.account_id) then
    raise exception 'El contacto y su proveedor tienen que ser de la misma cuenta.';
  end if;
  return new;
end $$;
revoke all on function public.supplier_contact_misma_cuenta() from public, anon, authenticated;
drop trigger if exists trg_supplier_contact_misma_cuenta on public.supplier_contact;
create trigger trg_supplier_contact_misma_cuenta before insert or update of account_id, supplier_id on public.supplier_contact
  for each row execute function public.supplier_contact_misma_cuenta();

alter table public.supplier_contact enable row level security;
drop policy if exists supplier_contact_select on public.supplier_contact;
create policy supplier_contact_select on public.supplier_contact for select using (belongs_to_account(account_id));
drop policy if exists supplier_contact_insert on public.supplier_contact;
create policy supplier_contact_insert on public.supplier_contact for insert with check (current_user_is_admin_or_manager_of(account_id));
drop policy if exists supplier_contact_update on public.supplier_contact;
create policy supplier_contact_update on public.supplier_contact for update using (current_user_is_admin_or_manager_of(account_id));
drop policy if exists supplier_contact_delete on public.supplier_contact;
create policy supplier_contact_delete on public.supplier_contact for delete using (current_user_is_admin_or_manager_of(account_id));
revoke all on table public.supplier_contact from anon;

-- ── 4 · supplier_proposal: datos propuestos que esperan confirmación ────────
-- Una propuesta NUNCA es un dato: se enseña con «Confirmar» y solo al confirmar
-- se escribe en la ficha. Origen: el reparto de la dirección antigua, o lo que
-- la lectura automática leyó de una factura o un albarán (§5.4).
create table if not exists public.supplier_proposal (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  supplier_id     uuid not null references public.supplier(id) on delete cascade,
  field           text not null check (field in ('tax_id','legal_name','fiscal_address')),
  value           jsonb not null,
  source          text not null check (source in ('legacy_address','supplier_invoice','goods_receipt')),
  source_id       uuid,
  source_label    text,
  status          text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  decided_at      timestamptz,
  decided_by      uuid,
  decided_by_name text,
  created_at      timestamptz not null default now()
);
comment on table public.supplier_proposal is
  'C01. Datos propuestos para la ficha (nunca se guardan sin confirmación). source_label = lo que se enseña: «Leído de su factura F-…».';
-- Un dato propuesto una sola vez por origen; uno rechazado no vuelve a salir.
create unique index if not exists ux_supplier_proposal_origen
  on public.supplier_proposal (supplier_id, field, source, coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_supplier_proposal_pending on public.supplier_proposal (supplier_id) where status = 'pending';

alter table public.supplier_proposal enable row level security;
drop policy if exists supplier_proposal_select on public.supplier_proposal;
create policy supplier_proposal_select on public.supplier_proposal for select using (belongs_to_account(account_id));
drop policy if exists supplier_proposal_insert on public.supplier_proposal;
create policy supplier_proposal_insert on public.supplier_proposal for insert with check (current_user_is_admin_or_manager_of(account_id));
drop policy if exists supplier_proposal_update on public.supplier_proposal;
create policy supplier_proposal_update on public.supplier_proposal for update using (current_user_is_admin_or_manager_of(account_id));
drop policy if exists supplier_proposal_delete on public.supplier_proposal;
create policy supplier_proposal_delete on public.supplier_proposal for delete using (current_user_is_admin_or_manager_of(account_id));
revoke all on table public.supplier_proposal from anon;

-- Propone, desde la lectura automática más antigua de este proveedor (factura o
-- albarán), el NIF, la razón social y la dirección que la ficha NO tiene. No
-- escribe en supplier: solo deja propuestas pendientes. SECURITY INVOKER: corre
-- con la RLS de quien abre la ficha.
create or replace function public.refresh_supplier_proposals(p_supplier_id uuid)
returns integer
language plpgsql security invoker set search_path = public as $$
declare
  s   supplier%rowtype;
  doc jsonb;
  src text; src_id uuid; src_label text;
  n   integer := 0;
begin
  select * into s from supplier where id = p_supplier_id;
  if not found then return 0; end if;

  -- La primera lectura: factura antes que albarán, la más antigua.
  select g.parsed_result -> 'document', x.src, x.src_id, x.lbl
    into doc, src, src_id, src_label
  from (
    select 'supplier_invoice'::text src, i.id src_id, i.ai_session_id ses,
           'Leído de su factura ' || coalesce(i.invoice_number, i.code, '') lbl, i.created_at t, 1 prio
    from supplier_invoice i where i.supplier_id = s.id and i.account_id = s.account_id and i.ai_session_id is not null
    union all
    select 'goods_receipt', r.id, r.ai_session_id,
           'Leído de su albarán ' || coalesce(r.supplier_doc_number, r.code, ''), r.created_at, 2
    from goods_receipt r where r.supplier_id = s.id and r.account_id = s.account_id and r.ai_session_id is not null
  ) x
  join goods_receipt_ai_session g on g.id = x.ses and g.account_id = s.account_id
  order by x.prio, x.t
  limit 1;

  if doc is null then return 0; end if;

  if coalesce(trim(s.tax_id), '') = '' and coalesce(trim(doc ->> 'supplier_tax_id'), '') <> '' then
    insert into supplier_proposal (account_id, supplier_id, field, value, source, source_id, source_label)
    values (s.account_id, s.id, 'tax_id', to_jsonb(trim(doc ->> 'supplier_tax_id')), src, src_id, trim(src_label))
    on conflict do nothing;
    get diagnostics n = row_count;
  end if;
  if coalesce(trim(s.legal_name), '') = '' and coalesce(trim(doc ->> 'supplier_name'), '') <> '' then
    insert into supplier_proposal (account_id, supplier_id, field, value, source, source_id, source_label)
    values (s.account_id, s.id, 'legal_name', to_jsonb(trim(doc ->> 'supplier_name')), src, src_id, trim(src_label))
    on conflict do nothing;
  end if;
  if coalesce(trim(s.fiscal_street), '') = '' and coalesce(trim(doc ->> 'supplier_address'), '') <> '' then
    -- La dirección va en una línea; el reparto lo propone el núcleo
    -- (proponerDireccion) al enseñarla, y la persona confirma.
    insert into supplier_proposal (account_id, supplier_id, field, value, source, source_id, source_label)
    values (s.account_id, s.id, 'fiscal_address', jsonb_build_object('line', trim(doc ->> 'supplier_address')), src, src_id, trim(src_label))
    on conflict do nothing;
  end if;
  select count(*) into n from supplier_proposal where supplier_id = s.id and status = 'pending';
  return n;
end $$;
revoke all on function public.refresh_supplier_proposals(uuid) from public, anon;
grant execute on function public.refresh_supplier_proposals(uuid) to authenticated, service_role;

-- ── 5 · compliance_document: certificado de titularidad bancaria ────────────
alter table public.compliance_document drop constraint compliance_document_doc_family_check;
alter table public.compliance_document add constraint compliance_document_doc_family_check
  check (doc_family = any (array['food_spec','chemical_spec','chemical_sds','pest_contract','pest_spec',
    'water_analysis','oil_manager','supplier_approval','other','bank_ownership_certificate']));

-- ── 6 · supplier_invoice: vencimiento y pago ────────────────────────────────
alter table public.supplier_invoice
  add column if not exists due_date          date,
  add column if not exists due_date_set_by   uuid,
  add column if not exists due_date_set_name text,
  add column if not exists due_date_set_at   timestamptz,
  add column if not exists paid_at           date,
  add column if not exists paid_method       text,
  add column if not exists paid_by           uuid,
  add column if not exists paid_by_name      text;
alter table public.supplier_invoice
  drop constraint if exists supplier_invoice_paid_method_check,
  add constraint supplier_invoice_paid_method_check check (paid_method is null or paid_method in ('transfer','direct_debit','card','cash')),
  drop constraint if exists supplier_invoice_pagada_con_fecha,
  add constraint supplier_invoice_pagada_con_fecha check (paid_at is null or status = 'pagada');
comment on column public.supplier_invoice.due_date is
  'C01. Vencimiento. Al aprobar se calcula con las condiciones del proveedor (plazo + días fijos). Si se cambia a mano, due_date_set_* dice quién y cuándo.';
comment on column public.supplier_invoice.paid_at is
  'C01. Fecha de pago. «Marcar como pagada» la pone junto a status=pagada; «Deshacer» la quita y vuelve a aprobada. Rastro en supplier_invoice_payment_log.';

create table if not exists public.supplier_invoice_payment_log (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  invoice_id  uuid not null references public.supplier_invoice(id) on delete cascade,
  action      text not null check (action in ('paid','unpaid','due_date_changed')),
  paid_at     date,
  paid_method text,
  due_date    date,
  actor_id    uuid,
  actor_name  text,
  created_at  timestamptz not null default now()
);
comment on table public.supplier_invoice_payment_log is
  'C01. Quién marcó una factura de proveedor como pagada, quién lo deshizo y quién cambió su vencimiento a mano. Solo se añade.';
create index if not exists idx_sipl_invoice on public.supplier_invoice_payment_log (invoice_id, created_at desc);
alter table public.supplier_invoice_payment_log enable row level security;
drop policy if exists sipl_select on public.supplier_invoice_payment_log;
create policy sipl_select on public.supplier_invoice_payment_log for select using (belongs_to_account(account_id));
revoke all on table public.supplier_invoice_payment_log from anon, authenticated;
grant select on table public.supplier_invoice_payment_log to authenticated;

-- Marcar como pagada / deshacer / cambiar vencimiento: tres RPC que escriben la
-- factura y su rastro en la MISMA transacción. SECURITY DEFINER porque el
-- cliente no tiene INSERT sobre el rastro (así nadie lo escribe a mano); a
-- cambio, cada una comprueba el permiso a la entrada con la misma regla que la
-- RLS de supplier_invoice: belongs_to_account.
create or replace function public._actor_name(p_account_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select display_name from user_profiles where user_id = auth.uid() and account_id = p_account_id limit 1;
$$;
revoke all on function public._actor_name(uuid) from public, anon, authenticated;

create or replace function public.mark_supplier_invoice_paid(p_invoice_id uuid, p_paid_at date, p_method text)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv supplier_invoice%rowtype; v_name text;
begin
  select * into v_inv from supplier_invoice where id = p_invoice_id for update;
  if not found or not belongs_to_account(v_inv.account_id) then raise exception 'No encuentro esa factura.'; end if;
  if v_inv.status not in ('aprobada','pagada') then
    raise exception 'Solo se puede marcar como pagada una factura aprobada.';
  end if;
  if p_paid_at is null then raise exception 'Falta la fecha de pago.'; end if;
  if p_method is not null and p_method not in ('transfer','direct_debit','card','cash') then
    raise exception 'Esa forma de pago no existe.';
  end if;
  v_name := _actor_name(v_inv.account_id);
  update supplier_invoice set status = 'pagada', paid_at = p_paid_at, paid_method = p_method,
         paid_by = auth.uid(), paid_by_name = v_name, updated_at = now()
   where id = p_invoice_id;
  insert into supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
  values (v_inv.account_id, p_invoice_id, 'paid', p_paid_at, p_method, auth.uid(), v_name);
end $$;

create or replace function public.unmark_supplier_invoice_paid(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv supplier_invoice%rowtype; v_name text;
begin
  select * into v_inv from supplier_invoice where id = p_invoice_id for update;
  if not found or not belongs_to_account(v_inv.account_id) then raise exception 'No encuentro esa factura.'; end if;
  if v_inv.status <> 'pagada' then raise exception 'Esa factura no está marcada como pagada.'; end if;
  v_name := _actor_name(v_inv.account_id);
  update supplier_invoice set status = 'aprobada', paid_at = null, paid_method = null,
         paid_by = null, paid_by_name = null, updated_at = now()
   where id = p_invoice_id;
  insert into supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_id, actor_name)
  values (v_inv.account_id, p_invoice_id, 'unpaid', v_inv.paid_at, v_inv.paid_method, auth.uid(), v_name);
end $$;

create or replace function public.set_supplier_invoice_due_date(p_invoice_id uuid, p_due_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv supplier_invoice%rowtype; v_name text;
begin
  select * into v_inv from supplier_invoice where id = p_invoice_id for update;
  if not found or not belongs_to_account(v_inv.account_id) then raise exception 'No encuentro esa factura.'; end if;
  v_name := _actor_name(v_inv.account_id);
  update supplier_invoice set due_date = p_due_date, due_date_set_by = auth.uid(), due_date_set_name = v_name,
         due_date_set_at = now(), updated_at = now()
   where id = p_invoice_id;
  insert into supplier_invoice_payment_log (account_id, invoice_id, action, due_date, actor_id, actor_name)
  values (v_inv.account_id, p_invoice_id, 'due_date_changed', p_due_date, auth.uid(), v_name);
end $$;

revoke all on function public.mark_supplier_invoice_paid(uuid, date, text) from public, anon;
revoke all on function public.unmark_supplier_invoice_paid(uuid) from public, anon;
revoke all on function public.set_supplier_invoice_due_date(uuid, date) from public, anon;
grant execute on function public.mark_supplier_invoice_paid(uuid, date, text) to authenticated, service_role;
grant execute on function public.unmark_supplier_invoice_paid(uuid) to authenticated, service_role;
grant execute on function public.set_supplier_invoice_due_date(uuid, date) to authenticated, service_role;
