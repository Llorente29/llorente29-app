# Folvy Agent Framework — el marco multi-agente

> Decisión rectora: **no construimos "el agente de Kitchen". Construimos el MARCO de
> agentes de Folvy, y Kitchen es su primera implementación.** El segundo agente
> (Compras, Sala, Equipo…) se montará en horas porque hereda todo: loop, memoria,
> seguridad, contrato de escritura, capa proactiva. Solo cambian sus *tools*, su
> *persona* y su *contexto*.
>
> Punto de partida (RECON): `folvy-ai` tiene buen esqueleto (tool-use loop con
> streaming, contexto parametrizable, memoria + telemetría por cuenta, JWT+RLS
> correcto) pero está **incompleto**: 1 sola tool de lectura, registro de tools
> plano y global, un único system prompt, sin escritura confirmable, memoria sin
> namespace por módulo, front acoplado a Kitchen. No se tira: se **eleva a marco**.
>
> Benchmark del agente: Toast IQ (proactivo + conversacional + accionable). Lo
> igualamos y lo superamos con lo que Toast no tiene: coste y margen reales.
>
> Fecha: 2026-06-29 · Para aprobar antes de tocar código.

---

## 1. Qué es un "agente de Folvy" en este marco

Un agente = **una configuración**, no un programa nuevo. Se define por 4 cosas:

```
Agente = {
  id:            'kitchen' | 'supply' | 'floor' | ...
  persona:       system prompt propio (rol, tono, qué sabe, qué NO hace)
  tools:         conjunto de herramientas (lectura + escritura) de ESE módulo
  proactive:     reglas de la capa proactiva (qué oportunidades vigila)
}
```

El **motor** (loop, streaming, memoria, seguridad, contrato de escritura, telemetría)
es **único y compartido**. Añadir un agente = añadir una entrada al registry. Eso es
lo que hace barato "montaremos más agentes".

---

## 2. Los 5 bloqueantes del RECON → cómo los resuelve el marco

### B1. Registro de tools plano y global → **Registry por agente**

Hoy: `const TOOLS = [TOOL_CATALOG_HEALTH]`, expuesto a todos.
Marco:
```ts
const AGENTS: Record<AgentId, AgentDef> = {
  kitchen: {
    systemPrompt: KITCHEN_PERSONA,
    tools: [catalog_health, recipe_breakdown, dish_economics,
            menu_engineering, avt, ...writeTools],
    proactive: KITCHEN_PROACTIVE_RULES,
  },
  // supply: { ... }   ← el segundo agente, futuro
}
```
El backend recibe `module` (ya viaja end-to-end) y selecciona `AGENTS[module]`.
`toolsForAnthropic()` expone solo las tools de ese agente. Aislamiento total.

### B2. Un solo system prompt → **Persona componible**

`SYSTEM_PROMPT = BASE_FOLVY + AGENTS[module].systemPrompt + MEMORY_CONTEXT`.
- **BASE_FOLVY**: identidad común (eres Folvy, tuteas, no inventas, IA propone /
  humano decide, anti-invención). Compartido por todos los agentes.
- **persona del agente**: "eres el copiloto de cocina; sabes de escandallo, coste,
  margen, AvT; tu trabajo es proteger el margen…".
Así todos los agentes suenan a Folvy pero cada uno es experto en lo suyo.

### B3. Sin escritura confirmable → **Contrato de ejecución con autonomía graduada** (la pieza nueva clave)

Esto es el corazón de "que los agentes actúen y ejecuten, no que informen". Lo
diseñamos contra el **estándar de agentes de 2026** (Amazon Bedrock HITL, DoD
human-in/on/out-of-the-loop, EU AI Act art. 14): **autonomía graduada por tipo de
acción**, no todo-o-nada. Cada tool de escritura declara su **nivel de riesgo**, y el
nivel decide cuánta fricción humana exige:

| Nivel | Modo | Quién aprueba | Ejemplos Kitchen |
|---|---|---|---|
| **L0 — auto** | human-out-of-loop | nadie (audita después) | marcar plato revisado, recostear |
| **L1 — confirmar** | human-in-loop | clic en tarjeta | reprice, vincular escandallo, sustituir ingrediente |
| **L2 — reforzado** | human-in-loop + 2FA-judgment | confirmación reforzada | 86 en todas las plataformas, archivar/borrar, acción masiva |

