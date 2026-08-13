# ENCARGO CODE — B · Que las tablets se callen cuando no pasa nada

**Fecha:** 2026-08-13 · **Rama nueva:** `fix/sondeo-adaptativo-tablet`
**Causa raíz:** `claude_folvy_incidente_20260813_conexiones_causa_raiz.md` (leer §2 antes de tocar nada).
**Prioridad:** 🔴 MÁXIMA. El proyecto está parado hasta erradicar esto.
**Base ya al día:** migración `20260812T0100` aplicada y verificada; PR #59 (`fix/tablet-robustez`) mergeado.

---

## 0. El problema, en una línea

Esta madrugada la base dejó de aceptar conexiones **con las cocinas cerradas**. No fue un cron ni una
tablet estropeada: **las 3 tablets hicieron ~18.000 peticiones en 2,5 h sin un solo pedido**, porque
sondean a intervalo fijo y nadie les ha dicho nunca que el local está cerrado.

| RPC | Medido (2,5 h, cocina cerrada) | Ritmo real |
|---|---|---|
| `claim_print_jobs` | **4.537** | **cada 3 s por tablet** (`pollMs \|\| 3000`) |
| `kds_alarms` | 1.363 | 3/min |
| `orders_feed_by_token` | 1.360 | 3/min · **166 ms de CPU cada una** |
| `kitchen_day_banner_by_token` | 1.359 | 3/min |
| `availability_notices` | 682 | 1,5/min |

**Con 50 clientes × 3 tablets = ~3.600 peticiones/minuto en vacío.** No escala. Es el frente.

---

## 1. ⚠️ NO CONSTRUIR LO QUE YA EXISTE

`src/lib/retryBackoff.ts` (`runPollingLoop`) **ya está en main** y ya hace **backoff ante FALLO**
(1s→2→5→10→30). **No se duplica ni se reescribe: se EXTIENDE** con backoff **ante INACTIVIDAD**, que es
lo que falta. Dos conceptos distintos que conviven:

- **Fallo** → esperar más para no machacar una base que va mal. *(ya hecho)*
- **Inactividad** → esperar más porque no hay nada que hacer. *(esto es lo nuevo)*

---

## 2. B1 · Ritmo adaptativo por actividad

Añadir a `runPollingLoop` una opción `idleIntervalMs` + `idleAfter` (nº de ciclos vacíos seguidos):

- El `call` pasa a informar si **hubo trabajo** (devolver `boolean`, o que el loop lo infiera).
- Tras **`idleAfter` ciclos consecutivos sin trabajo**, el intervalo sube de `normalIntervalMs` a
  `idleIntervalMs` de forma progresiva (no de golpe).
- **Al primer ciclo con trabajo, vuelve INMEDIATAMENTE al ritmo normal.** Sin histéresis, sin esperas.

Aplicarlo a:

| Sondeo | Normal (no tocar) | Inactivo | Entra en inactivo tras |
|---|---|---|---|
| `claim_print_jobs` (`printWorker.ts`) | **3 s** | **45 s** | 20 ciclos vacíos (~1 min) |
| feed de pedidos / KDS | actual | **60 s** | ~5 min sin cambios |
| `availability_notices` | actual | **5 min** | ~5 min sin cambios |

> **El ritmo baja por ACTIVIDAD, no por reloj.** Decisión deliberada: atarlo al horario configurado del
> local dejaría sin imprimir un servicio que se alarga o un pedido tardío. Si hay trabajo, va rápido;
> si no lo hay, se calla. Nunca al revés.

**Coste de la latencia:** un ticket puede tardar hasta 45 s en salir si llega tras un rato muerto.
Aceptable y así se declara. Si Julio lo ve largo, se baja a 20 s — sigue siendo 7× menos tráfico.

---

## 3. B2 · Que exista el concepto "local cerrado"

Hoy **la tablet no sabe que el local ha cerrado**: por eso sondea igual a las 4 de la mañana.

- Cuando el local no tiene servicio (usar la señal que ya exista —`kitchen_time_config`, horarios de
  local o "sin pedidos vivos ni actividad en 60 min"—; **RECON primero, no inventar tabla nueva**), el
  sondeo baja a **mínimos: 1 llamada cada 5 min**, solo para seguir viva y detectar la reapertura.
- **Cualquier señal de actividad la despierta al instante** (un pedido, un toque en pantalla).
- El latido (`kds_heartbeat`, 60 s) **NO se toca**: es 1/min por tablet, barato, y es lo que permite
  saber si una tablet murió.

---

## 4. B3 · Que el feed no reprocese la noche entera

En `orders_feed_by_token`, la ventana `>= now() - interval '6 hours'` mantiene vivos los pedidos ya
cerrados. **De madrugada eso hace que reprocese el servicio completo de la noche —el de más volumen—
una y otra vez, para tres pantallas que nadie mira.**

- **Bajar de 6 h a 2 h.** Migración de sustitución quirúrgica (`pg_get_functiondef` + `replace` con
  guarda de ocurrencia única), **nunca reescribir el cuerpo entero**: es la función de las 3 tablets del
  pase y la que tumbó Carabanchel el 11/08.
- ⚠️ **Verificar antes con Julio** que 2 h no deja fuera ningún pedido que el pase necesite ver.

---

## 5. Fuera de alcance (NO tocar aquí)
- **`orders_feed_by_token` incremental (`?since=`)** — es el arreglo de fondo (166 ms/llamada), pero es
  cirugía mayor sobre la función crítica. **Encargo aparte, sesión dedicada.**
- El latido del KDS. Ya está arreglado de raíz (3,00 escrituras/min) y verificado.
- `statement_timeout` (hoy en 8 s, parche del 12/08). Se revierte a 3 s **cuando esto esté verificado**,
  no antes.

---

## 6. Verificación (medida, no estimada)

1. **En vacío:** con la tablet encendida y sin pedidos, contar peticiones durante 10 min.
   **Objetivo: bajar de ~72/min a menos de 10/min** entre las tres.
2. **Al despertar:** entra un pedido → el ticket se imprime y el feed lo muestra **sin esperar el
   intervalo largo**. Es el punto que no puede fallar.
3. **Tras un fallo de red:** el backoff de fallo (ya existente) sigue funcionando y no interfiere con el
   de inactividad.
4. **Medida final por MCP** (la hace Claude): repetir la consulta de `edge_logs` por RPC en una franja
   sin servicio y comparar contra los 18.000 de referencia.
5. Un punto que no se pueda ejecutar → se reporta **NO EJECUTADO**, nunca "superado".

---

## 7. Reglas
- Worktree aislado, `tsc -b` limpio (no `--noEmit`), ficheros completos, TS strict.
- **Ningún bundle sale antes que sus migraciones** (si B3 lleva migración, se aplica y verifica primero).
- **No mergear.** Julio verifica.
- Declarar estado git al terminar: rama · commit · pushed · PR · deploy · verificado.

---

## 8. La regla que sale de aquí

> **Ningún cliente puede sondear a ritmo fijo sin backoff ni apagado.** Un sondeo sin freno convierte
> cualquier lentitud pasajera en un ahogo permanente: el sistema no se recupera solo porque el propio
> cliente le impide recuperarse.
