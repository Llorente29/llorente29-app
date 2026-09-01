# Hallazgo · Dos «Foodint Alcalá» activos en `locations`

**01/09/2026.** Salió de rebote al preparar el SQL del 86 de opciones: al buscar
el `location_id` de Alcalá aparecieron **dos filas, las dos con `active = true`
y el mismo nombre exacto**.

| `location_id` | Ventas 7d | Tablets | Filas de 86 | Mapeos externos |
|---|---|---|---|---|
| `38158159-cd71-4056-950b-53425afac1ce` | **380** | 2 | 16 | 3 |
| `8a78366c-18cb-4ae2-9cf1-38e5d9a927c0` | **0** | 0 | 0 | 1 |

El vivo es el primero. El segundo está a cero en todo menos en una cosa
inquietante: **tiene un mapeo externo activo**.

## Por qué esto importa más de lo que parece

Es la **Regla 9 esperando a morder**, y en su forma más cara. La regla se
escribió el 31/08 por el catálogo plantilla compartiendo nombres con producción;
esto es peor, porque las dos filas son **de la misma cuenta y las dos están
activas**. No hay `account_id` que las separe.

Lo que puede pasar, y no es hipotético — hoy ha estado a punto:

- Alguien agota un producto en «Alcalá» eligiendo el fantasma. **La pantalla
  confirma que se ha agotado.** El `availability_event` se escribe. El
  despachador empuja. Y la comida sigue vendiéndose en el Alcalá de verdad,
  porque el 86 se aplicó al local que no tiene catálogo ni ventas.
- Es exactamente el fallo que hemos estado arreglando todo el día — una pantalla
  que dice que algo está resuelto cuando no lo está — pero por una vía que
  ninguna de las guardas de hoy detecta: la operación es **correcta**, sólo que
  sobre el local equivocado.

Y el mapeo externo activo del fantasma significa que un empuje contra él no
fallaría del todo: encontraría a dónde ir.

## Lo que NO se ha hecho, a propósito

No se ha tocado nada. Desactivar el fantasma en pleno servicio, sin saber por
qué existe ni qué cuelga de él, es cómo se rompe algo a las nueve de la noche.
Hace falta antes:

1. Saber de dónde salió el duplicado y qué escribió ese mapeo externo.
2. Comprobar que nada apunta a él (`sale`, `goods_receipt`, `kds_device`,
   `printer`, `external_location_map`, `product_availability`, `kitchen_station`).
3. Y sólo entonces decidir: desactivar, renombrar para que se distinga a simple
   vista, o fusionar.

## Mientras tanto

Cualquier consulta, migración o pantalla que ancle Alcalá **por nombre** puede
coger el fantasma. Anclar por id, y el id vivo es
`38158159-cd71-4056-950b-53425afac1ce`.

Y merece plantearse si un selector de local debería enseñar nunca dos entradas
con el mismo texto: si la pantalla no puede distinguirlas, el operario tampoco.
