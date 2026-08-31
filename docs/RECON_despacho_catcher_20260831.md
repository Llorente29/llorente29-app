# RECON — Folvy despacha a Catcher pedidos que reparte la plataforma

**31/08/2026, noche.** Antes de construir: dónde se decide `service_type`, dónde se dispara el
despacho, y por qué hoy no miran lo que ya está configurado.

---

## 🔴 La premisa del encargo hay que corregirla antes de construir el punto 1

> «El interruptor existe y NO se lee. No hay que construir la configuración: hay que hacer que el
> despacho la lea.»

**El despacho automático SÍ lo lee.** Verificado en vivo llamando al resolutor real sobre los
pedidos afectados, con el estado de hoy:

```sql
select (select carrier from resolve_dispatch(s.id)),
       (select reason  from resolve_dispatch(s.id))
  from sale s join brand b on b.id=s.brand_id
 where b.name in ('Smash Brothers Burgers','Lovers Burgers') and s.service_type='own_delivery';
```

Los seis devuelven **`carrier = null`**, motivo **«marca sin reparto propio (interruptor apagado)»**.
Y `tg_auto_dispatch` sólo despacha en `IF v_carrier = 'own_fleet'` / `ELSIF v_carrier = 'catcher'`:
con `null` **no entra en ninguna rama**. El guard existe, está en `resolve_dispatch`, y funciona.

Lo que no lee el interruptor es **otra cosa**, y son tres sitios distintos. El punto 1 apunta al
camino que ya está bien.

---

## 1. Los cuatro puntos, con veredicto

| # | Punto | Qué decide | ¿Lee el interruptor? | ¿Lee la dirección? |
|---|---|---|---|---|
| P1 | `hubrise-webhook` → `resolveDeliveryServiceType` | `service_type` al entrar | ❌ **no** | ❌ no |
| P2 | `trg_auto_dispatch` → `resolve_dispatch` | despacho automático | ✅ **sí, y corta** | ❌ no |
| P3 | `dispatchOrder` (botón del front) → `catcher-dispatch` | despacho manual | ❌ **no** | ⚠️ solo coordenadas |
| P4 | `dispatch_watchdog_scan` (cron, cada 3 min) | la ALARMA | ❌ **no** | ❌ no |

### P1 · La clasificación no mira el interruptor — y ahí nace todo
`resolveDeliveryServiceType` cruza `channel_delivery_policy` (canal × `ownership_type`). **Nunca
consulta `brand.own_delivery_enabled`.** Su propio comentario dice:

> *«resolve_dispatch/tg_auto_dispatch NO se tocan: ya tienen su propio guard por marca
> (own_delivery_enabled) y funcionan bien una vez el pedido ENTRA con el service_type correcto.»*

Es cierto, y es exactamente el problema: **el guard corta el DESPACHO, no la CLASIFICACIÓN.** El
pedido entra marcado `own_delivery`, se queda así en la pantalla, y de ahí en adelante todo lo que
mire `service_type` —el tablero de despacho, el vigía— lo trata como reparto propio.

### P2 · El despacho automático está bien. No tocarlo.
Es el único de los cuatro que hace lo correcto. Cualquier arreglo debe dejarlo como está.

### P3 · El botón del front esquiva el resolutor entero
```ts
export async function dispatchOrder(saleId: string): Promise<void> {
  const { data, error } = await supabase!.functions.invoke('catcher-dispatch', { body: { sale_id: saleId } })
```
Llama a `catcher-dispatch` **directo**. No pasa por `resolve_dispatch`, así que no hay guard de
marca. `catcher-dispatch` sí rechaza sin coordenadas, pero eso es una red al final del todo.

### P4 · El vigía dice «Enviado a Catcher» de pedidos que nunca se enviaron
Esto es lo más grave de lo encontrado, y explica las alarmas posteriores al apagado del interruptor.
`dispatch_watchdog_scan` marca como alarma todo pedido `own_delivery` + `accepted` + sin
`carrier_order_id` pasado el margen, y escribe:

```sql
dispatch_error = 'Enviado a Catcher, sin rider tras ' || p_grace_minutes || ' min. Revisar/despachar a mano.'
```

**Ese texto es falso cuando `resolve_dispatch` se negó a despachar.** El pedido no se envió a nadie:
el guard hizo su trabajo. Pero el vigía no distingue «se envió y no vino rider» de «no se envió
porque la marca no reparte», y llama a las dos cosas lo mismo.

Es la familia de la regla 8 al revés: no es un botón que calla, es un vigía que **afirma** algo que
no ha pasado. Y es la razón de que el encargo concluyera que el interruptor no se lee: la evidencia
que decía «Enviado a Catcher» era ella misma la mentira.

