-- supabase/vuelta-atras/20261125T1830_v05_verifactu_pruebas_empresas.down.sql
--
-- Vuelta atrás de 20261125T1830_v05_verifactu_pruebas_empresas: quita las
-- cinco funciones que añade. Lo que hayan escrito se QUEDA: las pruebas de
-- conexión apuntadas y los registros de pruebas son historia de Hacienda.
drop function if exists public.verifactu_pruebas_resumen(uuid);
drop function if exists public.verifactu_conexion_ultima(uuid);
drop function if exists public.verifactu_despertar_empresa(uuid, text);
drop function if exists public.verifactu_cert_abrir_pruebas_envio(uuid);
drop function if exists public.verifactu_cert_abrir_pruebas(uuid);
