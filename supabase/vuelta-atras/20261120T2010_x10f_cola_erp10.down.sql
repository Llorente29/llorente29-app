-- supabase/vuelta-atras/20261120T2010_x10f_cola_erp10.down.sql
--
-- X10f · Vuelta atrás de la 2010: quita el cron (si está), las tres funciones y la columna «como».
-- Si algún envío ya dice cómo salió, para: quitarla borraría lo que la pantalla enseña.

do $$
begin
  if exists (select 1 from public.conta_erp10_envio where como is not null) then
    raise exception 'Hay envíos a ERP10 que ya dicen cómo salieron: no se quita la columna «como».' using errcode = '55000';
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'conta-erp10-despertar') then
      perform cron.unschedule('conta-erp10-despertar');
    end if;
  end if;
end $$;
drop function if exists public.conta_erp10_despertar();
drop function if exists public.conta_erp10_cola(integer);
drop function if exists public.conta_erp10_atascados(uuid);
alter table public.conta_erp10_envio drop column if exists como;
