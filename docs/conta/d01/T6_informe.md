# D01 · Facturas recibidas · Tarea 6 (parada antes de la 7)

Respuesta 2, entera. Lo que se ha hecho, lo que **no** se ha hecho y por qué,
y lo que os pregunto a Julio y a C. Nada aplicado en producción: en
producción solo se ha leído, con recuentos.

## 1 · La regla de salida de los workflows (R2 punto 1)

**Regla desde hoy:** un workflow que lea producción o Diez saca en su salida
solo recuentos y huellas.

- **La puerta:** `scripts/conta/salida-segura.mjs` (y `lib/salidaSegura.mjs`).
  Deja pasar solo `@@ clave valor`, con el valor un entero o una huella
  hexadecimal; lo demás lo retiene y lo cuenta.
- **La comprobación, paso 9 de `antes-de-subir.sh`:**
  `scripts/conta/workflows-salida.mjs`. Revisa los workflows nuevos o tocados
  contra `origin/main`. Si leen producción o Diez, todo lo que corre un script
  o una consulta va a un fichero o pasa por la puerta. Un `echo` con
  variables al registro falla, y `cat` al resumen también: así salió el
  run 60.
- **La deuda que ya había**, escrita en `workflows-salida-deuda.json`, solo
  puede bajar.

### Auditoría de los workflows (también de las otras ramas)

| Workflow | Qué podía sacar | Cómo queda |
|---|---|---|
| `aplicar-produccion-conta.yml` | DETAIL/NOTICE de psql con valores de filas | `client_min_messages=warning` y `VERBOSITY=sqlstate` en el ensayo, el ensayo de vuelta atrás y el real; el filtro ya no saca NOTICE/DETAIL/CONTEXT (compartido, dicho) |
| `scripts/conta/produccion/deshacer.sh` | lo mismo al deshacer | `-q` y `VERBOSITY=sqlstate` (compartido, dicho) |
| `cumplimiento-produccion-conta.yml` (agente «Libro diario») | importes, números de asiento y conceptos en el resumen y en los avisos | con `CONTA_ANONIMO=1`, informe anónimo como los otros dos agentes (`agente-libro.mjs`, compartido, dicho) |
| `diez-importar.yml` | el texto de un error de psql (valores) | `VERBOSITY=sqlstate` en la conexión a producción. Los `raise notice … sqlerrm` de `importar.sql` son de C: no los toco, se lo digo |
| `diez-lectura.yml` | `lectura.mjs` imprime nombres | **de C, sin tocar**: se lo digo |
| `diez-prueba-c0009.yml` | el texto de las facturas (run 60) | por la puerta; los scripts de prueba ya solo sacan `@@` |
| `medir-ocr.yml` | códigos de recepción | riesgo bajo; en la deuda escrita |
| `leer-con-modelo-d01.yml` (nuevo) | — | no lee producción ni Diez; aun así solo saca aciertos por campo |

**En otras ramas**, sin fusionar, quedan copias viejas:

- 13 ramas con el agente «Libro diario» sin anonimizar;
- unas 60 con el `aplicar-produccion` de antes.

No se ejecutan solas (el de producción es manual). **Recomiendo borrar las
ramas ya fusionadas**; lo decides tú.

## 2 · La lectura con el modelo (R2 punto 2)

- **Las facturas inventadas:** las 8 clases, una foto torcida, una borrosa, un
  PDF escaneado sin texto y una de control
  (`tests/conta/d01/facturas-inventadas`).
- **La comparación:** campo a campo, con la misma vara a los dos lados
  (`compararLectura.mjs`).
- **El lanzamiento:** solo a mano, `leer-con-modelo-d01.yml`.
- **La clave:** `ANTHROPIC_API_KEY`, que no pasa por el chat ni por el
  repositorio.

**Resultado, honesto:** véase la sección 9.

## 3 · Los cambios aceptados (R2 punto 3)

- **Repetidas con el total** (0230 → 0260, la regla entera del C01b):
  - repetida = número y total;
  - posible = misma fecha y total (no cero) con otro número;
  - el mismo número con otro total no es nada.
