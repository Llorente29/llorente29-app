# Instrucciones de arranque

REGLA CERO: antes de responder cualquier pregunta técnica, lee SIEMPRE CONTEXTO_CLAUDE.md (estado actual, decisiones, roadmap y deudas del proyecto Folvy).

## Reglas de trabajo

> W12 (29/10): todas las reglas de trabajo en un solo sitio y en orden, con
> número propio (T1…T13) para no confundirlas con las «ganadas en producción». Las que
> una máquina puede comprobar se comprueban solas y salen en rojo con un mensaje
> que dice qué ha pasado, dónde y qué hacer; al lado de cada una, quién la
> comprueba. Las que no, se quedan escritas aquí y se dice por qué.

### Cómo se trabaja un encargo

T1. **El alcance se cierra al recibir el encargo.** Lo que surja mientras se
   trabaja se apunta para el siguiente encargo y **no entra en el PR en
   marcha**, aunque lo pida un mensaje posterior. *(Julio, 23/10.)*
T2. **Sin agentes en paralelo**, salvo que el encargo lo diga expresamente.
T3. **Siempre en español**, también las notas entre paso y paso y lo que se
   piensa en voz alta. Nada en inglés, salvo nombres de código.
T4. **Tiempo máximo: el que diga el encargo, o 90 minutos** si no dice nada. Si
   se pasa, se para y se avisa en dos líneas: qué falta y por qué.
   *No lo comprueba una máquina: una sesión no deja rastro de cuándo empezó.*
T5. **Primero en local lo que se pueda:** las pruebas SQL en la base local del
   W09 (`scripts/staging/base-local.sh`) y las unitarias
   (`antes-de-subir.sh`). La e2e va a staging, con la regla T6. Supabase entero
   en local (con su login y su API, que la e2e necesita) llega con la máquina
   propia del W11; hasta entonces no se monta. *No lo comprueba una máquina: lo
   que pasa en local no deja rastro en GitHub.*
T6. **Un solo push a staging por paso.** Si la e2e de una rama sale en rojo dos
   veces seguidas, la sesión para y avisa a Julio con los dos enlaces: no hay un
   tercer intento. Las pruebas de la zona, una vez y al final, sobre el commit
   definitivo; no se relanzan por cada commit intermedio.
   *Lo comprueba* `e2e-staging-conta.yml` *(job plan,* `scripts/e2e/dos-rojas.mjs`*):
   la tercera e2e de push no corre. La desbloquea una e2e en verde lanzada a mano
   por Julio.*
   *Si la e2e de un push necesita lo que añade la tanda de la rama,* empuja
   primero la base sola (no lanza e2e), lanza su «Aplicar SQL en staging» y
   después empuja el resto: con la regla T9 la prueba de staging espera a la e2e,
   y una e2e sin su base sale en rojo.
T7. **Cada sesión vigila sus propias ejecuciones** (e2e, ensayo, staging,
   Vercel) hasta el final y da el resultado con su enlace. *(W12, 29/10:
   sustituye a «abrir o actualizar un PR acaba el turno», del 26/10.)* *No lo
   comprueba una máquina: es lo que hace la sesión después de lanzar.*
T8. **Merge, nunca rebase**, en las ramas de los PR: para traer `main`,
   `git merge origin/main` y un push normal; nunca un push forzado. Reiniciar
   una rama cuyo PR ya se fusionó es empezar otra desde `main` con un PR nuevo.
   *Lo comprueba* `pr-a-main.yml` *(*`scripts/ci/sin-rebase.mjs`*): en cada
   push al PR, el commit de antes tiene que seguir en la historia del nuevo.*
   *(Del 17 al 29/10 se reescribieron 3 ramas: l1a-fichar-en-el-servidor,
   i01c-trimestre y p01-despacho.)*
