-- scripts/conta/produccion/cuentas/gb-bitrix-choques.sql
--
-- GB · nº 13, punto 2 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La
-- misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función: false → true; el tipo nuevo en el CHECK: false → true.
--   2. Las diferencias por tipo NO cambian (la migración no toca filas).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_choque / bitrix_cambiado en el CHECK' clave,
    concat_ws(' / ', (to_regprocedure('public.conta_bitrix_pestana_choque(uuid,uuid,jsonb,text[])') is not null)::text,
      (select pg_get_constraintdef(oid) like '%bitrix_cambiado%' from pg_constraint where conname = 'conta_gestoria_diferencia_tipo_check')::text) valor union all
  select 2, 'Diferencias vigentes / todas (con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_gestoria_diferencia where vigente and created_at < timestamptz '2026-11-10 00:00:00+00'),
                     (select count(*) from public.conta_gestoria_diferencia where created_at < timestamptz '2026-11-10 00:00:00+00'))
) q order by o;
