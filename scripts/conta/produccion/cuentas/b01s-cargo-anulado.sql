-- scripts/conta/produccion/cuentas/b01s-cargo-anulado.sql
--
-- B01·20 · El cargo que el banco anula (0055) · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La 0055 solo añade (dos columnas que admiten nulos y cinco funciones): no cambia ni un movimiento.
-- Se mide que todo sigue igual: los movimientos de Foodint por estado, y los apartados con su motivo.
select clave, valor from (
  -- corte: movimientos de Foodint creados antes del 07/11 a las 00:00
  select 1 o, 'Foodint: movimientos ' || s.estado clave,
    (select count(*)::text from public.bank_movement m
      where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and m.created_at < timestamptz '2026-11-07 00:00:00+01' and m.status = s.estado) valor
    from (values ('pendiente'), ('propuesto'), ('por_aclarar'), ('casado'), ('ignorado')) s(estado)
  union all
  -- corte: los apartados de Foodint creados antes del 07/11, con su motivo (huella)
  select 2, 'Foodint: huella de los apartados',
    (select coalesce(md5(string_agg(m.id::text || ':' || m.ignored_reason, ',' order by m.id)), 'ninguno') from public.bank_movement m
      where m.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and m.created_at < timestamptz '2026-11-07 00:00:00+01' and m.status = 'ignorado')
) t order by o, clave;
