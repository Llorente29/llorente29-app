B01 Revolut · PR 2b · **La salida al banco.** Lo que hace falta para que un pago aprobado salga por Revolut, y para dar la segunda aprobación con la llave o el PIN, en el servidor. Sin pantallas: son del 2c, después de que Julio vea la maqueta de «Activar pagos» (`docs/conta/maquetas/b01-revolut/ActivarPagos.html`).

## Qué hace

**`conta-pagar`, la función que paga.** Va con la sesión de la persona. Quién puede qué lo decide la base (la 1234 y la 1614).
- **La llave de acceso** (WebAuthn):
  - **Confirmar un pago:** reto de un solo uso y comprobación de la firma en el servidor (ES256 y RS256), con su dirección (`rpId`), el origen exacto, la persona presente (UP) y verificada (UV). Lo firmado es `authenticatorData ‖ sha256(clientDataJSON)`.
  - **El contador:** si no sube, la llave se quita, porque puede estar copiada.
  - **Activar una llave nueva:** pide antes el código del correo, y después llega un aviso al correo.
- **El PIN de pago:**
  - de 6 cifras, sin repetidas ni seguidas ni trozos que se repiten;
  - cifrado con HMAC-SHA256 y la clave `PAGO_PIN_CLAVE`, que solo tiene la función, y su sal;
  - la base compara, cuenta los fallos y lo bloquea con 5, con un aviso al correo;
  - crearlo o recuperarlo pide el código del correo.
- **El código del correo:**
  - 6 cifras al azar, sin sesgo; solo se guarda su huella;
  - la plantilla `codigo_pago_conta` sale con la marca y dice que con él no se paga nada;
  - los avisos de seguridad usan otra plantilla, `aviso_pago_conta`.
- **El titular** (VoP de Revolut, `POST /account-name-validation`): coincide, se parece (con el nombre real), no coincide, no se puede comprobar o ahora no.
- **Mandar un lote «listo»:**
  - pasa por la puerta de la demo (`cuentaPuedeSalir`) y por `conta_pago_mandar_empezar`;
  - el beneficiario se reutiliza por su IBAN o se crea (`/counterparty`);
  - `POST /pay` lleva el `request_id` del pago. Si Revolut contesta 3020 (ese `request_id` ya existe), el pago se lee y no se manda otra vez;
  - un «no» claro (4xx) es un rechazo, con su motivo. Sin respuesta (red, 5xx), el pago se queda «enviando» y se pregunta después por su `request_id`: nunca se manda dos veces a ciegas.
- **El estado:** para los pagos que esperan respuesta. Además, la lectura de cada hora, el aviso de Revolut y «Traer los movimientos» ponen al día solos los pagos que esperan al banco (`ponerAlDiaPagos`, en `leerEmpresa`).

**«Activar pagos»**, en `conta-revolut-conectar`:
- solo un administrador, y solo si ya tiene su llave o su PIN de pago;
- vuelve a pasar por la página de autorizar de Revolut con `READ,WRITE,PAY`, con el mismo Client ID y la misma dirección de vuelta;
- a la vuelta, guarda el token nuevo, apunta PAY y quien lo activó queda como la primera persona que puede pagar (`conta_pago_activar`);
- si no se autoriza en Revolut: «Sumied sigue leyendo como antes; no ha cambiado nada».

**La base, la 1614:**
- **El tipo «banco»:** un pago mandado por la API del banco es una remesa de PC01 de tipo «banco», con su línea. Así la factura solo queda pagada cuando su cargo se casa en Bancos y tiene asiento (PC01 · E1), como cualquier remesa. La vista de las remesas la pone «en el banco» desde que se manda.
- **`conta_pago_mandar_empezar`:**
  - vuelve a comprobar cada pago: la factura sigue por pagar, el IBAN de la ficha es el aprobado y la lista no ha cambiado;
  - si el IBAN pedía segunda aprobación, esa aprobación lo confirma, en la línea (quién y cuándo) y en la ficha del proveedor.
- **`conta_pago_banco_dice`:** lo que contesta el banco, en el pago y en su línea. Si lo rechaza, la línea queda rechazada y la factura vuelve a tener lo pendiente. Lo pagado no vuelve atrás, salvo una devolución.
- **`conta_pago_por_saber`** (los pagos que esperan al banco) y **`conta_pago_activar`**.

## Lo que no está y queda para después

- **Casar solo el cargo:** el cargo que trae Revolut no se casa todavía solo con su pago. Bancos ofrece la remesa «banco» para casarlo con un clic, como cualquier remesa (la prueba de staging lo comprueba). Casarlo solo es cambiar `conta_remesa_casar`, que hoy pide la sesión de un administrador: va en el 2c.
- **Las pantallas:** las de Pagos y de la remesa todavía no distinguen la remesa «banco» («a mano» sí); van en el 2c. Hasta el 2c, nadie puede crear una, porque no hay botón que llame a `conta-pagar`.
- **«Dejar de pagar»:** pendiente de la decisión de Julio en la maqueta. Puede volver a pasar por Revolut sin PAY, o bastar con que Sumied deje de usarlo.
- **Los motivos de rechazo de Revolut:** la especificación no da la lista (`reason_code` es un texto libre). Hasta tenerlos del sandbox, se enseña el de Revolut entre comillas.

