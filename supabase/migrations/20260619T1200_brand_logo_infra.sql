-- supabase/migrations/20260619T1200_brand_logo_infra.sql
-- ============================================================================
-- D1 · LOGO POR MARCA (impresión: el ticket de bolsa lleva el logo de la marca).
-- ============================================================================
-- La columna brand.logo_url YA EXISTE (baseline). Falta lo que la rellena:
-- bucket + RLS. Calcado de account-logos (20260614T0903), con UNA diferencia de
-- diseño: el path lleva accountId PRIMERO ({accountId}/{brandId}/logo-{ts}.png),
-- para reusar las funciones RLS existentes (belongs_to_account /
-- current_user_is_admin_or_manager_of sobre la 1ª carpeta = accountId) sin
-- inventar un belongs_to_brand.
--
-- El logo es de la MARCA, no de la cuenta: una marca virtual (Mila's) tiene su
-- logo propio, distinto del de la empresa fiscal (Llorente29 Food = accounts.logo_url).
--
-- Idempotente. Sin BEGIN/COMMIT. No toca la tabla brand (la columna ya está).
-- ============================================================================

-- Bucket público (2 MB, png/jpeg/webp), igual que account-logos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-logos', 'brand-logos', true, 2097152,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS sobre storage.objects: 4 políticas calcadas de account-logos.
-- El id de cuenta se resuelve por la PRIMERA carpeta del path.
drop policy if exists brand_logos_select on storage.objects;
create policy brand_logos_select on storage.objects for select
  using (
    bucket_id = 'brand-logos'
    and belongs_to_account(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists brand_logos_insert on storage.objects;
create policy brand_logos_insert on storage.objects for insert
  with check (
    bucket_id = 'brand-logos'
    and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists brand_logos_update on storage.objects;
create policy brand_logos_update on storage.objects for update
  using (
    bucket_id = 'brand-logos'
    and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists brand_logos_delete on storage.objects;
create policy brand_logos_delete on storage.objects for delete
  using (
    bucket_id = 'brand-logos'
    and current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid)
  );
