# C06 · Contabilidad sola — tareas 2, 3 y 4 (parada antes de la 5)

Rama `conta/c06-sola`. Lo que pidió la respuesta 1: tareas 2, 3 y 4 sin parar
y capturas de la cuenta del frente C en staging con `?marca=`. Nada en
producción.

## Qué hay

### Tarea 2 · La marca

- **Un único sitio:** `supabase/functions/_shared/marcas.ts`. Lo leen las dos
  mitades: el front (`src/marca/marca.ts`) y las funciones (`send-email`,
  `conta-crear-cuenta`, `conta-contrasena`).
  - Cada marca lleva nombre, inicial y color del logo, dominios, dirección
    visible, icono y manifiesto, remitente y responder-a, logo del correo,
    textos legales y los textos de la entrada N18.
- **Dos marcas:**
  - `folvy`, la de siempre.
  - `contabilidad`, la genérica de pruebas: sin dominio y sin remitente.
    Aviso legal y privacidad quedan como **hueco** (null): la pantalla enseña
    «Aviso legal · Privacidad» sin enlace y, al pasar por encima, «Aún no
    publicado». Los textos los redacta Julio.
- **Con qué marca se enseña** (`resolverMarca`, puro y con pruebas):
  1. El dominio de una marca manda siempre.
  2. En producción (`*.folvy.app`, `folvy-app.vercel.app` o el dominio de una
     marca), `?marca=` no hace nada.
  3. Fuera de producción, `?marca=contabilidad` la fuerza y se recuerda en la
     sesión del navegador; `?marca=folvy` la olvida.
  - `shopHost.ts` no se toca.
- **La pestaña:** título, icono, manifiesto y nombre de la aplicación
  instalada, antes de pintar nada (`aplicarMarcaAlDocumento`, en `main.tsx`).
- **Contabilidad deja de escribir «Folvy» a mano:**
  - Las 91 líneas visibles piden el nombre a `src/modules/conta/cuenta/marca.ts`.
    Es la segunda pieza del contrato con lo de fuera, con ruta relativa porque
    los scripts compilan los núcleos sin `@/`.
  - Una prueba (`marcaC06.test.ts`) barre `src/modules/conta` y falla si
    aparece un «Folvy» que no esté en su lista. En la lista solo quedan los
    que se dicen únicamente con Folvy (detrás de `CON_MARCA`, de `MARCA.id` o
    de `!solo`), la firma que se guarda en la base y la regla que la lee.
- **«Hecho por Folvy» pasa a un campo.**
  - La lógica pregunta por `validadoAutomatico`, no por el texto.
  - Ese campo se calcula en **un** sitio, `lib/autor.ts`, al leer la fila: es
    automático lo que firmó un escritor automático. Las firmas medidas en
    producción el 13/10, en solo lectura, son «Folvy (cierre del día)»,
    «Folvy (validación automática de ventas)», «Folvy · corte con Diez (C04 R4)»
    y «Folvy».
  - Con la marca, el autor dice **«automático»**. Con Folvy se ve lo de siempre.
  - Lo guardado se queda como está y se lee igual: hay prueba con las firmas
    reales.
  - Ojo: la base aún no tiene una columna que lo diga. Para que el campo se
    *guarde* hay que tocar `journal_entry_validar` y `_journal_entry_proponer`,
    que son del frente A. Se hace cuando A haya fusionado (pendiente 1).
- **Los errores de la base** que dicen «…en Folvy» se cambian por la marca en
  `errorBase.ts`, por donde pasan todos los errores del módulo. Las funciones
  no se tocan.
- **Pantallas compartidas que ve el cliente:**
  - Las tres pantallas de carga de `App.tsx` (permiso de la respuesta 1: solo
    eso, `{MARCA.nombre}`, tres líneas y una importación).
  - `RootErrorBoundary`, `AccountStatusGate`, `UpdateGate` y `AvisoNuevaVersion`.
  - `Logo` (con marca, el cuadrado con la inicial y el nombre).
  - El pie y los textos de la bienvenida y de las dos pantallas de contraseña.
- **Producto vendido solo** (con marca, o en una cuenta solo de contabilidad):
  - El menú sin «aún no»: fuera Ventas («Aún no.») y las entradas de Ajustes
    que dicen «todavía no».
  - Su Inicio.
  - Sin «Volver a Folvy».
  - Sin la barra de la IA (respuesta 1, 7).
  - La ficha del proveedor se abre dentro de contabilidad
    (`clientes-y-proveedores/proveedor/:id`). Hoy solo estaba montada en
    Cocina: en el producto solo, abrir un proveedor habría sacado al cliente
    de contabilidad.
  - «Subir factura» va a Compras de contabilidad, no a `/supply/facturas`.
  - **Con Folvy, todo igual:** las mismas entradas, la misma ficha en Cocina y
    el mismo «Volver a Folvy». Lo mide `marcoC00.test.ts`.

