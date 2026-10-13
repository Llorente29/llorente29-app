# C06 · Informe final — tarea 6 (contabilidad sola con marca propia)

Rama `conta/c06-sola`, con `main` dentro (el [PR #179](https://github.com/Llorente29/llorente29-app/pull/179) incluido). **Nada lanzado en
producción.** La tanda está preparada y analizada contra producción (§5); el
orden entre las tres sesiones lo decides tú.

<!-- RESULTADOS_E2E -->

## 1 · El recorrido entero, en el orden del cliente

`tests/e2e/conta/c06/recorrido.spec.ts`, en ordenador (1440) y en móvil (390),
contra staging-conta, con la marca de pruebas «Contabilidad». Cada ejecución
da de alta una cuenta **nueva** «Recorrido de Prueba C06 …» por tamaño; nada
preparado de antemano salvo el administrador de plataforma de prueba.

| Paso | Qué hace la prueba | Qué es de verdad y qué no |
|---|---|---|
| 1 · Invitación | El administrador de plataforma de prueba (`c06.plataforma@c06-prueba.test`) llama a `conta-crear-cuenta`. | **La función de verdad**, desplegada en staging desde la rama (§4). La marca de pruebas no tiene remitente: la respuesta dice `invitacion_enviada: false` y por qué (regla 8), y fuera de producción trae el enlace. La N19 se pinta con **los mismos datos** que mandó la función. |
| 2 · Entrada | Abre el enlace → «Activa tu cuenta» (su contraseña y las condiciones) → la entrada N18 con su correo y su contraseña. | La contraseña se comprueba en la base. **Staging no tiene el `custom_access_token_hook`**: `check-account-status` no contesta y la app se queda en su aviso en vez de abrir el Inicio. La prueba lo **mide** y lo anota (no lo esconde); exige que el aviso no sea de contraseña o correo, y sigue con la sesión de esa misma contraseña. |
| 3 · Alta con plan y banco | La conversación entera: NIF, nombre, dirección, actividad, IVA, retenciones, plan de pymes y **el IBAN**. Luego la tarjeta «Traer tu contabilidad de Diez» del Inicio: lo que falte, con su botón. | Todo por la pantalla. El IBAN es inventado (entidad 9999, dígitos de control bien). |
| 4 · Diez desde la C0009 | Folvy registra la C0009 para esa empresa; la tarjeta dice «Tu base de Diez (C0009) está registrada…». La lectura, **solo GET**, la hace `diez-importar` en `lectura-staging` contra la empresa que deja escrita la prueba. | Registrar una base es de Folvy (`conta_diez_base_poner`, solo `service_role`). En staging lo hace una función **que solo existe allí** (`seed_c06_recorrido_staging.sql`, no es migración), solo para el administrador de plataforma de prueba y solo para empresas del recorrido. |
| 5 · Inicio, libros y balance | El saludo con su nombre, las cuatro cifras, «Libros», el diario y el balance. | — |

**En todas las pantallas:** ni una «Folvy» (texto, título de la pestaña,
`aria-label`, `alt`, `title`, `placeholder`) y ni un error de la página.

### Lo que encontró el recorrido antes de correr

- **La tarjeta de Diez y «Cerrar el mes» se pisaban.** Las dos usaban
  `.cxi-paso`, `.cxi-paso-hecho` y `.cxi-paso-texto`: mis reglas, que van
  después, ponían bordes y relleno a las filas de «Cerrar el mes», y las suyas
  tachaban los pasos hechos de la mía. La tarjeta de Diez tiene ahora sus
  clases (`cxi-diez-*`). Las capturas del Inicio de la respuesta 3 estaban
  tomadas con el choque.
- **«App del equipo»** salía bajo el logo de la marca en «Activa tu cuenta»
  (es la frase de la app de cocina). Con marca, ahora dice «Tu contabilidad».
- **El 0300 no pasaba el analizador:** el disparador nuevo de
  `company_account` no estaba declarado en la cabecera. Declarado, con la
  prueba de staging que ya lo ejercita (renombrar quita la marca).
- **La cuenta de antes y después fallaba en producción:** contaba
  `accounts.product_brand`, que hoy no existe (la añade el 0100). Ahora se
  cuenta solo si existe, como `name_pending` y `conta_diez_base`. Se vio al
  ejecutarla en producción, no al leerla.

## 2 · Capturas contra las maquetas

<!-- CAPTURAS -->

## 3 · El contraste

Medido con la fórmula de WCAG 2.1 sobre los colores de la marca, tal como los
usan la entrada (`src/marca/entrar.css`), los correos
(`supabase/functions/send-email/marca.ts`) y el Inicio (los `--cx-*` de
contabilidad). Mínimo AA: 4,5:1 para texto, 3:1 para texto grande y para
bordes de controles.

| Pantalla | Par | Colores | Contraste | AA |
|---|---|---|---|---|
| N18 | Título y texto (tinta) sobre blanco | `#0E1A2B` / `#FFFFFF` | 17,48:1 | sí (4,5:1) |
| N18 | Subtítulo, notas y pie (apoyo) sobre blanco | `#5B6678` / `#FFFFFF` | 5,81:1 | sí (4,5:1) |
| N18 | Botón «Entrar»: blanco sobre azul | `#FFFFFF` / `#2F5BFF` | 5,17:1 | sí (4,5:1) |
| N18 | Enlaces (azul) sobre blanco | `#2F5BFF` / `#FFFFFF` | 5,17:1 | sí (4,5:1) |
| N18 | Frases (verde texto) sobre menta | `#1F4B3C` / `#E3FBF2` | 9,08:1 | sí (4,5:1) |
| N18 | Antetítulo (verde) sobre menta | `#0B7A55` / `#E3FBF2` | 4,92:1 | sí (4,5:1) |
| N18 | Fallo (ámbar) sobre ámbar suave | `#8A4B00` / `#FFF1DC` | 6,11:1 | sí (4,5:1) |
| N18 | **Borde del campo sobre blanco** (no texto) | `#C9D0DC` / `#FFFFFF` | **1,55:1** | **NO** (3:1) |
| N19/N20 | Texto (tinta) sobre blanco | `#0E1A2B` / `#FFFFFF` | 17,48:1 | sí (4,5:1) |
| N19/N20 | Notas (apoyo) sobre blanco | `#5B6678` / `#FFFFFF` | 5,81:1 | sí (4,5:1) |
| N19/N20 | Botón: blanco sobre azul | `#FFFFFF` / `#2F5BFF` | 5,17:1 | sí (4,5:1) |
| N19/N20 | Inicial del logo: blanco sobre azul | `#FFFFFF` / `#2F5BFF` | 5,17:1 | sí (3:1) |
| Inicio | Texto (tinta) sobre fondo de página | `#0E1A2B` / `#F5F7FA` | 16,29:1 | sí (4,5:1) |
| Inicio | Apoyo sobre blanco (tarjetas) | `#5B6678` / `#FFFFFF` | 5,81:1 | sí (4,5:1) |
| Inicio | Apoyo sobre fondo de página | `#5B6678` / `#F5F7FA` | 5,41:1 | sí (4,5:1) |
| Inicio | Paso hecho: blanco sobre verde oscuro | `#FFFFFF` / `#0B7A55` | 5,34:1 | sí (4,5:1) |
| Inicio | Paso que falta: blanco sobre azul | `#FFFFFF` / `#2F5BFF` | 5,17:1 | sí (4,5:1) |
| Inicio | Paso en espera: apoyo sobre línea | `#5B6678` / `#E6EAF0` | 4,81:1 | sí (4,5:1) |
| Inicio | Duda: ámbar sobre ámbar suave | `#8A4B00` / `#FFF1DC` | 6,11:1 | sí (4,5:1) |
| Inicio | Lo de la IA: verde oscuro sobre verde suave | `#0B7A55` / `#E3FBF2` | 4,92:1 | sí (4,5:1) |
| Inicio | Menú activo: azul sobre azul suave | `#2F5BFF` / `#EAF0FF` | 4,53:1 | sí (4,5:1, justo) |
| Inicio | Error: rojo sobre rojo suave | `#A3201A` / `#FDECEA` | 6,61:1 | sí (4,5:1) |

**Un par no llega: el borde de los campos** (`#C9D0DC`, el `--cx-borde-campo`
de las maquetas aprobadas, y el `--mx-borde` de la entrada): 1,55:1 frente a
3:1. No lo he cambiado: es un token de todo contabilidad y de las maquetas.
**Propuesta:** `#848E9E`, el más claro que pasa sobre blanco (3,31:1) y sobre
el fondo de página (3,08:1). Si lo quieres, es una línea en cada CSS. El texto
pasa entero; el más justo es el menú activo (4,53:1).

## 4 · Funciones en staging, desde git

Para que el recorrido usara la invitación de verdad hacía falta
`conta-crear-cuenta` en staging, y no quería un token en un portátil (regla 1,
LA PUERTA DE LA PROHIBIDA). Nuevo: `.github/workflows/desplegar-funciones-staging-conta.yml`.

- Lo dispara un push a `conta/**` que cambie `supabase/staging/funciones.txt`
  (hoy: `conta-crear-cuenta` y `send-email`).
- **Nunca producción:** el ref de staging va escrito y para si fuera el de
  producción; no lee el `project_id` de `config.toml`. `hubrise-webhook`, nunca.
- `verify_jwt`: el declarado en `config.toml`; si no está, el vivo en staging;
  si la función es nueva y no está declarada, para.
- **Después lee de vuelta lo desplegado y lo compara** con la rama. Costó
  cinco vueltas saber cómo: el CLI devuelve el código **transpilado** (sin
  tipos, otro formato; medido en el run 38478844313). Ahora los dos lados pasan
  por el mismo `esbuild` y se comparan sin espacios. Run 38479084424: en verde,
  los cinco ficheros de las dos funciones iguales.
- Comprobado también por otro camino, la API de Supabase: `conta-crear-cuenta`
  v1 y `send-email` v64 llevan el código de la rama.

`conta-crear-cuenta` toma la base del enlace de `APP_BASE_URL_PRUEBAS` o, si no
está, del **origen de quien la pide** (solo fuera de producción; en producción
exige dominio propio). Así no hacía falta crear un secreto en el panel.

## 5 · La tanda de producción (preparada, NO lanzada)

`supabase/produccion/aplicar.txt` en esta rama:

```
cuenta: scripts/conta/produccion/cuentas/contabilidad-sola.sql
supabase/migrations/20261111T0100_c06_cuenta_sola.sql
supabase/migrations/20261111T0200_c06_diez_base.sql
supabase/migrations/20261111T0300_c06_traer_listo.sql
```

Vuelta atrás: `supabase/produccion/vuelta-atras.txt` (0300, 0200, 0100).

**El análisis (paso 8)**, con el mismo `analizar.mjs` y las mismas
`CAMINO_TABLAS` / `CAMINO_FUNCIONES` que el workflow, contra el contexto
**medido en producción** con su consulta de solo lectura (13/10, 22:44:29 UTC):
contexto `tablas: accounts, company_account, feature_flags` · 7 funciones que
existen (las seis de siembra y `conta_diez_subcuentas`) · `camino: {tablas: [],
funciones: []}` · `registro: []` (ninguno aplicado). Historial: los tres
pendientes, ninguno con otra huella. La salida entera:
`docs/conta/c06/tanda-analisis-20261013.md`.

| Fichero | Veredicto | Lo que cambia sobre lo que existe |
|---|---|---|
| `20261111T0100_c06_cuenta_sola.sql` | **sigue** | dos restricciones de `accounts` quitadas y puestas (4 filas hoy; el analizador lee 2 en `reltuples`); seis funciones de siembra reemplazadas con su firma. Todo declarado, con prueba de staging. |
| `20261111T0200_c06_diez_base.sql` | **sigue** | solo crea (dos tablas, índice, disparadores, políticas, funciones) y la fila de Foodint. |
| `20261111T0300_c06_traer_listo.sql` | **sigue** | el disparador de `company_account` (781 filas) y `conta_diez_subcuentas` con su firma. Declarado, con prueba de staging. |

**Sin `autorizo`. Nada en el camino del pedido.**

Lo que comprobé además, en producción y de solo lectura:

- `conta_diez_subcuentas` sigue siendo el cuerpo sobre el que está hecho el
  0300: md5 `33572edaa7e05e1bab66e024168d0036`, el mismo; y la vuelta atrás
  del 0300 lo devuelve **byte a byte** (mismo md5).
- La vuelta atrás del 0100 devuelve los seis disparadores con **el mismo
  código** que el vivo: 6 de 6. Cuatro los guarda producción con saltos CRLF y
  el fichero con LF (el contenido es idéntico salvo eso).
- La cuenta de antes y después, ejecutada en producción: cuentas 4 · con marca
  «sin columna» · restricciones `accounts_business_type_check · accounts_lifecycle_order · accounts_slug_format · accounts_status_check · accounts_suspended_consistency`
  · interruptores conta 1 · funciones de la tanda 5 · subcuentas 781 ·
  `name_pending` sin columna · disparadores de `company_account`
  `company_account_madre · company_account_misma_cuenta · company_account_no_ocultar_enlazada`
  · `conta_diez_base` sin tabla · md5 `33572eda…` · lecturas de Diez 1.
- Foodint es la empresa `658728c0-fcd7-…` de su cuenta: la fila de C0008 del
  0200 encuentra su empresa.

**El orden con el front:** la tanda **antes** de fusionar el front del C06,
que lee `name_pending` y `conta_diez_listo`. Fusionar sin la tanda deja el
Inicio pidiendo una función que no existe (regla 40).

**Con el ensayo:** el workflow lo exige en verde del mismo commit antes del
real. Al ensayar, el 0200 inserta la fila de Foodint dentro de la transacción
y se deshace con ella.

## 6 · Foodint: lanzar el histórico, sin más fricción que antes

Con la tanda aplicada, `diez-importar` en `real`:

| Campo | Qué poner |
|---|---|
| modo | `real` |
| empresa, desde, hasta, corte | **vacíos**: salen la única empresa con base registrada (Foodint, C0008) y lo último usado: `202310`, `202609`, `2026-09-30`. Cambia solo lo que quieras. |
| confirmo | `produccion` |
| autorizo | `historico-diez` |

Antes de traer nada, la guarda mira `conta_diez_listo`: sin datos, plan y
banco, no trae. Si sale en verde, recuerda lo usado para la próxima.

## 7 · Cuando la marca tenga nombre y dominio: tus pasos

En este orden; cada uno dice dónde se hace y cómo se comprueba.

1. **El nombre y el dominio en el código** — `supabase/functions/_shared/marcas.ts`
   (lo comparten el front y las funciones): una marca nueva copiando la de
   `contabilidad`, con `nombre`, `inicial`, `dominios: ['<dominio>']`,
   `direccionVisible`, `remitente` (`Nombre <no-reply@<dominio>>`),
   `responderA`, `dominioEntradaCorreo`, `logoCorreo`, `avisoLegal` y
   `privacidad`. El build escribe `dist/marcas/<id>/index.html` con su título y
   su vista previa (necesita `public/marcas/<id>/favicon.svg`, `manifest.json`
   y `vista-previa.png`). Lo hago yo cuando me des el nombre.
2. **Vercel · el dominio** — en el proyecto, *Settings → Domains*: añadir el
   dominio y poner los DNS que pida. Se comprueba con el estado del dominio en
   Vercel («Valid Configuration»).
3. **Vercel · la regla de host** — en `vercel.json`, una regla como la de
   `?marca=contabilidad` pero con `has: [{ type: "host", value: "<dominio>" }]`
   hacia `/marcas/<id>/index.html`, **antes** de la general. Sin ella, quien
   comparta un enlace del dominio verá la vista previa de Folvy. Lo hago yo con
   el punto 1.
4. **Resend · el remitente** — verificar el dominio en Resend (SPF, DKIM y,
   si quieres, DMARC en los DNS). Hasta entonces `send-email` no manda con esa
   marca (y lo dice: no hay remitente de reserva).
5. **Supabase · las URL de redirección** — en producción, *Authentication →
   URL Configuration*: añadir `https://<dominio>/**` a *Redirect URLs*. La
   invitación construye su enlace sola, pero «He olvidado la contraseña» y los
   correos de Supabase lo necesitan.
6. **Supabase · el hook en staging (para probar la entrada de verdad)** — en
   staging-conta, *Authentication → Hooks → Customize Access Token*:
   `public.custom_access_token_hook`, como en producción. Sin él, en staging
   ni «Activar cuenta» ni «Entrar» pueden abrir la cuenta (§1). Es un ajuste
   del panel, no SQL. Con él, el recorrido entraría sin la sesión por la API.
7. **La vista previa en WhatsApp, con el dominio de verdad** — pegar
   `https://<dominio>/login` en un chat: tiene que salir el título, la frase y
   la imagen de la marca, sin «Folvy». WhatsApp guarda la vista previa en
   caché: si la primera prueba salió mal, se prueba con `?v=2`.
8. **El recorrido contra el dominio** — con todo lo anterior, el recorrido
   (`recorrido.spec.ts`) se puede lanzar contra el despliegue del dominio; y en
   producción, una invitación real a un correo tuyo.

## 8 · Lo compartido

- **Ficheros compartidos que toca esta rama** respecto de `main`:
  `src/config/navegacion.ts` (la ficha del proveedor sin Cocina),
  `src/modules/conta/module.tsx` (las rutas de contabilidad sola) y
  `src/App.tsx` (7 líneas: el aterrizaje de una cuenta solo de contabilidad,
  de las tareas 2–4). B ha tocado `navegacion.ts` y `module.tsx` para la ruta
  de Bancos: aún no está en `main`; cuando entre, al traerlo se conserva su
  línea.
- **`.github/workflows/e2e-staging-conta.yml`:** el frente C ahora pone la
  contraseña de un solo uso también al administrador de plataforma de prueba
  (7 usuarios en el C). Solo la línea del C.
- **`supabase/seeds/conta/e2e_limpieza.sql`:** quita también la empresa de las
  cuentas del recorrido con más de 30 minutos (con ella, su registro de la
  C0009). Las cuentas se quedan: llevan su apunte en el registro de plataforma.
- **Lint:** sin problemas nuevos en lo que toco. Medido igual a los dos lados:
  `WelcomePage.tsx` tenía 2 (1 error, 1 aviso) y sigue con 2; el recorrido, 0.
- **Build:** `npm run build` exacto y en limpio, en verde.
