# Folvy Team · F10 — Rediseño del generador + Motor de decisión de horarios

> **08/08/2026.** Sustituye el estado "F10 ✅ motor" del addendum del 07/08, que era **incorrecto**.
> Alinea y extiende `folvy_team_generador_cuadrantes_diseno.md` (06/08) y el plan A→D del 10/07.
> **Todo dato de este documento está verificado contra la BBDD viva o contra los CSV de Uber del 08/08.**

---

## 0. Decisiones vigentes que este documento NO revisa

| Decisión | Fecha | Doc |
|---|---|---|
| **Turnos = Opción 2**: horas de entrada/salida dinámicas pegadas a la demanda | 10/07 | `folvy_team_autoscheduling_benchmark_diseno.md` |
| Semáforo verde/ámbar/rojo **reservado a cobertura**; demanda en teal secuencial | 10/07 | ídem |
| **12 platos/cocinero-hora** como suelo del prior | 10/07 | ídem |
| Clima y eventos **apagados** hasta 20-30 locales | 10/07 | ídem |
| Driver `cubiertos` = hueco a propósito | 10/07 | ídem |
| **NO scraping de ventas de competidores** para decisiones de dinero | 06/08 | §8 diseño generador |
| Paleta de marca: marino `#1E3A5F`, terracota `#D67442`, crema `#F5F4F0` | — | `folvy-brand-spec.md` |
| **No destrucción**: nada se borra/renombra sin inventario y aprobación de Julio | 06/08 | `folvy_reglas.md` |

---

## 1. Por qué F10 estaba mal marcado

`propose_schedule` **no es el generador diseñado**. Es un rellenador voraz de cobertura.
Cuerpo vivo verificado por `pg_get_functiondef` el 08/08.

**Lo único que respeta:**
- Vacaciones aprobadas (filtro duro ✅)
- No repetir persona el mismo día
- Prioriza empleados del local
- Reparte por horas ya acumuladas en la semana

**Lo que ignora — y explica todos los síntomas:**

| Restricción (Capa 4 del diseño) | ¿Está? | Síntoma observado |
|---|---|---|
| Descanso semanal 1,5 días (art. 37.1 ET) | ❌ | **7 días seguidos** |
| Horas contratadas (suelo y techo) | ❌ | No cubre la jornada de los contratados |
| Descanso 12 h entre jornadas (art. 34.3) | ❌ | Cierra 00:15 y entra a las 10:00 |
| Tope 80 h extra/año (art. 35.2) | ❌ | — |
| Nocturno sin horas extra (art. 36) | ❌ | — |
| Usa la previsión de demanda | ❌ | Tira de `coverage_mon..sun` **estáticos** |
| Declara si sobra o falta plantilla | ❌ | Si no hay candidatos devuelve menos filas, **en silencio** |
| IA, conversacional, tres montones, aprendizaje | ❌ | No existe |

**Causa raíz del "7 días seguidos":** el único guard por persona es "que no esté ya asignada *ese* día".
No hay ninguna comprobación de días consecutivos en la semana.

**Veredicto:** ~15-20 % del generador diseñado. Estado real: **🔴 no apto — produce cuadrantes ilegales.**

---

## 2. Hallazgos verificados el 08/08 (fuente primaria)

### 2.1 Las plantillas de turnos piden el doble de lo que existe

| Local | Empleados | Horas contratadas/sem | Horas que piden las plantillas | Déficit |
|---|---|---|---|---|
| Alcalá | 3 | 120 h | 211,3 h | −91,3 h |
| Carabanchel | 3 | 120 h | 259,8 h | −139,8 h |
| Plaza Castilla | 0 activos | 0 h | 79,5 h | — |

**No falta contratar: las plantillas cuentan doble.** En Alcalá conviven `Mañana` 12:30–16:45 y
`Mañana1` 12:30–16:00 (1 persona cada una), y `Tarde/Noche F/S` 19:45–00:15 con `Tarde/Noche`
19:45–23:45 (2 personas cada una) → 4 personas donde hay 3 en todo el local.
Es la deuda **F7.2**, pendiente de decisión de Julio. **No tocar sin inventario.**

