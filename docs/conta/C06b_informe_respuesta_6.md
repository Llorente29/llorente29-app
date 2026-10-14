# C06b · Respuesta 6 — el balance según la norma, fuera la barra, el tope de la contraseña y Sumied

Rama `conta/c06b-repasos`, después de fusionar la #182. Todo en commits nuevos,
una tarea cada vez. Nada real en el repositorio ni en los registros: los
importes de Foodint de este informe no están; las pruebas usan la FORMA de
Foodint con importes inventados.

**Producción: no se ha lanzado nada.** La tanda está preparada (§7) y espera a
Julio.

---

## 1 · El balance según la norma

### 1.1 · La norma, literal

Del texto del BOE en el repositorio (`docs/conta/fuentes/textos/rd-1514-2007.txt`):

> **Primera parte, Marco Conceptual, 3.º Principios contables, 5. No
> compensación.** «Salvo que una norma disponga de forma expresa lo contrario,
> no podrán compensarse las partidas del activo y del pasivo o las de gastos e
> ingresos, y se valorarán separadamente los elementos integrantes de las
> cuentas anuales.»

> **Tercera parte, I. Normas de elaboración de las cuentas anuales, 6.ª
> Balance, 2.** «Un activo financiero y un pasivo financiero se podrán
> presentar en el balance por su importe neto siempre que se den
> simultáneamente las siguientes condiciones: a) Que la empresa tenga en ese
> momento, el derecho exigible de compensar los importes reconocidos, y b) Que
> la empresa tenga la intención de liquidar las cantidades por el neto o de
> realizar el activo y cancelar el pasivo simultáneamente.»

Entre dos terceros distintos no hay derecho exigible de compensar: cada
subcuenta va por su signo.

### 1.2 · La línea que elijo, y por qué

El **modelo abreviado** (el de Foodint), con sus números de cuenta, tal como
lo publica el BOE (columna «N.º cuentas»):

> B) III. Deudores comerciales y otras cuentas a cobrar.
> «430,431,432,433,434,435,436,(437),(490),(493)» → **1. Clientes por ventas y prestaciones de servicios.**
> «44,460,470,471,472,5531,5533,544» → **3. Otros deudores.**

> C) V. Acreedores comerciales y otras cuentas a pagar.
> «400,401,403,404,405,(406)» → **1. Proveedores.**
> «41,438,465,466,475,476,477» → **2. Otros acreedores.**

| Subcuenta | Saldo deudor (lo normal o no) | Saldo acreedor |
|---|---|---|
| 430–436 clientes | ACT.B.III.1 Clientes | **PNP.C.V.2 Otros acreedores** — como la 438 «Anticipos de clientes», que el modelo ya pone ahí |
| 44 deudores | ACT.B.III.3 Otros deudores | **PNP.C.V.2 Otros acreedores** |
| 400–405 proveedores | **ACT.B.III.3 Otros deudores** — como la 407 no: la 407 son anticipos a proveedores y van a existencias; un proveedor que debe es un crédito, el sitio de los «otros» deudores | PNP.C.V.1 Proveedores |
| 41 acreedores | **ACT.B.III.3 Otros deudores** | PNP.C.V.2 Otros acreedores |

**Lo que no está en la letra y he decidido yo:** el modelo nombra cada cuenta
en UNA línea; no dice adónde va su saldo del otro signo. Lo pongo en la línea
del otro lado cuyo contenido es el mismo tipo de cosa: lo que un cliente te ha
pagado de más es un anticipo de cliente (438 → C.V.2); lo que un proveedor te
debe es un crédito que no es de clientes (→ III.3). En **pymes** el mismo
criterio sobre su modelo (ACT.B.II.1 / II.3 y PNP.C.IV.1 / IV.2). En el
**normal**, el cliente acreedor va a «Acreedores varios» (C.V.3), las 433/434
deudoras a III.2 (sus líneas de grupo y asociadas) y las 403/404 acreedoras a
C.V.2 (proveedores del grupo).

### 1.3 · Cómo se hace

En el mapeo de serie, sin tocar el motor: la 0600
(`supabase/migrations/20261111T0600_c06b_terceros_por_saldo.sql`, generada
por `scripts/conta/cuentas-anuales.mjs`):

