-- scripts/conta/produccion/cuentas/gb-pestana-suelto.sql
--
-- GB · nº 17, B · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. Las dos funciones: false / false → true / true.
--   2. Los trabajos sueltos y lo hecho desde la pestaña NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_sueltos / _suelto_poner' clave,
    concat_ws(' / ', (to_regprocedure('public.conta_bitrix_pestana_sueltos(text,text,text,text,uuid)') is not null)::text,
      (to_regprocedure('public.conta_bitrix_pestana_suelto_poner(text,text,text,text,uuid,uuid,text,numeric)') is not null)::text) valor union all
  select 2, 'Líneas «suelto» / cambios desde la pestaña (con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_linea where tipo = 'suelto' and created_at < timestamptz '2026-11-10 09:00:00+00'),
                     (select count(*) from public.conta_bitrix_pestana_cambio where hecho_at < timestamptz '2026-11-10 09:00:00+00'))
) q order by o;
