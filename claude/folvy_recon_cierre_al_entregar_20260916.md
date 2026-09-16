# RECON — cerrar al entregar (URGENTE §3.1) y dónde está hoy el Pase

**16/09/2026, 19:20–19:35.** Primera sesión única. Rama nueva desde `main`:
**`feat/pedidos-cierre-al-entregar`** (`main` = `6e7773bd`). Todo lo de aquí es
lectura: la ventana de base se cerró a las 19:15, así que **hoy no se aplica
nada**. La siguiente es de 00:30 a 12:15.

---

## 0 · Dónde está el Pase, y qué dejó la sesión parada

- **`origin/claude/conteo-formatos-validacion-pwbctk`** (la rama de la sesión
  que lleva parada desde las 09:01): `git log origin/main..` **vacío**. No dejó
  ni un commit sin fusionar. No hay nada que rescatar ni con lo que chocar.
- `lasFases.ts` (286 líneas) y `lasTresZonas.ts` (379) están en `main`, con los
  predicados ya compartidos: `lasFases` importa `laSituacion`,
  `estaMarcadoListo`, `esRecogida` y `loRepartelaPlataforma` de `lasTresZonas`.
  La pieza que pide el encargo —una sola función de fase para las dos
  pantallas— **ya existe**; lo que falla es lo que decide.

## 1 · El fallo del URGENTE, localizado

`src/modules/orders/lib/lasFases.ts:196`:

```ts
export function estaTerminado(p: PedidoConFase): boolean {
  return (p.status ?? '') === 'closed' || (p.order_status ?? '') === 'completed'
}
```

**No mira la entrega.** Un pedido entregado y todavía abierto no es «terminado»,
así que `laFase` sigue bajando y cae en `esperando` porque tiene `ready_at`. Eso
es exactamente G231 y G764: la tarjeta dice «Entregado» y la pestaña dice
«Esperando repartidor».

Lo bueno: el distintivo «Recogido · en ruta» **ya está escrito**
(`elDistintivoDelRider`), y `laSituacion` ya distingue `en_ruta` y `entregado`
mirando el eje de la flota. El arreglo de pantalla es pequeño y no necesita base.

## 2 · El camino del cierre: existe, y es uno

```
CREATE TRIGGER trg_sale_close_on_complete AFTER UPDATE ON sale
  WHEN (new.order_status = 'completed'
        AND old.order_status IS DISTINCT FROM new.order_status
        AND COALESCE(new.status,'') <> ALL (ARRAY['cancelled','closed'])
        AND COALESCE(new.is_active, true))
  EXECUTE FUNCTION tg_sale_close_on_complete()   -- → close_sale(id)
```

Confirmado lo que decía el encargo: **cerrar al entregar = poner
`order_status='completed'`**, y no hay que construir ningún camino nuevo.

## 3 · 🔴 Pero el cierre SÍ reescribe el consumo, y dos veces

`close_sale` termina así, siempre:

```sql
perform public.generate_sale_consumption(p_sale_id);
```

Y `generate_sale_consumption` sobre una venta que **ya tiene** su consumo no es
un no-op. Medido en transacción revertida sobre G190 (la venta con más líneas
del 15/09):

| | |
|---|---|
| movimientos antes | 27 |
| movimientos después | 27 |
| **movimientos con identificador NUEVO** | **27** |
| huella antes | `ceaedc18…` |
| huella después | `0de9e056…` |

O sea: **borra los 27 y escribe 27 nuevos**. Misma cantidad, otros
identificadores y otro `created_at`.

**Y se dispara dos veces por el mismo cambio**, porque
`trg_sale_consumption_on_complete` no tiene `WHEN` y su rama 1 llama otra vez a
`generate_sale_consumption` cuando `order_status` cambia a `completed`.

El §3.1 pide «que no reescriba nada del consumo». **Con el camino de hoy, lo
reescribe.** Hay que decidir qué se hace con eso (ver §6).

## 4 · Para los dos de hoy, el cierre es seguro — medido uno a uno

En transacción revertida, llamando al escritor directamente sobre cada uno:

