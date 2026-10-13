-- Vuelta atrás de 20261020T0130. No devuelve los asientos del día entero: con
-- la regla por plataforma se proponen por unidad, y su copia queda en
-- _retirado_ventas_por_plataforma. Retira los PROPUESTOS por unidad (ni
-- validados ni borradores) para que la vuelta atrás de la 0120 y la 0110
-- puedan seguir; el cierre del día, sin regla nueva, volverá a proponer el
-- día entero. PARA si alguna unidad ya no es «propuesto» sin número.
do $$
begin
  if exists (select 1 from public.sales_day_summary d join public.journal_entry e on e.id = d.entry_id
              where d.unit_key is not null and (e.status <> 'propuesto' or e.number is not null)) then
    raise exception 'Vuelta atrás de la 0130: hay unidades validadas o en borrador; no se retiran solas.';
  end if;
  delete from public.journal_entry e using public.sales_day_summary d where d.entry_id = e.id and d.unit_key is not null;
  delete from public.sales_day_summary where unit_key is not null;
end $$;
drop function if exists public.conta_propuestos_dia_entero(uuid);
