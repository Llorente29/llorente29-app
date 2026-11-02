-- supabase/vuelta-atras/20261101T1937_n1_laboral_modelo.down.sql
--
-- Vuelta atrás de la 1937: fuera las tablas de Laboral, el permiso y las
-- columnas nuevas de documents. Va después de la de la 1939 (que deja de usar
-- current_user_ve_laboral) y de la de la 1938.
alter table public.documents drop column if exists archivado_at;
alter table public.documents drop column if exists firma;
alter table public.documents drop column if exists firmado_por;
alter table public.documents drop column if exists firmado_at;
alter table public.documents drop column if exists visible_trabajador;
alter table public.documents drop column if exists caduca_el;
alter table public.documents drop column if exists origen;
alter table public.documents drop column if exists carpeta;
drop table if exists public.lab_centro_local;
drop table if exists public.lab_cambio;
drop table if exists public.lab_modelo_145;
drop table if exists public.lab_persona_concepto;
drop table if exists public.lab_contrato_condicion;
drop table if exists public.lab_contrato;
drop table if exists public.lab_concepto;
drop table if exists public.lab_convenio_tabla;
drop table if exists public.lab_convenio;
drop table if exists public.lab_persona;
drop function if exists public.lab_quitar_permiso(uuid, uuid);
drop function if exists public.lab_dar_permiso(uuid, uuid);
drop function if exists public.current_user_ve_laboral(uuid);
drop table if exists public.lab_permiso;
