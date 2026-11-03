-- scripts/conta/produccion/cuentas/b01q-lecturas.sql
--
-- B01 · Cola 1b (02/11) · LO QUE CUENTA LA TANDA DEL REGISTRO DE LAS LECTURAS
-- DEL BANCO, antes y después. SOLO LEE. La tabla y la función, de la base
-- entera, y se dice; lo de Foodint (regla 9), con un corte fijo.
-- Lo que tiene que cambiar: la tabla y la función nuevas (0 → 1 y 0 → 1). Lo
-- demás, igual: la tanda no importa movimientos ni crea extractos.
select clave, valor from (
  select 1 o, 'bank_aggregator_lectura (base entera)' clave, (to_regclass('public.bank_aggregator_lectura') is not null)::int::text valor union all
  select 2, 'bank_agregador_lectura_apuntar (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'bank_agregador_lectura_apuntar')::text union all
  select 3, 'movimientos del banco de Foodint, hasta el corte',
    -- quieta: la tanda no importa nada
    (select count(*)::text from public.bank_movement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-02 11:15:00+00') union all
  select 4, 'extractos de Foodint, hasta el corte',
    -- quieta: la tanda no crea extractos
    (select count(*)::text from public.bank_statement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and imported_at < timestamptz '2026-11-02 11:15:00+00')
) t order by o;
