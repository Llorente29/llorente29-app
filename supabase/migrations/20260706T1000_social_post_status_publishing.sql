-- 20260706T1000_social_post_status_publishing.sql
-- Tramo 0 · Migración A — RRSS
--
-- Añade 'publishing' al CHECK de social_post.status.
-- Motivo: el brazo social-publish hace un claim optimista approved -> 'publishing'
-- antes de llamar a la Graph API. 'publishing' NO estaba en el CHECK, así que ese
-- UPDATE fallaba y el claim devolvía vacío -> TODO post 'approved' de Instagram se
-- saltaba para siempre, SIN error visible (la publicación quedaba muerta en silencio).
-- Riesgo 0: ninguna fila actual tiene 'publishing'.

begin;

alter table public.social_post
  drop constraint if exists social_post_status_check;

alter table public.social_post
  add constraint social_post_status_check
  check (status = any (array[
    'draft','approved','scheduled','publishing','published','discarded','error'
  ]));

commit;