---

## 2. Correcciones a los datos del encargo

**`dispatch_mode = 'auto'` no significa «se despachó».** Está en los **104** pedidos de las dos
marcas, incluidos los `platform_delivery` que nunca se tocaron: se copia del modo del local. Los
«23 despachos auto» del encargo cuentan eso. Lo que sí prueba un intento es `dispatch_error`:
**20 en Smash + 2 en Lovers = 22**, que coincide con las 22 del encargo.

**Lovers Burgers tiene el interruptor en `false` desde hoy a las 21:49 de Madrid**, no `null`.
Durante todo el incidente estuvo en `null` — el encargo acertaba —, pero alguien lo apagó hace un
rato. Anotado porque cambia qué se puede replayar: hoy las dos marcas cortan por interruptor.

| marca | `own_delivery_enabled` | desde |
|---|---|---|
| Smash Brothers Burgers | `false` | 30/08 **18:45:15** Madrid ✓ coincide con el encargo |
| Lovers Burgers | `false` | 31/08 **21:49:48** Madrid ← esta noche |

**Hay DOS fichas de marca con cada nombre** (`Smash Brothers Burgers`, `Milanesa House`, `Mila's
Sandwiches`…), de cuentas distintas. Las de Foodint son las que tienen los pedidos. Regla 9:
cualquier consulta o guarda que ancle por nombre de marca filtra primero por `account_id`.

---

## 3. Qué habría que construir, corregido

1. **P1 · La clasificación mira el interruptor.** Si `own_delivery_enabled` es `false`, el pedido
   entra `platform_delivery`. Es el arreglo pequeño que corta el daño de raíz: sin `own_delivery`
   no hay tablero, ni vigía, ni alarma. *(El encargo pedía esto para el despacho; va en la
   clasificación.)*
2. **P4 · El vigía deja de mentir.** Antes de alarmar, preguntar a `resolve_dispatch`: si devuelve
   `null`, ese pedido no se envió y no es un «sin rider». Y no alarmar sobre marcas sin reparto propio.
3. **P3 · El botón manual pasa por el mismo guard**, o al menos comprueba dirección e interruptor
   antes de invocar.
4. **Punto 2 del encargo (sin dirección no se despacha)** sigue valiendo entero y es independiente
   de todo lo anterior: es la red que habría parado los 22 casos aunque la configuración estuviera mal.

**El punto 3 del encargo (grano marca × plataforma) no lo toca nada de esto y sigue en pie**: con el
grano actual, Glovo + marca propia = reparto propio, y por eso Lovers con `null` contaba como propio.

---

## 4. El cabo suelto del encargo, mirado

Milanesa House y Mila's tienen 1 pedido cada una sin dirección. **No se han revisado uno a uno
todavía** — queda pendiente, y no se concluye nada sobre ellos.


---

## 5. El punto 5 (cerrar las alarmas falsas) NO necesita ninguna escritura

Autorizado por Julio, comprobado antes de ejecutar — y no hay nada que ejecutar.

**Las 21 alarmas ya están cerradas**, y no por esta sesión:

| marca · origen | con alarma | activas | ya cerradas | último cierre |
|---|---|---|---|---|
| Smash Brothers · hubrise, sin dirección | 19 | **0** | 19 | 31/08 16:45 UTC |
| Lovers Burgers · hubrise, sin dirección | 2 | **0** | 2 | 31/08 17:52 UTC |
| Smash Brothers · lastapp, **con dirección** | 12 | **0** | 12 | 22/08 20:57 UTC |

La verificación 5 del encargo —«el contador de alarmas activas baja en 21»— **no puede cumplirse**:
ya está en cero para estas dos marcas. Ejecutar el cierre habría reescrito `dispatch_error` en 21
filas sin ganar nada, y eso es justo lo que la verificación 7 quiere evitar.

**Las 6 alarmas activas que quedan en toda la base son de otra cuenta** (Kitchen Grill LstQ), todas
`own_delivery` **con dirección**, y sus errores son legítimos («el local no tiene…», «sin rider»).
Son exactamente las «alarmas legítimas» que la verificación 5 pide no tocar.

Huella de `sale` al comprobar todo esto: **8.941 ventas, `44614acd69a3b1e4654c102681c377dc`**. No se
ha escrito nada, así que sigue siendo esa.

**Nota aparte, no del encargo:** los 12 de lastapp con dirección son otro problema — reparto propio
real que se intentó y falló por falta de rider, no por clasificación. El trigger no los toca a
propósito. Si se quiere mirar, es otro hilo.
