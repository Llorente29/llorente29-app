-- supabase/vuelta-atras/20261117T0950_r03_ventas_tpv_tablas.down.sql
--
-- Vuelta atrás de la 0950 (R03): quita las cinco tablas del TPV de fuera y el
-- interruptor «ventas por día». Va DESPUÉS de la de la 0951 (las funciones que
-- las escriben). Mientras no haya pantalla de subida, las tablas están vacías y
-- el interruptor apagado en todas: no se pierde nada. Si ya hubiera días
-- subidos, se perderían: por eso para si hay alguno.

do $$ begin
  if to_regclass('public.conta_tpv_dia') is not null then
    if exists (select 1 from public.conta_tpv_dia) then
      raise exception 'Vuelta atrás R03: ya hay días del TPV guardados. No se quitan las tablas sin mirarlo antes.';
    end if;
  end if;
end $$;
drop table if exists public.conta_tpv_impuesto;
drop table if exists public.conta_tpv_cobro;
drop table if exists public.conta_tpv_documento;
drop table if exists public.conta_tpv_dia;
drop table if exists public.conta_tpv_forma_cuenta;
alter table public.company_tax_profile drop column if exists ventas_por_dia;
