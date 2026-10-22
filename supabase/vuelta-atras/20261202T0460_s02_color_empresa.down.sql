-- supabase/vuelta-atras/20261202T0460_s02_color_empresa.down.sql
--
-- Vuelta atrás de 20261202T0460_s02_color_empresa, en orden inverso:
--   2. fuera la comprobación company_color_formato;
--   1. fuera company.color.
-- PARA, sin tocar nada, si alguna empresa ya ha elegido su color: se perdería.
-- ANTES de esto, el front tiene que volver al de antes si guarda el color
-- (el del S02 lo lee con «select *»: sin la columna, sale el de serie).

do $$
declare n bigint;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'color') then
    execute 'select count(*) from public.company where color is not null' into n;
    if n > 0 then
      raise exception 'S02 0460 vuelta atrás: % empresas tienen su color elegido (company.color) y se perdería. No se toca nada.', n;
    end if;
  end if;
end $$;

alter table public.company drop constraint if exists company_color_formato;
alter table public.company drop column if exists color;
