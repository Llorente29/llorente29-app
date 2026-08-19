# Last · `PUT /catalogs/{catalogId}` — la última puerta

**19/08/2026, 18:05–18:10** · Ensayo contra producción de Last, organización `FOODINT NUEVO`.

## Resultado: `NO_SE_PUEDE`

```
PUT /v2/catalogs/1dae965c-a3f3-4d81-a199-706c1312702b
-> 405  {"message":"PUT method not allowed",
         "errors":[{"path":"/catalogs/1dae965c-…","message":"PUT method not allowed"}]}
```

La ruta existe —el `GET` sobre ella funciona— pero **no acepta `PUT`**. No es un
problema de cuerpo, de cabeceras ni de permisos: el router lo rechaza antes de
mirar nada.

La respuesta **no trae cabecera `Allow`**. Sí trae
`access-control-allow-methods: POST, GET, PUT, DELETE`, pero eso es la política
**CORS global de la API**, no el mapa de verbos de esta ruta — de hecho anuncia
`PUT` justo mientras el router lo rechaza. No es una pista, es ruido.

## Por qué esta prueba faltaba

El sondeo anterior se hizo con `pg_net`, **que no sabe mandar `PUT`**. La
herramienta existía —`lastapp-set-price` manda `PUT` desde una edge function
desde julio— pero nadie la apuntó a esta ruta. Faltaba por accidente, no por
conclusión.

## El objetivo, identificado leyendo, no deduciendo

`GET /catalogs?locationId=` devuelve el **nombre** de cada catálogo, y
`/locations/{id}` → `brands[].catalogs` devuelve **todos** sus destinos.
En Foodint Alcalá, Smash Brothers Burgers:

| Catálogo | id | Destinos |
|---|---|---|
| `SMASH BROTHERS BURGER` | `094ea1ca…` | **glovo**, shop |
| `SMASH BROTHERS BURGER 20` | `1dae965c…` | deliveroo, **uber** ← el ensayo |
| `SMASH BROTHERS BURGER Copy` | `7842d2b6…` | default, takeaway |

El de Glovo viajó como `catalog_id_prohibido` en cada escritura. Probado que el
cinturón frena: pedirle escribir en él devuelve `400 NEGADO` sin tocar nada.

**Riesgo real del conejillo: ninguno.** Uber está `enabled: false` en Alcalá y
**no existe integración de Deliveroo** en ese local. Cero consumidores vivos.

## Las cuatro comprobaciones

| # | Pregunta | Respuesta |
|---|---|---|
| 1 | ¿Cambió el precio en ese catálogo? | **No.** 390 → 390 |
| 2 | ¿Cambió en el catálogo de Glovo? | **No.** Ni una escritura llegó a salir hacia él |
| 3 | ¿Cambió el precio de organización? | **No.** No se tocó esa ruta |
| 4 | ¿Sigue todo? (deuda B10) | **Sí.** 5 categorías, 20 productos, 9 con modificadores, 20 con descripción. **sha256 idéntico antes y después** |

La 4 queda **sin contestar del todo, y a propósito**: como el `PUT` ni se
ejecuta, no sabemos si Last lo trataría como reemplazo destructivo. Esa pregunta
se cierra sola — no hay `PUT` que pueda destruir nada.

## Estado final

Catálogo `SMASH BROTHERS BURGER 20` con sha256 `9efcabc0c497ab2d1b709c21f82ee298`,
**el mismo del paso 1**. American Fries SBB a 3,90 €. Nada que revertir: el
precio nunca llegó a moverse.

## Qué cierra esto

La deuda **A31** («el precio por canal en Last no se puede escribir») pasa de
deducción a **hecho probado**. El mapa completo de la API v2 de Last para
catálogos:

| Ruta / verbo | Resultado |
|---|---|
| `PUT /catalogs/{c}/products/{p}` con precio | 200, no cambia nada (6 formas de campo) |
| **`PUT /catalogs/{c}`** | **405 — method not allowed** |
| `POST /catalogs` · `POST /catalogs/{id}` | 405 |
| crear/borrar productos y categorías | 404/405 en nueve rutas |
| precio de producto de **organización** | ✅ escribe, pero es **global** (todos los locales y canales) |
| `enabled` (el 86) | ✅ escribe, y **sí es por local** |

**Folvy no puede gobernar el precio por canal en Last por API.** Para Glovo y
los canales de Carabanchel, la vía sigue siendo HubRise.

Lo único que queda es preguntárselo a Last: la pregunta ya no es «¿se puede?»
sino «¿qué ruta usa vuestro panel para guardar el precio de un producto dentro
de un catálogo, y está expuesta en la API v2?».
