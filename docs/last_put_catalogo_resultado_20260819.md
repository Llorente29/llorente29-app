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
| `GET /catalogs/{c}` · `GET /catalogs?locationId=` | ✅ lee |
| `PUT /catalogs/{c}/products/{p}` con precio | 200, no cambia nada (6 formas de campo) |
| `PUT /catalogs/{c}/products/{p}` con `enable` | ✅ **escribe, y es POR LOCAL** — es el 86 en producción |
| **`PUT /catalogs/{c}`** | **405 — method not allowed** |
| **`PATCH /catalogs/{c}`** | **405 — method not allowed** |
| **`PATCH /catalogs/{c}/products/{p}`** | **405 — method not allowed** |
| `POST /catalogs` · `POST /catalogs/{id}` | 405 |
| crear/borrar productos y categorías | 404/405 en nueve rutas |
| precio de producto de **organización** | ✅ escribe, pero es **global** (todos los locales y canales) |

`DELETE` no se ha probado y no se va a probar: sólo destruye, y no resuelve
nada de lo que buscamos.

## El límite exacto — y por qué NO es «nunca»

Lo probado es: **con la API v2 pública y el token de bridge que tenemos, hoy**,
Folvy no puede fijar precio por canal ni crear, sustituir o borrar nada del
catálogo.

Lo que **sí** puede, y hace en producción todos los días:

- **encender y apagar productos, por local** (`enable`) — eso *es* modificar el catálogo;
- **cambiar el precio de organización** — global, pero es una escritura real.

Tres cosas quedan sin probar, y cada una bastaría para tumbar un «nunca»:

1. **La ruta que usa el propio panel de Last.** Su back-office guarda precios
   por catálogo, así que esa ruta existe. No sabemos si es la v2, una interna o
   una v3. Se ve en dos minutos con la pestaña Red del navegador.
2. **Otro token con otros permisos.** El nuestro sale de `external_integration`
   (bridge). Nunca hemos comprobado si Last ofrece un OAuth con scope de
   escritura de catálogo — que es exactamente el patrón «writer token» que ya
   montamos para HubRise.
3. **Que Last lo añada.** Es una decisión de producto suya, no una ley física.

La deuda A31 nació de escribir «definitivo, no se puede» sobre una puerta sin
abrir. Este documento existe porque esa frase costó dos meses. Que la
sustituya un límite con fecha, versión y credencial — no un adverbio.

**Folvy no puede gobernar el precio por canal en Last por API.** Para Glovo y
los canales de Carabanchel, la vía sigue siendo HubRise.

Lo único que queda es preguntárselo a Last: la pregunta ya no es «¿se puede?»
sino «¿qué ruta usa vuestro panel para guardar el precio de un producto dentro
de un catálogo, y está expuesta en la API v2?».


---

# ADENDA (19/08, 18:25) — la ruta existe, y es OTRA API

Julio capturó en el navegador lo que hace el panel de Last al guardar un precio
dentro de un catálogo:

```
PUT https://api.last.app/dashboard/catalogs/locations/{locationId}
                                   /catalogs/{catalogId}
                                   /products/{catalogProductId}
-> 200 OK
```

**No es `/v2/`. Es `/dashboard/`** — la API interna de su propio back-office.

## Lo que esto cambia

1. **La capacidad existe y es exactamente la que buscábamos.** La ruta lleva
   `locationId` **y** `catalogId` **y** `productId`: precio por producto, por
   catálogo y por local. Justo lo que la v2 no ofrece.

2. **El espacio de ids es el MISMO.** El `463b2be5-…` de la URL está en nuestro
   espejo: es el `catalog_product_id` de *Alitas Crispy Spicy* en el catálogo
   `1dae965c` (el de Uber). O sea, **ya tenemos todos los ids que harían falta**.

3. **`/dashboard/` es alcanzable desde fuera.** Un `GET` a esa misma ruta con
   nuestro token de bridge devuelve `404 Route GET:... not found` — el mensaje
   de router de Fastify. **No devuelve 401 ni 403.** La petición llega a la capa
   de enrutado; simplemente no hay `GET` registrado ahí, sólo `PUT`.

## Lo que NO cambia — y por qué esto no se toca sin decisión

`/dashboard/` es la API privada del panel. Construir Folvy encima significa:

- depender de una superficie **no documentada y no soportada**, que Last puede
  cambiar sin avisar y sin número de versión;
- autenticarse con un **token de sesión de un humano**, no con una credencial de
  integración — habría que guardar la sesión de alguien;
- muy probablemente, **fuera de lo que Last permite** a un integrador.

Y hay un matiz que apunta hacia ellos, no hacia nosotros: si el token de bridge
llegara a autenticar contra `/dashboard/`, eso sería **un fallo de seguridad de
Last** — un token de integración alcanzando su back-office. Eso se les reporta,
no se explota.

## El estado real de A31

Ya no es «no se puede». Es:

> **La API pública v2 de Last no expone escritura de precio por catálogo. Su
> panel sí lo hace, por `PUT /dashboard/catalogs/locations/{loc}/catalogs/{cat}/products/{prod}`,
> con los mismos ids que ya manejamos. Falta una vía soportada.**

Eso convierte la pregunta a Last de «¿se puede?» en «**aquí está vuestra propia
ruta; dadnos una equivalente soportada, o una credencial que la alcance**».