**El flujo (patrón Bedrock "User Confirmation" + "Return of Control"):**

1. El modelo llama una **write tool**. Su handler **NO escribe**: valida, calcula el
   efecto, y devuelve un **sobre de propuesta** con su nivel de riesgo:
   ```json
   { "status": "pending_confirmation",
     "action_id": "act_abc",
     "risk": "L1",
     "summary": "Subir PVP de 'Birria' de 8,50€ a 9,90€",
     "effect": { "margin_before": 0.62, "margin_after": 0.71, "upside_month": 340 },
     "editable": { "price": 9.90 },            // Return of Control: ajustable
     "rollback": "Revertir a 8,50€ (1 clic)",  // blast radius + plan de reversión
     "execute": { "tool": "update_menu_item", "args": {...} } }
   ```
2. El front **renderiza una tarjeta de acción** (no texto):
   - L0: se ejecuta directo, se muestra "Hecho · [Deshacer]".
   - L1: "Subir Birria a 9,90€ · margen 62%→71% · +340€/mes · [Confirmar] [**Ajustar**] [Cancelar]".
   - L2: además exige confirmar el alcance ("vas a agotar en 3 plataformas").
   - **Ajustar** (Return of Control): el usuario edita el parámetro (p.ej. pone 9,50€)
     antes de confirmar — el efecto se recalcula en vivo.
3. Solo al **Confirmar**, el front llama `commit_action(action_id[, edited_args])` que
   ejecuta la escritura real con el JWT del usuario (RLS aplica). La IA nunca escribe
   sin ese paso.
4. **Audit + rollback**: cada acción ejecutada se registra (quién, cuándo, efecto,
   `action_id`) extendiendo `ai_interaction`, y guarda su plan de reversión. "Deshacer"
   disponible mientras la acción sea reversible.

**Configurable por el cliente:** el nivel de cada acción es un default sensato, pero
el operador puede subir/bajar la autonomía. Esto es human-on-the-loop: el agente opera
dentro de la política que tú defines.

**Por qué es lo más avanzado y lo más seguro a la vez:** cuanto más destructiva la
acción, más fricción (L0→L2). Anti-invención by design (toda escritura pasa por el
contrato). Efecto económico visible **antes** de confirmar — y editable — que es donde
goleamos a Toast IQ (él ejecuta, pero no muestra el impacto en margen antes ni deja
ajustarlo). El contrato es del **marco**: todos los agentes (Kitchen, Team…) lo
heredan; cada uno solo declara el riesgo de sus tools.

### B4. Memoria sin namespace por módulo → **Memoria por módulo + empezar a escribirla**

Hoy `ai_memory` es por cuenta global y **nadie la escribe**. Marco:
- Añadir `module` a `ai_memory` (o convención `key='kitchen:...'`). Índice único pasa
  a `(account_id, module, scope, key)`.
