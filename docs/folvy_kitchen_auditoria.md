# Auditoría de cierre — Módulo Folvy Kitchen

> Objetivo: dejar Folvy Kitchen **cerrado definitivamente**. Que cada botón funcione,
> que la lógica de trabajo oficina↔cocina tenga sentido, que Folvy sea el editor de
> todo, y que en cada área estemos **al menos al nivel de los mejores** (Apicbase,
> meez, R365, Toast). El foco es **dónde perdemos** y qué hacer para alcanzarlos.
>
> Método: RECON factual del repo+BBDD (Claude Code, 9 agentes, botón a botón) ×
> benchmark competitivo a fondo (web) × verificación SQL. No es opinión: es lo que
> el código hace hoy contra lo que hacen los líderes.
>
> Fecha: 2026-06-29 · Cuenta de trabajo: Folvy Interno (0000…0001)

---

## 1. Veredicto global

El módulo está **sólido y es editor real**: de 9 páginas, **5 escriben en BBDD**
(Menú, Disponibilidad, Ingredientes, Proveedores, Recetas) + Ajustes; **3 son
analítica de solo-lectura por diseño** (Resumen, Rentabilidad, Ingeniería); **0
rotas, 0 vacías**. "Folvy es el editor de todo" se cumple.

No estamos lejos del cierre. Lo que falta no es reconstruir: es **tapar un puñado de
huecos concretos** — un botón muerto, una pieza que la competencia tiene y nosotros
no (escalado), y cerrar el ciclo de dos dashboards que recomiendan pero no dejan
actuar.

---

## 2. Estado por zona (factual + benchmark + hueco)

### 2.1 Resumen — `KitchenDashboardPage.tsx` · solo-lectura
- **Qué hace:** dashboard agregador. 4 filas de navegación (ingredientes sin coste,
  recetas sin terminar, platos sobre food-cost, platos sin foto). No persiste.
- **Benchmark:** R365/meez tienen "home" operativo con alertas accionables.
- **Hueco:** ninguno grave. Es un índice de tareas correcto. "Movimientos de precio
  7d" y "alérgenos auto" están declarados pendientes (texto, no botón roto).
- **Veredicto:** 🟢 al nivel. Cierra tal cual.

### 2.2 Menú — `KitchenMenuPage.tsx` · completa (escribe intensivo)
- **Qué hace:** crear productos/combos/categorías, recategorizar en bloque,
  reordenar (↑↓), borrar (soft), publicar a plataformas (HubRise), ver excepciones,
  deshacer. CRUD real + push externo.
- **Benchmark (Toast):** jerarquía menú→grupo→item, reutilización con propagación,
  preview POS. Folvy ya hace lo equivalente y además **publica a delivery**.
- **Hueco:** menor. Con `catalog_source='pos'` se oculta "Publicar" pero **no se
  bloquea la edición local** (coherencia: si es espejo del TPV, ¿debería avisar?).
- **Veredicto:** 🟢 al nivel o por encima (publicación a plataformas es plus). Cierra
  con un aviso opcional de coherencia pos/folvy.

### 2.3 Disponibilidad / 86 — `KitchenAvailabilityPage.tsx` · completa
- **Qué hace:** agotar/reactivar producto con cascada cross-brand y **push real a
  Glovo/Uber/JustEat**. Alcance "indefinido / solo hoy".
- **Benchmark:** el 86 con push multi-plataforma es exactamente lo que piden los
  agregadores. Toast/R365 86'an pero no siempre empujan a las 3 plataformas.
- **Hueco:** ninguno. "Reactivar" se desactiva si no hay producto representativo
  (correcto, no es bug).
- **Veredicto:** 🟢 por encima de la media. Cierra tal cual.

### 2.4 Ingredientes — `KitchenItemsPage.tsx` + `KitchenItemDetailPage.tsx` · completa
- **Qué hace:** CRUD intensivo. Ficha con coste, proveedores/formatos, stock+niveles,
  IVA versionado, conversiones (unidades de uso), alérgenos/nutrición, foto, IA de
  ficha (`enrichIngredientsBulk`, `IngredientAiAssistButton`), recoste, adopción
  desde master, sustituir/añadir/quitar de platos, marcar reventa.
