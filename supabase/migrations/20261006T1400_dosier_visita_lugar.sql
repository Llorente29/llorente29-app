-- Dosier: lugar de la visita. La ciudad la resuelve Vercel al servir la pagina y la
-- pagina la manda ya resuelta; la IP sigue sin guardarse.
-- Sin politicas nuevas: la tabla sigue con RLS y cero politicas.

alter table public.dosier_visita
  add column if not exists ciudad text,
  add column if not exists pais   text,
  add column if not exists red    text;
