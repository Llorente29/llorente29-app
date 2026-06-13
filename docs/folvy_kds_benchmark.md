# Folvy — Benchmark exhaustivo de KDS (Kitchen Display Systems)
### Fase BENCHMARK del frente KDS · 13/06/2026 · previo a diseño

> **Estado:** investigación de mercado para fundamentar el diseño. NADA construido.
> Método Folvy: RECON → **BENCHMARK** → DISEÑO (golear) → MEDIR. Este doc es el paso 2.
>
> **Disparador (Julio):** montar el KDS de Folvy, **partiendo de cambiar cómo se recibe el
> ticket** (hoy solo ingerimos `tab:closed` = venta cerrada; un KDS necesita el pedido a la
> *recepción*), y precedido de un análisis extremo de los KDS del mercado, en especial los top.
>
> **Hallazgo de viabilidad (verificado contra el OpenAPI v2.0.0 de Last):** Last **sí** emite el
> ciclo de vida completo en tiempo real (`tab:created`, `tab:updated`, `tab_products:updated`,
> `tab:cancelled`) **y eventos nativos de cocina** (`kitchen-order:created/updated`,
> `kitchen-note:created`, `course:sent`). Un KDS de Folvy sobre los webhooks de Last es
> **plenamente factible**, sin tocar la capa contable (`tab:closed` sigue siendo la venta definitiva).

---

## 1. El mapa del mercado (jun 2026)

Cinco familias. La columna "¿compite con Folvy?" usa el mismo criterio del mapa de delivery:
quien hace gestión de cocina/coste solapa; quien solo pinta tickets, no.

| Sistema | Familia | Modelo | Fuerte en | ¿Solapa con Folvy? |
|---|---|---|---|---|
| **QSR Automations · ConnectSmart Kitchen (CSK)** | Enterprise (patrón oro) | KDS+workflow, cloud+on-prem, 65-80+ POS | ruteo dinámico, pacing, coursing, capacidad | **Sí** (es de **Crunchtime**, ya en nuestro set) |
| **Oracle Simphony KDS / Micros** | Enterprise | KDS de su suite POS | cadena grande, fiabilidad | parcial |
| **Toast KDS** | POS-native (líder USA) | hardware propio + SW, solo Toast | ruteo por estación, expediter, assembly-line, all-day | parcial (Toast es POS, no escandallo) |
| **Square KDS** | POS-native (SMB) | first-party, solo Square | simple, barato | no |
| **Lightspeed / TouchBistro / Revel / Loyverse KDS** | POS-native | KDS de su POS | integración nativa | no |
| **Fresh KDS** | Standalone (multi-POS) | app tablet/FireTV, se conecta a N POS (incl. **Last.app**, Otter, Lightspeed, Square) | el mejor SMB: bump bar, recall, métricas en vivo, tracker cliente, vista off-premise | no (no hace coste) |
| **RocketBox** | Standalone delivery-first | KDS para alto volumen delivery + multimarca, API abierta o standalone | **IA de tiempos + sync ETA de rider**, multimarca, resúmenes de prep | no (no hace coste) |
| **Otter KDS** | Agregador/middleware | parte de su suite delivery (la que evaluamos como partner) | consolida canales, **86 que se propaga a todas las plataformas**, ruteo por tipo/canal | **no** (delivery, no cocina/coste) |
| **Deliverect / Chowly / Cuboh** | Agregador/middleware | inyectan pedidos de plataformas a POS+KDS | consolidación de canales, sync de menús | Deliverect parcial |
| **GrubTech KDS** | Plataforma dark-kitchen | gestión completa cocina fantasma (previsión, inventario, KDS) | multimarca delivery | **sí, directo** |
| **Chowbus KDS** | Nicho (asiático) | KDS especializado | multilingüe, hot-pot, multi-estación | no |
| **KDS españoles: Last.app (propio + Fresh), HioScreen/HioPOS, Poster KitchenKit, Madi Rest, Cuiner** | POS-native locales | KDS de su TPV | mercado ES, idioma operador | el **incumbente** (Llorente29 usa Last) |

