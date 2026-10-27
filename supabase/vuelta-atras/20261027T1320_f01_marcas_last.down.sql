-- supabase/vuelta-atras/20261027T1320_f01_marcas_last.down.sql
--
-- Vuelta atrás de la 1320 (F01 · marcas de Last, lo que añade): quita lo que
-- crea, en orden inverso. Va DESPUÉS de la de la 1322 (que usa _f01_*).
-- PARA si ya hay altas hechas (external_brand_alta con filas): son decisiones
-- de alguien; antes se deshace la 1321 o se decide qué hacer con ellas.
-- Lo que el alta o la pasada ya escribieron en tablas que existían (marcas,
-- platos, vínculos) se queda: es verdad con o sin la 1320.

do $$
begin
  if to_regclass('public.external_brand_alta') is not null and exists (select 1 from public.external_brand_alta) then
    raise exception 'F01: hay % altas de marcas de Last hechas: no se quita la 1320 sin decidir antes qué pasa con ellas.',
      (select count(*) from public.external_brand_alta);
  end if;
end $$;

drop function if exists public.f01_pasada_last(uuid);
drop function if exists public.f01_alta_marca(uuid, uuid, text, text, boolean, text, boolean);
drop function if exists public._f01_alta_marca(uuid, uuid, text, text, boolean, text, boolean, uuid, text);
drop function if exists public.f01_marcas_last(uuid);
drop function if exists public._f01_marcas_last(uuid);
drop function if exists public._f01_recolocar(uuid, uuid, uuid, text);
drop function if exists public._f01_vincular(uuid, uuid, uuid, text, boolean, text);
drop function if exists public._f01_sembrar_marca(uuid, uuid, uuid, text, boolean, text);
drop function if exists public._f01_filas(uuid, uuid, text);
drop function if exists public._f01_marca_vinculada(uuid, uuid, text);
drop function if exists public._f01_marca_por_nombre(uuid, text);
drop function if exists public._f01_normalizar(text);

drop table if exists public.external_brand_alta;
alter table public.external_catalog_product drop column if exists external_brand_id;
