-- supabase/vuelta-atras/20261026T2309_v04_tique_serie_y_quien_factura.down.sql
--
-- Vuelta atrás de 20261026T2309_v04_tique_serie_y_quien_factura.
--   · fiscal_for_print vuelve a ser EXACTAMENTE la de antes: se ejecuta el
--     texto que la migración guardó en funcion_respaldo (pg_get_functiondef,
--     con sus saltos de línea, que en producción son \r\n), y
--     _restaurar_funcion comprueba que la huella es la misma o para. Nada de
--     copiarla a mano: una copia con \n deja otra huella (Respuesta 1, 27/10).
--   · Se quitan las funciones y las tablas de la serie.
--   · funcion_respaldo, _respaldar_funcion y _restaurar_funcion las crea esta
--     migración, así que se quitan también, pero solo si el respaldo queda
--     vacío. Si otra tanda guardó ahí la suya, se quedan: su vuelta atrás las
--     necesita. Así la base vuelve a ser la de antes, definición a definición
--     (el comparador de staging, W06, lo mide así).
-- OJO: quitar ticket_invoice borra los números dados. Si la serie ya ha
-- numerado tiques de verdad, esto no se lanza sin decidirlo antes: esos
-- números están en tiques que tienen los clientes.

select public._restaurar_funcion('public.fiscal_for_print(text,uuid)', '20261026T2309_v04_tique_serie_y_quien_factura');

drop function if exists public.ticket_invoice_code_set(uuid, text, text);
drop function if exists public.ticket_invoice_ajustes(uuid);
drop function if exists public.fiscal_for_preview(uuid);
drop function if exists public._ticket_aviso(text, text, text, text, interval, uuid, uuid, uuid, text);
drop function if exists public._ticket_fiscal_de_antes(uuid, uuid);
drop function if exists public._ticket_quien_factura(uuid, uuid);
drop function if exists public._ticket_codigo_propuesto(text, text);
drop function if exists public._ticket_invoice_number(uuid, uuid, uuid, text, text, text, timestamptz);
drop function if exists public._ticket_invoice_text(text, integer, text, integer);
drop table if exists public.ticket_invoice;
drop table if exists public.ticket_invoice_series;
drop table if exists public.location_invoice_code;
do $$
begin
  if not exists (select 1 from public.funcion_respaldo) then
    drop function public._restaurar_funcion(text, text);
    drop function public._respaldar_funcion(text, text);
    drop table public.funcion_respaldo;
  end if;
end $$;