**Lectura:** el techo del mercado entero (de CSK para abajo) es **operación**: enrutar, cronometrar,
secuenciar, medir tiempos. **Ninguno calcula el coste/margen del ticket, ni descuenta stock teórico
en vivo, ni enseña la receta ligada a ingredientes en el pase, ni cruza con alérgenos/APPCC.** Ese
es exactamente el eje donde Folvy ya juega (escandallo, motor de coste, pasos E8, alérgenos,
fiabilidad de casado). El hueco se repite igual que en Kitchen: no se gana out-featureando el ruteo;
se gana **cambiando el eje** — el único KDS que sabe lo que *cuesta y consume* cada comanda.

---

## 2. Table stakes — lo que TODO KDS serio hace (paridad obligatoria)

Si Folvy no lo tiene, pierde por desbordamiento (regla nº2: esto es paridad, no goleada).

1. **Pedido en vivo a la recepción** — el ticket aparece al entrar, no al cerrar. (Hoy Folvy NO; es el cambio de raíz que pide Julio.)
2. **Tarjetas/tickets con artículos + modificadores + notas + canal + tipo de servicio.**
3. **Semáforo por tiempo** (verde→amarillo→rojo) con umbrales **por tipo de pedido** (delivery distinto de sala).
4. **Sonido al entrar** pedido nuevo; resaltado de cambios (líneas añadidas/anuladas).
5. **Bump / recall** — marcar listo y recuperar lo bumpeado por error.
6. **Ruteo por estación** (parrilla/frío/postre/barra): cada pantalla ve solo lo suyo.
7. **Pantalla expediter** (pase): vista consolidada del pedido entero + check por ítem; opción **dos niveles** (cocina → entrega).
8. **Resumen de producción / "all-day"** — cuántas unidades de cada ítem hay abiertas (prep por lotes).
9. **Multipantalla sincronizada** (bump/tachado se refleja entre pantallas).
10. **Modo oscuro + texto grande** (cocina con poca luz, lectura a distancia).
11. **Modo offline** — sigue recibiendo pedidos en caída de red/internet.
12. **Hardware flexible** — tablet iOS/Android, FireTV, monitor con decoder; bump bar físico opcional.
13. **Reabrir/editar** pedido completado; histórico de tiempos al bumpear (para reporting).
14. **Etiquetas / impresión** de ticket o etiqueta por ítem (coexistencia con papel).
15. **86 / sin disponibilidad** desde el KDS.
16. **Métricas de tiempo** — tiempo medio de ticket, por estación, por canal.

## 3. Lo que hacen los MEJORES (la frontera alta — referencia a batir)

| Capacidad | Quién la borda | Qué es |
|---|---|---|
| **Ruteo dinámico + retardado (delayed routing)** | CSK, Toast, RocketBox | cada ítem se "dispara" en el momento óptimo según su **tiempo de cocción**, para que todo el ticket salga junto |
| **Meal coursing / pase por tiempos** | CSK, Fresh (course status del POS), Toast | sincroniza entrante/principal/postre; el pase sabe cuándo mandar cada tiempo |
| **Capacity management / throttling** | CSK | regula la entrada de pedidos según la carga real de la cocina (cola, rush) |
| **Assembly-line (grid) workflow** | Toast | un ítem recorre estaciones en secuencia; aparece en la siguiente solo cuando la previa lo completa |
| **Sync con ETA del repartidor** | RocketBox | la preparación se alinea con la hora real de llegada del rider → nada se enfría ni espera |
| **IA de tiempos de prep** | RocketBox | ajusta el timing por complejidad del pedido, cocción y ETA |
| **86 que se propaga a TODOS los canales** | Otter | marcar un artículo agotado en el KDS lo apaga en Glovo/Uber/web a la vez |
| **Pantalla al cliente (order tracker)** | Fresh, Epson, CSK | "preparando → listo" en pantalla para sala/recogida/rider |
| **Métricas en vivo en la propia pantalla** | Fresh (15/30 min), CSK | tiempo medio, % puntual/atrasado, recuento — coaching en caliente |
| **Multilingüe real (nombre por idioma)** | Toast, Chowbus, MenuSifu | el cocinero lee en su idioma; reduce el paso de traducción mental |
| **Off-premise view dedicada** | Fresh | pedidos para llevar/delivery con hora de recogida y datos del rider aparte |
| **Multimarca a una línea** | RocketBox, Otter, GrubTech | N marcas virtuales rutean limpio a una sola cocina/assembly line |
| **Mobile remoto del rendimiento** | Fresh "On The Fly", CSK portal | el dueño ve la cocina (tiempos, multisede) desde el móvil |