- **Medido en producción antes de la tanda, solo leyendo:** solo Foodint tiene
  facturas, 6 vivas. **Bloquean 0, avisan 0.** Se vuelve a medir antes de la
  tanda.
- **El origen de lo aprendido** (0250): «aprendido de Diez» o «aprendido de tus
  facturas»; si las dos, el de la más reciente.
  - En N23 (0290), la cuenta de la ficha dice de dónde sale. Si se puso
    aceptando lo aprendido, el origen sale de la historia, no de una etiqueta
    guardada una vez.
- **La 472 única de Diez:** la comparación suma los tipos.

**Un fallo que salió aquí, dicho:**

- La 0210 deja `aprendido_diez` en `company_account_link.source`, pero
  `company_account_log` no lo admite. Confirmar lo aprendido con esa etiqueta
  habría fallado siempre.
- La pantalla confirma con `ai_accepted` (una propuesta aceptada por la
  persona), y el origen sale de la historia.
- `aprendido_diez` queda admitido y sin usar. El comentario de la 0240 que lo
  nombra no lo cambio: está aplicada en staging y su huella cambiaría.

## 4 · La tarea 5 que quedaba

Commit a43d2048, en staging:

- **La recibida va a Diez serie 2** con el freno del documento: sin PDF no
  sale, y si Diez no admite documentos, «No ha llegado a Diez: Diez no guarda
  documentos todavía».
- **«Apuntar solo lo seguro»:** solo la lectura «seguro», con la propuesta
  segura y sin avisos.
- **La foto, como PDF** (`fotoAPdf.ts`).

## 5 · N22 y N23

**Rutas:**

- `/conta/documentos` (N22), con `?ver=` y `?mes=`;
- `/conta/documentos/recibidas/:id` (N23), con el mismo filtro y mes, para
  «1 de 5», Anterior y Siguiente.

**Lo que es fiel a la maqueta:**

- **Los tres niveles de Libros:** menú, pestaña y la barra «Traer · Esperadas
  · Leídas».
- **La banda de la IA en una frase**, con el texto de la maqueta medido en una
  prueba (`documentosPantalla.test.ts`).
- **Las cinco cifras.**
- **La lista:** cada fila con su porqué y un solo botón; «Decirlo yo» en azul
  cuando no reconozco el emisor.
- **N23:**
  - el papel a la izquierda;
  - «Lo que he leído», con «Sus facturas se apuntan en» y su origen;
  - «Cómo se apunta»: la propuesta **de verdad**, la misma función que la
    tanda (`verPropuestaFactura`), sin escribir;
  - «Está bien · apuntar» en azul.
- **Las cuentas, siempre nombre · código.**

**«Está bien · apuntar»** hace, por este orden:

1. aprueba como en Compras;
2. propone como la tanda (`proponerFactura`: el bloque de facturas sacado tal
   cual a una función; comparado contra el anterior, solo cambian la consulta
   de una factura y que diga por qué no apunta una con fecha cerrada);
3. valida;
4. guarda su PDF;
5. la manda a Diez.

Donde se pare, lo dice.

**Donde la maqueta pide lo que no existe, paro y lo digo, sin cambiarlo:**

1. **«Por recepción · N sin factura»** (Esperadas). No se puede contar por
   empresa: `locations` no tiene a qué empresa pertenece cada local. No sale.
   **Pregunta a Julio:** ¿un local es siempre de una sola empresa? Si sí, hace
   falta esa relación.
2. **«Tuyos» (favoritos y Ctrl K):** no existen en Documentos. No sale.
3. **Las pestañas «Facturas emitidas» y «Otros documentos»:** no tienen
   pantalla aquí (Ventas dice «aún no»). Solo sale «Facturas recibidas».
4. **«con deshacer»** bajo «Apuntadas solas»: el deshacer de lo apuntado solo
   no está hecho. Pone «las ves en Apuntadas».
5. **La comparación de precios con el pedido** («2 suben un 4 %»): no está
   hecha. La banda dice lo que la lectura sabe; la fila «Precios» no sale.
