# PARTE — Los packs pedidos «2×» salían «1×». G587 y los otros 41.

> 22/09/2026. Encargo urgente de Julio, por delante del combo del kebab.
> Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710` · proyecto `xzmpnchlguibclvxyynt`.
> Venta del incidente: `a6750ed3-0a6e-46fa-b982-5044f4ba56ff` (G587).

## El número del día

Medido en seco sobre 30 días de la cuenta, con la misma vara a los dos lados:

| | ventas | piezas hoy | piezas con el arreglo | faltaban |
|---|---:|---:|---:|---:|
| **packs de uno** | 733 | 2.279 | 2.279 | **0** |
| **packs pedidos 2× o más** | **42** | 114 | 246 | **+132** |

**132 piezas en 30 días que ni se pegaron ni se cocinaron.** Y cero movimiento
en las otras 733 ventas: lo que no tenía que cambiar no cambia.

Son 42 pedidos, no los ~30 que decía el encargo.

## Lo que hacía falta arreglar, y dónde estaba

La regla es una: **unidades = `hijo.quantity` × `padre.quantity`**. La base ya la
sabía —`_sale_line_raw_consumption` multiplica el hijo por la cantidad del
padre, y por eso el stock de G587 sí descontó dos packs— y no la sabía **nada de
lo que ve una persona**. Estaba escrita cuatro veces, mal, en cuatro sitios:

| dónde | qué hacía |
|---|---|
| `ensure_label_tokens` (BBDD) | `greatest(1, round(h.quantity))` sin el padre |
| `ticketRenderer.ts` · `flattenItems` | `qty: comp.qty` sin el padre |
| `OrderCard.tsx` · `ChildRow` | `child.qty > 1 ? …` sin el padre |
| `KdsTicketCard.tsx` | `c.qty > 1 && …` sin el padre |

Ahora vive **en un solo sitio**, `unidadesDeComponente()` en
`ordersFeedService.ts`, junto a `childVisual`, y la usan los cuatro. La misma
regla escrita en cuatro sitios es una regla que un día dice cuatro cosas — que
es exactamente cómo llegamos hasta aquí.

## Dos cosas del encargo que la base contaba distinto

**1. En el ticket y en la bolsa no ponía «1×»: no ponía NADA.**
`childVisual` devuelve `neutral` para un `combo_item`, y `modifierLines` pinta
los neutros sin prefijo. Medido con el fichero de captura corrido en las dos
ramas:

```
ANTES (código de hoy)              DESPUÉS (esta rama)
  2x  PACK PA 2  DC                  2x  PACK PA 2  DC
      QUESATACOS DE BIRRIA…              2x QUESATACOS DE BIRRIA…
      QUESATACOS DE TERNERA…             2x QUESATACOS DE TERNERA…
      QUESADILLA DOS COYOTES…            2x QUESADILLA DOS COYOTES…
      Coca Cola                          4x Coca Cola
  PEGATINAS: 4                       PEGATINAS: 7