- **Empezar a escribir memoria**: una tool `remember(scope, key, value)` que el
  agente usa para recordar preferencias ("el food-cost objetivo de este cliente es
  28%", "llama 'birria' al plato X"). IA propone recordar → se guarda. Esto es lo que
  hace que el agente **mejore con el uso** (Toast IQ tiene memoria; nosotros también).
- Arreglar el bug del CHECK `surface` (falta `'opening'`, se pierden logs de saludo).

### B5. Front acoplado a Kitchen → **Front por superficie**

- Pasar `module` desde cada montaje del bubble (hoy va `undefined`).
- `SUGGESTED_PROMPTS` y AICards **por agente**, no hardcodeados a Kitchen.
- Render de la **tarjeta de confirmación** (B3) y del **feed proactivo** (capa 3).
- El mismo bubble sirve a todos los módulos; el contenido lo decide `module`.

---

## 3. Las tres capas del agente (sobre el marco ya resuelto)

**Capa 1 — Conversacional (lectura).** Enchufar las tools de lectura de Kitchen que
ya existen como servicios/RPC (Code las listó): `recipe_breakdown`, `dish_economics`,
`menu_engineering`, `avt`, `dishes_incomplete`, `units_sold`, `sales_reliability`.
"¿Mi peor margen?", "¿qué subió de precio?", "¿qué platos usan albahaca?". Horas de
trabajo una vez existe el registry (B1).

**Capa 2 — Accionable (escritura confirmable).** Con el contrato B3: `update_menu_item`
(reprice), `archive_menu_item`, `set_product_availability` (86), `classify_unmapped`,
líneas de escandallo, impactos de modificador. Cada una devuelve sobre de propuesta →
tarjeta → confirma → ejecuta.

**Capa 3 — Proactiva (el "Para ti" de Toast, pero de margen).** Reglas que vigilan y
generan oportunidades en el Resumen de Kitchen:
- "El aceite subió 12%; 8 platos bajan de margen. Ver / reprice."
- "3 Dogs detectados; reprice propuesto = +340€/mes. ¿Reviso?"
- "Albahaca lleva 3 semanas en needs_review."
Cada oportunidad enlaza a una acción confirmable (capa 2). Aquí superamos a Toast: él
avisa de ventas; nosotros de **margen y coste**.

---

## 4. Orden de construcción (marco primero, luego Kitchen)

**Fase A — Marco (lo que todos los agentes heredan).**
1. **Registry por agente** (B1) + **persona componible** (B2). Refactor del edge.
2. **Contrato de escritura confirmable** (B3): sobre de propuesta + `commit_action` +
   tarjeta de confirmación en el front. La pieza nueva grande.
3. **Memoria por módulo** (B4): columna `module` + tool `remember` + fix CHECK.
4. **Front por superficie** (B5): `module` cableado + prompts/AICards por agente.

**Fase B — Kitchen Copilot (primera implementación sobre el marco).**
5. **Capa 1**: tools de lectura de Kitchen (enchufar las que existen).
6. **Capa 2**: write tools de Kitchen con el contrato B3.
7. **Capa 3**: reglas proactivas de margen en el Resumen.

**Validación**: el marco se valida montando el **segundo agente de prueba** (aunque
sea mínimo) — si montar el segundo cuesta horas, el marco está bien hecho. Es la
prueba de fuego de "montaremos más agentes".

---

## 5. Dónde superamos a Toast IQ (la tesis, concreta)

| | Toast IQ | Folvy Kitchen Copilot |
|---|---|---|
| Proactivo | Sí (feed "Para ti") | Sí, **de margen/coste** |
| Conversacional | Sí | Sí |
| Ejecuta | Sí (86, menú, turnos) | Sí, **con efecto económico visible antes de confirmar** |
| Ve ventas/labor | Sí | Sí |
| Ve **coste/margen/AvT/MRP** | **No** | **Sí** |
| Memoria | Sí | Sí (por cuenta+módulo) |
| Multi-agente reutilizable | (propietario Toast) | **Sí, marco propio replicable** |

Toast dice "este plato vende poco". Folvy dice "este plato te hace perder 0,30€ por
venta; súbelo a 9,90€ y ganas 340€/mes — ¿lo aplico?".

---

## 6. Decisiones tomadas (Julio, 2026-06-29)

1. **Marco primero, sin atajos** — lo más sólido para el futuro. Fase A (marco) antes
   de Fase B (Kitchen). Confirmado.
2. **Contrato de ejecución con autonomía graduada** (L0/L1/L2 + Return of Control +
   audit/rollback) — la opción avanzada, estándar 2026. Confirmado (decisión delegada
   a Claude con el mandato "lo más sólido").
3. **Segundo agente = Team (Personal)** — para validar que el marco escala Y para
   ayudar a reorganizar ese módulo, que está mal. Se aborda tras Kitchen probado.
4. **Mandato rector:** los agentes no solo informan — **actúan y ejecutan**. Ambición
   alta: algo muy avanzado en agentes. El contrato de ejecución (B3) es la pieza que
   lo encarna.

### Lo que queda por decidir sobre la marcha
- Niveles de riesgo concretos por cada tool de Kitchen (se fijan al construir cada una).
- Qué acciones expone Team y su persona (al llegar a ese agente).

---

### Nota sobre "Añadir a carta" (Fase 1 del plan, en paralelo)

Decisión de producto tomada con benchmark (Supy/Apicbase): **"Añadir a carta" =
vincular el escandallo a uno o varios `menu_item` existentes** (no crear producto,
que ya se hace en Menú). Resuelve tu cuello de botella real (107 menu_items con
`recipe_item_id` apuntando a escandallos vacíos). El botón abre un selector de
productos de carta (multi-marca) → enlaza `recipe_item_id` → coste y margen fluyen.
Esta pieza no depende del agente; puede ir en paralelo al marco.
