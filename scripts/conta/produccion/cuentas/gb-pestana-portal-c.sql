-- scripts/conta/produccion/cuentas/gb-pestana-portal-c.sql
--
-- GB · nº 17, C · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función: false → true.
--   2. Los mensajes y los accesos del portal NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_mensajes' clave,
    (to_regprocedure('public.conta_bitrix_pestana_mensajes(text,text,text,text)') is not null)::text valor union all
  select 2, 'Mensajes del portal / accesos al portal (con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_portal_mensaje where created_at < timestamptz '2026-11-10 10:00:00+00'),
                     (select count(*) from public.conta_portal_acceso where invitado_at < timestamptz '2026-11-10 10:00:00+00'))
) q order by o;
