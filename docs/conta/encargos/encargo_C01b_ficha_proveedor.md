# Encargo C01b — Ficha de proveedor en el estilo nuevo y cierre del C01

**Rama:** `conta/c01b-ficha-proveedor`, creada desde `main` (que ya lleva el C00, el R02 y la parte de estructura del C01). El PR #137 se cierra con una nota que apunte a este encargo: lo que allí quedaba (pantalla y movimiento de datos) se rehace aquí sobre `main`, no se rebasa. PR en borrador desde el primer commit. Una cosa cada vez.
**Maquetas aprobadas:** `N4Proveedor` (ordenador, 1440) y `M4Proveedor` (móvil, 390), adjuntas. Sustituyen a `Proveedor.dc.html` y `ProveedorMovil.dc.html` del C01, que quedan obsoletas. Fiel a la maqueta, no al estilo actual.

## 1. Para qué

Cerrar el C01 de verdad. En producción ya están las tablas (`supplier` ampliada, `supplier_contact`, `expense_category`, pagos de factura), pero la ficha que las usa no, y los datos del proveedor siguen en las columnas viejas. Esta ficha es la **misma pantalla para Cocina y para Contabilidad**: Compras › Proveedores pasa a ser esta para todas las cuentas, Foodint incluida. Lo que ya hacía la pantalla vieja (artículos que le compras, «Migrar artículos») sigue dentro, como bloque propio.

Siguen fuera: plan contable real (C02; aquí la cuenta se enseña con el código completo del plan de pymes por defecto, como en la maqueta, y C02 la hará editable), ficha de cliente (C03), asientos, tesorería completa.

## 2. Comprobaciones previas (tarea 1; informe en el PR y **para**)

- Qué parte del C01 ya está en `main` y en producción (migraciones 0100 y 0110 recortada) y qué no (pantalla, movimiento de datos, `compliance_docs_due` leyendo del contacto).
- Lista de todos los usos actuales de `supplier.email`, `.phone`, `.address` y `.notify_group` en código, edge functions desplegadas, triggers y crons (misma vara que el R02: lo desplegado manda sobre el repositorio).
- Estado de los proveedores en producción, solo lectura: cuántos, cuántos con email/teléfono/dirección/NIF, cuántas facturas con `due_date`, cuántos `compliance_document`.
- Qué lee hoy la pantalla vieja de Proveedores que no esté en la maqueta nueva (para que nada se pierda al sustituirla).
- En staging: que las semillas tengan proveedores con todos los casos (con y sin email, con dirección libre, con facturas pagadas y por pagar, con repetida, con documentos).

## 3. Modelo y datos (sin cadáveres)

- **Una sola fuente**: email, teléfono y dirección viven en `supplier_contact` (contacto principal, y por papel) y en los campos fiscales estructurados. Migración de datos en fichero propio (`*_datos.sql`), con `*.down.sql`, que: crea el contacto principal por cada proveedor con email o teléfono; propone el reparto de `address` en calle/CP/población/provincia marcado «por confirmar» (población propuesta desde la tabla de códigos postales del C00 cuando hay CP); y deja un registro fila a fila de lo movido. Prueba de **antes = después**: ningún email, teléfono ni dirección se pierde (recuento y comparación por proveedor, en staging y, tras aplicar, en producción en solo lectura).
- Todo el código pasa a leer de la fuente nueva (`compliance_docs_due`, alta desde albarán, pedidos a proveedor, avisos). Las columnas viejas quedan sin lecturas ni escrituras y se **eliminan en fichero propio** (`*_elimina.sql` + `.down.sql`), que irá en su tanda con `autorizo`, como la 0200 del R02. Antes de escribirlo, el analizador y una búsqueda en lo desplegado confirman que nadie las nombra.
- Impuestos y retenciones de la ficha **leen de las tablas del C00** (`tax_rate`, `withholding_rate`, `payment_term`, `payment_method`, `expense_category` con su ocultación genérica). Nada de listas en código. Donde haya una cuenta contable, **código completo** con la longitud de la empresa (`60000000 · Compras de mercaderías`).
- `usual_vat_rates` deja de ser un array de números y pasa a referencias a `tax_rate` (migración con equivalencia, sin perder nada).

## 4. Reglas (núcleo puro con pruebas)

Se mantienen las del C01 (NIF/CIF/NIE, IBAN, VIES por edge function, propuesta desde factura con confirmación, completitud con pesos, cifras de la ficha, validaciones al guardar), con tres añadidos:
- **Repetida**: una factura con el mismo número e importe que otra del mismo proveedor se marca «¿Repetida?» y no se apunta hasta que la persona decide (maqueta: fila ámbar con explicación).
- **«Lo que he aprendido de este proveedor»**: Folvy guarda, por proveedor, lo que la persona ha confirmado repetidamente (tipo de gasto, tipos de IVA, retención, forma y plazo de pago, IBAN comprobado), con el porqué («lo confirmaste tú 3 veces», «así vienen todas sus facturas»), fecha y «Cambiar». Es la base de la propuesta automática de las facturas siguientes; **nunca contabiliza nada sin confirmación**. Registro en «Lo que ha hecho Folvy».
- **Plazo > 60 días**: se guarda, pero avisa (Ley 3/2004, art. 4), como en el C00.

## 5. Diseño (obligatorio) — maquetas `N4Proveedor` y `M4Proveedor`

