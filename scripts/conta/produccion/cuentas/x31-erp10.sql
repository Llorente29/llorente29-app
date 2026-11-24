-- scripts/conta/produccion/cuentas/x31-erp10.sql
--
-- X31 · 2 · Antes de enviar a ERP10, mirar (0835) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y solo columnas que
-- existen antes de la tanda. Por cuenta (regla 9). Corte fijo (W06): lo creado antes del 24/11/2026 a las 09:00 de Madrid.
--   1. Regla 31: los envíos a ERP10 de cada cuenta (cuántos · por estado · huella de su asiento, su estado y su número de
--      ERP10). La tanda no cambia ninguno (solo añade columnas y un estado nuevo).
--   0. Y la tabla entera, etiquetada como tal (regla 9): da su fila aunque no haya ningún envío (staging no tiene: las
--      e2e del X10 los llevan en memoria), para que el antes y el después siempre se puedan comparar.
select clave, valor from (
  select 0 o, 'tabla entera · envíos a ERP10 (cuántos · huella)' clave,
         count(*) || ' · ' || coalesce(md5(string_agg(concat_ws('|', v.id, v.entry_id, v.clase, v.estado, v.erp10_serie, v.erp10_documento, v.enlazada, v.lote_id), ',' order by v.id)), 'ninguno') valor
    from public.conta_erp10_envio v
   where v.creado_en < timestamptz '2026-11-24 09:00:00+01'
  union all
  select 1 o, 'cuenta ' || v.account_id || ' · envíos a ERP10 (cuántos · en ERP10 · no pudo · huella)' clave,
         count(*) || ' · ' || count(*) filter (where v.estado = 'en_erp10') || ' · ' || count(*) filter (where v.estado = 'no_pudo') || ' · '
         || md5(string_agg(concat_ws('|', v.id, v.entry_id, v.clase, v.estado, v.erp10_serie, v.erp10_documento, v.enlazada, v.lote_id), ',' order by v.id)) valor
    from public.conta_erp10_envio v
   where v.creado_en < timestamptz '2026-11-24 09:00:00+01'
   group by v.account_id
) t order by o, clave;
