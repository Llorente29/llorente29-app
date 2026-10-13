-- supabase/vuelta-atras/20261111T0200_c06_diez_base.down.sql
--
-- Vuelta atrás de 20261111T0200_c06_diez_base.sql. Quita la tabla de la base
-- de Diez de cada empresa, su registro, su función y sus disparadores.
--
-- PARA (no borra nada) si hay alguna base registrada que no sea la de Foodint
-- que puso la propia migración: una segunda empresa que ya trae su Diez
-- perdería la suya, y eso no se deshace en silencio.

do $$
begin
  if exists (select 1 from public.conta_diez_base where company_id <> '658728c0-fcd7-46ef-a860-d4e5e6eb21d9') then
    raise exception 'Vuelta atrás de la base de Diez PARADA: hay empresas con su base registrada además de Foodint. Mirar antes.';
  end if;
end $$;

drop function if exists public.conta_diez_preparar_corte(uuid, date, text);
drop function if exists public.conta_diez_base_poner(uuid, text, text, text);
drop table if exists public.conta_diez_base_registro;
drop table if exists public.conta_diez_base;
drop function if exists public.conta_diez_base_apuntar();
drop function if exists public.conta_diez_base_guarda();
