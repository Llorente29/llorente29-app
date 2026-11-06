# Encargo P01 — El obrador: producir, enviar a los locales y facturar entre sociedades

> Encargo de Julio (06/11/2026). Primer cliente que lo usa: Piri Piri (cuenta `piri-piri`). Va a `docs/conta/encargos/encargo_P01_obrador.md`.

Sesión de Code: «P01 · Obrador». Rama: `prod/p01-obrador`, sacada de `main`. Se desarrolla y se prueba en staging. A producción solo va lo probado, por tandas.

Una cosa cada vez: haz la tarea 1 y para a informar.

## Para qué

Muchos grupos de hostelería tienen un obrador que cocina y reparte a sus locales, y a menudo cada local es de una sociedad distinta. Hoy Folvy no lo sabe hacer:

- **El obrador no es un tipo de ubicación.** Folvy lo trata como un local que vende, así que aparece en ventas, cartas y canales.
- **No se puede registrar lo que se produce.** No hay forma de anotar que se gasta materia prima y sale producto terminado; `stock_movement` no tiene ese tipo de movimiento.
- **El traspaso actual no sirve para esto.** `register_transfer` valora a coste, va artículo a artículo, no hace albarán y no sabe de sociedades.
- **La venta entre sociedades del grupo se hace a mano**, por los dos lados (factura emitida y factura recibida).

Folvy es para toda la hostelería: esto tiene que valer igual para un grupo con un obrador y dos locales que para uno con diez. Nada a medida de Piri Piri.

## Hechos de Julio (06/11/2026)

- **Sociedades y ubicaciones de Piri Piri** (ya dadas de alta en la cuenta `piri-piri`):
  - **Piripiri España, S.L.** tiene el Obrador Central (Andrés Obispo, 37) y el local de Las Tablas.
  - **Frango Takeaway, S.L.** tiene Lavapiés.
  - **Inversiones Piripiri Prosperidad, S.L.** tiene Prosperidad.
- **Envíos dentro de la misma sociedad (Obrador → Las Tablas):**
  - llevan albarán de traspaso a precio de venta;
  - no se facturan, porque es la misma empresa.
- **Envíos a otra sociedad (Obrador → Lavapiés y Prosperidad):** son ventas, y se facturan agrupadas, una factura al mes por cada sociedad que compra.
- **El obrador hace las dos cosas:** elabora (gasta materia prima y saca producto) y también reparte producto que compra tal cual.
- **El local que recibe cuenta lo que llega.** Las diferencias se avisan a la oficina.
- **Precio del obrador:**
  - todavía no está definido; de entrada será una tarifa fija por artículo;
  - la forma de calcularlo cambiará. Más adelante podrá ser, por ejemplo, coste más un porcentaje.
- **El obrador cuenta como ubicación en la cuota de Folvy.** No se toca nada de facturación de Folvy.

## Lo que se construye

### 1. Tipo de ubicación

Cada ubicación es **local** (vende al público, lo que hay hoy) u **obrador** (produce y reparte, no vende al público). Todas las ubicaciones actuales quedan como local.

Un obrador:

- **No aparece en:** ventas, TPV, cartas, canales, disponibilidad, plataformas, cierre del día ni informes de ventas.
- **Sí aparece en:** fichajes y equipo, compras y recepciones, inventario, mermas, APPCC y escandallos.

Revisa en las comprobaciones previas cada sitio que lista locales, y di cuáles deben excluir el obrador.

### 2. Tarifa del obrador

Hay un precio por artículo y por obrador. Es el precio del albarán, y no se confunde con el coste.

- **El precio sale de una regla configurable**, con dos tipos:
  - «Tarifa fija», que es la que se usa ahora;
  - «Coste + %», que queda preparada pero sin pantalla.

  Cambiar la regla será tocar la configuración, no reescribir el código.
- **Cada línea de albarán guarda el precio que tenía al salir.** Un cambio de tarifa nunca cambia albaranes ya hechos.
- **Un artículo sin precio no se puede enviar.** El obrador lo ve antes de cerrar el envío, no después.

