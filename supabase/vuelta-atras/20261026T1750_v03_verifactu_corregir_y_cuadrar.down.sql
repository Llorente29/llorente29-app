-- supabase/vuelta-atras/20261026T1750_v03_verifactu_corregir_y_cuadrar.down.sql
--
-- Vuelta atrás de 20261026T1750_v03_verifactu_corregir_y_cuadrar: quita el
-- cron del cuadre, las funciones y las dos tablas del cuadre (lo que contestó
-- Hacienda en cada «Comprobar con Hacienda»; se puede volver a preguntar).
-- Lo que hayan escrito las funciones se QUEDA: los registros de anulación y de
-- subsanación son de Hacienda (no se borran nunca), y una factura anulada con
-- su contrasiento sigue anulada.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'verifactu-cuadre') then
    perform cron.unschedule('verifactu-cuadre');
  end if;
end $$;

drop function if exists public.verifactu_despertar_cuadre();
drop function if exists public._verifactu_cuadrar(uuid);
drop function if exists public.verifactu_cert_abrir_cuadre(uuid);
drop function if exists public.verifactu_cuadre_fallo(uuid, text);
drop function if exists public.verifactu_cuadre_pagina(uuid, jsonb, boolean);
drop function if exists public.verifactu_cuadre_tomar(text);
drop function if exists public.verifactu_despacho_empresas(uuid);
drop function if exists public.verifactu_cuadre_ver(uuid, date, uuid, uuid);
drop function if exists public.verifactu_cuadre_pedir(uuid, date, uuid, text);
drop function if exists public._verifactu_puede_cuadrar(uuid, uuid);
drop table if exists public.verifactu_cuadre_hacienda;
drop table if exists public.verifactu_cuadre;
drop function if exists public.verifactu_comprobar_cadena(uuid);
drop function if exists public.verifactu_subsanar(uuid, text, text);
drop function if exists public.verifactu_anular_factura(uuid, text, text, text);
drop function if exists public._verifactu_contrasiento(uuid, text, text);
drop function if exists public.verifactu_previsto(uuid, text, jsonb);
drop function if exists public._verifactu_cambios(public.verifactu_registro, jsonb);
drop function if exists public._verifactu_carga_de_factura(uuid, text);
drop function if exists public._verifactu_anulacion_de(uuid);
drop function if exists public._verifactu_ultima_alta(uuid);
