# C04b · Respuesta 15 — el PDF guardado en Folvy y «Validar y enviar a Diez» (13/10)

**Sin importes**: el repositorio es público.

Julio (R15): «Mientras Cegid activa los documentos: guarda el PDF en el
storage de Folvy enlazado a su asiento, con «Ver documento» en el Libro, y haz
«Validar y enviar a Diez» con el freno de que sin documento adjunto no se da
por enviada. No escribas nada en C0008.»

**En C0008 no se ha escrito nada, y el código no puede**: ver §3.

## 1 · Lo que hay ahora

| Pieza | Dónde |
|---|---|
| Base: bucket privado `conta-documentos` (solo PDF), `journal_entry_document`, `conta_resumen_ventas`, `conta_documento_guardar`, `external_send.document_*` | `supabase/migrations/20261021T0100_conta_documentos.sql` |
| El PDF, de lo que devuelve la base | `supabase/functions/_shared/resumenDeAsiento.ts` (+ `resumenVentasPdf.ts`) |
| El envío a Diez, con sus frenos | `supabase/functions/_shared/diezEnviar.ts` |
| La función del servidor | `supabase/functions/conta-diez-enviar/index.ts` (`verify_jwt = true`) |
| Libro diario y asiento | `src/modules/conta/libro/ConDiez.tsx`, `LibroDiarioPage.tsx`, `AsientoPage.tsx` |
| Estados en palabras | `src/modules/conta/lib/conDiez.ts` |

**El documento.** Se hace en el navegador cuando se valida un asiento de
ventas de una plataforma, tanto con «Validar asiento» como con «Validar y
enviar a Diez». Después:
- se sube a `conta-documentos/<cuenta>/<asiento>/<huella>.pdf`;
- se enlaza a su asiento con `conta_documento_guardar`, que comprueba:
  - la ruta es de su cuenta y de su asiento;
  - el fichero está subido y tiene ese tamaño;
  - el asiento está validado;
  - el asiento no tiene ya otro documento. Si es el mismo, devuelve el que
    hay: nunca dos veces.

Va solo de un asiento **validado** porque el PDF lleva su número, y lo
validado no cambia.

Con Uber (factura medida en Diez), el PDF lleva el número de factura
(`UBR-FLO-AAAAMMDD`). Con Glovo y Just Eat todavía no hay factura medida, así
que lleva el número del asiento (`Ventas nº …`). Muestra con datos inventados:
`docs/conta/maquetas/c04b/ResumenDeVentas_muestra_sin_factura.pdf`.

**«Ver documento»** está en la tarjeta «Con Diez» del asiento. Abre una URL
firmada que dura cinco minutos. Solo leen los de la cuenta (RLS del bucket).

**«Validar y enviar a Diez»** está en el Libro diario y en el asiento.
- Del Libro: el botón dice cuántos propuestos hay.
- Antes de enviar, el diálogo enseña la lista con casillas, **cuántos y el
  total** (lo que cobran las plataformas, la 430).
- Después dice qué ha pasado con cada asiento: validado, con documento y en
  Diez, o por qué no.

**Estados**, tal como los pidió la R13:
- «Propuesto»
- «Validado · enviando a Diez»
- «En Diez · 1/1801»
- «No ha llegado a Diez: <motivo>», con «Reintentar»

En la fila del libro sale un chip corto, con la frase entera en el `title`.

## 2 · El freno: sin documento adjunto, no está «En Diez»

Se aplica en tres sitios:
1. **Servidor, antes de hablar con Diez.** Si Folvy no tiene el PDF del
   asiento guardado, no se abre la conexión y queda «falta el documento».
2. **Servidor, después.** El PDF se sube y se lee de vuelta. Solo queda
   `document_status = adjunto` si Diez devuelve la misma huella. Si no:
   «No ha llegado a Diez: falta el documento». «Reintentar» solo vuelve a
   subir el documento, porque la factura ya está.
3. **Pantalla.** «En Diez» exige `adjunto`. Una factura que Diez tiene sin su
   PDF sigue diciendo «No ha llegado a Diez: falta el documento».

