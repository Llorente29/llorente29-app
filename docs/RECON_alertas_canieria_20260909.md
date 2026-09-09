# RECON — La cañería de alertas, medida entera (09/09)

Barrido previo al paso 1 del encargo del estándar. Sólo lectura. Corrige tres cosas del encargo, y las
tres cambian lo que hay que construir.

---

## §1 · La vara del §1 mide 6,5 días, no 30

El encargo titula «últimos 30 días de `system_alert_queue`». La tabla **no puede** tener 30 días: el propio
drenaje la poda.

```sql
delete from public.system_alert_queue
 where status in ('sent','failed') and created_at < now() - interval '7 days';
```

Medido: fila más vieja **02/09 18:40**, más nueva **09/09 06:00**, 76 filas, **6,5 días de historia**.

Así que los 76 avisos no son de un mes: son de menos de una semana. **≈ 11,7 avisos al día**, no 2,5. La
conclusión del encargo no cambia —sigue siendo demasiado y sigue sin decir el local—, pero el número con el
que se va a medir el éxito sí: **la línea base correcta es 76 en 6,5 días**, y hay que compararla contra
otra ventana de 6,5 días, no contra un mes. Es la regla 31: el antes y el después con la misma vara.

Y hay una consecuencia operativa: **no se puede estudiar el ruido de hace tres semanas**, porque no existe.
Si se quiere serie histórica, hay que guardarla antes de podar.

## §2 · Seis edge functions escriben al correo saltándose la cola entera

Esto es lo que más cambia el §4.5 («una sola cañería con formato único»). Hay **dos caminos** al correo:

```
vigías SQL ──> _queue_system_alert ──> system_alert_queue ──> drenaje ──> edge system-alert ──> Resend
                                                                              ▲
6 edge functions ─────────────── fetch POST directo ──────────────────────────┘
```

Las seis: `ingestion-synthetic-ping`, `availability-watchdog`, `hubrise-connection-health`,
`hubrise-callback-ensure`, `hubrise-location-disconnect`, `catcher-webhook`.

**Sus avisos no aparecen en `system_alert_queue`.** Ni en la tabla del §1, ni en el conteo de 76, ni en
ningún sitio donde se pueda medir. La prueba está en la propia edge del correo: su función `originFor()`
mapea kinds que la cola **nunca** ha visto — `synthetic_ping`, `catcher-delivery`, `hubrise-callback`,
`hubrise-connection-health`, `hubrise-revoke-pending`, `impresora_muda`, `cost_sweep`,
`availability-dispatch`, `location-status-dispatch`. El buzón recibe más de lo que la tabla cuenta.

Tres de esas seis están **vivas por cron** ahora mismo: `ingestion-synthetic-ping` (cada 10 min, jobid 12),
`availability-watchdog` (cada 15, jobid 26), `hubrise-connection-health` (cada 30, jobid 48). Las otras tres
disparan por evento.

Caso aparte, `availability-watchdog`: usa la cola **sólo si se le pasa `debounceKind`**; si no, sigue
posteando directo. O sea que el mismo fichero tiene los dos caminos, y su propio comentario cuenta por qué
(01/09: 96 correos al día por una marca cerrada a propósito).

**Consecuencia para el §7:** el paso 4 —plantilla única en el drenaje— **no basta**. Mientras esas seis
escriban su propio asunto contra el correo, el estándar se cumple en una mitad de la casa. Hay que añadir un
paso: *migrar los seis productores directos a la cola*. No es difícil —`availability-watchdog` ya demuestra
cómo, con una llamada RPC— pero hay que decirlo, porque hoy no está en la lista.

## §3 · El veto del §4.2 ya está escrito y funciona

No hay que inventar «¿está abierto ahora?». Existen dos funciones:

- **`is_brand_open(p_location_id, p_brand_id, p_ts) → boolean`**
- **`availability_location_open_minutes(p_location_id, p_from, p_to)`** → los tramos abiertos de una
  ventana, que es justo el «abierto durante [t0, ahora]» que pedía la RECON del 08/09.

