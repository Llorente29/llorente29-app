-- scripts/conta/produccion/cuentas/w02-secreto-despacho.sql
--
-- W02 · LO QUE CUENTA LA TANDA DEL RELEVO DEL SECRETO DEL DESPACHO
-- (20261120T0100), antes y después. Lo declara el manifiesto («cuenta: <este
-- fichero>») y lo comparan deshacer.sh y el ensayo de la vuelta atrás: tras
-- deshacer, todo tiene que salir como antes. SOLO LEE.
--
-- Sin valores: qué secretos del despacho hay en Vault y la huella corta (los
-- 12 primeros del md5) de cada uno. Antes: solo catcher_dispatch_secret. Tras
-- la 0100: los dos, con huellas distintas, y la del _anterior igual a la de
-- antes. Tras la vuelta atrás: como antes.
select clave, valor from (
  select 1 o, 'secretos del despacho en Vault' clave,
         (select coalesce(string_agg(name, ' · ' order by name), 'ninguno') from vault.secrets
           where name in ('catcher_dispatch_secret', 'catcher_dispatch_secret_anterior')) valor
  union all
  select 2, 'huella corta de catcher_dispatch_secret',
         coalesce((select left(md5(decrypted_secret), 12) from vault.decrypted_secrets where name = 'catcher_dispatch_secret'), 'no existe')
  union all
  select 3, 'huella corta de catcher_dispatch_secret_anterior',
         coalesce((select left(md5(decrypted_secret), 12) from vault.decrypted_secrets where name = 'catcher_dispatch_secret_anterior'), 'no existe')
) x order by o;
