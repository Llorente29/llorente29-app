# Cierre de sesión — 14 jun 2026

## 1. ESTADO (qué se hizo hoy)
- **PDF de pedido con marca Folvy** (cabecera C: lomo navy + logo grande sin marco + identidad cliente) → en producción (commits `b98fb1d`, `dbaa691`). Logo autoservicio por cuenta (`accounts.logo_url` + bucket `account-logos` + RLS + `AccountLogoUploader`). Autotrim de fondo plano implementado.
- **Buscador + filtros + columna Valor** en `InventoryCountSheet` → en producción (commit `5a2cd05`). Servicio `listCountLines` ampliado con `computed_cost`, `family_id` + nombre familia, `needs_review`, `lineValue`.
- **Inventario Foodint Alcalá (14-jun) cargado:** 147 líneas, 63 artículos nuevos en Title Case, casado estricto sin duplicados, verificado contra tspoon (Carne de Birria, Bacon, Kebab, Hamburguesas, Arroz… cuadran). Conteo **INV-00002 APROBADO**. Valor ref. tspoon ≈ 3.193 €.
- **Inventario Plaza Castilla (INV-00001):** 131 líneas de la hoja manual (gestos conjeturados), en *contando*. Datos **NO fiables** — pendiente recargar con export tspoon.
- **Migraciones versionadas subidas:** `carga_alcala.sql`, `carga_inventario_pc.sql`.

## 2. FRENTES ABIERTOS (orden de prioridad)

### F1 — Precio por línea del pedido NO corresponde al formato de compra · ALTA (toca al dinero)
- **Síntoma:** PED-00003 muestra "Patatas · 6 · 1,82 € = 10,92 €", pero 1,82 € parece el `computed_cost` (coste por unidad base / escandallo), **no** el precio de la Caja 10 kg. El total del pedido sale mal.
- **RECON antes de tocar:** (1) leer el servicio/componente del builder de pedidos — de dónde saca "Precio est."; (2) confirmar en `article_supplier` que cada formato tiene su `last_price`; (3) corregir: **Total est. = cantidad × precio_del_formato_elegido**, NO × `computed_cost`.
- **Principio:** coste de escandallo ≠ precio de compra. El pedido usa precio de formato (`article_supplier`); el escandallo usa `computed_cost`. No mezclar.

### F2 — Stock del pedido sale "—" (Alcalá aprobado pero sin saldo)
- **Causa:** `recipe_item_location_stock` de Alcalá tiene 34 art. / 3 saldos / −42,89 € = solo consumo teórico; la aprobación de INV-00002 no ancló el stock (entró como ajuste contra `system_qty` nulo, no como apertura).
- **Solución:** re-anclar INV-00002 como apertura. **RECON:** leer `apply_inventory_count` y `build_inventory_count` (`pg_proc.prosrc`) para ver cómo escriben `stock_movement` (`movement_type`, `qty_base`, `unit_cost`, `source_type`…) y cómo consolidan `recipe_item_location_stock.qty_on_hand`. Probable: anular movimientos del conteo + marcar `is_opening=true` + reaprobar. Verificar saldo = 147 líneas tras el fix.

### F3 — Plaza Castilla con datos fiables
- Recargar con export tspoon de Plaza Castilla (formato Familia/Producto/Cantidad/Unidad/Importe), casado estricto (1 artículo = 1 línea EN LA CARGA, no a posteriori), en *contando*. La hoja manual queda como referencia, no como verdad.

### F4 — Carabanchel
- Cargar con su export tspoon, mismo proceso que F3.

## 3. PENDIENTES MENORES
- **Migración del logo sin commitear:** `20260614T0903_account_logo_infra.sql` → colocar en `supabase/migrations/` y push (cierra drift; no toca BBDD).
- **Logo de Foodint limpio:** subir PNG sin el recuadro gris en la ficha de cuenta (el actual trae marco en el propio archivo; el autotrim no lo quita porque su fondo no es plano).
- Toma tspoon 6/7-jun de Alcalá = histórico de rotación, sin cargar.
- Normalizar a Title Case todo el catálogo existente (~107) = frente aparte (toca escandallos/ventas, con cuidado).

## 4. APRENDIZAJES
- El casado por nombre, aun estricto, puede colar 1-2 colisiones ("Sal"↔"Salsa" por fragmento). **Regla:** exigir ≥2 tokens completos compartidos; ante duda, crear nuevo, no casar mal. Y deduplicar EN la carga (1 artículo = 1 línea).
- El export de tspoon (cantidad real + unidad + importe) es la fuente fiable; la hoja manual con gestos no lo es. No convertir gestos por conjetura.
- El stock del pedido vive en `recipe_item_location_stock.qty_on_hand`, se escribe al APROBAR un conteo. Primera carga debe entrar como **apertura** (`is_opening=true`), no como ajuste.
- Coste de escandallo ≠ precio de compra. El pedido usa precio de formato (`article_supplier`); el escandallo usa `computed_cost`. No mezclar.

## 5. PROMPT DE ARRANQUE (próxima sesión)
> Soy Julio Gª Colón, CEO de Folvy. Lee `CONTEXTO_CLAUDE.md` (§1) y este cierre. **Primer frente: F1** — corregir que el precio por línea del pedido use el precio del FORMATO de compra (`article_supplier.last_price`), no `computed_cost`. Haz RECON del builder de pedidos (servicio + componente) y de `article_supplier` ANTES de proponer. Luego F2 (re-anclar stock de Alcalá como apertura). Reglas de siempre: ficheros completos, una instrucción marcada por turno (🖥️/🗃️), build verde antes de commit, verificar push 0 0.
