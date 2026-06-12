# Encargo para Claude Code — Auditoría de UI + Saneamiento de ingredientes

**Contexto:** Folvy acaba de migrar el cliente real **Llorente29 Food**
(`account_id = 51ad1792-6629-4ef7-833a-b57b09a86710`) a producción. Antes de
presentárselo al cliente hay que (1) tener el inventario COMPLETO de elementos de
UI rotos o a medias, y (2) dejar los ingredientes lo más completos posible.

Trabaja en **rama aparte** (`saneamiento/auditoria-ui`), no en `main`. Build verde
antes de cada commit. NO toques `App.tsx`. NO modifiques RLS ni Edge Functions de
webhook sin marcarlo explícitamente. Reporta, no asumas.

---

## FRENTE 1 — Auditoría de botones muertos y funciones a medias (TODO Folvy)

**Objetivo:** producir una LISTA EXHAUSTIVA, no arreglar a ciegas. El entregable es
un informe; los arreglos vienen después, priorizados por Julio.

Barre todo `src/`:

1. **Botones sin acción.** Todo `<button>` (y elementos clicables: `onClick`-ables,
   roles de botón) que NO tengan `onClick`, `type="submit"` dentro de un form
   funcional, ni handler equivalente. Para cada uno reporta: fichero, línea, texto
   visible del botón, y el componente/pantalla donde vive.

2. **Handlers vacíos o placeholder.** Funciones que solo tienen `// TODO`,
   `console.log`, `return` vacío, o un comentario "próximamente" sin lógica real.

3. **Acciones que prometen y no cumplen.** Botones con texto de acción ("Guardar",
   "Crear", "Vincular", "Mejorar con IA", "Aplicar", "Exportar", "Generar"…) cuyo
   handler no llega a llamar a un service/RPC/Edge real (o llama a uno que no existe).

4. **Secciones "Próximamente" / EmptyState permanentes.** Pestañas o secciones que
   siempre muestran vacío o "próximamente" sin ruta de completado.

**Formato del entregable:** un fichero `docs/auditoria_ui_2026-06-12.md` con una
TABLA por módulo (Kitchen, Supply, Team, Safety, Sales, Connect, Admin), columnas:
`Pantalla | Elemento | Texto | Problema | Severidad (bloquea/cosmético) | Fichero:línea`.
Ordena por severidad. NO arregles nada en este frente — solo inventaría.

---

## FRENTE 2 — Diagnóstico y arreglo de "Completar con IA" en ingredientes

**Síntoma observado (Julio, 12/06):** en la ficha de ingrediente (Llorente29), el
botón "Completar con IA" (Edge `enrich-ingredient`) genera sugerencias y, tras el
fix de RLS de hoy, ya GUARDA sin error. PERO queda a medias:
- NO asigna **familia** (queda "Sin clasificar").
- NO asigna **IVA**.
- NO quita el badge **"sin terminar"** (el ingrediente sigue marcado incompleto).

**Tareas:**

1. **Lee `supabase/functions/enrich-ingredient/index.ts`** y determina QUÉ campos
   genera y devuelve hoy. ¿Incluye familia e IVA o no? Documenta el alcance real.

2. **Define el criterio de "terminado".** Localiza en el front (probablemente
   `KitchenItemDetailPage.tsx` o el servicio) qué condición marca un ingrediente
   como "sin terminar" / `needs_review` / "Utilizable". Lista los campos que exige.

3. **Cierra la brecha entre lo que la IA genera y lo que "terminado" exige.** Si la
   IA no propone familia/IVA, amplíala para que lo haga:
   - **Familia:** debe casar con las familias existentes de la cuenta
     (`recipe_family`), no inventar. Si ninguna casa con confianza, dejar sin
     asignar y NO marcar terminado (anti-invención).
   - **IVA:** Folvy YA tiene motor de IVA por familia (`propose_vat_category` /
     `family_vat_default`). El IVA debe salir de ahí en función de la familia
     asignada, NO inventado por la IA. Es decir: IA asigna familia → el motor de
     IVA deriva el tipo. Respeta el motor fiscal existente.

4. **Que "Aplicar seleccionados" deje el ingrediente realmente terminado** cuando se
   aceptan todos los campos: familia casada, IVA derivado, badge "sin terminar"
   retirado. Filosofía Folvy: IA propone, humano decide; cero invención; si falta
   un dato fiable, queda needs_review (no se fuerza "terminado").

5. Regenera `src/types/database.ts` si tocas esquema. Build verde. Documenta en el
   PR qué cambió y por qué.

---

## FRENTE 3 — Completado masivo de ingredientes de Llorente29

**Objetivo:** dejar el máximo de los **76 ingredientes** de Llorente29
(`51ad1792-...`) lo más completos posible, para reducir los "sin terminar".

**Reglas estrictas:**
- Solo cuenta `51ad1792-6629-4ef7-833a-b57b09a86710` (Llorente29). NO toques
  Folvy Interno (`00000000-...0001`).
- Usa el flujo `enrich-ingredient` ya arreglado en el Frente 2 (no un atajo nuevo).
- **Anti-invención absoluta:** datos económicos (precio, proveedor) NO se tocan
  nunca por IA. Familia, alérgenos, conservación, nutrición → propuesta IA, pero si
  la confianza es baja, queda needs_review, NO se fuerza.
- **No auto-aplicar en masa sin red.** Propón un MODO LOTE que genere las sugerencias
  para los 76 y las deje en un estado revisable (Julio/Pamela aceptan), o que
  auto-aplique SOLO los campos de alta confianza (familia que casa exacta, IVA
  derivado del motor) y deje el resto a revisión. Decide el diseño más seguro y
  proponlo en el PR ANTES de ejecutarlo masivamente.
- Reporta: de 76, cuántos quedan completos, cuántos a revisión y por qué.

---

## Entregables

1. `docs/auditoria_ui_2026-06-12.md` (Frente 1, inventario completo).
2. PR con el arreglo de `enrich-ingredient` + criterio "terminado" (Frente 2).
3. Propuesta de modo lote para ingredientes (Frente 3) — diseño primero, ejecución
   tras visto bueno de Julio.
4. Resumen final: qué quedó cerrado, qué quedó como deuda declarada (con motivo).

**Recordatorios de método Folvy:** verificar contra BBDD nunca contra "Success";
benchmark del mejor del mercado antes de rediseñar; deuda 0 (si un paso genera
deuda, rediseñarlo hasta cerrarla; solo declarar deuda si es imposible cerrarla sin
romper el resto, y entonces explícita con su disparador).
