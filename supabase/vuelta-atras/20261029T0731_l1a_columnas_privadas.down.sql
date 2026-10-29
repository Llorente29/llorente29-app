-- supabase/vuelta-atras/20261029T0731_l1a_columnas_privadas.down.sql
--
-- Deja employees como estaba antes de la 0731 (producción, 29/10/2026): SELECT
-- de tabla para authenticated y anon. Quita antes los SELECT por columna que
-- dio la 0731, para que no quede nada suelto.

do $$
declare
  v_columnas text;
begin
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_columnas
    from pg_attribute a
   where a.attrelid = 'public.employees'::regclass
     and a.attnum > 0 and not a.attisdropped;
  execute format('revoke select (%s) on public.employees from authenticated, anon', v_columnas);
  grant select on public.employees to authenticated, anon;
end $$;