`is_brand_open` hace ya todo lo que el §4.2 exige, y lo hace bien: convierte a `Europe/Madrid`, prioriza la
excepción de marca sobre la general, entiende los tramos que **cruzan medianoche** (mira también el día
anterior) y, si la marca tiene horario propio ese día, ignora el general. Con `p_brand_id => NULL` responde
por el LOCAL, que es lo que necesita el vigía de silencio — y hoy es exacto, porque **ningún tramo tiene
`brand_id`**: los 22 tramos cargados son de local.

**Comprobado sobre el caso que disparó el encargo, con la función y no leyendo filas:**

| local | ¿abierto a las 18:50? |
|---|---|
| Foodint Alcalá | **false** |
| Foodint Carabanchel | **false** |

Y el horario de Alcalá de esta semana es, en efecto, martes `13:00–16:30` y `20:00–23:45`. **El veto habría
callado la alerta.** Lo único que hacía falta era preguntar.

*(Aviso que sigue en pie: `business_hours` no guarda historial. Esto vale para «¿debería entrar algo AHORA?»
y para nada más. La comprobación de arriba se hace con el horario de HOY, no con el que hubiera el 08/09.)*

## §4 · La cobertura de horarios tiene un agujero con nombre de otra cuenta

| cuenta | local | activo | tramos | días |
|---|---|---|---:|---:|
| Foodint | Foodint Alcalá | sí | 11 | 7 |
| Foodint | Foodint Carabanchel | sí | 11 | 7 |
| Foodint | Foodint Plaza Castilla | **no** | 12 | 6 |
| Kitchen Grill LstQ | Kitchen Grill LstQ | sí | **0** | 0 |
| Folvy Interno | Foodint Alcalá | sí | **0** | 0 |
| Folvy Interno | Foodint Carabanchel | sí | **0** | 0 |
| Folvy Interno | Foodint Plaza Castilla | sí | **0** | 0 |

Dos cosas:

1. **La cuenta plantilla tiene tres locales con LOS MISMOS NOMBRES que los de producción, y cero horario.**
   Regla 9 otra vez: cualquier consulta del vigía que ancle por nombre coge los de la plantilla. Y como no
   tienen horario, el veto los daría por cerrados siempre — o por abiertos siempre, según cómo se escriba.
   **El vigía filtra por `account_id` y por `location.id`, nunca por nombre.**
2. **«Plaza Castilla» está `active=false` en Foodint y `active=true` en la plantilla.** Así que ni siquiera
   «sólo locales activos» se puede resolver por nombre: el nombre está activo en un sitio e inactivo en otro.

`Kitchen Grill LstQ` sin horario es coherente con que la cuenta esté parada; el §4.2 ya dice que no se
vigila. Pero el criterio tiene que ser explícito: **local sin horario cargado = no se avisa, y se lista
aparte**, nunca «se supone abierto».

## §5 · El §6 se queda corto: ese vigía no es que calle, es que está apagado

`last_catalog_watchdog` no ha encolado nada en 10 días, y el encargo lo atribuye a que está por escribir. La
causa inmediata es otra y está en `cron.job`:

```
jobid 45 · last-catalog-watchdog · */15 12-23 * * * · active = FALSE
```

**El cron está desactivado.** Aunque el vigía estuviera perfecto, no correría. Es la misma familia que el
resto del §6 —un vigía que no avisa— pero la causa es distinta y el arreglo también: reactivar el job va
antes que reescribir la función, y el orden importa porque reactivarlo hoy, con el cadáver ya apagado, es
seguro.

## §6 · Inventario de productores, para el paso 5

**16 funciones SQL, 24 puntos de llamada** a `_queue_system_alert`:

