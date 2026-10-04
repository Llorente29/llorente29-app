# Encargo R02 — Quién reparte, por marca y plataforma (incluye el arreglo R01)

Rama nueva desde `main`: `reparto-r02-marca-plataforma`. PR en borrador desde el primer commit. Una cosa cada vez; lo que surja fuera de esto, al PR como pendiente. Nada toca producción: staging por el workflow de siempre; a producción solo con el workflow de producción, ensayo antes que real, y con el «adelante» de Julio.

## 1. Por qué

Hoy quién reparte se decide por **plataforma × tipo de marca** (`channel_delivery_policy`) más un **interruptor por marca para todas las plataformas** (`brand.own_delivery_enabled`). La realidad de Foodint no cabe ahí: Smash Brothers va con reparto de Glovo en Glovo y reparto propio en Uber; Lovers la reparte siempre Uber; Mila's y Urban Kebab, propio en Glovo y Uber en Uber. Resultado del 02/10: avisos rojos en cocina, pedidos de Glovo entrando como reparto propio, pedidos de Uber sin dirección atascados, y dos escrituras a mano en producción para apagar fuegos. Además la pantalla «Quién reparte según plataforma» **no guarda** (R01: `ON CONFLICT` sin la condición de los índices parciales).

Esto se arregla de una vez, sin dejar dos mecanismos conviviendo.

## 2. Alcance

Entra:
- Una sola fuente de verdad: **marca × plataforma → quién reparte**, con herencia de un valor por defecto por tipo de marca.
- La pantalla **«Quién reparte»** nueva (maqueta `R1Reparto`), que guarda al tocar y sin el fallo del R01.
- La resolución del despacho (`resolve_dispatch`, `tg_auto_dispatch`, `tg_sale_service_type_por_interruptor`, `resolveDeliveryServiceType` del hubrise-webhook) leyendo **solo** de la fuente nueva.
- Lo que ve la cocina: el reparto nunca pinta el pedido en rojo; tiene su etiqueta propia con tres estados.
- La sugerencia de la IA cuando una tienda de Uber lleva pedidos seguidos sin dirección.
- Retirada de los dos mecanismos viejos (interruptor por marca y política por tipo de marca como fuente), con migración de datos y vuelta atrás.

No entra: cambiar cómo se habla con Catcher; tarifas de reparto; zonas; nada de contabilidad.

## 3. Comprobaciones previas (tarea 1, informe antes de tocar nada)

En staging y, en solo lectura, en producción:
- Filas actuales de `channel_delivery_policy` por cuenta (incluida la fila a mano `061bffc9…` Uber·propia·propio de Foodint) y el estado de `own_delivery_enabled` de cada marca.
- Qué leen exactamente `resolve_dispatch`, `tg_auto_dispatch`, `tg_sale_service_type_por_interruptor` y el hubrise-webhook, y en qué orden.
- Qué manda cada plataforma en la dirección: Glovo y Just Eat siempre; Uber solo si la tienda está en Uber Eats Manager como «reparto propio». Confírmalo con los pedidos de los últimos 30 días por plataforma (cuántos traen dirección y cuántos no, por marca).
- Qué pasa hoy con un pedido «propio» sin dirección (el caso Lovers «FALTA LA DIRECCIÓN»): dónde se para y qué ve la cocina.
- Pedidos abiertos ahora mismo con `dispatch_error` o con `service_type` que no cuadre con la regla nueva (para saber qué hay que sanear al desplegar).
Informe en el PR, sin decisiones nuevas: si algo no cuadra con este encargo, pregunta.

## 4. Modelo

- Tabla nueva **`brand_delivery_policy`**: `account_id`, `brand_id`, `channel_slug` (`glovo`, `uber`, `justeat`, `web`…), `delivery_by` (`platform` | `own`), `source` (`manual` | `inherited` | `ai_suggested`), `decided_by`, `decided_at`, `note`. Única por (`account_id`, `brand_id`, `channel_slug`), **sin índices parciales**: una fila por celda, siempre.
- Valor por defecto por tipo de marca: se queda en `channel_delivery_policy` **solo como herencia** («Si no dices nada»), y se lee únicamente cuando no hay fila de marca × plataforma. Arregla su guardado (R01): `upsert` por `id` o con la condición del índice parcial que toque, con prueba que cree una fila por cuenta y otra por local.
- **Resolución**, en este orden y en un único sitio (`resolve_dispatch`): 1) fila marca × plataforma; 2) herencia por tipo de marca; 3) `platform`. Devuelve también de dónde salió (`source`) para enseñarlo.
- `brand.own_delivery_enabled` **desaparece**: la migración crea las filas de `brand_delivery_policy` equivalentes al estado actual (interruptor encendido → `own` en las plataformas donde hoy manda `own`; apagado → nada, hereda), con `source='migrated'` y nota «del interruptor antiguo»; después se elimina la columna. Todo lo que la lea pasa a `resolve_dispatch`. Esta eliminación va en **fichero propio** con su `*.down.sql`, porque el workflow de producción para ante un borrado de objeto de Cocina y Julio tiene que darle el visto bueno por separado.
- Nada de reparto se decide por `service_type` del pedido a la entrada: el `service_type` se **pone** con la resolución, no al revés.

