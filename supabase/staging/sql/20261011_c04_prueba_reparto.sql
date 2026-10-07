-- supabase/staging/sql/20261011_c04_prueba_reparto.sql
--
-- SOLO STAGING. El resultado por local CON reparto de lo común: la rama que
-- la prueba del C04 no recorría (no había regla de reparto) y que falló en el
-- e2e 123 con 42702. Sobre la semilla del C04 (regla 60/40 y un préstamo
-- común): con y sin reparto, la suma de las filas es la misma y, con la regla
-- al 100 %, no queda ninguna fila sin local. ROLLBACK al final.

begin;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  sin_rep numeric; con_rep numeric; comunes int; filas int;
begin
  select sum(resultado), count(*) filter (where location_id is null) into sin_rep, comunes
    from public.conta_resultado_por_local(ea, '2026-10-01', '2026-10-31', false);
  if comunes = 0 then raise exception 'PRUEBA reparto: la semilla no deja nada común en octubre; la prueba no probaría nada.'; end if;
  select sum(resultado), count(*) filter (where location_id is null), count(*) into con_rep, comunes, filas
    from public.conta_resultado_por_local(ea, '2026-10-01', '2026-10-31', true);
  if con_rep is distinct from sin_rep then raise exception 'PRUEBA reparto: con reparto suma % y sin él %', con_rep, sin_rep; end if;
  if comunes <> 0 then raise exception 'PRUEBA reparto: con la regla al 100 %% quedan % filas sin local', comunes; end if;
  raise notice 'PRUEBA reparto en verde: % € de resultado en octubre, con y sin reparto; % filas, ninguna sin local.', con_rep, filas;
end $$;
reset role;
\echo '>>> Prueba del reparto en verde. ROLLBACK: no queda nada.'
rollback;
