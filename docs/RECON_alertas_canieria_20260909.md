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