- pone «deudor» o «acreedor» en las **42** filas de serie de esos prefijos
  (14 por modelo) que hoy no tienen signo — 42 exactas o para;
- añade las **42** del otro signo, en la línea de la tabla de arriba;
- cada fila nueva cita la norma en `legal_ref` y lo dice en llano en `note`.

El motor (`colocar`) ya elige por el prefijo más largo y, con dos filas del
mismo prefijo, por el signo del saldo: así va ya la 551 y la 5523.

**Las filas propias de una empresa** (mapeo propio) siguen mandando por encima
de la serie: la 0600 no toca ninguna (0 en producción, medido).

### 1.4 · Lo que se ve

- **Bajo «Clientes»**, una línea, palabra por palabra de Julio: «Los clientes
  a los que debes dinero van al pasivo, como dice el Plan Contable. Por eso
  esta cifra puede no coincidir con la de tu programa anterior.» Letra de
  apoyo (13 px, `--cx-apoyo` #5B6678 sobre blanco, 6,1:1, AA), sin icono, sin
  color de aviso.
- **La banda de la IA** da la cifra de la línea OFICIAL de clientes (ya solo
  los que deben) y, aparte, cuántos clientes van al pasivo y cuánto suman, con
  el enlace al Mayor del que más.
- **El clientes acreedor ya no sale en ámbar** («anómalo»): está donde dice la
  norma. Un 475 deudor, sí: eso no tiene línea del otro lado.

### 1.5 · Pruebas

- `tests/unit/modules/conta/notaClientesC06b.test.ts`, contra el modelo y el
  mapeo REALES (los del BOE, con la 0600) y la forma de Foodint al 30/09
  (siete clientes, cinco acreedores; proveedores y acreedores de los dos
  signos), importes inventados: «Clientes» suma solo los dos que deben; los
  cinco van a C.V.2 en positivo; los proveedores que deben, a III.3; **activo
  = patrimonio neto + pasivo**.
- El mismo cuadre en los **tres modelos con todas las hojas del cuadro** (más
  de 300 por plan), primero de un signo y luego del otro: ninguna cuenta sin
  sitio, cuadra siempre.
- Staging: `supabase/staging/sql/20261111_c06b_terceros_por_saldo_prueba.sql`
  (84 filas por signo, cada prefijo con su deudora en el activo y su acreedora
  en el pasivo, cero sin signo; la vuelta atrás dentro deja la C05).
  **Resultado: ver §6.**
- e2e `tests/e2e/conta/c06/balanceNorma.spec.ts`: la nota justo debajo de la
  línea, sin icono, sin rojo ni ámbar, ≤13 px, y el balance cuadra; en
  ordenador y móvil. **Resultado y capturas: §6 y §8.**

### 1.6 · Con Diez

Con esto Folvy **ya no coincide con Diez a propósito**: Diez compensa los
clientes de los dos signos en «Clientes»; Folvy, por la norma, no. Es lo que
dice la nota.

---

## 2 · Fuera la barra «Muy pronto»

Ninguna barra funcionaba: **todas** contestaban «Muy pronto», así que no se
queda ninguna.

- `enMarco(…)` del módulo pasa a `sinPregunta = true` por defecto (el
  mecanismo de la respuesta 5). Alta: también.
- Fuera de las dos pantallas de proveedores de Cocina que la ponían a mano.
- En el móvil, también el botón central de la IA.
- `loQueTapanSinPregunta` (e2e) mira que no haya `.cx-pregunta` ni
  `.cx-barra-ia` en ninguna ruta; c00/marco y c03/terceros esperan la
  ausencia.
- e2e `tests/e2e/conta/c06/sinBarra.spec.ts`: dieciséis rutas en ordenador y
  móvil, cero con la barra.

Capturas de antes y después: §8.

---

## 3 · El tope de «He olvidado la contraseña»

- **5 por hora por correo y 20 por hora por conexión.**
- La 0610 crea `conta_contrasena_intento` (solo **huellas sha256** del correo
  y de la IP, con la marca y la hora; se borra lo de más de un día) y
  `conta_contrasena_pedir(correo, marca, conexión)`, que devuelve la persona
  como antes y además `se_puede`. Solo la puede llamar `service_role`.
- `conta-contrasena` llama a la función nueva con la conexión
  (`x-forwarded-for`, primera; si no, `x-real-ip`). **Por encima del tope:
  misma respuesta, mismo cuerpo, mismo tiempo — no manda el correo y no lo
  dice.** El envío ya iba en segundo plano (respuesta 5), así que el tiempo de
  la respuesta no depende de si se manda o no.
- Prueba de staging `20261111_c06b_contrasena_tope_prueba.sql`: la 6.ª del
  correo no se manda y devuelve lo mismo; la 21.ª de la conexión, tampoco;
  otra conexión, sí; un correo que no existe no devuelve nada; solo huellas;
  y como usuario ni se llama a la función ni se leen los intentos.
  **Resultado: §6.**
- **Funciones a desplegar a mano** en el PR a `main`: `conta-contrasena`
  (después de la 0610).

---

## 4 · Los 291,50 de «Clientes» — cerrado

**Cerrado por Julio (14/10).** Las 150 subcuentas de Foodint coinciden con
Diez al céntimo al 30/09, así que la diferencia está en cómo Diez arma su
informe, no en los datos. Con la §1 esa línea ya no se compara con Diez: Diez
compensa los clientes de los dos signos y Folvy, por la norma, no.

Lo que se miró, en producción y solo leyendo (las cifras, aquí no):

1. **La lectura de C0008 al 30/09**: Diez = Folvy en las 150 subcuentas.
   Octubre trae 4 apuntes y ninguno toca las 43x.
2. **Ninguna combinación** de hasta cuatro subcuentas de las candidatas que
   Folvy pone fuera de III (44x, 46x, 47x salvo 472, 5xx de socios, 490/493),
   ni de clientes más hasta tres de ellas, da ±291,50 ni la cifra de Diez.
3. **Ningún día de 2026** da la cifra de Diez en la línea de clientes
   compensada.
4. **apiCON** (su Swagger, 108 operaciones) no tiene ningún informe ni modelo
   de balance que leer por GET.

No se ha cambiado nada para «cuadrar con Diez».

---

## 5 · La e2e del frente en cada push

- **En cada push**, `e2e-staging-conta.yml` corre la carpeta del frente y un
  juego común (`c00/marco.spec.ts` y `rls.spec.ts`):
  `conta/b01-*` → b01, `conta/d01-*` → d01, `conta/c06*` → c06.
- **La entera, solo a mano** (`workflow_dispatch` con `pruebas` vacío). El
  nombre de la ejecución dice cuál fue: `e2e · entera · …` o
  `e2e · frente · …`.
- **Antes de pedir tanda o de un PR a `main`**, `antes-de-subir.sh` con
  `PEDIR_TANDA=1` exige una «entera» en verde **del mismo commit**
  (`scripts/conta/e2e-entera.mjs`); si no la hay, para.
- **Las capturas** se suben igual con la del frente en verde.
- **Las del C06 fuera de su frente** se saltan con el motivo (no rojo, no
  borradas): «Pruebas del frente C (C06): sus usuarios solo reciben contraseña
  en las ramas conta/c06*.»
- `cancel-in-progress: false` sigue: dos push del mismo frente hacen cola;
  dos frentes, a la vez. **La prueba con dos frentes a la vez: §6.**

---

## 6 · Staging

**Por rellenar con los resultados de las ejecuciones.**

---

## 7 · La tanda de producción (PREPARADA, NO LANZADA)

`supabase/produccion/aplicar.txt`:

1. `20261111T0600_c06b_terceros_por_saldo.sql` — **autorizo** (update de 42
   filas de serie; 42 o para).
2. `20261111T0610_c06b_contrasena_tope.sql` — **sigue** (todo nuevo).

**Orden con las funciones:** la 0610 antes de desplegar `conta-contrasena`. La
0600 no necesita el front: el balance lee el mapeo de la base; la nota y la
banda llegan con el front.

**Paso 8** (contexto real de producción, medido el 14/10 a las 10:33 UTC):

```
20261111T0600_c06b_terceros_por_saldo.sql: AUTORIZO
20261111T0610_c06b_contrasena_tope.sql: sigue
autorizo: 20261111T0600_c06b_terceros_por_saldo.sql
```

**Cuenta de antes** (`scripts/conta/produccion/cuentas/terceros-y-contrasena.sql`,
producción, 10:33:38 UTC):

| filas de serie del balance | por signo | de terceros | propias de empresa | tabla de intentos | funciones |
|---|---|---|---|---|---|
| 979 | 62 | 42 | 0 | no existe | `conta_contrasena_de_marca` |

Después del real tiene que dar 1.021 · 146 · 84 · 0 · existe ·
`conta_contrasena_de_marca, conta_contrasena_pedir`.

**Vuelta atrás** (`supabase/produccion/vuelta-atras.txt`): la 0610 (antes,
`conta-contrasena` a la versión anterior) y la 0600 (quita 42 y devuelve 42 a
sin signo, o para).

---

## 8 · Diseño

**Por rellenar con las capturas de las e2e.**

---

## 9 · Sumied

### 9.1 · Lo que está hecho

- `supabase/functions/_shared/marcas.ts`: la marca `sumied`, «Sumied», en
  `app.sumied.com`, con su **tema**: tinta #0B1F3B, acción #1E63C9 (el #2F80ED
  de la identidad no llega a AA como texto sobre blanco —3,9:1—; el #1E63C9,
  de la misma familia, da 5,6:1), fondo suave #EAF2F8, acento #00D1B2 solo en
  piezas que no son texto, blanco; letra **Inter** (Fontsource, dentro de la
  app).
