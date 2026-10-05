-- supabase/vuelta-atras/20261008T0100_c02c_traer_plan.down.sql
--
-- Deshace 20261008T0100. Antes, la 0110 (la activación vuelve a la de la 0180).
--
-- PARA si queda algo traído de otro programa: una cuenta con source 'migrated',
-- una importación traída o una ficha creada al traer. Deshacer la estructura
-- con eso dentro perdería datos de verdad: primero se deshace la importación
-- desde la pantalla (company_chart_import_undo), y luego esto.
do $$
begin
  if exists (select 1 from public.company_account where source = 'migrated' or import_id is not null)
     or exists (select 1 from public.company_account_link where source = 'migrated')
     or exists (select 1 from public.company_chart_import where status = 'traida')
     or exists (select 1 from public.supplier where import_id is not null) then
    raise exception 'Hay un plan traído de otro programa: deshazlo antes desde la pantalla. No se quita nada.';
  end if;
end $$;

drop function if exists public.company_chart_import_undo(uuid, text);
drop function if exists public.company_chart_import_apply(uuid, jsonb, text);
drop function if exists public.company_chart_import_discard(uuid);
drop function if exists public.company_chart_import_save(uuid, text, text[], text, jsonb, text);

alter table public.supplier drop column if exists import_id;
drop index if exists public.company_account_import_id;
alter table public.company_account drop column if exists import_id;
alter table public.company_account drop column if exists name_source;
drop table if exists public.company_chart_import;
drop function if exists public.company_chart_import_misma_cuenta();

-- El registro: sin los «qué» y el origen nuevos (lo de la importación ya no existe: lo comprobó la guarda).
delete from public.company_account_log where que in ('importado', 'importacion_deshecha') or source = 'migrated';
alter table public.company_account_log drop constraint company_account_log_que_check;
alter table public.company_account_log add constraint company_account_log_que_check check (que in (
  'activado', 'subcuenta_creada', 'oculta', 'visible', 'enlace_cambiado', 'longitud_cambiada', 'borrada_duplicada', 'fusionada',
  'cerrada', 'palabras_clave', 'subcuenta_deshecha', 'plan_cambiado', 'enlace_quitado', 'renombrada'));
alter table public.company_account_log drop constraint company_account_log_source_check;
alter table public.company_account_log add constraint company_account_log_source_check check (source in ('serie', 'manual', 'ai_accepted'));
alter table public.company_account_link drop constraint company_account_link_source_check;
alter table public.company_account_link add constraint company_account_link_source_check check (source in ('serie', 'manual', 'ai_accepted'));
alter table public.company_account drop constraint company_account_source_check;
alter table public.company_account add constraint company_account_source_check check (source in ('serie', 'manual', 'ai_accepted'));
