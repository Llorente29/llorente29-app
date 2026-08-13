---
name: folvy_vigia_conexiones_diseno_20260813
description: DISEÑO del vigía de salud de BBDD tras el colapso del 13/08 — por qué el vigía actual NO avisó (es circular: vive dentro de lo que vigila) y las 3 capas que lo arreglan, incluida la autodefensa que evita tener que reiniciar a mano. Leer antes de tocar db_health_watchdog, db_health_snapshot o system_alert_queue_drain.
sources:
  - cowork
estado: DISEÑO · Capa 1 y 3 listas para aplicar · Capa 2 requiere decisión de Julio
---

# Vigía de conexiones — rediseño

> **El vigía existía, estaba bien escrito, y no sirvió de nada.** Entender por qué es más importante
> que el código.

---

## 1. Por qué NO avisó (13/08)

**Es circular: el vigía vive dentro de la base que vigila.** Cuando la base se ahogó:

1. **No pudo ejecutarse** — `db_health_watchdog` falló **245 veces** con `job startup timeout`. No es
   que tardara: es que no conseguía conexión para arrancar.
2. **Y aunque hubiera detectado algo, no habría podido enviarlo** — el aviso se **encola** en
   `system_alert_queue`, y quien lo envía es `system_alert_queue_drain`, que falló **250 veces** por lo
   mismo.

> **Doble fallo en el mismo punto: ni detecta ni envía.** Por eso llegó el aviso de 53/60 el 12/08 y
> después, silencio absoluto mientras la base moría durante 6 horas.

**Prueba forense:** la consulta que aparece en los logs tardando **10.464 ms** —
`SELECT setting FROM pg_settings WHERE name='max_connections'` — **es la última línea de
`db_health_snapshot()`**. Es el propio vigía ahogándose en el agua que vigila.

### Y además avisa tarde
Umbral actual: **80 % = 48/60**. Con sondeo sin freno, cruzar 48 y llegar a 60 es cuestión de minutos.
Hay que saberlo **subiendo**, no **llegando**.

---

## 2. Capa 1 — que avise ANTES y que el aviso SALGA (dentro de la BBDD)

| Cambio | Hoy | Nuevo |
|---|---|---|
| Umbral de aviso | 80 % (48/60) | **65 % (39/60)** |
| Aviso por **tendencia** | no existe | **+10 conexiones en 10 min** aunque no se cruce el umbral |
| Envío del aviso crítico | encolado (depende del drain) | **`net.http_post` DIRECTO**, sin pasar por la cola |
| Contenido del aviso | número de conexiones | **+ quién las consume** (top 3 `application_name`) |

**El punto clave es el envío directo.** El antiruido y la cola están bien para avisos normales, pero el
aviso de "me estoy quedando sin conexiones" **no puede depender de otro cron que se ahoga en el mismo
momento**. Se dispara en el acto o no se dispara.

**Y el diagnóstico dentro del aviso:** hoy dice "53/60". Debe decir "53/60 — 38 de PostgREST, 9 de
pg_cron". Con eso se sabe qué apagar sin tener que entrar a mirar (y esta madrugada **no se podía
entrar a mirar**).

---

## 3. Capa 2 — vigilancia EXTERNA (la única que sobrevive al ahogo)

**Ninguna capa dentro de Postgres puede avisar de forma fiable de que Postgres se muere.** Hace falta
algo fuera:

- Un **healthcheck externo** cada 2-5 min contra un endpoint trivial (Edge Function que haga
  `select 1` con timeout corto).
- **Dos fallos consecutivos → email/push inmediato.**
- Opciones: cron de Vercel (ya lo usáis), o un servicio externo tipo UptimeRobot / Better Stack (plan
  gratuito suficiente para esto).

⚠️ **Decisión de Julio:** si el healthcheck va por Edge Function de Supabase, comparte destino con la
base — es mejor que nada (la Edge sí responde aunque Postgres esté saturado y puede reportar el fallo),
pero **un servicio de terceros es más honesto**: sobrevive incluso a una caída total del proyecto.

---

## 4. Capa 3 — AUTODEFENSA (lo que habría evitado el reinicio manual)

Esta es la que cambia el resultado. Hoy, cuando el pool se llena, **no pasa nada**: se queda así hasta
que un humano reinicia el proyecto. Esta madrugada fueron **6 horas**.

**Freno automático**, en `db_health_watchdog` o en su propio cron:

```
si conexiones de cliente > 90% del máximo:
    terminar las conexiones 'idle' (NO 'idle in transaction', NO activas)
    con state_change > 5 minutos
    y application_name NOT IN (procesos de sistema)
  → registrar SIEMPRE qué se ha matado y avisar
```

**Por qué es seguro:** una conexión `idle` durante 5+ minutos no está haciendo nada; el cliente la
reabrirá sola cuando la necesite. **Nunca se tocan las activas ni las que tienen transacción abierta**
(ahí sí se perdería trabajo).

**Por qué importa:** convierte "la base cae 6 horas hasta que alguien la reinicia" en "la base se
defiende sola y avisa de que lo ha hecho". Es la diferencia entre un incidente y una anécdota.

---

## 5. Orden de aplicación

| # | Qué | Riesgo | Cuándo |
|---|---|---|---|
| **1** | Capa 1 (umbral 65 % + tendencia + envío directo + quién consume) | bajo, solo lectura y aviso | **ya** |
| **2** | Capa 3 (freno automático) | medio: mata conexiones — por eso solo `idle` >5 min | **ya**, cocina cerrada |
| **3** | Capa 2 (externa) | ninguno, es infraestructura | tras decisión de Julio |

⚠️ **Esto NO sustituye al arreglo del sondeo** (`fix/sondeo-adaptativo-tablet`). El vigía avisa y
frena; **quien deja de llenar el pool es la tablet.** Sin B, esto solo es una red más tupida bajo el
mismo problema.

---

## 6. La regla

> **Un vigía que depende de lo que vigila no es un vigía.** Todo sistema de alarma necesita al menos
> una pata fuera del sistema vigilado, y todo sistema crítico necesita **defenderse solo** — porque el
> aviso llega a un humano que puede estar durmiendo, y la base no puede esperar 6 horas.