T9. **Nunca una e2e de staging y un ensayo a la vez en la misma rama.** El
   ensayo de producción (de la rama que nombra) y la prueba de staging (el
   «Aplicar SQL en staging» desde una rama) esperan a que acabe la e2e de su rama, como mucho 45
   minutos; si se pasa, en rojo. Entre ramas distintas no hay cerrojo (W04).
   *Lo comprueban* `aplicar-produccion-conta.yml` *y* `aplicar-staging-conta.yml`
   *(job espera-e2e,* `scripts/ci/esperar-e2e.mjs`*), antes de su cola.*
   *(Del 17 al 29/10, 6 de 112 ensayos corrieron con la e2e de su rama en
   marcha; el 29/10 el 180 se interbloqueó por esto.)*
T10. **El real en producción lo lanza siempre Julio**, nunca una sesión. La
    sesión propone (SQL transaccional y revisable, con su ensayo en verde) y
    Julio ejecuta y verifica. *Lo comprueban los entornos de GitHub (W12b,
    30/10): los secretos de producción viven en cuatro entornos que solo
    admiten ejecuciones de* `main`*: «produccion» (el real y la vuelta atrás,
    con la aprobación de Julio), «produccion-ensayo» (el ensayo), «lectura»
    (*`conta_lectura`*) y «despliegue» (el token de Supabase y la clave de
    servicio). Un workflow de una rama no los recibe, sea el de antes o uno
    cambiado. Lo vigila* `tests/unit/ci/reglasSolas.test.ts`*: ningún job usa
    un secreto de producción sin su entorno. Mirar quién lanza no vale: las
    sesiones lanzan con la autorización de Julio (los 40 runs del 27 al 29/10
    salen todos a nombre de «Llorente29»).*
    *(29/10: el real 318 se lanzó desde* `claude/w10a-cierre`*, que tenía el
    workflow de antes del W12, y pasó sin aprobación.)*
T11. **Ningún dato personal real en el repositorio:** ni DNI o NIE, ni NAF, ni
    IBAN, ni nombres de personas, en código, fixtures, pruebas, semillas,
    commits, descripciones de PR o capturas. El repositorio es público. Los
    inventados se ven inventados (todo ceros, 12345678…; un IBAN del banco
    9999), o van a `scripts/ci/datos-inventados.txt` con su porqué, comprobados
    antes contra producción. Los secretos los vigila `sin-secretos.mjs`.
    *Lo comprueba* `pr-a-main.yml` *(*`scripts/ci/datos-personales.mjs`*): DNI,
    NIE, NAF e IBAN con su dígito de control, en lo que añade el PR, sus
    commits y su descripción. Los nombres de personas y lo que sale dentro de una
    captura no los puede ver una máquina: se miran a mano antes de subir.*
    *(29/10: el NIE y el nombre de un rider de Foodint estaban en
    `tests/conta/diez/texto.test.ts` y en la descripción del #298; se cambiaron
    por inventados. Siguen en la historia de git, y el nombre en el comentario
    de la migración ya aplicada `20261208T0820`: **pendiente para el W11**, que
    deja de estar a la vista cuando el repositorio pase a privado. Reescribir
    `main` con tantas ramas y sesiones vivas rompe más de lo que protege.)*
T12. **Los tiempos de las e2e, uno por prueba:** `tests/e2e/tiempos/<ruta>.json`
    (LEEME en esa carpeta). Dos PR que añaden un tiempo ya no tocan el mismo
    fichero. *Lo comprueba* `tests/unit/e2e/tiemposNuevos.test.ts`*: si vuelve
    el* `tests/e2e/tiempos.json` *único, en rojo.*
T13. **«Funciones a desplegar a mano»: «ninguna» vale solo para su grupo**
    (`### Sumied` / `### Folvy`). *Lo comprueba* `scripts/pr/funcionesADesplegar.mjs`
    *en* `pr-a-main.yml`. *(El #390: un «ninguna» bajo «### Folvy» vaciaba también
    la de Sumied.)*

### Cómo se escribe el código

- Archivos completos, no diffs. Pedir el fichero original antes de modificarlo.
- No tocar `App.tsx` ni `AppContext.tsx` sin permiso explícito.
- La BBDD es la verdad: verificar vía `information_schema` antes de decisiones de schema.
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

