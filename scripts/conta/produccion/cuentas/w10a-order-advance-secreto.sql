-- scripts/conta/produccion/cuentas/w10a-order-advance-secreto.sql
--
-- W10a · LO QUE CUENTA LA TANDA (1630), antes y después. SOLO LEE, y solo el
-- catálogo (pg_proc) y el Vault por su huella corta: nada crece solo y ningún
-- valor sale. Antes: la función lleva el secreto escrito y no lee el Vault.
-- Tras la 1630: al revés. Tras la vuelta atrás: como antes, misma huella.
select clave, valor from (
  select 1 o, 'trg_sale_push_status: huella' clave,
    left(md5(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure)), 12) valor union all
  select 2, 'trg_sale_push_status: secreto escrito en el cuerpo',
    (pg_get_functiondef('public.trg_sale_push_status()'::regprocedure) ~ '''x-order-advance-secret'',\s*''[^'']+''')::text union all
  select 3, 'trg_sale_push_status: lee order_advance_secret del Vault',
    (pg_get_functiondef('public.trg_sale_push_status()'::regprocedure) ~ 'name = ''order_advance_secret''')::text union all
  select 4, 'order_advance_secret en el Vault (huella corta)',
    -- quieta: el Vault solo lo cambia una persona a mano (Julio, en el panel); ningún proceso escribe ahí durante el ensayo.
    coalesce((select left(md5(decrypted_secret), 12) from vault.decrypted_secrets where name = 'order_advance_secret'), 'no existe')
) t order by o;
