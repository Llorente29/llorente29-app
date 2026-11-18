-- supabase/vuelta-atras/20261118T0600_e02_lectura_caida.down.sql
--
-- Vuelta atrás de la 0600 (E02): quita el cron, las cuatro funciones, la tabla
-- del estado, los dos índices y las tres columnas de document_inbox (con lo que
-- digan: es solo la clase del fallo; el «reason» de cada llegada se queda).

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'e02-lectura-vigia') then perform cron.unschedule('e02-lectura-vigia'); end if;
  end if;
end $$;
drop function if exists public._conta_lectura_vigia();
drop function if exists public.conta_lectura_estado(uuid);
drop function if exists public._conta_lectura_caida();
drop table if exists public.conta_lectura_estado;
drop index if exists public.goods_receipt_ai_session_buena_idx;
drop index if exists public.document_inbox_lectura_caida_idx;
alter table public.document_inbox drop constraint if exists document_inbox_e02_clase;
alter table public.document_inbox drop constraint if exists document_inbox_e02_par;
alter table public.document_inbox drop column if exists read_failure_at;
alter table public.document_inbox drop column if exists read_failure_cause;
alter table public.document_inbox drop column if exists read_failure;
