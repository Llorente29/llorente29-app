# Folvy — Mapa global

> **Qué es esto:** la vista de pájaro de Folvy por zonas y su estado real, para **decidir frentes con contexto completo**.
> Se regenera al cerrar cada avance (igual que `CONTEXTO_CLAUDE.md` §1). El diagrama es `folvy_mapa_global.svg` — SVG versionable (texto diffeable en git), **no** una imagen binaria.
>
> **Regla de oro:** este mapa se regenera DESDE la fuente primaria (BBDD + repo) tras un recon de área, **nunca** desde el relato del CONTEXTO. El CONTEXTO va por detrás; los errores componen.

**Última regeneración:** 2026-06-03

![Folvy mapa global](folvy_mapa_global.svg)

---

## Leyenda de estado

- **construido** — hecho y, donde aplica, verificado en producción.
- **a medias** — parte hecha, parte pendiente (se detalla abajo).
- **vacío de datos** — la estructura existe (tablas/UI/funciones) pero no hay datos cargados; no produce valor hasta poblarlo.
- **pendiente / bloqueado** — no construido, o esperando algo externo.

---

## Zonas

### Entrada de datos
- **Plataformas delivery** — *bloqueado/parcial.* Hoy llegan vía Last.app. Integración directa: Glovo **bloqueado** esperando acceso al stage (ticket INTSUPPO-1382); Uber/JustEat por diseñar. Decisión estratégica: Folvy = integrador directo (ver CONTEXTO §1.0.bis).
- **Last.app (POS)** — *construido.* Webhook en vivo en producción, captura fiscal completa. Regla crítica: deploy SIEMPRE `--no-verify-jwt`.
- **Folvy Connect** — *a medias.* Modelo de conectores + pantallas + cifrado de credenciales con Vault (D2) hechos y verificados. Glovo sembrado pero bloqueado; Catcher esperando credenciales.
- **Ingesta de ventas** — *construido.* Las ventas entran solas (webhook), backfill histórico hecho.

### Kitchen · torre del coste → margen (frente vivo, ver CONTEXTO §1.7)
La cadena que convierte compra real en margen real. **El motor está construido; lo que falta es el combustible (datos reales de compra).**
- **Proveedores / artículos / formato / precio** — *construido (UI v1), vacío de datos.* Modelo completo (`supplier`, `article_supplier`, `recipe_item_purchase_format` anidado), UI v1 reciente, lenguaje de cocinero, cálculo en vivo. Datos: 1/162 raws con precio real.
- **Coste raw** — *construido.* `kitchen_recompute_raw_cost` (last_price ÷ qty_in_base) + trigger automático. Una sola verdad (kitchen_recompute_item delega).
- **Escandallo (coste teórico)** — *construido.* Validado al céntimo. Invariante SUM(líneas)=computed_cost.
- **Ventas / consumo teórico** — *a medias.* Hay algo de dato; el consumo teórico (ventas × escandallo) por explotar.
- **Compras / inventario** — *vacío.* `purchase`/`purchase_line` existen, sin datos. Capa superior (da el diferencial real).
- **AvT / mermas** — *pendiente.* Teórico vs real, ingrediente a ingrediente. Necesita compras + inventario poblados.
- **Margen real** — *pendiente (la cima).* Ver CONTEXTO §1.5. Necesita 3 patas: coste receta (en marcha aquí) + comisión real (Pantalla Canales) + transporte real (Catcher/Jelp).

**Ya construido y que el CONTEXTO no registraba:** cascada de coste a platos (viva: "36 platos recalculados"), coste por local (`kitchen_recipe_cost_by_location`), `location_economics`, `run_mapping` (mapeo IA), helpers IA de cocina (`kitchen_dish_state_for_ai`, `kitchen_similar_dishes_for_ai`), `materialize_recipe_session`, plantillas de familias/etiquetas (`dish_family_template`, `tag_template`).

**Pendiente del frente:** cargar los 162 raws (IA factura→coste, con revisión humana = hueco a ganar vs MarketMan/xtraCHEF) · clasificar raws en familias (55 existen, 0 clasificados → con IA) · buscador + filtro por familia · catálogo de ingredientes estándar español para onboarding (las plantillas ya existen) · mejoras UI (mostrar QUÉ platos se recalcularon; bug coste "–/g" cuando estrategia=fixed).

### Transversales
- **Folvy AI** — *a medias.* Streaming SSE, tool-use, memoria, `run_mapping`, helpers de cocina. IA es prioridad transversal en todos los módulos (apoyo al personal, foto→escandallo, anti-invención).
- **Vigilante de ingesta** — *a medias.* Capas 2+3 construidas y validadas (ping sintético cada 10 min + watchdog Healthchecks + canal `system-alert`). Capa 1 (frescura por horario) = DEUDA OBLIGATORIA enganchada al módulo de Horarios. Ver CONTEXTO §1.6.
- **Ingeniería de menús** — *construido.* `menu_item_economics`, comisión a fuente única (`brand_channel_rate`).
- **Otros módulos** — *construido.* Team, Safety (APPCC), Sales, inicio adaptativo, portal del trabajador.

### Cimiento
- **Shell · Auth (PKCE) · Admin · Multi-tenant RLS · Folvy Connect (Vault)** — *construido y en producción.* Arquitectura modular (añadir módulo = añadir línea en `moduleRegistry.ts`).

---

## Pendientes mayores (frentes futuros)
- **Horarios del cliente** — no existe. Prerrequisito de la Capa 1 del vigilante y de la decisión propio-vs-plataforma. Por estudiar: ¿vive en `brand` o en `location`?, festivos, excepciones.
- **Pantalla Canales** — escritor de `brand_channel_rate` (comisión por marca×canal×reparto). Sin ella, la economía muestra margen NULL (correcto).
- **Transporte Catcher/Jelp** — integración pendiente; pata del margen real. En Llorente29, Glovo/JustEat = reparto propio (Catcher/Jelp); solo Uber lo reparte Uber.
- **Catálogo estándar de onboarding** — semilla de ingredientes/familias para arrancar cliente nuevo. Diferenciador SMB.
- **Glovo G1** — recepción real de pedidos, bloqueado por ticket INTSUPPO-1382.
- **Vigencia temporal de tarifas** — `brand_channel_rate` sin válida-desde/hasta; decisión de modelo antes del motor de margen.
- **Deuda operativa** — rotar token Last (visible en chat), code-splitting bundle, medidor de coste IA por cuenta (prerequisito 2º cliente).
