-- ============================================================================
-- Compras · 4 · DATOS: la forma de facturar de los que ya la tenían
-- ----------------------------------------------------------------------------
-- invoicing_frequency decía «cada cuánto», no «cómo». Medido en producción el
-- 10/10, en TODAS las cuentas (regla 9: la cifra lleva de qué cuentas es):
--
--   Foodint     per_delivery  2  → «Con cada entrega» (dice lo mismo)
--   Foodint     monthly       1  → la ficha del socio de marca (8d53a379…):
--                                  «Liquidación mensual» (orden de Julio, 10/10)
--   Casa Lola   monthly       6  → NO se tocan: «mensual» vale igual para el
--                                  que agrupa albaranes que para el que liquida.
--                                  Su ficha lo preguntará (compras_ficha_le_falta).
--
-- Por id y por cuenta, nunca por nombre. Solo si invoicing_mode está vacío y
-- invoicing_frequency sigue diciendo lo medido; si no, PARA y no cambia nada.
-- En otra base (staging) no encuentra las fichas y no hace nada.
--
-- Escribe sobre filas que existen (update): pide «autorizo».
-- Vuelta atrás: supabase/vuelta-atras/20261017T0130_compras_forma_de_facturar_datos.down.sql
-- ============================================================================
do $$
declare
  c_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  c_cada_entrega constant uuid[] := array['3048d4f8-b1eb-4352-ad2d-64583b0f4f93', '88da6412-9db6-4489-8349-d88e2a6a67fa']::uuid[];
  c_socio constant uuid := '8d53a379-1aa6-4c49-a7aa-dcfaeb353b5e';
  v_n int;
begin
  if not exists (select 1 from supplier where id = c_socio and account_id = c_cuenta) then
    raise notice 'Las fichas de Foodint no están en esta base: no se cambia nada.';
    return;
  end if;
  select count(*) into v_n from supplier
   where account_id = c_cuenta and invoicing_mode is null
     and ((id = any(c_cada_entrega) and invoicing_frequency = 'per_delivery') or (id = c_socio and invoicing_frequency = 'monthly'));
  if v_n <> 3 then
    raise exception 'Esperaba 3 fichas de Foodint sin forma y con la frecuencia medida, y hay %: no se cambia nada.', v_n;
  end if;
  update supplier set invoicing_mode = 'per_delivery'
   where account_id = c_cuenta and id = any(c_cada_entrega) and invoicing_mode is null and invoicing_frequency = 'per_delivery';
  update supplier set invoicing_mode = 'monthly_settlement'
   where account_id = c_cuenta and id = c_socio and invoicing_mode is null and invoicing_frequency = 'monthly';
  raise notice 'Forma de facturar: 2 «con cada entrega» y el socio «liquidación mensual». Fichas con forma en Foodint: %.',
    (select count(*) from supplier where account_id = c_cuenta and invoicing_mode is not null);
end $$;
