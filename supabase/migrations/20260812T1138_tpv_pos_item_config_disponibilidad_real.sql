-- supabase/migrations/20260812T1138_tpv_pos_item_config_disponibilidad_real.sql
--
-- ENCARGO CODE — TPV: leer la disponibilidad de donde debe (146 productos
-- inabribles)
-- ============================================================================
-- Aplicada: 2026-08-12 (Julio, verificado en vivo). pos_item_config confirmado
--   SECURITY DEFINER, sin duplicar, filtrando por local. Recuento real:
--   Alcalá 149 → 3 bloqueados, Carabanchel 138 → 0 (aislamiento por local ok).
--
-- SÍNTOMA (Julio): "el TPV tiene muchas cosas agotadas y es falso". Confirmado.
--
-- CAUSA: pos_item_config filtraba por menu_item.is_available, una foto
-- congelada de una importación vieja de Last (el `enabled` del catálogo, que
-- significa "está en esta carta", NO "agotado"). La fuente real y sana es
-- product_availability — la tabla que gestiona el operario, por local; la
-- fila SOLO existe cuando algo está agotado, se borra al reactivar.
--
-- RECON en vivo (12/08, contra producción, cuenta
-- 51ad1792-6629-4ef7-833a-b57b09a86710):
--   · menu_item: 521 activos, 149 con is_available=false (columna muerta,
--     último cambio 10/08, no la mantiene nadie).
--   · product_availability: 3 filas — Nachos con Guacamole y Nachos con Todo
--     (ambas en Foodint Alcalá, 38158159-cd71-4056-950b-53425afac1ce) + 1
--     fila huérfana (external_id null, location_id null, recipe_item_id
--     3184b7d2-9f73-4c14-b860-f7ab5f817fd9) que NO casa con ningún menu_item
--     de esta cuenta (verificado: 0 filas) — no bloquea nada hoy. NO SE
--     BORRA (regla de no destrucción): queda anotada para que Julio decida.
--
-- VALIDACIÓN (simulación por SELECT sobre datos reales, sin tocar la función
-- viva, antes de escribir esta migración):
--   Alcalá:      521 candidatos · viejo bloqueaba 149 · nuevo bloquea 3
--   Carabanchel: 446 candidatos · viejo bloqueaba 138 · nuevo bloquea 0
--
--   ⚠️ DESVIACIÓN respecto al encargo: el punto 2 de la verificación
--   esperaba "2 reales" (Nachos con Guacamole, Nachos con Todo). Son 3: el
--   tercero es "TOTOPOS CON GUACAMOLE" (marca distinta, brand_id
--   092fb053-fe28-4392-810b-92cc54e20723, external_id 187a0273-2060-4b57-
--   84e6-55363bfca511 — NO es el mismo external_id que Nachos con Guacamole)
--   que comparte recipe_item_id (bef71b9a-3536-4a34-86dd-7d991a118dae) con
--   Nachos con Guacamole: es el mismo plato bajo otra marca. Bloquearlo es
--   coherente con el resto del sistema, no un error de este filtro —
--   _set_product_availability_core (encargo 86) ya trata el recipe_item_id
--   compartido como "hermanos" al ESCRIBIR, y search_products_by_token /
--   search_products_86 ya excluyen por external_id U recipe_item_id al LEER.
--   Filtrar solo por external_id habría dejado vendible un producto hecho
--   con el mismo guacamole agotado — el mismo tipo de fallo que corrige
--   este encargo. Si Julio quiere el criterio estricto (solo external_id,
--   sin hermanos), es quitar la rama `or (mi.recipe_item_id ...)` de abajo.
--
-- SEGUNDO FALLO (confirmado): el filtro original no llevaba location_id — un
-- agotado de Alcalá tumbaba el producto en Carabanchel también. Corregido
-- con (pa.location_id = p_location_id or pa.location_id is null), igual que
-- ya hacen search_products_by_token/86.
--
-- FUERA DE ALCANCE (declarado por el encargo, no tocado aquí):
--   shop_brand_menu_by_slug, menu_item_channel_economics,
--   set_menu_item_override, clone_brand_catalog — mismo problema, encargo
--   aparte (shop_brand_menu_by_slug probablemente oculta los mismos 146
--   productos al cliente final de la tienda propia).
--   Nota adicional (no pedida, dejo constancia): las OPCIONES de un combo
--   (combo_slot_option → menu_item omi, más abajo en esta misma función)
--   siguen filtrando solo por omi.is_active, sin pasar por
--   product_availability — un combo podría seguir ofreciendo como opción un
--   producto agotado. El encargo dice "todo lo demás de la función se
--   mantiene intacto", así que no se toca aquí; señalado para encargo aparte
--   si Julio lo quiere.
--
-- MÉTODO: función viva y compartida (SECURITY DEFINER, la llama el TPV en
-- producción) → migración GENERATIVA sobre pg_get_functiondef(): guard que
-- exige que el fragmento objetivo aparezca EXACTAMENTE UNA VEZ en el cuerpo
-- vivo (protege contra drift si la función cambió desde el RECON) y aborta
-- si no. Nunca se reescribe el cuerpo entero a mano. Firma intacta (mismos
-- 3 parámetros, mismo jsonb de retorno) → NO hace falta notify pgrst reload
-- schema.
--
-- ⚠️ CÓMO APLICAR — LEER ANTES DE PEGAR NADA ⚠️
--   Es un único bloque DO, atómico por sí mismo (sin begin/commit propio que
--   el SQL Editor pueda descartar en silencio). Aun así: aplicar con
--   `apply_migration` por MCP, o pegar en el SQL Editor y comprobar el
--   mensaje de NOTICE final. VERIFICAR DESPUÉS con pg_get_functiondef en
--   vivo — no fiarse del "Success" (folvy_reglas.md §3).
--
-- VERIFICACIÓN EN VIVO PENDIENTE (Julio, después de aplicar — ver encargo
-- §4): recontar nulls en Alcalá (149→3, no 2, por lo de arriba), confirmar
-- aislamiento por local (Carabanchel no se toca), agotar/reactivar en vivo
-- desde la tablet de Alcalá, combos, y una venta real completa. AVISAR A
-- JULIO ANTES de la prueba de agotar-en-vivo y de la venta real: descuentan
-- stock e imprimen en cocina. El local abre a las 13:00 — hacerlo fuera de
-- servicio.
-- ============================================================================

