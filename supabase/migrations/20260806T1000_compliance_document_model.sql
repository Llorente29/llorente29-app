-- 20260806T1000_compliance_document_model.sql
-- Aplicada: 2026-08-06 por MCP (apply_migration). Verificada objeto a objeto.
-- Archivo documental de cumplimiento — T1 (cimiento): modelo base de las 9 familias
-- documentales + puente al dato (compliance_document_link) + respaldo del alérgeno
-- (recipe_item_allergen.source_document_id) + bucket privado. Diseño:
-- claude_folvy_archivo_documental_diseno.md. RLS calcada de recipe_item_allergen
-- (leer = miembro; escribir = admin/manager). Las políticas de storage.objects del
-- bucket van en T2 (con la subida).

create table public.compliance_document (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  location_id   uuid null references locations(id) on delete set null,   -- null = vale para toda la cuenta
  doc_family    text not null check (doc_family in (
                  'food_spec','chemical_spec','chemical_sds','pest_contract','pest_spec',
                  'water_analysis','oil_manager','supplier_approval','other')),
  title         text not null,
  supplier_id   uuid null references supplier(id) on delete set null,
  reference     text null,                    -- ref del fabricante (p.ej. "63483 v008")
  issued_at     date null,
  expires_at    date null,                    -- caducidad dura (contratos, análisis)
  review_due_at date null,                    -- revisión anual (fichas de alimento)
  file_path     text not null,                -- Storage: {account_id}/{doc_family}/{uuid}.pdf
  file_size_kb  integer null,
  mime_type     text null,
  status        text not null default 'pending_review' check (status in (
                  'pending_ocr','pending_review','active','superseded','expired')),
  supersedes_id uuid null references compliance_document(id) on delete set null,  -- versión anterior (nunca se borra)
  extracted     jsonb null,                   -- lo que leyó la IA, en crudo
  notes         text null,
  last_reminder_at timestamptz null,          -- para el cron (T5): no re-avisar en el mismo ciclo
  uploaded_by   uuid null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.compliance_document_link (
  document_id uuid not null references compliance_document(id) on delete cascade,
  entity_type text not null check (entity_type in ('recipe_item','supplier','location','account')),
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (document_id, entity_type, entity_id)
);

-- La columna que cierra el círculo: cada alérgeno declarado puede señalar su PDF.
alter table public.recipe_item_allergen
  add column source_document_id uuid null references compliance_document(id) on delete set null;

create index idx_compliance_document_account  on public.compliance_document(account_id);
create index idx_compliance_document_location on public.compliance_document(location_id);
create index idx_compliance_document_family   on public.compliance_document(account_id, doc_family);
create index idx_compliance_document_supplier on public.compliance_document(supplier_id);
create index idx_cdl_entity                    on public.compliance_document_link(entity_type, entity_id);

-- RLS: leer = miembro de la cuenta; escribir = admin/manager (decisión de Julio).
alter table public.compliance_document       enable row level security;
alter table public.compliance_document_link  enable row level security;

create policy compliance_document_select on public.compliance_document
  for select using (belongs_to_account(account_id));
create policy compliance_document_insert on public.compliance_document
  for insert with check (current_user_is_admin_or_manager_of(account_id));
create policy compliance_document_update on public.compliance_document
  for update using (current_user_is_admin_or_manager_of(account_id));
create policy compliance_document_delete on public.compliance_document
  for delete using (current_user_is_admin_or_manager_of(account_id));

create policy cdl_select on public.compliance_document_link
  for select using (belongs_to_account((select d.account_id from public.compliance_document d where d.id = document_id)));
create policy cdl_insert on public.compliance_document_link
  for insert with check (current_user_is_admin_or_manager_of((select d.account_id from public.compliance_document d where d.id = document_id)));
create policy cdl_delete on public.compliance_document_link
  for delete using (current_user_is_admin_or_manager_of((select d.account_id from public.compliance_document d where d.id = document_id)));

-- Bucket privado (sus políticas de storage.objects van en T2, con la subida).
insert into storage.buckets (id, name, public) values ('compliance-docs','compliance-docs', false)
  on conflict (id) do nothing;

-- Guard: aborta si algo no quedó.
do $$ begin
  if to_regclass('public.compliance_document') is null
     or to_regclass('public.compliance_document_link') is null
     or not exists (select 1 from information_schema.columns
        where table_name='recipe_item_allergen' and column_name='source_document_id')
  then raise exception 'compliance_document_model: falta un objeto'; end if;
end $$;