- El **logo**: las dos píldoras de la «S» del lienzo «Sumied · Identidad»
  (`public/marcas/sumied/isotipo.svg`) y «SUMIED» en mayúsculas de peso 900.
- **Correo**: los colores y el logo (PNG de 80×80, que Gmail no pinta SVG).
- **Vista previa** al compartir el enlace (WhatsApp): 1200×630, sin «Folvy».
- `vercel.json`: `app.sumied.com` sirve su propio `index.html` de marca, y
  `?marca=sumied` en cualquier otro dominio que no sea de otra marca.
- Pruebas: `marcaSumiedC06b.test.ts`, 12; las del correo, 18; ningún «Folvy».

**Lo que espera a Julio:** el remitente (`Sumied <no-reply@sumied.com>`) y el
dominio de entrada (`entrada.sumied.com`) están a `null`: mientras Resend no
tenga `sumied.com`, el correo sale como el de Contabilidad.

### 9.2 · Los pasos de Julio

1. **Vercel** → folvy-app → Settings → Domains → Add → `app.sumied.com`.
   Vercel dice el registro DNS (un CNAME a `cname.vercel-dns.com`); se pone en
   el DNS de `sumied.com`.
2. **Resend** → Domains → Add domain → `sumied.com` (envío): los registros
   SPF/DKIM que dé, en el DNS. Y para recibir, `entrada.sumied.com` con su MX
   (como `entrada` de las otras marcas).
3. **Supabase** (producción) → Authentication → URL Configuration → Redirect
   URLs → añadir `https://app.sumied.com/**`.

Con los tres en verde, cambio en `marcas.ts` el remitente y la entrada, y
compruebo con el dominio de verdad: la entrada N18, la invitación, «Activa tu
cuenta» y la vista previa de WhatsApp, sin «Folvy» en ningún sitio.

`sumied.com` sin «app.» es para la web pública, aparte: no lo toco.

---

## Comprobaciones antes de cada push

- Unitarias: 3.209 de 3.209.
- Lint del módulo: 0 problemas.
- `npm run build` exacto y en limpio (borrados también los `*.tsbuildinfo` de
  `node_modules/.tmp`): verde. Cazó uno que el lint no veía: Inter no trae
  tipos y el proyecto de las e2e lee `src/marca/marca.ts`; ahora la carga una
  hoja (`src/marca/tema.css`) desde la entrada, la bienvenida y el estilo del
  módulo.
- `antes-de-subir.sh`: «Todo en verde: se puede subir».
