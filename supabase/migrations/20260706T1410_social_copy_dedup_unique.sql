-- 20260706T1410_social_copy_dedup_unique.sql
-- Tramo 4 · Fix — RRSS voz viva
--
-- El bloque de la pieza 1 se ejecutó dos veces en el SQL Editor y el INSERT del seed no era
-- idempotente -> frases duplicadas (10 de apetito en vez de 5). Esta migración:
--   1) deduplica conservando la fila con más times_used (determinista, riesgo 0).
--   2) añade índice único para que re-sembrar nunca más duplique (NULL cuenta = global).
-- No se edita la migración de la pieza 1 (ya aplicada); el fix va en migración nueva.

begin;

delete from public.social_copy a
using public.social_copy b
where a.pillar = b.pillar
  and a.text   = b.text
  and a.account_id is not distinct from b.account_id
  and ( a.times_used < b.times_used
     or (a.times_used = b.times_used and a.id > b.id) );

create unique index if not exists social_copy_uniq
  on public.social_copy (coalesce(account_id,'00000000-0000-0000-0000-000000000000'::uuid), pillar, text);

commit;
