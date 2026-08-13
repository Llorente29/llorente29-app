---
name: folvy_incidente_20260813_conexiones_causa_raiz
description: CAUSA RAÍZ del colapso de conexiones del 13/08/2026 (base inaccesible por cualquier vía, con las cocinas cerradas). Medido con pg_stat_statements, cron.job_run_details y edge_logs. Contiene el plan de erradicación en 3 capas y la prueba de por qué el modelo actual de sondeo NO escala. Leer antes de tocar orders_feed_by_token, claim_print_jobs, el latido del KDS o cualquier sondeo de tablet.
sources:
  - cowork
estado: DIAGNÓSTICO CERRADO · plan pendiente de aprobación de Julio
---

# Incidente 13/08/2026 — la base dejó de aceptar conexiones (con las cocinas cerradas)

> **Lo que hay que retener:** no fue un cron, no fue AnyDesk, no fue una tablet estropeada.
> **Fue el modelo de sondeo de las tablets, que no se calla nunca.** Con 3 tablets ya tumba la base.

---

## 1. Qué pasó

| Hora (Madrid) | Qué |
|---|---|
| hasta 03:10 | Todo normal. 460 ejecuciones de cron/hora **a 0,1 s y 0 fallos** (17 h seguidas, servicio incluido) |
| ~03:45 | Empiezan `canceling statement due to statement timeout` |
| 03:50 | `SELECT setting FROM pg_settings WHERE name='max_connections'` tarda **10.464 ms**. Leer un ajuste trivial |
| 03:52–03:54 | Ráfagas de `could not accept SSL connection: Connection reset by peer` / `EOF detected`, **varias en el mismo milisegundo** |
| **03:46** | Primer `job startup timeout`: **los crons ya no pueden ni arrancar** (no es que tarden: no obtienen conexión) |
| 04:00–09:00 | ~370 fallos/hora. **No se recupera solo** |
| 09:15 | Ni MCP ni SQL Editor ni el panel (`Failed to retrieve schemas`) pueden conectar |
| 09:18 | **Restart del proyecto** → 60/60 conexiones → **5/60**. Resuelto el síntoma |

**Descartados con prueba:**
- **Los 38 crons.** Iban a 0,1 s con 0 fallos durante 17 h. Los `job startup timeout` son **víctima**, no causa. `cleanup_auth_rate_limits_daily` (sospechoso inicial) también falló: no pudo ni arrancar.
- **AnyDesk** (cargado en la tablet de Carabanchel el 12/08). Es escritorio remoto: no abre conexiones a Postgres. Coincidencia temporal.
- **Una tablet concreta.** Las tres hacen exactamente lo mismo.

---

## 2. 🔴 LA CAUSA: sondeo de intervalo fijo, sin freno y sin apagado

Tráfico medido **de madrugada, cocinas cerradas, 2,5 h** (`edge_logs`):

| RPC | Llamadas | Ritmo por tablet |
|---|---|---|
| **`claim_print_jobs`** | **4.537** | **~10/min → 1 cada 6 s** |
| `kds_alarms` | 1.363 | 3/min |
| `orders_feed_by_token` | 1.360 | 3/min |
| `kitchen_day_banner_by_token` | 1.359 | 3/min |
| `availability_notices` | 682 | 1,5/min |

**~18.000 peticiones en 2,5 h sin un solo pedido.** ~72/min sostenidas, 24/7.

### Y el coste NO está donde está el volumen (`pg_stat_statements`)

| RPC | Llamadas | CPU total | **ms/llamada** | Pico |
|---|---|---|---|---|
| **`orders_feed_by_token`** | 532 | **88,3 s** | **166,1 ms** | **7.705 ms** |
| `kitchen_day_banner_by_token` | 533 | 25,5 s | 47,9 ms | 5.279 ms |
| `claim_print_jobs` | 1.754 | 22,8 s | 13,0 ms | 2.601 ms |
| `kds_alarms` | 536 | 12,3 s | 22,9 ms | 3.118 ms |

> **`orders_feed_by_token` es el devorador: 13× más cara por llamada que `claim_print_jobs`.**
> Confirma lo que ya decía `folvy_estado.md` ("71 % de la CPU").

