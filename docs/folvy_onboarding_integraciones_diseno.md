# Folvy — Onboarding de integraciones y locales (frontera robusta multi-TPV)

**Diseño para aprobación. No se ha tocado código.**
RECON completo: webhook lastapp, lastapp_integration, lastapp_location_map, payload real.

---

## 0. El problema, en una frase

Cuando entra una venta de un local/integración que el sistema **no reconoce todavía**,
el webhook la **descarta** (un `throw` que solo deja un log). Resultado: se pierden
ventas en silencio. Le pasa a Llorente29 hoy con las tiendas cedidas (CTB), y le
pasaría a **cualquier cliente** el día que conecte una integración nueva. Es el primer
error grave del onboarding, antes siquiera de empezar a vender.

---

## 1. Lo que el RECON demostró (hechos, no suposiciones)

1. **El webhook tira la venta si el local no está mapeado.** Código literal:
   `if (!accountId) throw new Error('location ... no mapeada')`. El `throw` va al catch,
   que solo loguea. La `sale` nunca se inserta.

2. **La cuenta se resuelve HOY por el local** (`lastapp_location_map.account_id`). Sin
   local mapeado, el webhook no sabe ni de qué cuenta es la venta.

3. **Pero la cuenta se puede resolver por la ORGANIZACIÓN** (vía robusta):
   `lastapp_integration` mapea `lastapp_organization_id → account_id` y trae
   `ownership_type` (own | … cedidas). El payload de `tab:closed` permite atribuir
   cuenta por organización aunque el local no esté mapeado.

4. **La misma tienda física tiene un `lastapp_location_id` distinto por integración.**
   Alcalá en marcas propias = `81519f20…` (mapeado). La tienda CTB que falla =
   `cd084436…` (no mapeado). Misma cocina, dos IDs de Last. El modelo del mapa
   (`lastapp_location_id → location_id`) ya soporta que dos filas apunten al MISMO
   `location` de Folvy: solo faltan las filas de las cedidas.

5. **Nada se ha perdido del todo:** el webhook guarda SIEMPRE el payload en
   `lastapp_webhook_log`. Es una red pasiva (un log que nadie mira); el diseño la
   convierte en activa (cola que se reprocesa).

---

## 2. Principios rectores (las dos brújulas de Julio)

