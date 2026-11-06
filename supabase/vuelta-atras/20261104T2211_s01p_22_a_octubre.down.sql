-- supabase/vuelta-atras/20261104T2211_s01p_22_a_octubre.down.sql
--
-- Vuelta atrás de la 2211: en Foodint, fuera los 22 asientos con la fecha de su
-- factura y vuelven los de noviembre desde su respaldo, con su número y su
-- huella; el 303 del 4T como estaba (conta_s01p4_303_antes). Y fuera las dos
-- funciones.
do $$ begin
  if to_regprocedure('public._s01p_facturas_a_su_fecha_deshacer(uuid,uuid)') is not null
     and exists (select 1 from public.accounts where id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise notice 'S01p·4: %', public._s01p_facturas_a_su_fecha_deshacer('658728c0-fcd7-46ef-a860-d4e5e6eb21d9', '8ae554ae-4853-42c9-b5b0-346840223d47')->>'texto';
  end if;
end $$;
drop function if exists public._s01p_facturas_a_su_fecha(uuid, uuid[], uuid, uuid, text);
drop function if exists public._s01p_facturas_a_su_fecha_deshacer(uuid, uuid);