do $$
declare
  v_old_fragment text := '    and mi.is_active is not false and mi.is_available is not false and mi.archived_at is null;';
  v_new_fragment text := '    and mi.is_active is not false and mi.archived_at is null
    and not exists (
      select 1
      from product_availability pa
      where pa.account_id = p_account_id
        and (
          (mi.external_id is not null and pa.external_id = mi.external_id)
          or (mi.recipe_item_id is not null and pa.recipe_item_id = mi.recipe_item_id)
        )
        and (pa.location_id = p_location_id or pa.location_id is null)
        and pa.is_available is false
        and (pa.available_until is null or pa.available_until >= now())
    );';
  v_def         text;
  v_new_def     text;
  v_occurrences int;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'pos_item_config';

  if v_def is null then
    raise exception 'guard: pos_item_config no existe en public — aborto sin tocar nada';
  end if;

  v_occurrences := (length(v_def) - length(replace(v_def, v_old_fragment, ''))) / length(v_old_fragment);
  if v_occurrences <> 1 then
    raise exception 'guard: el fragmento objetivo aparece % veces en pos_item_config (se esperaba 1) — la función viva ha cambiado desde el RECON, aborto sin tocar nada', v_occurrences;
  end if;

  v_new_def := replace(v_def, v_old_fragment, v_new_fragment);

  execute v_new_def;

  -- guard final: re-lee la función ya redefinida y confirma que el
  -- fragmento nuevo quedó dentro (no basta con que EXECUTE no fallara).
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'pos_item_config';

  if v_def is null or position('product_availability' in v_def) = 0 then
    raise exception 'guard: pos_item_config no quedó con el fragmento nuevo tras el replace — aborto';
  end if;

  raise notice 'pos_item_config actualizado: filtro is_available sustituido por product_availability por local.';
end $$;