- **Benchmark (Apicbase):** múltiples paquetes+proveedores por ingrediente, filtros
  potentes (proveedor/outlet/alérgeno/categoría), import/export Excel en bloque,
  **swap de ingrediente en todas las recetas**, IA que casa ingrediente importado.
- **Dónde GOLEAMOS:** clasificación **AECOC CEP** (lenguaje proveedor ES; Apicbase
  usa categorías genéricas) · **unidades de uso amigables** ("1 papel", "1 loncha";
  Apicbase obliga a gramos) · **master con efecto red** (Apicbase no comparte base
  entre clientes) · IVA versionado por fecha.
- **Huecos:**
  - **Edición masiva Excel** (import/export bulk) — Apicbase la tiene; Folvy edita
    1-a-1 + IA bulk. Menor para SMB.
  - "Cortes y merma" y chip "Stock aquí" del hero = placeholders honestos
    ("Próximamente"). El stock real sí está en su sección.
  - Copy "Nutrición: pendiente de editor" miente — sí guarda. Corregir texto.
- **Veredicto:** 🟢 al nivel o por encima. Huecos menores. Cierra con limpieza de
  copy + decidir si Excel-bulk entra o se declara.

### 2.5 Proveedores — `SuppliersPage.tsx` · completa
- **Qué hace:** CRUD de proveedor + artículos (precio/pactado/formato/preferido),
  **migración de artículos entre proveedores** con preview, archivar.
- **Benchmark (Apicbase):** gestión de proveedores, comparación de precios, catálogos
  integrados que actualizan precio automático.
- **Hueco:** **catálogo de proveedor integrado** (que el proveedor empuje su tarifa)
  — Apicbase lo tiene con proveedores integrados; Folvy carga manual/OCR. Esto es
  frente MRP II futuro, no de Kitchen. Aquí no es carencia.
- **Veredicto:** 🟢 al nivel. La migración con preview es de hecho más cuidada que la
  media. Cierra tal cual.

### 2.6 Recetas / Escandallos — `KitchenRecipesPage.tsx` + `RecipeEditorPage.tsx` · completa
- **Qué hace:** escribe `recipe_item`, `recipe_line`, pasos, impactos de modificador,
  fotos. **Importar ficha con IA** (`extractRecipeSession`→`materializeRecipeSession`),
  **duplicar** (RPC), **sub-recetas** (sección `+`), merma con IA, pasos con orden,
  modificadores con IA (propone→confirma).
- **Benchmark (meez):** **escalado 1-clic** (×porciones/batch/por ingrediente, con
  conversión) · **foto Y VÍDEO por paso** (entrena 70% más rápido) · versionado ·
  bakers % · importador IA · sub-recetas.
- **Dónde GOLEAMOS:** **impacto de modificador en coste con IA** (meez no lo tiene;
  R365 lo cobra como add-on con su soporte detrás — nosotros self-service) ·
  importador IA de ficha **ya existe** · sub-recetas **ya existen** · merma con IA.
- **Huecos:**
  - **⚠️ "Añadir a carta" — BOTÓN MUERTO** (`RecipeEditorPage.tsx:2330`, sin onClick).
    Es el **puente escandallo→carta**. Único botón realmente roto y relevante del
    módulo. **Prioridad #1.**
  - **Escalar receta — NO EXISTE** (confirmado por SQL: no hay función de scaling).
    meez lo vende como su estrella. **Prioridad #2.**
  - **Vídeo por paso** — Folvy tiene foto por paso; meez tiene vídeo. Menor.
  - **Versionado/aprobaciones** de receta — Apicbase/meez (governance multi-sitio).
    Relevante solo a escala enterprise. Declarar deuda.
  - Solapas placeholder (Etiquetado/Histórico/Más), Mic, "Pedir a Folvy" = honestos
    "próximamente".
