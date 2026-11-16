-- scripts/conta/produccion/cuentas/e01-entrada-sumied.sql
--
-- E01 · LO QUE CUENTA LA TANDA DE @entrada.sumied.com (1840 y 1850), antes y
-- después. SOLO LEE. Recuentos por cuenta (regla 9); ninguna dirección ni nombre.
-- Lo que tiene que cambiar: las de Piri Piri en entrada.sumied.com, 0 → 3
-- (encendidas); las de Piri Piri en entrada.folvy.app siguen 3 y encendidas;
-- Foodint, 2 en entrada.folvy.app y 0 fuera, antes y después; el total, 5 → 8.
-- Y las huellas de las seis funciones que cambian en caliente.
-- Medido en producción (solo lectura) el 16/11, antes: 3 / 0 / 2 / 0 / 5 / 381.
select clave, valor from (
  select 1 o, 'Piri Piri · encendidas en entrada.folvy.app' clave,
    (select count(*) from public.company_inbound_address where account_id = 'a175c0b8-2eaf-4285-9688-53042910a86e' and domain = 'entrada.folvy.app' and active)::text valor union all
  select 2, 'Piri Piri · encendidas en entrada.sumied.com',
    (select count(*) from public.company_inbound_address where account_id = 'a175c0b8-2eaf-4285-9688-53042910a86e' and domain = 'entrada.sumied.com' and active)::text union all
  select 3, 'Foodint · en entrada.folvy.app',
    (select count(*) from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and domain = 'entrada.folvy.app')::text union all
  select 4, 'Foodint · fuera de entrada.folvy.app',
    (select count(*) from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and domain <> 'entrada.folvy.app')::text union all
  select 5, 'direcciones (todas las cuentas)', (select count(*) from public.company_inbound_address)::text union all
  select 6, 'correos en el registro de entrada (todas las cuentas)', (select count(*) from public.inbound_email_log)::text union all
  select 7, 'huellas: entrada_correo · direccion_entrada · direccion_facturas · correo_facturas · puerta · documentos_recibidos',
    (select string_agg(left(md5(pg_get_functiondef(p.oid)), 8), ' · ' order by array_position(array['conta_entrada_correo','conta_direccion_entrada','conta_direccion_facturas','conta_correo_facturas','conta_puerta','conta_documentos_recibidos']::name[], p.proname))
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('conta_entrada_correo','conta_direccion_entrada','conta_direccion_facturas','conta_correo_facturas','conta_puerta','conta_documentos_recibidos'))
) t order by o;