### 3. Producir

En el obrador se registra una producción: artículo elaborado, cantidad y lote.

- **Lo que sale de la materia prima:** se descuenta del stock del obrador según el escandallo, a su coste medio.
- **Lo que entra de producto terminado:** suma al stock del obrador con coste = lo gastado ÷ cantidad producida.
- **Si falta materia prima o el escandallo, se avisa y no se inventa coste.** Hoy el coste 0 tapa errores; aquí no puede pasar.
- **Movimientos nuevos en `stock_movement`:** `produccion_consumo` y `produccion_entrada`, con su `source_type`.

### 4. Envío del obrador → recepción en el local

1. **El obrador prepara un envío** a una ubicación de la misma cuenta. El envío tiene número de albarán y una línea por artículo, con cantidad, coste del obrador y precio de la tarifa.
2. **Al salir:** se descuenta el stock del obrador a su coste y el envío queda «en camino».
3. **En el local se cuenta lo que llega**, con el mismo gesto que una recepción de proveedor. Al confirmar:
   - entra en el stock del local lo contado, no lo enviado;
   - las diferencias quedan apuntadas y van a la oficina.
4. **Coste para el local:** lo que entra cuesta el precio del albarán. Es lo que el local «paga», y su food cost y sus escandallos lo ven así. La diferencia entre precio y coste es el margen del obrador.
5. **El tipo de envío lo decide la sociedad**, sin preguntar a nadie:
   - **Destino de la misma sociedad que el obrador (traspaso interno):** no se factura y no genera asiento contable. Sirve para la gestión: margen del obrador y coste del local.
   - **Destino de otra sociedad (venta entre sociedades):** al confirmar la recepción queda «pendiente de facturar» en el mes.

### 5. Factura del mes entre sociedades

Cada mes, por cada sociedad que compra, se hace una factura con lo recibido en el mes. Se factura lo contado en destino, no lo enviado.

- **En la sociedad que vende:** una factura emitida (`customer_invoice`) con su serie y su VeriFactu, igual que cualquier otra. La sociedad que compra es su cliente.
- **En la sociedad que compra:** la factura de proveedor entra sola (`supplier_invoice`), enlazada a sus recepciones.
  - El proveedor es la sociedad del obrador, marcado como empresa del grupo (`related_party_kind`).
  - Su forma de facturar es «agrupa albaranes en una factura», que ya existe en la ficha de proveedor.
  - Nadie la teclea ni la sube.
- **Las dos facturas son el mismo documento visto desde cada lado.** Mismo número, base, IVA y total, y cada una produce su asiento en su sociedad. Si se rectifica una, la otra se rectifica con ella.
- **El IVA de cada línea es el del artículo.** No se escribe ningún tipo de IVA a mano en el código.
- **Al cierre de mes,** la oficina ve lo pendiente de facturar por sociedad y lo factura con un botón. Antes de emitir ve un borrador.

### 6. Lo que no entra en este encargo

- El cálculo «coste + %» con su pantalla (queda la estructura).
- Pedidos de los locales al obrador.
- Planificación de producción.

## Norma

- **Una factura emitida entre sociedades del grupo es una factura normal.** Lleva serie, numeración correlativa, VeriFactu y entra en los modelos (303, 347…). Las operaciones vinculadas se marcan con los datos de la relación que ya existen (`company_relation`).
- **El traspaso dentro de la misma sociedad no es una operación con terceros.** No genera factura ni IVA.

## Contraste (para el informe final)

Con la cuenta Piri Piri en staging, un mes de prueba:

1. **Producción:** producir un artículo en el obrador; el coste del producto es igual a lo gastado de materia prima.
2. **Envíos:** hacer envíos a Las Tablas, Lavapiés y Prosperidad. Contar en destino con una diferencia a propósito en uno.
3. **Las Tablas:** su envío no tiene factura ni asiento, y aparece en el margen del obrador.
4. **Facturas del mes:** facturar el mes.
   - Salen dos facturas emitidas en Piripiri España, una a Frango y otra a Prosperidad.
   - En Frango y en Prosperidad aparecen las dos facturas de proveedor, con los mismos importes y enlazadas a sus recepciones.
   - Lo facturado es lo contado, no lo enviado.
