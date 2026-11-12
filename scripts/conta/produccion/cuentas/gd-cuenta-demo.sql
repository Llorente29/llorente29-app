-- scripts/conta/produccion/cuentas/gd-cuenta-demo.sql
--
-- GD · «Gestoría Demo» · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La misma vara a los dos lados (regla 31). Las cuentas, con un corte fijo
-- (creadas antes del 09/11 a las 00:00 UTC) para lo de «las demás no cambian».
-- Medido antes el 09/11 a las 00:51 UTC (solo lectura). Lo que tiene que pasar:
--   1. La cuenta «Gestoría Demo»: no → sí, de demostración, Sumied y asesoría.
--   2. Sus empresas en sector Gestoría con el alta terminada: 0 → 2.
--   3. Sus bancos del 9999 / cambios de tarifa encendidos: 0 / 0 → 2 / 2.
--   4. Su administración: 0 → 1 (el superadministrador).
--   5. Las cuentas de antes (todas, con el corte): las mismas, con la misma huella.
--   6. Cuentas de demostración: 1 (Casa Lola) → 2.
select clave, valor from (
  select 1 o, 'La cuenta «Gestoría Demo» (demo · marca · asesoría)' clave,
    -- quieta: solo la cuenta nueva, que nadie toca hasta que el superadministrador la conecte
    coalesce((select concat_ws(' · ', is_demo::text, product_brand, (tax_advisor_since is not null)::text) from public.accounts where id = 'de000000-0000-4000-8000-0000000000a0'), 'no') valor union all
  select 2, 'Sus empresas de Gestoría con el alta terminada',
    -- quieta: solo la cuenta nueva, que nadie toca hasta que el superadministrador la conecte
    (select count(*)::text from public.company where account_id = 'de000000-0000-4000-8000-0000000000a0' and sector = 'gestoria' and setup_completed_at is not null) union all
  select 3, 'Sus bancos del 9999 / cambios de tarifa encendidos',
    -- quieta: solo la cuenta nueva, que nadie toca hasta que el superadministrador la conecte
    concat_ws(' / ',
      (select count(*) from public.treasury_account where account_id = 'de000000-0000-4000-8000-0000000000a0' and iban like 'ES__9999%'),
      (select count(*) from public.conta_gestoria_ajustes where account_id = 'de000000-0000-4000-8000-0000000000a0' and cambios_de_tarifa)) union all
  select 4, 'Su administración',
    -- quieta: solo la cuenta nueva, que nadie toca hasta que el superadministrador la conecte
    (select count(*)::text from public.user_profiles where account_id = 'de000000-0000-4000-8000-0000000000a0' and role = 'admin' and active) union all
  select 5, 'Las cuentas de antes: cuántas · huella',
    (select count(*) || ' · ' || md5(string_agg(md5(to_jsonb(a)::text), '' order by a.id)) from public.accounts a
      where a.created_at < timestamptz '2026-11-09 00:00:00+00' and a.id <> 'de000000-0000-4000-8000-0000000000a0') union all
  select 6, 'Cuentas de demostración (todas)',
    -- quieta: is_demo solo lo pone el superadministrador; la tanda solo marca la suya
    (select count(*)::text from public.accounts where is_demo)
) q order by o;
