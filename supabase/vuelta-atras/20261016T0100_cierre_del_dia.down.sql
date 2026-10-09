-- Vuelta atrás de «El día se cierra a las 6:00» · 1 · la base.
-- PARA si ya se ha cerrado algún pedido como no confirmado: quitar la marca
-- dejaría esos pedidos como anulaciones sin rastro de por qué. Primero se
-- decide qué hacer con ellos (y la 0110 se deshace antes que esta).
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sale' and column_name = 'unconfirmed_at')
     and exists (select 1 from public.sale where unconfirmed_at is not null) then
    raise exception 'Vuelta atrás 0100: hay pedidos cerrados como no confirmados; se perdería por qué se cerraron.';
  end if;
end $$;
drop procedure if exists public.conta_cierre_del_dia_todas();
drop function if exists public.conta_no_confirmados(uuid, date, date, uuid);
drop function if exists public.conta_cerrar_dias(uuid, timestamptz);
drop function if exists public.conta_por_cerrar(uuid, timestamptz);
drop function if exists public.conta_cerrado_hasta(uuid, timestamptz);
drop function if exists public.conta_ultimo_dia_cerrado(uuid, timestamptz);
drop table if exists public.sales_day_close_log;
alter table public.company_tax_profile drop column if exists sales_day_close_time;
alter table public.sale drop column if exists unconfirmed_at;
