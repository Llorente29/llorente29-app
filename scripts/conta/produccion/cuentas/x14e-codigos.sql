-- scripts/conta/produccion/cuentas/x14e-codigos.sql
--
-- X14 · 2 · El código de cada cliente al traer (conta_cobro_cliente.codigo_cliente) · LO QUE CUENTA LA TANDA, antes y
-- después. SOLO LEE, y solo columnas que existen antes de la tanda. SOLO NÚMEROS Y HUELLAS: ni nombres ni NIF (T11). La
-- tanda no cambia ningún dato (solo dos funciones). Corte fijo (W06): lo que no ha cambiado desde el 25/11/2026 a las 14:30
-- de Madrid (conta_cobro_cliente no tiene created_at; su updated_at es lo más quieto que hay).
--   1. Regla 31, por cuenta (regla 9): sus clientes del cobro (cuántos · con código · huella de empresa, cliente y código).
--   0. Y la tabla entera, etiquetada como tal (regla 9).
select clave, valor from (
  select 0 o, 'tabla entera · clientes del cobro (cuántos · con código · huella)' clave,
         count(*) || ' · ' || count(codigo_cliente) || ' · ' || coalesce(md5(string_agg(concat_ws('|', company_id, party_id, codigo_cliente), ',' order by company_id, party_id)), 'ninguno') valor
    from public.conta_cobro_cliente where updated_at < timestamptz '2026-11-25 14:30:00+01'
  union all
  select 1, 'cuenta ' || account_id || ' · clientes del cobro (cuántos · con código · huella)',
         count(*) || ' · ' || count(codigo_cliente) || ' · ' || md5(string_agg(concat_ws('|', company_id, party_id, codigo_cliente), ',' order by company_id, party_id))
    from public.conta_cobro_cliente where updated_at < timestamptz '2026-11-25 14:30:00+01'
   group by account_id
) t order by o, clave;
