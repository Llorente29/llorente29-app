-- scripts/conta/produccion/cuentas/k14e-tpv-codigos-cegid.sql
--
-- K14e · Los códigos de Cegid de los 5 clientes de tarjeta · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0119 ata 5 fichas a su código de Cegid (conta_cobro_cliente, con su apunte en conta_cegid_atado) y pone ese código
-- en sus 5 pagos con tarjeta. Se mide en esas 5 fichas: cuántas tienen código (0 → 5) y lo apuntado por la K14e
-- (0 → 5); y en los pagos con tarjeta, cuántos llevan código (6 → 11). Todas las cuentas juntas, y por cuenta (regla 9).
select clave, valor from (
  select 0 o, null::uuid account_id, 'las 5 fichas de la tanda · con código de Cegid' clave,
         -- quieta: solo esas 5 fichas, que solo ata esta tanda (se atan a mano en «Facturas del mes», y no las tiene nadie)
         count(*)::text valor
    from public.conta_cobro_cliente c where c.company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and c.codigo_cliente is not null
     and c.party_id in ('f8938378-aad9-4ba8-8806-583ab50fb640','2af272da-8092-4673-9013-dec95c119145','6d206f9f-25d3-4da3-84bc-db5dcd677d29','75f926e5-6949-443e-8f35-51abbd9f86dd','f7ffc4c8-0152-428e-97b0-adc84ddded75')
  union all
  select 0, null, 'las 5 fichas de la tanda · atadas por la K14e',
         -- quieta: solo lo que apunta esta tanda, con su nombre
         count(*)::text from public.conta_cegid_atado a where a.quien = 'K14e · alta en Cegid del 27/11'
  union all
  select 0, null, 'todas las cuentas · pagos con tarjeta: filas · con código de Cegid',
         -- quieta: solo la escriben las migraciones K14c, K14d y K14e
         count(*) || ' · ' || count(t.cegid_codigo) from public.conta_banco_cobro_tarjeta t
  union all
  select 1, t.account_id, 'cuenta ' || t.account_id || ' · pagos con tarjeta con código de Cegid',
         -- quieta: solo la escriben las migraciones K14c, K14d y K14e
         count(t.cegid_codigo)::text from public.conta_banco_cobro_tarjeta t group by t.account_id
) t order by o, account_id, clave;
