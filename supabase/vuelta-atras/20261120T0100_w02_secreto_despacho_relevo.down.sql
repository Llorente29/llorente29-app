-- supabase/vuelta-atras/20261120T0100_w02_secreto_despacho_relevo.down.sql
-- Vuelta atrás de 20261120T0100: catcher_dispatch_secret vuelve a ser el de
-- antes (el _anterior) y el _anterior se borra. Solo vale ANTES de la 0200.
do $$
declare
  v_id  uuid;
  v_ant text;
begin
  select decrypted_secret into v_ant from vault.decrypted_secrets where name = 'catcher_dispatch_secret_anterior';
  if coalesce(v_ant, '') = '' then
    raise exception 'W02: no hay catcher_dispatch_secret_anterior: o no se aplicó la 0100 o ya pasó la 0200; no hay a qué volver';
  end if;
  select id into v_id from vault.secrets where name = 'catcher_dispatch_secret';
  perform vault.update_secret(v_id, v_ant);
  delete from vault.secrets where name = 'catcher_dispatch_secret_anterior';
end $$;