### La banda de servicio: ya no es una hora, es lo que hace cada fichero

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de
> Julio (W01, 08/10), escrita aquí en la respuesta 4 del C04. Sustituye a la
> franja de las 12:15–00:30, que queda abajo como historia.

> **Publicar el FRONT no espera a ninguna hora** (13/09): las tablets se
> defienden solas — descargan cuando toca y aplican solo dentro de la ventana
> de su local y con la cocina en calma.

**A la BASE se aplica a cualquier hora, con los negocios abiertos.** Lo que
decide no es el reloj sino lo que hace cada fichero, y eso lo clasifica
`scripts/conta/produccion/analizar.mjs` contra lo que existe en producción,
no lo opina nadie:

1. **Añadir** (tabla, columna que admite nulos, función o vista nuevas,
   índice nuevo sobre una tabla pequeña o fuera del camino): **pasa siempre**.
2. **Cambiar en caliente** (reemplazar una función con la misma firma, una
   vista, un `CHECK` que solo amplía): pasa si el fichero lo **declara en su
   cabecera** —`-- cambia: <objeto> · prueba: supabase/staging/sql/<f>.sql`— y
   esa prueba de staging existe y nombra el objeto. Si el objeto está en el
   camino del pedido, además con **`autorizo`**.
3. **Destruir o mover** (borrar o renombrar, `update`/`delete` sobre lo que
   existe, cambiar un tipo —también ampliarlo, de momento—, hacer obligatoria
   una columna, índice sin `concurrently` en tabla grande o del camino): solo
   con **`autorizo`**, el nombre entero del fichero. Borrar o renombrar va
   **en dos pasos**: primero el front deja de leerlo y se publica
   (`antes-de-subir.sh` lo mide contra `origin/main` y contra el commit), y en
   otra tanda se quita de la base.
4. **Después, siempre la comprobación**, sin excepción: D1, recuento, los
   agentes antes y después con `conta_lectura`, y la **salud del pedido de
   todas las cuentas** (las que tienen 3 o más pedidos en los 15 minutos de
   antes, sumadas: tiene que haber al menos un cambio de estado en los 15 de
   después). **Si falla, vuelta atrás automática** (`deshacer.sh`) de lo que
   aplicó ese run, en orden inverso, y el parte lo dice.

Y las dos de siempre, que no cambian: el **ensayo** (todo en una transacción
que acaba en `rollback`, con el registro dentro) antes del real, y el
**historial** —cada fichero aplicado queda en
`supabase_migrations.schema_migrations` con su huella md5, en la misma
transacción que el fichero—. Un fichero sin registrar cuyo contenido ya existe
**para** («parece aplicado»): por eso el 08/10 se dieron de alta los 58
aplicados antes del W01 (`20261012T0100_c04r_historial.sql`).

*Detector automático:* si alguien escribe «espero a las 00:30» para aplicar
algo, la pregunta es qué dice el analizador de ese fichero. Si dice «sigue»,
no hay nada que esperar; si dice «autorizo», lo que falta es el nombre en el
campo, no la noche. Y si alguien escribe «ya está aplicado» sin el registro en
el historial con su huella, no está aplicado: está ejecutado.

*Lo que queda apuntado y no está hecho:* `create index concurrently` necesita
ir fuera de transacción y el workflow aplica cada fichero dentro de una (se
hará cuando haga falta el primero); y «ampliar el tipo de una columna» cuenta
como destruir, más estricto de lo que pide la regla, hasta que un caso real
diga cómo afinarlo.

*Por qué se dejó la franja (W01, 08/10):* la franja protegía el camino del
pedido esperando a que no hubiera pedidos, y obligaba a medir a mano tres
cosas cada vez (`pg_proc`, `cron.job`, `pg_trigger`) para decidir si una
excepción valía. Lo que protege de verdad es saber qué hace cada fichero y
mirar, después de aplicarlo, que los pedidos siguen avanzando — y deshacer
solo si no. La franja paró el C04 una noche por un `sales_day_summary` que no
tocaba ningún pedido vivo.

