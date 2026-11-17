-- supabase/staging/sql/20261117_r05_medida_antes.sql
--
-- SOLO STAGING. R05 · la medida de «no he roto lo de Folvy», ANTES de la tanda
-- (regla 31). Va la primera en la tanda de staging de la rama: corre en su
-- sesión, sin las migraciones del R05 delante. Solo lee, y acaba en ROLLBACK.
--
-- Lo que proponen hoy los días de ventas de Folvy: para cada día y local con un
-- resumen de ventas (sales_day_summary, de todas las cuentas de staging: la
-- tabla entera, a propósito), la propuesta de conta_propuestas_ventas_dia, y su
-- huella. 20261117_r05_dia_tpv_prueba.sql toma la misma medida, con la misma
-- consulta, después de las migraciones: tienen que salir iguales.

begin;
do $$
declare v_n int; v_huella text;
begin
  select count(*), md5(coalesce(string_agg(x.k || '=' || public.conta_propuestas_ventas_dia(x.c, x.l, x.d)::text, '|' order by x.k), ''))
    into v_n, v_huella
    from (select distinct s.company_id as c, s.location_id as l, s.sales_day as d, s.company_id || ':' || s.location_id || ':' || s.sales_day as k
            from public.sales_day_summary s) x;
  raise notice 'MEDIDA R05 · antes · días de ventas de Folvy (tabla entera) = % · huella de sus propuestas = %', v_n, v_huella;
end $$;
rollback;
