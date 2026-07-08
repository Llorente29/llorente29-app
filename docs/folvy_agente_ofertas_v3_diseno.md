# Folvy — Agente de Ofertas v3 · Diseño

> **Estado:** BORRADOR DE DISEÑO (para aprobación de Julio antes de construir).
> **Ritual seguido:** RECON (código real del agente) → BENCHMARK (Pleez, sector) → DISEÑO (este doc) → [pendiente] construir por piezas → medir.
> **Norte:** el agente debe decidir la **oferta completa** (tipo + alcance + franja + profundidad + canal) cruzando las señales del día, no un número. Cubre **todos los canales** (Uber, Glovo, JustEat, Shop). Goleada, no empate.

---

## 0.bis · DIAGNÓSTICO REAL DEL AGENTE ACTUAL (verificado con datos, 07/07)

Se auditó el agente vivo con datos reales de Llorente29. Cuatro fallos graves, todos con prueba:

1. **EL SHOP ES INVISIBLE.** `select distinct channel_name from agent_sales_signal_v2(...)` → devuelve **solo Glovo y Uber**. El Shop no aparece. El agente nunca lo evalúa. Consecuencia: el storefront foodint está **sin una sola oferta del agente**, pese a que el Shop es el canal de MÁS margen (comisión 5% vs Glovo 15% vs Uber 27%), se **auto-publica** sin robot (`shop_mode=auto`, línea 281/308) y es publicación instantánea. El canal más fácil y más rentable, ignorado desde el origen de datos.

2. **JUSTEAT FUERA.** `PROPOSABLE_PLATFORMS = ["Glovo", "Uber"]` (línea 42). JustEat existe como `sales_channel` activo (comisión 15%+0,42) pero el agente no lo propone.

3. **SE RINDE SIN BUSCAR ALTERNATIVAS.** Log real: Bendito Burrito y Dirty Burger, marcas **a CERO ventas** (0.0-0.1 ped/día) en urgencia máxima, con platos de coste alto (Quesatacos Birria Ternera: precio 15,70 / coste 11,85 = 25% margen SIN descuento). El agente propone 30% en Uber → el suelo de margen (45%) lo descarta (`under: 18`, "ningún plato aguanta el suelo") → **cancela TODO y no prueba nada más**: no baja el % (¿aguanta el 20%? ¿el 15%?), no salta al Shop (donde con 5% de comisión el mismo descuento aguantaría), no cambia de tipo (envío gratis/importe fijo). `campaigns_created: 0`. Las marcas que más necesitan promos se quedan sin ninguna.

4. **SE CALLA CUANDO FALLA.** Al descartar todo, no genera ninguna alerta. Silencio total. El operador no se entera de que una marca está a cero y sin ninguna oferta rentable posible.