- **Veredicto:** 🟡 al nivel salvo **2 huecos a tapar** (Añadir a carta + escalado).
  Con esos dos, pasa a 🟢 y por encima (por el coste de modificador IA).

### 2.7 Rentabilidad — `KitchenProfitabilityPage.tsx` · solo-lectura
- **Qué hace:** economía por plato (food-cost, margen) vía RPC. Solo SELECT.
- **Benchmark (R365):** food-cost real-time + **acción** (re-precio, ajuste de
  porción) desde el mismo sitio.
- **Hueco:** **no deja actuar.** Muestra platos sobre food-cost objetivo pero no
  enlaza a "arréglalo". Perdemos en accionabilidad, no en cálculo.
- **Veredicto:** 🟡 cálculo al nivel, falta el puente a la acción (enlazar cada plato
  caro a su ficha de escandallo). Arreglo barato.

### 2.8 Ingeniería de menús — `KitchenMenuEngineeringPage.tsx` · solo-lectura
- **Qué hace:** matriz Kasavana-Smith (Stars/Plowhorses/Puzzles/Dogs) por margen ×
  popularidad, periodo 30/90/365, por canal. Calcula **precio objetivo** y **upside
  €/mes**.
- **Benchmark (R365/meez/Toast):** la misma matriz es el estándar — **pero todos
  cierran el ciclo**: recomiendan Y dejan aplicar (re-precio, promocionar, archivar).
- **Hueco:** **cierre de ciclo ausente.** Calcula el precio objetivo y el upside pero
  **no hay botón para aplicarlo** — y los servicios (`updateMenuItem`,
  `archiveMenuItem`) **ya existen**, solo falta cablearlos. Las ActionCard son texto.
- **Veredicto:** 🟡 análisis al nivel de R365, falta la acción de 1 clic. Es el hueco
  de mayor ROI: la pieza analítica (lo difícil) ya está; falta el botón (lo fácil).

### 2.9 Ajustes — `KitchenSettingsPage.tsx` · completa
- **Qué hace:** comisiones por canal (defecto que siembra marcas). Escribe.
- **Benchmark:** configuración de comisiones es poco común tan accesible.
- **Hueco:** "overrides por marca×canal" anunciado como futuro (texto, no roto).
- **Veredicto:** 🟢 al nivel. Cierra. (Nota: Ajustes está casi vacío — solo
  comisiones. La deuda declarada "zona Ajustes con 3+ configs de Kitchen" sigue
  pendiente, pero no bloquea.)

---

## 3. Cuadro de huecos — dónde perdemos y qué hacer

Ordenado por gravedad. "Para alcanzarlos" = lo mínimo para estar al nivel del líder.

| # | Hueco | Estado hoy | Líder | Gravedad | Para alcanzarlos |
|---|-------|-----------|-------|----------|------------------|
| 1 | **"Añadir a carta"** (puente escandallo→carta) | Botón muerto sin onClick | Todos | 🔴 Alta | Cablear: crear/enlazar `menu_item` desde el escandallo a una marca/categoría. O esconderlo si el flujo es al revés (carta→escandallo). |
| 2 | **Escalar receta** (×porciones/batch/por ingrediente) | No existe (SQL confirmado) | meez | 🔴 Alta | RPC `scale_recipe(recipe, factor\|target_yield\|target_qty)` que recalcula líneas con conversión; UI con selector de factor. |
| 3 | **Cierre de ciclo Ingeniería de menús** | Calcula precio objetivo, no lo aplica | R365/meez/Toast | 🟠 Media | Cablear las ActionCard a `updateMenuItem`/`archiveMenuItem` (ya existen). Botón "Aplicar precio objetivo" + "Archivar Dog". |
| 4 | **Rentabilidad → acción** | Solo lectura | R365 | 🟠 Media | Enlazar cada plato sobre food-cost a su ficha de escandallo (navegación). Barato. |
| 5 | **Sustituir ingrediente en bloque (UI)** | RPC existe, falta confirmar botón | Apicbase/meez | 🟡 Baja | Verificar que el modal "Sustituir de platos" llama a `substitute_ingredient_in_recipes` con preview. Si no, cablear. |
| 6 | **Vídeo por paso** de preparación | Foto sí, vídeo no | meez | 🟡 Baja | Permitir adjuntar vídeo a `recipe_item_step` (storage). |
| 7 | **Edición masiva Excel** (import/export) | IA bulk sí, Excel no | Apicbase | 🟡 Baja | Export/import CSV de ingredientes. Útil para onboarding masivo. |
| 8 | **Versionado / aprobaciones** de receta | No existe | Apicbase/meez | 🟡 Baja (enterprise) | Governance multi-sitio. Declarar deuda; no bloquea SMB. |

