-- Vuelta atrás de 20261009T0130_c03_periodos_propuestos.sql: borra los periodos
-- PROPUESTOS que no se han confirmado. PARA si alguno ya se confirmó (está en
-- period_from/to y lo lee Ventas): eso lo decidió una persona y no se deshace
-- a escondidas.
do $$
begin
  if exists (select 1 from public.channel_settlement where period_confirmed_at is not null) then
    raise exception 'Hay periodos propuestos ya confirmados: se quedan. No se quita nada.';
  end if;
  update public.channel_settlement set proposed_period_from = null, proposed_period_to = null, proposed_period_note = null
   where proposed_period_from is not null;
end $$;
