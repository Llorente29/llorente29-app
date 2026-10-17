# C06b · Apuntes para el encargo de Recibidas (no hecho)

Julio, 17/10, a raíz del inventario de Libros y del 3174: «Apunta para el
encargo de Recibidas, sin hacerlo». Lo de abajo está medido en `main`
(`ec52d5f2`) y en el build local con datos inventados; no se ha cambiado nada.

## 1. «Revisar factura» no deja corregir los importes leídos

- Dónde: Documentos › Facturas recibidas › la factura
  (`src/modules/conta/documentos/RevisarFacturaPage.tsx`).
- Hoy: a la izquierda el papel; a la derecha «Lo que he leído» (proveedor con
  su NIF, número y fecha, base e IVA por tipo, retención, total y vencimiento)
  y «Cómo se apunta». Lo único que se puede cambiar es el proveedor
  («Decirlo yo»).
- Falta: corregir la base, la cuota, el tipo, la retención, el número, la fecha
  y el vencimiento leídos antes de «Está bien · apuntar». Si la lectura se
  equivoca, hoy no hay forma de apuntarla bien desde ahí.

## 2. El asiento de compras no enlaza con su factura ni con su PDF

- Dónde: Libros › Diario › un asiento de serie Compras
  (`src/modules/conta/libro/AsientoPage.tsx`).
- Hoy: los apuntes (con el IVA y su base en la línea) y la tarjeta
  «Documento» con el número de factura en texto. No lleva ni enlace a
  «Revisar factura» ni «Ver documento» con su PDF (`factura_recibida`), ni
  tarjeta «Con Diez» con su estado y «Reintentar»: esa tarjeta sale solo en
  los asientos de ventas del día (`origen === 'sales_day'`).
- Consecuencia que ya ha pasado: una recibida apuntada que no llega a Diez no
  tiene dónde reintentarse. En «Revisar factura», una vez apuntada, el botón
  desaparece (`yaApuntada`), y no deja `external_send` que la saque en
  «Pendientes de adjuntar en Diez». Es el caso del 3174.

## 3. Lo que ya está hecho en esta rama (para no repetirlo)

- El nombre del PDF lo limpia la base siempre
  (`20261120T0100_c06b_nombre_documento`): por qué el 3174 se quedó sin
  documento, y la medida contra los 65 proveedores y las 7 facturas de Foodint.
