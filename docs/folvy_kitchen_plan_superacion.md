# Plan de superación — Folvy Kitchen: de cerrar huecos a golear

> No se trata de empatar tapando huecos. Se trata de que cada deficiencia se
> convierta en una **ventaja sobre la competencia**, y de que la IA — y un agente
> que viva en el módulo — sea el hilo que lo cose todo.
>
> Benchmark del agente: **Toast IQ** (el estado del arte). Es proactivo (feed "Para
> ti"), conversacional (preguntas en lenguaje natural) y **accionable** (ejecuta:
> 86, añadir plato, actualizar menú). PERO opera sobre datos de Toast: ventas,
> labor, menú. **No tiene escandallo al céntimo, coste de modificador, AvT ni MRP
> II — que Folvy sí tiene.** Ahí está el hueco de mercado para superarlo.
>
> Fecha: 2026-06-29 · Para aprobar antes de ejecutar.

---

## 1. La tesis

Toast IQ demuestra que el ganador de 2026 no es quien tiene más pantallas, sino
quien tiene **un copiloto que ve todo, avisa antes de que preguntes, y ejecuta con
un clic**. Folvy puede tener ese copiloto Y alimentarlo con algo que Toast no tiene:
**el coste y el margen reales**. Un "Folvy Kitchen Copilot" que no solo dice "este
plato vende poco" sino "este plato es un Dog: margen 18%, te cuesta 2,30€, súbelo a
9,90€ y ganas 340€/mes — ¿lo aplico?".

Estrategia: **cada hueco de la auditoría se cierra de forma que, al cerrarlo,
quede por encima del líder**, y la IA es la palanca que convierte el empate en
ventaja. El agente es el destino; las piezas se construyen siendo ya útiles solas y
enchufables al agente después (principio MRP II: capa completa y usable, luego se
conecta).

---

## 2. De cada hueco a una superación

| Hueco (auditoría) | Empate (lo mínimo) | **Superación (lo que haremos)** |
|---|---|---|
| "Añadir a carta" muerto | Cablear el botón | Botón que crea el `menu_item` en la marca/categoría **+ la IA sugiere precio de venta** desde el coste y el food-cost objetivo, y avisa del margen al instante. No solo enlaza: aconseja el PVP. |
| Escalar receta (no existe) | Copiar meez: ×factor | Escalado **por rendimiento, por lote y por ingrediente limitante** ("solo tengo 3 kg de pollo, ¿cuántas raciones salen?") + recalcula coste y merma. meez escala cantidades; Folvy escala **cantidades + coste + stock disponible**. |
| Ingeniería de menús no aplica | Cablear botón aplicar precio | **El agente lo propone proactivamente**: "tienes 3 Dogs y 2 Plowhorses; aquí está el reprice de cada uno y el upside €/mes — ¿aplico los 5?". De análisis a acción en bloque, con IA explicando el porqué. |
| Rentabilidad solo-lectura | Enlazar a la ficha | Enlace + **"arréglalo con IA"**: el copiloto propone dónde recortar coste (ingrediente más caro, merma alta) para meter el plato en food-cost objetivo. |
| Sustituir ingrediente (RPC ok) | Confirmar UI | **IA sugiere el sustituto**: "el precio de la albahaca subió 40%; ¿la cambio por X en los 12 platos donde está? impacto en margen: +2%". Apicbase sustituye a mano; Folvy lo propone. |
| Vídeo por paso | Subir vídeo | **Paso con foto/vídeo + la IA redacta el paso** desde los ingredientes del escandallo (ya enlazados). meez sube media; Folvy lo genera. |
| Versionado de receta | Historial básico | Versionado **con diff de coste**: "esta versión sube el margen 3pts". No solo historial: historial con consecuencia económica. |

---

## 3. El agente: Folvy Kitchen Copilot

El hilo que cose todo. **Reutiliza lo que ya existe** (`folvy-ai` Edge SSE, tool-use
loop, `ai_memory`, `ai_interaction`) — no se construye de cero. Se le dan
**herramientas de Kitchen** y un **modo proactivo**.

Tres capas, en orden de construcción:

**Capa 1 — Conversacional sobre Kitchen (responde).**
"¿Cuál es mi plato con peor margen?", "¿qué ingredientes subieron de precio esta
semana?", "¿qué platos usan albahaca?". Lee escandallo, coste, AvT, ventas. Es
Toast IQ + coste real. *Reutiliza el folvy-ai existente; se le añaden tools de
lectura de Kitchen.*