```

Es peor que un «1×», porque una línea sin número se lee como una de cada y nadie
sospecha nada.

**2. Los tokens de G587 no tienen `line_id` nulo: lo tienen MUERTO.**
Son 6 tokens: 1 de bolsa (nulo **por diseño**, así se acuña) y 5 de unidad, y
**los 5 apuntan a una `sale_line` que ya no existe**. `label_token.line_id` **no
tiene clave ajena** a `sale_line`, así que nadie los limpia cuando el adaptador
borra y reinserta las líneas.

No es solo G587: **1.949 de 8.473 tokens de toda la tabla (23 %) apuntan a una
línea muerta.** Una reimpresión de cualquiera de esos pedidos no sabe a qué
pieza va cada pegatina.

## Qué hay hecho

**Front (aplicado en la rama, build y pruebas en verde):**
- `ordersFeedService.ts`: `unidadesDeComponente()`, la regla, con suelo en 1 —
  un dato ausente nunca puede dar cero piezas, porque un cero se lee como «no
  lleva nada» y vuelve a salir la bolsa a medias.
- `ticketRenderer.ts`: pegatinas (`flattenItems`), ticket de cocina y ticket de
  bolsa. El diseño del ticket de bolsa del 21/09 **no se toca**: solo entra el
  número delante del componente, dentro de la misma fila.
- `OrderCard.tsx` y `KdsTicketCard.tsx`: la tarjeta, en cocina y en el pase.

**Base (propuesta, NO aplicada):**
`supabase/migrations/20260922T0100_tokens_de_etiqueta_por_pack.sql`
- `ensure_label_tokens` multiplica por el padre. `CREATE OR REPLACE` con la
  **misma firma** — no se añade ningún parámetro, que sería DROP + CREATE.
- Barre los tokens huérfanos **de la venta que se está imprimiendo**, y **nunca
  los escaneados**: eso es historia de una bolsa que alguien leyó.
- Termina en `rollback;` con tres comprobaciones para pegar aquí.

## Lo verificado, y con qué

| qué | cómo | resultado |
|---|---|---|
| G587 da 10 unidades + bolsa | el `objetivo` de la migración, en seco contra la base | 2+2+2+4 = **10** ✅ |
| pegatinas de G587 | `packsPorDos.test.ts` sobre los datos reales | 4 → **7** (6 comida + 1 bebidas) ✅ |
| G089 y U053 (3×) | mismo test | 3 de cada componente ✅ |
| un combo 1× no cambia | mismo test | idéntico, sin «1×» donde hoy no hay nada ✅ |
| un suelto 2× sigue dando 2 | mismo test | ✅ |
| pruebas | `npx vitest run` | **1.655 en verde**, 109 ficheros |
| lint | `npx eslint .` en las **dos** ramas | **1.379 / 1.379**. Ni un aviso nuevo |
| build | `npm run build` exacto, sin `*.tsbuildinfo` | **verde**, exit 0 |

El ensayo cubre **un solo camino, el de imprimir**, y va dicho: ni la recepción
de albarán, ni la merma, ni el recuento tocan `label_token`, y el consumo lo
calcula `_sale_line_raw_consumption`, que **no se toca**.

## Lo que falta, y es tuyo

1. **Tu visto bueno a la captura.** `npx vitest run --disable-console-intercept
   tests/unit/modules/orders/capturaG587.test.ts` imprime el G587 como saldría
   por la impresora. Yo he pegado arriba el antes y el después; falta que lo
   mires.
2. **Pasar la migración** con `rollback`, leer E1/E2/E3, y repetir con `commit`.
   Son las 15:4x de Madrid: **dentro de la banda**, no la he tocado.
3. **El paquete de las tablets**, fuera de servicio y por el procedimiento de
   `claude/PENDIENTE_UNICO_las_tablets_20260921.md`. Sin tu visto bueno no hay
   paquete.
4. **El primer pedido real con un pack 2×**, mirado en papel en Alcalá.

## Lo que no he tocado

`_sale_line_raw_consumption` y los adaptadores de venta: el dato está bien y el
almacén cuadra. Y no se reprocesa ninguna venta pasada (regla del 18/09): G587
se queda como está.

## Anotado aparte

- El total de G587 en la base es **62,86 €**, no los 89,80 € del encargo. Los
  89,80 serán el bruto antes del descuento de Glovo; lo digo por si la
  reclamación se pelea con una cifra u otra.
- Los **1.949 tokens huérfanos** que ya existen no los limpia esta migración:
  solo se sanean los de la venta que se reimprime. Barrerlos todos es una
  decisión aparte y te la dejo escrita, no la tomo yo.
- La causa de fondo sigue viva: los tokens se acuñan **al imprimir**
  (`order_for_print`) y las líneas se reescriben **después** en cada
  actualización del pedido. El barrido lo arregla en el momento que importa —la
  reimpresión— pero la raíz es que no hay clave ajena y nadie avisa.

## Mientras tanto

Aviso a cocina y pase, hoy, en las dos cocinas: **cuando un pack o menú viene
«2×» o «3×», todo lo de dentro va por 2 o por 3, aunque la pegatina o la tablet
digan otra cosa.** Eso lo tienes que dar tú, yo no llego a la cocina.

---

# ADENDA — 22/09, 18:00–18:40. Lo aplicado, y el susto de en medio

> Visto bueno de Julio a las 18:00. Se aplicó la migración; el paquete de las
> tablets **no pudo salir**.

## 1. La ternera SÍ estaba

Contado, no mirado: en la captura salen **2 pegatinas de quesatacos de ternera**
(3/7 y 4/7), 2 de birria, 2 de quesadilla y `4x Coca Cola` en la de bolsa. Los
cuatro componentes. Lo que viste cortado era el volcado, no el ticket.

## 2. La migración está APLICADA y verificada

Las tres condiciones de la banda, medidas antes (18:11 Madrid, dentro de la
banda; 0 pedidos en 30 min, el último a las 16:10):

1. **¿En el camino del pedido?** **SÍ — falla por la letra.** `order_for_print`
   la llama. 1 función, 0 crons, 0 disparadores.
2. **¿Cierra alguna tabla del pedido?** No. Un `create or replace` de función no
   toma `ACCESS EXCLUSIVE`.
3. Dicho antes de aplicarlo, con la medida delante.

Se aplicó igual, con autorización expresa de Julio por escrito y con la hora.
Queda escrito que la 1 falla.

**Pasada con `rollback`:** 10 acuñados, 2ª pasada 0 (idempotente), 11 tokens,
0 huérfanos, E3 sin mover los packs de uno. **Revertido de verdad**, comprobado:
6 tokens y la función vieja.

**Pasada con `commit`:** 10 acuñados. Comprobado **sobre lo vivo**, no sobre la
respuesta:

| | |
|---|---|
| la función viva multiplica por el padre | **SÍ** |
| firmas de `ensure_label_tokens` | **1** (sin sobrecarga, regla 2) |
| G587 · birria / ternera / quesadilla | 2 / 2 / 2 |
| G587 · Coca Cola | 4 |
| G587 · bolsa | 1 |
| **G587 · total** | **11** — 10 de unidad + 1 de bolsa |
| G587 · huérfanos | **0** |

## 3. 🔴 El susto: el que imprime era OTRO fichero

Yendo a por el paquete encontré que **mi arreglo estaba a medias**. Hay dos
renderizadores:

- `src/modules/orders/lib/ticketRenderer.ts` — la vista previa de la pantalla.
  **Es el que yo había arreglado, y el que sale en la captura que aprobaste.**
- `src/native/print/ticketRenderer.ts` — el worker **nativo**, el que manda a la
  Sunmi, y del que tira `labelImage.ts` para la pegatina por imagen.

El segundo tenía el mismo fallo intacto. **El paquete habría salido con las
pegatinas igual de mal, y el parte diciendo que estaban bien.**

La regla se ha mudado a `src/lib/unidadesDeComponente.ts`, que es lo que
provocó el fallo: el worker nativo no puede importar de `ordersFeedService` sin
arrastrarse Supabase, así que la regla se había quedado a un lado de la
frontera. Ahora la importan los cinco.

Y no es cosmético: `flattenItems` reparte `unitNo` 1..N dentro de su línea, y la
pareja `(lineId, unitNo)` es la identidad de una etiqueta. Si el papel numera
1..2 y la base acuñó 1..4, una etiqueta escaneada no casa con ningún token.

Pruebas nuevas contra el nativo: **3 en rojo contra el código viejo**, las tres
que miden el fallo. **1.659 en verde.** Lint **1.379 / 1.379** (la primera
pasada dejó +7 errores míos por usar `any`; medidos fichero a fichero y
quitados). Build exacto y en limpio, verde.

## 4. 🔴 El paquete de las tablets NO salió

**No es el trabajo: es el permiso.** `git push origin main` lo deniega la
pasarela del entorno. Es el mismo muro del 21/09.

Y no hay otra puerta: `.github/workflows/build-apk.yml` dispara **solo** con
`on: push: branches: [main]`, sin `workflow_dispatch`. Publicar desde una rama
tampoco valdría: el propio workflow avisa de que sin las `VITE_` el bundle sale
como `local`.

Estado de las tablets ahora (las tres vistas hace menos de un minuto):

| tablet | local | plataforma | paquete |
|---|---|---|---|
| Cocina | Alcalá | android | **310** (22/09 00:50) |
| Tablet camichi4 | Carabanchel | android | **306** (17/09 10:04) |
| Pase | Alcalá | web | le llega por Vercel |

Carabanchel sigue cuatro paquetes atrás. Y la ventana hoy **sí estaba abierta**
en los dos locales hasta las **19:45** — o sea que el paquete habría entrado. El
tapón fue el permiso, no la ventana.

## 5. 🔴 Lo que esto significa para la cena de HOY

**Las pegatinas siguen saliendo mal esta noche.** El número de pegatinas lo
decide `flattenItems` en la **tablet**, no la base. La migración arregla los
*tokens* —la identidad de cada etiqueta— pero no cuántas se imprimen.

Hasta que el paquete entre, sigue en pie el aviso a cocina: **un pack «2×» lleva
todo por dos, aunque la pegatina diga otra cosa.**

## 6. Lo que necesito

**Que fusiones tú a `main`**, o que me des el permiso. Son tres commits en la
rama y el árbol tiene el build verde. Detrás va: paquete nuevo → las dos Android
se lo bajan → lo aplican en su ventana.

---

# CIERRE — 22/09, 18:54–20:05. El paquete entró en Alcalá. Carabanchel no.

## La cadena, comprobada sobre lo publicado y no sobre el color del run

| paso | | hora (Madrid) |
|---|---|---|
| PR #131 fusionado a `main` | ✅ | 18:54 |
| Build `#311` | ✅ success | 18:55:37 |
| **`bundle-311.zip` en el bucket** (5,37 MB) | ✅ | **18:55:33** |
| **`bundle.json` apuntando al 311** | ✅ | **18:55:34** |
| **Vercel PRODUCCIÓN en READY** (commit `b599120`) | ✅ | 18:5x |

