-- scripts/conta/produccion/cuentas/gb-pestana-dia-dni.sql
--
-- GB · nº 17, D · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función de la pestaña llama a las de Code 1: false → true (y su md5 cambia).
--   2. Las líneas con día y lo hecho desde la pestaña NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_hacer llama a conta_gestoria_alta_trabajador' clave,
    (select (position('conta_gestoria_alta_trabajador' in prosrc) > 0)::text from pg_proc
      where oid = to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)')) valor union all
  select 2, 'Líneas con día de alta o baja / cambios desde la pestaña (tabla entera, todas las cuentas, con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_linea where (alta_el is not null or baja_el is not null) and created_at < timestamptz '2026-11-10 12:00:00+00'),
                     (select count(*) from public.conta_bitrix_pestana_cambio where hecho_at < timestamptz '2026-11-10 12:00:00+00'))
) q order by o;
