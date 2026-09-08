# RECON · Un estándar para todas las alertas (§4 del encargo)

**Fecha:** 08/09/2026 · **Rama:** `claude/schema-migrations-repo-40d7u8` · **Escribe:** nada. Lectura pura.
**Encargo:** `ENCARGO_CODE_estandar_de_alertas_20260908`, §4. Se hace ya porque no toca nada; la construcción
(§5) sigue detrás del importador.

> **Antes de nada:** el §2.2 del encargo dice que una alerta de actividad consulte `business_hours` y calle si
> el local está cerrado. **Medido, esa regla tal cual escrita habría silenciado a Alcalá durante 127 pedidos
> reales en 30 días.** Está en el §3. Es lo único de la RECON que cambia el diseño, y por eso va arriba.

---

## §1 · Inventario de vigías (§4.1) — medido en la base, no en el repo

**16 funciones** llaman a `_queue_system_alert` (15 vigías + el propio drenaje). De las 15:

| vigía | ámbito real del hecho | ¿menciona local? | ¿mira `business_hours`? | cron |
|---|---|---|---|---|
| `ingesta_silencio_watchdog` | **local** (hoy: cuenta) | ❌ | ❌ | `*/10 * * * *` |
| `kds_device_silence_check` | **local** (dispositivo) | ✅ | ❌ | `*/5 * * * *` |
| `kds_device_stale_bundle_check` | **local** (dispositivo) | ✅ | ❌ | `30 7 * * *` |
| `db_health_stale_devices_report` | **local** | ✅ | ❌ | `0 6 * * *` |
| `_generate_daily_count_core` | **local** (autoinventario) | ✅ | ❌ | — |
| `sales_unmapped_watchdog` | cuenta / marca | ❌ | ❌ | `20 * * * *` |
| `modifier_zero_cost_watchdog` | cuenta / marca | ❌ | ❌ | — |
| `codigo_plataforma_watchdog` | cuenta | ❌ | ❌ | — |
| `hubrise_order_stuck_watchdog` | cuenta | ❌ | ❌ | — |
| `sale_line_cost_sweep` | cuenta | ❌ | ❌ | — |
| `db_health_watchdog` | **sistema** | ❌ | ❌ | `* * * * *` |
| `db_health_connection_guard` | **sistema** | ❌ | ❌ | `* * * * *` |
| `db_health_writer_regression_check` | **sistema** | ❌ | ❌ | `*/15 * * * *` |
| `edge_drift_watchdog` | **sistema** | ❌ | ❌ | — |
| `edge_drift_salud_watchdog` | **sistema** | ❌ | ❌ | `10 6 * * *` |

**Ninguna de las 15 mira `business_hours`.** Cero. La regla §2.2 no está implementada en ningún sitio.
**5 son de sistema** (`db_health*`, `edge_drift*`) y no deben mirar horarios nunca: si la base se cae a las
04:00, hay que avisar a las 04:00.

**Volumen de 30 días (81 avisos):** `ingesta_silencio` **44** · `venta_producto_sin_casar` 14 ·
`autoinventario` 7 · `db-health` 7 · `edge_drift` 3 · `brand-closure` 3 · `kds_device_silencio` 2 ·
`kds_device_desfasado` 1.

**Más de la mitad de todas las alertas salen del único vigía que está mal.** El «me aburren tanto que ya
las elimino sin mirar» tiene una cifra: 44 de 81.

## §2 · El fallo de hoy, y otro que no estaba en el parte

Fuente viva (`pg_proc.prosrc`, no el repo):

```
v_hora := extract(hour from (now() at time zone 'Europe/Madrid'));
IF v_hora < 12 OR v_hora > 23 THEN RETURN 0; END IF;
...
FOR a IN SELECT DISTINCT s.account_id FROM public.sale s WHERE s.sold_at >= now() - interval '7 days'
```

**(a) La franja fija, confirmada.** 12–23 para toda la cuenta; ningún local. Y el texto
«en pleno horario de servicio» es un **literal**: no se calcula, se afirma.

**(b) 08/09 era martes.** El horario declarado de ese día, en la base, actualizado el **07/09** (fresco):

| local | martes (weekday 2) |
|---|---|
| Alcalá | 13:00–16:30 · **20:00**–23:45 |
| Carabanchel | 13:00–15:45 · **20:00**–23:45 |

A las 18:50 los dos estaban en el hueco de tarde. Últimas ventas: Alcalá 15:22, Carabanchel 15:34 — justo
antes de sus cierres. **18:50 − 15:34 = 196 minutos exactos.** Los 196 minutos eran la siesta. El dato para
no gritar estaba en la base, fresco, y el vigía no lo miró.

**(c) EL QUE NO ESTABA EN EL PARTE — un falso positivo diario, garantizado, a las 12:00 en punto:**