6. **«Decirlo yo»:** en la maqueta está en «Para mirar». En el estado de la
   base, sin emisor es «por aclarar», y ahí sale.
7. **«Esperadas»** solo existen desde el día 15 (la regla de la 0200). Hoy es
   13: la banda no dice «Faltan…», y no lo he fingido.

**Lo que no funciona no se enseña:**

- «Por correo» sale solo con el correo de la empresa encendido.
- «De Cocina» sale solo si la empresa recibe la mercancía y la cuenta no es
  solo de contabilidad.

**Un hueco cerrado:** subir otra vez un fichero cuya lectura falló **lo vuelve
a leer**. Antes decía «ya estaba subido» y se quedaba sin leer para siempre.

**«Pedírselas»:**

1. pregunta «¿A quién se la pido?», con el contacto de Facturación si lo hay;
2. la persona confirma;
3. la petición queda guardada como confirmada (0290) y se abre **su** correo
   con el mensaje (mailto). No sale nada solo.

## 6 · Móvil

- **Subir:** «Hacer foto» con la cámara (`capture="environment"`) y «Subir
  PDF».
- **«Para mirar»:** en tarjetas.
- **«Está bien · apuntar»:** abajo, fijo, bajo el pulgar. La e2e comprueba que
  está en la mitad de abajo sin desplazarse.

## 7 · Las dos cuentas

- **A, con Cocina:** la semilla `seed_d01_staging.sql` (todo inventado, ids
  fijos, cuenta A).
- **Frente C, sin Cocina:** la misma cuenta con `?marca=contabilidad`, como
  dice R2. La e2e mira el contenido de Documentos: ni «Cocina» ni «Folvy», en
  el texto ni en las etiquetas.
  - **Lo que decide «solo»:** `documentos/producto.ts`, un **puente** hasta
    que entre la C06. Lee `accounts.product_brand` (llega con la fila de la
    cuenta que ya carga la plataforma) y `?marca=` fuera de producción, con la
    misma clave de sesión que C.
  - **El día que se fusione la C06** se cambia por `useProductoSolo()` y
    `MARCA.nombre`, y se borra.
  - **Vendido solo,** la pantalla habla en primera persona («Lo que he
    entendido», «Lo que he hecho yo»). Las cifras dicen «recepciones» y la
    fila «llegó por su recepción».
- **El marco (menú, barra de abajo) es de la C06**, y en esta rama aún dice
  Folvy. La e2e no lo mira; eso lo mide C.
- **No he sembrado nada en la cuenta de la C06:** es de C y cuenta sus filas.

**«Recibe la mercancía»** (R2 punto 4):

- Sin fila en `company_purchase_setting` es «no». Una cuenta de la C06 no
  tiene fila, y N22 lo oculta en solo.
- **Falta, para la 7:** que `conta_recibe_mercancia` devuelva «no» siempre que
  la cuenta tenga marca. Eso necesita la columna `product_brand` de C, que no
  está en main.
- **No hay pantalla del interruptor** en ninguna parte: ¿va en Ajustes, y es
  mía o de C?

## 8 · Coordinación