**Capa 2 — Accionable (ejecuta con confirmación).**
"Sube el PVP de estos 3 Dogs al objetivo" → propone → confirmas → `updateMenuItem`.
"86 las bebidas sin stock" → ejecuta. "Sustituye albahaca por X" → preview →
aplica. **Anti-invención absoluto**: la IA propone, el humano confirma, nunca
escribe sin OK. (El patrón que ya usas en modificadores y OCR.)

**Capa 3 — Proactiva (avisa antes de preguntar).**
El "Para ti" de Toast, pero de coste/margen. Feed en el Resumen de Kitchen:
- "El aceite subió 12%; 8 platos bajan de margen objetivo. Ver / reprice."
- "3 platos sin escandallo llevan 2 semanas; complétalos con IA."
- "Tu Plowhorse 'Burger' vende 300/sem con 31% food-cost; -0,4€ de coste = +180€/mes."
- "Albahaca lleva 3 semanas en needs_review; resuélvela."
Se apoya en lo que ya calculas (AvT, economics, dishes_incomplete) — solo falta el
LLM que lo redacte como oportunidad y el sitio donde mostrarlo.

**Dónde superamos a Toast IQ:** su copiloto ve ventas/labor/menú; el nuestro ve
**coste, margen, merma y MRP**. Toast dice "este plato vende poco"; Folvy dice "este
plato te hace perder 0,30€ por venta y aquí está cómo arreglarlo".

---

## 4. Orden de ejecución (por ROI, no por dificultad)

La forma más eficaz: **primero las piezas de acción que ya tienen el 80% hecho**
(cablear lo que existe), luego el escalado (pieza nueva), luego el agente por capas
(que reúne todo). Así cada paso entrega valor y prepara el agente.

**Fase 1 — Cerrar y superar lo accionable (rápido, alto impacto).**
1. **"Añadir a carta"** cableado + sugerencia IA de PVP. *(Decisión de producto
   pendiente: flujo escandallo→carta vs carta→escandallo.)*
2. **Cerrar ciclo Ingeniería de menús**: cablear ActionCard → aplicar precio /
   archivar. Lo analítico ya está; es el mayor ROI del módulo.
3. **Rentabilidad → acción**: enlazar plato caro → ficha.
4. **Confirmar UI de sustitución** + sugerencia IA del sustituto.

**Fase 2 — La pieza que nos falta.**
5. **Escalado de receta** (RPC + UI): por rendimiento / lote / ingrediente
   limitante, con coste y stock. La feature estrella de meez, superada.

**Fase 3 — El agente (reúne todo).**
6. **Copilot Capa 1** (conversacional Kitchen): tools de lectura sobre folvy-ai.
7. **Copilot Capa 2** (accionable): las acciones de Fase 1 expuestas como tools.
8. **Copilot Capa 3** (proactivo): feed de oportunidades en el Resumen.

**Fase 4 — Pulido y deuda declarada.**
9. Vídeo por paso, versionado con diff de coste, Excel-bulk, limpieza de copy.

---

## 5. Principios (no negociables)

- **Deuda 0**: cada pieza se cierra entera o se declara deuda explícita con su
  disparador. Nada a medias.
- **IA propone, humano decide**: el agente nunca escribe sin confirmación. Anti-
  invención absoluto (needs_review si duda).
- **Cada capa, usable sola**: el escalado vale sin agente; el agente lo usa después.
- **Benchmark antes de cada pieza**: ya hecho para el conjunto; se refina por pieza.
- **Reutilizar, no reconstruir**: el agente parte de folvy-ai, no de cero.
- **Folvy ve el coste**: la ventaja sobre todos es el margen real. Cada feature lo
  explota.

---

## 6. Decisión que necesito de ti antes de arrancar

1. **¿Apruebas este plan y su orden** (Fase 1 → 4)? ¿O reordenas?
2. **El agente — ¿ambición v1?** ¿Empezamos por Capa 1 (conversacional) y subimos, o
   vas directo a por el proactivo (Capa 3, el "Para ti") que es el más vistoso?
3. **"Añadir a carta" — el flujo**: ¿escandallo→carta (un plato creado en Recetas se
   añade a una marca) o carta→escandallo (producto creado en Menú al que se engancha
   escandallo)? Define si se cablea o se rediseña.

Con tus tres respuestas, arranco la Fase 1 pieza por pieza (RECON → diseño →
construir → verificar), y el agente cuando lleguemos a la Fase 3.
