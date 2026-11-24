-- R07 · la vuelta atrás de 0810: quita lo que añadió (las funciones nuevas, el enlace y la columna «desde»). Va
-- después de la de la 0900, que es la que deja de llamarlas; para si aún hay algún cobro del día unido a su factura.
do $$ begin
  if exists (select 1 from public.conta_dia_cobro) then
    raise exception 'Vuelta atrás de la 0810 PARADA: hay facturas del día unidas a su cobro (conta_dia_cobro); deshaz antes la 0900.';
  end if;
end $$;
drop function if exists public.conta_tpv_dia_ejemplo(uuid, jsonb, uuid);
drop function if exists public.conta_tpv_factura_guardar(uuid, text, text);
drop function if exists public.conta_tpv_factura_de(uuid, date);
drop function if exists public._conta_dia_proponer(uuid, jsonb, text);
drop function if exists public._conta_dia_concepto(text, text);
drop function if exists public._conta_dia_partir(jsonb, text);
drop table if exists public.conta_dia_cobro;
alter table public.conta_tpv_factura_cuenta drop column if exists desde;
