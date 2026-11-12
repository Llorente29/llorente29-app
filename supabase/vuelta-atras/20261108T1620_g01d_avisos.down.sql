-- supabase/vuelta-atras/20261108T1620_g01d_avisos.down.sql
--
-- G01d · Vuelta atrás de la 1620: fuera el repaso, las funciones, la cola y
-- registro de avisos y las columnas del aviso de cada conexión. Los códigos que
-- se hubieran pegado se borran de Vault. conta_gestoria_lectura.por vuelve a
-- sus tres valores: las lecturas apuntadas «por aviso» pasan a «persona» (no se
-- borra ninguna lectura ni ninguna diferencia).

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'conta-avisos-repaso';
  end if;
end $$;
drop function if exists public.conta_avisos_despertar();
drop function if exists public.conta_crm_renovar_pendientes(uuid, text, uuid, jsonb, jsonb);
drop function if exists public.conta_crm_guardar_personas_de_contacto(uuid, text, text, jsonb, jsonb);
drop function if exists public.conta_aviso_secreto(text, uuid, text, uuid);
drop function if exists public.conta_aviso_configurar(uuid, text, text, uuid, text, boolean);
drop table if exists public.conta_aviso;

delete from vault.secrets where id in (select aviso_ref from public.conta_crm where aviso_ref is not null
                                       union select aviso_ref from public.conta_cobro_gocardless where aviso_ref is not null);
alter table public.conta_crm drop column if exists aviso_ref, drop column if exists aviso_encendido, drop column if exists aviso_encendido_at,
  drop column if exists aviso_encendido_por_name, drop column if exists aviso_ultimo_at;
alter table public.conta_cobro_gocardless drop column if exists aviso_ref, drop column if exists aviso_encendido, drop column if exists aviso_encendido_at,
  drop column if exists aviso_encendido_por_name, drop column if exists aviso_ultimo_at;

update public.conta_gestoria_lectura set por = 'persona' where por = 'aviso';
alter table public.conta_gestoria_lectura drop constraint if exists conta_gestoria_lectura_por_check;
alter table public.conta_gestoria_lectura add constraint conta_gestoria_lectura_por_check check (por = any (array['persona', 'cada_noche', 'conexion']));
