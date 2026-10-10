-- ============================================================================
-- Compras · 2 · EL SOCIO DE MARCA, UNA SOLA FICHA (orden de Julio, 10/10)
-- ----------------------------------------------------------------------------
-- «Solo existe un CTB». En Foodint el socio está en cinco fichas de
-- proveedor (medido el 10/10, T1 §6). Queda la que tiene NIF y es proveedor,
-- cliente y socio de marca (8d53a379…). Las otras cuatro se unen a ella con
-- la herramienta general de la 0100 (_supplier_merge): recepciones, pedidos,
-- artículos, avisos, alias y lo aprendido.
--
--   92047dae…  122 recepciones, 46 pedidos, 121 artículos, 119 avisos, 4 alias
--   0848e744…  10 artículos
--   e880787a…  13 artículos
--   a12b3e74…  nada
--
-- Solo para la cuenta de Foodint y por id: en otra base (staging) no
-- encuentra las fichas y no hace nada. PARA si la que queda no es la del
-- NIF, o si alguna de las cuatro ya no es de Foodint.
--
-- Antes y después, el mismo recuento con la misma consulta, por tabla, de
-- lo que cuelga de las cinco: tiene que dar lo mismo. Si no, PARA y no se
-- aplica nada.
--
-- Mueve filas de recepciones, pedidos y artículos (destruir/mover): pide
-- «autorizo». No cambia stock ni coste (mover el proveedor no dispara nada).
-- Vuelta atrás: supabase/vuelta-atras/20261017T0110_compras_socio_una_ficha.down.sql
-- ============================================================================

do $$
declare
  c_cuenta constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  c_queda  constant uuid := '8d53a379-1aa6-4c49-a7aa-dcfaeb353b5e';
  c_se_van constant uuid[] := array['92047dae-2dad-4f64-aa80-ff72d6e684fd', '0848e744-0fdd-470a-a04b-72a27e500fda',
                                    'e880787a-12ad-4fd2-89c1-d37e293783de', 'a12b3e74-7e68-469e-87dd-296187507c16']::uuid[];
  v_todas uuid[]; v_antes jsonb; v_despues jsonb; v_id uuid; v_res jsonb;
begin
  if not exists (select 1 from supplier where id = c_queda and account_id = c_cuenta) then
    raise notice 'La ficha del socio no está en esta base: no se une nada.';
    return;
  end if;
  if (select tax_id from supplier where id = c_queda) is null then
    raise exception 'La ficha que queda no tiene NIF: no es la que se esperaba.';
  end if;
  if (select count(*) from supplier where id = any(c_se_van) and account_id = c_cuenta) <> 4 then
    raise exception 'No están las cuatro fichas que se unen, o alguna no es de Foodint.';
  end if;
  v_todas := c_queda || c_se_van;

  -- El recuento: por tabla, cuántas filas cuelgan de cualquiera de las cinco.
  select jsonb_object_agg(t, n) into v_antes from (
    select 'goods_receipt' t, count(*) n from goods_receipt where supplier_id = any(v_todas)
    union all select 'purchase_order', count(*) from purchase_order where supplier_id = any(v_todas)
    union all select 'purchase', count(*) from purchase where supplier_id = any(v_todas)
    union all select 'supplier_invoice', count(*) from supplier_invoice where supplier_id = any(v_todas)
    union all select 'article_supplier', count(*) from article_supplier where supplier_id = any(v_todas)
    union all select 'supplier_alias', count(*) from supplier_alias where supplier_id = any(v_todas)
    union all select 'supplier_contact', count(*) from supplier_contact where supplier_id = any(v_todas)
    union all select 'supplier_learning', count(*) from supplier_learning where supplier_id = any(v_todas)
    union all select 'compliance_document', count(*) from compliance_document where supplier_id = any(v_todas)
    union all select 'ctb_notification_queue', count(*) from ctb_notification_queue where supplier_id = any(v_todas)
    union all select 'company_account_link', count(*) from company_account_link where entity = 'supplier' and entity_id = any(v_todas::text[])) x;
  raise notice 'Antes: %', v_antes;

  foreach v_id in array c_se_van loop
    v_res := public._supplier_merge(c_queda, v_id, 'Migración 20261017T0110 (orden de Julio, 10/10)');
    raise notice '%', v_res->>'resumen';
  end loop;

  select jsonb_object_agg(t, n) into v_despues from (
    select 'goods_receipt' t, count(*) n from goods_receipt where supplier_id = any(v_todas)
    union all select 'purchase_order', count(*) from purchase_order where supplier_id = any(v_todas)
    union all select 'purchase', count(*) from purchase where supplier_id = any(v_todas)
    union all select 'supplier_invoice', count(*) from supplier_invoice where supplier_id = any(v_todas)
    union all select 'article_supplier', count(*) from article_supplier where supplier_id = any(v_todas)
    union all select 'supplier_alias', count(*) from supplier_alias where supplier_id = any(v_todas)
    union all select 'supplier_contact', count(*) from supplier_contact where supplier_id = any(v_todas)
    union all select 'supplier_learning', count(*) from supplier_learning where supplier_id = any(v_todas)
    union all select 'compliance_document', count(*) from compliance_document where supplier_id = any(v_todas)
    union all select 'ctb_notification_queue', count(*) from ctb_notification_queue where supplier_id = any(v_todas)
    union all select 'company_account_link', count(*) from company_account_link where entity = 'supplier' and entity_id = any(v_todas::text[])) x;
  raise notice 'Después: %', v_despues;
  if v_antes <> v_despues then
    raise exception 'El recuento no es el mismo antes (%) y después (%): no se une nada.', v_antes, v_despues;
  end if;
  if exists (select 1 from goods_receipt where supplier_id = any(c_se_van)) or exists (select 1 from purchase_order where supplier_id = any(c_se_van)) then
    raise exception 'Han quedado recepciones o pedidos en una ficha que se va.';
  end if;
end $$;
