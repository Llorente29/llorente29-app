-- ============================================================================
-- B01 · 3 · LOS AJUSTES DEL BANCO DE FOODINT (respuesta 1, P3 y P4)
-- ----------------------------------------------------------------------------
-- Una fila NUEVA en bank_settings (tabla nueva de 20261101T0100): serie de
-- tesorería 4, como Diez desde abril de 2025, para que la comparación y el
-- envío a Diez casen; «validar solo lo seguro» apagado (por defecto); corte
-- el 01/10/2026 (lo de antes ya está en el libro, traído de Diez: un extracto
-- anterior solo enlaza).
--
-- Ancla por id de cuenta (regla 9), no por nombre. En staging Foodint no
-- existe: el fichero no hace nada y lo dice.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0120_b01_foodint.down.sql
-- ============================================================================
do $$
declare v_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'; v_empresa uuid; n int;
begin
  select count(*) into n from public.company where account_id = v_cuenta;
  if n = 0 then raise notice 'Foodint no está aquí (staging): no se pone nada.'; return; end if;
  if n > 1 then raise exception 'Foodint tiene % empresas: di cuál lleva estos ajustes.', n; end if;
  select id into v_empresa from public.company where account_id = v_cuenta;
  insert into public.bank_settings (company_id, account_id, treasury_series, validate_safe, cutover_date, updated_by_name)
  values (v_empresa, v_cuenta, 4, false, date '2026-10-01', 'B01 · respuesta 1 de Julio (P3 y P4)')
  on conflict (company_id) do nothing;
  raise notice 'Foodint: serie de tesorería 4, validar solo lo seguro apagado, corte 01/10/2026.';
end $$;