Y lo que dejó el R14: **si Diez responde que no tiene contenedor de
documentos** (el 500 de Cegid), no se da de alta la factura. El servidor lo
pregunta antes con una factura que Diez ya tiene. El aviso es: «Diez todavía
no guarda documentos (falta que Cegid active su almacén): no se envía la
factura sin su PDF». Así no queda una factura a medias en Diez.

## 3 · Los frenos de Diez, en código y probados uno a uno

`tests/conta/diez/enviar.test.ts` tiene 19 pruebas.
- **C0008 cerrado.** Con la conexión en C0008, se para antes de abrir el
  cliente: «Diez real (C0008) está cerrado: no se escribe nada hasta que Julio
  lo autorice». Además, la función no pasa nunca `escribirEnReal`, así que el
  cliente de Diez se negaría igual.
- **C0001 vetada.**
- **Nunca dos veces.**
  - Antes de enviar se busca por serie, número y 430, y si ya está se enlaza.
  - Si hay dos con el mismo número, no se toca nada.
  - La intención de escribir se apunta antes de escribir.
- **Como mucho 3 intentos.**
- **El PDF que va es el guardado**, con la huella registrada.

**Comprobado que las pruebas pueden fallar.** Quité a mano el freno de C0008
y el de «sin documento» y las dos pruebas se pusieron en rojo; con el código
bueno, 19 de 19.

**En producción hoy:** no hay conexión de Diez (`account_connector` vacío para
Diez, medido el 13/10). El envío contestaría «la conexión con Diez no está
configurada para esta empresa» y no escribiría nada. Aunque la hubiera, sería
C0008, y estaría cerrado.

## 4 · Staging

**Base**, runs 154 y 155 de `aplicar-staging-conta`: ensayo con ROLLBACK, real
y prueba, todo en verde. La prueba
`supabase/staging/sql/20261021_conta_documentos_prueba.sql`:
- Propone un día de Glovo de A y, como administrador de A:
  - lee el resumen: 2 pedidos, la 430 al debe;
  - no puede guardar el documento de un propuesto;
  - valida el asiento;
  - no puede enlazar sin fichero subido;
  - no puede subir a la carpeta de B;
  - no puede enlazar con otro tamaño ni con una ruta de otra cuenta;
  - enlaza el documento una vez; si repite, recibe el que hay; otro
    documento, no;
  - no puede escribir directamente en la tabla.
- Como administrador de B: no lee el resumen, ni la fila, ni el fichero.

**e2e** (`tests/e2e/conta/c04/conDiez.spec.ts`), en ordenador y móvil:
- el botón con cuántos;
- el diálogo con una casilla por propuesto y «N asientos · X €»;
- desmarcar uno cambia la cuenta;
- Cancelar no toca nada;
- la tarjeta «Con Diez» de un asiento de Glovo.

Resultado: **ver §6**.

**Lo que la e2e NO hace, y lo digo:** validar en el navegador. Validar deja
huella para siempre en staging. Además, la bajada de la 0130 PARA si hay
unidades validadas, así que rompería el siguiente real de la tanda en staging.
Por eso el camino «validar → PDF en el navegador → subir → enlazar» no se ha
probado de punta a punta en un navegador:
- la parte de base la prueba el SQL de arriba, como usuario;
- el PDF y el envío, las pruebas unitarias.

Si Julio quiere ese camino entero en un navegador, se puede hacer con un día
desechable sembrado en cada e2e, en una cuenta que no use la tanda.

## 5 · Producción: la tanda, lista para Julio

`supabase/produccion/aplicar.txt` tiene **solo la `20261021T0100`**. La tanda
anterior (0100–0140) ya está en el historial, y su copia queda en
`tests/conta/produccion/tanda-ventas-plataforma-20261013.txt`.

**Paso 8: el analizador contra el contexto REAL.** La medida se tomó en
producción, en solo lectura, el **13/10 a las 12:29:26 UTC**, con la consulta
de contexto del workflow para este fichero y su md5. Salida tal cual:

