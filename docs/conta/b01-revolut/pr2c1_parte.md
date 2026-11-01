B01 Revolut · PR 2c-1 · **Activar y dejar de pagar.** Las pantallas de «Activar pagos», según la maqueta aprobada por Julio (`docs/conta/maquetas/b01-revolut/ActivarPagos.html`), y «Dejar de pagar», como lo decidió Julio el 01/11. Pagar una factura (el panel «Pagar con Revolut» y la segunda aprobación) va en el 2c-2.

## Qué hace

**La tarjeta de Revolut** (Bancos › Cuentas y extractos), con Revolut conectado, tiene una línea más, la de los pagos:
- **«Pagos · puede leer · aún no paga»**, con «Activar pagos». Solo la ve un administrador. Quien no lo es lee «Solo un administrador activa los pagos. Pídeselo a …», con los administradores de la cuenta.
- **«Pagos · lee y paga · puede pagar: …»**, con «Topes y permisos» y «Dejar de pagar» (administrador). Si hay PAY y nadie tiene el permiso, lo dice (regla 7).
- **«Tu llave y tu PIN»**, para quien puede pagar.
- **Si se dejó de pagar y se canceló en Revolut:** «no paga desde Sumied · Revolut aún tiene el permiso de pagar», con «Quitar el permiso en Revolut».

**«Activar pagos»**, el asistente en tres pasos y en la misma ventana:
1. **Tu llave y tu PIN de pago.** Hace falta al menos uno de los dos; sin ellos, «Seguir» no se puede pulsar. Activar la llave en este dispositivo o crear el PIN pide antes el código del correo.
   - **La llave:** `navigator.credentials.create` con las opciones del servidor.
   - **El PIN:** 6 cifras, dos veces, con las mismas reglas y palabras que el servidor. Es la misma función, que ahora vive en `_shared/pagos/pin.ts`.
2. **Topes y quién paga:** 3.000 € y 10.000 € por defecto. Un administrador los puede cambiar ahí mismo.
3. **Autoriza en Revolut el permiso de pagar:** `activar_pagos` (2b), con READ, WRITE y PAY.

**La vuelta de Revolut:**
- Sobre una conexión ya conectada, dice lo que ha pasado y no abre «ligar».
- Con «Activar pagos»: «Pagos activados con Revolut. Puede pagar: … Topes: …».
- **Si se vuelve sin el permiso**, la página de vuelta (`revolut-vuelta.html`) devuelve también el «state». La función nueva `cancelada` deja de dar por buena esa autorización y dice qué ha quedado, según a qué se fue (`oauth_para`):
  - activar: «Sumied sigue leyendo como antes; no ha cambiado nada»;
  - dejar de pagar: «En Sumied ya están quitados los pagos…»;
  - conectar: lo de siempre.

**«Topes y permisos»** (administrador):
- los topes;
- las personas activas de la cuenta, cada una con «Dar el permiso» o «Quitar el permiso».
- Quién paga se lee por su usuario, de los permisos vivos de la empresa. No se lee por el nombre, que se puede repetir.
- Cada botón dice la frase de la base (regla 8).

**«Dejar de pagar»** (Julio, 01/11), en `conta-revolut-conectar`:
1. **Primero, en Sumied y al instante**, con `conta_pago_dejar` (1703):
   - se quitan todos los permisos de pagar;
   - se cancela lo que esperaba la segunda aprobación o estaba listo para salir, con sus retos;
   - la conexión queda sin PAY;
   - lo que ya salió al banco sigue su camino.
   - La frase dice cuántos: «Ya no se puede pagar con Revolut desde Sumied. Quitado el permiso de pagar a 1 persona. 2 pagos que esperaban no saldrán.»
2. **Después, a Revolut** con solo READ y WRITE, con `oauth_para = dejar_de_pagar`. A la vuelta se guarda el token nuevo: «Revolut ya no tiene el permiso de pagar».
3. **Si la persona cancela en Revolut**, en Sumied ya está quitado y la pantalla lo dice. La tarjeta deja volver a quitarlo allí.

**Sin conexión no se paga.** «Desconectar» y un permiso que Revolut ya no acepta (`tokenDeAcceso`, la conexión pasa a «retirada») llaman antes a `conta_pago_dejar`.

## La base, la 1703

- **`revolut_conexion.oauth_para`** (admite nulos, con su CHECK): a qué se fue la última vez a Revolut (`conectar`, `activar_pagos` o `dejar_de_pagar`). Se borra al volver con el permiso.
- **`conta_pago_dejar(p_company, p_quien, p_quien_nombre, p_motivo)`**: solo la clave de servicio.

## Tanda

`supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/`. Las del PR 1, el 2a y el 2b están aplicadas y en el historial con su huella.

- **1703, añade y cambia (declarado):**
  - añade la columna, que admite nulos, y la función;
  - el CHECK sobre la columna nueva cuenta como «cambia» en una tabla que existe, y va declarado con su prueba de staging;
  - `lock_timeout` de 5 s; `revolut_conexion` tiene 1 fila;
  - el analizador dice **sigue**, sin `autorizo`.
