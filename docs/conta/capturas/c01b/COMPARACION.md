# C01b · Capturas junto a las maquetas

Maquetas aprobadas: `docs/conta/maquetas/c01b/N4Proveedor.png` (ordenador,
1440) y `M4Proveedor.png` (móvil, 390). Capturas de staging-conta, sacadas por
la e2e `tests/e2e/conta/c01b/capturas.spec.ts` (ordenador 1440 × 900 y móvil
390 × 844). Datos inventados de las semillas C01 y C01b.

| Pantalla | Ordenador | Móvil |
|---|---|---|
| Lista de proveedores | `lista-ordenador.png` | `lista-movil.png` |
| Ficha (Hermanos Ruiz) | `ficha-ordenador.png` | `ficha-movil.png` |
| Dirección «por confirmar» (Mercados del Norte) | `direccion-por-confirmar-ordenador.png` | `direccion-por-confirmar-movil.png` |
| Pago, con «Cómo factura» | `pago-ordenador.png` | `pago-movil.png` |
| Cuenta B (sin `conta`): Contabilidad plegado | `cuenta-b-contabilidad-ordenador.png` | `cuenta-b-contabilidad-movil.png` |

## Igual que la maqueta

**Ordenador (N4).**
- **Cabecera:** avatar, migas, nombre grande y las tres píldoras (razón social, «NIF ✓ comprobado» en verde, forma de pago). A la derecha, «Editar» y «Subir factura».
- **«Ficha al 90 %»:** barra verde, «Falta: contacto de administración y certificado del banco» con enlaces a cada campo, y «Pedírselo por correo».
- **Cuatro cifras en letra de cifras:** 4.138,60 € / 4 facturas · 1.283,15 € / 1 factura por pagar (en ámbar) · 24 oct / por transferencia · 24 sept / F-2026-0915.
- **Facturas:** la repetida sale en ámbar como «F-2026-0915 (otra vez)», con «Mismo número e importe que la de arriba. No la he apuntado.». «Le debes» la cuenta **una vez**: 1.283,15 € y no 2.566,30 €, comprobado en la e2e.
- **Columna derecha:** el bloque verde «Lo que he aprendido» y «Con quién hablas» con Llamar/Escribir. Debajo, la barra «Pregunta o pide algo».

**Móvil (M4).**
- **Arriba:** volver, «Proveedores» y «Ficha al 90 %». Debajo, avatar, nombre, «✓ comprobado» y la forma de pago.
- **Botones:** «Llamar a pedidos» y «Foto de factura».
- **Cifras:** «Le debes» (vence el 24 oct, en ámbar) y «Este año» (4 facturas).
- **Frase verde** de lo aprendido.
- **Apartados de 56 px** con su resumen, y en ámbar lo que falta («Falta el de administración», «Falta el certificado del banco»).

## Diferencias, una a una

1. **El marco es el de Folvy, no el del módulo de contabilidad.**
   - La maqueta dibuja el menú de contabilidad a la izquierda y su barra inferior en el móvil.
   - La ficha vive en **Cocina › Proveedores** (respuesta 1, decisión 7: una página y una ruta), para todas las cuentas, también las que no tienen `conta`.
   - Por eso el menú y la barra de abajo son los de Folvy, y las migas dicen «Cocina › Proveedores». Desde Compras › Proveedores se llega a la misma ruta.
   - La barra «Pregunta o pide algo» sale en el ordenador. En el móvil, la barra de abajo de Folvy ya trae su botón central.
2. **«Lo que he aprendido» enseña lo que se puede aprender hoy.**
   - La maqueta enseña tres líneas: tipo de gasto, IVA y pago.
   - Hoy una factura guarda su IVA (en las líneas) y la forma con que se pagó, y nada más: ni tipo de gasto, ni retención, ni IBAN.
   - En staging, Hermanos Ruiz sale con «Le pagas por transferencia · Lo confirmaste tú 3 veces». Sus facturas de semilla no tienen líneas, así que no hay IVA que aprender.
   - Lo demás llega con la pantalla de apuntar facturas (C02), y mientras se puede fijar a mano con «Cambiar». No se inventa (pendiente en el PR).
3. **Hay un tercer contacto en «Con quién hablas».** «Hermanos Ruiz · Otro · 600 000 001» es el teléfono que tenía la ficha antigua, que la 0110 movió a un contacto (papel «Otro», sin inventar que sea de pedidos). Es dato, no diseño.
4. **«···» junto a los dos botones de la cabecera.** Es el menú Archivar/Recuperar (respuesta 1, decisión 1). La maqueta no lo dibuja.
5. **Notas debajo de «Con quién hablas»** (decisión 1). La maqueta no la dibuja.
6. **«Artículos que le compras» debajo**, como pedía el encargo.
   - Por dentro es la pieza de Cocina de siempre (precio pactado, principal, quitar), con su letra. Se ha quitado su título para no repetirlo.
   - Sale plegado si son más de 10.
   - Rehacer esa pieza en el estilo nuevo queda pendiente.
7. **Pestañas de edición.** Además de las cinco de la maqueta, hay «‹ Ficha» para volver y «Historial», que trae «Lo que ha hecho Folvy». El Historial ya lo tenía la ficha del C01 y no se pierde.
8. **Lista de proveedores (decisión 1; la maqueta no la dibuja).**
   - Columnas: nombre (con razón social, NIF y artículos), tipo de gasto, «Le debes», última factura y la píldora ámbar «Ficha incompleta · N %» con lo que falta.
   - Filtro «En uso / Archivados».
   - En el móvil: nombre, «Le debes» y la ficha.

## Arreglado tras la primera captura (04/10)

- Móvil: «Foto de factura» se salía por la derecha. Ahora los dos botones caben.
- Lista: la columna de última factura pisaba la de la ficha. Ahora va en dos líneas, fecha y número.
- Lista: «1 artículos» pasa a «1 artículo», y «Sin facturas» ya no va en letra de cifras.
- Lista: la búsqueda se cortaba. Ahora dice «Buscar por nombre, NIF o tipo de gasto».
- «Falta: certificado de titularidad bancaria» pasa a «certificado del banco», como en la maqueta.
- Las píldoras sin marcar no tenían borde y parecían texto. Ahora lo llevan.

La e2e siguiente vuelve a sacar las capturas.