El zip y el manifiesto se comprobaron en `storage.objects`, que es lo servido.
El `curl` directo al bucket lo bloquea el proxy del entorno.

## Las tablets

| tablet | local | antes | **ahora** | cuándo |
|---|---|---|---|---|
| **Cocina** | Alcalá | 310 | **311** ✅ | **19:05:35** |
| Pase | Alcalá | web | **311** ✅ | 19:05:36 |
| **Tablet camichi4** | Carabanchel | 306 | **306** ❌ | 17/09 10:04 |

**Alcalá lo cogió sola a las 19:05**, con 40 minutos de margen sobre el cierre
de la ventana (19:45). El Pase, que es web, recargó con el código nuevo.

**Carabanchel no, y era lo previsto.** Está en el 306, el paquete que lleva el
fallo del id/número: se baja lo nuevo y lo descarta en silencio. Ahora está viva
(latiendo al minuto), así que no fue un problema de red.

Y la ventana de las dos **ya está cerrada** (`en_ventana: false`).

## Lo que queda, y necesita una persona en el local

El truco del manifiesto **ya no sirve esta noche**: el 306 apunta el número que
descartó en `otaCheckedRemote` y no vuelve a bajárselo hasta que se reinicie la
app. Han pasado más de dos horas desde la publicación.

Para Carabanchel quedan dos caminos, los dos con alguien delante de la tablet:

1. **Pulsar «Instalar ahora»** en la tablet. `instalarYa` es lo único que se
   salta la ventana, así que sirve aunque esté cerrada.
2. **Reiniciar la app** y repetir el ciclo: dejar que se baje el 311 y retirar
   `bundle.json` antes de que lo descarte.

## Lo que esto significa mañana

- **Alcalá: arreglado.** Las pegatinas de un pack 2× salen 6 + la de bebidas.
- **Carabanchel: sigue mal.** Mantener el aviso a cocina allí: un pack «2×»
  lleva todo por dos, aunque la pegatina diga otra cosa.
- **La base está bien en los dos locales**: `ensure_label_tokens` acuña las
  unidades reales desde las 18:2x. Lo que falta en Carabanchel es solo cuántas
  se imprimen.
