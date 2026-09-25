# Instrucciones de arranque

REGLA CERO: antes de responder cualquier pregunta técnica, lee SIEMPRE CONTEXTO_CLAUDE.md (estado actual, decisiones, roadmap y deudas del proyecto Folvy).

Reglas de trabajo del CEO (Julio):
- Archivos completos, no diffs.
- Pedir el fichero original antes de modificarlo.
- No tocar App.tsx ni AppContext.tsx sin permiso explícito.
- La BBDD es la verdad: verificar vía information_schema antes de decisiones de schema.
- SQL transaccional y revisable ANTES de ejecutar. Claude Code propone, Julio ejecuta y verifica.
- Marcar siempre cada acción operativa (commit, build, push, deploy).
- TypeScript strict, camelCase cliente / snake_case BBDD.

## Reglas ganadas en producción

Cada una costó un incidente real. La fecha es el día que se pagó.

1. **Ninguna corrección vive solo en el desplegado.** Si se toca una edge function, se commitea antes o inmediatamente después. Un deploy sin commit es una corrección con fecha de caducidad: el siguiente despliegue desde el repositorio la borra sin avisar.
   *(27/08, con dos muertos encima: el 13/08 un deploy de `hubrise-webhook` se llevó por delante la captura de `collection_code` — 14 días y 148 pedidos sin el código que ve el cliente — y `resolveHubriseToken` por conexión — el 404 del push. Ninguna de las dos estaba en git. Vigía: `edge-drift-watchdog`, diario.)*

   **LA PUERTA DE LA PROHIBIDA** *(16/09, aceptada por Julio)*. De aquel
   incidente salió que `hubrise-webhook` no se despliega desde el workflow.
   «Nunca» estaba protegiendo dos cosas con la misma palabra: que no salga
   **sola** —que es lo que pasó— y que no salga **nunca**. Lo primero es la
   regla. Lo segundo dejaba como único camino un token en el portátil de
   alguien, y eso es *peor*: un despliegue sin traza, desde un árbol que nadie
   ve, que es exactamente cómo se pierde una corrección.
   - La exclusión **automática** no se toca: un push a `main` no la despliega jamás.
   - Se abre a mano, con **dos cerrojos** en una ejecución manual: nombrarla en
     `funciones` **y** escribir su nombre entero en `la_prohibida`. Un dedo
     torpe no la abre, y el resumen deja escrito quién la abrió y desde qué rama.
   - **Antes de empujarla se mide la deriva**, y eso no lo puede hacer el
     workflow: **lo desplegado contra `origin/main`**. Si difieren, hay una
     corrección viva fuera de git y desplegar la borra — el 13/08, literal. La
     medida se pega en el parte.
   - **Y lo desplegado se comprueba después**, no se da por bueno con el color
     del run. El 16/09 el workflow salió **verde sin desplegarla** —la
     excluía— y di por hecho que había salido: la mitad de una pieza estuvo dos
     horas commiteada y sin efecto. Se compara el md5 de lo desplegado con el
     del fichero, y se prueba que arranca.
   *(16/09: desplegada por la puerta a las 21:12, con el servicio en marcha y
   hueco medido —0 pedidos de HubRise en 5 minutos—. md5 idénticos los dos
   lados antes de empujar; v57 byte a byte igual a la rama después; un GET
   devolvió 405, o sea que el módulo arranca, sin escribir nada. Los 7 pedidos
   siguientes entraron con sus líneas, su consumo en UNA sola pasada y 0
   fallos.)*

2. **Añadir un parámetro a una función es DROP + CREATE, nunca CREATE OR REPLACE.** Replace no reemplaza: crea una SOBRECARGA, y a partir de ahí las llamadas con la firma vieja son ambiguas.
   *(27/08. Al añadir `p_debounce_window` a `_queue_system_alert` quedaron dos firmas; las llamadas de 4 argumentos empezaron a dar `ERROR 42725 … is not unique` y los SIETE vigías se quedaron sin poder encolar durante minutos. Se detectó porque se probó inmediatamente después de aplicar.)*

