-- scripts/conta/produccion/cuentas/g01c-crm-y-contactos.sql
--
-- G01c · La clave neutra y los contactos del CRM · LO QUE CUENTA LA TANDA,
-- antes y después. SOLO LEE. La misma vara a los dos lados (regla 31): lee
-- conta_crm_bitrix, que es la tabla antes y la vista después, y cuenta por
-- bitrix_id, que la tanda no quita. Medido antes el 07/11. Lo que tiene que
-- pasar con la tanda (y volver con su vuelta atrás):
--   1. Conexiones con Bitrix24 (todas las cuentas a propósito): 1 → 1.
--   2. Fichas de Bitrix24 con su id, de antes del 07/11 19:00 UTC: 1.437 → 1.437.
--   3. Clientes con ficha de Bitrix24, de antes del 07/11 19:00 UTC: 1.419 → 1.419.
--   4. Diferencias con ficha de Bitrix24, de antes del 07/11 19:00 UTC: las mismas.
--   5. Clientes con identificador fiscal extranjero: 0 → 0 (la tanda no lee: lo hace la próxima lectura).
select clave, valor from (
  select 1 o, 'Conexiones con Bitrix24 (todas las cuentas)' clave,
    (select count(*)::text from public.conta_crm_bitrix) valor union all
  select 2, 'Fichas de Bitrix24 con su id (todas las cuentas, antes del 07/11 19:00 UTC)',
    (select count(*)::text from public.conta_gestoria_ficha where bitrix_id is not null and created_at < timestamptz '2026-11-07 19:00+00') union all
  select 3, 'Clientes con ficha de Bitrix24 (todas las cuentas, antes del 07/11 19:00 UTC)',
    (select count(*)::text from public.conta_gestoria_cliente where bitrix_id is not null and created_at < timestamptz '2026-11-07 19:00+00') union all
  select 4, 'Diferencias con ficha de Bitrix24 (todas las cuentas, antes del 07/11 19:00 UTC)',
    -- quieta: las diferencias de antes de las 19:00 no las cambia nadie más que una lectura, que no corre en el ensayo
    (select count(*)::text from public.conta_gestoria_diferencia d join public.conta_gestoria_lectura l on l.id = d.lectura_id
      where d.bitrix_id is not null and l.empezada_at < timestamptz '2026-11-07 19:00+00') union all
  select 5, 'Clientes con identificador fiscal extranjero (todas las cuentas)',
    -- quieta: solo lo escribe conta_crm_guardar_clientes, que trae esta tanda y nadie llama en el ensayo
    (select count(*)::text from public.customer_fiscal where tax_id_type = 'foreign')
) q order by o;