- **Para C:**
  1. **La ficha del proveedor (R3 punto 5).**
     - **La ruta es tuya** (`module.tsx` y `navegacion.ts`): para la ficha no
       los he tocado. Lo de esos dos ficheros es solo la ruta y la línea del
       menú de «Documentos», ya dichas desde la R2.
     - **Lo mío va en la ficha:**
       - «Sus facturas se apuntan en» dice de dónde sale. Si se aceptó lo
         aprendido, «aprendido de Diez» o «aprendido de tus facturas». Sin
         nada puesto, lo aprendido como propuesta «sin confirmar».
       - Sale en la pestaña Contabilidad (`SusCuentas` → `cuentasProveedor.ts`,
         con dos pruebas nuevas) y en la línea del móvil
         (`FichaProveedorPage.tsx`).
       - El papel `billing` se llama «Facturación» (`types.ts`). El contacto
         que guarda «Pedírselas» salía en «Con quién hablas» sin nombre de
         papel.
     - **Lo que espera a la C06, que aún no está en main ni tiene PR:**
       - `useCuentaConta().soloContabilidad` y `direccionDeFacturas` de
         `marcas.ts` no existen en esta rama.
       - Mientras, «solo contabilidad» sale de mi puente
         (`documentos/producto.ts`, la misma columna `product_brand` que lee
         C). Al fusionar la C06 se cambia en una línea por lo tuyo.
       - **El correo de entrada no se enseña** hasta que exista
         `direccionDeFacturas`: no lo calculo por otro lado, porque dos
         fuentes de la misma dirección acaban diciendo cosas distintas.
     - **La extensión de Cocina:** la ficha ya solo la pinta si Cocina la
       monta. No he cambiado nada ahí.
  4. `diez-lectura` y los `sqlerrm` de `importar.sql` sacan texto (sección 1).
  5. **El cerrojo de las e2e (rama `conta/e2e-usuarios-por-frente`) no ve
     nunca que lo ha cogido.** Esto bloquea todas las e2e en cuanto se
     fusione.
     - **Qué pasa:** con `-A -t`, psql devuelve `cogido` seguido de
       `UPDATE 1`, y la comparación espera solo `cogido`. El primer run
       renueva su propio cerrojo cada 30 s; los demás esperan.
     - **Lo que costó:** los runs 206 y 207 se quedaron una hora en ese paso,
       desde las 19:47.
     - **Medido** con el mismo comando contra un Postgres local:
       `r=[cogido⏎UPDATE 1]`, «NO LO VE COGIDO», y la fila tiene el run como
       dueño.
     - **Arreglo de un carácter:** `psql -q` en esa llamada, o
       `grep -qx cogido`. No lo toco: es tu rama.
- **Las e2e del cierre que esperaban las 6:00 ya esperan las 2:00 en main**
  (1f8638c7). A B le basta traerse main.
- **El solape de e2e.**
  - **El de hoy, ya contado:** mi push de las 18:00 lanzó la 197, que pisó la
    195 y la 198 de C. Pasó.
  - **Desde entonces, sin lanzarlas:** empujo con `[skip ci]`, aplico staging
    a mano y espero a que no haya ninguna e2e en marcha (comprobado por la
    API) antes de lanzar la mía.
  - **Cuando entre la rama de usuarios por frente,** me traigo main. **Hecho
    (R3):** main con el #179 está en esta rama (f8891167). La rama
    `conta/d01-*` es el frente A, con sus usuarios y el cerrojo.

**Compartido, pequeño, dicho:**

- `src/config/navegacion.ts`: la ruta y la línea de «Documentos» en el menú.
  **Choca con la C06**, que toca el mismo bloque; se resuelve a mano.
- `tests/unit/modules/conta/marcoC00.test.ts`: «documentos» visible. **Choca
  con la C06**, que cambia la misma línea.
- `src/modules/conta/module.tsx`: dos rutas.
- `src/modules/conta/estilo/index.ts`: una línea.
- `propuestasLibroService.ts`: el bloque de facturas sacado a una función.
- `aplicar-produccion-conta.yml`, `deshacer.sh`, `diez-importar.yml`,
  `agente-libro.mjs` y `diez-prueba-c0009.yml`: sección 1.
- `_shared/ocrAlbaranNucleo.ts`: `MODELO_VISION` vive ahí y `ocr-albaran` lo
  usa.
- Supply: el aviso de repetida, `rpcSinTipar` y la e2e del C01b, que espera
  409.
  - **Es la R3 punto 3**, ya en esta rama desde ce6e8624 y en verde en las
    e2e 214 y 215.
  - En las ramas que no la traen falla, porque staging ya tiene la regla de la
    0230/0260. Se arregla al traerse main después de esta fusión.
- `tests/e2e/conta/c00/marco.spec.ts` (R3 punto 4): sin «Documentos» en la
  lista de lo que no tiene pantalla. Al juntarla con B queda `['Por hacer']`.
- `tests/e2e/conta/c04/libro.spec.ts` (R3 punto 2): «Lo que he hecho yo»
  crea su propio asiento y lo busca por lo que es (sección 9).
