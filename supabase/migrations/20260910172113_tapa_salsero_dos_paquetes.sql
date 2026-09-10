-- 20260910172113_tapa_salsero_dos_paquetes.sql
--
-- TAPA SALSERO 120 CC · un formato «Pack» para DOS paquetes distintos
--
-- Un solo formato llamado «Pack» con 630 unidades servía para los albaranes de
-- dos proveedores con paquetes distintos:
--
--   16/06  Pack de 630 ud, 22,40 €  →  0,0356 €/ud   ← correcto
--   07/07  «PQ 100 U.», 5 packs      →  contó 3.150 ud en vez de 500
--   20/08  «PQ 100 U.», 1 pack       →  contó 1 ud (formato «Ud») a 2,81 €/ud
--
-- Esa última es la que envenena el almacén: Alcalá tiene 200 unidades a
-- 2,81 €/ud = 562 € de tapas que valen unos 7 €.
--
-- PASOS 1, 2 y 4 DEL PLAN (10/09, noche). El 3 —repuntar los dos albaranes de
-- CLOUDTOWN y recalcular su cantidad y su coste— NO va aquí: mueve stock y se
-- hace en el recuento de packaging, ANTES del PASO 1 del coste medio.
--
-- LOS NOMBRES SON PARA QUIEN CUENTA, no para quien factura: en la estantería
-- hay una caja y un paquete, no un CATOR y un CLOUDTOWN. El proveedor sigue
-- siendo rastreable por el albarán, que es donde vive. Los nombres definitivos
-- los confirma Julio en «Almacén › Cómo se cuenta» — y el disparador
-- `trg_ripf_invalida_revision` ya se encarga de pedírselo: tocar los formatos
-- invalida la revisión del artículo.

BEGIN;

DO $fix$
DECLARE
  v_item   uuid;
  v_cuenta uuid;
  v_pack   uuid;
  v_ud     uuid;
  v_n      integer;
BEGIN
  -- Regla 9: anclado por CUENTA. «Tapa Salsero» también existe en la plantilla.
  SELECT a.id INTO v_cuenta FROM public.accounts a WHERE a.name = 'Foodint';
  IF v_cuenta IS NULL THEN RAISE EXCEPTION 'No encuentro la cuenta Foodint'; END IF;

  SELECT ri.id INTO v_item FROM public.recipe_item ri
   WHERE ri.account_id = v_cuenta AND ri.name = 'Tapa Salsero 120 Cc';
  IF v_item IS NULL THEN RAISE EXCEPTION 'No encuentro Tapa Salsero 120 Cc en Foodint'; END IF;

  -- ── 1 · El «Pack» de 630 pasa a llamarse por lo que es ──────────────────
  SELECT f.id INTO v_pack FROM public.recipe_item_purchase_format f
   WHERE f.account_id = v_cuenta AND f.item_id = v_item
     AND f.name = 'Pack' AND f.qty_in_base = 630;
  IF v_pack IS NULL THEN
    RAISE EXCEPTION 'No encuentro el formato Pack de 630 ud: alguien lo ha tocado ya';
  END IF;
  UPDATE public.recipe_item_purchase_format
     SET name = 'Caja 630', updated_at = now()
   WHERE id = v_pack;

  -- ── 2 · El paquete que se compra de verdad hoy ──────────────────────────
  SELECT count(*) INTO v_n FROM public.recipe_item_purchase_format f
   WHERE f.account_id = v_cuenta AND f.item_id = v_item AND f.qty_in_base = 100;
  IF v_n > 0 THEN RAISE EXCEPTION 'Ya existe un formato de 100 ud: no duplico'; END IF;

  INSERT INTO public.recipe_item_purchase_format
    (account_id, item_id, name, qty_in_base, source, is_active, use_in_count)
  VALUES (v_cuenta, v_item, 'Paquete 100', 100, 'manual', true, true);

  -- ── 4 · «Ud» no es un formato de compra ─────────────────────────────────
  -- Es lo que se eligió por no tener el bueno. Se ARCHIVA, no se borra: el
  -- albarán del 20/08 lo sigue apuntando y ese rastro tiene que quedar para
  -- poder arreglarlo en el paso 3.
  SELECT f.id INTO v_ud FROM public.recipe_item_purchase_format f
   WHERE f.account_id = v_cuenta AND f.item_id = v_item
     AND f.name = 'Ud' AND f.qty_in_base = 1;
  IF v_ud IS NOT NULL THEN
    UPDATE public.recipe_item_purchase_format
       SET is_active = false, archived_at = now(), use_in_count = false, updated_at = now()
     WHERE id = v_ud;
  END IF;

  -- Guarda final: dos formatos activos y contables, de 630 y de 100.
  SELECT count(*) INTO v_n FROM public.recipe_item_purchase_format f
   WHERE f.account_id = v_cuenta AND f.item_id = v_item AND f.is_active;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'Esperaba 2 formatos activos al terminar, hay %', v_n;
  END IF;
END;
$fix$;

COMMIT;
