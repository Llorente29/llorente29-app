-- supabase/migrations/20261031T0932_s01g_liquidaciones_ctb_foodint.sql
--
-- S01g · Datos de Foodint (lleva autorizo, respuesta de Julio al paso 0): las
-- 3 liquidaciones de CTB de junio de 2026 (Alcalá, Plaza Castilla y
-- Carabanchel, traídas del sistema de antes: source «ctb_settlement») tienen
-- el proveedor vacío. Sin él, compras_liquidacion_recepciones no encuentra
-- ninguna recepción de soporte y el cruce del socio del mes sale vacío.
--
-- El proveedor es CLOUDTOWN BRANDS, S.L. de Foodint (regla 9: por la cuenta,
-- el nombre exacto y que liquida cada mes; tiene que ser exactamente uno).
-- Solo se tocan las de Foodint, de CTB, con el proveedor vacío. Medido en
-- producción el 31/10 (solo lectura): son 3. En una base sin Foodint (staging)
-- no hace nada.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_prov uuid; v_n int; v_hay int;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01g 0932: esta base no tiene a Foodint: no hay nada que poner.';
    return;
  end if;
  select count(*) into v_n from public.supplier
   where account_id = v_acc and name = 'CLOUDTOWN BRANDS, S.L.' and invoicing_mode = 'monthly_settlement';
  if v_n <> 1 then raise exception 'S01g 0932: CLOUDTOWN BRANDS de Foodint tiene que ser un solo proveedor que liquida cada mes, y hay %.', v_n; end if;
  select id into v_prov from public.supplier
   where account_id = v_acc and name = 'CLOUDTOWN BRANDS, S.L.' and invoicing_mode = 'monthly_settlement';

  select count(*) into v_hay from public.licensed_settlement
   where account_id = v_acc and supplier_id is null and source = 'ctb_settlement';
  if v_hay > 3 then raise exception 'S01g 0932: hay % liquidaciones de CTB sin proveedor y se esperaban 3 como mucho: no toco nada.', v_hay; end if;

  update public.licensed_settlement set supplier_id = v_prov, updated_at = now()
   where account_id = v_acc and supplier_id is null and source = 'ctb_settlement';
  get diagnostics v_n = row_count;
  raise notice 'S01g 0932: % liquidaciones de CTB de Foodint con su proveedor.', v_n;
end $$;
