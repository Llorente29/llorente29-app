# CIERRE DE SESIÓN — 12/06/2026 (tarde)
## Llorente29 en producción: función estrella + completado masivo IA + PWA + acceso trabajador

---

## ✅ HECHO Y SUBIDO A PRODUCCIÓN (commits 67dd3f3, 1b3080c)

### 1. FUNCIÓN ESTRELLA — importar escandallo por foto/PDF/Excel/Word (EN PRODUCCIÓN)
El motor (Edge `extract-recipe` v10+ + RPC `materialize_recipe_session` + `run_mapping`)
YA existía y estaba vivo; faltaba SOLO la UI ("G7" nunca cableado). Construido y desplegado:
- **`recipeImportService.ts`** (nuevo): detecta formato y orquesta subir→extraer→materializar.
  - Imagen → comprime + sube + `kind:'photo'` (visión).
  - PDF → sube + `kind:'photo'`; el Edge lo manda como bloque `document` (+ header beta `pdfs-2024-09-25`).
  - Excel (.xlsx/.xls/.csv) → SheetJS `sheet_to_csv` → texto → `kind:'conversational'`.
  - Word (.docx) → mammoth `extractRawText` (import dinámico) → texto → `kind:'conversational'`.
- **Edge `extract-recipe`** reescrito: distingue visión (imagen/PDF) vs texto (conversational/voice);
  `toBase64` por chunks; sesión guarda `kind` real + `input_text`. Desplegado (sin `--no-verify-jwt`, no es webhook).
- **`KitchenRecipesPage.tsx`**: botón "📷 Importar ficha" (accept imagen+pdf+xlsx+xls+csv+docx) + modal progreso/resultado/"Abrir escandallo".
- **Probado en local con FOTO**: creó "American Fries" con 3 ingredientes y coste 0,29€. Los 4 formatos en producción.
- `mammoth` instalado (1 vuln high transitiva — `npm audit` pendiente, menor).

### 2. COMPLETADO MASIVO IA de ingredientes pendientes (EN PRODUCCIÓN)
Botón "Completar N con IA" en lista de Ingredientes (aparece si hay pendientes) + modal progreso/resumen.
- **`recipeBulkEnrichService.ts`** (nuevo): recorre pendientes EN SERIE reutilizando la cadena del botón
  individual (`enrichIngredient` + `applyEnrichment`). Pausa entre llamadas + reintento con backoff
  (1/2/4/8s) ante saturación. Captura `failedSamples` (mensaje de error real) para diagnóstico.
- **`KitchenItemsPage.tsx`**: botón + modal con barra de progreso, estado "reintentando", y detalle de fallos.
- **Resultado real Llorente29:** de 76 pendientes → 31 terminados, 38 pendientes legítimos, 7 fallaron
  (mejoró desde 17/26/33 tras arreglar parseo y alérgenos).

### 3. FIXES de raíz descubiertos al hacer el masivo (EN PRODUCCIÓN)
- **`enrich-ingredient` `extractJson` robusto**: ahora extrae el primer objeto `{...}` balanceado
  aunque la IA añada prosa alrededor. Recuperó la mayoría de los 33 fallos (eran JSON no parseable).
  Edge redesplegado.
- **CHECK de alérgenos alineado** (migración SQL, ejecutada en BBDD — VERSIONAR):
  `recipe_item_allergen_state_check` → acepta `contains/may_contain/free/unknown` (antes exigía
  `may_contain_traces/does_not_contain`, que el código NO usa → 400 masivo).
  `recipe_item_allergen_source_check` → añadido `ai_enrich`.
- **`recipeAiService.ts` `applyEnrichment` reordenado**: familia+IVA PRIMERO (lo esencial para terminar),
  alérgenos DESPUÉS y NO BLOQUEANTES (delete+insert idempotente, sin 409, en try/catch que no corta el cierre).

### 4. PWA — app instalable (EN PRODUCCIÓN)
- Iconos PNG generados desde `folvy_isotipo_manager.png`: `folvy-icon-192/512`, `folvy-maskable-192/512`
  (safe zone 82%, fondo crema), `apple-touch-icon.png` (180, opaco). En `public/`.
- `manifest.json` corregido (PNG con sizes reales, antes apuntaba a SVG → iOS no instalaba).
- `index.html`: `apple-touch-icon` a PNG.
- `sw.js` (service worker mínimo, passthrough, sin caché agresiva) + registro en `main.tsx` (solo PROD, tras load).
- **`InstallAppButton.tsx`** (nuevo) + insertado en `HomeEmpleado.tsx`: botón "Instalar Folvy en este móvil"
  (Android: prompt nativo vía `beforeinstallprompt`; iOS/sin soporte: modal con instrucciones).