3. **`computed_cost = 0` tapa el `fixed_cost` real**, porque el motor usa `COALESCE(computed_cost, fixed_cost, 0)` y cero no es NULL. Al rellenar un coste fijo, poner el computed a NULL.
   *(26/08. Test de regresión T12.)*

4. **`sale.sold_at` está en UTC.** Cualquier análisis de horario de servicio convierte a `Europe/Madrid` ANTES de concluir nada.
   *(26/08. Un "corte a las 21:39" se reportó como dos horas de cena perdidas; eran las 23:39 de Madrid, o sea los últimos 20 minutos del servicio. Dos horas de diagnóstico equivocado.)*

5. **Verificar con la query, no con la afirmación.** Pegar el resultado, no el resumen.
   *(Recurrente. El caso caro: se probó si los combos consumían mirando `stock_movement.source_id = sale_line.id`, pero en ventas `source_id` es la VENTA, no la línea — 45.614 de 46.591. La evidencia no medía lo que se creía.)*

6. **Reprocesar consumo siempre con corte en el último conteo aprobado**, salvo autorización explícita y reanclaje posterior.
   *(25/08. Tres botones vivos reprocesaban a escala 11x por debajo de conteos ya cerrados.)*

7. **Un umbral ordena, no esconde.** Una pantalla que el usuario abre a propósito NUNCA oculta filas; un aviso que le interrumpe SÍ filtra. El umbral decide el **orden** y la **etiqueta**, nunca la **existencia**.
   *Detector automático:* si para ser honesta una pantalla necesita una nota al pie del tipo «y además hay N que no te enseño», el filtro está en el sitio equivocado. Esa nota no es transparencia: es la confesión de que el diseño sabe que está escondiendo algo.
   *Dónde SÍ va un umbral:* en lo que interrumpe a alguien — push, `system_alert`, correo, el badge rojo del menú. Ahí filtrar es respeto por la atención del otro. Un contador puede contar solo lo prioritario, pero no puede decir «0, sin alertas» en verde habiendo filas.
   *(29/08. Stock negativo de Alcalá decía «sin alertas» y resumía «+9 por debajo del umbral (ruido, no listados aquí)» mientras Pedidos enseñaba Coca-Cola Original Lata a −10 ud. El umbral no fallaba —Coca-Cola quedaba fuera por 2,7 latas— fallaba usarlo para decidir la existencia de la fila. Lo caro no es el dato oculto: es que el operario aprende que "sin alertas" no significa "no hay nada", y deja de creerse también las pantallas que dicen la verdad.)*

8. **Un botón que hace algo importante confirma o falla en pantalla.** Callar no es una opción: el silencio se lee como fallo, siembra dobles clics y esconde los errores de verdad.
   *Detector automático:* si al pulsar hay que ir a mirar la base de datos para saber si funcionó, el botón está incompleto. Y la confirmación lleva **contenido**, no un visto: «Publicado. Avisadas 4 personas» dice algo; «Hecho» no.
   *Es la misma familia que la regla 7, un piso más abajo:* la 7 prohíbe esconder filas que existen; la 8 prohíbe esconder que algo ha pasado.
   *(30/08. Julio publicó el cuadrante del 31/08 a las 15:04:35 y la pantalla no dio «ninguna señal de ok, bien, mal o lo que sea». En BBDD todo correcto: status published, celdas intactas y los 4 avisos creados. Éxito silencioso. La misma semana habían aparecido los otros dos de la familia: `kds_heartbeat` con token huérfano devolviendo HTTP 200 —tres días de tablet invisible— y el autocierre degradando sus fallos a `raise warning`, que pg_cron cuenta como éxito: 185 «succeeded» con cero movimientos de stock.)*

