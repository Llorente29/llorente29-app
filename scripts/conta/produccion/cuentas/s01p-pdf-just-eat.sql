-- scripts/conta/produccion/cuentas/s01p-pdf-just-eat.sql
--
-- S01p·20 · 1b · LO QUE CUENTA LA TANDA (1706), antes y después. SOLO LEE, y solo el catálogo:
-- nada crece solo. La tanda no toca ningún dato (los PDF los pone el botón, después de fusionar).
-- quieta: solo añade dos funciones; no hay filas que cuenten.
select clave, valor from (
  select 1 o, 'conta_factura_papel_del_correo existe (antes 0, después 1)' clave,
    (to_regprocedure('public.conta_factura_papel_del_correo(uuid,text)') is not null)::int::text valor
  union all
  select 2, 'conta_correo_papeles_que_faltan existe (antes 0, después 1)',
    (to_regprocedure('public.conta_correo_papeles_que_faltan(uuid)') is not null)::int::text
) t order by o;
