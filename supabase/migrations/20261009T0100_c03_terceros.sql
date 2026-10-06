-- ============================================================================
-- C03 · Clientes, plataformas y socios de marca — 1 · EL TERCERO Y SUS PAPELES
-- ----------------------------------------------------------------------------
-- `party` es la ficha única de alguien con quien la empresa trata: proveedor,
-- cliente, plataforma de reparto o socio de marca. Los papeles van en
-- `party_role`; los datos fiscales y de cobro del papel de cliente, en
-- `customer_fiscal`.
--
-- El proveedor NO se convierte: `supplier` sigue siendo la ficha de Cocina (diez
-- tablas le apuntan) y su papel lo enlaza `party_role.supplier_id`, único. Así
-- ni una fila de `supplier` cambia al migrar (antes = después, literal) y lo de
-- Cocina sigue leyendo y escribiendo lo de siempre. El encargo decía
-- `supplier.party_id`; el enlace es el mismo, por el otro lado.
--
-- Un NIF, un tercero (regla 1): índice único por cuenta sobre el NIF
-- normalizado. Un proveedor nuevo de Cocina con el NIF de un cliente que ya
-- existe se cuelga de ese tercero: el disparador de alta nunca falla (está en
-- el camino del albarán), como mucho deja el tercero sin NIF y lo ve el agente.
--
-- El `customer` de la tienda NO es un tercero: es un consumidor con login.
-- Vuelta atrás: supabase/vuelta-atras/20261009T0100_c03_terceros.down.sql
-- ============================================================================

-- ── 0 · El NIF, normalizado (mayúsculas, sin espacios ni signos) ────────────
create or replace function public.party_nif(p text)
returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
comment on function public.party_nif(text) is 'C03. El NIF como se compara: mayúsculas y solo letras y números. «B-12.345.678» y «b12345678» son el mismo.';

