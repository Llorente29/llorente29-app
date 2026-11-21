-- scripts/conta/produccion/cuentas/k10-cuenta-de-pago.sql
--
-- K10 · La 430 de una plataforma pasa a la ficha de su proveedor como «Cuenta de pago» · LO QUE CUENTA
-- LA TANDA, antes y después. SOLO LEE. Por cuenta (regla 9: account_id, sus 8 primeras cifras) y empresa:
--   · proveedores de una plataforma con su 430 (su contacto es plataforma y tiene su enlace 'customer'
--     «principal» a una 430 en esa empresa): los que la tanda mira;
--   · de ésos, cuántos tienen ya cuenta de pago en su ficha, y cuántos con esa misma 430;
--   · regla 31, la misma vara a los dos lados: las recibidas de esos proveedores (no anuladas ni
--     descartadas), que hasta hoy proponían la 430 de su plataforma; y cuántas de ellas propondrían esa
--     misma 430 con el K10 (porque su proveedor la tiene en la ficha). Antes: la segunda es 0 (o lo que
--     ya hubiera a mano); después, las dos iguales. Lo que falte es una que cambiaría de cuenta.
-- Escrito sin las funciones de la tanda, para que valga antes de aplicarla. Corte fijo: lo creado antes del
-- 22/11/2026 a las 00:00 de Madrid, en todo lo que la tanda no escribe; el enlace «pago» (lo que escribe la
-- tanda) va sin corte, a propósito: es lo que se mide antes y después.
with pl as (
  select distinct on (l.company_id, pr.supplier_id)
         l.account_id, l.company_id, pr.supplier_id, l.company_account_id as la430
    from public.party_role pf
    join public.party_role pr on pr.account_id = pf.account_id and pr.party_id = pf.party_id and pr.role = 'supplier' and pr.supplier_id is not null
    join public.company_account_link l on l.account_id = pf.account_id and l.entity = 'customer' and l.entity_id = pf.party_id::text and l.role = 'principal'
    join public.company_account a on a.id = l.company_account_id and a.account_id = l.account_id and a.code like '430%'
   where pf.role = 'platform'
     and pf.created_at < timestamptz '2026-11-22 00:00:00+01' and pr.created_at < timestamptz '2026-11-22 00:00:00+01' and l.created_at < timestamptz '2026-11-22 00:00:00+01'
   order by l.company_id, pr.supplier_id, l.created_at
), conficha as (
  select pl.*, k.company_account_id as depago
    from pl left join public.company_account_link k
      on k.account_id = pl.account_id and k.company_id = pl.company_id and k.entity = 'supplier' and k.entity_id = pl.supplier_id::text and k.role = 'pago'
), facturas as (
  select c.account_id, c.company_id, count(*) as recibidas, count(*) filter (where c.depago = c.la430) as la_misma
    from conficha c
    join public.supplier_invoice i on i.account_id = c.account_id and i.company_id = c.company_id and i.supplier_id = c.supplier_id
   where i.status not in ('anulada', 'descartada') and i.created_at < timestamptz '2026-11-22 00:00:00+01'
   group by c.account_id, c.company_id
), por as (
  select account_id, company_id, count(*) as proveedores,
         count(*) filter (where depago is not null) as con_pago,
         count(*) filter (where depago = la430) as con_su_430
    from conficha group by account_id, company_id
)
select clave, valor from (
  select p.account_id, p.company_id, 1 o,
         'cuenta ' || left(p.account_id::text, 8) || ' · empresa ' || left(p.company_id::text, 8) || ' · proveedores de una plataforma con su 430 · con cuenta de pago · con esa 430' clave,
         p.proveedores || ' · ' || p.con_pago || ' · ' || p.con_su_430 valor from por p
  union all
  select p.account_id, p.company_id, 2,
         'cuenta ' || left(p.account_id::text, 8) || ' · empresa ' || left(p.company_id::text, 8) || ' · regla 31: recibidas que proponían su 430 · que la proponen con el K10',
         coalesce(f.recibidas, 0) || ' · ' || coalesce(f.la_misma, 0)
    from por p left join facturas f on f.account_id = p.account_id and f.company_id = p.company_id
) t order by account_id, company_id, o;
