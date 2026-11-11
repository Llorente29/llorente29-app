-- scripts/video/albaran-casado.sql — V02 · después de sembrar, cómo casa cada línea del albarán (solo lectura).
--
--   psql "$DB_URL" -X -v cuenta=<uuid> -f scripts/video/albaran-casado.sql
--
\pset pager off
-- Cómo casa cada línea del albarán (la misma función que usa el asistente).
\echo '== cómo casa cada línea'
select t.codigo, t.texto, m.name, m.match_type, m.semaphore, round(m.confidence::numeric, 2) as conf
  from (values ('TOM-10', 'Tomate pera, caja 10 kg'), ('LEC-12', 'Lechuga romana, caja 12 ud'),
               ('PAT-25', 'Patata agria, saco 25 kg'), ('ACE-05', 'Aceite de oliva virgen extra, garrafa 5 l')) as t(codigo, texto)
  left join lateral (select * from public.run_mapping(p_account_id := :'cuenta'::uuid, p_text := t.texto, p_code := t.codigo, p_limit := 1, p_target_types := array['raw', 'packaging'])) m on true;
