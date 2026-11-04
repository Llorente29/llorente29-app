-- supabase/staging/sql/20261104_s01p_intereses_prueba.sql
--
-- SOLO STAGING. Prueba del S01p·6 · el 4/3313 duplicado (1925). La 1925 es de
-- Foodint y en staging no hace nada; la función que usa, _conta_asientos_borrar,
-- ya tiene su prueba (S01q, 20261102_s01q_borrar_prueba.sql). Aquí: que sin
-- Foodint no toca nada (ni journal_entry, ni tax_return_line, ni
-- conta_asiento_borrado) y que su vuelta atrás tampoco. Todo con ROLLBACK.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p intereses: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: es una tanda de datos que corre como el dueño, igual que en el ensayo.
create temp table _antes on commit drop as
  select (select count(*) from public.journal_entry) asientos, (select count(*) from public.tax_return_line) lineas,
         (select count(*) from public.conta_asiento_borrado) borrados, (select coalesce(sum(hashtext(hash)), 0) from public.journal_entry) huellas;
\i supabase/migrations/20261104T1925_s01p_intereses_duplicados.sql
\i supabase/vuelta-atras/20261104T1925_s01p_intereses_duplicados.down.sql
do $$ begin
  if (select row(asientos, lineas, borrados, huellas) from _antes) is distinct from
     (select row((select count(*) from public.journal_entry), (select count(*) from public.tax_return_line),
                 (select count(*) from public.conta_asiento_borrado), (select coalesce(sum(hashtext(hash)), 0) from public.journal_entry))) then
    raise exception 'PRUEBA S01p intereses: sin Foodint, la tanda o su vuelta atrás han tocado algo.';
  end if;
  if to_regclass('public.conta_s01p6_303_antes') is not null then raise exception 'PRUEBA S01p intereses: queda la copia del 303.'; end if;
  raise notice 'PRUEBA S01p intereses: bien (sin Foodint no toca nada).';
end $$;
rollback;