### Tarea 3 · Alta, invitación y entrada

- **Migración `20261111T0100_c06_cuenta_sola.sql`.** El analizador, pasado en
  local contra el contexto de producción leído en solo lectura, dice
  **sigue**: todo «cambia» va declarado y con su prueba, no toca el camino del
  pedido y no pide `autorizo`. Lo que hace:
  - `accounts.product_brand`, con la marca de una cuenta solo de contabilidad;
    null en todas las de hoy.
  - `feature_flags.grant_reason`.
  - `business_type` admite `otra_actividad` («Otra actividad»); solo amplía.
  - Los **seis disparadores de siembra** de `accounts` no siembran en una cuenta
    con `product_brand`: cursos, APPCC, familias de ingredientes, cargos,
    gestoría y vacaciones. Medidos en producción el 13/10: no eran solo los
    de `onboard_account`. Misma firma; el cuerpo, copiado de producción.
  - `conta_crear_cuenta_sola` (solo `service_role`): crea la cuenta sin local,
    marca, canales, familias, ingredientes ni almacén. Pone el perfil del
    administrador con `gerente_total` y `conta` con `granted_by` y el motivo.
    Deja el apunte `account_created` en `platform_audit_log`: quién y cuándo.
  - `conta_contrasena_de_marca` (solo `service_role`), para la contraseña
    olvidada con marca.
  - Vuelta atrás: `supabase/vuelta-atras/20261111T0100_c06_cuenta_sola.down.sql`.
    Para si ya hay cuentas con `otra_actividad`, en vez de reescribirles el tipo.
- **Prueba de staging** (`supabase/staging/sql/20261111_c06_cuenta_sola_prueba.sql`),
  en verde en el run 168:
  - Una cuenta sola solo tiene filas en `feature_flags=1` y `user_profiles=1`,
    contando **todas** las tablas de `public` con `account_id`.
  - Una cuenta de siempre sigue sembrándose: en staging,
    `account_gestoria_config=1`, `staff_role=6` y `vacation_settings=1`.
    APPCC, familias y cursos no siembran en staging porque no tiene sus datos
    de origen.
  - Las puertas, el interruptor con quién y por qué, el registro, «otra
    actividad», lo que lee el cliente y la contraseña con marca.
- **Dos cosas que staging enseñó:**
  - **staging-conta no tiene `permission_sets`.** La función asigna
    `gerente_total` solo si la tabla existe; en producción es obligatorio.
  - Una cuenta creada con un usuario puesto en la sesión la rechaza
    `adopt_mandatory_courses`. Era cosa de la prueba, no de la función.
- **Edge functions** (declaradas en `config.toml`):
  - **`conta-crear-cuenta`:**
    - Comprueba que quien llama es administrador **activo** de la plataforma,
      mirando `platform_admins`, no un claim (staging no tiene el hook).
    - En producción, una marca sin dominio se para **antes** de crear nada:
      el cliente vería app.folvy.app.
    - Crea el usuario, la cuenta y la invitación con la marca.
    - Si la invitación no sale, lo dice con su porqué. Fuera de producción,
      además, enseña el enlace.
  - **`conta-contrasena`:**
    - «He olvidado la contraseña» con la marca.
    - Responde siempre lo mismo, exista o no el correo.
    - Solo manda a personas de una cuenta de **esa** marca, y como mucho uno
      por minuto.
  - **`send-email`:**
    - Acepta `marca`. Sin marca, **lo mismo que antes**, probado en
      `correoC06.test.ts`: mismo remitente y mismo JSON a Resend, con las
      mismas claves en el mismo orden.
    - `templates.ts` no se toca: md5 `740c703305b0e9824fe62bb56dc046f8` en
      `origin/main` y en la rama.
    - Con una marca sin remitente, **no manda** y dice por qué. Nunca sale un
      correo de la marca desde la dirección de Folvy.
- **Correos de autenticación con marca** (respuesta 1, 2):
  - **Invitación:** con marca.
  - **Contraseña olvidada:** con marca, por `conta-contrasena`.
    - Con Folvy, la pantalla sigue llamando a `resetPasswordForEmail`, y
      Foodint y las demás cuentas reciben exactamente lo mismo que hoy.
    - No he podido comparar texto con texto: la plantilla vive en el panel
      de Supabase y no está en el repositorio.
  - **«Confirmación»:** hoy no se manda ningún correo de confirmación. Las
    cuentas se crean con `email_confirm: true` y nadie se registra solo, así
    que no hay nada que pasar a la marca. Si querías un aviso de «contraseña
    cambiada», es nuevo: pregunta 3.
  - **Página de contraseña nueva:** `ResetPasswordConfirmPage` canjea
    también `?token_hash=`, como ya hacía la bienvenida. El camino de `?code=`
    no cambia.
