-- tests/unit/modules/multitenancy/f01/esquema.sql
--
-- F01 · El esquema mínimo para probar las marcas de Last contra un Postgres de
-- verdad: solo las tablas y columnas que tocan las funciones de la 1320, y lo
-- que llaman (permisos, reprocess_sale) de mentira. Lo carga f01MarcasLast.test.ts.

-- unaccent viene con postgresql-contrib; si no está, una versión mínima basta.
do $o$ begin
  create extension if not exists unaccent;
exception when others then
  execute $f$create function public.unaccent(text) returns text language sql immutable as $b$ select translate($1, 'áéíóúàèìòùÁÉÍÓÚÀÈÌÒÙñÑüÜ', 'aeiouaeiouAEIOUAEIOUnNuU') $b$ $f$;
end $o$;
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role authenticated; create role anon; create role service_role; exception when duplicate_object then null; end $$;

create table accounts (id uuid primary key, name text);
create table locations (id uuid primary key, account_id uuid, name text, active boolean default true);
create table kitchen_unit (id uuid primary key, account_id uuid, name text, dimension text, is_base boolean, is_seed boolean, is_active boolean, created_at timestamptz default now());
create table sales_channel (id uuid primary key default gen_random_uuid(), account_id uuid, name text, slug text, is_active boolean default true);
create table brand (id uuid primary key default gen_random_uuid(), account_id uuid not null, name text not null, slug text not null,
  ownership_type text not null default 'own', is_active boolean not null default true, archived_at timestamptz, catalog_source text not null default 'folvy',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid, created_by_name text, unique (account_id, slug));
create table brand_licensing_agreement (id uuid primary key default gen_random_uuid(), account_id uuid not null, brand_id uuid not null unique, owner_name text not null, notes text,
  revenue_share_pct numeric not null check (revenue_share_pct between 0 and 100), reimburses_consumption boolean not null default true, is_active boolean not null default true,
  archived_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, created_by_name text, party_id uuid);
create table brand_location_availability (id uuid primary key default gen_random_uuid(), account_id uuid, brand_id uuid, location_id uuid, is_active boolean, active_since date, notes text,
  unique (account_id, brand_id, location_id));
create table brand_channel (id uuid primary key default gen_random_uuid(), account_id uuid, brand_id uuid, channel_id uuid, is_active boolean, created_by_name text, unique (brand_id, channel_id));
create table external_integration (id uuid primary key default gen_random_uuid(), account_id uuid, source text, external_org_id uuid, organization_name text, ownership_type text, is_active boolean);
create table external_location_map (id uuid primary key default gen_random_uuid(), account_id uuid, source text, external_location_id text, location_id uuid, is_active boolean);
create table external_brand_map (id uuid primary key default gen_random_uuid(), account_id uuid, source text, external_location_id text, external_brand_id text, brand_id uuid,
  is_ignored boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (account_id, source, external_location_id, external_brand_id));
create table external_catalog_product (id uuid primary key default gen_random_uuid(), account_id uuid not null, source text not null default 'lastapp', external_org_id uuid not null,
  catalog_product_id uuid not null default gen_random_uuid(), organization_product_id uuid, external_brand_name text, product_name text, price_cents integer, product_type text default 'PRODUCT',
  seen_in_catalog_at timestamptz default now(), external_channel text, external_channels text[], external_location_id uuid, missing_since timestamptz,
  is_enabled boolean default true);
create table recipe_item (id uuid primary key default gen_random_uuid(), account_id uuid, type text, name text, base_unit_id uuid, is_active boolean default true,
  archived_at timestamptz, source text, needs_review boolean default false, created_by_name text);
create table recipe_line (id uuid primary key default gen_random_uuid(), parent_item_id uuid, child_item_id uuid);
create table menu_item (id uuid primary key default gen_random_uuid(), account_id uuid, brand_id uuid not null, channel_id uuid, recipe_item_id uuid, name text not null,
  price numeric not null default 0, product_type text default 'item', external_id text, external_source text, source text, needs_review boolean, archived_at timestamptz,
  updated_at timestamptz default now(), created_by_name text);
