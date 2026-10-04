-- scripts/conta/c01b_antes_despues.sql
--
-- C01b · ANTES = DESPUÉS del movimiento de datos (20261006T0110_c01b_datos.sql).
-- SOLO LEE. La misma consulta en staging (prueba) y en producción (después del
-- real, en solo lectura). Por cuenta: cuántos emails, teléfonos, direcciones e
-- IVA había en las columnas viejas, cuántos están en su sitio nuevo y cuántos
-- FALTAN. «En verde» = la columna «faltan» a cero en todas las filas.
-- Mientras no se aplique la eliminación, las columnas viejas existen.

with s as (
  select s.*, a.name as cuenta from public.supplier s join public.accounts a on a.id = s.account_id
), m as (
  select cuenta, account_id, 'email' as dato,
         count(*) filter (where nullif(btrim(email), '') is not null) as viejos,
         count(*) filter (where nullif(btrim(email), '') is not null and exists (
           select 1 from public.supplier_contact c where c.supplier_id = s.id and lower(btrim(c.email)) = lower(btrim(s.email)))) as en_su_sitio
    from s group by cuenta, account_id
  union all
  select cuenta, account_id, 'phone',
         count(*) filter (where nullif(btrim(phone), '') is not null),
         count(*) filter (where nullif(btrim(phone), '') is not null and exists (
           select 1 from public.supplier_contact c where c.supplier_id = s.id and btrim(c.phone) = btrim(s.phone)))
    from s group by cuenta, account_id
  union all
  select cuenta, account_id, 'address',
         count(*) filter (where nullif(btrim(address), '') is not null),
         count(*) filter (where nullif(btrim(address), '') is not null and (
           exists (select 1 from public.supplier_proposal p where p.supplier_id = s.id and p.field = 'fiscal_address'
                     and btrim(coalesce(p.value->>'line', '')) = btrim(s.address))
           or exists (select 1 from public.c01b_movimiento_registro r where r.supplier_id = s.id and r.campo = 'address'
                        and r.destino = 'ya_en_ficha' and r.valor = btrim(s.address))))
    from s group by cuenta, account_id
  union all
  select s.cuenta, s.account_id, 'usual_vat_rates', count(*),
         count(*) filter (where exists (select 1 from public.tax_rate t where t.id = any(s.usual_tax_rate_ids) and t.rate = x.pct))
    from s cross join lateral unnest(s.usual_vat_rates) x(pct)
   group by s.cuenta, s.account_id
)
select cuenta, account_id, dato, viejos, en_su_sitio, viejos - en_su_sitio as faltan
  from m
 order by cuenta, dato;
