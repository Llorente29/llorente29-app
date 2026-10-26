-- scripts/conta/produccion/cuentas/w06-compara-prueba.sql
--
-- W06 (26/10) · La cuenta de la TANDA DE PRUEBA de staging
-- (supabase/staging/compara-prueba/aplicar.txt). No la usa ninguna tanda de
-- producción: vive aquí porque manifiesto.sh solo acepta cuentas de esta
-- carpeta. SOLO LEE.
--
-- Las dos miran objetos que crea la propia prueba (dentro de su transacción):
-- nadie más los escribe, así que no crecen solos.
select clave, valor from (
  select 1 o, 'filas de w06_base' clave,
    case when to_regclass('public.w06_base') is null then 'sin tabla'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.w06_base', false, true, '')))[1]::text end valor union all
  select 2, 'almacén w06-prueba', (select count(*) from storage.buckets where id = 'w06-prueba')::text
) x order by o;
