# C06 · Contabilidad sola — comprobaciones previas (tarea 1)

> Solo lectura: código en `origin/main` (`c280a4a`), la rama de A
> (`conta/c04b-diez`, `1fd69ae`), Vercel y producción por `execute_sql`, solo
> `select`. Nada cambiado en ningún sitio. 13/10/2026.

## 1. Qué hay hoy para crear cuentas

Un solo camino de verdad: el panel de plataforma.

- `src/admin/pages/NuevaCuentaPage.tsx` pide nombre, slug, correo y nombre del
  administrador, **local** y **marca** (obligatorios), estado y plan (tres planes
  fijos en el fichero, por defecto `professional`).
- Edge `create-account`:
  - exige `folvy.is_platform_admin`;
  - crea el usuario con contraseña aleatoria (`auth.admin.createUser`);
  - llama a `create_account_tx`; si falla, borra el usuario;
  - genera un enlace de recuperación y monta él mismo
    `https://app.folvy.app/welcome?token_hash=…` (`APP_BASE_URL` fijo en `:47`);
  - envía la plantilla `welcome` por `send-email`, que sale de
    `Folvy <no-reply@folvy.app>` con asunto «Folvy · Activa tu cuenta». El envío
    es «lo intento»: la respuesta trae `welcome_sent` / `welcome_error`.
- `create_account_tx` (`20260617T2390_onboard_unified.sql:223`):
  - escribe `accounts` (con `created_by`), el perfil del administrador,
    `gerente_total`, un **local**, una **marca** y `platform_audit_log`
    `account_created`. **El registro de quién y cuándo ya existe.**
  - después llama a `onboard_account` (última versión en
    `20260927T0100_el_coste_es_lo_que_se_compro.sql:840`), que siembra Cocina
    entera: suscripción del plan, `kitchen_settings`, almacén, cinco canales de
    venta (Salón, Glovo, JustEat, Uber, Shop), familias de platos e ingredientes
    de plantilla con alérgenos.
  - Los disparadores de `accounts` siembran además APPCC, familias de
    ingredientes, gestoría, vacaciones y formación.
- **Nadie escribe `feature_flags`.** El `conta` de Foodint entró por una
  migración de datos (`20261006T1300_conta_interruptor_foodint_datos.sql`).

Producción, medido (consulta pegada en el PR):

| Qué | Valor |
|---|---|
| `accounts` | 4 (1 interna; 3 con `created_by`) |
| `feature_flags` | 1 fila: `conta=true · 51ad1792 · manual_grant`, `granted_by` vacío |
| `company` | 1, de Foodint |
| `locations` | 3 Foodint, 3 plantilla, 1 + 1 en las otras dos cuentas |
| `billing_plans` | `starter` (3 submódulos), `professional` (9), `enterprise` (18); ninguno es «solo contabilidad» |
| `accounts.business_type` | admite `dark_kitchen, bar, restaurante, cafeteria, hotel, otro`; hoy hay 3 `dark_kitchen` y 1 `restaurante` |

Firmas en producción:

- `create_account_tx(p_account_name, p_account_slug, p_admin_user_id, p_admin_display_name, p_location_name, p_brand_name, p_brand_slug, p_submodule_ids, p_plan_id, p_status, p_created_by)`;
- `onboard_account(p_account_id, p_plan_code, p_admin_user_id, p_status)`.

**Lo que esto significa para el C06:**

- Una cuenta solo de contabilidad no puede salir de `create_account_tx` tal
  cual: pide local y marca, y `onboard_account` siembra Cocina.
- Hace falta una función nueva (`20261111T…`, añadir) que cree la cuenta sin
  local ni Cocina, encienda `conta` con `source` y `granted_by`, y deje su
  apunte en `platform_audit_log`.
- Las de hoy no se tocan (regla 2: nada de `CREATE OR REPLACE` con firma nueva).

**Detalle que cambia el aterrizaje:**

- Tras entrar, `check-account-status` devuelve `/${slug}/personal` (`:166`).
- Ninguna ruta empieza por el slug, así que se pinta `HomeGeneral`, el Inicio
  de Folvy.
- Un cliente de contabilidad sola aterrizaría hoy en el panel de hostelería.

## 2. Cómo se resuelve el dominio en Vercel

- Un único proyecto, `folvy-app`, con tres dominios, todos verificados, de
  producción y sin redirección:
  - `app.folvy.app`;
  - `foodint.folvy.app`;
  - `folvy-app.vercel.app`.
- No hay proyecto aparte para staging. Las vistas previas van contra
  staging-conta con variables de rama.
