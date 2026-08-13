# Folvy — ESTADO VIVO
**Actualizado: 12 ago 2026 (cierre)**

---

## 🔄 CÓMO OPERAR (no borrar nunca este bloque)

**APERTURA:** lee este doc entero → `folvy_reglas.md` → `folvy_frentes.md` /
`folvy_indice.md` si necesitas más → el `*_estado.md` del área → **RECON en la BBDD por MCP
(proyecto `xzmpnchlguibclvxyynt`) antes de diseñar nada**.

**LA VERDAD ES LA BBDD Y EL REPO**, nunca un doc ni el relato de una sesión. Producción va por
delante. Si un dato no cuadra con lo que Julio ve en pantalla: **PARA y díselo en ese momento**.

**CICLO DE TRABAJO:** RECON → BENCHMARK (mapa competitivo) → DISEÑO aprobado por Julio →
CONSTRUIR + MEDIR. Nada es HECHO hasta: commit → push → PR/merge → deploy → **verificación en vivo**.

**CIERRE:** lo dispara Julio. Sigue `folvy_cierre_sesion.md` sin saltarte pasos.

**🔴 REGLA NUEVA (12/08) — LA CUARTA PATA:** *ninguna pieza se da por terminada hasta que algo la
consume y se ha verificado con datos reales que la consume.* Un `create function` en verde no es una
entrega. Extiende la tríada (en caliente · barrido · vigía) con **quién la usa**.

---

## 🎯 FRENTE ACTIVO — RECEPCIÓN: rediseño de la pantalla

La cadena técnica funciona (casado → formato → coste, verificado en pantalla: **0,0092 €/ud** en la
Servilleta de ALB-00105). **Lo que falla ahora es el diseño.**
Julio: *"diseño para ingenieros y no para el día a día de un oficinista de nivel medio-bajo; pobre,
0 comercial y sin visión hacia el cliente"*.

**Maqueta propuesta y aprobada como punto de partida** (sesión 12/08): línea resuelta colapsada a
una frase (`2 cajas · 9.000 ud · 0,0092 €/ud`) con tic verde; lo que necesita acción destaca con
**una pregunta y dos botones**; contador *"Falta 1 de 3 líneas"*; botón final **"Recibir y meter al
stock"**. Fuera: etiquetas de maquinaria (`formato:`, `€/formato`), el aviso *"Propuesto —
confírmalo"* y los dos mensajes de precio contradictorios (van al editor, no a la lista).

**Siguiente:** convertir la maqueta en encargo y construirla.

---

## ⏭️ DESPUÉS, POR ESTE ORDEN

1. **Repaso del camino "revisar borrador"** — quedan 2 sitios con el mismo patrón: el efecto de
   enlace a pedido (`if (order || correcting) return`) y las Propuestas de `run_mapping`
   (condicionadas a `ocrPrefill`). **No cazarlos de uno en uno: decidir de una vez la condición que
   gobierna la edición** (¿se puede editar esta línea? ≠ ¿vengo de escanear?).
2. **T7 · Rentabilidad viva** — T7.a entregado por Code (rama `feat/t7a-menu-engineering`, sin
   mergear). Regla: sin escandallo completo, no hay cuadrante.
3. **Robustez de tablet** — rama `fix/tablet-robustez`, 1 commit sin mergear + WIP de Julio.
   Era el frente de la mañana del 12/08 y no se tocó.

---

## 🔴 BLOQUEOS Y AVISOS

- **T2200 y T2201 SOLO CON SERVICIO CERRADO.** Verificado que siguen sin aplicar.
  T2200 hace `ALTER TABLE sale` + `DROP FUNCTION upsert_pos_sale` (ninguna venta funciona ese
  instante). T2201 toca `orders_feed_by_token` — las 3 tablets del pase, 71 % de la CPU, la función
  del cierre de Carabanchel del 11/08. **El lado cliente se despliega ANTES** (rama
  `feat/tpv-t1e-kitchen-name-cliente`, entregada).
- **`kitchen_name` en el pase NO llega con T2201** — `kds_board` es otra función y no joina
  `kitchen_name`. Migración aparte, **nunca el mismo día**.
- **Parche vivo:** `anon.statement_timeout` en 8 s (era 3). **No quitarlo** hasta que la robustez de
  tablet esté verificada en las tres tablets.
- **86 unificado de Last: PARADO por decisión de Julio.** Falta la ruta REST del "Stock de
  productos" por local. Correo a Abraham redactado y **sin enviar**.
- **Almacén > Movimientos sigue con timeout.** 5 intentos, causa no aislada. Lo que sirvió: índice
  `idx_sm_account_loc_time` (370→25 ms). **Pista sin explorar: RECON del frontend, capturar la
  llamada real antes de tocar más SQL.**

## 🔐 SEGURIDAD PENDIENTE
- **Rotar `LASTAPP_INTERNAL_KEY`**: hoy se fijó a un valor que quedó escrito en la conversación
  (`folvy_last_sync_2026_a7f3c1`). Al rotarlo hay que cambiarlo en **dos sitios a la vez**: el
  secreto de Edge Functions `LASTAPP_INTERNAL_KEY` y el de Vault `lastapp_internal_key` (lo lee
  `last_catalog_sync_dispatch`, el cron horario). Si se cambia solo uno, el cron deja de disparar
  **en silencio**.

---

## ✅ RECIÉN CERRADO (12/08) — el día del motor de stock

- **El stock se descuenta al ENTRAR la venta**, no al cerrarla, y al escribir las líneas (no al
  nacer la venta). Los datos daban la razón a Julio: 0,33 % de cancelaciones frente a **3,68 % de
  ventas que nunca descontaban** (5.103 € desde el 12/06). Verificado en vivo.
- **HubRise casa productos por primera vez** — ninguno de sus pedidos había descontado stock nunca
  (referencia con namespace + filtro de fuente equivocado). 29 de 32 reprocesados sin tocar stock.
- **TPV: 146 productos inabribles recuperados** · **Shop: 46 productos ocultos al cliente**, ambos
  por leer `menu_item.is_available` (columna muerta) en vez de `product_availability`.
- **Autoinventarios se asientan solos** (cron `autoinventory-autoclose`) — la función existía y
  nadie la llamaba.
- **Enlace pedido↔recepción reparado** (1 de 105 enlazadas) + **casado automático** (83 de 97
  líneas) + **selector de formato**. 4 PR mergeados.
- **224 ventas viejas cerradas** sin tocar stock, respetando la frontera del sábado 8/08.

## 🟡 DEUDA MENOR ANOTADA
- Precios desfasados: Last dice 15,90 € donde Folvy tiene 13,80 (afecta al margen).
- `externalId` cruzado en Last: "Colosal de **Cochinita**" lleva `externalId` de **Carnitas**.
- Fotos de Quesatacos mal encuadradas (mucho mantel) — rehacerlas en el local.
- **4 proveedores "Cloudtown"**, 3 inactivos con artículos colgando. Confundió un RECON hoy.
- Catcher: **sus eventos no se guardan en ningún log** → incidencias de reparto indiagnosticables.
  Y su vigía avisa en cada cambio de estado (3 correos del mismo reparto).
- Un pedido de Last se perdió (G427, 12/08 17:23) — único de 27, **causa no encontrada**.
  Recuperado a mano.