-- ── 1 · party ───────────────────────────────────────────────────────────────
create table if not exists public.party (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  tax_id          text check (tax_id is null or tax_id = public.party_nif(tax_id)),
  archived_at     timestamptz,
  archived_note   text,
  source          text not null default 'manual' check (source in ('manual', 'supplier', 'migrated', 'ticket')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid,
  created_by_name text
);
comment on table public.party is
  'C03. El tercero: una ficha por alguien, con los papeles que tenga (party_role). El nombre de un tercero con papel de proveedor es el de su supplier (lo mantiene el disparador).';
comment on column public.party.tax_id is 'C03. NIF normalizado (party_nif). Único por cuenta: un NIF, un tercero.';
comment on column public.party.archived_note is 'C03. Lo que enseña la franja de archivado: «histórico de 2024».';
create unique index if not exists ux_party_nif on public.party (account_id, tax_id) where tax_id is not null;
create index if not exists idx_party_account on public.party (account_id);

drop trigger if exists trg_party_updated_at on public.party;
create trigger trg_party_updated_at before update on public.party for each row execute function set_updated_at();

-- ── 2 · party_role ──────────────────────────────────────────────────────────
create table if not exists public.party_role (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.accounts(id) on delete cascade,
  party_id           uuid not null references public.party(id) on delete cascade,
  role               text not null check (role in ('supplier', 'customer', 'platform', 'brand_partner')),
  -- proveedor: su ficha de Cocina
  supplier_id        uuid unique references public.supplier(id) on delete cascade,
  -- plataforma: su canal de venta, cada cuánto liquida y la comisión pactada
  channel_id         uuid references public.sales_channel(id),
  settlement_every   text check (settlement_every is null or settlement_every in ('weekly', 'fortnightly', 'monthly')),
  commission_pct     numeric(5, 2) check (commission_pct is null or commission_pct between 0 and 100),
  -- socio de marca: qué aportaciones admite (la comisión y la base van en su acuerdo por marca)
  contribution_kinds text[] check (contribution_kinds is null or contribution_kinds <@ array['marketing', 'packaging', 'other']),
  created_at         timestamptz not null default now(),
  created_by         uuid,
  unique (party_id, role),
  constraint party_role_proveedor_con_ficha check ((role = 'supplier') = (supplier_id is not null)),
  constraint party_role_canal_solo_plataforma check (role = 'platform' or (channel_id is null and settlement_every is null and commission_pct is null)),
  constraint party_role_aportaciones_solo_socio check (role = 'brand_partner' or contribution_kinds is null)
);
comment on table public.party_role is
  'C03. Los papeles de un tercero: supplier (su ficha de Cocina en supplier_id), customer (sus datos en customer_fiscal), platform (canal, periodo, % pactado) y brand_partner (aportaciones admitidas; marcas y % en brand_licensing_agreement).';
create index if not exists idx_party_role_party on public.party_role (party_id);
create index if not exists idx_party_role_account on public.party_role (account_id, role);
-- Una plataforma por canal de venta.
create unique index if not exists ux_party_role_canal on public.party_role (account_id, channel_id) where channel_id is not null;

-- ── 3 · customer_fiscal: lo fiscal y el cobro del papel de cliente ──────────
-- Los mismos campos y reglas que el proveedor del C01/C01b.
create table if not exists public.customer_fiscal (
  party_id                uuid primary key references public.party(id) on delete cascade,
  account_id              uuid not null references public.accounts(id) on delete cascade,
  legal_name              text,
  tax_id_type             text check (tax_id_type is null or tax_id_type in ('nif_es', 'vat_eu', 'foreign')),
  country_code            text not null default 'ES' check (country_code ~ '^[A-Z]{2}$'),
  entity_kind             text check (entity_kind is null or entity_kind in ('company', 'self_employed', 'person')),
  tax_id_check_status     text check (tax_id_check_status is null or tax_id_check_status in ('valid', 'invalid', 'pending')),
  tax_id_checked_at       timestamptz,
  tax_id_verified_at      timestamptz,
  fiscal_street           text,
  fiscal_postal_code      text,
  fiscal_city             text,
  fiscal_province         text,
  equivalence_surcharge   boolean not null default false,
  withholding_rate_id     uuid references public.withholding_rate(id),
  operation_scope         text not null default 'domestic' check (operation_scope in ('domestic', 'eu', 'export')),
  exclude_347             boolean not null default false,
  exclude_347_reason      text,
  payment_method          text check (payment_method is null or payment_method in ('transfer', 'direct_debit', 'card', 'cash')),
  payment_terms_days      integer check (payment_terms_days is null or payment_terms_days between 0 and 365),
  payment_fixed_days      integer[],
  collection_treasury_id  uuid references public.treasury_account(id) on delete set null,
  iban                    text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  sepa_mandate_ref        text,
  sepa_mandate_date       date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint customer_fiscal_motivo_347 check (not exclude_347 or length(trim(coalesce(exclude_347_reason, ''))) > 0)
);
comment on table public.customer_fiscal is
  'C03. Datos fiscales y de cobro del papel de cliente (los del proveedor del C01b): NIF con VIES, razón social, dirección, recargo, retención que te practican, tipo de operación, 347 y cobro. El NIF vive en party.tax_id.';
comment on column public.customer_fiscal.payment_terms_days is 'C03. Plazo de cobro. Más de 60 días se guarda, pero la ficha avisa (Ley 3/2004).';
comment on column public.customer_fiscal.collection_treasury_id is 'C03. La cuenta de la empresa donde cobra (572).';
create index if not exists idx_customer_fiscal_account on public.customer_fiscal (account_id);
drop trigger if exists trg_customer_fiscal_updated_at on public.customer_fiscal;
create trigger trg_customer_fiscal_updated_at before update on public.customer_fiscal for each row execute function set_updated_at();

-- ── 4 · Todo de la misma cuenta (RLS mira account_id) ───────────────────────
create or replace function public.party_misma_cuenta()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from party p where p.id = new.party_id and p.account_id = new.account_id) then
    raise exception 'El papel y su tercero tienen que ser de la misma cuenta.' using errcode = '23514';
  end if;
  if tg_table_name = 'party_role' then
    if new.supplier_id is not null and not exists (select 1 from supplier s where s.id = new.supplier_id and s.account_id = new.account_id) then
      raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '23514';
    end if;
    if new.channel_id is not null and not exists (select 1 from sales_channel c where c.id = new.channel_id and c.account_id = new.account_id) then
      raise exception 'Ese canal de venta no es de esta cuenta.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.party_misma_cuenta() from public, anon, authenticated;