Consecuencia: el generador persigue una necesidad inflada al doble y, sin restricciones, la
cubre repitiendo a las mismas personas todos los días.

### 2.2 El dato de contrato NO está tan sucio como decían los docs

- `contracted_hours_week` = **40,00 en los 8 empleados** (100 % poblado). El solver ya tiene suelo y techo.
- `contract_type` = 'Indefinido' en los 6 activos; null solo en los 2 **inactivos**.
  El "null en 5 de 9" de los docs está **desfasado**.
- Sigue faltando: distinción completa/parcial, `shift_code`, `shift_period`, `rest_pattern` (todos null).
- ⚠️ **Dos campos compiten**: `weekly_hours` (Natacha 43,5 · Johanny 40,25) vs `contracted_hours_week` (40,00).
  `compute_employee_balance` usa el segundo (177,14 h/mes = 40×52÷12 ✅).
  **El solver debe usar `contracted_hours_week`.** `weekly_hours` queda declarado como ambiguo.

### 2.3 Economía real por ticket

| Concepto | Valor | Fuente |
|---|---|---|
| Ticket medio | **24,67 €** | 2.407 ventas con escandallo, 90 días |
| Food cost | **28,0 %** → 6,90 € | `sale_line.computed_cost` |
| Margen bruto | 17,77 € | derivado |
| Comisión plataforma (~30 %) | −7,40 € | estimación |
| **Margen de contribución** | **~10,4 €/ticket** | |
| **Coste laboral real** | **11,98 €/h** | 10.600,90 € nóminas julio ÷ 885,1 h fichadas |
| **Umbral de equilibrio** | **~1,2 tickets/hora** con 1 persona | |

⚠️ **Deuda de dato bloqueante**: **3.334 de 5.741 tickets no tienen escandallo casado**.
El 28 % sale solo de los 2.407 que sí. **Cerrar este hueco antes de que el motor decida con este número.**

### 2.4 La curva de apertura real (informe `restaurant_menu_downtime`, julio, minutos/hora)

| Hora | L-J | V-D |
|---|---|---|
| 13:00–15:00 | ~45 | ~42 |
| 16:00 | 13,5 | 39,0 |
| **17:00–19:00** | **0,4** (cerrado) | **36,5** (abierto) |
| 20:00–23:00 | ~44 | ~40 |

Confirmado: **entre semana hay un corte de 17:00 a 19:00; el finde es continuo.**
Corrige el error de análisis del 08/08 (agregar sin segmentar por día de semana produjo una
falsa señal de "experimento natural"). **Regla dura nueva: nunca agregar horarios sin segmentar L-J / V-D.**

### 2.5 El hallazgo operativo — la plantilla YA está dentro

Alcalá, entre semana, personas fichadas vs tickets:

| Hora | Personas | Tickets | Tienda |
|---|---|---|---|
| 16:00 | 1,29 | 2,18 | cerrando |
| **17:00** | **1,22** | **0** | **CERRADA** |
| 18:00 | 1,29 | 2,00 | cerrada casi siempre |
| **19:00** | **1,94** | **0** | **CERRADA** |
| 20:00 | 2,00 | 8,56 | abierta |

**A las 19:00 hay casi dos personas fichadas, cobrando, con la tienda cerrada y cero ventas.**
Están haciendo mise en place para la cena (trabajo legítimo), pero el local no puede vender.

### 2.6 Estimación de abrir 17:00–19:00 entre semana

Método: la proporción L-J/V-D se calcula sobre las horas donde el local abre **en ambos** regímenes
(20:00–23:00), y se aplica a lo que el finde vende a las 17-19.
Ratios por local: Alcalá **0,782** · Carabanchel **0,820** · Plaza Castilla **0,757**.

