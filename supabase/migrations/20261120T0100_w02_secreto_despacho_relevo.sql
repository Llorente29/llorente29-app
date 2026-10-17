-- W02 · El secreto del despacho, nuevo, sin cortar el despacho (Julio, 17/10).
--
-- QUÉ HACE, en una transacción:
--   1. guarda el secreto de ahora como catcher_dispatch_secret_anterior;
--   2. pone en catcher_dispatch_secret uno nuevo, de 32 bytes al azar,
--      generado AQUÍ DENTRO: no está en este fichero ni sale por ningún sitio.
--
-- POR QUÉ NO SE CORTA. Los dos lados leen Vault en cada pedido: el disparador
-- tg_auto_dispatch (de vault.decrypted_secrets) y catcher-dispatch (con
-- internal_secret). Al confirmar, el siguiente pedido ya va con el nuevo. El
-- único que podría fallar es uno cuyo disparador leyó el de antes y cuya
-- llamada (pg_net la manda al confirmar) llega después: ése lo acepta
-- catcher-dispatch mientras exista el _anterior. Por eso esta función tiene
-- que estar DESPLEGADA con el relevo antes de aplicar esto (va en el mismo PR:
-- se fusiona, se comprueba lo desplegado, y luego la tanda).
--
-- DESPUÉS: 20261120T0200 borra el _anterior, en otra tanda, cuando los logs de
-- catcher-dispatch digan que nadie lo ha usado (CATCHER_DISPATCH_SECRETO_ANTERIOR).
--
-- Vuelta atrás: supabase/vuelta-atras/20261120T0100_w02_secreto_despacho_relevo.down.sql
-- (vuelve a poner el de antes y borra el _anterior). Solo vale antes de la 0200.
--
-- El valor de antes que estaba escrito en las migraciones de junio y julio ya
-- no valía (otro valor en Vault, medido por su huella el 17/10): esto no tapa
-- una fuga, renueva el secreto por higiene al pasar el repositorio a privado.

do $$
declare
  v_id     uuid;
  v_actual text;
begin
  select id, decrypted_secret into v_id, v_actual
    from vault.decrypted_secrets where name = 'catcher_dispatch_secret';
  if v_id is null or coalesce(v_actual, '') = '' then
    raise exception 'W02: no hay catcher_dispatch_secret en Vault: no se cambia nada';
  end if;
  if exists (select 1 from vault.secrets where name = 'catcher_dispatch_secret_anterior') then
    raise exception 'W02: ya hay un catcher_dispatch_secret_anterior (un relevo a medias): ciérralo con la 0200 o la vuelta atrás antes de otro';
  end if;

  perform vault.create_secret(v_actual, 'catcher_dispatch_secret_anterior',
    'W02: el secreto del despacho de antes, aceptado por catcher-dispatch mientras dura el relevo. Lo borra 20261120T0200.');
  perform vault.update_secret(v_id, encode(extensions.gen_random_bytes(32), 'hex'));
end $$;

-- Lo que ha pasado, sin valores: los dos existen y son distintos.
select (select count(*) from vault.secrets where name in ('catcher_dispatch_secret', 'catcher_dispatch_secret_anterior')) as secretos_del_relevo,
       (select decrypted_secret from vault.decrypted_secrets where name = 'catcher_dispatch_secret')
         is distinct from
       (select decrypted_secret from vault.decrypted_secrets where name = 'catcher_dispatch_secret_anterior') as el_nuevo_es_otro;