```
Análisis de la tanda viva contra el contexto de producción medido 2026-10-13T12:29Z (md5 de los 1 ficheros: los medidos).
  20261021T0100_conta_documentos.sql: sigue
  autorizo: (ninguno)

### `supabase/migrations/20261021T0100_conta_documentos.sql` — sigue
- Crea (nuevo): tabla `public.journal_entry_document`, indice `public.journal_entry_document`, politica `public.journal_entry_document`
- Altera algo existente (solo añade):
  - inserta · tabla · `storage.buckets` · insert
  - crea · politica · `storage.objects` · conta_documentos_select
  - crea · politica · `storage.objects` · conta_documentos_insert
  - añade · columna · `public.external_send` · document_id / document_status / document_error / document_attached_at
  - comenta · comentario · `public.external_send`
```

El contexto medido: existen `external_send` (0 filas), `storage.buckets` y
`storage.objects` (1.307 ficheros de otros buckets). No existe ninguna de las
dos funciones. El historial no tiene nada de este fichero. Nada está en el
camino del pedido.

**La primera versión BLOQUEABA**, y el paso 8 la paró antes de dar datos.
Quitaba y volvía a poner dos políticas de `storage.objects`, y eso es
cambiarlas en caliente sobre una tabla con ficheros. Ahora las dos, que son
nuevas, se crean solo si no están, sin quitar nada. Una prueba lo deja fijo
(`analizar.test.ts`: «no quita ni vuelve a poner ninguna política de
storage.objects»).

**Lo que cuenta la tanda antes y después**
(`scripts/conta/produccion/cuentas/documentos.sql`). Tomado en producción
antes de la tanda:

| Medida | Antes |
|---|---|
| bucket conta-documentos | 0 |
| ficheros | 0 |
| políticas | 0 |
| tabla journal_entry_document | no |
| documentos | sin tabla |
| funciones | 0 |
| columnas document_* | 0 |
| envíos | 0 |
| asientos de ventas | propuesto 50 |

Si el real se deshace solo, tiene que volver exactamente a esto.

**Vuelta atrás:** `supabase/vuelta-atras/20261021T0100_conta_documentos.down.sql`.
PARA si ya hay algún documento guardado o algún fichero en el bucket.

**Lo que hace Julio:** `aplicar-produccion-conta`, primero **ensayo** y luego
**real**, con el último commit de `conta/c04b-diez`. No lleva «autorizo».

## 6 · Resultados

- **Unitarias de Diez:** 259 de 259. Entre ellas, las 19 del envío y las 6 de
  los estados.
- **Staging, base:** runs 154, 155 y 156 de `aplicar-staging-conta`, en verde.
  En cada uno, ensayo con ROLLBACK, real y prueba.
- **e2e:**
  - **183** (`019f7648`) y **184** (`5be693ec`): en rojo, las dos por lo mismo
    y solo en móvil. Los botones del pie del diálogo («Cancelar», «Validar y
    enviar 2 a Diez») quedaban bajo la barra inferior de Contabilidad.
  - Le pasaba a todos los diálogos en el móvil. Está arreglado en el diálogo
    común (`proveedor.css`: el pie deja sitio a la barra).
  - **185** (`1fd69aed`, run 38400777499): **en verde entera**, ordenador y
    móvil.
  - Capturas en `docs/conta/capturas/c04b/`.
- **Antes de subir:** la lista entera, en verde antes de cada push.

## 7 · Qué hace falta para que «Validar y enviar a Diez» funcione en la app

**Las piezas, y cómo se publica cada una:**

| Pieza | Cómo sale a producción | Hoy |
|---|---|---|
| Base (bucket, tabla, funciones, columnas) | La tanda del §5, la lanza Julio | Lista. En producción, nada |
| Edge function `conta-diez-enviar` | Al fusionar a `main` (`deploy-edge-functions.yml` despliega las carpetas que cambian: solo esta) | Commiteada. Sin desplegar |
| Front (Libro diario y asiento) | Al fusionar a `main`: Vercel, y vale cuando diga READY | Commiteado. Sin publicar |

**El orden, si Julio decide fusionar:**
1. **La base primero.** Ensayo y real de la tanda del §5, y su comprobación de
   después. Sin la base, el Libro pediría `journal_entry_document` y
   `conta_resumen_ventas`, que no existirían (regla 40). La página no se rompe,
   porque lo aguanta y lo dice, pero no habría nada que enseñar.
