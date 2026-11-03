-- scripts/conta/produccion/cuentas/a01-techo-un-solo-aviso.sql
--
-- A01 · techo (03/11) · LO QUE CUENTA LA TANDA (0012), antes y después. SOLO
-- LEE, y solo el catálogo de la base: la huella de _aviso_poner_en_cola (antes
-- 5364a265, la del #450; después otra; deshecha, 5364a265) y si su texto toma
-- el candado (antes false, después true).
select clave, valor from (
  select 1 o, 'huella de _aviso_poner_en_cola (antes 5364a265)' clave,
    left(md5(pg_get_functiondef('public._aviso_poner_en_cola(text,text,text,text,uuid,uuid,uuid,text,integer)'::regprocedure)), 8) valor union all
  select 2, 'toma el candado del techo (antes false, después true)',
    (pg_get_functiondef('public._aviso_poner_en_cola(text,text,text,text,uuid,uuid,uuid,text,integer)'::regprocedure) like '%pg_advisory_xact_lock(4101, 1)%')::text
) t order by o;