| función | llamadas | | función | llamadas |
|---|---:|---|---|---:|
| `db_health_watchdog` | 6 | | `edge_drift_watchdog` | 1 |
| `db_health_stale_devices_report` | 2 | | `hubrise_order_stuck_watchdog` | 1 |
| `db_health_writer_regression_check` | 2 | | `kds_device_silence_check` | 1 |
| `edge_drift_salud_watchdog` | 2 | | `kds_device_stale_bundle_check` | 1 |
| `ingesta_silencio_watchdog` | 2 | | `modifier_zero_cost_watchdog` | 1 |
| `_generate_daily_count_core` | 1 | | `sale_line_cost_sweep` | 1 |
| `codigo_plataforma_watchdog` | 1 | | `sales_unmapped_watchdog` | 1 |
| `db_health_connection_guard` | 1 | | `system_alert_queue_drain` | 1 (su meta-aviso) |

Más `availability-watchdog` (edge, por RPC). El encargo decía 15; son 16 funciones y **24 sitios**, que es
el número que cuenta para el paso 5.

## §7 · Lectores de la tabla, para el barrido de la regla 32

Tres, y ninguno se rompe al añadir columnas nullables:

- `system_alert_queue_drain` — `select *` a un `record`, usa campos por nombre.
- `hubrise_ops_dashboard` — sólo `count(*)` filtrado por `kind` y fecha.
- `_queue_system_alert` — `exists(...)` por `debounce_kind`.

En `src/`: **ninguno**. La tabla tiene **RLS activo y cero políticas**, y ni `anon` ni `authenticated`
pueden leerla: es de `service_role`. No hay pantalla que romper.

## §8 · El detalle que habría vuelto a romper los vigías

`_queue_system_alert` tiene hoy **cinco argumentos y dos valores por defecto**, y el de la ventana **no es
NULL**:

```
proargdefaults → NULL::text, '20:00:00'::interval
```

Veinte horas. Un envoltorio que lo dejara en NULL no daría error: dejaría sin antirruido todas las llamadas
de 3 y 4 argumentos, y el síntoma sería correo repetido, no un fallo. La migración del paso 1 conserva ese
default **y lo comprueba comparando el literal**, con la migración abortando si alguien lo cambia.

## §9 · Lo que el encargo tiene que añadir a su §7

1. **Migrar los seis productores directos a la cola** (§2). Sin esto, «una sola cañería» es media.
2. **Reactivar `jobid 45`** antes de reescribir `last_catalog_watchdog` (§5).
3. **La línea base del éxito es 76 avisos / 6,5 días**, y el después se mide con la misma ventana (§1).
4. **Local sin horario cargado = no se avisa y se lista**, y el vigía ancla por `account_id` + `location.id`,
   nunca por nombre (§4).

---

## §10 · Ensayo del paso 3 (`ingesta_silencio` por local): **43 → 9**

Simulado tick a tick —cada 10 minutos, como corre de verdad— sobre los 7 días que caben en la cola, y con
**las mismas funciones que usará el código** (`is_brand_open`, `availability_location_open_minutes`), no con
una reimplementación de su lógica. Eso es lo que hace que el ensayo pueda llevarme la contraria.

| local | severidad | avisaría | peor silencio | anclaje |
|---|---|---|---:|---|
| Carabanchel | crítico | 02/09 22:30 | 41 min | 22:40 |
| Carabanchel | crítico | 03/09 20:30 | 30 min | 21:30 |
| Carabanchel | alto | 04/09 16:50 | **146 min** | 15:44 |
| Alcalá | alto | 04/09 18:40 | 60 min | 17:39 |
| Carabanchel | crítico | 04/09 23:40 | 32 min | 23:07 |
| Carabanchel | alto | 05/09 18:40 | 67 min | 17:32 |
| Alcalá | crítico | 06/09 22:10 | 31 min | 21:39 |
| Carabanchel | crítico | 07/09 21:10 | **113 min** | 20:37 |
| Alcalá | crítico | 07/09 23:10 | 38 min | 22:32 |

Nueve, contra 43. Y los dos gordos —146 min en Carabanchel el 04/09 y 113 el 07/09— son cortes reales en
pleno servicio: eso es lo que un aviso tiene que decir, y hoy queda enterrado entre 43.

