-- Vuelta atrás de 20261024T0630_n3_local_empresa.sql (N3).
--
-- Quita lo que añadió: la tabla location_company (con sus filas, su disparador
-- y su política), su función de guarda y empresa_del_local. No toca locations
-- ni company. Si alguna fila no la puso la 0630 (source distinto de
-- 'unica_empresa'), para: alguien ya la está usando, y eso se decide a mano.

do $$ begin
  if to_regclass('public.location_company') is not null
     and exists (select 1 from public.location_company where source <> 'unica_empresa') then
    raise exception 'Vuelta atrás N3: location_company tiene filas puestas a mano o en un alta. No se borra nada.';
  end if;
end $$;

drop function if exists public.empresa_del_local(uuid);
drop table if exists public.location_company;
drop function if exists public.location_company_misma_cuenta();