9. **Toda consulta o guarda que ancle por NOMBRE filtra primero por `account_id`.** Las tablas son multi-cuenta y el catálogo plantilla del sistema (`Folvy Interno`, `00000000-0000-0000-0000-000000000001`) comparte tablas Y NOMBRES con producción. Un `count(*)` sin `account_id` no da un número equivocado: da un número **que no es de nadie**. Con el cliente 2 dentro, esto se multiplica.
   *Detector automático:* si una cifra va a ir a un encargo, a una migración o a una pantalla, y sale de `recipe_item`, `supplier`, `sale`, `goods_receipt_line` o cualquier tabla con `account_id` — la consulta lleva `account_id`, o la cifra lleva escrito de qué cuentas es. Anclar por nombre sin cuenta es coger la ficha de otro.
   *Excepción, y hay que decirla:* los catálogos GLOBALES sin `account_id` (`vat_category`, `vat_rate`, `family_vat_default`, `connector`) se leen enteros a propósito. Y una huella de «esto no se ha movido» puede ser de tabla entera —es más fuerte así—, pero entonces se etiqueta como tal.
   *(31/08. Mordió CINCO veces el mismo día. «273 de 1.072 artículos con categoría fiscal (25 %)» eran en realidad 188 de 352 en Foodint (53 %): el resto era el catálogo plantilla, y el error no solo daba mal el número, INVERTÍA la conclusión — dije que la mayoría preguntaba y la mayoría resuelve. Luego: «481 direcciones con Spain» eran 475. «921 líneas de albarán» son 834 de Foodint + 87 de la plantilla. «32 de 32 direcciones repetidas de Just Eat» eran 25 de Foodint + 7 de Kitchen Grill LstQ. Y el caro: una migración anclaba AMIRSA por nombre y encontraba DOS, una de Foodint y otra de la plantilla — su guarda anti-homónimos habría abortado la migración entera en la ventana de las 01:30. Dentro de Foodint no hay ni un nombre de proveedor repetido: el duplicado nunca existió, existía la consulta sin cuenta.)*

10. **Un cambio de coste o de stock se ensaya por sus CAMINOS, no por su fórmula.** Medir que la media sale bien no prueba nada sobre quien la escribe. Antes de aplicar, dentro de una transacción revertida: **cerrar una venta, recibir un albarán, apuntar una merma y aprobar un recuento**. Los cuatro. Si alguno no se puede ensayar, eso es el hallazgo, y se dice.
   *Detector automático:* si el ensayo de un cambio de coste o de stock solo contiene `SELECT`, no es un ensayo. La pregunta no es «¿da el número correcto?» sino «¿quién escribe esto y qué le pasa a esa escritura».
   *(= regla 32 de la maestra.)*
   *(10/09, y lo pagó el servicio entero. Mi p8 dejó `avg_unit_cost` en NULL cuando no hay coste fiable —lo correcto, y lo pidió Julio— pero `recipe_item_location_stock.stock_value` era NOT NULL y se calcula `qty × avg`. Desde las 12:13 UTC, cualquier camino que recalculara stock abortaba con 23502 y se llevaba la transacción entera: 79 «Entregado al rider» por token, 33 cambios de estado, 10 mermas y 7 cierres de venta, todos rechazados. A las 22:00 había 12 pedidos «Listo» sin cerrar en Alcalá, el más antiguo de las 14:49. Mi ensayo de la p8 midió la media sobre 453 filas y no ejecutó ni una venta.)*

### La banda de servicio, escrita para no tener que juzgarla

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Aquí se cita
> para que exista en el repositorio, que es donde se lee.

> **Publicar el FRONT ya no espera a ninguna hora** (13/09). Las tablets se
> defienden solas: descargan cuando toca y aplican solo dentro de la ventana de
> su local y con la cocina en calma. Medido el 13/09: los paquetes 291 y 292
> cayeron con la cocina en servicio —50 ventas desde las 15:00 y pedidos
> abiertos— y las tres tablets siguieron en el 290 que cogieron a las 12:06,
> vivas y latiendo al minuto. Y el par que lo convierte en prueba: esas mismas
> tres cogieron el 287, 288, 289 y 290 solas por la mañana. Recoge cuando puede
> y espera cuando no.
>
> **La banda queda solo en la BASE, y solo para lo que toca el camino del
> pedido.**