| Local | 17:00 | 18:00 | 19:00 | Día |
|---|---|---|---|---|
| Alcalá | +17,08 € | +18,88 € | +34,57 € | +70,53 € |
| Carabanchel | +9,34 € | +12,46 € | +13,12 € | +34,92 € |
| Plaza Castilla | +1,14 € | +19,51 € | +20,49 € | +41,14 € |

**~147 €/día × 4 días ≈ 590 €/semana ≈ 2.500 €/mes.**
Y es **conservador**: resta 11,98 €/h de coste laboral que, según §2.5, **ya se está pagando**.
Sin ese coste, solo Alcalá se acerca a **+106 €/día ≈ 1.800 €/mes**.

**Reservas declaradas (no se ocultan):**
1. **Canibalización** — que los pedidos de las 19:00 sean los de las 20:00 adelantados. Riesgo principal.
2. **Ratio optimista** — con la proporción de comida (0,40-0,53) en vez de la de cena, la cifra cae ~40 %.
3. **Food cost sobre muestra parcial** (§2.3).
4. **Carga de trabajo** — abrir no cuesta más dinero, pero puede retrasar el arranque del pico de las 20:00.

**Recomendación operativa**: abrir **primero las 19:00** (mayor margen, gente ya presente, pegada a la cena)
y medir si el total del día sube o solo se reparte. Si sube, extender a 18:00 y 17:00.

---

## 3. Arquitectura del rediseño

### Capa 0 · Ingesta de señales de plataforma (NUEVA — cimiento)

Los informes de Uber Eats Manager son la pata que faltaba. **11 de 12 recibidos** (falta
*Precisión del pedido*, no crítico). Los que alimentan este motor:

| Informe | Aporta |
|---|---|
| `restaurant_menu_downtime` | **Minutos online/offline por hora y tienda** (14.423 filas/mes) |
| `store_availability` | Eventos de disponibilidad con duración y motivo |
| `store_pause` | Pausas manuales con motivo |
| `order_history` | Pedidos con tiempos de aceptación/preparación, cancelados |

**Mecánica de ingesta (verificada):** el correo de Uber **no trae adjunto** — es un aviso con enlace
que **caduca en 48 h**, con `Delivery Method: Gerente de Uber Eats`. La descarga exige sesión.
→ **Extender `C:\folvy-promo-agent\uber-arm.mjs`** (Playwright, ya autenticado en Uber Eats Manager)
con un brazo de lectura que pida, descargue y suba los CSV. No hay arquitectura nueva que inventar.

**Vía API descartada como bloqueante**: la app `Folvy Platform` está en el paso 4/5
(*Production Access Granted* pendiente) y dio `invalid_scope`. Además su descripción solo justifica
**Promotions** — si se retoma, ampliar a Reporting + Store. **No bloquea este diseño.**

Tabla destino: `platform_hourly_availability` (account_id, location_id, brand_id, day, hour,
minutes_online, minutes_offline, source). Misma tabla para volcado manual y para robot.

### Capa 1 · Demanda — YA EXISTE
`team_demand_forecast` + `sales_hourly_agg` (122 ms). Sin cambios.

### Capa 2 · Solver legal (LO QUE FALTA Y LO QUE DA CONFIANZA)

**Un turno que viole una restricción dura no se propone jamás. Sin excepción.**

Restricciones duras v1:
- Vacaciones y bajas aprobadas *(ya está)*
- **Descanso semanal ≥ 1,5 días** (art. 37.1) ← mata el bug de los 7 días
- **Descanso 12 h entre jornadas** (art. 34.3) — hoy solo se vigila a posteriori
- **Horas contratadas**: ni pasarse del techo ni dejar suelo sin cubrir (`contracted_hours_week`)
- Tope 80 h extra/año (art. 35.2)
- Trabajador nocturno sin horas extra (art. 36)
- Festivos de `holiday_calendar`
- Disponibilidad (`employee_availability`, 75 filas inferidas)