5. **Stock:** cuadra en las cuatro ubicaciones.

Cada punto, con la consulta que lo demuestra. No vale «funciona»: vale el resultado de la consulta.

## Diseño (sección obligatoria)

Esto lo usan tres personas distintas y ninguna es técnica. Si en una pantalla hay que decidir algo, está mal hecha.

**El obrador (tablet, de pie, con guantes):**

- **Dos botones grandes:** «Producir» y «Preparar envío».
- **Producir:** elegir lo que se ha hecho, poner cuánto, confirmar. Nada más.
- **Preparar envío:**
  - elegir a qué local va;
  - añadir artículos y cantidades;
  - confirmar.
  - El precio no se ve en la tablet del obrador.

**El local (tablet):**

- **Un aviso «Llega del obrador»** con el envío ya cargado.
- **Contar línea a línea**, igual que una recepción de proveedor, que ya conocen.
- **Si algo no cuadra, se marca y sigue.** El trabajador no escribe explicaciones.

**La oficina (ordenador, administrativo de nivel medio):**

- **«Envíos del obrador»:** lista de envíos con su estado (en camino, recibido, con diferencias, facturado) y un filtro por sociedad.
- **«Facturar el mes»:**
  - una fila por sociedad que compra, con el importe;
  - un borrador para revisar;
  - un botón para emitir.
- **«Tarifa del obrador»:**
  - tabla de artículos con su precio, editable en la propia tabla;
  - los artículos sin precio, arriba y marcados.

**Reglas de diseño:**

- **Palabras de la calle:** obrador, envío, albarán, lo que llega, producir, tarifa. Nada de «comisariado», «intercompany» ni «centro de coste».
- **Ninguna pantalla se construye sin su maqueta aprobada por Julio.** Las maquetas irán a `docs/conta/maquetas/p01/`. Hasta que lleguen se hacen las tareas sin pantalla (1 a 4). No se adapta al estilo viejo: se sigue la maqueta y el marco nuevo (`docs/conta/marco.md`).

## Tareas

1. **Comprobaciones previas** (`docs/conta/P01_comprobaciones_previas.md`) contra la base y el repositorio, no contra los documentos. Tienen que cubrir:
   - cada sitio que lista ubicaciones y si debe excluir el obrador;
   - cómo funcionan hoy `register_transfer`, `stock_movement`, recepciones, `customer_invoice`, `supplier_invoice` e `invoicing_mode`;
   - cómo se crea hoy un cliente (`party`) y un proveedor que son otra sociedad de la misma cuenta;
   - qué se puede reutilizar y qué es nuevo.

   **Para y informa.**
2. **Tipo de ubicación**, y sacar el obrador de todo lo que vende. Migración, `database.ts` y pruebas.
3. **Tarifa del obrador** con la regla configurable, y **Producir** (sin pantalla aún: funciones y pruebas).
4. **Envío y recepción**, más el traspaso interno y la venta pendiente de facturar. Funciones y pruebas.
5. **Factura del mes** en los dos lados, con asientos, VeriFactu y rectificación enlazada.
6. **Pantallas**, cuando lleguen las maquetas aprobadas.
7. **Contraste** completo en staging con la cuenta Piri Piri, e informe final (`docs/conta/P01_informe_final.md`).

## Reglas de siempre

- **Toda migración va en `supabase/migrations/`.** Después, se regenera `database.ts` por MCP (no con el CLI local) y se quitan las relaciones PostGIS.
- **Cada `SECURITY DEFINER` comprueba `belongs_to_account`.** No se prueba en el SQL Editor.
- **Antes de dar algo por hecho:** build en verde, `rev-list` a `0 0` y verificación con una consulta independiente.
- **Nada de coste 0 ni de valores por defecto** que tapen un dato que falta. Si falta, se avisa.
- **Si algo de este encargo choca con lo que encuentres en la base,** no lo resuelvas por tu cuenta: apúntalo en el informe y para.
