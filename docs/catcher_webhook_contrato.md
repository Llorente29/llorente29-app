# Contrato del webhook de Catcher (reparto last-mile)

> Documentado a partir de los payloads reales enviados por Abdul Martínez (Catcher),
> 07/07/2026 (`webhook_payloads_202607071300.csv`, 3 pedidos, 18 payloads). Antes no
> había documentación oficial. Fuente de verdad hasta que Catcher publique la suya.

## Webhook Orders — estado del pedido + repartidor

Catcher hace POST a nuestra Edge `catcher-webhook` en CADA cambio de estado del pedido.

### Campos (nivel superior)
| Campo | Tipo | Notas |
|---|---|---|
| `orderId` | string | Id del pedido EN CATCHER. Se guarda en `sale.carrier_order_id` al despachar. |
| `externalId` | string (uuid) | **Nuestro `sale.id`** (lo enviamos nosotros al crear el pedido). Clave de cruce principal. |
| `Order_status` | string | **O MAYÚSCULA.** El estado (ver máquina abajo). |
| `hasCourier` | boolean | `true` cuando ya hay repartidor asignado (desde `matched`). |
| `courier` | objeto\|ausente | Solo con datos cuando `hasCourier=true`. |
| `finishDetails` | objeto | Solo en `finish`. `{ delivered: bool, type, courierComments }`. |

### `courier` (solo con `hasCourier=true`)
| Campo | Notas |
|---|---|
| `name` | Nombre del repartidor → `sale.rider_name`. |
| `phone` | Teléfono del repartidor → `sale.rider_phone`. |
| `transportType` | `moto` / `bici` / `coche`... → `sale.rider_transport_type`. |
| `latitude` / `longitude` | Posición del rider **en el momento del cambio de estado** (NO streaming) → `sale.rider_lat/lng` + `sale.rider_seen_at`. |
| `transportPrice` | Coste real del reparto (string; castear) → `sale.transport_price`. En pruebas viene `"0"`. |

### Máquina de estados (orden real observado)
```
matching  ->  matched  ->  picking  ->  in_picking_location  ->  in_delivery  ->  finish
   \
    ->  canceled           (rama alternativa: cancelado sin repartidor)
```
- `matching`: buscando repartidor. `hasCourier=false`, sin `courier`.
- `matched`: repartidor asignado. A partir de aquí `hasCourier=true` + `courier`.
- `picking` / `in_picking_location`: yendo/llegado al local a recoger.
- `in_delivery`: en camino al cliente.
- `finish`: **finalizado — NO implica entregado.** Ver `finishDetails.delivered`.
- `canceled`: cancelado.

### CLAVE: `finish` no es "entregado"
En los payloads reales, un pedido acabó en `finish` con `finishDetails.delivered=false`
(NO entregado) y otro con `delivered=true`. Por eso el webhook **normaliza**:
| Order_status | finishDetails.delivered | `sale.delivery_state` guardado |
|---|---|---|
| `finish` | `true` | `delivered` (entregado) |
| `finish` | `false` | `failed` (finalizado sin entregar → el manager debe verlo) |
| `finish` | (ausente) | `finish` (crudo) |
| resto | — | el estado crudo (`matching`, `matched`, ..., `canceled`) |

## Webhook HD — `event = "home_delivery_status_changed"`
Estado del servicio de reparto del local (open/closed). Hoy solo se registra en log; el
manejo del estado HD del local es otro frente.

## Cruce y seguridad
- Cruce: `externalId` (= `sale.id`) primero; si no, `orderId` (= `sale.carrier_order_id`).
- No encontrado → responder 200 (no reintentar), dejar traza en log.
- Edge desplegada SIEMPRE con `--no-verify-jwt` (webhook externo; la frontera es la URL secreta + el cruce por ids que solo Catcher conoce).

## PENDIENTE (bloqueante para que llegue solo)
Catcher tiene que **registrar la URL** del webhook en su panel:
`https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-webhook` (Orders + HD).
Email enviado a it@catcher.delivery. Estos payloads fueron pruebas manuales de Abdul.
