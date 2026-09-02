# RECON — El termómetro miente: la tablet «Cocina» funciona y su fila lleva 5 días muda

**01/09/2026.** Julio: la tablet de Cocina de Alcalá funciona perfectamente, pero su fila no late
desde el 27/08. Tres preguntas.

---

## 0 · Lo primero: Julio tiene razón, y se puede demostrar

Alcalá **ha estado trabajando** todo el tiempo que su tablet «Cocina» lleva callada. Contado desde
el minuto exacto del último latido (27/08 20:26):

| Señal | Desde que calló | Última |
|---|---|---|
| Impresiones completadas (`print_job.done_at`) | **330** | 31/08 23:21 |
| Líneas marcadas en cocina (`kds_line_state`) | **180** | 31/08 23:32 |

Y el estado de la fila:

| Dispositivo | Local | Activo | Último latido | Versión |
|---|---|---|---|---|
| Tablet camichi4 | Carabanchel | sí | 01/09 08:03 | bundle **199** |
| Pase | Alcalá | sí | 01/09 08:02 | bundle **199** |
| **Cocina** | **Alcalá** | **sí** | **27/08 20:26** | bundle **185** |
| Tablet J | Plaza Castilla | no | 20/07 | — |

**No es el token ni la fila**: `is_active = true` y el token resuelve. Lo que se congeló fue el
cliente, y congeló DOS cosas a la vez — `last_seen_at` (27/08 20:26) y `app_version_at`
(27/08 20:24) — que las escriben **RPC distintas en ciclos distintos**. Eso no es un latido roto:
es un runtime que dejó de ejecutar sus temporizadores.

Y encaja con el bundle: se quedó en el **185** mientras las otras dos van por el **199**. Es el
mismo mecanismo del RECON del service worker — una pestaña que nadie cierra no vuelve a pedir
`index.html` — con la vuelta de tuerca de que aquí además dejó de latir.

**LO QUE NO PUEDO DEMOSTRAR, Y ES EL HALLAZGO.** No puedo atribuir ni una sola de esas 330
impresiones ni de esas 180 marcas al dispositivo «Cocina». `print_job` no tiene columna de
dispositivo; `kds_line_state` tampoco. En todo el esquema, **la única columna que atribuye algo a
un `kds_device` es su propio `last_seen_at`**.

O sea: hay **una sola señal por dispositivo, autodeclarada, y sin ninguna segunda fuente que pueda
contradecirla**. Cuando esa señal falla no hay nada que diga «pues yo lo veo trabajando». Eso es,
literalmente, por qué el termómetro puede mentir.

---

## 1 · ¿Puede `kds_heartbeat` recibir un token que no case y «funcionar» igual?

**Sí, desde el punto de vista de quien llama.** La función hace lo correcto:

```sql
v_device := public.kds_resolve_device(p_token);
if v_device.id is null then
  return false;          -- no encontró dispositivo
end if;
```

Devuelve `false`. Pero por PostgREST eso viaja como **HTTP 200 con cuerpo `false`**. Y el cliente:

```ts
// src/native/print/printWorker.ts:332
await rpc('kds_heartbeat', { p_token: token });
```

**No mira el valor devuelto.** Un token huérfano, un token de un dispositivo desactivado o un
token de otra cuenta son indistinguibles de un latido correcto. Es la cuarta aparición del mismo
patrón, y ya está anotado en la casa: *«`kds_heartbeat` con token huérfano devolviendo HTTP 200 —
tres días de tablet invisible»* (regla 8).

**Y el latido huérfano se tira.** No queda registrado en ningún sitio: ni el token que se intentó,
ni cuándo, ni desde dónde. La información más valiosa que existe —«alguien está latiendo con un
token que no reconozco»— se descarta en la línea `return false`.

## 2 · ¿Pueden dos dispositivos compartir token y pisarse el `last_seen_at`?

**Dos FILAS no**: hay `UNIQUE (token)` en `kds_device` y hoy no hay ningún token repetido
(comprobado: 0).

**Dos DISPOSITIVOS FÍSICOS sí, y nada lo impide.** El token vive en `localStorage`
(`kds_device_token`). Copiarlo a una segunda tablet —o clonar una tablet, o restaurar una copia de
seguridad— hace que las dos latan contra la MISMA fila. La base de datos no puede distinguirlas:
recibe `p_token` y nada más.

Consecuencia exacta del caso de hoy: si alguien hubiera puesto el token de «Cocina» en otro
aparato, la fila se vería viva mientras la tablet de Cocina está muerta — el mismo síntoma, con el
signo cambiado y **sin ninguna forma de detectarlo desde los datos actuales**. Hoy no ha pasado,
pero nada lo impide.

Hay un freno de 10 s en el `UPDATE` que evita escrituras seguidas, pero no distingue quién late:
solo hace que el segundo aparato no escriba si el primero acaba de hacerlo.

## 3 · El vigía dice «apagada» cuando lo que sabe es «no me llega señal»

Hoy la única condición es `last_seen_at` viejo, y de ahí se concluye «tablet muda / apagada». Son
tres cosas distintas metidas en una:

| Lo que pasa de verdad | Lo que dice hoy |
|---|---|
| La tablet está apagada o sin red | «sin latido» ✔ correcto |
| La tablet funciona y su bucle de latido murió (**el caso de hoy**) | «sin latido» ✘ acusa a un aparato sano |
| Alguien late con un token que no reconocemos | **nada**: se tira el latido |
| Dos aparatos comparten token | **nada**: la fila parece sana |

---

## Lo que propongo construir (nada tocado todavía)

En el orden en que arregla más por menos:

1. **El latido huérfano se registra, no se tira.** Una tabla `kds_heartbeat_orfano` con el token
   intentado (o su hash), el `now()`, la IP y el `user-agent` — se pueden sacar de
   `current_setting('request.headers', true)` dentro de la RPC. Sin esto seguimos ciegos ante el
   caso más informativo.
2. **El cliente mira lo que le contestan.** Si `kds_heartbeat` devuelve `false`, la tablet lo dice
   en pantalla («este aparato no está reconocido») en vez de seguir latiendo al vacío. Regla 8.
3. **Una segunda fuente de vida.** Que `print_job` y `kds_line_state` lleven `device_id`. Con eso
   el vigía puede decir «no me llega latido de Cocina **pero la veo imprimiendo**», que es la frase
   verdadera de hoy y la que nadie pudo decir.
4. **El vigía separa los cuatro casos** de la tabla de arriba, y cambia «tablet muda» por lo que
   de verdad sabe: *sin señal atribuible*.
5. **Detectar token compartido**: dos latidos del mismo token desde IPs distintas en la misma
   ventana es un aviso, no un dato normal.

Los puntos 1 y 2 se pueden hacer solos y primero: uno abre los ojos y el otro deja de mentir en
pantalla. El 3 es el que de verdad arregla el termómetro, y es el más caro porque toca dos tablas
con escritura viva.