### 5. DASHBOARD DE VENTAS (de la sesión de mañana, ya estaba en producción)
RPC `sales_dashboard` + `VentasDashboardPage`. Propias/cedidas, filtros, heatmap, vs-ayer. (Recordatorio: NO versionado.)

---

## ⚠️ PENDIENTE DE SUBIR (confirmar)
- **HomeEmpleado.tsx + doc OBLIGATORIO acceso trabajador**: arreglo MÍNIMO del atrapamiento
  (quitar botón "salir" del worker puro). Build+push **SIN CONFIRMAR** — verificar si quedó subido.

---

## 🔴 OBLIGATORIO — frentes abiertos hoy (NO perder)

### A. ACCESO TRABAJADOR — reentrada (arreglo COMPLETO obligatorio)
- **Mínimo aplicado:** worker puro sin botón "salir" → no queda atrapado (su acceso QR es de UN SOLO USO;
  `signOut` lo dejaba fuera pidiendo email/contraseña que no tiene). Cada trabajador usa su móvil → sesión persiste.
- **Completo OBLIGATORIO** (doc `docs/OBLIGATORIO_acceso_trabajador_reentrada.md`): el "salir" debe ir a
  `LoginEmpleado` (NOMBRE + PIN, ya existe), NUNCA al login de gestor. Habilita tablet común futura
  (recetas/recepciones/pedidos, NO fichar). Requiere PIN por empleado.
- **ACCIÓN INMEDIATA:** los trabajadores ya atrapados (ej. Johanny) necesitan que se les REENVÍE el QR
  una vez para volver a entrar. Tras el fix, ya no se saldrán.

### B. PWA — botón "Instalar" muestra instrucciones en vez de instalar (Android)
El `beforeinstallprompt` no se disparó en la prueba → cae al modal de instrucciones (complicado para gente mayor).
Objetivo: pulsar y que instale directo. Diagnóstico pendiente: confirmar en Chrome de escritorio
(Application → Manifest) que la web es "instalable"; revisar por qué Chrome Android no dispara el evento
(puede requerir engagement previo, o navegador no-Chrome). El botón YA está; falta que el prompt nativo salte.

### C. COMPLETADO MASIVO — bug del cierre por `review_notes` (DIAGNOSTICADO, no arreglado)
Tras el masivo, ingredientes con familia+IVA SIGUEN marcados `needs_review`. Causa: `applyEnrichment`
solo retira needs_review si `hasFamily && vatDerived && !hasIncident`, y `hasIncident = review_notes != null`.
Los ingredientes creados por la función estrella llevan `review_notes` ("completar coste real, proveedor,
formato") → `hasIncident=true` → NUNCA cierran. DECISIÓN PENDIENTE: ¿familia+IVA con nota de "falta precio"
cuenta como terminado? Probablemente distinguir "sin clasificar" (familia/IVA) de "sin coste real" (precio):
el badge por familia/IVA debe irse, el de precio quedarse. RETOMAR AQUÍ.

---

## 🟡 DEUDA TÉCNICA acumulada (versionar/rotar)
- **SQL sin versionar (schema drift, riesgo real):** `sales_dashboard`, fixes RLS de la mañana
  (`current_user_account_ids`, `belongs_to_account`, `is_admin_or_manager_of`), `materialize_recipe_session`,
  `run_mapping`, y la migración de hoy de los CHECK de alérgenos. Crear migraciones en `supabase/migrations/`.
- **Capa 2 dashboard (margen):** construible con cobertura visible. HOY solo ~13% de sale_line tiene
  `computed_cost` (casado catálogo↔escandallo manual, decisión de Julio). Mostrar margen sobre % costeado (honesto).
- Rotar credenciales pegadas en chat (service_role, tokens webhook). www.folvy.app NXDOMAIN.
- `npm audit` (1 vuln high de mammoth). `database.ts` regenerar si hubo cambios de esquema.

---

## ALARMAS DE MARCA CAÍDA (tema vital Llorente29 — APARCADO esperando a Last)
Analizado a fondo: la API pública de Last NO expone el estado abierto/cerrado de marca/canal
("Abrir/Cerrar reparto" de la tablet). Solo `is_enabled` de producto (catálogo, no en vivo en Llorente29).
**Email a Last ENVIADO** preguntando por API/webhook de disponibilidad de marca/canal. ESPERANDO RESPUESTA.
Vías reales: (1) que Last lo exponga, (2) Glovo/Uber directo, (3) inferencia por ventas como puente (frágil,
Julio: "muy lejos de lo que quieren"). NO construir hasta respuesta de Last.