El ensayo cubre la rama de «no entra nada», que es la que producía el ruido. La rama de «la vía que más
pedidos trae, muda» no está simulada y puede añadir alguno.

### Los umbrales, con la tabla delante

Cinco de los nueve rozan el umbral (30, 31, 32, 38, 41 min). Misma simulación, cambiando sólo los umbrales:

| | valle 60 | valle 75 | valle 90 | valle 120 |
|---|---:|---:|---:|---:|
| **punta 30** *(hoy)* | **9** | 7 | 7 | 7 |
| punta 40 | 5 | 3 | 3 | 3 |
| punta 45 | 4 | 2 | 2 | 2 |
| punta 60 | 4 | 2 | 2 | 2 |

La migración **no los cambia**: se quedan en 30/60. Subirlos es una decisión sobre cuánto silencio en cena
es tolerable, y se hace pasando argumentos al cron sin tocar la función.

### Quién se vigila, y por qué Kitchen Grill se queda fuera sin que sea un apaño

Local activo, de cuenta no interna ni suspendida, **con horario cargado** y con ventas en 7 días. Anclado
por `account_id` y `location.id`. Deja hoy exactamente Alcalá y Carabanchel, y fuera:

- los 3 locales de la plantilla → `is_internal` (y 0 ventas)
- Plaza Castilla → `active = false`
- **Kitchen Grill LstQ → sin horario cargado**

Lo de Kitchen Grill no está elegido para que cuadre con «esa cuenta está parada»: **sin horario no se puede
aplicar el veto, y vigilar sin veto es volver a la franja fija**. El criterio es el mismo para todos y no
menciona a nadie por su nombre. Y los que quedan fuera por eso salen en un aviso `info` una vez al día — la
decisión de si eso sobra está marcada dentro de la migración, en un bloque que se borra entero.

### El punto ciego del §6.1, cerrado

Hoy, si no hay NINGUNA venta en 12 h, `v_ultima` es NULL y el vigía calla: una caída larga es invisible.
Ahora, sin ventas desde que abrió, el ancla es la hora de apertura y **sí avisa**. Era el caso más grave y
era justo el que no se veía.

---

## §11 · Paso 5 hecho: **cero POST directos**, una sola puerta

`grep -rn "functions/v1/system-alert" supabase/functions/` fuera de la puerta compartida: **0 resultados**.
Era la medición del §2 y ahora da cero. Los seis productores directos pasan por `system_alert_queue`.

### `_shared/alerta.ts`, la puerta

Cada una tenía su propio `raiseAlert`, así que fueron **seis embudos**, no 31 puntos de llamada. Todos
llaman ahora a `encolarAlerta(sb, {...})`, que:

- exige `severity` en el tipo — no se puede encolar sin declararla, que es lo contrario de los 24 puntos
  viejos donde va NULL;
- **nunca lanza** (`catcher-webhook` no puede devolver 500: Catcher reintentaría y duplicaría estado);
- devuelve **qué ha pasado** —`encolada` / `callada` / `por-la-reserva` / `perdida`— en vez de `void`.
  «Callada por antirruido» y «perdida» son cosas opuestas y hasta hoy se veían igual desde fuera.

### La reserva no es una puerta trasera

Si la RPC falla, cae al POST directo de siempre. No es dejar el agujero: el único motivo realista de que la
RPC falle es que **la base no esté**, y sin base tampoco corre el drenaje — un aviso encolado en ese momento
no saldría nunca. La reserva es justo para el caso en que más falta hace, y se registra como
`ALERTA_POR_LA_RESERVA` para poder contarla. Si ese contador sube, es una avería en sí mismo.

### Lo que gana cada una

