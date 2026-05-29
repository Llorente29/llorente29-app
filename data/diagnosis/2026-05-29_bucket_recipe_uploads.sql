-- ════════════════════════════════════════════════════════════════════
-- 2026-05-29 — Bucket privado recipe-uploads + políticas por cuenta
-- ════════════════════════════════════════════════════════════════════
-- Almacena fotos/PDFs de fichas de receta que el cocinero sube para que
-- Opus visión las extraiga. Son SECRETO DE NEGOCIO → bucket privado con
-- aislamiento REAL por cuenta (NO el patrón permisivo de appcc-photos).
--
-- Convención de ruta: recipe-uploads/{account_id}/{archivo}
-- El primer segmento de la ruta = account_id. Las políticas exigen que
-- ese account_id sea una cuenta del usuario (belongs_to_account / admin_or_manager).
-- storage.foldername(name)[1] = primer segmento de la ruta.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) Bucket privado (public = false)
INSERT INTO storage.buckets (id, name, public)
VALUES ('recipe-uploads', 'recipe-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- 2) Políticas con aislamiento por cuenta (primer segmento de la ruta = account_id)

-- LECTURA: miembros de la cuenta
CREATE POLICY recipe_uploads_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'recipe-uploads'
    AND belongs_to_account((storage.foldername(name))[1]::uuid)
  );

-- SUBIDA: admin/manager de la cuenta
CREATE POLICY recipe_uploads_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recipe-uploads'
    AND current_user_is_admin_or_manager_of((storage.foldername(name))[1]::uuid)
  );

-- ACTUALIZACIÓN: admin/manager de la cuenta
CREATE POLICY recipe_uploads_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'recipe-uploads'
    AND current_user_is_admin_or_manager_of((storage.foldername(name))[1]::uuid)
  );

-- BORRADO: admin/manager de la cuenta
CREATE POLICY recipe_uploads_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'recipe-uploads'
    AND current_user_is_admin_or_manager_of((storage.foldername(name))[1]::uuid)
  );

COMMIT;
