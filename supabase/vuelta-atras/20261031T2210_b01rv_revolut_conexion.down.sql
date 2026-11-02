-- Vuelta atrás de 20261031T2210_b01rv_revolut_conexion.sql
-- Quita el despertador, las funciones, los secretos de Revolut del Vault y la
-- tabla. Lo que ya entró en Bancos (bank_movement, bank_statement) se queda.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'conta-revolut-despertar') then
      perform cron.unschedule('conta-revolut-despertar');
    end if;
  end if;
end $$;
do $$
begin
  if to_regclass('vault.secrets') is not null then
    execute $q$delete from vault.secrets where name like 'revolut:%'$q$;
  end if;
end $$;
drop function if exists public.conta_revolut_despertar();
drop function if exists public.conta_revolut_desconectar(uuid, uuid, text, boolean);
drop function if exists public._revolut_secretos_quitar(uuid);
drop function if exists public.conta_revolut_secreto(uuid, text);
drop function if exists public.conta_revolut_secreto_poner(uuid, text, text);
drop function if exists public._revolut_nombre_secreto(uuid, text);
drop table if exists public.revolut_conexion;
