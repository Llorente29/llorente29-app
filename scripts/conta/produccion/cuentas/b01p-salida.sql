-- scripts/conta/produccion/cuentas/b01p-salida.sql
--
-- B01 Revolut · PR 2b (01/11) · LO QUE CUENTA LA TANDA DE LA SALIDA AL BANCO,
-- antes y después. SOLO LEE. Lo de las remesas es de Foodint (regla 9), con un
-- corte fijo; las funciones y el CHECK, de la base entera, y se dice.
-- Lo que tiene que cambiar: el CHECK del tipo admite «banco» (no → sí) y las
-- funciones de la salida (0 → 4). Lo demás, igual: ninguna remesa de Foodint
-- cambia (la tanda no manda nada), nadie puede pagar todavía y la vista de las
-- remesas da los mismos estados.
select clave, valor from (
  select 1 o, 'el tipo de remesa admite «banco» (base entera)' clave,
    (select case when pg_get_constraintdef(oid) like '%banco%' then 'sí' else 'no' end from pg_constraint where conname = 'conta_pago_remesa_kind_check') valor union all
  select 2, 'funciones de la salida al banco (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('conta_pago_mandar_empezar', 'conta_pago_banco_dice', 'conta_pago_por_saber', 'conta_pago_activar'))::text union all
  select 3, 'remesas de pagos de Foodint por estado, hasta el corte',
    -- quieta: la tanda no crea ni cambia remesas
    (select coalesce(string_agg(estado || ' ' || n, ', ' order by estado), 'ninguna') from (
       select estado, count(*) n from public.conta_pago_remesa_estado
        where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-01 16:40:00+00' group by estado) x) union all
  select 4, 'personas que pueden pagar en Foodint',
    -- quieta: el permiso solo lo da «Activar pagos», desde la pantalla
    (select count(*)::text from public.conta_pago_permiso where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and revoked_at is null)
) t order by o;