- **Entrada N18:** `src/marca/EntrarMarca.tsx`, fiel a la maqueta, con la misma
  lógica que `LoginPage`. «He olvidado la contraseña» se queda en la misma
  pantalla y confirma lo que ha hecho. En el móvil, una columna.
- **Panel:**
  - «+ Solo contabilidad» en Cuentas lleva a `NuevaCuentaContaPage`, con
    empresa, correo, nombre opcional, marca y por qué.
  - Al acabar confirma con contenido: qué se creó, si salió la invitación y,
    si no, por qué.
- **Maqueta del correo de invitación (N19), para que la veas antes de fijarla:**
  `docs/conta/maquetas/c06/N19Invitacion.png`, y `-movil.png`.
  - Una sola acción: «Entrar en tu contabilidad».
  - Estilo nuevo: tinta #0E1A2B, azul #2F5BFF y el cuadrado de la marca.
  - Con la marca genérica «Contabilidad», la frase queda rara («…ya está en
    Contabilidad»). Con el nombre de verdad se lee bien.

### Tarea 4 · Menú e Inicio

- **Inicio** (`src/modules/conta/inicio/InicioPage.tsx`, «Estilo nuevo · Inicio»),
  con las cifras que hoy se pueden calcular de verdad:
  - Saludo con su nombre, el día y «cerrada hasta <mes>» si hay meses cerrados.
  - Mes que se mira y «+ Añadir»: subir una factura, un asiento a mano, un
    cliente o un proveedor.
  - Cuatro tarjetas del **libro**, con seis meses en barritas:
    - en el banco (572);
    - te deben (43/44);
    - debes (40/41), con el próximo pago de las facturas de proveedor;
    - IVA del trimestre (477 − 472, sin la liquidación).
  - «Solo necesito que me digas esto»: las sugerencias abiertas de la IA (se
    contestan ahí y confirman), los papeles de compras por mirar y los asientos
    por revisar.
  - «Lo que he hecho yo desde ayer»: asientos validados solos, propuestos y
    datos de la empresa puestos por la IA.
  - «Cerrar <mes anterior>», con los pasos del Libro diario.
  - Sin empresa, al alta conversada: es donde aterriza el cliente la primera vez.
- **Lo que la maqueta trae y NO se enseña, porque aún no existe:**
  - los avatares (no hay «Personas y asesor»);
  - «se presenta el 20 oct» (no hay calendario de plazos en la serie);
  - «+3.120 € esta semana» del banco (sin movimientos de banco: el cambio es
    del mes, del libro);
  - «2 facturas vencidas» (no hay facturas emitidas, F01);
  - «movimientos del banco casados» y «cobro reclamado» (frente B y F01);
  - «Que lo revise tu asesor».
- **Aterrizaje:** una cuenta solo de contabilidad, o la marca, nunca ve nada
  fuera de `/conta`.
  - El Shell manda todo a `/conta/inicio`, también el `/<slug>/personal` de
    `check-account-status`, que no se toca.
  - Las demás cuentas, como hoy: la condición es `product_brand` o la marca;
    sin ninguna de las dos, el Shell es el de antes.
- **El menú, para A y B:**
  - Bancos, Documentos, Pagos y cobros y Facturas que emites ya tienen su
    línea en `MENU_CONTA`, con `ruta: null`. Para que aparezcan basta **una
    línea**: ponerles su ruta.
  - Si una pantalla aún no funciona sin Cocina, `noEnSolo: true` la esconde
    solo en el producto vendido solo.

## Pruebas

- **Unitarias:** 2.802 en verde. Nuevas:
  - `marcaC06.test.ts` (14): marca, autor, errores y la guarda de «Folvy».
  - `correoC06.test.ts` (10): antes = después del correo, invitación,
    contraseña y pedido del alta.
  - `inicioC06.test.ts` (14).
  - `marcoC00.test.ts` (+1): el menú del producto vendido solo.
- **Lint:**
  - Del módulo: cero.
  - Del repositorio entero, medido a los dos lados: 1.377 problemas (1.076
    errores) en `origin/main` y 1.377 (1.076) en la rama.
- **Tipos de las tres funciones de Deno:** comprobados con `tsc` y una
  declaración de `Deno`, porque aquí no hay `deno`.