| pedido | movs antes | movs después | cantidad antes | cantidad después | notas de corte |
|---|---|---|---|---|---|
| **G231** | 8 | 8 | 1.388,904 | **1.388,904** | 0 |
| **G764** | 19 | 19 | 1.095,179 | **1.095,179** | 0 |

**No se pierde ni se gana nada.** Esa es la lista previa del §3.1, medida en vez
de supuesta.

**El riesgo general sigue existiendo, y hay que escribirlo:** `generate_sale_consumption`
respeta el corte de la regla 6. Una venta **por debajo de un recuento aprobado**
regeneraría **menos** de lo que tenía, y dejaría notas de corte donde había
movimientos. Cerrar tarde una venta vieja puede borrar consumo legítimo. Hoy no
muerde porque los dos son de esta tarde y Alcalá cerró su último recuento antes;
el día que se cierre algo viejo, sí.

## 5 · 🔴 El empuje: estos dos pedidos no son de Last

| pedido | source | service_type | carrier |
|---|---|---|---|
| G231 | **hubrise** | own_delivery | catcher |
| G764 | **hubrise** | own_delivery | catcher |

Y `trg_sale_push_status` empuja **solo si `source='lastapp'`**, y no a HubRise:
llama a la edge `order-advance`. El empuje de estado **a HubRise** no vive en la
base: está en `_shared/hubrisePush.ts`, y lo llaman `hubrise-webhook` y
`order-advance`.

**Consecuencia:** si el cierre automático se hace con un disparador en la base,
para G231 y G764 **no sale ningún empuje** — ni uno, ni dos. Si se quiere que
salga «una vez, igual que hoy al pulsar», el cierre tiene que pasar por el mismo
sitio por el que pasa el botón. Es la decisión del §6.

## 6 · Lo que necesito decidido antes de escribir la base

**¿Por dónde va el cierre al entregar?**

- **(a) Disparador en la base**, cuando `delivery_state` pasa a `delivered`:
  pone `order_status='completed'` y el resto ya ocurre solo. Es lo más simple y
  no depende de que nadie esté despierto. **Pero no empuja a HubRise**, y
  reescribe el consumo dos veces.
- **(b) Por `order-advance`**, el mismo camino del botón «Completar»: empuja
  igual que hoy y no hay dos verdades. **Pero** hace falta que algo llame a esa
  edge cuando llega la entrega, y hoy no hay quien lo haga desde la base más que
  con `net.http_post`, que es lo que ya hace `trg_sale_push_status`.

Mi recomendación, y digo por qué: **(b), reutilizando el patrón que ya existe.**
La regla del proyecto es que una regla viva en un sitio, y el cierre con empuje
ya vive en `order-advance`. Con (a) tendríamos dos maneras de cerrar según quién
lo dispare, que es exactamente lo que el encargo quiere evitar.

**Y en los dos casos hay que cortar la doble regeneración del consumo.** Lo
barato y honrado es que el cierre no vuelva a generar cuando la venta ya tiene
su consumo entero; lo mido y lo propongo con la medida delante.

## 7 · Apuntado de paso, y no lo toco

`trg_sale_push_status` lleva **el secreto de `order-advance` escrito en claro
dentro del cuerpo de la función**. Cualquiera que pueda leer `pg_proc` lo ve, y
hoy eso incluye más gente de la que debería. No es de este encargo y no lo
cambio sin decirlo: queda apuntado para que se mueva a un `Secret` y se rote.

## 8 · Y G858 confirma la parte B

`ready_at` **nulo**, `order_status='completed'`, `status='closed'`, cerrado a las
17:30:08. Es el caso de la parte B §3: el cierre de Last se lleva por delante el
«Listo». Se ataca en su turno.

---

## Lo siguiente, en orden

1. **Pantalla del URGENTE** (§3.2 y §3.3): entregado → Terminados, recogido con
   su distintivo, el número grande desde «Listo» y ámbar a los 20 min. Es solo
   código y no espera ventana. **Voy con esto ahora.**
2. **La base del §3.1**, cuando Julio elija entre (a) y (b). Ventana de 00:30.
3. **Maqueta** de A y B, para aprobar antes de tocar su pantalla.