**Configurables por cuenta** en tabla `compliance_rule` (hoy las 4 reglas viven dentro de
`team_compliance_scan`). **La misma tabla sirve a F6 y al solver** — una sola fuente de verdad legal.
Esto es lo que Julio pidió como "checks por casuística de cada cliente".

**Salida honesta**: lo que no se puede cubrir sale como **hueco declarado con motivo**
("faltan 13 h; los 3 disponibles violan: Marlón vacaciones, Johanny tope de extras,
Natacha descanso de 12 h"), nunca repitiendo a alguien 7 días.

### Capa 3 · Panel de capacidad (sobra/falta plantilla)

Contraste en vivo: **horas que piden los turnos vs horas contratadas disponibles**, por local y semana.
Convierte el pie mentiroso de la pantalla actual ("se repartirán respetando sus jornadas contratadas")
en información real. Desenmascara además los `coverage_*` inflados de §2.1.

### Capa 4 · Simulador bidireccional

Misma máquina de cálculo en los dos sentidos:
- **Cerrar**: "si cierras 2 h antes ahorras X € de coste y arriesgas Y € de venta."
- **Abrir**: "si abres esta franja el margen estimado es Z €, con este coste laboral incremental."

Entrada: margen de contribución (§2.3) × demanda estimada − coste laboral incremental **real**
(cero si ya hay gente fichada, §2.5). Salida siempre con **rango y reservas**, nunca número seco.

### Capa 5 · Folvy propone los turnos (invierte la cadena)

Hoy: `ventas → previsión ✅ → [PLANTILLA FIJA A MANO 🧱] → cuadrante`
Destino: `ventas + previsión → Folvy propone horas y personas → el humano confirma`

La plantilla de turnos **deja de ser la verdad de "cuánta gente el martes"** y se degrada a lo que sí
es: **restricciones del local** (a qué hora *puede* abrir, mínimo 1 persona si está abierto, quién
sabe cerrar caja). Esto remata la decisión "Opción 2" del 10/07, que el generador desplegado ignoró.

Resuelve además el problema que planteó Julio: cambiar un horario de 23:45 a 00:00 hoy rompe todo lo
que cuelga de ese `shift_template_id`. Con turnos derivados de la demanda, el horario es un parámetro,
no una entidad rígida con dependencias.

### Capa 6 · Detector de franjas rentables

Cruza las cuatro fuentes que **solo Folvy tiene juntas**: ventas por hora + apertura real de la
plataforma + fichajes reales + coste de nómina. Produce frases accionables:

> *"Alcalá, martes 19:00: tienes 1,9 personas fichadas, la tienda cerrada y 0 ventas.
> El finde a esa hora vendes 5,7 tickets. Abriendo estimo +46 €/día sin coste laboral adicional.
> Riesgo: puede retrasar el pico de las 20:00."*

**Para franjas sin histórico** (03:00, 09:00): el histórico propio es **estructuralmente ciego** —
la decisión de cerrar impide generar el dato que justificaría abrir. Ahí el motor **no inventa una
cifra de ventas**. Da:
- el **umbral de equilibrio** (~1,2 tickets/hora), que sí se calcula para cualquier hora;
- **señales de entorno legítimas**: horarios públicos de la zona (Google Maps, apps), y el
  **benchmark que Uber entrega en el propio portal** (media del mercado de horas conectadas:
  Meraki Pita 31,7 h vs 65,7 h del mercado, 19 negocios comparables de Madrid);
- una **prueba acotada** con coste conocido, como último recurso y **no como producto**.

### Capa 7 · Presentación — tres montones (sin cambios respecto al diseño del 06/08)

No generar la semana en blanco: arrancar de la semana pasada.
`✓ igual que la semana pasada` · `↻ lo que cambio y por qué` · `? necesita tu criterio`.

### Capa 8 · Negociación en lenguaje natural
El encargado escribe *"Natacha no puede los martes"* → restricción tipada, guardada con fecha, autor
y motivo → re-resolver. **Nunca se vuelve a preguntar lo mismo.**
Modelo: Sonnet/Haiku basta (traducción acotada, volumen bajo). **Arquitectura agnóstica de modelo**:
el modelo es configuración, no está incrustado. Escalado por fallo, con rastro de qué modelo respondió.

---

## 4. Qué NO se promete

- **Ventas de la competencia por franja.** No obtenible con fiabilidad; decisión vigente desde el 06/08.
- **Predicción de ventas en horas nunca abiertas.** No existe ese dato en ninguna parte hasta que se abre.
- **Cuadrante 100 % automático sin revisión.** No existe en ningún producto del mundo.
- **Precisión de previsión con pocos meses**: enseñar con intervalo, no como número seco.

---

## 5. Orden de construcción

| # | Paso | Por qué aquí |
|---|---|---|
| 0 | **Cerrar el hueco de escandallos** (3.334 tickets sin coste) | Bloquea toda decisión económica |
| 1 | **Restricciones duras en el solver** | Deja de producir cuadrantes ilegales. Innegociable |
| 2 | **Tabla `compliance_rule` por cuenta** | Sirve a F6 y al solver. Los "checks por cliente" |
| 3 | **Panel de capacidad** (sobra/falta) | Barato, alto valor, desenmascara §2.1 |
| 4 | **Ingesta de informes de Uber** (brazo de lectura del robot) | Cimiento de las capas 4 y 6 |
| 5 | **Simulador bidireccional** | Primer valor visible de negocio |
| 6 | **Detector de franjas rentables** | El argumento comercial |
| 7 | **Turnos propuestos desde previsión** | Remata la Opción 2 |
| 8 | **Negociación en lenguaje natural + aprendizaje** | Lo que hace que se adopte y se quede |

**F7.2 (limpiar plantillas duplicadas) es requisito de los pasos 3 y 7** — y es decisión de Julio.

---

## 6. Métrica honesta

**% de turnos propuestos aceptados sin tocar.** Si a las seis semanas no supera el 85 %,
el sistema no vale y hay que decirlo, no maquillarlo con una pantalla bonita.

Para el motor de horarios: **€ de margen adicional confirmados** contra la estimación previa.
Si se recomienda abrir una franja, a las 4 semanas se contrasta lo estimado con lo real y
**se publica la desviación**. Un motor que no se audita a sí mismo no es fiable.

---

## 7. Deuda y tareas abiertas que este frente toca

**Tareas de Julio (bloquean):**
- 🔴 Decidir qué `shift_templates` duplicadas se conservan (F7.2)
- 🔴 Caso Mirlenys −83,3 h en julio
- 🟠 Rellenar distinción completa/parcial de jornada
- 🟠 Confirmar con la asesoría nocturnidad y pausa retribuida de Madrid
- 🟠 Verificar el método de pago de HubRise (límite de uso alcanzado el 07/08 → 35 €/mes;
  si corta, se caen los pedidos de Uber, que ya no tienen Last de red)

**Deuda técnica:**
- 3.334 tickets sin escandallo casado (bloquea §2.3)
- `clock_entries.scheduled` poblado en 12 de 574 (F2.2) — sin esto no hay retrasos ni cobertura real vs planificada
- Modelo de `sala` en `team_labor_model` (F2.6)
- `weekly_hours` vs `contracted_hours_week` ambiguo (§2.2)
- 297 entradas vs 299 salidas en `clock_entries` (2 salidas huérfanas)
- Falta informe *Precisión del pedido* de Uber

---

_Fuentes: BBDD `xzmpnchlguibclvxyynt` vía MCP (08/08) · CSV de Uber Eats Manager julio 2026 ·
`folvy_team_generador_cuadrantes_diseno.md` · `folvy_team_autoscheduling_benchmark_diseno.md` ·
`folvy_uber_robot_estado.md` · `folvy_reglas.md`._

_Julio Gª Colón · Folvy SL_