**Por qué es tan cara:** 5 CTEs, `jsonb_array_elements` sobre el `raw_tab` de cada venta, subconsultas
correlacionadas por línea y por hija, agregación anidada. **Reconstruye el feed completo del pase desde
cero en cada llamada.**

**Y por qué es peor de noche:** la ventana `>= now() - interval '6 hours'` mantiene vivos los pedidos
cerrados. Tras el cierre, **sigue procesando el servicio entero de la noche** —el de más volumen—
una y otra vez, para tres pantallas que nadie mira.

### El bucle que mata
Base lenta → las RPC tardan → **522/504** (~200 de cada, medidos) → **la tablet reintenta al mismo
ritmo fijo** → más conexiones ocupadas → más lentitud. Sin backoff, no hay salida. Solo se corta
reiniciando.

---

## 3. Por qué esto NO escala (la pregunta de Julio)

| | Tablets | Peticiones/min en vacío |
|---|---|---|
| Hoy: 1 cliente, 2 locales | 3 | **~72** |
| 50 clientes × 3 tablets | 150 | **~3.600** |

Y el `statement_timeout` está en **8 s** (parche del 12/08, era 3): cada consulta atascada **retiene su
conexión casi el triple**. No causó el incidente, pero lo amplifica.

**Conclusión: el modelo actual no aguanta el segundo cliente serio, y menos el quincuagésimo.**

---

## 4. Plan de erradicación (3 capas, en este orden)

### 🔴 C1 — Que las tablets se callen cuando no hay nada (impacto inmediato, riesgo bajo)
1. **Backoff exponencial ante error.** Ante 5xx/timeout: 1 s → 2 → 4 → 8 → hasta 60 s. Hoy reintenta al
   ritmo fijo y realimenta el atasco. **Ya está escrito en `fix/tablet-robustez` — lleva un día sin mergear.**
2. **Ritmo según actividad.** Con 0 pedidos vivos y >15 min sin cambios, `claim_print_jobs` pasa de 6 s a
   30-60 s; el feed, de 20 s a 60 s. Al llegar un pedido, vuelve al ritmo vivo.
3. **Parada nocturna con el local cerrado.** Si el local no tiene servicio, el sondeo baja a mínimos
   (1 llamada/5 min de vida). Hoy no existe ese concepto: **la tablet no sabe que el local está cerrado.**

### 🟠 C2 — Que el feed cueste lo que debe
4. **Ventana de 6 h → 1-2 h.** Que el pase no reprocese el servicio entero toda la noche.
5. **`orders_feed_by_token` incremental** (`?since=`): devolver solo lo cambiado desde la última llamada,
   no el feed entero cada 20 s. Es el cambio de fondo.
6. **Sacar `raw_tab`/`jsonb_array_elements` del camino caliente**: precalcular la nota de cliente al
   escribir la línea (patrón de las tres patas), no en cada lectura.

### 🟡 C3 — Que no vuelva a pasar en silencio
7. **Vigía de conexiones que sobreviva al ahogo.** `db_health_watchdog` corre cada minuto y **falló 245
   veces**: se ahoga en el agua que vigila. Debe avisar **desde fuera** (o con umbral temprano, ~40/60,
   no 53).
8. **Revertir `statement_timeout` a 3 s** cuando C1 esté verificado (hoy sigue en 8).
9. **Techo de compute:** el proyecto está en `t4g.nano` (el más pequeño) con RAM al 71 % en reposo. Con
   C1+C2 hechos, reevaluar si sube a `small` antes del cliente 2.

---

## 5. Regla que sale de aquí

> **Ningún cliente (tablet, app, agente) puede sondear a ritmo fijo sin backoff ni apagado.**
> Un sondeo sin freno convierte cualquier lentitud pasajera en un ahogo permanente: el sistema no se
> recupera solo porque el propio cliente impide que se recupere.

Corolario: **el coste de una RPC del camino caliente se mide (`pg_stat_statements`), no se supone.** 166 ms
× 3 tablets × 24/7 es una carga de fondo permanente, no un detalle.
