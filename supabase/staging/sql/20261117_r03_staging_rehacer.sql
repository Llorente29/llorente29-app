-- supabase/staging/sql/20261117_r03_staging_rehacer.sql
--
-- SOLO STAGING. Staging tiene aplicada la versión anterior del R03 (con la
-- espera de 5 minutos). Para aplicar la nueva desde cero, la tanda pasa antes
-- por las tres vueltas atrás de verdad (0320, 0310, 0300), que así quedan
-- probadas sobre datos (con \i, abajo). La de la 0300 para si hay direcciones pegadas, y las
-- e2e dejan pegadas las de la cuenta A de prueba (R03B, R03D): aquí se borran.
-- Datos inventados de la semilla; producción no pasa por aquí (guarda).

do $$
begin
  if exists (select 1 from public.accounts where id = '51ad1792-6629-4ef7-833a-b57b09a86710') then
    raise exception 'R03 rehacer: esto es producción (está Foodint). Solo staging. No se toca nada.';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sale' and column_name = 'delivery_address_fixed') then
    update public.sale
       set delivery_address_fixed = null, delivery_address_fixed_at = null, delivery_address_fixed_by = null
     where account_id = 'c01a0000-0000-4000-8000-00000000000a' and delivery_address_fixed is not null;
    if exists (select 1 from public.sale where delivery_address_fixed is not null) then
      raise exception 'R03 rehacer: quedan direcciones pegadas fuera de la cuenta A de prueba. No se sigue.';
    end if;
  end if;
end $$;

-- Las tres vueltas atrás, de verdad y en su orden (la 0310 quita también la
-- espera de la versión anterior: cron, función y columna).
\i supabase/vuelta-atras/20261118T0320_r03_entrega_datos.down.sql
\i supabase/vuelta-atras/20261118T0310_r03_ticket_codigo_quien_reparte.down.sql
\i supabase/vuelta-atras/20261118T0300_r03_direccion_incompleta.down.sql
