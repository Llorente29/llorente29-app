-- scripts/conta/produccion/cuentas/b01rv-revolut.sql
--
-- B01 Revolut · PR 1 (31/10) · LO QUE CUENTA LA TANDA DE «CONECTAR Y LEER»,
-- antes y después. SOLO LEE. Lo de Bancos es de Foodint (regla 9), con un
-- corte fijo; lo de la tabla nueva y el cron es de la base entera, y se dice.
-- La tabla nueva solo se nombra dentro de cadenas.
-- Lo que tiene que cambiar: la tabla de la conexión (0 → 1 de 1), sus seis
-- funciones (0 → 6), el cron conta-revolut-despertar (0 → 1) y el proveedor
-- «revolut» en el CHECK de bank_aggregator_link (no → sí) y la huella de
-- bank_importar (09859e42 → la nueva). Lo demás, igual:
-- las cuentas conectadas de Foodint (las 3 de BBVA) y sus movimientos.
select clave, valor from (
  select 1 o, 'tabla de la conexión con Revolut (base entera)' clave,
    (select count(*) from unnest(array['revolut_conexion']) t where to_regclass('public.' || t) is not null) || ' de 1' valor union all
  select 2, 'funciones de Revolut (base entera)',
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
      and proname in ('_revolut_nombre_secreto', 'conta_revolut_secreto_poner', 'conta_revolut_secreto', '_revolut_secretos_quitar', 'conta_revolut_desconectar', 'conta_revolut_despertar'))::text union all
  select 3, 'cron conta-revolut-despertar', (select count(*) from cron.job where jobname = 'conta-revolut-despertar')::text union all
  select 4, 'el CHECK del proveedor admite revolut',
    (select case when pg_get_constraintdef(oid) like '%revolut%' then 'sí' else 'no' end from pg_constraint where conname = 'bank_aggregator_link_provider_check') union all
  select 7, 'huella de bank_importar',
    (select left(md5(prosrc), 8) from pg_proc where oid = 'public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)'::regprocedure) union all
  select 5, 'cuentas conectadas de Foodint (por proveedor)',
    -- quieta: la tanda no conecta nada; Revolut se conecta después, desde la pantalla
    (select coalesce(string_agg(provider || ' ' || n, ', ' order by provider), 'ninguna') from (
       select provider, count(*) n from public.bank_aggregator_link where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by provider) x) union all
  select 6, 'movimientos de banco de Foodint hasta el corte',
    -- quieta: la tanda no mete ni quita movimientos
    (select count(*) from public.bank_movement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-31 22:00:00+00')::text
) t order by o;
