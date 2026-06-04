-- ============================================================================
-- Folvy Supply C2.2.a-1 — OCR de albarán: Storage + sesión IA
-- ============================================================================
-- Crea:
--   1) Bucket privado receipt-uploads (jpeg/png/webp/PDF, 10 MB) + 4 políticas
--      RLS CLONADAS de recipe-uploads (insert/update/delete: admin/manager de la
--      cuenta; select: pertenece a la cuenta). Carpeta = {account_id}/...
--   2) Tabla goods_receipt_ai_session (gemela de recipe_item_ai_session, atada a
--      goods_receipt). Guarda lo que leyó la IA + validación por base imponible.
--
-- DDL sin BEGIN/COMMIT (regla del SQL Editor). No ejecuta funciones SECURITY
-- DEFINER (solo las referencia en políticas), así que no hay problema de auth.uid().
-- Idempotente (if not exists / on conflict / drop policy if exists).
-- ============================================================================

-- ── 1) Bucket privado para albaranes (acepta PDF además de foto) ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-uploads', 'receipt-uploads', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Políticas RLS clonadas de recipe-uploads (mismo modelo de acceso por cuenta).
drop policy if exists receipt_uploads_select on storage.objects;
create policy receipt_uploads_select on storage.objects
  for select
  using (
    bucket_id = 'receipt-uploads'
    and belongs_to_account(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipt_uploads_insert on storage.objects;
create policy receipt_uploads_insert on storage.objects
  for insert
  with check (
    bucket_id = 'receipt-uploads'
    and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipt_uploads_update on storage.objects;
create policy receipt_uploads_update on storage.objects
  for update
  using (
    bucket_id = 'receipt-uploads'
    and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists receipt_uploads_delete on storage.objects;
create policy receipt_uploads_delete on storage.objects
  for delete
  using (
    bucket_id = 'receipt-uploads'
    and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
  );

-- ── 2) Sesión IA de la recepción (lo que leyó la IA + validación) ──
create table if not exists public.goods_receipt_ai_session (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null,
  -- Se rellena en a-2 cuando se materializa el borrador; en a-1 es null.
  goods_receipt_id uuid references public.goods_receipt(id) on delete set null,
  kind             text not null default 'photo',          -- photo | pdf
  input_files      jsonb,                                  -- [{path, bucket}]
  raw_response     jsonb,                                  -- respuesta cruda del modelo
  parsed_result    jsonb,                                  -- {document, lines, confidence}
  validation       jsonb,                                  -- {base_declared, lines_sum, diff_pct, cuadra, needs_review, reasons[]}
  ai_model         text,
  ai_cost_eur      numeric,
  ai_latency_ms    integer,
  status           text not null default 'pending_review', -- pending_review | confirmed | discarded
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_gr_ai_session_account on public.goods_receipt_ai_session(account_id);
create index if not exists idx_gr_ai_session_receipt on public.goods_receipt_ai_session(goods_receipt_id);

alter table public.goods_receipt_ai_session enable row level security;

drop policy if exists gr_ai_session_select on public.goods_receipt_ai_session;
create policy gr_ai_session_select on public.goods_receipt_ai_session
  for select using (belongs_to_account(account_id));

drop policy if exists gr_ai_session_insert on public.goods_receipt_ai_session;
create policy gr_ai_session_insert on public.goods_receipt_ai_session
  for insert with check (belongs_to_account(account_id));

drop policy if exists gr_ai_session_update on public.goods_receipt_ai_session;
create policy gr_ai_session_update on public.goods_receipt_ai_session
  for update using (belongs_to_account(account_id));
