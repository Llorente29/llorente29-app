-- supabase/vuelta-atras/20261027T1322_f01_sembrado_y_socio.down.sql
--
-- Vuelta atrás de la 1322 (F01 · lo que cambia): restaura, byte a byte, el
-- sembrado y Ajustes › Facturas de los pedidos como estaban (_restaurar_funcion
-- comprueba la huella) y vuelve a hacer obligatorio el porcentaje del socio.
-- PARA si hay fichas de socio sin porcentaje: son de alguien (las de la 1321 se
-- quitan antes, con su vuelta atrás); se decide antes qué hacer con ellas.

do $$
begin
  if exists (select 1 from public.brand_licensing_agreement where revenue_share_pct is null) then
    raise exception 'F01: hay % fichas de socio sin porcentaje: no se puede volver a hacer obligatorio.',
      (select count(*) from public.brand_licensing_agreement where revenue_share_pct is null);
  end if;
end $$;

select public._restaurar_funcion('public.ticket_invoice_ajustes(uuid)', '20261027T1322_f01_sembrado_y_socio');
select public._restaurar_funcion('public.seed_catalog_canonical(uuid,boolean,interval)', '20261027T1322_f01_sembrado_y_socio');
alter table public.brand_licensing_agreement alter column revenue_share_pct set not null;