```
07/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 666 min
06/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 670 min
05/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 665 min
04/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 665 min
03/09 12:00  ALTO: NO ENTRAN PEDIDOS desde hace 665 min
```

Es **la primera pasada tras abrirse la franja**, informando de que ha pasado la noche. ~665 min = de la
última venta (~00:55) a las 12:00. No detecta nada: la franja fija **fabrica** una alerta falsa cada mañana.
Cinco de los últimos seis días. Un vigía que miente a la misma hora todos los días enseña a no leerlo.

**(d) Regla 9 en el canal de alertas.** El bucle es `SELECT DISTINCT account_id FROM sale` — **sin filtrar
cuenta**. Hoy hay **dos** con ventas: Foodint (837 en 7 días) y **Kitchen Grill LstQ** (68). Ninguna alerta
dice de cuál habla. Por eso el 08/09 hay **dos avisos a las 20:00** con 266 y 192 minutos: son las dos
cuentas, indistinguibles en la bandeja. Julio recibe las alertas del cliente 2 como si fueran suyas.

## §3 · `business_hours` (§4.2) — y por qué NO puede ser el veto

**Forma:** `business_hours (account_id, location_id, brand_id NULL, weekday smallint, open_time, close_time)`
y `business_hours_exception (…, exception_date, is_closed, open_time, close_time, note)`. Los dos con
`account_id` y `location_id` NOT NULL. `brand_id` está **siempre a NULL** hoy: los horarios son de local, no
de marca.

**Convención de `weekday`: es `extract(dow)`, 0 = domingo.** No se supone, se mide. El primer test —contar
ventas fuera de horario con cada convención— **no discrimina** (244 vs 283 de 2.954: 8 % en las dos). El que
sí discrimina es el hueco de tarde, porque los días partidos deben estar vacíos:

| Carabanchel, 30 días | Dom | Lun | Mar | Mié | Jue | Vie | Sáb |
|---|---|---|---|---|---|---|---|
| ventas 17:00–19:30 | 24 | **0** | **0** | **0** | **0** | 16 | 15 |

Sus `business_hours` declaran partido en weekday 1,2,3,4 y continuo en 0,5,6. **Encaja exacto: 0 = domingo.**

**Cobertura:** 3 locales, no 4. Los tres tienen horario cargado; los dos vivos, los 7 días.

| local | `active` | tramos | días | excepciones | última venta |
|---|---|---|---|---|---|
| Foodint Alcalá | true | 11 | 7 | 0 | 08/09 15:22 |
| Foodint Carabanchel | true | 11 | 7 | 0 | 08/09 15:34 |
| Foodint Plaza Castilla | **false** | 12 | 6 | **92, todas cerradas (30/06→29/09)** | **12/07** |

Plaza Castilla está cerrado a propósito y bien declarado por las dos vías (`active=false` y 92 excepciones).
El mecanismo de excepciones existe, se usa y funciona.

### El problema, y es el hallazgo que cambia el diseño

**Los horarios declarados de Alcalá no describen lo que hace Alcalá.**

| ventas 17:00–19:30, 30 días | Dom | Lun | Mar | Mié | Jue | Vie | Sáb |
|---|---|---|---|---|---|---|---|
| **Alcalá** | 47 | **35** | **27** | **27** | **39** | 34 | 33 |
| Carabanchel | 24 | 0 | 0 | 0 | 0 | 16 | 15 |

Alcalá declara cerrado 16:30–20:00 de lunes a jueves y **vende 128 pedidos en esa franja en 30 días** — 99
de `lastapp` y 28 de `hubrise`, todos con canal: **es reparto**. Los horarios de Alcalá son, con toda
probabilidad, los del local; el reparto no para.

**Aplicar la regla §2.2 tal cual escrita habría callado a Alcalá justo en esa franja.** Eso no es arreglar el
bug: es cambiarlo por el de la familia de la regla 7, que es peor — el ruidoso se ve; el mudo, no. Una caída
real de Alcalá un martes a las 18:00 no habría avisado a nadie.

### Lo que sí funciona: la historia del propio local

Martes, últimas 8 semanas, media de pedidos por hora:

| hora Madrid | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 |
|---|---|---|---|---|---|---|---|---|
| **Alcalá** | 4,1 | 4,0 | 2,3 | 0,8 | **1,4** | 2,0 | 9,8 | 9,3 |
| **Carabanchel** | 2,6 | 1,9 | 0,1 | — | **—** | — | 4,3 | 5,9 |

A las 18:50 del martes: **Carabanchel espera cero** (no hay ni fila) → su silencio era normal y no debía
avisar. **Alcalá espera ~1,4/hora** → 196 minutos mudo son ~4 pedidos que faltan: poco, pero no cero.