*La franja de antes, para que se entienda la historia (13/09–08/10):* entre
las 12:15 y las 00:30 (reloj de la base) no se aplicaba nada salvo que no
estuviera en el camino del pedido, no tomara cierre exclusivo sobre una tabla
del camino y se dijera antes. Acababa a las 00:30 porque en 30 días (26/08–
24/09) el pedido más tardío entró a las 23:59 y 0 de 30 días tuvieron alguno
después de las 00:15.

### Una tanda se ensaya y se aplica antes de fusionar, desde main nombrando su rama

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> S01d (18/10); **desde el W12b (30/10), se lanza desde `main`**.

El ensayo y el real de la tanda de un PR se hacen **antes de fusionarlo**, no
después. Así, cuando el front llega a producción con la fusión, lo que lee ya
está en la base.

**Se lanzan desde `main`**, con la rama en «rama» y su último commit en
«commit» (el workflow para si no es el último). Los guiones, el análisis y la
transacción son los de `main`; de la rama solo se traen datos (`supabase/`,
`src/` y las cuentas). El commit va en el nombre del run, y el real busca un
ensayo en verde lanzado desde `main` con ese mismo nombre. Lo mismo para
desplegar funciones en staging (`desplegar-funciones-staging-conta.yml`).
El analizador para cualquier línea que empiece por `\` en lo que se ejecuta:
un `\connect` se saltaría el ROLLBACK del ensayo.

*(18/10. La tanda del S01d —0160 y 0170— se aplicó desde `conta/s01d-tanda`,
con el ensayo y el real en verde, y #236 se fusionó después.)*

### Una tanda por rama: dos PR con tanda no comparten ningún fichero

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> C10 (23/10). Sustituye al `aplicar.txt` único.

- **Cada rama tiene su tanda, en su carpeta**, y nadie más la edita:
  `supabase/produccion/tandas/<producto>/<rama>/` con `aplicar.txt`,
  `vuelta-atras.txt` y `contexto.json`. `<producto>` es `sumied`
  (contabilidad) o `folvy` (el resto); `<rama>`, su nombre con «/» cambiada por
  «-» (`node scripts/conta/produccion/tanda.mjs slug <rama>` lo da).
- **Lo de staging, igual**: `supabase/staging/tandas/<producto>/<rama>.txt`. El
  `supabase/staging/aplicar.txt` de antes queda **cerrado**, con lo de antes
  dentro: se lee junto a los de las ramas como un solo manifiesto.
- **El workflow aplica la tanda de la rama desde la que se lanza.** Para lanzar
  desde `main` una ya fusionada, se nombra en el campo `tanda`. La que estaba
  viva el día del C10 es `sumied/heredada` (la termina el #299, y solo él).
- **Al fusionar, la carpeta se queda en `main` tal cual: ése es su archivo.**
  No hay nada que copiar ni que vaciar.
- **Lo vigila `pr-a-main.yml`** (`tanda.mjs ajenos`): un PR que edita la tanda
  de otra rama, o uno de los manifiestos únicos de antes, no pasa.

*Detector automático:* si dos PR abiertos tocan el mismo fichero de
`supabase/produccion` o de `supabase/staging` que no sea una migración, uno de
los dos está escribiendo en la tanda del otro.

*(23/10. El #301 se fusionó con el `aplicar.txt` único y dejó sin manifiesto a
la D07 del #300; hubo que devolverlo con el #303.)*

### El nombre de una migración

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> C10 (23/10). **Sustituye a la del W02 (17/10)**, «el siguiente por encima del
> más alto».

`AAAAMMDDTHHMM_<sesión>_<qué>.sql`: la fecha, la hora y el minuto de cuando se
escribe, la sesión en minúscula (`c10`, `d08`…) y qué hace, con «_». Por
ejemplo `20261023T1812_c10_tandas_por_rama.sql`. **Nunca repetido**: ni el
nombre ni su «fecha, hora y sesión» pueden estar ya en `main`, en otro PR
abierto (`pr-a-main.yml`) o en el historial de producción (el aplicar, antes
del ensayo). Si choca, se cambia el minuto. El orden en que se aplican lo
decide el `aplicar.txt` de la tanda.

*Las de antes se quedan como están*, y también las cuatro que ya estaban en PR
abiertos el 23/10 (0850, 0860, 0870 y 0880 de la D07: `ANTIGUAS_ABIERTAS` en
`scripts/conta/produccion/nombres.mjs`).

*(23/10. «El siguiente por encima» lo cogían dos sesiones a la vez: la 0840 la
quisieron el C08 y la D07a el mismo día.)*

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

### Un PR a `main` dice qué funciones hay que desplegar, y nunca salta CI

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> C06, respuesta 5 (14/10).

- **La descripción de todo PR a `main` lleva `## Funciones a desplegar a mano`**
  con las funciones que toca —las carpetas de `supabase/functions` cambiadas y
  **cada función que importa un `_shared` cambiado**, porque
  `deploy-edge-functions` se salta `_shared`—, o «ninguna».
