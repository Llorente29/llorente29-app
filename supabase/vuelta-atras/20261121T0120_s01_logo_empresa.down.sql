-- supabase/vuelta-atras/20261121T0120_s01_logo_empresa.down.sql
--
-- Vuelta atrás de 20261121T0120_s01_logo_empresa, en orden inverso:
--   3. fuera las cuatro políticas del bucket;
--   2. el bucket company-logos se borra solo si está vacío. Si tiene logos, se
--      queda (privado y sin políticas: nadie lo lee) y se dice: borrar ficheros
--      de storage es cosa de la API, no de SQL;
--   1. fuera company.logo_path.
-- PARA, sin tocar nada, si alguna empresa ya tiene su logo puesto
-- (company.logo_path): se perdería dónde está.
-- ANTES de esto, el front tiene que volver al de antes: el del S01 lee la columna.

do $$
declare n bigint;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company' and column_name = 'logo_path') then
    execute 'select count(*) from public.company where logo_path is not null' into n;
    if n > 0 then
      raise exception 'S01 0120 vuelta atrás: % empresas tienen su logo puesto (company.logo_path) y se perdería. No se toca nada.', n;
    end if;
  end if;
end $$;

drop policy if exists company_logos_delete on storage.objects;
drop policy if exists company_logos_update on storage.objects;
drop policy if exists company_logos_insert on storage.objects;
drop policy if exists company_logos_select on storage.objects;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'company-logos') then
    raise notice 'S01 0120 vuelta atrás: el bucket company-logos tiene logos y se queda (sin políticas). Se vacía con la API de storage.';
  else
    begin
      delete from storage.buckets where id = 'company-logos';
    exception when others then
      raise notice 'S01 0120 vuelta atrás: el bucket company-logos no se ha podido borrar desde SQL (%); se queda vacío y sin políticas.', sqlerrm;
    end;
  end if;
end $$;

alter table public.company drop column if exists logo_path;