Guía «Estilo nuevo» (Geist / Geist Mono; texto `#0E1A2B`, apoyo `#5B6678`, azul `#2F5BFF`, azul suave `#EAF0FF`, verde IA `#2EE6A8`/`#0B7A55`/`#E3FBF2`, ámbar `#FFF1DC`/`#8A4B00`, línea `#E6EAF0`, fondo `#F5F7FA`; sin negro; colores en el único sitio).

**Ordenador (`N4Proveedor`)**
- Cabecera: avatar con iniciales, migas «Clientes y proveedores › Proveedores», nombre comercial grande, píldoras (razón social · NIF «✓ comprobado» en verde · forma y plazo de pago); a la derecha «Editar» y «Subir factura» (azul).
- Tarjeta **«Ficha al 90 %»** con barra verde IA y «Falta: contacto de administración y certificado del banco», cada cosa un enlace al campo; botón «Pedírselo por correo» (abre el borrador; el envío lo hace la persona).
- Cuatro cifras: Le has comprado este año · Le debes (ámbar si hay pendiente) · Próximo pago · Última factura; en Geist Mono. Sin facturas, estado vacío claro.
- Columna izquierda **Facturas** (fecha, número, importe, estado «Pagada» verde / «Por pagar» azul / «¿Repetida?» ámbar con su explicación en una línea; «Ver»). «Marcar como pagada» desde la factura, con deshacer.
- Columna derecha: bloque verde **«Lo que he aprendido de este proveedor»** (tres líneas con porqué y «Cambiar») y tarjeta **«Con quién hablas»** (contactos con papel y acción Llamar/Escribir; «+ Añadir»).
- Bloque **«Artículos que le compras»** (lo de la pantalla vieja: artículos, última compra, «Migrar artículos») debajo, plegado por defecto cuando hay más de 10.
- Pestañas de edición (Datos fiscales · Contactos · Pago · Contabilidad · Documentos): formularios en una columna, etiquetas encima, **desplegables y píldoras** para IVA, retención, tipo de gasto, plazo y tipo de NIF (nunca texto libre; los valores salen de las tablas del C00 y los más usados van primero), validación al momento con mensajes normales («Este IBAN no es correcto: revisa los dígitos»), «Se guarda al salir del campo» con «Guardado» discreto.
- Barra flotante «Pregunta o pide algo» abajo, como en el resto del módulo («Muy pronto» al usarla, como hoy).

**Móvil (`M4Proveedor`)**
- Cabecera con volver, «Proveedores» y píldora «Ficha al 90 %»; avatar, nombre, NIF comprobado y pago en una línea.
- Dos botones grandes: «Llamar a pedidos» (blanco) y «Foto de factura» (azul, abre la cámara).
- Dos cifras: Le debes (con vencimiento en ámbar) y Este año (con número de facturas).
- Tarjeta verde «Lo que he aprendido» en una frase.
- Lista de apartados de 56 px: Datos fiscales · Contactos · Cómo le pagas · Contabilidad · Documentos · Facturas · Artículos que le compras; resumen debajo y en ámbar lo que falta; cada uno abre su pantalla con una acción.
- Barra inferior flotante con el micro en el centro.

**Estados**: esqueleto al cargar; sin facturas; error con «Reintentar»; VIES «Comprobando con la UE…»; dirección «por confirmar» con el reparto propuesto y «Es esta / Corregir».
Capturas de ordenador y móvil junto a las maquetas en `docs/conta/capturas/c01b/COMPARACION.md`, al terminar la tarea 4.

## 6. Contraste

Compara en media página la ficha de proveedor de Holded, Pennylane y Cegid Diez (qué enseñan arriba, cómo tratan IBAN, documentos y contactos, qué proponen solos) y di qué hacemos mejor. Lo nuestro: todo lo que un administrativo necesita en la primera pantalla, y la IA explicando lo que ha aprendido.

## 7. Pruebas

- Unitarias del núcleo (las del C01 + repetida + aprendizaje + plazo > 60).
- E2E, cuentas A y B (B sin `conta`: la ficha tiene que funcionar entera igual, salvo el bloque Contabilidad plegado), ordenador y móvil: crear proveedor; completar al 100 %; NIF e IBAN inválidos; propuesta desde factura confirmada; marcar pagada y ver «Le debes» y «Próximo pago»; repetida detectada; dirección «por confirmar» resuelta; «Artículos que le compras» y «Migrar artículos» funcionan como antes.
- Prueba **antes = después** del movimiento de datos (staging) y la misma consulta lista para producción.
- RLS: otra cuenta no ve nada.
- Vuelta atrás probada en staging para cada fichero que toque tablas de Cocina.
- Cadena `antes-de-subir.sh` entera antes de cada push.

## 8. Tareas

1. Comprobaciones previas e informe. **Para.**
2. Migración de datos (`*_datos.sql` + down) y cambio de todas las lecturas a la fuente nueva; prueba antes = después.
3. Núcleo: reglas nuevas con pruebas.
4. Ficha nueva, ordenador y móvil, sustituyendo a la vieja; capturas junto a las maquetas.
5. «Lo que he aprendido» y registro en «Lo que ha hecho Folvy».
6. Fichero de eliminación de columnas viejas (+ down), analizador, búsqueda en lo desplegado.
7. E2E, RLS, contraste, informe final; PR listo para revisión. Cierre del PR #137 con nota.

## 9. Entrega

Como el R02: Julio prueba en la vista previa (cuentas A y B), da el visto bueno, y el despliegue va por el workflow de producción: tanda de datos (con `autorizo` del fichero de datos), fusión del front con Vercel en READY y comprobación antes = después en producción, y la eliminación en su tanda después. Hasta entonces, nada en producción.