- **El título nunca lleva `[skip ci]`** ni sus hermanas, y **el mensaje de la
  fusión tampoco**: con la marca, el push a `main` no lanza
  `deploy-edge-functions` y lo fusionado queda sin efecto.
- **Y lleva `## Producto`** (N2, 23/10): Sumied, Folvy o Común, uno o varios.
  Lo de Sumied pide «Sumied»; lo de Folvy, «Folvy»; el arranque de la app, lo
  compartido de `src` y **`supabase/functions/_shared`**, «Común», porque
  despliega funciones de los dos. Las migraciones, los workflows y los
  documentos no piden nada: lo dice quien escribe el PR. Las funciones a
  desplegar pueden ir en `### Sumied` (las `conta-*`) y `### Folvy` (el resto),
  cada una en el suyo (`scripts/pr/productoDelPr.mjs`).
- Lo comprueba `pr-a-main.yml` (título y secciones, contra el diff). El mensaje
  que se escribe al fusionar no lo ve: ése lo mira quien fusiona.

*Detector automático:* si un PR toca `supabase/functions/_shared` y su lista
dice «ninguna», falta alguien. La #181 tocó `_shared/diezCliente.ts`:
`conta-diez-enviar` también iba.

*(14/10. La #181 se fusionó con «[skip ci]» en el mensaje: no corrió el
despliegue y las cuatro funciones de la C06 hubo que desplegarlas a mano.)*

### Qué pruebas lleva cada PR: la entera, nunca en un PR

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de
> Julio, **26/10**, que sustituye al «criterio por riesgo» del W04 (22/10).
> Detalle: `docs/conta/pruebas_de_un_pr.md`.

**La entera no corre en ningún PR, nunca.** Corre solo de noche sobre `main`,
y en un PR solo con la etiqueta **`e2e-entera`**, cuando Julio la pide.

| Qué toca el PR | Qué corre en cada push (`scripts/e2e/area.mjs`) |
|---|---|
| **Siempre** | Su **zona** (la carpeta de la rama o la de lo que toca, y el juego común) y **cada `.spec.ts` que cambia el PR**. |
| **Lo común** (`LO_COMUN_SUMIED` y `LO_COMUN_AMBOS`: el marco, el menú, `module.tsx`, el diseño, el arranque, `package.json`…) | Además, **la rápida de pantallas** (`tests/e2e/conta/humo/pantallas.spec.ts`): cada pantalla de Sumied una vez, en ordenador y en móvil, como mucho 10 min. |
| **Pedidos, cocina o reparto** (`PEDIDOS`) | Además, **la corta** (91 s). |
| **Con tanda** | Además, la prueba de staging en ROLLBACK de cada «cambia», el **ensayo** y el **real** en producción con su comprobación y su deshacer (W01). |

- **Un fallo por TIEMPO en una prueba que no es de la zona del PR** (el juego
  común, la rápida) **no bloquea fusionar**: se apunta como aviso en el run y
  lo mira la de la noche (`scripts/e2e/por-fichero.sh`).
  - En la zona, todo fallo bloquea.
  - Un fallo que ve otra cosa (un texto que no cuadra, un error de la página)
    bloquea siempre.
  - A mano y de noche, todo bloquea.
