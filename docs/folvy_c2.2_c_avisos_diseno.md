# Folvy Supply — C2.2.c: avisos copiloto en recepción
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
Que la recepción AVISE de dos cosas, sin bloquear ("IA propone, humano decide"):
1. **Salto de precio**: el coste unitario de la línea se desvía del last_price
   conocido de ese artículo+proveedor más allá del umbral → "subió 18%: 4,29 € → 5,06 €".
   Pilla errores de tecleo del proveedor y subidas que comen margen.
2. **Caducidad**: la línea trae expiry_date vencida o muy próxima → aviso.
Umbral y días NO fijos en código: configurables POR CUENTA (default sensato de fábrica).

## Configuración por cuenta (clon del patrón kitchen_settings)
Nueva tabla `supply_settings` — UNA fila por cuenta, pensada para crecer:
- `account_id` (único), `id`, `created_*`/`updated_*` estándar.
- `price_alert_pct numeric default 15` — umbral de salto de precio (±%).
- `expiry_alert_days integer default 3` — días de margen para avisar de caducidad próxima.
- (futuras columnas de Supply caben aquí sin nueva tabla.)
RLS clonada (belongs_to_account). Helper `getSupplySettings(accountId)` que devuelve
los defaults si la cuenta no tiene fila aún (no obliga a configurar nada para funcionar).
ALCANCE: umbral por CUENTA ahora. "Por familia / por artículo" = FRENTE FUTURO anotado
(un congelado estable no tolera lo mismo que fruta volátil; se afina cuando haga falta).

## Avisos (en el form OCR / recepción)
- **Salto de precio (b.1 ya casa la línea → tengo recipe_item_id + supplier):**
  al casar/cargar, leer last_price de article_supplier(recipe_item_id, supplier_id).
  Si hay last_price y la línea tiene unitCost, calcular variación. Si |Δ| > price_alert_pct
  → chip ámbar en la línea: "↑18% vs última (4,29→5,06)". Sin last_price (artículo nuevo)
  → sin aviso (no hay con qué comparar). Solo informativo.
- **Caducidad:** si la línea trae expiry_date:
  · vencida (< hoy) → chip ROJO "caducado".
  · ≤ expiry_alert_days → chip ámbar "caduca en N días".
- **Resumen pre-confirmación:** los avisos se recogen también ahí ("2 artículos suben de
  precio · 1 caducidad próxima"), para que no se pasen.

## UI de ajuste (mínima)
- Zona "Ajustes de Supply" (o en la pantalla de Recepciones, un engranaje) con 2 campos:
  umbral de aviso de precio (%) y días de aviso de caducidad. Guardar = upsert supply_settings.
  Mínimo viable; sin sobreingeniería.

## Cómo se calcula (servicio)
- `getSupplySettings(accountId)` → { priceAlertPct, expiryAlertDays } (con defaults).
- En el form OCR, por línea casada con last_price: comparar unitCost. Marca de aviso en la línea.
- El last_price ya lo tengo: viene de article_supplier. Para no consultar 1 por línea,
  cargar el catálogo del proveedor una vez (cuando hay supplier) y mapear por recipe_item_id.

## Esquema
- `supply_settings` (nueva, clon kitchen_settings). Nada más.

## Decisiones (con recomendación)
1. Umbral por CUENTA ahora, por familia/artículo = frente futuro. (Recomendado.)
2. Defaults: 15% precio, 3 días caducidad. (Confirmados por Julio.)
3. Avisos informativos, no bloquean. El resumen pre-confirmación los reúne. (Recomendado.)
4. Sin last_price (artículo nuevo) → sin aviso de precio (nada que comparar). (Recomendado.)

## Frentes anotados
- Umbral de precio POR FAMILIA / POR ARTÍCULO (volatilidad distinta por tipo de producto).
- Avisos en RECEPCIÓN MANUAL (no solo OCR): el mismo cálculo aplica si la recepción se
  teclea a mano contra catálogo. Reutilizable.
