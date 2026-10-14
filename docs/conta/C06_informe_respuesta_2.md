# C06 · Respuesta 2 — el PR de las e2e, los retoques y la tarea 5 (parada antes de la 6)

Rama `conta/c06-sola` (con `main` traído: C04b dentro). El PR de las e2e va en
su propia rama, `conta/e2e-usuarios-por-frente`, desde `main`. Nada en
producción.

## 1 · E2e que se pisan: el PR a `main`

**PR:** [Llorente29/llorente29-app#179](https://github.com/Llorente29/llorente29-app/pull/179), solo con esto.

Lo que pediste, y lo que hizo falta además porque **no bastaba**:

- **Usuarios propios por frente**, creados por su semilla
  (`supabase/seeds/conta/seed_e2e_frentes_staging.sql`): para A, B y C, un doble
  de cada uno de los cuatro de siempre, con el MISMO perfil copiado columna a
  columna (cuenta, rol, nombre visible). Correos `a.admin.frente-b@…`, ids
  `e2e0000<f>-…`. Aplicada en staging: 12 usuarios, 4 por frente.
- **La cuenta C, una por frente.** Las pruebas del alta borran TODAS las
  empresas de la cuenta C al empezar: compartida, el alta de un frente le
  borraba al otro la suya.
- **El alta en la cuenta A** solo borra las empresas que empezó su propio
  usuario (`created_by`), no todas las sin terminar.
- **La e2e de un frente solo cambia la contraseña de los suyos.** El frente sale
  de la rama, en el workflow (una línea por frente: `conta/d…` → A,
  `conta/b…` → B, `conta/c06…` y `conta/f…` → C). Sin frente, los cuatro de
  siempre. `tests/e2e/conta/sesion.ts` traduce los correos (con su prueba
  unitaria). La contraseña sigue siendo de un solo uso.
- **Limpieza de runs cortados** (`supabase/seeds/conta/e2e_limpieza.sql`), al
  empezar: proveedores «e2e» y empresas «Alta e2e» de las cuentas de prueba con
  **más de 30 minutos**. Por edad y no por frente: nada de más de 30 minutos
  está en uso por ninguna ejecución, así que dos a la vez no se quitan nada.
  Había uno de verdad: «E2E Completo …» del 07/10.

**Lo que medí y no esperaba.** Dos e2e enteras a la vez, frente A y frente B,
ya con usuarios propios (runs 38450475183 y 38450479082): **8 y 4 fallos**.
Las contraseñas ya no se pisaban; se pisaban los **datos**: las cuentas A y B
son las mismas para los tres frentes y el escenario de reparto se vuelve a
sembrar al empezar cada run (`c00/alta` en A, `c02c/traer`, `c03`, `reparto`,
`c02/propuestas`, `c00/alta` salir).

**Lo que añadí: un cerrojo en staging** (`e2e.cerrojo`, una fila). Cada
ejecución prepara a la vez (dependencias, build, navegador), pero lo que toca
staging —contraseñas, limpieza, reparto y pruebas— va de una en una. La otra
espera **dentro de su job**, no en la cola de GitHub (que cancela las
pendientes); se suelta al acabar pase lo que pase, y caduca solo a los 50
minutos si un run muere sin soltarlo. Copiar A y B por frente (toda la siembra
del C00 al C05, con sus ids fijos en las pruebas) era otro encargo.

**El fallo del cerrojo que encontró A** era mío: con `psql -A -t`, el `UPDATE …
RETURNING` imprime «cogido» y detrás «UPDATE 1»; la comparación entera nunca
casaba y el run renovaba el cerrojo cada 30 s durante una hora (mis runs
38457338675 y 38457342932, que cancelé en ese paso, sin ninguna prueba
empezada). Arreglado con `psql -q` y la línea exacta, sacado a
`scripts/e2e/cerrojo.sh` y con su prueba (`tests/unit/e2e/cerrojo.test.ts`):
un `psql` falso que contesta lo mismo que el de verdad; con la comparación de
antes la prueba falla, con la de ahora pasa. Probado también: el tiempo máximo
(caduca a los 50 min; se espera como mucho una hora), que solo se suelta lo
propio, y que se suelta al fallar o cancelar (`always()`; medido al cancelar
38457342932: la fila quedó libre).

**Medido después, con el arreglo** (runs 38464265005 y 38464268465, frentes A y
B lanzados a la vez, enteras): van una detrás de otra por el cerrojo y **pasan
157 en cada una**; fallan solo las 2 de `c01b/flujos` (lo de abajo). Las 10
que fallaban por los datos compartidos, ahora pasan.

**No es de este PR, y va dicho:** `c01b/flujos` «marcar pagada…» falla en
cualquier ejecución, también sola (run 38439583361 de B, 17:33): el 409 dice
«ya está la factura E2E-001 **de este proveedor**», un proveedor recién creado
por la propia prueba. Es la regla de repetidas de A, ya aplicada en staging, que
la prueba de `main` aún no conoce. No son restos de runs cortados.

## 2 · Coordinación con A

- **Ficha del proveedor. La ruta y el montaje son de C, en dos ficheros que A no
  debe tocar:**
  - `src/modules/conta/module.tsx`, las rutas `CONTA.rutas.fichaProveedor` y
    `fichaProveedorApartado` (montan `FichaProveedorPage` en el marco de
    contabilidad);
  - `src/config/navegacion.ts`: `CONTA.rutas.fichaProveedor*`,
    `rutaFichaProveedor`, `rutaListaProveedores`, `rutaSubirFacturaProveedor`
    y `PROVEEDOR_EN_CONTA`.
  - El contenido es de A: `src/modules/conta/proveedor/FichaProveedorPage.tsx`
    y lo que cuelga de ella (la extensión de Cocina solo si la empresa la usa,
    el contacto «Facturación», «Sus facturas se apuntan en»).
- **«Solo contabilidad», el campo que lee A:** `useCuentaConta().soloContabilidad`
  (`src/modules/conta/cuenta/contratoCuenta.ts`, documentado ahí). Lo dice la
  **cuenta** (`accounts.product_brand` no nulo); en SQL, lo mismo. Con él, «Recibe
  la mercancía con Folvy» vale siempre «no» y no se enseña: eso lo pinta A.
  `useProductoSolo()` es para cómo se VE (cuenta también la marca forzada con
  `?marca=` en staging), no para decidir datos.
- **Correo de entrada:** en `marcas.ts`, `dominioEntradaCorreo` (Folvy:
  `entrada.folvy.app`; la marca de pruebas: ninguno) y
  `direccionDeFacturas(marca, empresa)` → `facturas-<empresa>@<dominio>`. El
  `<empresa>` lo decide A (se pasa a minúsculas, sin acentos, letras, cifras y
  guiones). Una marca sin dominio de entrada devuelve `null`: nunca una
  dirección de Folvy.

## 3 · Tus respuestas

1. **Contraseña derivada del secreto:** no (punto 1).
2. **Las frases de N18, ciertas hoy**, mismo sitio y forma:
   - «Tus libros —diario, balance y resultados— en un solo sitio.»
   - «El IVA del trimestre a la vista, con su libro registro.»
   - «Cada mes se cierra con sus pasos, y lo cerrado no se toca.»
   - «Lo que hago yo, lo ves y lo puedes deshacer.»
   Las de la maqueta quedan escritas en `marcas.ts`, cada una con lo que falta
   para volver (facturas recibidas, bancos, impuestos, otros programas). La e2e
   comprueba que no sale ninguna de las que prometen.
3. **Aviso de «contraseña cambiada»**, con la marca y por `send-email`
   (plantilla `contrasena_cambiada_conta`):
   - lo pide la pantalla de contraseña nueva **solo con la marca**; la marca la
     decide el servidor por la cuenta (`product_brand`), no quien llama; solo
     si la contraseña se tocó hace menos de 10 minutos;
   - la pantalla dice a quién se avisó o por qué no salió (regla 8);
   - **Foodint, igual que antes:** sin marca, el camino de siempre, sin llamada
     nueva; las pruebas de `correoC06.test.ts` siguen midiendo el mismo JSON a
     Resend;
   - en staging la marca de pruebas no tiene remitente: el aviso **no sale** y la
     pantalla lo dice. Su maqueta: `docs/conta/maquetas/c06/N20ContrasenaCambiada.png`
     y `-movil.png`.
4. **Correo de invitación:** fijado tal cual (`N19Invitacion`). No cambia nada.
5. **«Más» en la barra del móvil:** en el producto solo, «Más» abre una hoja con
   el menú entero (lo que funciona: Inicio, Compras, Clientes y proveedores,
   Libros y Ajustes). Cuando Por hacer y Bancos tengan ruta, entran solos en la
   barra. Con Folvy, la barra no cambia.
6. **Vista previa del enlace** (WhatsApp, correo):
   - **Cómo:** el build escribe `dist/marcas/<id>/index.html` para cada marca que
     no es Folvy: el mismo index, las mismas piezas de la app, con su título,
     descripción, icono, nombre de la aplicación y `og:`/`twitter:` (imagen
     1200 × 630: `public/marcas/contabilidad/vista-previa.png`). Si `index.html`
     pierde una de esas metas, el build **falla** (como `folvyVersion`).
   - **Vercel:** `vercel.json` sirve ese index con `?marca=contabilidad` **fuera
     de producción** (nunca en `*.folvy.app` ni en `folvy-app.vercel.app`), y lo
     servirá por el dominio de la marca cuando lo tenga. El index de Folvy no
     cambia: `app.folvy.app` y las tiendas, como siempre.
   - **Probado:** la regla de `vercel.json` y el index generado, con pruebas
     unitarias contra los ficheros de verdad; el fichero servido, en la e2e. **En
     Vercel no lo he podido probar:** las vistas previas de las ramas `conta/**`
     fallan a propósito (la guarda `guardaVistaPrevia` exige que vayan contra
     staging-conta y esa configuración no está).
   - **Lo que queda para ti, con el dominio:** en `vercel.json`, una regla por
     host antes de la última: `{"source": "/(.*)", "has": [{"type": "host",
     "value": "app.<dominio>"}], "destination": "/marcas/<id>/index.html"}` (la
     prueba unitaria la exige en cuanto la marca tenga `dominios`). Y comprobarlo
     pegando el enlace en WhatsApp. Ojo: si el despliegue tiene protección de
     Vercel, WhatsApp no ve nada.

## 4 · Tarea 5 · Traer de Diez para otra empresa

`main` traído (C04b dentro). El freno, como lo autorizaste:

- **Una base por empresa, en una tabla con registro, escrita solo por Folvy**
  (`20261111T0200_c06_diez_base.sql`, el analizador dice **sigue**):
  - `conta_diez_base`: una por empresa y una empresa por base. La leen los
    miembros de la cuenta; nadie la escribe desde la app (sin política de
    escritura y sin permisos para `anon`/`authenticated`). La única puerta es
    `conta_diez_base_poner` (solo `service_role`).
  - `conta_diez_base_registro`: alta, cambio y baja, con quién, por qué, antes y
    después (lo escribe un disparador).
  - Foodint queda registrada con su C0008 (solo si existe; en staging no).
- **C0001 vetada siempre:** en la tabla (check), en la función, en el workflow y
  en el cliente (aunque se la pasaran como registrada).
- **El cliente** (`diezCliente.ts`) habla con C0008, C0009 y **la base que la
  tabla tiene registrada para la empresa**, ninguna otra. Quien llama la lee de
  la tabla y se la pasa; nunca sale de lo que pida el cliente.
- **Escribir sigue necesitando `escribirEnReal` y el autorizo por empresa:**
  - el cliente pide `escribirEnReal` para escribir en **cualquier** base que no
    sea la de pruebas (antes, solo en C0008);
  - el envío (`diezEnviar`) cierra toda base real como cerraba la C0008 (para
    la C0008, el mismo texto);
  - el real del importador lleva `historico-diez` si la base es la C0008 (como
    hoy) y `historico-diez-<base>` si es otra; y solo con un ensayo en verde
    del mismo commit **y de la misma empresa**.
- **Pruebas de los tres casos** (`tests/conta/diez/baseRegistrada.test.ts`,
  contra el Diez simulado): C0001 ni registrada; la registrada se lee y
  escribir en ella pide `escribirEnReal`; una no registrada no se toca. Más el
  envío con una base registrada (cerrado).
- **El importador, sin Foodint escrito:**
  - `diez-importar.yml`: empresa, fechas y secreto (`DIEZ_LECTURA` o
    `DIEZ_LECTURA_<sufijo>`, su propio acceso) son entradas; la **base sale de
    la tabla**; la guarda pide su ejercicio mixto de Diez hasta el corte;
  - `importar-preparar.ts`: base, fechas y testigo por base (`testigo-huellas.json`
    para la C0008). **Sin testigo, la tanda no puede salir en verde**
    (`importar.sql`).
  - Modo **`preparar`** (producción, con «produccion» y `preparar-diez-<base>`):
    registra la base y deja el ejercicio del corte «mixto de Diez»
    (`conta_diez_preparar_corte`, solo en una empresa limpia; si ya tiene
    asientos, para y dice que ese corte se hace a mano, como el de Foodint). Sin
    un solo id de cliente en el repositorio.
  - La analítica: el histórico no la usa, y el envío ya devuelve vacío para una
    empresa que no está en `CORRESPONDENCIA_POR_EMPRESA`: vacía por defecto.
- **Foodint con C0008, antes = después:**
  - el importador simulado, con el código de antes y el de ahora, mismas
    entradas: **los cinco CSV con el mismo md5** e informe idéntico;
  - las 259 pruebas de Diez que ya había siguen en verde (ahora 265 con las
    nuevas);
  - con la C0008, el cliente lee sin nada registrado y escribir pide
    `escribirEnReal` con **el mismo mensaje**;
  - **cambia cómo se lanza** para Foodint: ahora hay que escribir la empresa
    (`658728c0-…`), desde `202310`, hasta `202609` y corte `2026-09-30`, que
    antes iban fijos en el workflow. El `autorizo` del real sigue siendo
    `historico-diez`.
- **En staging** (empresa inventada del frente C, «Comercio de Prueba Diez,
  S.L.», con la C0009 registrada por la función de verdad):
  - prueba de la tabla, también como cliente: **7 pasos en verde**;
  - **lectura de la C0009, solo GET** (run 38455993154): base sacada de la
    tabla, 1 mes (09/2024), **159 asientos leídos, 159 preparados, 41
    subcuentas**. Nada se escribe en staging;
  - **simulado** de punta a punta (run 38455835818): **en verde**, y sin dejar
    nada (0 asientos, 0 lecturas, 0 ejercicios después);
  - una empresa sin base registrada **no pasa** la guarda (run 38455262904).
- **Lo que enseñó staging de una empresa nueva:** el importador necesita su
  plan elegido y su cuenta de banco ya creada, porque Diez puede traer una
  subcuenta sin nombre y no se inventan nombres. Es lo que deja el alta; la
  semilla lo hace igual.

## 5 · Pruebas

- **Unitarias:** 3.146 en verde (196 ficheros). Nuevas: `vistaPreviaC06` (8),
  `correoC06` (+5: contraseña cambiada), `baseRegistrada` (5), `enviar` (+1),
  `tests/unit/e2e/frentes` (3) y `cerrojo` (7).
- **Build exacto** (`npm run build`, sin `*.tsbuildinfo`): en verde.
- **Lint del repositorio entero, medido a los dos lados:** 1.379 problemas
  (1.077 errores) en `origin/main` y 1.379 (1.077) en la rama. El único de los
  ficheros que toco (`diezCliente.ts:232`, `no-useless-assignment`) es de una
  línea que no he cambiado.
- **Analizador de producción** sobre la 0200: **sigue**.
- **Staging:** prueba de la base de Diez, 7 pasos, también como cliente: verde.

## 6 · Estado de las e2e y capturas

- **C06** (run 38472131190, ya como frente C y con el script del cerrojo):
  **12 de 12**, en 3 min 26 s. El cerrojo se cogió al primer intento y quedó
  libre al acabar: el script funciona también en Actions.
- **Capturas nuevas** (`docs/conta/capturas/c06/`):
  - `n18-entrar-*` y `n18-contrasena-*`: N18 con las cuatro frases ciertas;
  - `mas-movil.png`: la hoja del «Más» con el menú entero;
  - el correo de «contraseña cambiada»: `docs/conta/maquetas/c06/N20ContrasenaCambiada.png`
    y `-movil.png` (no sale de staging: la marca de pruebas no tiene remitente);
  - la vista previa de un enlace: `public/marcas/contabilidad/vista-previa.png`.
- **Las dos enteras de los frentes A y B** (PR #179): punto 1.

## Para antes de la tarea 6

- Fusionar el [PR #179](https://github.com/Llorente29/llorente29-app/pull/179); luego A y B traen `main`. Hasta
  entonces, nadie lanza su e2e con otra en marcha.
- La tanda de producción del C06 (la 0100 y la 0200) va en la tarea 6, con su
  analizador. Para Foodint cambia cómo se lanza el histórico de Diez: ahora la
  empresa y las fechas se escriben (punto 4).
- `c01b/flujos` «marcar pagada» falla en `main` contra staging por la regla de
  repetidas de A: lo tiene que ajustar A en su prueba.