- **Fichero a fichero** (#340): cada fichero coge la barrera de staging solo
  mientras corre. Así una aplicación a staging entra entre dos ficheros y nunca
  en mitad de uno.
- **Las unitarias, también en la CI** (N1, 23/10): `unitarias.yml` corre en
  cada PR a `main` las del producto que toca (`scripts/pruebas/unitarias.mjs`).
  En local, `antes-de-subir.sh` las sigue corriendo enteras.
- **Y cada noche sobre `main`**, a las 03:00 de Madrid, la entera en 2 trozos.
  - Si falla por staging (no poder entrar, un 520, una página HTML de la base),
    la repite una vez.
  - Si no es por staging, o si vuelve a fallar, abre la incidencia «e2e de la
    noche en rojo» (`scripts/e2e/noche.mjs`).
- **La entera lanzada a mano va siempre en 2 trozos**, también con una carpeta
  («tests/e2e/conta»). En un trozo solo van los ficheros sueltos.

*(26/10. La entera corría en casi todos los PR, porque tocar el menú o
`module.tsx` cuenta como lo común: 74 min la del #339, que con la regla nueva
son unos 8 min de pruebas, 12–13 de reloj. Las 5 que cayeron por tiempo esa mañana salieron
en verde con staging tranquilo. Antes, el 22/10: el #281 y el C07 se llevaron
275 y más de 225 min de máquina.)*

### Staging recibe de verdad solo lo que está en producción

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> W04 (22/10).

- **Desde una rama**, `aplicar-staging-conta.yml` pasa solo lo que la rama
  añade al manifiesto (desde el C10, su `supabase/staging/tandas/<producto>/<rama>.txt`) contra `main`, en **una
  transacción que acaba en ROLLBACK**: staging no cambia. Sin el cerrojo
  exclusivo: una prueba que no deja nada no para las e2e.
- **Desde `main`** (después del real de la tanda, que se fusiona en verde)
  aplica **de verdad** lo que el push añade al manifiesto, fichero a fichero,
  con el cerrojo. Así staging es como producción por construcción, y la
  comprobación de W03 (17 funciones con su md5) ya no hace falta.
- Un fichero de una rama con `commit` fuera de sitio, o con un `rollback` que
  no sea su última sentencia, **para** el run: dejaría cosas de verdad.
- **Lo que solo añade va de verdad desde la rama** (W05, 22/10): una migración
  cuya clase es «añade» contra lo que hay en staging —columna que admite nulos,
  tabla o función nuevas, y un CHECK que solo mira columnas que añade el mismo
  fichero— se aplica de verdad después del ensayo, con el cerrojo, **si se
  puede pasar dos veces seguidas** (`if not exists`, `create or replace`):
  `main` la volverá a pasar al fusionar. Lo que cambia o destruye algo, solo en
  ROLLBACK. La clase la da el analizador de la tanda
  (`scripts/conta/staging-tanda.mjs anaden`), con el contexto medido en staging.
  *Por qué no rompe lo de esta mañana:* añadir no cambia nada de lo que leen
  las demás ramas; lo que rompió el 22/10 fue un «cambia en caliente».

*(22/10. Aplicar el C07 de verdad desde su rama dejó `conta_resumen_ventas`
distinta de producción: el «aplicar» del #281 cayó en W03 y la prueba del I01f
en otra rama, y hubo que devolver staging a mano.)*

### Un e2e lo cancela solo un commit más nuevo de su rama

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> C05, respuesta 3 (08/10), **cambiada en el W02 (17/10) por el gasto de
> Actions**: antes decía «un e2e en marcha no se cancela».

En `e2e-staging-conta.yml`, el push y la entera de una rama van en **una sola
cola** (sin `event_name` en el grupo), y:

- **un push nuevo cancela** la e2e que corre en su rama —la del push anterior o
  una entera—: es de un commit que ya no es el último, y la nueva prueba lo
  mismo y algo más (`cancel-in-progress` solo es `true` para `push`);
- **una e2e lanzada a mano no cancela nada**: espera a que acabe la que corre.
- Una entera vale solo sobre el **commit final**: si después llega un push, es
  de un commit que ya no es el último.

*Detector automático:* si vas a lanzar la entera y aún tienes algo por
empujar, empújalo antes: lanzarla y empujar después es tirar sus minutos.

*(08/10. El 149 canceló el e2e 148, que perdió su resultado: de ahí la regla
de antes. 16/10: las e2e gastaron 2.953 min de Actions en un día, frente a unos
250 de un día normal, con cada push esperando a correr la suite entera de un
commit ya superado. Se acepta perder el informe de un commit viejo a cambio de
no pagarlo.)*

### Capturas: fuera del PR, en `capturas/<rama>`, y a `main` al fusionar

> Sin número: la acuña `folvy_deudas_abiertas.md` cuando toque. Regla de Julio,
> 15/10, después del choque del #194; cambiada en el W04 (22/10) y **otra vez
> en el W08b (28/10, opción A)**: el bot ya no hace commits en la rama del PR, y
> las capturas dejan de salir en «Files changed».

- **En cada e2e, las capturas van como artefacto del run.**
  `e2e-staging-conta.yml` deja en el artefacto «capturas» las que ha sacado
  ESE run.
- **La e2e de cada push que sale en verde publica las de tu frente en una rama
  aparte, `capturas/<rama>`**: solo la carpeta del frente de la rama —A `d01`,
  B `b01`, C `c00`…`c06c`, reparto `docs/reparto/capturas`, inventario y marcas
  por lo que la rama ES (W08)— en un solo commit sin historia, que el bot
  reescribe en cada run. **La rama del PR no cambia**: ni «Action required» ni
  `git pull` antes del siguiente push. A mano, `publicar_capturas` (y `frente`
  para forzar de quién son).
- **El PR las enseña en un comentario** (uno solo, que se va editando): el
  enlace al artefacto y las publicadas en miniatura, por tablero, enlazadas a
  su PNG.
- **Al fusionar el PR, pasan a `main`** en su carpeta de siempre
  (`capturas-al-cerrar.yml`): un commit «Capturas en producción · #N» con solo
  esos PNG, encima de la `main` más nueva. Lo empuja el token del workflow, que
  no lanza otros workflows, y **Vercel no lo despliega**
  (`scripts/vercel/saltar-build.mjs`, el `ignoreCommand` de `vercel.json`): la
  producción sigue siendo el despliegue de la fusión, y ése es el que tiene que
  decir READY. **Al fusionar o cerrar el PR, `capturas/<rama>` se borra.**
- **Una rama sin frente no publica nada**, y el run no se pone en rojo por eso
  (C10, 23/10): el paso lo dice y se salta.
- **Tu rama no lleva capturas de otro frente.** `antes-de-subir.sh` (paso 10) y
  `pr-a-main.yml` (W08) paran si las trae, nombrando cada PNG, y dicen cómo
  devolverlas a las de `main`.
- `cierre/`, `compras/` y `diez/` no son de ningún frente de hoy: no las
  publica nadie.
- El reparto vive en `scripts/conta/capturas.mjs`, y una prueba lo compara con
  el paso «Frente» del workflow, rama a rama.

*Detector automático:* si la rama de un PR trae un PNG distinto de `main`, algo
lo ha metido a mano: las capturas viven en `capturas/<rama>`, no en el PR.

*(15/10. Cada e2e en verde commiteaba todas sus capturas, también las de otros
frentes, y un PNG cambia unos bytes en cada pasada. El #194 chocó con `main` en
12 PNG de `b01` y `c00`; sus commits de capturas habían tocado 14 carpetas, entre
ellas `b01`, `d01` y `r02`. Desde el 01/10 entraron en `main` 60 commits de
capturas con 2.489 cambios de PNG. 28/10: aun con solo las del frente, cada
commit del bot en la rama del PR dejaba sus comprobaciones en «Action
required», y tres PR de Laboral entraron con PNG de inventario; el #370 chocó
con `main` en dos.)*

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
