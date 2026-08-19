-- ============================================================================
-- PARCHE DE DATOS 19/08/2026 - desbloquear la publicacion de 3 marcas propias
-- ============================================================================
-- ESTO ES UN PARCHE, NO PRODUCTO. Las tres marcas propias estaban bloqueadas
-- por cosas que Julio NO PUEDE ARREGLAR DESDE FOLVY hoy: asignar una categoria
-- a un producto y quitar un producto de la carta. Por eso va por migracion.
-- Cuando exista el gestor de la carta, esto se corrige desde la pantalla y esta
-- migracion queda como registro de que se hizo a mano y por que.
--
-- NO PUBLICA NADA. Solo toca menu_item. Cero trafico saliente.
-- La publicacion de The Urban Kebab espera al visto bueno de Julio: ver el
-- aviso de precios al final.
--
-- QUE SE ASIGNA, PRODUCTO A PRODUCTO (criterio 5):
--
--   Meraki Pita / "Pita de Falafel" (11,10 EUR, creado 29/07)
--     -> categoria "PITAS & ROLLOS ARTESANOS" (9bd7ca05, activa, posicion 3)
--     Motivo: es una pita. Si Julio prefiere otra estanteria, es un update de
--     una fila.
--
--   Lovers Burgers / "Agua Mineral 50 CL" (1,90 EUR, creado 27/07)
--     -> categoria "Bebidas" (bd2023ce, activa, posicion 4)
--     Motivo: es una bebida.
--     (El encargo decia creado el 29/07; la fila dice 27/07. No cambia nada.)
--
--   The Urban Kebab / los CUATRO kebabs viejos -> is_active = false
--     NO se archivan y NO se borran: tienen ventas y el historico se conserva
--     intacto en sale_line. NO se reactiva "Kebabs Enrollados": se queda
--     inactiva y vacia, que es lo que se pretendia en julio.
--
-- POR QUE DESACTIVAR Y NO REACTIVAR LA CATEGORIA:
-- Hay DOS categorias de kebab con los MISMOS cuatro kebabs duplicados. Los
-- viejos (20/06, categoria inactiva) son los que venden; los nuevos (27/07,
-- categoria activa) no han vendido NI UNA unidad ni tienen una sola linea de
-- venta historica. La ultima publicacion buena de la marca es del 06/08: la
-- carta nueva se hizo en Folvy y nunca llego al escaparate, asi que el cliente
-- sigue comprando la de junio. Reactivar la categoria vieja habria publicado
-- los ocho, duplicados, en el escaparate.
--
-- El duplicado ES el apano de la carencia: alguien en julio rehizo los cuatro
-- kebabs, creo la categoria nueva y desactivo la vieja PORQUE DESACTIVAR
-- PRODUCTOS NO SE PUEDE DESDE FOLVY. Ese apano es justo lo que bloqueaba la
-- publicacion de la marca.
--
-- ⚠️ AVISO DE PRECIO (decision de Julio, no efecto secundario de este parche):
-- al publicar The Urban Kebab, cuatro precios cambian de lo que se cobra HOY:
--     Kebab Mixto     10,10 -> 10,90  (+0,80)   20 unidades en 30 dias
--     Kebab Ternera   10,30 -> 11,10  (+0,80)    0 unidades en 30 dias
--     Kebab Pollo      9,90 -> 10,50  (+0,60)    3 unidades en 30 dias
--     Kebab Falafel    9,90 ->  9,90  (=)         1 unidad  en 30 dias
-- La subida lleva pendiente desde el 27/07 sin que nadie lo supiera. Este
-- parche NO la aplica: la aplica la publicacion, y esa espera a Julio.

do $mig$
declare
  v_account   uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';  -- Foodint (PRODUCCION)
  v_cat_pitas uuid := '9bd7ca05-a67e-4ba3-83d2-5a282bfffd8d';
  v_cat_bebidas uuid := 'bd2023ce-ba34-4f54-999e-3f10df53782b';
  v_falafel   uuid := '6598c6b0-3862-4add-82c3-b273961573d1';  -- Meraki / Pita de Falafel
  v_agua      uuid := 'c6fd0465-c47a-491a-8338-e52c685df836';  -- Lovers / Agua Mineral 50 CL
  v_kebabs_viejos uuid[] := array[
    '1d677034-bb5b-4b7b-ab7c-50097d8a6e68',  -- Kebab Mixto (Pollo y Ternera).
    '2dcfa9dc-6612-437a-a45e-e07d1a32e1d5',  -- Kebab de Pollo
    'f2a43c66-0879-42ce-815c-ece903c3c625',  -- Kebab de Ternera
    '71fa8dd2-a87a-4f67-a6d7-e91b7d89d051'   -- Kebab de Falafel
  ];
  v_n int;
  v_lineas_antes int;
  v_lineas_despues int;