**Entre las 12:15 y las 00:30 (reloj de la base, `now() at time zone 'Europe/Madrid'`)
no se aplica ninguna migración**, salvo que se cumplan LAS TRES:

1. **No está en el camino del pedido.** Ni lo llama un disparador, ni un cron,
   ni una función que sí lo esté. **Se CUENTA, no se supone**: `pg_proc`,
   `cron.job` y `pg_trigger`, y el número va al parte.
2. **No toma cierre exclusivo sobre una tabla que el pedido lee o escribe.** Un
   `create or replace` de función, no lo toma. Un `CHECK` o un índice sobre una
   tabla del camino, sí — y ésos esperan.
3. **Se dice ANTES de aplicarlo**, con la medida delante.

Si falla una, se espera a las 00:30. Y la duda va siempre a favor de esperar:
la banda existe porque a las 13:00 hay gente cocinando.

*Por qué acaba a las 00:30 y no a las 23:45 (25/09):* había dos bandas escritas
—ésta decía 23:45, el método del parte diario 00:30— y se zanjó con datos, 30
días y todas las fuentes (26/08–24/09): el pedido más tardío entró a las
**23:59**, **6 de 30 días** tuvieron alguno después de las 23:45 y **0 de 30**
después de las 00:15. Con 23:45, uno de cada cinco días se aplicaba en servicio.

*Por qué está escrita así (13/09):* la versión anterior pedía que la migración
«no escribiera» —`STABLE` o `IMMUTABLE`—, y eso no es lo que protege. Se vio al
cerrar las tres puertas de `modifier_recipe_impact`: son `VOLATILE`, así que por
la letra había que esperar a la noche, pero **no las llama nada vivo** (cero
funciones, cero crons, cero disparadores, medido) y un `create or replace` de
función no cierra ninguna tabla. Esperar habría dejado ocho horas más una puerta
por la que se escribían decisiones que no descuentan nada. En cambio el `CHECK`
sobre esa misma tabla sí espera, porque toma `ACCESS EXCLUSIVE` sobre algo que
`_sale_line_raw_consumption` y `compute_sale_line_cost` leen en cada pedido.
La banda protege **el camino por el que pasa un pedido vivo**, no la volatilidad
declarada de una función. Las tres de arriba se miden, se pegan y no se opinan;
la de antes obligaba a esperar por una etiqueta y a discutirlo cada día.

*Por qué la anterior (12/09), que también fue una corrección:* antes decía «nada
que toque entrada de pedidos, consumo o stock», que es una regla en función del
DAÑO y obliga a juzgar cada caso. Se aplicó una RPC de lectura a las 13:06
midiendo que no tocaba nada de eso —era correcto— pero el criterio no era
comprobable por otro.

### Una fusión está hecha cuando VERCEL dice READY en producción

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> 16/09, después de la tercera del día.

Fusionar a `main` no publica el front: **lo publica el build de Vercel, y el
build puede fallar**. Mientras no diga READY, `main` y producción son dos cosas
distintas, y el operario sigue viendo la pantalla de antes.

- **Se comprueba en Vercel**, mirando el despliegue de producción y su estado.
  El commit en `main` no vale; el correo de Vercel tampoco, porque llega tarde
  y puede ser de un despliegue ya superado.
- **Antes de CUALQUIER push a `main`, `npm run build` exacto y en limpio**
  --borrando `*.tsbuildinfo`--. No un comando parecido: **ese**.
- **También para un commit de sólo documentación.** Dispara despliegue igual.

*Por qué, y lo pagué tres veces el mismo día (16/09):*

1. Un workflow salió **VERDE sin desplegar** `hubrise-webhook` --la excluye por
   nombre-- y lo di por desplegado. Dos horas commiteada y sin efecto.