create unique index uq_menu_item_external on menu_item (account_id, external_source, external_id, brand_id) where external_id is not null;
create table menu_item_override (id uuid primary key default gen_random_uuid(), account_id uuid, menu_item_id uuid, location_id uuid, channel_id uuid, price numeric);
create unique index uq_menu_item_override_scope on menu_item_override (menu_item_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table inventory_count (id uuid primary key default gen_random_uuid(), account_id uuid, status text, closed_at timestamptz);
create table sale (id uuid primary key default gen_random_uuid(), account_id uuid, location_id uuid, brand_id uuid, source text, sold_at timestamptz, raw_products jsonb,
  raw_tab text, external_brand_text text);
create table sale_line (id uuid primary key default gen_random_uuid(), account_id uuid, sale_id uuid, menu_item_id uuid, unmapped_reason text, external_product_id text,
  external_source text default 'lastapp');
create table user_profiles (user_id uuid, account_id uuid, display_name text);
create table funcion_respaldo (firma text, migracion text, definicion text, huella text, primary key (firma, migracion));

create or replace function public.safe_jsonb(t text) returns jsonb language sql immutable as $$ select t::jsonb $$;
create or replace function public.current_user_is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('prueba.admin', true), '') = 'si' $$;
create or replace function public.current_user_is_admin_of(uuid) returns boolean language sql stable as $$ select coalesce(current_setting('prueba.admin_de', true), '') = $1::text $$;
create or replace function public.current_user_is_admin_or_manager_of(uuid) returns boolean language sql stable as $$ select public.current_user_is_admin_of($1) $$;
create or replace function public.current_user_account_ids() returns uuid[] language sql stable as $$ select array[]::uuid[] $$;
create or replace function public.belongs_to_account(uuid) returns boolean language sql stable as $$ select true $$;
-- reprocess_sale de mentira: coloca cada línea con el menu_item de su matrícula (y la marca de la venta si hay varios).
create or replace function public.reprocess_sale(p uuid) returns void language plpgsql as $$
declare s sale; l record; n int; m uuid;
begin
  select * into s from sale where id = p;
  if s.brand_id is null and s.external_brand_text is not null then
    select brand_id into s.brand_id from external_brand_map where account_id = s.account_id and external_brand_id = s.external_brand_text and not is_ignored limit 1;
    update sale set brand_id = s.brand_id where id = p;
  end if;
  for l in select * from sale_line where sale_id = p loop
    select count(*), min(id::text)::uuid into n, m from menu_item where account_id = s.account_id and external_id = l.external_product_id and archived_at is null;
    if n > 1 then select id into m from menu_item where account_id = s.account_id and external_id = l.external_product_id and archived_at is null and brand_id = s.brand_id; end if;
    if n = 0 then m := null; end if;
    update sale_line set menu_item_id = m, unmapped_reason = case when m is null then 'no_menu_item' end where id = l.id;
  end loop;
end $$;
create or replace function public.seed_catalog_canonical(p_account_id uuid, p_dry_run boolean, p_margen_foto interval default '1 day'::interval)
returns table(dry_run boolean, matriculas_miradas integer, base_ya_existentes integer, productos_base_creados integer, overrides_creados integer,
              overrides_de_foto_vieja integer, productos_sin_revisar_precios integer, saltados_sin_marca integer,
              saltados_por_integracion_no_cedida integer, saltados_por_ser_propia integer, saltados_por_no_estar_en_la_foto integer,
              marcas_sin_resolver text[], marcas_de_integracion_no_cedida text[], marcas_propias_saltadas text[], no_en_la_foto jsonb, fotos jsonb)
language plpgsql as $$ begin return; end $$;
create or replace function public.ticket_invoice_ajustes(p_account uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create or replace function public._respaldar_funcion(p_firma text, p_migracion text) returns text language plpgsql as $$
begin insert into funcion_respaldo values (p_firma, p_migracion, pg_get_functiondef(to_regprocedure(p_firma)), 'x') on conflict do nothing; return 'x'; end $$;
create table company (id uuid primary key default gen_random_uuid(), account_id uuid, legal_name text, trade_name text);