**Métrica estrella del sector:** CSK promete **~40% menos de tiempo de ticket** y +10% productividad
por cocinero. Es el número contra el que se mide un KDS. Folvy debería instrumentarse para medirlo.

---

## 4. El HUECO — lo que NINGÚN KDS hace (la goleada de Folvy)

Esto es white space verificado: ni el patrón oro lo tiene. Folvy puede porque **ya tiene las piezas**.

1. **Receta y pasos en el pase, ligados a ingredientes (E8).** Hoy el KDS muestra el *qué* (líneas + modificadores). Folvy puede mostrar el *cómo* a un toque: los pasos de la receta vinculados a ingredientes/equipos. meez/Apicbase tienen pasos como texto muerto; nadie los lleva al pase en vivo. → **Cook Mode en el KDS.**
2. **Coste y margen REAL del ticket en vivo.** El KDS sabe qué se cocina; Folvy sabe lo que *cuesta* (motor de coste validado al céntimo + comisión por marca×canal). Un KDS que, además de cronometrar, dice "este ticket de Glovo deja X € de margen" no existe.
3. **Descuento de stock teórico en tiempo real → auto-86 honesto.** Al entrar el pedido (no al cierre), Folvy puede descontar el consumo teórico (venta×escandallo, motor ya diseñado) y **apagar el artículo cuando el stock teórico se agota** — y, vía la dirección de publicación (Fase 2 + lo de Otter), propagarlo a las plataformas. Nadie une 86 + stock real.
4. **Alérgenos a nivel de línea, desde la receta.** El alérgeno no es una etiqueta manual de color (Toast/Fresh): sale del `recipe_item_allergen` del plato. El pase puede alertar "contiene frutos secos" porque lo *sabe*, no porque alguien lo escribió.
5. **APPCC enganchado al pase.** Folvy ya tiene APPCC (temperaturas, limpieza). Un KDS que, en el momento de servir, cruza con el control de cámara/aceite del día es territorio propio.
6. **Fiabilidad de casado como señal viva.** Si entra un producto sin escandallo, el KDS lo cocina igual pero marca "coste ciego" (ya tenemos `unmapped_reason`) — el dueño ve en caliente qué ventas no sabe costear.
7. **Multimarca sobre cocina compartida, nativo.** Llorente29 es 3 locales × N marcas (propias + cedidas Cloudtown) en un almacén físico. Folvy ya modela marca estable por UUID (`external_brand_map`) → el KDS rutea por marca real sin deducir.

**Tesis de goleada (una frase):** *el resto del mercado tiene el KDS más rápido; Folvy tendrá el
único KDS que sabe lo que cada comanda cuesta, consume y deja de margen, en tiempo real y por marca.*

---

## 5. Activos de Folvy que YA alimentan un KDS (no se parte de cero)

- **Frontera canónica multi-TPV** + **raw event store** (`sale.raw_tab` guarda el ticket entero). El adaptador `adapt_lastapp_order` ya convierte ticket Last → líneas canónicas.
- **Marca estable por UUID** (`external_brand_map`, 42 filas validadas) → ruteo por marca sin adivinar.
- **Casado por `organizationProductId`** (98,6% en Folvy Interno) → cada línea sabe su `menu_item`/receta.
- **Motor de coste** server-side + **comisión marca×canal** → margen por ticket disponible.
- **Pasos E8** (`recipe_item_step_line`) ligados a ingredientes → Cook Mode.
- **Alérgenos** (`recipe_item_allergen`, 14 UE) → alerta en línea.
- **APPCC** en producción → cruce en el pase.
- **Multi-local** (location_id operativo del contexto) → una pantalla por cocina/estación.

## 6. Viabilidad técnica: los eventos de Last que alimentan el KDS

Del `discriminator` del schema `webhook` (OpenAPI v2.0.0). Hoy escuchamos **1** de **31**.