- La ficha del proveedor: `types.ts`, `cuentasProveedor.ts`, `SusCuentas.tsx`,
  `cuentasProveedorService.ts` y `FichaProveedorPage.tsx`. Arriba, en «Para
  C».

## 9 · Resultados medidos

- **0290 en staging: verde** (run 38450004318). Antes, tres fallos que cazaron
  los runs:
  - una asignación dentro de un `if`, que plpgsql no admite;
  - un origen de registro que el CHECK no admite (el bug de la sección 3);
  - los datos de la prueba escritos como usuario, sin permiso sobre el IVA
    por tipo.
- **La comprobación local antes de reintentar:** el mismo chequeo de sintaxis
  contra un Postgres 16 local. El fichero viejo da 1 error y el nuevo 0, con
  la misma vara.
- **La semilla en staging** (run 38454739496) dice: «Semilla D01 · cuenta A: 2
  proveedores y 3 facturas de octubre».
- **Unitarias:** 3166 de 3166.
- **Lint de lo tocado:** 0 con el cambio y 0 en HEAD.
- **`antes-de-subir`:** todo en verde, con el paso 8, antes de cada push.
- **e2e 214** (38473042812): 164 en verde, 53 saltadas y 1 fallo **mío**. La
  e2e compartida del C00 esperaba «Documentos» sin enlace, y ahora tiene
  pantalla. Arreglado (6809f2e5), la misma línea que cambió B para Bancos.
  **Las cuatro pruebas de D01 pasan en ordenador y en móvil.**
- **e2e 215** (38476695805): 163 en verde, 53 saltadas y 2 fallos (ordenador y
  móvil), **que no son de este cambio**. Es
  `c04/libro.spec.ts:118`, «Lo que he hecho yo» sin «Asenté «Ventas del día ·
  Norte Centro»»:
  - **La causa, medida en staging leyendo:** la semilla de B
    (`seed_b01_staging.sql`, aplicada a las 22:18 UTC por el run 38476832698)
    deja **tres aperturas a 30/09 como propuesto** en la cuenta A.
  - «Lo que he hecho yo» enseña las 5 más recientes. El asiento que validó
    Folvy pasa al octavo puesto.
  - En la 214 (antes de esa semilla) pasaba.
  - **Desde ahora falla igual en todas las ramas.**
  - **Ni la semilla de B ni esa prueba son mías:** la prueba es de otra
    sesión (C04/C05). No toco ninguna de las dos.
  - **Arreglos posibles, a decidir por B o por quien lleve el C04:**
    - que la semilla de B ponga sus aperturas en una empresa propia o las deje
      validadas;
    - o que la prueba busque el asiento de Folvy sin depender de que esté entre
      los cinco últimos.
- **Las capturas no han subido.** El paso que las sube a la rama solo corre
  con todo en verde, y la 215 no lo está por ese fallo ajeno. Los artefactos
  del run tampoco se pueden bajar desde aquí: el proxy del entorno da 403 a
  `blob.core.windows.net`.
- **La lectura con el modelo** (run 38458409769): **0 de 12 leídas**.
  - Las 12 dan HTTP 400 `error_saldo_o_limite`: **la cuenta de la API no
    tiene saldo o ha llegado a su límite**.
  - **Arreglados dos fallos míos** que cazó este run (5576405a):
    - salía verde sin leer nada;
    - una factura sin leer contaba como aciertos los campos vacíos.
- **El BOE** (run 38455114901): la búsqueda «"EHA/962/2007"» no devuelve nada
  (HTTP 200 vacío). No sé su identificador con seguridad y no me lo invento:
  **pégame los artículos**, como dice R2.

## 10 · Lo que paro antes de la 7

- **Producción:** nada. La tanda (0200 a 0290) va en la 7, con la fusión, en
  este orden: base, funciones, front, con el paso 8. Antes se vuelve a medir
  cuántas facturas chocarían.
- **Pregunta de negocio a Julio:** en una empresa solo de contabilidad, ¿las
  facturas «seguro» se apuntan sin pasar por la aprobación de Compras?
- **El run 60:** si no lo has borrado aún, bórralo desde GitHub.
