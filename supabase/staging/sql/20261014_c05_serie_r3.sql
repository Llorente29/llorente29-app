-- supabase/staging/sql/20261014_c05_serie_r3.sql
--
-- SOLO STAGING. La 0110 (serie de los modelos) ya estaba aplicada aquí cuando
-- la respuesta 3 cambió dos colocaciones:
--   · 160, 162, 510, 512 (deudas de 3 cifras con partes vinculadas): de la
--     línea de su hija …5 a la línea «otras» de su grupo, por defecto.
--   · 2935 y 5935 (correctoras): a la línea de la 2405/5305 que corrigen.
-- La 0110 inserta «si no está»: volver a pasarla no cambia una fila que ya
-- existe con otra línea, y dejaría dos líneas para la misma cuenta. Aquí se
-- quitan las 12 filas de serie que cambian (solo las de serie, company_id
-- null, origen «defecto»); la 0110, justo detrás en aplicar.txt, pone las
-- nuevas. En producción la 0110 aún no está: entra ya con la versión buena.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'SERIE C05 R3: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

do $$
declare n int;
begin
  delete from public.annual_accounts_mapping
   where company_id is null and statement = 'balance' and origin = 'defecto' and account_prefix in ('160', '162', '510', '512');
  get diagnostics n = row_count;
  if n <> 12 then raise exception 'SERIE C05 R3: esperaba quitar 12 filas (4 cuentas × 3 modelos) y son %.', n; end if;
  raise notice 'SERIE C05 R3: quitadas % filas de 160/162/510/512; la 0110 pone las nuevas.', n;
end $$;
commit;