## 5. Regla de despacho y cocina

- `delivery_by='own'` y hay dirección → despacho automático a Catcher como hoy; etiqueta verde «Nosotros · rider asignado».
- `delivery_by='own'` y **no** hay dirección → el pedido entra y se cocina igual; etiqueta ámbar «Nosotros · falta la dirección», con dos acciones: «Pedirla al cliente» (lo que haya hoy) y «Cambiar a “la reparte Uber”» (que escribe la celda marca × plataforma con `source='manual'`). Nunca rojo, nunca bloquea.
- `delivery_by='platform'` → etiqueta gris «La reparte Glovo/Uber/Just Eat», sin despacho, sin aviso.
- **IA:** si una marca lleva 3 pedidos seguidos de una plataforma en «propio» sin dirección, Folvy propone en la pantalla (y en «Lo que ha hecho Folvy») cambiar esa celda a «Plataforma», con su porqué («parece que en Uber Eats Manager la tienda está como reparto de Uber») y dos respuestas; no cambia nada solo.
- Cambiar una celda **no toca pedidos ya abiertos**; se aplica a los siguientes. Lo dice la pantalla al guardar.

## 6. Pantalla «Quién reparte» (Ajustes › Reparto) — maqueta `R1Reparto`

Fiel a la maqueta, guía «Estilo nuevo» (Geist, azul `#2F5BFF`, verde IA, ámbar de aviso, sin negro, colores en el único sitio). Es la primera pantalla de Cocina con el estilo nuevo: no la adaptes al estilo viejo.
- Marcas en filas (avatar, nombre, «Marca propia · N locales» / «Marca cedida»), plataformas en columnas con una línea de ayuda bajo cada una («manda la dirección» / «solo si la tienda es “reparto propio”»).
- Primera fila «**Si no dices nada**» = la herencia por tipo de marca.
- Cada celda es un control de dos opciones «Plataforma | Nosotros»: azul relleno si lo decidió la persona; contorno gris + «hereda» si viene del por defecto; punto ámbar «!» si hay pedidos sin dirección en esa celda.
- **Se guarda al tocar**, con confirmación sutil y «Deshacer» al pie; nada de botón «Guardar» general. Si falla el guardado, aviso claro en la celda, no un error técnico.
- Leyenda al pie con los tres estados. Panel derecho «Qué ve la cocina» con las tres etiquetas y la sugerencia de la IA.
- Móvil: una tarjeta por marca con las tres plataformas en vertical; mismo control.
- Las marcas cedidas salen con «Plataforma» heredado y sin aviso; se pueden cambiar igual.
- Capturas de ordenador y móvil junto a la maqueta en `docs/reparto/capturas/r02/COMPARACION.md`.

## 7. Contraste

Mira cómo lo presentan Otter, Deliverect y Last (ajustes de canal por marca/tienda: quién entrega, tiempos) y anota en el PR, en media página, qué hacen mejor y qué hacemos mejor nosotros. Lo nuestro tiene que leerse en diez segundos por el encargado de un local.

## 8. Pruebas

- Unitarias de `resolve_dispatch` con las tres capas (celda, herencia, por defecto) y `source` correcto.
- E2E en staging, cuentas A y B: guardar una celda y ver que la siguiente venta de esa marca × plataforma sale con el `service_type` y la etiqueta esperados; pedido «propio» sin dirección → ámbar y nada en rojo; cambiar la celda desde la etiqueta ámbar; «Deshacer»; el R01 arreglado (fila por cuenta y por local).
- Prueba de la migración de datos: para cada marca de staging, el resultado de `resolve_dispatch` antes y después de migrar es el mismo para todas las plataformas (0 diferencias), salvo lo que el encargo cambia a propósito y queda listado.
- Vuelta atrás probada en staging para cada fichero que toque tablas de Cocina.
- Cadena `antes-de-subir.sh` completa antes de cada push.

## 9. Tareas, en orden

1. Comprobaciones previas e informe. **Para aquí hasta la respuesta.**
2. Tabla nueva, resolución única, arreglo R01, pruebas unitarias.
3. Migración de datos desde interruptor y políticas (sin eliminar nada todavía), prueba de 0 diferencias.
4. Pantalla (ordenador y móvil) y etiquetas de cocina, capturas junto a la maqueta.
5. Sugerencia de la IA y registro en «Lo que ha hecho Folvy».
6. Fichero propio de eliminación de `brand.own_delivery_enabled` con `*.down.sql`; análisis con el analizador del workflow.
7. E2E, vuelta atrás, contraste, informe final; PR listo para revisión.

## 10. Entrega

Informe con capturas, resultados de pruebas, lista de ficheros SQL en el orden de aplicación (y cuál es el de eliminación, aparte), pendientes. Julio prueba en la vista previa, da el visto bueno, lanza ensayo y real como en el C00, y después se fusiona. Hasta entonces, no se tocan los interruptores de Lovers ni de Smash en producción.