begin
  -- ── Guarda 0: la cuenta es Foodint, no el laboratorio ───
  if not exists (select 1 from accounts where id = v_account and name = 'Foodint') then
    raise exception 'La cuenta % no es Foodint. Abortado.', v_account;
  end if;

  -- ── Guarda 1: las dos categorias destino existen, estan ACTIVAS y son de la
  --    marca del producto que se les va a colgar. Colgar un producto de la
  --    categoria de OTRA marca seria peor que dejarlo sin categoria.
  if not exists (
    select 1 from menu_category mc join menu_item mi on mi.brand_id = mc.brand_id
     where mc.id = v_cat_pitas and mc.is_active and mi.id = v_falafel) then
    raise exception 'La categoria de pitas no existe, no esta activa, o no es de la marca de Pita de Falafel. Abortado.';
  end if;
  if not exists (
    select 1 from menu_category mc join menu_item mi on mi.brand_id = mc.brand_id
     where mc.id = v_cat_bebidas and mc.is_active and mi.id = v_agua) then
    raise exception 'La categoria de bebidas no existe, no esta activa, o no es de la marca de Agua Mineral. Abortado.';
  end if;

  -- ── Guarda 2: los cuatro kebabs a desactivar son los VIEJOS, no los nuevos.
  --    Se exige que sigan colgando de una categoria INACTIVA: si alguien
  --    reactivo "Kebabs Enrollados" por su cuenta, esto para en vez de apagar
  --    productos que quiza ya sean los buenos.
  select count(*) into v_n
    from menu_item mi join menu_category mc on mc.id = mi.menu_category_id
   where mi.id = any(v_kebabs_viejos) and mi.account_id = v_account
     and mi.is_active and mi.archived_at is null and mc.is_active = false;
  if v_n <> 4 then
    raise exception 'Se esperaban 4 kebabs viejos activos bajo categoria inactiva y hay %. Abortado.', v_n;
  end if;

  -- ── Guarda 3: ninguno de los cuatro ha vendido en 30 dias mas que... no.
  --    Justo al reves: los viejos SI venden, y por eso NO se archivan. Lo que
  --    se comprueba es que el historico existe y quedara intacto.
  select count(*) into v_lineas_antes from sale_line where menu_item_id = any(v_kebabs_viejos);

  -- ── A · Meraki Pita: Pita de Falafel -> PITAS & ROLLOS ARTESANOS ───
  update menu_item set menu_category_id = v_cat_pitas, updated_at = now()
   where id = v_falafel and account_id = v_account and menu_category_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Pita de Falafel: se esperaba 1 fila y salieron %. Abortado.', v_n; end if;

  -- ── B · Lovers Burgers: Agua Mineral 50 CL -> Bebidas ───
  update menu_item set menu_category_id = v_cat_bebidas, updated_at = now()
   where id = v_agua and account_id = v_account and menu_category_id is null;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Agua Mineral 50 CL: se esperaba 1 fila y salieron %. Abortado.', v_n; end if;

  -- ── C · The Urban Kebab: los cuatro viejos fuera de la carta ───
  update menu_item set is_active = false, updated_at = now()
   where id = any(v_kebabs_viejos) and account_id = v_account and is_active;
  get diagnostics v_n = row_count;
  if v_n <> 4 then raise exception 'Kebabs viejos: se esperaban 4 filas y salieron %. Abortado.', v_n; end if;

  -- ── Guarda 4: el historico de ventas NO se ha tocado ───
  select count(*) into v_lineas_despues from sale_line where menu_item_id = any(v_kebabs_viejos);
  if v_lineas_despues <> v_lineas_antes then
    raise exception 'El historico de ventas cambio (% -> %). Abortado.', v_lineas_antes, v_lineas_despues;
  end if;

  -- ── Guarda 5: el criterio 1 del encargo, comprobado DENTRO de la migracion.
  --    Ningun producto activo de marca PROPIA queda sin categoria ni colgando
  --    de una categoria inactiva.
  select count(*) into v_n
    from menu_item mi
    join brand b on b.id = mi.brand_id
    left join menu_category mc on mc.id = mi.menu_category_id
   where mi.account_id = v_account and mi.archived_at is null and mi.is_active
     and b.ownership_type = 'own'
     and (mi.menu_category_id is null or mc.is_active = false);
  if v_n <> 0 then
    raise exception 'Quedan % productos activos de marca propia sin categoria valida. Abortado.', v_n;
  end if;

  raise notice 'Parche aplicado: 2 categorias asignadas, 4 kebabs desactivados, % lineas de venta intactas.', v_lineas_despues;
end
$mig$;
