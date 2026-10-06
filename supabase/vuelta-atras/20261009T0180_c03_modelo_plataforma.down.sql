-- Vuelta atrás de 20261009T0180_c03_modelo_plataforma.sql. Para si alguien ya
-- dijo el modelo de alguna plataforma: no se borra una respuesta a escondidas.
do $$
begin
  if exists (select 1 from public.party_role where platform_model is not null) then
    raise exception 'Vuelta atrás 0180: hay plataformas con su modelo dicho. Quítalo antes en su ficha.';
  end if;
end $$;
alter table public.party_role drop constraint if exists party_role_modelo_plataforma;
alter table public.party_role drop column if exists platform_model;