- La resolución por dominio es **solo en el navegador**:
  - `vercel.json` no tiene cabeceras y solo reescribe `/E/:token` y todo lo
    demás a `index.html`.
  - El único código que mira el `hostname` es `src/modules/shop/shopHost.ts`:
    **cualquier `<algo>.folvy.app` que no sea `app` ni `www` es una TIENDA**.
    `foodint.folvy.app` es la tienda de Foodint, y `App.tsx:76` lo mira antes
    que nada.
- **Consecuencia:**
  - El dominio de la marca no puede ser un subdominio de `folvy.app` sin tocar
    `shopHost` (además llevaría «folvy» en la dirección).
  - Tiene que ser un dominio aparte añadido al mismo proyecto de Vercel. Se
    distingue en el navegador por `hostname`, igual que la tienda.
- `index.html` y `manifest.json` son estáticos («Folvy»): con una sola
  construcción para los dos dominios, título, icono y manifiesto se tienen que
  cambiar en tiempo de ejecución.
- **Supabase Auth:**
  - la «Site URL» y la lista de direcciones de vuelta están en el panel de
    Supabase, no en el repositorio, y hay que añadir el dominio de la marca;
  - la plantilla del correo de **contraseña olvidada**
    (`resetPasswordForEmail`) también vive en el panel, y es **una por
    proyecto**: no puede llevar dos marcas. Propuesta en §8.

## 3. Dónde sale escrito «Folvy»

Recuento:

```
rg -i -o 'folvy' src/modules/conta | wc -l   → 251 apariciones
rg -i -n 'folvy' src/modules/conta | wc -l   → 232 líneas
rg -il  'folvy' src/modules/conta | wc -l   → 75 ficheros
```

| Tipo | Cuánto | ¿Lo ve el cliente? |
|---|---|---|
| Contabilidad: texto en pantalla o `aria-label` | 91 líneas | **Sí** |
| Contabilidad: comentarios | 74 líneas | No |
| Contabilidad: identificadores, claves, clases, valores de enum | 67 líneas | No (algunos van atados al texto, ver abajo) |
| Armazón compartido (carga, errores, entrada, contraseña, aviso de versión, `index.html`, `manifest.json`) | 12 ficheros | **Sí** |
| Correos | 2 remitentes, 6 asuntos, logo y pie (`send-email`, `account-email`) | **Sí** |
| PDF y nombres de fichero exportados | 0 | — (jsPDF sin `setProperties`) |
| Edge functions que llama contabilidad | 1 (`conta-vies-check`), 0 apariciones | — |
| Textos de la IA | 0: contabilidad no tiene ningún prompt; la barra «Pregunta a Folvy» contesta «Muy pronto» | El nombre de la barra, **sí** |
| SQL: literales con «Folvy», todas las migraciones | 167 líneas | Algunos |
| SQL: literales con «Folvy», migraciones de contabilidad | 46 líneas | Varios |

Lo que más pesa:

- **Marco y navegación:**
  - `module.tsx:41` «Folvy Conta»;
  - `MarcoAjustes.tsx:102` «Folvy Conta»;
  - `MenuConta.tsx:109,128` «Volver a Folvy» / «Folvy»;
  - `ConversacionAlta.tsx:618`, la marca `folvy` en el alta;
  - `BarraPregunta.tsx:47,52,70` «Pregunta a Folvy».
- **Frases del producto:** «Lo que ha hecho Folvy», «Hecho por Folvy»,
  «Desde cuándo asienta Folvy», «tu cuenta de Folvy» (guion del alta),
  «EN FOLVY» (traer plan), «Folvy tiene» (liquidación).
- **Lógica atada a la palabra:**
  - `lib/diario.ts:137` decide «hecho por Folvy» con
    `validadoPor.startsWith('Folvy')`;
  - `propuestasLibroService.ts:146` guarda `'Folvy (validación automática de ventas)'`.
  - Cambiar el texto sin tocar esto rompe la etiqueta.
- **Nombres guardados en la base:** el autor `'Folvy'`, `'Folvy (cierre del
  día)'` y `'Folvy · corte con Diez (C04 R4)'`, y dos `raise` que acaban en «…en
  Folvy» (`20261014T0100_c05_libros.sql:553,555`). En producción, medido:
  - `journal_entry` de Foodint: 50 de 14.983 con `created_by_name` «Folvy…» y
    0 con `validated_by_name`;
  - `supplier_invoice`: 3 de 6.
  - Ninguna otra cuenta tiene apuntes.