**Propuesta:** el disparo lo decide **la historia del local** (local × día de la semana × hora, ventana de 8
semanas), y `business_hours` + `business_hours_exception` + `locations.active` se usan para **el texto y el
contexto** («está abierto, cierra a las 23:45» / «debería estar cerrado»). Ventajas: se autocorrige cuando el
horario está desactualizado, y no puede callar donde de verdad hay actividad. **Un local sin historia
suficiente no dispara y sale en una lista de «sin base para vigilar»** — ni callar ni gritar, que es lo que
pide el §4.2.

## §4 · El que envía el correo (§4.3) — cambia poco, y está en un solo sitio

Cadena completa: vigía → `_queue_system_alert(...)` → `system_alert_queue` → `system_alert_queue_drain()`
(cron `* * * * *`) → `net.http_post` → edge function `system-alert` → Resend.

- **El drenaje NO compone nada.** Manda tal cual: `jsonb_build_object('subject', v_row.subject, 'message',
  v_row.message, 'kind', v_row.kind)`. Tres campos.
- **La edge function tampoco, casi.** `supabase/functions/system-alert/index.ts`, **141 líneas**, texto plano
  (**no hay HTML**). Todo lo que añade es `[Folvy · alerta] ` delante del asunto y un pie de tres líneas
  (`Tipo` / `Enviado` / `Origen`), con `originFor(kind)` ya mapeando los 8 tipos vivos.

**Buena noticia:** el §2.5 («una sola plantilla, ningún vigía escribe su HTML») está a **un fichero de 141
líneas** de distancia. La plantilla única cabe ahí. Lo que hay que cambiar es que el drenaje **pase los
campos nuevos**, y hoy sólo pasa tres.

**El riesgo de verdad está en el otro extremo, y tiene nombre:**

```
_queue_system_alert(p_kind text, p_subject text, p_message text,
                    p_debounce_kind text, p_debounce_window interval)
```

Añadirle `account_id`, `location_id`, `brand_id`, `severity` es **exactamente** la operación de la regla 2 —
la que el 27/08 dejó los SIETE vigías sin poder encolar: `CREATE OR REPLACE` crea una SOBRECARGA y las
llamadas viejas pasan a ser ambiguas (`42725`). Con **15 llamadores**, un DROP + CREATE obliga a reescribir
los 15 en la misma transacción: una migración enorme y todo o nada.

**Propongo evitar la elección:** una función **nueva y con otro nombre** (`_encola_aviso`) que reciba los
campos, y migrar los vigías **de uno en uno** — que es el orden que el propio §5 pide. Sin ventana de
ambigüedad, sin migración gigante, y la vieja se retira cuando el último llamador se haya movido. La regla 2
se cumple por no crear nunca dos firmas del mismo nombre.

## §5 · Silencio por local (§4.4) — vía libre

`sale.location_id` está **poblado al 100 % en las cuatro vías**, 30 días, Foodint:

| vía | ventas | con local | con marca |
|---|---|---|---|
| `lastapp` | 2.352 | **100 %** | 100 % |
| `hubrise` | 599 | **100 %** | 100 % |
| `folvy_pos` | 2 | 100 % | 100 % |
| `folvy_shop` | 1 | 100 % | 0 % |

Repartir el silencio por local **no produce mudos falsos**. (`brand_id` también está al 100 % salvo la única
venta de `folvy_shop`.)

## §6 · Lo que la RECON deja decidido, y lo que no

**Decidido y medido:**
1. El bug es el que Julio dijo, y hay un segundo: la alerta diaria de las 12:00.
2. `weekday` = `dow`, 0 = domingo (medido, no supuesto).
3. Repartir por local es seguro (100 % de cobertura).
4. La plantilla única cabe en un fichero de 141 líneas.
5. El camino sin riesgo para los campos nuevos es una función nueva, no una firma nueva.

**Para Julio, tres preguntas:**
1. **¿Los horarios de Alcalá están mal, o son los del local mientras el reparto sigue?** Si es lo segundo,
   `business_hours` describe otra cosa que «cuándo entran pedidos», y el vigía no debe usarlos como veto ni
   corregirlos: usa la historia y los cita en el texto.
2. **¿Las alertas del cliente 2 (Kitchen Grill LstQ) deben llegarte a ti?** Hoy llegan, sin decir que son
   suyas. Si sí, el estándar las marca con el negocio delante; si no, el vigía filtra por cuenta.
3. **Orden.** El §6 lo pone detrás del importador. El falso positivo diario de las 12:00 se puede quitar
   **hoy** con un cambio de tres líneas (no avisar si toda la ventana de silencio cae fuera de la actividad
   histórica del local), sin esperar al estándar entero. ¿Lo saco aparte?

**Nada de esto se ha construido.** La RECON no escribe.