drop trigger if exists trg_party_role_misma_cuenta on public.party_role;
create trigger trg_party_role_misma_cuenta before insert or update on public.party_role
  for each row execute function public.party_misma_cuenta();
drop trigger if exists trg_customer_fiscal_misma_cuenta on public.customer_fiscal;
create trigger trg_customer_fiscal_misma_cuenta before insert or update on public.customer_fiscal
  for each row execute function public.party_misma_cuenta();

-- ── 5 · El proveedor de Cocina, siempre con su tercero ──────────────────────
-- Alta: se cuelga del tercero con su NIF si ya existe (un NIF, un tercero); si
-- no, se crea. Nunca falla: el alta de un proveedor está en el camino del
-- albarán. Cambio de nombre, NIF o archivado: el tercero lo sigue si solo es
-- proveedor; si tiene más papeles, el nombre y el archivado son del tercero.
create or replace function public.party_desde_proveedor()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_party uuid; v_nif text := public.party_nif(new.tax_id); v_solo boolean;
begin
  if tg_op = 'INSERT' then
    if v_nif is not null then
      select id into v_party from party where account_id = new.account_id and tax_id = v_nif;
      -- Dos proveedores con el mismo NIF (lo permite Cocina): el segundo no
      -- puede ser el mismo papel del mismo tercero. Tercero aparte, sin NIF,
      -- y el agente lo enseña como NIF repetido.
      if v_party is not null and exists (select 1 from party_role where party_id = v_party and role = 'supplier') then
        v_party := null; v_nif := null;
      end if;
    end if;
    if v_party is null then
      insert into party (account_id, name, tax_id, archived_at, source, created_by, created_by_name)
      values (new.account_id, new.name, v_nif, new.archived_at, 'supplier', new.created_by, new.created_by_name)
      returning id into v_party;
    end if;
    insert into party_role (account_id, party_id, role, supplier_id, created_by)
    values (new.account_id, v_party, 'supplier', new.id, new.created_by)
    on conflict (party_id, role) do nothing;
    return new;
  end if;
  select r.party_id, (select count(*) from party_role x where x.party_id = r.party_id) = 1
    into v_party, v_solo
    from party_role r where r.supplier_id = new.id;
  if v_party is null then return new; end if;
  if v_solo then
    update party set name = new.name, archived_at = new.archived_at where id = v_party
       and (name, archived_at) is distinct from (new.name, new.archived_at);
  end if;
  -- El NIF: solo si no choca con otro tercero (si choca, lo ve el agente).
  if v_nif is distinct from public.party_nif(old.tax_id)
     and not exists (select 1 from party where account_id = new.account_id and tax_id = v_nif and id <> v_party) then
    update party set tax_id = v_nif where id = v_party;
  end if;
  return new;
exception when others then
  -- El albarán no se para por el tercero: queda sin enlazar y el agente lo dice.
  raise warning 'C03 · el proveedor % no se ha podido enlazar con su tercero: %', new.id, sqlerrm;
  return new;