- **e2e `tests/e2e/conta/c06/sola.spec.ts`, ordenador y móvil:**
  - la entrada N18 y su contraseña olvidada;
  - Folvy sin marca, igual;
  - el alta con la marca;
  - el recorrido completo: aterrizaje, Inicio, menú, plan, ejercicio, libro,
    libros, balance, PyG, libro registro, fichas, compras y ajustes;
  - la cuenta sola sin marca.
  - En cada pantalla: ni «Folvy» en el texto, el título o las etiquetas, ni
    errores de la página. Resultado: ver «Estado de las e2e».

## Choques con A y B (importante)

- **Las e2e de las tres sesiones se pisan.**
  - Cada ejecución de `e2e-staging-conta.yml` pone una contraseña **al azar**
    a los mismos usuarios de prueba.
  - El grupo de concurrencia es por rama, así que dos ramas a la vez se
    cambian la contraseña la una a la otra a mitad. Salen 400 y 429 al entrar.
  - Pasó en mi run 189 (149 fallos, todos «No se pudo entrar»), con los 186,
    187 y 188 de B. A las 16:39 corrían a la vez A (`conta/d01-recibidas`) y B.
  - No lo he tocado: la contraseña de un solo uso es un freno de seguridad.
    Pregunta 1.
- **Ficheros compartidos que he tocado:**
  - `e2e-staging-conta.yml`: acepta 4 o 6 usuarios, con los dos del C06.
  - `src/config/navegacion.ts`: el menú, como pediste.
  - `src/shell/Shell.tsx`: el aterrizaje.
  - `src/App.tsx`: con permiso.
  - No he tocado `antes-de-subir.sh`, el analizador ni `database.ts`.
- **Prefijos:** las mías son `20261111T…`.

## Estado de las e2e

(Se completa al terminar la ejecución sin otras ramas a la vez.)

## Para el dominio de verdad (informe final; nada de esto está hecho)

Cuando la marca tenga nombre y dominio (la OEPM y la EUIPO las compruebas tú):

1. **`marcas.ts`:** en la marca, `dominios` (p. ej. `app.<dominio>`),
   `direccionVisible`, `remitente` (`<Nombre> <no-reply@<dominio>>`),
   `responderA`, `logoCorreo` y las URLs de `avisoLegal` y `privacidad`
   (textos tuyos). Con eso, en producción, el dominio elige la marca solo y
   `?marca=` sigue sin hacer nada.
2. **Vercel:** añadir el dominio al mismo proyecto (`folvy-app`) y su registro
   DNS. Es el mismo despliegue: la marca la decide el `host`.
3. **Resend:** dar de alta el dominio de envío y sus registros (SPF, DKIM y
   DMARC). Hasta que esté verificado, `send-email` **no manda** con esa marca y
   lo dice: nunca sale desde la dirección de Folvy.
4. **Supabase Auth:** añadir `https://app.<dominio>/**` a las URLs de
   redirección permitidas. Sin eso, el enlace de la invitación y el de la
   contraseña vuelven a la URL del sitio, que es Folvy.
5. **`index.html`:** el título, el icono y `apple-mobile-web-app-title` son
   estáticos y dicen «Folvy». `aplicarMarcaAlDocumento` los cambia antes de
   pintar, así que el usuario no los ve; pero un buscador o la vista previa de
   un enlace (WhatsApp, correo) leen el HTML sin ejecutar nada y dirán
   «Folvy». Con el dominio real, se arregla con una reescritura de Vercel por
   host a un `index` de la marca, o sirviendo esas metas desde una función.
   Hoy no se ve en ningún sitio: la marca no tiene dominio.

## Preguntas

1. **Las e2e se pisan entre ramas.**
   - Te propongo que la contraseña de prueba deje de ser al azar en cada
     ejecución y se **derive del secreto** que ya existe (la misma en todas
     las ejecuciones, enmascarada y nunca en el repositorio). Así tres ramas
     a la vez no se pisan.
   - Es aflojar un freno: solo con tu autorización.
   - La alternativa es un grupo de concurrencia común, pero GitHub tira las
     ejecuciones intermedias en espera de otras ramas.
2. **Las cuatro frases de N18** prometen cosas que hoy no hacen ni el producto
   ni la marca de pruebas: «el banco se casa solo» (frente B), «el IVA de cada
   trimestre listo para presentar» (Impuestos) y «Holded, Sage o A3» (solo
   traemos Diez). Las he dejado tal cual en la configuración, porque son de la
   maqueta. Antes de venderlo hay que cambiarlas o cumplirlas. ¿Las dejo así
   para pruebas?
3. **«Confirmación»:** hoy no se manda ningún correo de confirmación (ver la
   tarea 3). ¿Quieres un aviso de «contraseña cambiada» con la marca?
4. **El correo de invitación (N19):** ¿lo fijo así?