| Evento Last | Para el KDS |
|---|---|
| `tab:created` | **pedido recibido** → aparece en pantalla (mismo payload `tab-2` que `tab:closed`: trae products, `locationBrandId`, `pickupType`, delivery, notas, alérgenos) |
| `tab:updated` / `tab_products:updated` | líneas añadidas/cambiadas en vivo |
| `tab:cancelled` | cancelación (quitar de pantalla **y** revertir venta — ver §7) |
| `kitchen-order:created` / `:updated` | comanda de cocina nativa (allergyInfo, pickupTime, note, versions, tabId) |
| `kitchen-note:created` | nota a cocina |
| `course:sent` | **pase de tiempos** (coursing) por tabId/locationId |
| `delivery-status:updated`, `shipment:sent/cancelled` | estado del reparto (sync con rider) |

**Decisión estratégica de fuente:** el KDS puede leer de **Last** (ya viable, recomendado para
empezar: cubre sala + delivery que Llorente29 ya mete por Last) o, para delivery puro, del stream
directo de plataformas / **Otter** (conecta con `folvy_estrategia_delivery.md`). Empezar por Last es
el camino de menor fricción y máxima cobertura inmediata.

---

## 7. Deuda de exactitud que el benchmark destapó (independiente del KDS, atacar ya)

Hoy ingerimos `tab:closed` pero **NO** `tab:cancelled`, `bill:deleted`, `payment:deleted`. Si una
cuenta se cancela o se anula un cobro **después** del cierre, seguimos contando esa venta → dashboard
y food cost **inflados**. El evento existe en el OpenAPI. Quick win: el webhook actual escucha también
esos eventos y revierte/marca la venta. Barato y additivo. **No bloquea el KDS, pero es deuda real.**

---

## 8. Paridad mínima del KDS de Folvy (para no perder) + orden propuesto

**Capa 0 — cambiar la recepción del ticket (raíz, lo que pide Julio):**
segundo consumidor de la frontera que ingiere `tab:created`/`tab:updated`/`tab_products:updated`
→ estado "pedido en vivo" (no toca la materialización contable de `tab:closed`).

**Capa 1 — KDS de paridad:** tarjeta con líneas+modificadores+notas+canal+marca, semáforo por tipo,
sonido, bump/recall, multipantalla, modo oscuro, resumen all-day, métricas de tiempo, offline básico.

**Capa 2 — goleada Folvy (por fases, cada una usable sola):**
(a) Cook Mode (pasos E8 en el pase); (b) coste/margen del ticket en vivo; (c) alérgenos de la receta
en línea; (d) descuento teórico + auto-86; (e) APPCC en el pase; (f) métrica de 40% tiempo de ticket
para medirnos contra CSK.

---

## 9. Decisiones abiertas (a resolver antes/durante el diseño)

1. **Fuente del KDS:** ¿Last (recomendado para empezar) o también Otter/plataforma directa para delivery?
2. **Hardware objetivo Llorente29:** ¿tablet Android/iPad en cocina? ¿una pantalla por local o por estación?
3. **Ruteo por estación:** ¿Llorente29 tiene estaciones diferenciadas hoy, o una sola línea por marca?
4. **¿KDS dentro de la PWA de Folvy** (una pantalla más) **o app/pantalla dedicada** a TV/tablet fija?
5. **Quick win de cancelaciones (§7):** ¿se ataca antes del KDS (cierra deuda) o en paralelo?
6. **Validar con Pamela** el flujo real de Llorente29 (sala vs delivery, quién mira la pantalla) ANTES de maquetar — principio nº2: se mide sobre realidad, no laboratorio.

---

## Fuentes (auditadas 13/06/2026)
QSR Automations / Crunchtime ConnectSmart Kitchen (qsrautomations.com, hospitalitytech.com,
capterra, softwareadvice); Toast KDS (pos.toasttab.com, doc/support.toasttab.com, updates.toasttab.com);
Fresh KDS (fresh.technology — features, pricing, integraciones Last.app/Otter); RocketBox (blog.rocketbox.io);
Otter KDS (tryotter.com, helpdesk.tryotter.com); middleware (cloudkitchens.com, orderout.co, loman.ai);
mercado ES (Loyverse, Poster KitchenKit, Madi Rest, HioScreen); comparativas (chowbus.com, scmgalaxy.com,
slashdot, sourceforge, wifitalents, menusifu). OpenAPI Last v2.0.0 (fuente primaria de eventos).