2. Comprobé el front con `npx tsc --noEmit`, y este repositorio usa *project
   references*: **`tsc --noEmit` en la raíz NO comprueba los proyectos
   referenciados**; `tsc -b`, que es lo que corre `npm run build`, SÍ. Mi
   comprobación era un comando PARECIDO, no EL comando. La fusión de las 22:09
   murió en Vercel con `TS2741: Property 'en_ruta' is missing`, y Julio siguió
   viendo cuatro pestañas mientras yo daba el paquete por publicado.
3. Empujé el parte --sólo un `.md`-- sin volver a pasar el build, dando por
   hecho que documentación no rompe nada. Arrastraba el mismo error, disparó
   otro despliegue de producción y otro correo de fallo.

*Los tres son el mismo error con tres caras: dar por buena una señal PARECIDA
--el color, el nombre del comando, la naturaleza del fichero-- en vez de la
señal PUBLICADA.*

### Retener un paquete OTA no es quitar el manifiesto

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Lo pagó el 305.

Quitar `apps/bundle.json` impide que una tablet **descubra** un paquete nuevo.
No impide que **instale** el que ya se bajó, y ésa es la diferencia que costó el
incidente.

*El camino, con `appUpdate.ts` y `UpdateGate.tsx` delante:*

1. Cada ciclo, `checkForBundleUpdate()` lee `apps/bundle.json` y compara
   `bundleId` con el que corre.
2. Si hay uno nuevo, `prefetchOtaBundle()` lo **descarga al disco de la tablet**
   --Capgo lo deja ahí, sin activar-- y se guarda su `id` en memoria.
3. A partir de ese momento la tablet ya no necesita el manifiesto para nada:
   sólo espera a que se abran las dos llaves (fuera del horario del local y
   cocina en calma) y llama a `applyOtaBundle(id)`.

*Lo que pasó el 16/09, con las horas:* el `bundle-305.zip` se subió a las
**22:26:48** y el manifiesto se retiró a las **23:04:43**. **Treinta y ocho
minutos** de ventana: suficiente para que las dos tablets de Alcalá se lo
bajaran. Se quedaron encendidas toda la noche con el id en memoria y lo
aplicaron por la mañana, con la cocina parada, a las **07:51:53** y
**07:52:45**. La retención funcionó para lo que no se había descargado
--Carabanchel siguió en el 303-- y no para lo que sí.

**Cómo se retiene de verdad, y son las dos cosas:**

1. **El manifiesto apunta a la versión que ya corren**, no se borra. Un
   `bundle.json` con el `bundleId` que las tablets tienen puesto hace que
   `remote.bundleId > currentId` sea falso y no haya descarga. Borrarlo también
   vale para eso, pero un manifiesto que no existe no se puede consultar: ver
   el punto 2.
2. **La tablet vuelve a mirar el manifiesto ANTES de instalar lo descargado**
   (`sigueEstandoPublicado`, 17/09). Si contesta y ya no es ese paquete, se
   descarta. Si **no contesta, se aplica igual**: la lección del 13/09 es que
   una tablet que no puede actualizarse porque la red va mal se queda clavada
   para siempre y en silencio, y eso es peor.

*Y lo que hay que asumir mientras tanto:* entre el minuto en que se sube un zip
y el minuto en que se retira, cualquier tablet encendida puede habérselo
bajado. **Un paquete retenido después de publicarse ya no se puede retirar de
las tablets que lo cogieron: sólo se puede tapar publicando uno posterior.** Por
eso el número del paquete nuevo tiene que ser MAYOR que el retenido.

*Detector automático:* si un parte dice «retenido» y el zip llevaba minutos
subido, la pregunta no es si el manifiesto está quitado, sino **qué
`bundle_applied` tiene cada tablet** y si alguna lo tiene ya descargado. Lo
primero se ve en `kds_device`; lo segundo, hoy, no se ve desde el servidor.