- **Armazón compartido:**
  - `App.tsx:65,142,189` «Folvy / Cargando…» (**App.tsx: no lo toco sin tu
    permiso**);
  - `RootErrorBoundary`, `AccountStatusGate`, `UpdateGate`,
    `AvisoNuevaVersion` («Hay una versión nueva de Folvy», montado siempre);
  - `LoginPage` «Folvy · Restauración Profesional», `WelcomePage`,
    `ResetPassword*`, y `Logo.tsx`, que usan las cuatro;
  - `document.title` no se pone en ningún sitio: siempre «Folvy» del
    `index.html`.

## 4. Qué entra hoy en el menú de una cuenta sin Cocina

**Fuera de `/conta`:**

- Nada mira la suscripción en el cliente: `accountModulesService` solo lo usa el
  panel.
- Un administrador con `conta` ve en la barra de arriba **todos** los módulos de
  Cocina (Equipo, Seguridad, Ventas, Cocina, Connect, Supply, Pedidos, Social,
  Shop) más «Folvy Conta».
- En el móvil, lo mismo.

**Dentro de `/conta`:**

- `chrome: 'propio'` esconde todo lo de Folvy salvo `AvisoNuevaVersion`.
- La ruta `''` lleva a `ajustes`: **no hay pantalla de Inicio**.
- `MENU_CONTA` (`navegacion.ts:204-232`), con `ruta: null` = no se pinta:

| Entrada | Estado hoy |
|---|---|
| Inicio, Por hacer | ocultas (sin ruta) |
| Compras | hecha |
| Ventas | **«Aún no.»** (`VentasPage.tsx`): entrada vacía, la regla del encargo la quita |
| Documentos, Bancos, Pagos y cobros, Facturas que emites, Impuestos, Cómo va tu negocio | ocultas |
| Clientes y proveedores | hecha |
| Libros | hecha |
| Ajustes | hecha; dentro, Numeración, Certificados, Personas y Avisos son huecos «todavía no» |

- La barra del móvil (`BARRA_CONTA`) solo tiene Ajustes a la derecha. A la
  izquierda cae al enlace «Folvy».
- **Compras con una cuenta sin Cocina:** está hecha y es de contabilidad, pero
  hay que comprobar en el recorrido que no dependa de albaranes. Un tercero que
  solo es proveedor abre «su ficha de siempre (en Cocina)», según el comentario
  de `navegacion.ts`. Eso es un camino a Cocina dentro del menú vendido solo, y
  hay que medirlo en la tarea 4.
- **Añadir una entrada** es una línea `{ id, etiqueta, icono, ruta }` en
  `MENU_CONTA`, más su clave en `CONTA.rutas` y su ruta en `module.tsx`. Hoy son
  tres sitios. La propuesta de la tarea 4 lo deja en uno para A y B (§8).

## 5. Qué del C02c y del C04b tiene escrito Foodint

El C02c (traer plan: `lectorDiez.ts`, `importarPlan.ts`, `TraerPlan.tsx`) **no
tiene Foodint escrito**: lee un fichero que sube el usuario. Lo que está atado
es el C04b.

Todo lo del importador vive en la rama de A, salvo el workflow:

- `diez-importar.yml` está en `main` (PR #177) y es **idéntico byte a byte** en
  las dos ramas.
- Ese workflow llama a `scripts/conta/diez/importar-preparar.ts`, `importar.sql`,
  `falso.mjs` e `importar-simulado.mjs`, que **solo existen en `conta/c04b-diez`**.
- Hoy, lanzado desde `main`, falla en el paso 1.

Foodint escrito en el camino que se ejecuta:

| Dónde | Qué |
|---|---|
| `.github/workflows/diez-importar.yml` | `FOODINT: 51ad1792…`, `EMPRESA: 658728c0… # la C0008`; la guarda exige esa cuenta, ejercicio 2026 `mixed`/`diez` e `imported_until = '2026-09-30'`; `DIEZ_DESDE '202310'`, `DIEZ_HASTA '202609'`, `DIEZ_CORTE '2026-09-30'`; secreto único `DIEZ_LECTURA`; `autorizo = historico-diez` |
| `scripts/conta/diez/importar-preparar.ts` (A) | `:37-39` las mismas fechas por defecto; **`:57 nombreBd: 'C0008'` fijo**; en real carga siempre `testigo-huellas.json` (huellas de sumas y saldos de la C0008) |
| `supabase/functions/_shared/diezCliente.ts` (A) | `BASE_REAL='C0008'`, `BASE_PRUEBAS='C0009'`, `BASES_CONOCIDAS = [las dos]`: **cualquier otra base se rechaza** (`:171`); vetos `JDH` y subgrupo `9` por base (una base desconocida ya cae a `[]`) |
| `supabase/functions/_shared/diezAnalitica.ts` (A) | `CORRESPONDENCIA_LLORENTE29` (CAM/BAR → Carabanchel, FLO → Alcalá, subgrupos 1–12 → las marcas); `CORRESPONDENCIA_POR_EMPRESA` con la empresa de Foodint; una empresa que no está devuelve `null`, **así que el «vacío por defecto» ya existe**, pero solo lo usa el envío, no el histórico |
| `scripts/conta/diez/{lectura.mjs:41, testigo.ts:47, analitica.ts:39}` (A) | `C0008` |
| `20261012T0110_c04r_corte_datos.sql:40-42` (main) | el ejercicio 2026 `mixed`/`diez`/`imported_until` de Foodint, escrito para Foodint |

Ya genérico:

- `importar.sql` recibe `-v empresa`.
- `conta_diez_ejercicio` y la comprobación del corte son por empresa.
- `20261019T0100_diez_conexion.sql:57` guarda `nombre_bd` en el conector
  (`external_account_id`), pero el importador no lo lee.

En pruebas y documentación, `C0008` aparece en `tests/conta/diez/*`, en
comentarios y en cabeceras. La SQL de staging usa la cuenta de pruebas A
(`3b34403a…`), no Foodint.

## 6. Qué cambia para que una segunda empresa traiga su Diez

1. **Workflow:**
   - entradas `empresa` (uuid), `nombre_bd`, `desde` y `corte`, o una sola
     `perfil` leída de un fichero sin datos reales;
   - la guarda pasa a `c.id = $EMPRESA` con la cuenta sacada de
     `company.account_id` e `imported_until = $CORTE`;
   - el secreto se elige por empresa (`secrets[format('DIEZ_LECTURA_{0}', …)]`);
   - el `autorizo` lleva el nombre de la empresa.
2. **`importar-preparar.ts`:**
   - `nombreBd` sale de la entrada o del conector;
   - sin fechas de Foodint por defecto;
   - el testigo pasa a ser un fichero por base, o el ensayo dice «sin testigo»
     en vez de comparar con el de Foodint.
3. **`diezCliente.ts`:** la lista de bases conocidas sale de la configuración y
   `C0001` sigue vetada. Es un freno de seguridad: **no lo aflojo sin tu
   autorización**. Ver la pregunta 6.
4. **Base de datos:** la empresa nueva necesita su ejercicio de corte (`mixed` /
   `diez` / `imported_until`). Hoy eso es una migración de datos de Foodint;
   para la segunda tiene que ser una función o un paso del workflow, porque el
   repositorio es público y no puede llevar datos del cliente.
5. **Analítica vacía:** el histórico no la usa hoy. Si la generalización la
   mete, por defecto `null`.
6. **Antes = después para Foodint:**
   - `importar-preparar.ts` en modo simulado y en ensayo, con el código viejo y
     con el nuevo;
   - md5 de los CSV de carga a los dos lados;
   - las 12 pruebas de `tests/conta/diez/importar.test.ts` sobre el Diez falso
     (`falso.mjs`).

## 7. Choques con A y B

- **A (`conta/c04b-diez`)** lleva 81 commits sin fusionar (262 ficheros,
  +23.670) y **no contiene el `c280a4a` de `main`**.
  - Toca `antes-de-subir.sh` (+15/−6), `antes-de-subir-sql.mjs` (nuevo),
    `analizar.mjs`, `aplicar-produccion-conta.yml`,
    `aplicar-staging-conta.yml`, los workflows de Diez y el libro diario.
  - No toca `database.ts` ni `navegacion.ts`.
- **Prefijos:** el encargo dice que A usa `20261021T…`, pero sus migraciones van
  de **`20261019T0100` a `20261021T0100`** (16 ficheros). Con `20261111T` no hay
  choque de orden con ninguna de las dos, pero tu tabla está mal para A.
- **La tarea 5 es de pleno el fichero de A.** Generalizar `importar-preparar.ts`,
  `diezCliente.ts` y el workflow desde `main` es imposible (no están), y
  hacerlo en paralelo a A es un conflicto seguro. Pregunta 5.
- **B (`conta/b01-bancos`):** la rama todavía no existe en el remoto. La entrada
  «Bancos» ya está en `MENU_CONTA` con `ruta: null`. B solo tendrá que darle
  ruta.
- **Staging, cuenta B:** «Cocina de Prueba Sur», `c01b…000b`.
  - **No tiene el interruptor `conta`**, y `tests/e2e/conta/c00/marco.spec.ts:73`
    comprueba precisamente que B no ve «Folvy Conta» en la barra.
  - Usa `/conta` igual, porque las rutas están siempre montadas y protegidas
    por RLS.
  - Si el recorrido de la tarea 6 enciende `conta` en B, esa prueba deja de
    medir lo que mide. Pregunta 7.

## 8. Lo que propongo para las tareas 2–6 (para que lo veas antes)

- **Marca:** un único fichero de configuración, `src/marca/marcas.ts` (y su
  gemelo para las edge functions en `supabase/functions/_shared/marca.ts`).
  - Cada marca con su nombre, logo, favicon, dominios, remitente, pie y huecos
    para el aviso legal y la privacidad.
  - Se elige por `hostname`, con Folvy por defecto. Si no hay dominio, se fuerza
    con `?marca=` solo en staging o vista previa, para las pruebas.
  - El texto visible de contabilidad usa `marca.nombre`.
  - La lógica `startsWith('Folvy')` pasa a mirar un campo, no el texto.
  - Los autores guardados («Folvy (cierre del día)») se pintan por su papel
    («automático») y no por el texto. Lo de Foodint no se reescribe.
- **Correos con marca:** la contraseña olvidada pasa a salir por nuestro
  `send-email` (enlace con `generateLink`, como ya hace la bienvenida) y no por
  la plantilla del panel de Supabase. Así cada marca tiene su correo y su
  remitente.
- **Alta:**
  - una función nueva `20261111T…` que crea la cuenta sin local ni Cocina;
  - `business_type` `otro`;
  - `conta` con `source='manual_grant'` y `granted_by`;
  - auditoría en `platform_audit_log`;
  - una edge function nueva (o una rama de `create-account`) con la marca en el
    enlace;
  - `check-account-status` devuelve `/conta` para una cuenta solo de
    contabilidad.
- **Fuera de `/conta`:** en una cuenta solo de contabilidad, cualquier ruta de
  Cocina lleva a `/conta`, y la barra de Folvy no se pinta nunca.
- **Menú:**
  - `MENU_CONTA` pasa a ser la única lista: cada entrada lleva su ruta y su
    componente, y `module.tsx` monta lo que haya.
  - A y B añaden su entrada en una línea.
  - Lo que no tiene ruta no se pinta, y Ventas sale del menú solo mientras sea
    «Aún no».

## Preguntas para seguir (pararé hasta que contestes)

1. **Maqueta.** No me ha llegado `maqueta_C06.zip` (N18) ni el lienzo «Estilo
   nuevo · Inicio». Los necesito para las tareas 3 y 4. ¿Me los pasas, o los
   dejas en el repositorio en `docs/conta/maquetas/c06/`?
2. **Dominio de pruebas.** No puede ser `*.folvy.app`: lo coge la tienda y lleva
   «folvy». ¿Compras tú un dominio de pruebas y lo añades a `folvy-app` en
   Vercel? Para el correo hace falta además verificarlo en Resend (DNS). Hasta
   entonces, las pruebas fuerzan la marca con `?marca=` en staging y vista
   previa.
3. **Supabase Auth.** El dominio de la marca hay que añadirlo a las direcciones
   de vuelta del panel de Supabase, en producción y en staging-conta. Es tuyo.
   ¿Te parece bien sacar la contraseña olvidada de la plantilla del panel y
   mandarla por `send-email` con marca?
4. **`App.tsx`.** Tiene tres pantallas de carga con «Folvy» que el cliente ve
   antes de que cargue nada. ¿Me das permiso para tocarlas, solo para que lean
   la marca?
5. **Traer de Diez.** Los ficheros que hay que generalizar son de A y solo
   existen en su rama.
   - **(a)** Espero a que A fusione y generalizo encima.
   - **(b)** Lo hace A dentro de su encargo y yo pongo solo la parte de la
     empresa nueva.
   - **(c)** Saco mi rama de la suya.
   - Yo recomiendo **(a)**: dejo la tarea 5 para el final.
6. **Freno de `diezCliente.ts`.** Solo deja leer C0008 y C0009. Para una segunda
   empresa hay que abrir la lista de bases: ¿autorizas que salga de la
   configuración por empresa, con `C0001` siempre vetada?
7. **Cuenta del recorrido.** ¿Uso la cuenta B como dice el encargo (le enciendo
   `conta` y cambio la prueba de `marco.spec.ts` que mide que B no lo tiene), o
   siembro una cuenta nueva del frente C, «sin Cocina, con marca», y dejo B como
   está? Yo recomiendo la nueva.
8. **«Pregunta a…».** La barra de la IA solo contesta «Muy pronto». ¿Se esconde
   en la marca hasta que haga algo, por la misma regla de «nada de muy pronto»
   del menú?