**Por qué en Glovo SÍ publica y en Uber/Shop no:** en Glovo publica para OTRAS marcas (Milanesa, Meraki, Mila's, Scandal) cuyos platos tienen mejor margen y aguantan el 25-30% con la comisión más baja de Glovo (15%). En Uber genera propuestas (esperan robot inexistente). Bendito/Dirty (platos caros) no aguantan en Uber y se descartan. El Shop ni se mira. Resultado neto: **el agente parece funcionar (Glovo lleno de propuestas) pero deja a las marcas urgentes sin nada y no toca el canal de más margen.**

**Conclusión que cambia el orden de construcción:** el primer frente NO es el robot Uber. Es **arreglar el cerebro** para que (a) vea los 4 canales incluido el Shop, (b) sea más agresivo en el Shop por su margen amplio, (c) busque alternativas antes de rendirse (bajar %, saltar de canal/tipo), (d) avise cuando de verdad nada funciona. El robot Uber viene después, porque sin cerebro que decida bien, un robot solo ejecuta decisiones pobres más rápido.

---

## 0. Por qué este frente (el problema, con la prueba)

RECON del `offers-agent` actual (339 líneas, `supabase/functions/offers-agent/index.ts`):

- Decide **un solo número**: `pct`, que arranca en 0 y se mueve con `+5`/`−5` según señales.
- **Línea 286:** `const kind = "standard";` — el tipo está **hardcodeado** a "% de descuento". El agente **nunca** decide otro tipo.
- **No existe `time_from`/`time_to`** en el código → la promo es **todo el día**. El agente **nunca** decide franja horaria.
- Alcance siempre `{brand_ids, menu_item_ids, location_ids}`, cogiendo los platos que aguantan el suelo — sin criterio de "más vendidos / parados / mejor margen".

**Traducción:** hoy el agente pone "25 o 30% todo el día". Eso no es goleada. Uber ofrece 8 tipos + franjas + Happy Hour nativo; usar uno es desaprovechar la mejor plataforma.

### Lo que hace el rival que nos mete la goleada (BENCHMARK, fuente primaria)

**Pleez** (rival directo, Portugal/España/UK):
- Ejecuta reglas: rampa visibilidad cuando la demanda es floja, pausa cuando la cocina va a tope; disparadores por **caída de demanda, ventana valle, stock/preparación**; control ciudad y tienda.
- Su IA **recomienda y programa** promos; su dashboard mide qué oferta mueve la aguja **por canal, SKU y HORA** (franja = ciudadano de primera).
- Radar competitivo por scraping.
- **SU CEGUERA (confirmada en su web):** pide al hostelero que **teclee a mano** el % de comisión y el coste de los platos para "beneficiarse de verdad". **Estima el margen; no lo sabe.**

**Nuestra goleada:** margen real del escandallo, al céntimo, vivo, como guardarraíl en CADA tipo de oferta. Pleez ve el escaparate (scraping); nosotros vemos la operación (escandallo + comisión por canal + venta real). Ellos suben precio en noche de partido; nosotros atacamos el valle con margen protegido.

### Señales que mueven la demanda en delivery (investigado, no de memoria)

- **Fútbol** — documentado como driver específico del delivery en España; el pico es del que ve el partido en **casa/bar** (tradición del bocata en el descanso), no del que va al estadio → **es tu cliente** (comida para compartir). Derbis y clásicos, lo más fuerte.
- **Clima** — lluvia/frío disparan; calor extremo también. Driver medido (mayores de 54 = 41% motivados por el tiempo).
- **Día de semana** — el finde es el terreno.
- **Festivos / domingos** — pico documentado en España ("alta demanda los domingos, festivos y días de eventos deportivos").
- **Franja horaria** — las ventas nocturnas QSR crecen >10%/año desde 2021; el mapa del día se ha redibujado. Las plataformas ya mueven precio por hora/clima/evento.
- **Valle horario propio** — atacar las horas más flojas con más agresividad (petición de Julio; Pleez ya lo hace con "off-peak windows").

---

## 1. El cambio de forma

**Hoy:**
```
señales → un número (pct)          [todo el día, tipo fijo "standard"]
```

**v3:**
```
señales → DECISIÓN COMPLETA {
  tipo,          // % artículo | % pedido | importe fijo | 2x1 | artículo gratis | envío gratis | happy hour
  canal,         // uber | glovo | justeat | shop
  alcance,       // marca / platos (más vendidos | parados | mejor margen) / categoría
  franja,        // día(s) + hora_desde/hora_hasta  (puede haber VARIAS por día)
  profundidad,   // el %  (o el importe, o el plato de regalo)
  por_qué        // señales que lo dispararon (auditable)
}
```

El **motor de decisión es UNO SOLO, agnóstico de canal**. Cada canal declara sus **armas disponibles** (matriz §3) y sus **reglas** (chips de %, franjas soportadas, redondeos). El agente solo propone lo que el canal soporta.

---

## 2. Arquitectura (capas)

```
┌─────────────────────────────────────────────────────────────┐
│  CAPA 1 · SEÑALES  (recolectores, cada uno su fuente)        │
│  temporal(hora,dow) · valle_horario · clima · fútbol ·       │
│  festivos · margen_real · stock/parado · objetivo · uplift   │
└─────────────────────────────────────────────────────────────┘
                          ↓  (todas las señales, normalizadas)
┌─────────────────────────────────────────────────────────────┐
│  CAPA 2 · MOTOR DE DECISIÓN  (agnóstico de canal)            │
│  por cada (marca × canal × local habilitado):                │
│    1. estado (crecimiento/mantenimiento/urgente)  ← ya existe │
│    2. ELIGE TIPO         (nuevo)                              │
│    3. ELIGE ALCANCE      (nuevo: vendidos/parados/margen)     │
│    4. ELIGE FRANJA(S)    (nuevo: por tramo del día)           │
│    5. ELIGE PROFUNDIDAD  (el %, ya existe, mejorado)          │
│    6. GUARDARRAÍL MARGEN (por tipo, al céntimo)  ← diferencial │
└─────────────────────────────────────────────────────────────┘
                          ↓  (decisión completa)
┌─────────────────────────────────────────────────────────────┐
│  CAPA 3 · MATRIZ DE ARMAS POR CANAL                          │
│  ¿este canal soporta este tipo/franja? redondeo de %, chips  │
└─────────────────────────────────────────────────────────────┘
                          ↓  (job ejecutable)
┌─────────────────────────────────────────────────────────────┐
│  CAPA 4 · COLA  promo_push_job  (+ tipo + franja + alcance)  │
│         → robot (Glovo/Uber) abre el asistente correcto      │
│         → Shop se auto-publica                               │
└─────────────────────────────────────────────────────────────┘
```

**Principio MRP-II de Folvy respetado:** cada capa es un sistema completo. Las señales nuevas (fútbol, valle) se enchufan como recolectores sin reescribir el motor. La matriz de armas crece por canal sin tocar el cerebro.

---

## 3. La matriz de armas por canal

El agente solo propone lo que el canal sabe ejecutar. Esta tabla es la **fuente de verdad** de qué arma tiene cada canal. Los `?` se cierran con RECON del panel de cada canal antes de construir su brazo.

| Tipo de oferta            | Uber | Glovo | JustEat | Shop | Notas |
|---------------------------|:----:|:-----:|:-------:|:----:|-------|
| % en artículo             | ✅   | ✅    | ?       | ✅   | chips Uber: 20/30/40/50/75 (sin 25) · Glovo: múltiplos de 5 |
| % en pedido               | ✅   | ✅    | ?       | ✅   | |
| Importe fijo (X€ al gastar Y) | ✅ | ?    | ?       | ✅   | Uber: "Importe de ahorro por pedido" |
| 2x1 / compra 1 llévate 1  | ⏸️   | ⏸️    | ?       | ⏸️   | **CONGELADO** hasta sistema de artículo espejo (no por incapacidad — por diseño) |
| Artículo gratis (desde X€)| ✅   | ?     | ?       | ✅   | Uber: "Gratis al hacer una compra" / "Compra 1 y consigue un artículo gratis" |
| Envío gratis              | ✅   | ✅    | ?       | ✅   | |
| Happy Hour (franja nativa)| ✅   | ?     | ?       | —    | Uber lo tiene NATIVO (14-17h ej.) → franja sin truco |

**Nota crítica sobre el 2x1:** está congelado por una razón concreta y correcta (necesita el sistema fiable de artículo espejo, ya diseñado en `folvy_sistema_2x1_diseno.md`). **El resto de tipos NO están bloqueados** y deben construirse. El congelado del 2x1 no justifica quedarse solo en %.

**Cómo se declara en código:** una estructura `CHANNEL_ARSENAL` que por canal lista `{ tipos_soportados, chips_pct, franjas: bool, happy_hour_nativo: bool, redondeo }`. El motor consulta esto antes de proponer. Añadir un canal = añadir una entrada. Añadir un arma a un canal = un flag.

---

## 4. Las señales (Capa 1) — qué son, de dónde salen, qué ya existe

| Señal | ¿Existe hoy? | Fuente | Qué aporta a la decisión |
|-------|:-----------:|--------|--------------------------|
| **Hora / franja** | ❌ | reloj + histórico de pedidos por hora | Elegir la franja de la promo; base del valle |
| **Valle horario** | ❌ | histórico de pedidos por marca×local×hora (nuevo RPC `agent_hourly_signal`) | Detectar las horas más flojas → más agresivo AHÍ (petición de Julio) |
| **Día de semana** | ✅ | `agent_dow_signal` | Finde fuerte / días flojos (ya suma ±5 al pct) |
| **Clima** | ✅ (parcial) | `weather-events` (Open-Meteo) → `local_event` | Lluvia/frío/calor → empuja demanda |
| **Fútbol** | ❌ | **fuente nueva** (§6) | Derbi/clásico/Champions → oferta en la franja del partido (compartir/combos) |
| **Festivos** | ❌ | calendario festivos ES/Madrid (nuevo) | Domingos/festivos = pico |
| **Margen real** | ✅ (guardarraíl) | escandallo + `preview_platform_promo_impact` | GUARDARRAÍL en cada tipo (diferencial absoluto) |
| **Stock alto / parado** | ⚠️ (en reglas) | `recipe_item.current_stock` + ventas | Empujar lo que sobra (alcance = platos parados) |
| **Objetivo vs ventas** | ✅ | `brand_channel_target` + `agent_sales_signal_v2` | Estado crecimiento/mantenimiento/urgente (base actual) |
| **Aprendizaje uplift** | ✅ | `agent_learning_signal` | Sube/baja según lo que funcionó |

Cada señal es un **recolector independiente** que devuelve un valor normalizado. El motor los cruza. Añadir una señal futura (conciertos, nóminas a fin de mes, etc.) = añadir un recolector, sin tocar el motor.

---

## 5. El motor de decisión (Capa 2) — cómo elige la oferta completa

Por cada `(marca × canal × local habilitado)`:

### 5.1 Estado (ya existe, se conserva)
`urgente` (a cero con objetivo) → `crecimiento` (< umbral) → `mantenimiento` (va bien). Base actual intacta.

### 5.2 Elegir TIPO (nuevo)
Reglas señal→tipo, ordenadas por prioridad. Ejemplos (a afinar con Julio):

- **Fútbol hoy (derbi/clásico/Champions)** + marca de compartir → **% en artículo** sobre combos/compartir, en la **franja del partido**. (Cuando el espejo esté: 2x1 en compartir.)
- **Valle horario detectado** → **Happy Hour** (Uber nativo) o **% con franja** en la franja floja, más agresivo.
- **Objetivo urgente / a cero** → **% artículo** profundo (artillería), always-on.
- **Plato(s) parado(s) con stock alto** → **artículo gratis desde X€** con ese plato de regalo, o **% en ese plato**.
- **Ticket medio bajo** (histórico) → **importe fijo (X€ al gastar Y)** o **envío gratis desde Z€** para subir el AOV.
- **Mantenimiento (va bien)** → **% bajo de mantenimiento** (5-10%) para no perder ranking (política actual de cobertura total).

Cada regla solo se dispara si el canal soporta ese tipo (Capa 3). Si el tipo elegido no está disponible en el canal, cae al siguiente de la lista (degradación ordenada, nunca "no hago nada").

### 5.3 Elegir ALCANCE (nuevo)
- **Más vendidos** (mix real): para arrastrar ranking y volumen.
- **Parados con stock**: para vaciar.
- **Mejor margen**: para promocionar sin dolor (cuando el objetivo es visibilidad, no sacrificio).
- El guardarraíl de margen (5.6) **excluye** del alcance los platos que caen bajo el suelo — como hoy, pero por tipo.

### 5.4 Elegir FRANJA(S) (nuevo — el gran salto)
- Analiza el histórico por hora → identifica tramos: mañana / comida (13-16) / cena (20-23) / madrugada.
- Puede proponer **VARIAS franjas distintas** en el mismo día (p.ej. Happy Hour 15-18h + oferta de cena 21-23h).
- Fútbol → franja = ventana del partido (± margen).
- Uber soporta franjas nativas (Happy Hour + horario personalizado del asistente que ya vimos: días + hora_desde/hora_hasta). Glovo soporta días de semana. El Shop soporta franjas por RPC.
- La franja va en el job (`time_from`/`time_to` + `weekdays`), y el robot la mete en el asistente (el datepicker/Programa personalizado de Uber que ya reconocimos).

### 5.5 Elegir PROFUNDIDAD (mejora de lo actual)
El motor de `pct` actual se conserva (crecimiento/mantenimiento/urgente + ajustes DOW/clima/uplift), pero:
- Se **redondea a los chips del canal** (Uber 20/30/40/50/75 **hacia arriba** por decisión de Julio; Glovo múltiplos de 5).
- Para tipos no-%, la profundidad es el importe (fijo) o el plato (regalo), no un %.

### 5.6 GUARDARRAÍL DE MARGEN por tipo (el diferencial)
Antes de encolar, se calcula el **margen real tras la oferta** con el escandallo + comisión del canal sobre base rebajada (`preview_platform_promo_impact` ya lo hace para %). Para cada tipo:
- **%**: ya resuelto (`preview_platform_promo_impact`).
- **Importe fijo / envío gratis / artículo gratis / 2x1**: cada uno necesita su cálculo de margen (varios ya existen: `preview_bogo_mirror_price` para 2x1, la cascada del Shop para envío/regalo). El diseño de construcción los reutiliza.
- Platos bajo el suelo → **excluidos del alcance** (como hoy). Si ningún plato aguanta → oferta **descartada** con motivo (como hoy).

**Nadie más hace esto** (Pleez estima; nosotros medimos). Es la línea que se cuenta al hostelero.

---

## 6. Fuente de eventos (fútbol + festivos) — señal nueva

No existe hoy. Necesita un recolector nuevo, patrón idéntico a `weather-events`:

- **Edge `sports-events`** (cron diario, como el meteorólogo): consulta un calendario de partidos (LaLiga/Champions) filtrado por **Madrid** (Real, Atlético — el derbi madrileño es local para los 3 locales de Llorente29) → escribe en `local_event` (tipo `football`, con `kickoff`, `importance`: derbi/clásico/normal, `demand: up`).
- **Festivos**: tabla/calendario de festivos nacionales + Madrid → `local_event` (tipo `holiday`).
- El motor lee `local_event` (que ya usa para clima) y ahora también ve fútbol y festivos.

**Fuente de datos de partidos:** a decidir (API de fútbol, o scraping de un calendario). RECON aparte antes de construir esta pieza. **No bloquea el resto del diseño** — es un recolector que se enchufa; el motor funciona sin él y mejora con él (MRP-II).

---

## 7. La cola (Capa 4) — qué cambia en `promo_push_job`

Hoy el job lleva: `coupon_id, platform, brand_id, location_id, action, payload{kind:"standard", value, scope, ...}`.

v3 añade al payload (el robot lo lee para saber qué asistente abrir y cómo rellenarlo):
- `kind` → deja de ser "standard" fijo; ahora es el tipo real (`item_percent`, `order_percent`, `flat`, `free_item`, `free_delivery`, `happy_hour`, `bogo`).
- `time_from` / `time_to` / `weekdays` → la franja (nuevo).
- `alcance_criterio` → informativo (más_vendidos/parados/margen), para auditoría.
- El robot, por `platform` + `kind`, abre el asistente correcto (en Uber: el `data-testid` de la tarjeta — `discounted_item_tool_card`, `bogo_tool_card`, `percent_tool_card`, `flat_tool_card`... ya identificados en RECON).

**Nota:** `promo_push_job` NO admite estado `paused` (CHECK: pending/sent/done/error). No se toca eso aquí.

---

## 8. Orden de construcción propuesto (deuda 0, por piezas, cada una probada)

Esto NO se construye de golpe. Orden sugerido (Julio decide):

1. **Robot Uber para % (item_percent)** — cerrar el circuito Uber de punta a punta con el tipo que el agente YA propone. Paridad Glovo↔Uber. (Ya tenemos el RECON del panel Uber hecho: login, locales multi-check por calle, marcar platos con `+`, chips de %, duración, crear.)
2. **Matriz de armas `CHANNEL_ARSENAL`** en el agente — declarar qué tipo soporta cada canal. Base para todo lo demás.
3. **Señal valle horario** (`agent_hourly_signal`) + el motor elige **franja** → primeras promos con franja (Happy Hour Uber nativo).
4. **El agente elige TIPO** (no solo %) — empezando por los tipos ya soportados y con margen resuelto (% pedido, importe fijo, envío gratis).
5. **Señal fútbol/festivos** (`sports-events` + festivos) → el motor la cruza.
6. **El agente elige ALCANCE** (más vendidos / parados / margen).
7. **Robot Uber para los demás tipos** (por `data-testid` de cada tarjeta).
8. **2x1** — cuando el sistema de artículo espejo esté (frente aparte ya diseñado).
9. **JustEat** — cuando se cierre su RECON (los `?` de la matriz).

Cada paso: RECON de lo que toca → construir → probar en vivo → medir contra benchmark.

---

## 9. Guardarraíles y principios (innegociables)

- **Margen real en cada tipo** (nunca estimado). Plato bajo suelo → excluido. Ninguno aguanta → descartada con motivo.
- **Cedidas (licensed) JAMÁS en plataforma** (solo Shop). Se conserva.
- **El agente PROPONE, el humano APRUEBA** (Kitchen→Ofertas), el robot publica. La puerta de control se conserva.
- **Cobertura total** (todo marca×canal×local tiene oferta) — política actual, se conserva.
- **Uber nace `active=false`** ("publicar a mano") hasta que su brazo (robot o API) esté; con el robot Uber, pasa a armado.
- **Verificar contra la verdad de la plataforma** antes de crear (idempotencia, no duplicar) — como el robot Glovo v3.18.

---

## 10. Preguntas abiertas para Julio (antes de construir)

1. **Reglas señal→tipo (§5.2):** ¿las tablas de "qué tipo para qué situación" las fijas tú (tu criterio de hostelero) o las propongo yo y las afinas? (Ej: ¿fútbol → % en compartir, o prefieres importe fijo para subir ticket?)
2. **Fuente de partidos (§6):** ¿tienes preferencia (API de fútbol de pago fiable vs scraping gratis)? ¿Solo Madrid (Real/Atlético) o también Champions/selección?
3. **Franjas (§5.4):** ¿cuántos tramos quieres distinguir (mañana/comida/cena/madrugada) y con qué horas para tu operación?
4. **Orden de construcción (§8):** ¿empezamos por el robot Uber % (cerrar circuito) o prefieres construir primero el cerebro (matriz + tipo + franja) y luego los robots?
5. **JustEat:** ¿está activo para Llorente29? ¿RECON de su panel entra en este frente o se deja para después?
