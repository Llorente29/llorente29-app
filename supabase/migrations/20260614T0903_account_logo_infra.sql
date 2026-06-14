-- Aplicada: 2026-06-14 (vía SQL Editor; versionada a posteriori para cerrar drift)
-- Infra del LOGO de cuenta (autoservicio): columna en accounts + bucket público
-- account-logos + RLS calcada de menu-photos (SELECT belongs_to_account;
-- INSERT/UPDATE/DELETE current_user_is_admin_or_manager_of sobre el accountId =
-- primera carpeta del path). Idempotente.

-- 1) Columna de logo en accounts.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS logo_url text;

-- 2) Bucket público de logos (2 MB, png/jpeg/webp).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('account-logos','account-logos', true, 2097152,
        ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 3) Políticas RLS sobre storage.objects (calcadas de menu-photos).
DROP POLICY IF EXISTS account_logos_select ON storage.objects;
DROP POLICY IF EXISTS account_logos_insert ON storage.objects;
DROP POLICY IF EXISTS account_logos_update ON storage.objects;
DROP POLICY IF EXISTS account_logos_delete ON storage.objects;

CREATE POLICY account_logos_select ON storage.objects FOR SELECT
  USING (bucket_id = 'account-logos'
         AND belongs_to_account(((storage.foldername(name))[1])::uuid));

CREATE POLICY account_logos_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'account-logos'
             AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid));

CREATE POLICY account_logos_update ON storage.objects FOR UPDATE
  USING (bucket_id = 'account-logos'
         AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid));

CREATE POLICY account_logos_delete ON storage.objects FOR DELETE
  USING (bucket_id = 'account-logos'
         AND current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid));