### Una cosa está aplicada cuando está en PRODUCCIÓN, no cuando está commiteada

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque.

Para una edge function, **manda lo desplegado**. El commit no despliega: el
despliegue lo dispara `push` a `main`, así que todo lo que vive en una rama
sin fusionar está escrito y **sin efecto ninguno**. Se comprueba mirando los
dos lados —lo desplegado contra `origin/main`— y se dice cuál de los dos va
por delante.

*Detector automático:* si un parte dice «X aplicada» y X toca una edge
function, la pregunta es en qué versión desplegada está X. Si la respuesta es
«está commiteada», X no está aplicada.

*Y ojo con lo que arrastra la fusión:* fusionar a `main` no despliega solo la
función que se quería tocar. **Publica también el front**, y con él la web de
las tablets. Fusionar a las 14:10 es publicar en banda aunque el cambio
pretendido fuese de una edge function que corre a las 03:20.

*(12/09. A2c —el retiro de extras— se dio por aplicada el 11/09. Su mitad de
base estaba viva —el sello, el disparador, el CHECK— pero el retiro vive en
`lastapp-catalog-import`, y esa función seguía siendo la de antes: dos días
commiteada y sin efecto. Lo desplegado era `origin/main` byte a byte, así que
no había deriva: había dos commits sin fusionar. La pasada de las 03:20 no
habría retirado nada y se habría ido a buscar una retirada que no podía
existir. Salió al ir a desplegar el cinturón y comparar los dos lados.)*

### Numeradas por la secuencia maestra

> Estas dos citan el número de `folvy_deudas_abiertas.md`, que es **la única
> secuencia**. `CLAUDE.md` cita, no acuña.
>
> **Deuda declarada, no arreglada:** las 1 a 9 de arriba llevan numeración local
> antigua y la 2 choca casi seguro con la 2 de la maestra. Se reconcilian otro
> día, con la lista delante — renumerarlas hoy sería churn. Mientras tanto, las
> referencias «regla 7 / 8 / 5» dentro de la 30 y la 31 apuntan a esta lista de
> arriba, no a la maestra. Y va dicho aquí: los números 30 y 31 no los he podido
> verificar desde el repositorio, porque la maestra no vive en él.

30. **La lista con la que se ELIGE no puede ser la lista con la que se LEE.** Si una pantalla filtra un catálogo para decidir qué se puede escoger, y luego resuelve contra esa misma lista los nombres de lo que ya está guardado, todo lo que cae fuera del filtro **deja de tener nombre**. El registro está bien; la pantalla miente sobre él. Y es la mentira más cara de detectar, porque pasa en trabajo YA HECHO, que nadie vuelve a mirar.
   *Detector automático:* si una resolución de nombre tiene un literal de reserva —`?? 'ingrediente'`, `?? 'sin nombre'`, `?? '—'`— hay que preguntar **en qué lista buscó**. Si es la misma que el selector filtra, ya está mintiendo: solo hace falta una fila fuera del filtro. El literal de reserva es para lo que no existe, nunca para lo que no se ha buscado bien.
   *Es la familia de la 7 y la 8, en el tercer sitio:* la 7 prohíbe esconder filas que existen; la 8 prohíbe esconder que algo ha pasado; la 30 prohíbe **esconder que algo ya estaba hecho**.
   *(05/09. El selector de «Definir» filtraba el catálogo a `raw`/`recipe` y dejaba fuera los 158 platos de la cuenta. Los 15 impactos `bundle` confirmados apuntan a un plato, y `ImpactSummary` resolvía el nombre contra esa misma lista: no lo encontraba y caía a `'ingrediente'`. **Quince modificadores bien configurados llevaban meses pintándose «+ ingrediente · 1».** Apareció de rebote, arreglando otra cosa. Lo caro no es la etiqueta fea: es que quien lo mire concluya que el trabajo no está hecho y lo vuelva a hacer.)*

