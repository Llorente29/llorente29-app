-- supabase/staging/sql/20261029_w10a_cierre_prueba.sql
--
-- SOLO STAGING. Prueba de la 1053 (W10a, cierre), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia.
--
--   1 · con la 1630 aplicada (trg_sale_push_status 385240cb): la 1053 borra
--       el respaldo de la 1630 y solo ese; la función viva no cambia; ningún
--       respaldo con un secreto fv_ queda; pasada otra vez, no hace nada.
--   2 · la guarda: con otra trg_sale_push_status viva, la 1053 para.
--   Una base sin la 1630 (la local del W09 de antes del 29/10) prueba solo la
--   guarda, y lo dice.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA W10A-CIERRE: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

create temp table _s (clave text primary key, v text) on commit drop;
insert into _s
select 'viva', left(md5(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure)), 8) union all
select 'otros', (select count(*) from public.funcion_respaldo where not (firma = 'public.trg_sale_push_status()'
                   and migracion = '20261028T1630_w10a_order_advance_secreto_del_vault'))::text;
select (select v from _s where clave = 'viva') = '385240cb' as w10a_con_1630 \gset

\if :w10a_con_1630
-- ── 1 · Con la 1630: borra el respaldo, solo ese ────────────────────────────
\i supabase/migrations/20261029T1053_w10a_borrar_respaldo_secreto_viejo.sql
\i supabase/migrations/20261029T1053_w10a_borrar_respaldo_secreto_viejo.sql
do $$
begin
  if exists (select 1 from public.funcion_respaldo where firma = 'public.trg_sale_push_status()'
               and migracion = '20261028T1630_w10a_order_advance_secreto_del_vault') then
    raise exception 'PRUEBA W10A-CIERRE · 1: el respaldo de la 1630 sigue ahí.';
  end if;
  if exists (select 1 from public.funcion_respaldo where definicion ~ '\mfv_[a-z0-9]+_[A-Za-z0-9]{16,}\M') then
    raise exception 'PRUEBA W10A-CIERRE · 1: queda algún respaldo con un secreto fv_.';
  end if;
  if (select count(*) from public.funcion_respaldo)::text <> (select v from _s where clave = 'otros') then
    raise exception 'PRUEBA W10A-CIERRE · 1: se ha borrado algún respaldo más.';
  end if;
  if left(md5(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure)), 8) <> '385240cb' then
    raise exception 'PRUEBA W10A-CIERRE · 1: ha cambiado la función viva.';
  end if;
  raise notice '1 · con la 1630: borrado el respaldo de la 1630 y solo ese; la función, igual; dos veces, igual';
end $$;
\else
\echo 'Esta base no tiene la 1630 aplicada (trg_sale_push_status no es 385240cb): solo se prueba la guarda.'
\endif

-- ── 2 · La guarda: con otra función viva, la 1053 para y no borra ─────────
-- Dentro de un savepoint: una fila de respaldo con la huella esperada (si no
-- está) y una trg_sale_push_status distinta de la de la 1630. La 1053 tiene
-- que fallar; después se deshace todo.
savepoint guarda;
insert into public.funcion_respaldo (firma, migracion, definicion, huella)
values ('public.trg_sale_push_status()', '20261028T1630_w10a_order_advance_secreto_del_vault', '-- prueba', '2470441d' || repeat('0', 24))
on conflict (firma, migracion) do nothing;
create or replace function public.trg_sale_push_status() returns trigger language plpgsql as $f$
begin
  return new; -- PRUEBA W10A-CIERRE: no es la de la 1630
end $f$;
\set ON_ERROR_STOP 0
\i supabase/migrations/20261029T1053_w10a_borrar_respaldo_secreto_viejo.sql
\set ON_ERROR_STOP 1
\if :ERROR
\echo '2 · la guarda: con otra función viva, la 1053 para'
\else
do $$ begin raise exception 'PRUEBA W10A-CIERRE · 2: con otra función viva, la 1053 no ha parado.'; end $$;
\endif
rollback to savepoint guarda;

rollback;
