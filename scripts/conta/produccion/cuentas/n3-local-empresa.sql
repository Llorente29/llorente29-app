-- scripts/conta/produccion/cuentas/n3-local-empresa.sql
--
-- N3 (24/10) · LO QUE CUENTA LA TANDA DEL MAESTRO «LOCAL → EMPRESA», antes y
-- después. SOLO LEE. TABLA ENTERA, a propósito y dicho (regla 9): todas las
-- cuentas juntas, porque lo que se mide es el reparto entre cuentas.
--
-- Después del real: location_company con tantas filas como «locales de
-- cuentas con una sola empresa»; locales y empresas, como antes.
select clave, valor from (
  select 1 o, 'locales' clave, (select count(*) from public.locations)::text valor union all
  select 2, 'empresas', (select count(*) from public.company)::text union all
  select 3, 'cuentas con una sola empresa', (select count(*) from (select account_id from public.company group by 1 having count(*) = 1) x)::text union all
  select 4, 'cuentas con dos o más empresas', (select count(*) from (select account_id from public.company group by 1 having count(*) > 1) x)::text union all
  select 5, 'locales de cuentas con una sola empresa',
         (select count(*) from public.locations l where l.account_id in (select account_id from public.company group by 1 having count(*) = 1))::text
) t order by o;
