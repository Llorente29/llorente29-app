# Folvy Supply — C2.2.b.6: copiloto de alta de artículo (IA sugiere)
### Diseño (para aprobar antes de construir). 04/06/2026.

## Objetivo
Cuando creas un artículo nuevo desde una línea de albarán (b.2), que la IA
PROPONGA familia, unidad base y nombre limpio a partir del texto del proveedor,
para no bucear entre 70 familias ni decidir la unidad a mano. "IA propone, humano
decide": todo prerelleno y EDITABLE; un clic en vez de un formulario en blanco.
Es la pieza que hace el alta cómoda para un cocinero (no para un técnico).

## Qué sugiere (desde el raw_text + proveedor)
- **Nombre limpio**: "METRO Chef queso grana padano DOP cuña 10 meses Italia"
  → "Queso grana padano". (El nombre largo del proveedor ya se guarda como
  supplier_item_name en b.3; aquí proponemos el nombre interno corto.)
- **Familia**: de la lista REAL de familias de la cuenta (no inventa) → "Charcutería y quesos".
- **Unidad base**: ud / g / ml, deducida del texto ("tarrina 900g"→g, "2,5 docenas"→ud, "5 L"→ml).

## Cómo (anti-invención, barato)
- Edge Function nueva `suggest-item` (texto-a-texto, NO visión; clon ligero del patrón
  de folvy-ai/ocr-albaran): recibe { raw_text, supplier_name, families:[{id,name}] } y
  devuelve { name, family_id|null, base_unit:'unit'|'weight'|'volume', confidence }.
  · La familia se elige SOLO de la lista que se le pasa (devuelve el id exacto o null).
    Si no está seguro → family_id null (no fuerza). Cero invención.
  · base_unit mapea a las 3 BASE_UNITS ya existentes.
- El front llama a la Edge Function al abrir "Crear artículo nuevo"; mientras llega,
  el formulario ya está usable con los defaults actuales (nombre=raw_text, ud). La
  sugerencia RELLENA los campos cuando responde; el humano edita lo que quiera.
- Coste mínimo (1 llamada corta de texto por alta), solo cuando el usuario abre el alta.

## UX en el picker (sobre lo de b.2)
- Al pulsar "Crear artículo nuevo": el mini-form aparece y, en paralelo, se pide la
  sugerencia. Indicador sutil "sugiriendo…". Al llegar: nombre, familia y unidad
  quedan prerellenos con un "✨ sugerido" discreto; el humano confirma o cambia.
- Si la IA no está disponible o falla: el alta sigue funcionando con los defaults
  (no bloquea nunca). Degradación limpia.

## Esquema
- Ninguno nuevo. (Reutiliza recipe_family, BASE_UNITS, createRecipeItem.)
- Opcional: registrar la sugerencia en una sesión IA para métrica/aprendizaje. NO ahora
  (no añadir tabla por esto; se puede loguear en ai_interaction si interesa, frente aparte).

## Ficheros
- `supabase/functions/suggest-item/index.ts` + deno.json (Edge Function texto).
- `goodsReceiptService.ts`: `suggestItemAttributes(accountId, rawText, supplierName)` →
  llama a la función, devuelve { name, familyId, baseUnitId, confidence }.
- `LineMatchPicker.tsx`: al abrir el alta, pedir sugerencia y prerellenar (editable).

## Decisiones antes de construir
1. **Modelo**: usar el mismo que ocr-albaran (claude, oculto en UI) vía Edge Function. (Sí.)
2. **Cuándo sugerir**: al abrir "Crear artículo nuevo" (no en cada tecla). (Recomendado.)
3. **Familia null si no hay seguridad** (no forzar una familia dudosa). (Recomendado.)
4. **Nombre**: proponer corto, pero el humano manda; nunca renombra solo. (Recomendado.)