- **Contexto:** medido en producción en solo lectura el 01/11 a las 17:23Z:
  - existe `revolut_conexion` y no tiene `oauth_para`;
  - no existe `conta_pago_dejar`;
  - nada en el camino del pedido;
  - nada en el historial.
- **Lo que cuenta** (`scripts/conta/produccion/cuentas/b01p-dejar.sql`):
  - antes, medido: «no»; 0 funciones; Foodint, «certificado — 1»; 0 personas que pueden pagar; ningún lote;
  - después: «sí», 1, y lo de Foodint igual.
- **La vuelta atrás** quita la función, el CHECK y la columna.
- **El real lo lanza Julio.**

## Pruebas

**Unitarias:**
- `tests/unit/modules/conta/revolut/pagosTarjeta.test.ts`:
  - la línea de los pagos en cada caso (leer, PAY con personas y sin ninguna, el administrador y el que no lo es, dejar de pagar cancelado);
  - PAY con comas o espacios;
  - los topes en euros;
  - la página de vuelta devuelve el «state» sin el permiso;
  - en `conta-revolut-conectar`: dejar de pagar quita antes en Sumied que ir a Revolut, pide READ y WRITE (nunca PAY) y solo un administrador; desconectar deja de pagar antes de quitar la conexión.
- `tests/unit/modules/conta/pagos/llaveNavegador.test.ts`:
  - base64url ida y vuelta;
  - las opciones del servidor pasadas a bytes;
  - `crearLlave` y `usarLlave` con un `navigator.credentials` simulado;
  - cancelar se dice con palabras normales;
  - el nombre del dispositivo;
  - `motivoPin` es la misma función que la del servidor.
- `servidor.test.ts`: un permiso retirado deja de pagar antes de apuntar la retirada.
- `pantalla.test.ts`: la vuelta con error trae su «state».

**Prueba de staging** (`supabase/staging/sql/20261101_b01p_dejar_de_pagar_prueba.sql`, en ROLLBACK, cuenta D, IBAN inventados del banco 9999):
0. la vuelta atrás y la 1703 otra vez;
1. `oauth_para` solo admite sus tres valores;
2. dejar de pagar (permisos, lotes, retos, lo ya salido, la conexión sin PAY);
3. «Aprobar y pagar» lo dice después;
4. solo la clave de servicio.

En verde en la base local del W09.

**e2e** (`tests/e2e/conta/b01/revolutPagos.spec.ts`, cuenta B, ordenador y móvil):
- las pantallas de verdad, contra las respuestas de la base y de las funciones **interceptadas**. No conecta nada en staging, no manda correos y no pasa por Revolut: la página de autorizar se sustituye.
- **Lo que recorre:**
  - «puede leer · aún no paga»;
  - el asistente: sin llave ni PIN no deja seguir; crear el PIN con el código, y el PIN fácil lo rechaza;
  - los topes;
  - Revolut con READ, WRITE y PAY;
  - la vuelta con PAY, sin «ligar»;
  - «Dejar de pagar», con READ y WRITE;
  - cancelado en Revolut: «En Sumied ya están quitados los pagos…» y «Quitar el permiso en Revolut».
- **La llave con el autenticador virtual de Chromium no cabe aquí:** la e2e corre en 127.0.0.1, y una llave no se puede atar a una IP. Va en la e2e con el sandbox (2c-2), en la dirección de staging. Hasta entonces, la firma la cubren las unitarias del 2b con llaves de verdad.

**Comprobaciones hechas:**
- `deno check` de `conta-revolut-conectar`, `conta-pagar`, `conta-revolut-leer` y `conta-revolut-aviso`: sin errores.
- `npx tsc -b`: sin errores.
- `eslint` de lo nuevo: sin avisos.
- **Regla 40:** los nombres entre comillas, contra producción: todos existen, salvo `conta_pago_dejar` (la 1703) y la columna `oauth_para`. `leerConexion` la lee sin ella mientras no esté (42703).

## Lo que no está y queda para después (2c-2)

- **El panel «Pagar con Revolut» de la factura:**
  - la segunda aprobación con la llave o el PIN;
  - la remesa «banco» en Pagos;
  - el casado solo del cargo (`conta_remesa_casar`).
- **La llave en la e2e**, con el sandbox.

## Antes de usarlo (del 2b, sigue pendiente)

- `PAGO_PIN_CLAVE`, en los secretos de las funciones de staging y de producción. La pone Julio.
- Abrir `codigo_pago_conta` y `aviso_pago_conta` en `CORREO_MARCA_ABIERTOS`. Mientras estén cerrados, «Crear» y «Activar» dicen en pantalla que el correo está cerrado.

## Funciones a desplegar a mano

### Sumied

- conta-pagar
- conta-revolut-aviso
- conta-revolut-conectar
- conta-revolut-leer

### Folvy

ninguna

## Producto

- Sumied
- Común (`supabase/functions/_shared`)
