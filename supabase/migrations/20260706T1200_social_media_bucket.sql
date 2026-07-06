-- 20260706T1200_social_media_bucket.sql
-- Tramo 1 · Op 1 — RRSS fábrica de imágenes N1
--
-- Bucket PÚBLICO para las imágenes compuestas de RRSS. Debe ser público porque Meta
-- (Instagram Graph API) descarga la imagen por URL al crear el contenedor de medios.
-- Es contenido de marketing (no sensible). Solo escribe el Edge social-image-sink con
-- service_role (salta RLS), así que no se necesitan policies de escritura.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', true, 10485760,
        array['image/jpeg','image/png'])
on conflict (id) do nothing;

commit;