2. **Después, la fusión de `conta/c04b-diez` a `main`.** Despliega la función
   y publica el front a la vez: no se pueden separar sin partir la rama. Si
   salen juntas, la función sin front no la llama nadie. El front sin función
   diría «No ha llegado a Diez: el envío a Diez aún no está publicado en este
   entorno».
3. **Comprobar lo publicado,** no el color del run:
   - Vercel READY en producción;
   - la función desplegada con su md5 igual al del fichero;
   - un GET a la función que conteste 405 (arranca sin escribir nada).

**Lo que lleva la fusión, dicho entero.** No es solo la R15:
- son 83 commits de todo el C04b (R5 a R15);
- 16 migraciones, todas ya aplicadas en producción y en su historial;
- 13 ficheros de `src`;
- el `_shared` de Diez.

Medido el 13/10:
- `main` lleva 2 commits que la rama no tiene: el workflow `diez-importar.yml`
  (#177);
- la fusión no da conflictos (`git merge-tree`);
- no toca `App.tsx`, ni `AppContext.tsx`, ni `database.ts`, ni `src/config`.

**Lo que queda apagado aunque se fusione, y por qué:**
- **No hay conexión de Diez en producción** (`account_connector` sin Diez,
  medido el 13/10). El envío contesta «No ha llegado a Diez: la conexión con
  Diez no está configurada para esta empresa» y no habla con Diez. Sí deja una
  fila en `external_send` (pendiente, 0 intentos, con ese motivo), que es lo
  que pinta el Libro.
- **C0008 cerrado en el código.** Aunque se diera de alta la conexión, en
  C0008 se para antes de abrir el cliente. Abrirlo exige un cambio de código y
  el «autorizo» de Julio.
- **Hasta que Cegid active los documentos:** con una conexión que sí pudiera
  escribir (hoy, solo C0009), el servidor pregunta antes si Diez guarda
  documentos. Si contesta el 500 del R14, no se da de alta la factura.
- **Lo que SÍ funciona al fusionar:**
  - validar un asiento de ventas de una plataforma guarda su PDF en Folvy;
  - «Ver documento»;
  - los estados en palabras;
  - el diálogo con cuántos y cuánto.

Es decir, R15 entero, y Diez sigue a cero. **El freno «sin documento no se
envía» se queda tal cual.**

## 8 · Trabajo en paralelo: lo compartido que he tocado

Desde hoy hay tres sesiones (A esta, B bancos y C contabilidad sola). Esto es
lo que he tocado que puede afectar a las otras:
- **Migraciones:** solo `20261021T0100`, con el prefijo de A. Solo añade. En
  staging no ha quedado ninguna semilla mía: la prueba va dentro de un ROLLBACK
  y sus ventas se llaman `R15-…`.
- **`supabase/config.toml`:** una entrada nueva, `[functions.conta-diez-enviar]`
  con `verify_jwt = true`.
- **`src/modules/conta/estilo/proveedor.css`:** el diálogo común, en el móvil,
  deja sitio a la barra inferior (§6). Afecta a todos los diálogos de
  Contabilidad en el móvil, para bien.
- **`tests/conta/produccion/analizar.test.ts` y `w01.test.ts`:** la tanda de
  ventas por plataforma pasa a su copia congelada, y hay pruebas nuevas para la
  tanda viva. No he tocado `antes-de-subir.sh`, ni el analizador, ni ningún
  workflow, ni `database.ts`, ni el menú.
- **El importador de Diez:** no lo he tocado (`diezImportar.ts` igual). En
  `_shared/diezAnalitica.ts` he **añadido** `correspondenciaDeEmpresa`, la
  correspondencia por id de empresa, con solo Foodint, que el importador no
  usa. `CORRESPONDENCIA_LLORENTE29` sigue igual, así que lo de Foodint da
  exactamente lo mismo. Para C: si generaliza el importador por empresa, ese
  mapa es el sitio natural para la segunda.
- **`_shared/resumenVentasPdf.ts`:** `numeroFactura` admite `null` (con
  `asiento`). Los que lo llamaban siguen igual.
