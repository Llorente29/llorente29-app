# B32 — Dónde vive el guardián de la OTA, y contra qué campo decide

**Fecha:** 03/09/2026 · **Tipo:** RECON, no arreglo · **Encargo:** ENCARGO CODE 03/09, §2

## Respuesta en una línea

**Ninguna de las dos hipótesis del encargo.** El guardián **no** mira
`sale.status`, y **no** lee `kds_board`. Mira **`sale.order_status`** con un
horizonte de **12 horas**, y **sí está en la base de datos** — en una función
que no dice «bundle» ni «OTA» en ninguna parte, que es por lo que la búsqueda
anterior no la encontró.

## Fichero y línea

La decisión está repartida entre el código de la tablet y una RPC:

| pieza | fichero | línea |
|---|---|---|
| Sonda cada minuto de la ventana segura | `src/components/UpdateGate.tsx` | 181 |
| Motivo en pantalla si hay pedidos vivos | `src/components/UpdateGate.tsx` | 93 |
| Llamada a la RPC | `src/native/appUpdate.ts` | 147 |
| Mapeo `active_orders` → `activeOrders` | `src/native/appUpdate.ts` | 169 |
| **La decisión de verdad** | **`public.station_update_window`** (Postgres) | — |

`UpdateGate.tsx:36` ya lo dice en su cabecera: *«sin pedidos en curso │ RPC
station_update_window (lo que sólo la BBDD sabe)»*.

## El criterio exacto, copiado de la función viva

```sql
select count(*) into v_active_orders
  from sale s
 where s.location_id = v_device.location_id
   and s.order_status is not null
   and s.order_status not in ('completed', 'cancelled')
   and s.created_at > now() - interval '12 hours';
```

Si `v_active_orders > 0`, la ventana devuelve `safe:false` con motivo
`pedidos_en_curso`, y el canal OTA **espera en silencio**. De ahí sale, literal,
el «12 h» de la ficha B32: es el `interval '12 hours'` de esta consulta.

## Qué significa para las 42 ventas del frente B47

Medido hoy contra producción:

| `order_status` | `status` | filas | dentro de la ventana de 12 h | ¿bloquea la OTA? |
|---|---|---:|---:|---|
| `cancelled` | `open` | 42 | 1 | **No** — la RPC ya lo excluye por nombre |
| `delivery_failed` | `open` | 1 | 0 | No hoy (fuera de las 12 h) |
| `rejected` | `open` | 1 | 0 | No hoy (fuera de las 12 h) |

Y la cuenta que hace la RPC ahora mismo, en todos los locales:

```
bloquean_ota = 0 filas
```

**Nada bloquea la OTA en este momento, en ningún local.**

## Entonces, ¿se cierra B32?

**En la práctica sí; por el motivo que dice la ficha, no.** Hay que decirlo
separado porque cerrarla por la razón equivocada deja el agujero abierto:

1. **B47 no lo desbloqueó.** B47 arregló `kds_board`, y el guardián no lee
   `kds_board`. Son piezas independientes que coincidían en síntoma.
2. **`status='open'` nunca fue el problema.** El guardián no mira `status`.
3. **Lo que desatasca es el propio horizonte de 12 h**: una venta atascada
   deja de contar 12 h después de `created_at`, la arregle alguien o no. El
   sistema se cura solo, y por eso hoy sale cero.

**Riesgo residual, que es lo que queda vivo de B32:** un pedido que se quede en
un `order_status` distinto de `completed`/`cancelled` —`rejected`,
`delivery_failed`, `preparing`, `accepted`— **bloquea la OTA de ese local hasta
12 h desde su creación**. No es permanente, pero sí es una ventana de servicio
entera. En el histórico hay 2 casos (`rejected` del 23/08, `delivery_failed`
del 27/08) que bloquearon durante sus 12 h.

**Cambiar el criterio es otra decisión y no se toca aquí**, como pide el
encargo. Si se quisiera cerrar del todo, el sitio es la lista de exclusión de
`station_update_window` — y ojo con `delivery_failed`, que según la cabecera de
la migración B47 **sí conserva consumo a propósito** (la comida se hizo).

## Por qué la búsqueda anterior no la encontró

Se buscó «ninguna función de Postgres que hable de bundle/OTA lee `sale`». Es
cierto y a la vez despista: `station_update_window` es una función de la
**estación de impresión**, escrita para el KDS, que el actualizador reutiliza.
No contiene las palabras «bundle» ni «OTA». La OTA es cliente suyo, no su tema.