- **Multi-cliente, no a medida.** Nada específico de Llorente29 (ni IDs, ni "las tres
  Foodint", ni inserts a mano). El camino es una funcionalidad de producto que recorre
  cualquier cliente al conectar una integración.
- **Multi-TPV, Last es uno de muchos.** La solución NO vive en el webhook de Last. El
  webhook es una FRONTERA (su propio código lo dice: "añadir otro TPV = otra frontera").
  El mecanismo "no pierdas la venta de un origen desconocido + dame un camino para
  vincularlo" es CANÓNICO y común a todos los TPV. Cada frontera solo aparca en
  cuarentena; el resto es compartido.

---

## 3. Las tres capas (todas de producto, genéricas)

### Capa 1 — Cuarentena universal: NINGUNA venta se pierde jamás
Regla número uno. Cuando una frontera (cualquier TPV) recibe una venta cuyo local no
reconoce:
- **NO** hace `throw`. Atribuye la cuenta **por la organización/integración** si puede
  (en Last: `lastapp_organization_id → lastapp_integration.account_id`).
- Aparca el evento en una cola `ingestion_quarantine` (canónica, agnóstica de TPV):
  `source` (lastapp|glovo|…), `account_id` (si se resolvió), `external_location_id`,
  `external_org_id`, `payload` crudo, `reason` (unmapped_location | unknown_org),
  `status` (pending|resolved|discarded), `received_at`.
- El webhook sigue devolviendo 200 (Last da por entregado), pero ahora con red activa.
- Si el local SÍ está mapeado → flujo normal de hoy, sin cambios.

### Capa 2 — Alta guiada del local (pantalla de producto)
Una pantalla "Integraciones / Locales por vincular" donde el cliente ve:
- Integraciones detectadas (de `lastapp_integration`) y su `ownership_type`.
- **Locales sin vincular**: los `external_location_id` que han llegado a cuarentena.
  Para cada uno: "esta tienda de Last (`cd084436…`, marca X) ¿a qué local tuyo
  corresponde?" → selector de los `location` del cliente.
- Al vincular → se crea la fila en `lastapp_location_map` (dos `lastapp_location_id`
  pueden apuntar al mismo `location`, ya soportado) **y se reprocesa la cuarentena** de
  ese local (las ventas aparcadas entran de verdad).
- Llorente29 lo usa para decir "tienda CTB Carabanchel = mi Foodint Carabanchel". Sin
  tocar SQL, sin IDs a mano. Cualquier cliente, igual.

### Capa 3 — Import de marcas/menús de la nueva integración
Repetir para las cedidas lo que YA se hizo para las propias (importar marcas + menús de
Last). Reutilizable. Hasta que la carta esté, las ventas ENTRAN pero quedan sin casar
(coste ciego), que es el comportamiento correcto y ya cubierto por el frente de
excepciones. Esta capa es la del "frente CTB de carta" que ya estaba anotado.

---

## 4. Orden de construcción (deuda 0, por capas)

- **T-onb.1 — Cuarentena en la frontera.** Tabla `ingestion_quarantine` + cambiar el
  `throw` del webhook por "atribuir cuenta por organización + aparcar". Esto SOLO detiene
  la sangría: desde su deploy, ninguna venta se pierde, ni de CTB ni de futuros clientes.
  La venta queda aparcada, recuperable.
- **T-onb.2 — Reproceso.** RPC que, dado un local recién mapeado, reingiere su cuarentena
  (reutiliza el camino de ingesta del backfill, no lo duplica).
- **T-onb.3 — Pantalla de alta guiada.** UI de "locales por vincular" → mapea → dispara
  reproceso. Aquí Llorente29 conecta las tres CTB.
- **T-onb.4 — Import de marcas/menús cedidas.** Reutiliza el import de marcas propias.

Cada tramo es completo y usable solo. T-onb.1 ya aporta valor el día que se despliega
(deja de perder ventas), aunque las capas 2-4 lleguen después.

---

## 5. Lo que NO se hace (contención, anti-parche)

- **NO** se insertan a mano las tres filas de Llorente29. Eso sería el parche a medida
  que contradice "multi-cliente". El alta se hace por la pantalla genérica (T-onb.3).
- **NO** se mete lógica de CTB/Llorente29 en el webhook. El webhook solo gana el
  comportamiento genérico "aparca si no reconoces".
- **NO** se toca el motor (adaptador, coste, consumo). La cuarentena es de frontera.

---

## 6. Decisión abierta para Julio

1. **Atribución de cuenta por organización en la cuarentena.** El payload de `tab:closed`
   ¿trae el `organization_id` de Last de forma fiable? En el payload visto está el local
   y la empresa (LLORENTE29 FOOD, S.L.) pero el `organization_id` de la integración no es
   evidente a primera vista — hay `locationBrandId`. Antes de construir T-onb.1 hay que
   confirmar QUÉ campo del payload casa con `lastapp_integration.lastapp_organization_id`.
   Es el único RECON que falta. (Si el payload no trae la organización, la cuarentena
   atribuye "sin cuenta" y la pantalla de alta la resuelve igual — no se pierde nada,
   solo cambia si la cuenta se rellena sola o a mano.)

2. **¿Este frente se antepone a T2 (mermas)?** Recomendación: sí. Se están perdiendo
   ventas reales en vivo. T-onb.1 (parar la sangría) es lo más urgente del proyecto ahora
   mismo. Las mermas esperan a tenerlo cerrado.
