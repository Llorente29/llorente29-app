-- scripts/conta/produccion/cuentas/g01c-crm-neutro-a.sql
--
-- G01c · PR A de la clave neutra · LO QUE CUENTA LA TANDA, antes y después.
-- SOLO LEE. La misma vara a los dos lados (regla 31). Lo que tiene que pasar
-- con la tanda (y volver con su vuelta atrás):
--   1. Funciones neutras de la conexión con el CRM: 0 → 2.
--   2. Lecturas de Bitrix24 de antes del 07/11 23:00 UTC (todas las cuentas): las mismas.
--   3. Diferencias vigentes de los tipos de antes, de lecturas de antes del 07/11 23:00 UTC: las mismas (la tanda no las migra; lo hace el PR B).
select clave, valor from (
  select 1 o, 'Funciones neutras de la conexión con el CRM' clave,
    (select count(*)::text from pg_catalog.pg_proc p where p.oid in (to_regprocedure('public.conta_crm_secreto(uuid,text)'),
       to_regprocedure('public.conta_crm_guardar_conexion(uuid,text,text,text,text,text)'))) valor union all
  select 2, 'Lecturas de Bitrix24 (todas las cuentas, antes del 07/11 23:00 UTC)',
    (select count(*)::text from public.conta_gestoria_lectura where origen = 'bitrix' and empezada_at < timestamptz '2026-11-07 23:00+00') union all
  select 3, 'Diferencias de los tipos de antes (todas las cuentas, de lecturas de antes del 07/11 23:00 UTC)',
    -- quieta: solo las cambia una lectura (que no corre en el ensayo) o el PR B
    (select count(*)::text from public.conta_gestoria_diferencia d join public.conta_gestoria_lectura l on l.id = d.lectura_id
      where d.tipo in ('bitrix_sin_cobro', 'nif_repetido_en_bitrix', 'correo_repetido_en_bitrix') and l.empezada_at < timestamptz '2026-11-07 23:00+00')
) q order by o;