## Antes de usarlo: un secreto nuevo y el freno de los correos

- **Los dos correos nuevos** (`codigo_pago_conta` y `aviso_pago_conta`) van frenados, como todos los de marca (P01): también con Folvy, porque nunca han salido. Julio los abre en `CORREO_MARCA_ABIERTOS` de `send-email`, primero solo para el correo de prueba (`codigo_pago_conta:correo`). Mientras estén cerrados, «Mándame un código» dice en pantalla que el correo está cerrado y que no se ha mandado nada (regla 8).

- **`PAGO_PIN_CLAVE`**, en los secretos de las funciones de staging y de producción: al menos 32 caracteres al azar, distinta en cada sitio. Sin ella, `conta-pagar` no cifra ningún PIN («Falta la clave del PIN de pago»). La pone Julio; nunca va al chat ni al repositorio.

## Tanda

`supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/`. Las del PR 1 y del 2a están aplicadas y en el historial con su huella.

- **1614, cambia, declarado:** el CHECK del tipo (solo amplía) y la vista de las remesas, con su prueba de staging. Las funciones que añade solo las llama la clave de servicio. El analizador dice **sigue**, sin `autorizo`.
- **Contexto:** medido en producción en solo lectura el 01/11 a las 16:40Z:
  - el CHECK es `fichero | a_mano`;
  - la huella de la vista es `cc12648e…` (la de la 0915);
  - 0 remesas;
  - ninguna de las cuatro funciones;
  - nada en el camino del pedido.
- **Lo que cuenta** (`scripts/conta/produccion/cuentas/b01p-salida.sql`), antes: «banco», no; 0 funciones; Foodint, ninguna remesa; 0 personas que pueden pagar. Después: sí, 4, y lo de Foodint igual.
- **La vuelta atrás:** si ya hay alguna remesa «banco», para y lo dice. Si no, deja la vista con su huella de antes (la prueba lo comprueba).
- **El real lo lanza Julio.**

## Pruebas

**Unitarias:**
- `tests/unit/modules/conta/pagos/llave.test.ts`:
  - llaves de verdad, ES256 y RS256, con `node:crypto`, y la respuesta del navegador construida byte a byte;
  - lo que se rechaza: otro reto, otra dirección, otro origen, sin huella ni cara, sin la persona, otro tipo, otra llave y una firma tocada;
  - el registro, el PIN y el código.
- `revolutPago.test.ts`, con un Revolut simulado que contesta como dice la especificación:
  - el titular;
  - el beneficiario, reutilizado o nuevo;
  - el pago, con su `request_id`, y el 3020 que se lee y no se repite;
  - el 403 sin PAY;
  - staging en el sandbox;
  - los seis estados.
- `unaSalida.test.ts`: solo `conta-pagar` llega a `pagar()`, solo `_shared/revolut/pago.ts` llama a `/pay`, y la puerta va antes que el token.
- `servidor.test.ts`: los pagos que esperan se ponen al día en cada lectura.
- `tests/unit/demo/puerta.test.ts`: ve `conta-pagar` con su puerta.

**Prueba de staging** (`supabase/staging/sql/20261101_b01p_pagos_salida_prueba.sql`, en ROLLBACK, cuenta D, IBAN inventados del banco 9999). Recorre los 7 caminos:
1. «Activar pagos»: solo un administrador, y una vez.
2. Mandar un pago listo: remesa «banco», en el banco, con su línea pendiente del cargo, y lo que necesita la función.
3. El IBAN nuevo: sin la segunda no sale; con ella, confirmado en la línea y en la ficha.
4. Lo que dice el banco:
   - pagado, y sin cambio la segunda vez;
   - rechazado: la factura vuelve a tener lo pendiente;
   - un lote mandado no se manda otra vez.
5. El IBAN cambia entre aprobar y mandar: no sale nada, y no queda nada a medias.
6. Bancos ofrece casar el cargo de la remesa «banco».
7. Solo la clave de servicio.

Empieza con la vuelta atrás, que deja la vista con la huella de producción.

**Comprobaciones hechas:**
- **En la base local del W09:** en verde.
- **Deno:** `deno check` (Deno 2.1.4) de `conta-pagar`, `conta-revolut-conectar`, `conta-revolut-leer`, `conta-revolut-aviso` y `send-email`: sin errores. El de `conta-revolut-conectar` (`data` puede ser nulo, en «empezar») ya estaba en `main` y se arregla aquí.

**e2e:** sin pantallas no hay e2e. Va en el 2c, contra el sandbox: «Activar pagos», la llave (con el autenticador virtual de Chromium), el PIN y un pago de verdad del sandbox.

## Funciones a desplegar a mano

### Sumied

- conta-pagar
- conta-revolut-aviso
- conta-revolut-conectar
- conta-revolut-leer

### Folvy

- send-email

## Producto

- Sumied
- Folvy (`send-email`: sus dos plantillas nuevas)
- Común (`supabase/functions/_shared`)
