-- 20260630T2200_recipe_step_video.sql
--
-- Vídeo por paso (última pieza del frente de comodidad de Kitchen, 30/06).
-- recipe_item_step ya tenía photo_url; falta el vídeo. UNA columna; nada más.
--
-- El archivo se sube al bucket EXISTENTE recipe-uploads (privado, sin límite de
-- MIME/tamaño, RLS por carpeta-de-cuenta), igual que el resto de adjuntos de
-- receta → NO se crea bucket ni política nueva. video_url guarda:
--   · una RUTA de storage (recipe-uploads/{accountId}/step-video/...) si se sube
--     un archivo (se reproduce con signed URL), o
--   · una URL externa (https://… YouTube/Vimeo) si se pega un enlace.
-- El front distingue por el prefijo http(s).
--
-- Idempotente. DDL puro; sin BEGIN/COMMIT, sin SELECT de prueba.

ALTER TABLE public.recipe_item_step
  ADD COLUMN IF NOT EXISTS video_url text;

COMMENT ON COLUMN public.recipe_item_step.video_url IS
  'Vídeo del paso: ruta en recipe-uploads (archivo subido) o URL externa (enlace). NULL = sin vídeo.';
