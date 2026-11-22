-- scripts/conta/produccion/cuentas/x27c-ficha-fiel.sql
--
-- X27c · La ficha fiel a ERP10 (1920 y 1921) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE, y solo columnas que
-- existen antes de la tanda. La 1920 solo añade; la 1921 solo actúa al dar de alta un proveedor. Se mide, por cuenta
-- (regla 9), que los proveedores que ya existían no cambian, y EL RECUENTO del punto 5 de la respuesta X27 · 1 (lo ya
-- guardado no se toca en este encargo): cuántos tienen el domicilio sin partir (con domicilio y sin población) y
-- cuántos tienen código postal y la provincia vacía.
-- Corte fijo: lo creado y cambiado antes del 22/11/2026 a las 00:00 de Madrid.
select clave, valor from (
  select 1 o, 'cuenta ' || s.account_id || ' · proveedores (cuántos · huella del domicilio)' clave,
         count(*) || ' · ' || md5(string_agg(concat_ws('|', s.id, s.fiscal_street, s.fiscal_postal_code, s.fiscal_city, s.fiscal_province, s.website), ',' order by s.id)) valor
    from public.supplier s
   where s.created_at < timestamptz '2026-11-22 00:00:00+01' and s.updated_at < timestamptz '2026-11-22 00:00:00+01'
   group by s.account_id
  union all
  select 2, 'cuenta ' || s.account_id || ' · domicilio sin partir (con domicilio y sin población) · con código postal y sin provincia',
         count(*) filter (where nullif(btrim(s.fiscal_street), '') is not null and nullif(btrim(s.fiscal_city), '') is null) || ' · ' ||
         count(*) filter (where nullif(btrim(s.fiscal_postal_code), '') is not null and nullif(btrim(s.fiscal_province), '') is null)
    from public.supplier s
   where s.created_at < timestamptz '2026-11-22 00:00:00+01' and s.archived_at is null
   group by s.account_id
) t order by o, clave;