| función | kind | severidad | antirruido |
|---|---|---|---|
| `ingestion-synthetic-ping` | `synthetic_ping` | crítico | 1 h |
| `hubrise-connection-health` | `hubrise-connection-health` | crítico | 2 h |
| `catcher-webhook` | `catcher-delivery` | alto | 2 h |
| `hubrise-callback-ensure` | `hubrise-callback` | alto | 6 h |
| `availability-watchdog` | `availability-dispatch` · `location-status-dispatch` | alto | 24 h |
| `availability-watchdog` | `brand-closure` | aviso | 24 h |
| `hubrise-location-disconnect` | `hubrise-revoke-pending` | aviso | 24 h |

**El antirruido es lo que más cambia, y no es cosmético.** `ingestion-synthetic-ping` corre cada 10 minutos
y no tenía ninguno: una ingesta rota eran **6 correos a la hora, indefinidamente** — el mismo fallo que le
costó 96 correos en un día a `availability-watchdog`. Con la clave por día y ventana de 1 h, uno por hora
mientras dure. Las ventanas son las que menos me convencen de todo esto: son mi criterio sobre cuánto puede
esperar cada cosa, y se cambian en una línea.

### Campos: dos los llevan, y los que no, dicen por qué

- **`availability-watchdog` / `brand-closure`** ahora lleva `account_id`, `brand_id` y `location_id` como
  CAMPOS. Era el único aviso que ya decía el local… **dentro del texto**, o sea imposible de filtrar o de
  contar. Hubo que añadir los tres ids al `select` de `brand_closure`, que sólo traía nombres.
- **`hubrise-location-disconnect`** lleva cuenta y local: el sitio que llama los tiene en la mano.
- **`hubrise-connection-health` va sin cuenta a propósito, y no es un campo sin rellenar:** ese aviso
  agrupa VARIAS conexiones, que pueden ser de cuentas distintas. Poner una sola sería mentir sobre su
  alcance. El día que se parta en un aviso por conexión, cada uno llevará la suya.
- **`ingestion-synthetic-ping` y `catcher-webhook` van sin local**, porque el hecho no es de un local: el
  webhook de ingesta es de sistema. Un NULL ahí es la verdad.

### Un comentario que se quedó mintiendo

`availability-watchdog` llevaba escrito «CON `debounceKind` va por la COLA… SIN él sigue el camino directo».
Era cierto hasta hoy y ha dejado de serlo. Reescrito: en este proyecto un comentario desactualizado es una
trampa, no un detalle.

### Comprobación de tipos, a los dos lados (regla 31)

`deno check` de las seis. Tres resuelven aquí; las otras tres importan por `esm.sh`, que el proxy bloquea,
así que se comprobaron cambiando el especificador **temporalmente** y devolviéndolo (el pin de la versión
sigue intacto, verificado después):

| función | con el cambio | sin él |
|---|---:|---:|
| `ingestion-synthetic-ping` | verde | — |
| `hubrise-location-disconnect` | verde | — |
| `catcher-webhook` | verde | — |
| `hubrise-callback-ensure` | 0 errores | 0 |
| `hubrise-connection-health` | 0 errores | 0 |
| `availability-watchdog` | 19 errores | **19** |

Los 19 son artefactos del cambio temporal de especificador, no míos: salen igual antes y después.

**Y un aviso sobre cómo casi lo doy por bueno:** la primera pasada la filtré con
`grep -E "^(Check|TS[0-9]+|error)"`, que no casa porque `deno` empieza las líneas con códigos de color. Salió
vacío y parecía verde. Lo era la salida del `grep`, no la comprobación. Con el **código de salida** salieron
dos errores reales — a dos ficheros no les había entrado el `import`. Misma familia que verificar un permiso
leyendo el texto del ACL: la vara medía otra cosa.

### Deuda que este paso hereda, y hay que decirla

El despliegue **excluye `_shared` por nombre** y cada función se lleva su copia dentro de su paquete: cambiar
`_shared/alerta.ts` **no redespliega a quien lo usa**. Hoy no muerde —las seis cambian a la vez—, pero el día
que se toque sólo la puerta, las seis se quedarán con la versión vieja **sin que nadie avise**.
