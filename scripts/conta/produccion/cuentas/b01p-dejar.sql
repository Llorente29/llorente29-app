-- scripts/conta/produccion/cuentas/b01p-dejar.sql
--
-- B01 Revolut · PR 2c-1 (01/11) · LO QUE CUENTA LA TANDA DE «DEJAR DE PAGAR»,
-- antes y después. SOLO LEE. Lo de las conexiones y los permisos es de Foodint
-- (regla 9); la columna y la función, de la base entera, y se dice.
-- Lo que tiene que cambiar: revolut_conexion tiene oauth_para (no → sí) y
-- existe conta_pago_dejar (0 → 1). Lo demás, igual: la tanda no deja de pagar
-- a nadie ni cambia ninguna conexión.
select clave, valor from (
  select 1 o, 'revolut_conexion tiene oauth_para (base entera)' clave,
    (select case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'revolut_conexion' and column_name = 'oauth_para') then 'sí' else 'no' end) valor union all
  select 2, 'funciones de dejar de pagar (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'conta_pago_dejar')::text union all
  select 3, 'conexiones de Revolut de Foodint por estado y permisos',
    -- quieta: la tanda no cambia ninguna conexión
    (select coalesce(string_agg(estado || ' ' || coalesce(permisos, '—') || ' ' || n, ', ' order by estado, permisos), 'ninguna') from (
       select estado, permisos, count(*) n from public.revolut_conexion where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by estado, permisos) x) union all
  select 4, 'personas que pueden pagar en Foodint',
    -- quieta: la tanda no quita ni da permisos
    (select count(*)::text from public.conta_pago_permiso where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and revoked_at is null) union all
  select 5, 'lotes de pago de Foodint por estado',
    -- quieta: la tanda no cancela nada
    (select coalesce(string_agg(estado || ' ' || n, ', ' order by estado), 'ninguno') from (
       select estado, count(*) n from public.conta_pago_lote where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by estado) x)
) t order by o;
