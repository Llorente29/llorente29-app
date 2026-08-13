---
name: folvy_86_unificado_last_diseno_20260812
description: DISEÑO del 86 unificado Folvy→Last para marcas propias. RECON medido el 12/08. Está PARADO por decisión de Julio, bloqueado por una sola pieza (la ruta REST del "Stock de productos" por local). Documenta el hallazgo de las DOS CAPAS de disponibilidad de Last y por qué el barrido, tal como está, muestra un número que no es el del gerente. Leer antes de tocar el 86 hacia Last, el barrido de espejo o external_catalog_product.
sources:
  - cowork
estado: RECON ✅ (12/08) · PARADO por decisión de Julio · bloqueado por la ruta REST del Stock de productos por local
---

# 86 unificado Folvy → Last (marcas propias) — DISEÑO

> **Reconstruido desde la sesión del 12/08 (chat "Verificación de estado de producto en API").**
> El contenido se generó ahí en conversación pero nunca se guardó como doc — este fichero lo fija.

---

## 0. Estado en una frase

Folvy **puede leer y escribir** disponibilidad en Last. El barrido de espejo está construido y
funciona. **Está bloqueado por una sola pieza:** falta la ruta REST del **"Stock de productos" por
local** — la capa que de verdad decide si un producto se vende. Sin ella, la pantalla del gerente
mostraría un número que no es el suyo. **Julio decidió no preguntar a Last todavía**; el correo a
Abraham está redactado y sin enviar.

---

## 1. 🔴 EL HALLAZGO: Last tiene DOS capas de disponibilidad, y solo propagan en un sentido

Probado en producción el 12/08, escribiendo en ambos sentidos:

| Capa | Qué es | Quién la maneja |
|---|---|---|
| **Local — "Stock de productos"** | la disponibilidad por local; lo que decide si algo se vende | el gerente, en su pantalla de Last |
| **Catálogo — `enabled`** | la carta por canal; lo que lee hoy el barrido (`external_catalog_product`) | se sincroniza por canal |

**Solo propagan en una dirección:**
- **Agotar en la pantalla de local → baja al catálogo.** Verificado con los Nachos.
- **Apagar en el catálogo → NO sube al local.** Verificado con **Burrito A Tu Manera**: `enabled:true`
  a nivel de local, `false` en el catálogo. Las dos capas discrepan.

> Y recuerda que `enabled:false` **no significa "agotado"** — significa "fuera de la carta activa de
> este local" (incluye catálogo histórico, marcas de otras ciudades, `shop`/`deliveroo` fósiles y
> duplicados por marca). Es el mismo error que costó una hora el 11/08.

### La consecuencia dura para el frente
El barrido, tal como está, **lee solo la capa de catálogo**. En Alcalá (todas las propias) daría
**3 productos + 6 combos** donde el gerente ve **2** (Nachos con Todo y con Guacamole) — e incluiría
el Burrito, que **sí se puede vender**. **Una pantalla del gerente montada sobre la capa de catálogo
diciendo que muestra agotados es peor que no tener pantalla.** Sería deuda encubierta.

---

## 2. Lo que YA funciona (no reconstruir)

- **El barrido escribe** disponibilidad en Last (verificado). El espejo llevaba **52 días congelado**
  (desde el 21/06) hasta que se reactivó.
- **El detalle por canal es real y útil:** "caído solo en Glovo" es información que hoy no existe en
  ningún otro sitio.
- **El vigía y los sellos de antigüedad** funcionan.
- **El 86 de HubRise para marcas propias sigue intacto.**
- **La capa de local SÍ se puede LEER** con la integración directa de Last (MCP `getLocationProducts`,
  org `31f13f35-be2e-4806-8be4-a7589c1cbf71`, local Alcalá `81519f20-487e-4c03-aeac-cb79e4832ee1`) —
  así se verificó el Burrito. Lo que falta es la ruta REST para que **el barrido de producción (Edge)**
  la lea y la **escriba**.

---

## 3. La única pieza que falta: la ruta REST del "Stock de productos" por local

Las **4 rutas candidatas** que se sondearon dieron **404**. Con lo que se sabe de la API (cabeceras
de entidad, rutas tipo `/catalogs`, `/locations`, `/organizations`), quedan variantes razonables por
probar antes de escribir a Last:

- `/locations/{id}/stock`
- `/locations/{id}/catalog`
- `/organizations/{org}/locations/{id}/products`
- `/stock?locationId=`

**Criterio acordado:** sondear la tanda ampliada de rutas **y** mandar el correo a Abraham en
paralelo — no son excluyentes. Si se acierta la ruta, se continúa; si no, la respuesta de Last llega
igual sin haber perdido un día.

---

## 4. Qué se puede cerrar SIN preguntar, y qué no

**Se puede (sin la ruta):**
- El barrido (lectura+escritura de catálogo) y el detalle **por canal**.
- El vigía y los sellos.
- El 86 de HubRise para propias.

**No se puede (necesita la ruta):**
- Que la pantalla del gerente diga **lo mismo** que su pantalla de Last (diría 3 donde ve 2).
- Que el 86 desde Folvy **apague de verdad** un producto en el local (se podría escribir en el
  catálogo, pero seguiría vendiéndose desde el TPV).

---

## 5. Decisión pendiente de Julio

Enviar (o no) el correo a Abraham (Last) pidiendo el endpoint del API v2 que **devuelve y modifica**
la disponibilidad de "Stock de productos" por local — la misma que muestra su pantalla. Corto y
concreto. Redactado, sin enviar.
