-- supabase/vuelta-atras/20261027T0741_v04_tique_verifactu.down.sql
--
-- Vuelta atrás de 20261027T0741_v04_tique_verifactu.
--   · Las cinco funciones que cambiaba vuelven a ser EXACTAMENTE las de antes:
--     se ejecuta el texto que la migración guardó en funcion_respaldo, y
--     _restaurar_funcion comprueba la huella (Respuesta 1, 27/10).
--   · Se quitan el disparador de la venta, el cron, las funciones nuevas, las
--     columnas nuevas de los tiques, el tramo de las series y el fabricante.
-- OJO: no borra números ni registros de Hacienda. Si la serie ya dio números en
-- un tramo (CA27B-…), hay rectificativas o algún tique tiene su registro de
-- Verifactu, PARA: esos números están en papeles que tienen los clientes, y esos
-- registros, en Hacienda. Se decide antes, no se deshace a ciegas.

select public._ticket_verifactu_se_puede_deshacer();

select public._restaurar_funcion('public.ticket_invoice_ajustes(uuid)', '20261027T0741_v04_tique_verifactu');
select public._restaurar_funcion('public.fiscal_for_preview(uuid)', '20261027T0741_v04_tique_verifactu');
select public._restaurar_funcion('public.fiscal_for_print(text,uuid)', '20261027T0741_v04_tique_verifactu');
select public._restaurar_funcion('public._ticket_invoice_number(uuid,uuid,uuid,text,text,text,timestamptz)', '20261027T0741_v04_tique_verifactu');
select public._restaurar_funcion('public.verifactu_modo(uuid,text,text,text,text)', '20261027T0741_v04_tique_verifactu');

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'ticket-verifactu-pendientes') then
    perform cron.unschedule('ticket-verifactu-pendientes');
  end if;
end $$;
drop trigger if exists ticket_tras_venta on public.sale;
drop function if exists public._ticket_tras_venta();
drop function if exists public.ticket_verifactu_pendientes(integer);
drop function if exists public._ticket_rectificar(uuid, uuid);
drop function if exists public._ticket_verifactu_anular(uuid);
drop function if exists public._ticket_verifactu_alta(uuid);
drop function if exists public._ticket_tramo(uuid, uuid, integer, text);
drop function if exists public._ticket_numero_texto(text, integer, text, text, integer);
drop function if exists public._ticket_verifactu_se_puede_deshacer();

-- El tramo de las series, y la clave única de antes.
drop index if exists public.ticket_invoice_series_unica_tramo;
alter table public.ticket_invoice_series add constraint ticket_invoice_series_unica unique (account_id, location_id, year, kind);
alter table public.ticket_invoice_series drop column if exists tramo;

-- Lo nuevo de cada tique.
drop index if exists public.ticket_invoice_verifactu_pendiente;
drop index if exists public.ticket_invoice_de_la_venta;
alter table public.ticket_invoice
  drop column if exists verifactu_intentos,
  drop column if exists verifactu_error,
  drop column if exists verifactu_estado,
  drop column if exists verifactu_anulacion_id,
  drop column if exists verifactu_registro_id,
  drop column if exists verifactu_entorno,
  drop column if exists rectifica_id,
  drop column if exists importe_total,
  drop column if exists company_id;

-- El fabricante.
drop function if exists public.verifactu_sistema_poner(text, text, text);
drop function if exists public.verifactu_sistema_ver();
drop function if exists public.verifactu_sistema_completo();
drop table if exists public.verifactu_sistema;