31. **La prueba se escribe contra la población real, y el antes/después se mide con la misma regla a los dos lados.** Una prueba con ejemplos inventados confirma la suposición que la escribió: solo los datos de verdad te llevan la contraria. Y un «no he roto nada» vale exactamente lo que valga su medición — el mismo número, tomado igual, antes y después, pegado.
   *Detector automático:* si los ejemplos de una prueba salen de la cabeza de quien escribió el código, la prueba es un espejo. Y si un «no he roto nada» no viene con **dos cifras tomadas con la misma vara**, es una opinión. Vale para el lint, para el recuento de pruebas, para los md5 y para cualquier cosa que se compare.
   *Es el piso de abajo de la 5:* la 5 dice cómo se verifica una conclusión; la 31 dice cómo se construye la comprobación, antes de que haya conclusión que verificar.
   *(05/09, dos veces en el mismo commit. (a) Mi lista de palabras clasificaba «Escoge la base de tu bocata» como que pedía un plato entero, y pide un ingrediente. Lo cazó la prueba porque estaba escrita contra los 107 nombres de grupo REALES; con ejemplos inventados habría pasado en verde y salido a producción. (b) El lint: en vez de afirmar «no añado avisos», se midió en `origin/main` —7 problemas, 3 errores— y con el cambio —12 y 8—. Cinco errores nuevos, todos `react-refresh` por exportar funciones desde un fichero de componente; moverlas a `lib/` devolvió el número exacto a 7 y 3. Sin medir los dos lados, esos cinco se habrían ido con un «no he roto nada» encima. El mismo día ya se habían dado mal cuatro recuentos por medir un solo lado: las 876 migraciones contra 373 filas, mis 46/137 contra el md5 con el salto recortado, las 201 contra 224 con dos normalizadores distintos, y el reparto 171/221 de tipos de ficha que en realidad era 167/158/63/3/1.)*

40. **El comprobador de tipos no cruza la frontera de la cadena de texto.** Todo nombre de tabla, de columna o de función que viaje DENTRO de una cadena —`.from('x')`, `.rpc('x')`, una relación embebida en un `.select('… tabla(campos) …')`, SQL en línea— está fuera de la red: no lo mira `tsc`, no lo mira el lint y no lo miran las pruebas. Se comprueba contra el esquema, a mano, y la comprobación se pega.
   *Detector automático:* si un nombre del esquema está entre comillas, la pregunta no es «¿compila?» sino «¿existe hoy en la base?». Y si ese nombre sólo se ejecuta en un camino raro —una pantalla que se abre poco, una rama de error, una tabla todavía vacía— el fallo no aparece al desplegar: aparece meses después, delante de quien menos culpa tiene.
   *Hermana de la 36, por el otro lado:* la 36 dice que una prueba cuya población no puede fallar es un espejo. La 40 dice que ahí **no hay prueba ninguna**, ni buena ni mala.
   *Cómo se barre entero, y cuesta un minuto:* se sacan del código todos los nombres entrecomillados de `.from(`, `.rpc(` y las relaciones embebidas, y se pregunta a `pg_class` y `pg_proc` cuáles no existen. Medido así el 15/09 sobre 412 nombres: **uno muerto**, `list_costless_sold_products`, que `20260902204305` retiró de la base el 02/09 y `SalesExceptionsPage` sigue llamando trece días después (ya estaba escrito en `docs/RECON_tipos_b18_20260903.md` §4.1). Los otros 17 «no encontrados» eran falsos: `inner` de `!inner` y dieciséis `*_id` que son la sintaxis de PostgREST para nombrar la clave ajena, no tablas.
   *(15/09. Escribí `dish_family` de memoria dentro de un `.select()` --la tabla se llama `recipe_family`, según la clave ajena `kitchen_family_route_family_id_fkey`--. Habría pasado `tsc`, el lint y las pruebas, y la página habría salido en blanco el día que alguien ruteara una familia, con `kitchen_family_route` a cero filas en toda la base y cero inserts en toda su vida: o sea, dentro de meses y sin nadie mirando.)*