---

## 4. Dónde GOLEAMOS (para el balance honesto)

No todo es hueco. Folvy ya está **por encima** de los líderes en:

- **Impacto de modificador en coste con IA self-service** — R365 lo cobra como add-on
  beta con worksheet y su soporte detrás; meez no lo tiene. Nosotros: IA propone /
  humano confirma, en la ficha, gratis. (Construido hoy.)
- **Previsualización de cocina fiel** del modificador (SIN/+ en color, misma lógica
  que el ticket real) — nadie conecta el editor de oficina con la vista de cocina así.
- **Clasificación AECOC CEP** — lenguaje de proveedor español; los demás usan
  categorías genéricas.
- **Unidades de uso amigables** ("1 papel", "1 loncha") — meez/Apicbase obligan a
  gramos.
- **Master de ingredientes con efecto red** — base compartida entre clientes con
  consentimiento; nadie más.
- **AvT / inventario perpetuo** dentro del mismo módulo — meez explícitamente "no es
  contabilidad ni inventario"; Folvy sí.
- **Escandallo al céntimo validado contra tspoon** + economía de plataformas
  reconciliada (comisión por canal/marca, margen real ponderado).
- **MRP II de ciclo cerrado** como destino — meez/Apicbase se quedan en recetas+coste.

---

## 5. Plan de cierre — orden propuesto

Para declarar Folvy Kitchen cerrado, en este orden (de mayor a menor ROI / urgencia):

1. **Cablear o esconder "Añadir a carta"** (#1). Decisión de producto primero:
   ¿el flujo es escandallo→carta (cablear) o carta→escandallo (esconder)? Es el único
   botón muerto relevante; no puede quedar así al cierre.
2. **Escalar receta** (#2). Es la pieza que la competencia tiene y nosotros no. RPC +
   UI. Frente acotado.
3. **Cerrar ciclo Ingeniería de menús** (#3). Máximo ROI: lo analítico ya está, falta
   el botón. Cablear ActionCard → `updateMenuItem`/`archiveMenuItem`.
4. **Rentabilidad → acción** (#4). Enlazar platos caros a su escandallo. Barato.
5. **Verificar sustitución en bloque (UI)** (#5). Probablemente ya cableado; confirmar.
6. **Limpieza de copy** (Nutrición "pendiente", chip "Stock aquí", placeholders) —
   que ningún texto mienta sobre lo que hace.
7. **Declarar deudas explícitas** (no bloquean cierre): vídeo por paso, Excel-bulk,
   versionado/aprobaciones, zona Ajustes ampliada, overrides marca×canal.

Con los puntos 1-6 hechos y el 7 declarado, **Folvy Kitchen queda cerrado al nivel de
los mejores, ganando decisivamente en modificadores+coste, AvT y MRP II**.

---

## 6. Apéndice — fuentes

- **Factual:** Claude Code, 9 agentes paralelos, lectura real de cada componente +
  hijos + servicios, botón a botón (2026-06-29).
- **SQL:** verificación de funciones de escalado (no existe) y sustitución (existe:
  `preview_substitute_ingredient`, `substitute_ingredient_in_recipes`).
- **Benchmark:** Apicbase (ingredientes, recetas, IA), meez (recetas, escalado,
  vídeo, menu engineering), R365 (modifier rules, menu engineering, food costing),
  Toast (modifier groups reutilizables, jerarquía de menú, matriz). Web, 2026-06-29.