end $$;
revoke all on function public.party_desde_proveedor() from public, anon, authenticated;
drop trigger if exists trg_party_desde_proveedor on public.supplier;
create trigger trg_party_desde_proveedor after insert or update of name, tax_id, archived_at on public.supplier
  for each row execute function public.party_desde_proveedor();

-- ── 6 · RLS ─────────────────────────────────────────────────────────────────
alter table public.party enable row level security;
alter table public.party_role enable row level security;
alter table public.customer_fiscal enable row level security;
do $$
declare t text;
begin
  foreach t in array array['party', 'party_role', 'customer_fiscal'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select using (belongs_to_account(account_id))', t);
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (current_user_is_admin_or_manager_of(account_id))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (current_user_is_admin_or_manager_of(account_id))', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_delete on public.%1$s for delete using (current_user_is_admin_or_manager_of(account_id))', t);
    execute format('revoke all on table public.%1$s from anon', t);
  end loop;
end $$;

-- ── 7 · Las cuentas de un cliente: entity = 'customer', entity_id = el tercero
-- company_account_misma_cuenta, copia LITERAL de la vigente (20261007T0160)
-- con una guarda más: un cliente de OTRA cuenta no se enlaza (regla 9).
create or replace function public.company_account_misma_cuenta() returns trigger
language plpgsql set search_path = public as $$
declare v_plantilla text;
begin
  if not exists (select 1 from public.company c where c.id = new.company_id and c.account_id = new.account_id) then
    raise exception 'La empresa no es de esa cuenta.' using errcode = '23514';
  end if;
  if tg_table_name = 'company_account_link' then
    if not exists (select 1 from public.company_account a where a.id = new.company_account_id and a.company_id = new.company_id) then
      raise exception 'Esa cuenta no es de esta empresa.' using errcode = '23514';
    end if;
    -- Un proveedor de OTRA cuenta no se enlaza aquí (regla 9).
    if new.entity = 'supplier' and not exists (select 1 from public.supplier s where s.id::text = new.entity_id and s.account_id = new.account_id) then
      raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '23514';
    end if;
    -- C03: un cliente es un tercero de esta cuenta.
    if new.entity = 'customer' and not exists (select 1 from public.party p where p.id::text = new.entity_id and p.account_id = new.account_id) then
      raise exception 'Ese cliente no es de esta cuenta.' using errcode = '23514';
    end if;
    -- Un tercero, una subcuenta; salvo la común (encargo §3). Solo el papel principal.
    if new.role = 'principal' and new.entity in ('supplier', 'customer', 'bank_account')
       and not (select is_common from public.company_account where id = new.company_account_id)
       and exists (select 1 from public.company_account_link l
                    where l.company_account_id = new.company_account_id and l.id <> new.id and l.role = 'principal'
                      and l.entity in ('supplier', 'customer', 'bank_account')
                      and (l.entity, l.entity_id) is distinct from (new.entity, new.entity_id)) then
      raise exception 'Esa subcuenta ya es de otro tercero, y no es la cuenta común.' using errcode = '23505';
    end if;
    -- Cada papel nuevo, a su grupo: gastos y suplidos al 6; el pago a un banco o caja (57) o a lo que te debe (43).
    select template_code into v_plantilla from public.company_account where id = new.company_account_id;
    if new.role in ('gasto', 'suplidos') and v_plantilla not like '6%' then
      raise exception 'Sus facturas y sus suplidos van a una cuenta de gastos (grupo 6); % no lo es.', v_plantilla using errcode = '23514';
    end if;
    if new.role = 'pago' and v_plantilla not like '57%' and v_plantilla not like '43%' then
      raise exception 'Se le paga desde un banco o caja (57) o compensando con lo que te debe (43); % no lo es.', v_plantilla using errcode = '23514';
    end if;
    -- No se enlaza a una cuenta oculta ni cerrada.
    if (select status from public.company_account where id = new.company_account_id) <> 'activa' then
      raise exception 'Esa cuenta está oculta o cerrada: no se le puede enlazar nada.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
