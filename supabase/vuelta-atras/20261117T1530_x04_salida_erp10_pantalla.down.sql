-- supabase/vuelta-atras/20261117T1530_x04_salida_erp10_pantalla.down.sql
--
-- X04 · Vuelta atrás de 20261117T1530_x04_salida_erp10_pantalla: quita las dos
-- funciones nuevas y la columna de la carpeta. Si alguna empresa ya tiene su
-- carpeta puesta, se perdería: para.

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_erp10_salida_empresa' and column_name = 'carpeta_pdf')
     and exists (select 1 from public.conta_erp10_salida_empresa e
                  where e.carpeta_pdf is not null
                    and not exists (select 1 from public.company c where c.id = e.company_id and c.legal_name like 'Empresa Inventada X04%')) then
    raise exception 'X04 · vuelta atrás: alguna empresa ya tiene su carpeta de PDF puesta; quitar la columna la perdería. No se toca nada.';
  end if;
end $$;
drop function if exists public.conta_erp10_recibidas_por_salir(uuid, date);
drop function if exists public.conta_erp10_salida_carpeta(uuid, text, text);
alter table public.conta_erp10_salida_empresa drop column if exists carpeta_pdf;
