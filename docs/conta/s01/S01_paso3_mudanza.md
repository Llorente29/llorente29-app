# S01 · Paso 3 · Las pantallas que ya existen, a su sitio

Lo que se ha mudado, en el orden en que se ha hecho, y lo que queda.
El inventario es el del paso 1 (`S01_paso1_comprobaciones.md`, §2).

## Hecho

### Libros → Contabilidad › Libros y listados · Cierre y Registro · Importar

- Las áreas y la segunda fila de Libros pasan a la **cinta** de su pestaña
  (`esqueleto/ordenes.ts`, sacadas de `AREAS_LIBROS`: una sola lista).
- Lo que Libros sabía de cada acción (el número, el punto ámbar) lo pone en la
  cinta con `useDatosEnCinta`.
- La portada de Libros lleva al Mayor.

### Bancos → Bancos › Movimientos · Reglas · Cuentas y extractos · Cierre del mes

- Las **pestañas**, en la cabecera del esqueleto (antes las pintaba la pantalla).
- La **barra de acciones** (B01) es la cinta de sus cuatro pestañas:
  - TUS BANCOS: los bancos de la empresa, con su nombre corto, sus dudas
    escritas y el punto ámbar. Los pone la pantalla (`useEntradasEnCinta`): el
    catálogo deja el grupo en blanco (`dePantalla: 'bancos'`). Cada banco es un
    enlace (`?banco=`) y «y N más» abre la lista de todos, como antes.
  - TRAER MOVIMIENTOS: «Subir extracto».
  - AUTOMÁTICO: «Reglas» (las activas; ámbar si hay nuevas) y «Casados solos».
  - REVISAR: «Lo que he hecho» (antes solo se llegaba por el buscador; así lo
    proponía el inventario del paso 1).
- **«Tuyos» se va**: los favoritos de Bancos (los del navegador) y su Ctrl K
  eran de la pantalla; ahora Favoritos (en la base) y Ctrl K son del esqueleto,
  para todo. Su Ctrl K ya no se oía: el del marco lo tapaba desde el paso 2.
- El **mes**, en la cabecera (`PeriodoEnBarra`), como el ejercicio de Libros.
- En el **móvil**, nada cambia: Bancos va por niveles (su portada con
  apartados y «‹ Bancos»), y el esqueleto no pone ni fila de pestañas ni cinta
  (`portadaMovil` en `productos.ts`).
- Lo elegido viaja por la cinta: ejercicio, mes y banco (`conConsulta`). De paso
  se arregla «Para revisar» con ejercicio, que salía con dos `?`.

### Compras y gastos › Por revisar · Facturas recibidas

- **Por revisar** (N18, `compras`): el título lo dice la cabecera; «Subir una
  factura» pasa a la cinta (NUEVO «Subir factura», que abre el mismo diálogo con
  `?subir`, también estando ya en la pantalla).
- **Facturas recibidas** (N22, `documentos`): la barra de la N22 (TRAER ·
  ESPERADAS · LEÍDAS) es la cinta de la pestaña, con sus números y su punto
  ámbar. La pone la pantalla, porque depende de la empresa (el correo, Cocina).
  «Por correo» solo informa de su dirección: en la cinta es texto, no un botón
  que no hace nada. El mes, en la cabecera. Fuera la fila «Áreas de Documentos».
- **Lo de hostelería dentro de las pantallas** (inventario, §3), con la marca de
  la empresa (`company.is_hospitality`, `useHosteleria`): la tarjeta
  «Liquidaciones del mes» y la frase «Lo que llega con el género…» en Por
  revisar, y la tarjeta de la quincena de Catcher en Facturas recibidas. Mientras
  no se sabe de qué es la empresa, no salen; fuera del esqueleto, como antes.
- La e2e de la cuenta D (sin hostelería) lo comprueba.

### Contactos › Todos · Clientes · Proveedores (· Plataformas · Socios de marca)

- Los **papeles** de la lista (antes, filtros con su número en la pantalla) son
  las **pestañas** de Contactos. Una pestaña puede ser una vista de la misma
  pantalla (`ver` en `productos.ts`): se marca cuando la dirección lo pide
  (`?ver=clientes`); en una ficha, «Todos».
- **Plataformas y Socios de marca, solo con hostelería.** En otra empresa sus
  contactos siguen en «Todos» (regla 7) y, si alguien llega con `?ver=plataformas`,
  la pantalla enseña ese filtro como hasta ahora.
- En la pantalla queda lo que no es un papel: «Archivados · N». El número de
  cada vista lo dice la línea de debajo («3 terceros en «Plataformas»»).
- «Nuevo cliente», en la cinta (abre el mismo diálogo con `?nuevo`).

### Ajustes › Empresa: «¿Es un negocio de hostelería?»

- La marca de la empresa (`company.is_hospitality`) se cambia aquí, al lado de «A
  qué te dedicas»: «Sí, es hostelería» / «No», y dice qué sale o deja de salir
  (regla 8). El esqueleto la vuelve a leer al momento (`refrescarContextoEsqueleto`):
  Liquidaciones aparece en Compras y gastos sin recargar.
- «Hora de cierre del día» (Ajustes › Ejercicio) es de pedidos: solo con
  hostelería (inventario, §3).
- La e2e de la cuenta D la pone en «Sí», mira que sale Liquidaciones y la deja en «No».

### Ajustes › Empresa: el logo de la empresa (0120)

- `company.logo_path` (admite nulos) y el bucket **privado** `company-logos`
  (PNG, JPG o WebP de hasta 1 MB; sin SVG), con sus políticas como las de
  `banco-tickets`: lee quien es de la cuenta; sube, cambia y borra el
  administrador o el gestor. Ruta `<cuenta>/<empresa>/<huella>.<ext>`.
- En Ajustes › Empresa, «El logo de la empresa»: subir, cambiar y quitar, y
  cada cosa lo dice. Lo que no vale (tipo o tamaño) se dice antes de subir.
- En la cabecera, el de la empresa; si no hay, el de la cuenta; si tampoco, la
  inicial. El esqueleto lee la empresa con `*`, así que hasta que la 0120 esté
  aplicada no pide la columna por nombre.
- Prueba de staging (`rollback`): como usuario de A sube el suyo, lo ve, no ve
  el de B, no sube en la carpeta de B, y la vuelta atrás quita políticas y
  columna. La e2e de la cuenta D sube un PNG, lo ve en la cabecera y lo quita.
- **Va en la tanda del S01** (clase «añadir»).

### Contabilidad › Definiciones › Analítica (0130 y 0140)

- **0130 · `conta_eje_analitico`**: una fila por empresa y eje (`local` →
  `journal_line.location_id`, `marca` → `brand_id`), encendido o apagado y con
  el nombre que quiera la empresa. **Sin fila = apagado.** RLS por cuenta (lee
  la cuenta; cambia el administrador o el gestor; la empresa tiene que ser de esa
  cuenta). Siembra: «Local» si la cuenta tiene locales, «Marca» si tiene marcas.
  Medido el 17/10 en producción, por cuenta: solo Foodint tiene empresa (3
  locales, 18 marcas; 345 apuntes con local y 203 con marca): las dos encendidas.
- **0140 · la regla 5 de la validación** (`conta_motivos_para_validar`, cambiar
  en caliente, misma firma): el local solo se pide con el eje «local» encendido.
  Es la vigente en producción (comprobada contra `pg_get_functiondef`) con dos
  cambios y nada más. Para Foodint no cambia nada.
- **Staging no tiene la tanda «Esperan» (M01)**, que crea esa función: la 0140 va
  en staging solo dentro de su prueba (ROLLBACK), que aplica antes la de C y la
  M01 si faltan, como la prueba de la M01. La 0130 sí se aplica de verdad.
- **Pantalla**: Definiciones › Analítica (nueva), con las piezas del sistema de
  diseño: cada eje se enciende, se apaga y se renombra, y lo dice. Definiciones
  tiene ahora cinta: PLAN · TABLAS (las nueve) · ANALÍTICA.
- **Apagado, ni se pide ni se enseña**: el asiento a mano (sin columna ni aviso;
  los apuntes van sin local), subir una factura, Bancos (el local de cada cuenta
  y tarjeta, y el alta de una cuenta o una tarjeta: van «común», que es lo que la
  base pide), el Mayor (sus filtros), el libro diario (pastillas, filtro y
  cabecera), el asiento (cabecera y pastillas), la PyG «Por local» y el local de
  la recepción al revisar una factura. Con su nombre: «Proyecto» si se llama así.
- **Queda, dicho:** el agente «libro» sigue mirando «6/7 sin local ni común» en
  todas las empresas. En producción no cambia nada hoy (Foodint tiene «Local»
  encendido); cuando la 0130 esté en producción, el agente leerá el eje.
- e2e (cuenta A): apaga «Local», el asiento a mano ya no lo pide, y lo vuelve a
  encender.

### El alta pone la marca de hostelería

- Al decir a qué se dedica la empresa, el alta pone `company.is_hospitality`
  y lo dice en la conversación («La marco como hostelería: salen… Se cambia en
  Ajustes › Empresa.»). Volver a «A qué te dedicas» mientras el alta está a
  medias la vuelve a poner.
- Es hostelería lo que da de comer, de beber o alojamiento: los grupos
  restaurante, bar, reparto, catering, heladería y alojamiento; a mano, IAE 67 y
  68 (sección 1) y CNAE 55 y 56. Una panadería u obrador, no.
- Medido en staging: en `iae_heading` el código lleva la sección delante
  («1_671»). La prueba está escrita contra esos códigos (regla 31).

### La cinta: el título de cada grupo, debajo (Julio, 17/10)

Medido a 1440 px: con el título al lado de sus botones, Bancos pedía ~1.365 px
(hay 1.210) y Libros y listados, tres filas. Julio eligió el título **debajo**
de sus botones, como en las barras de la N17 y la N22: Bancos cabe en una fila
(lo pedía la B01) y Libros y listados, en dos. La cinta mide 61 px por fila.
En la e2e, con los números de verdad de los libros de IVA, Libros y listados
salía en tres: IVA (siete libros con su número) mide ~970 px y no cabe al lado
de Diario y Mayor. Estados va ahora antes que IVA (el orden era propuesta mía,
no de maqueta) e IVA ocupa sola la segunda fila. «Ocultar» va al final de los
grupos y ya no le quita sitio a la primera.

### La cabecera, medida

A 1440 px y con un periodo al lado (el mes de Bancos, el ejercicio de Libros)
solo cabían dos pestañas. Con menos aire y la empresa hasta 180 px: Bancos, tres
de cuatro; Contabilidad sin periodo, las cinco. Lo que no cabe, en «Más ▾».

**Julio (17/10): «Favoritos» solo con su estrella, en todas las pantallas**, y
las cuatro de Bancos tienen que caber a 1440 px. Al pasar el ratón y para el
lector dice «Favoritos». Con eso no bastaba (medido con un nombre de empresa y
de usuario largos y la barra de desplazamiento: 1424 px útiles), así que además:

- el mes de Bancos, corto en la cabecera («Oct 2026», como el «2026 · Oct» de la N30);
- el nombre del usuario, hasta 110 px con «…» (entero al pasar el ratón y para el lector);
- la empresa, hasta 160 px (entera al pasar el ratón).

Medido a 1424 y 1440 px: las cuatro de Bancos a la vista, sin «Más ▾», también
con «María José Fernández de la Vega». Contabilidad con el ejercicio sigue
llevando a «Más ▾» la quinta (Importar o Cierre y Registro, según el ancho). La
e2e de la B01 lo comprueba.

## El enlace factura-asiento, paso 1 de 2 (inventario §11)

`supplier_invoice.journal_entry_id` (y las de `channel_settlement` y
`licensed_settlement`) no las escribe nadie: 0 de 7, 0 de 255 y 0 de 3 en
producción el 17/10. El enlace de verdad es `journal_entry.source_type` +
`source_id`, con su índice único para los vivos. En esta rama se deja de leerlas:

- **`propuestasLibroService`**: los tres `.is('journal_entry_id', null)` (que no
  filtraban nada) pasan a «sin asiento vivo de ese origen» —propuesto, borrador
  o validado, en la empresa—, leído por `source_type` + `source_id` en trozos de
  100. Los que ya lo tienen se cuentan en «ya estaban», que es lo que decía la
  base al intentar proponerlos. «Cómo se apunta» de una factura (N23) no filtra:
  enseña la propuesta aunque ya tenga asiento, como antes.
- **La 0150** (`banco_facturas_recibidas_pendientes`, cambiar en caliente): misma
  firma, mismo contrato (12 columnas, mismo nombre, tipo y orden), mismo cuerpo
  que el vigente (md5 `f6e2f68f…`, igual en producción y en staging el 17/10)
  salvo `journal_entry_id`, que ahora es el asiento vivo de la factura. El
  analizador la da por **sigue** (declarada en la cabecera y con prueba).
  Su prueba de staging, como usuario de A: nula sin asiento, ese asiento con
  uno en borrador, nula otra vez al borrarlo, las demás facturas igual, y la
  vuelta atrás byte a byte (md5 de antes).
- **Paso 2, otra tanda** (destruir, con «autorizo»): quitar las tres columnas y
  sus índices, volviendo a medir antes que siguen a 0. Y quitar la 0110 de la
  D01 del manifiesto de staging, que nombra la columna.

## `?tipo=` en el asiento a mano

La cinta de Asientos abre el asiento a mano con `?tipo=` (`lib/tipoAsiento.ts`):

- **Expedida** → serie Ventas, «Nueva factura expedida» y qué se apunta (430 al
  debe; 700 y 477 al haber), hasta que llegue Facturación.
- **Tesorería** → serie Banco, «Nuevo cobro o pago».
- **Predefinidos** → la lista de los predefinidos de la empresa
  (`entry_template`, del C04, que ninguna pantalla leía). Al elegir uno pone la
  serie, el concepto y los apuntes, y dice cuántos importes faltan y si alguna
  cuenta ya no se puede usar. **En producción hay 0** (tabla entera), así que
  el asiento a mano lleva además **«Guardar como predefinido»** (nombre y, si se
  quiere, con sus importes), que dice lo que ha guardado y dónde está.
- Un `?tipo=` desconocido es el asiento de siempre (la prueba cazó que
  `?tipo=toString` pasaba con `in`: ahora `Object.hasOwn`). Otra prueba mira que
  cada `?tipo=` de la cinta tiene su tipo.

## La prueba de la analítica medía mal la 3c (17/10)

En «Aplicar SQL» saltó «A ha podido escribir un eje en la cuenta B». **La
política aguantaba**: como usuario de A, la RLS de `company` no deja ver las
empresas de B, así que el `insert … select` de la prueba metía **0 filas sin
error**, y la prueba lo leía como que había entrado. La 3d tenía el mismo hueco
al revés: con la empresa de B nula, se saltaba y salía en verde sin probar nada.
Medido en staging dentro de un bloque deshecho: A ve 0 empresas de B, y las dos
escrituras dan 42501. Ahora la empresa de B se coge antes, como postgres, y las
dos escrituras van con `values`.

## Lo de hostelería en las demás pantallas

Sin la marca, ninguna pantalla habla de plataformas, liquidaciones ni socios:

- **Ventas**: con hostelería, como antes (el detalle de las plataformas llegará;
  hoy los asientos del cierre del día). Sin ella: «Tus ventas llegan con
  Facturación», y un enlace a «Apuntar una factura expedida» (`?tipo=expedida`).
- **Libro diario**: los textos de «Nada esperando» y «Nada que revisar» no
  nombran la plataforma ni las liquidaciones.
- **La ficha de un tercero**: «Más» solo ofrece añadir el papel de cliente (ni
  «plataforma de reparto» ni «socio de marca»). Un tercero que ya tenga esos
  papeles los sigue enseñando: lo guardado no se esconde.
- El ejemplo de razón social ya no es «Plataforma Norte Spain, S.L.».
- La e2e de la cuenta D lo mira en Ventas y entra desde ahí a la expedida.

## Recibida en Contabilidad › Asientos (maqueta 3)

**El mismo componente** que «Compras y gastos › Facturas recibidas» (N23), con
otro marco, como dice el inventario §6: la factura es una sola.

- `libros/diario/recibidas` (el botón «Recibida» de la cinta) abre la primera
  para revisar; sin ninguna, lo dice y enlaza a las facturas recibidas.
- `libros/diario/recibidas/:id`: migas «Contabilidad › Asientos › Recibidas ·
  1 de N para revisar», y arriba a la derecha «← Anterior», «Otra cosa» y
  **«Validar y siguiente ⏎»**. Intro hace lo mismo (no escribiendo ni con un
  diálogo abierto). Si queda validada pasa a la siguiente y allí dice lo que
  ha hecho (regla 8); si no, se queda y dice por qué.
- «Para revisar» desde Asientos no va por mes: son las de los **últimos 12
  meses**. Desde Compras y gastos, como antes, por el mes elegido.
- La unitaria del catálogo ya solo deja fuera de su producto a «Digitalizar»
  (subir un papel vive en Compras y gastos).

**Las tres cosas de la maqueta 3, decididas por Julio (17/10) y hechas:**

1. **«No es una factura»** (0160): un estado `descartada` con su motivo, quién
   y cuándo; sale de «para revisar» y se deshace. Nada se borra.
   - En la base: las columnas del descarte (`discarded_at`, `discarded_by`,
     `discarded_by_name`, `discard_reason`, `status_before_discard`), el CHECK de
     `status` ampliado (solo añade `descartada`) y una restricción: descartada ⇔
     con fecha, motivo y estado de antes.
   - `conta_factura_descartar` y `conta_factura_recuperar`, con el permiso de
     tocar la factura (ser de la cuenta). Cada una deja su línea en
     `document_activity` («descartada»; «deshecha» con `undo_of`). No se descarta
     una pagada, una con asiento vivo o con un pago casado en Bancos.
   - **Las repetidas**: `tg_supplier_invoice_no_repetida` trata la descartada
     como la anulada (cambiar en caliente, cuerpo de producción md5 a69d2408…).
     Si no, una descartada («es un presupuesto») habría bloqueado a la factura
     buena con el mismo número y total; y recuperar una descartada con otra igual
     viva habría metido una repetida sin decir nada. Ahora para (23505).
   - **N22** (`conta_documentos_recibidos`, md5 ea1dd614…): la descartada sale
     con su estado y «No es una factura: <motivo> (quién, fecha).». No se
     esconde (regla 7): está en «Todas».
   - Todo lo que lee por estados concretos (propuestas del libro, pendientes de
     Bancos, «le debes») la deja fuera sin tocarlo. En la ficha del proveedor y
     en las facturas de Compras sale como «No es una factura».
   - En la pantalla: «No es una factura» arriba (Asientos) o abajo (Compras y
     gastos), y en «Otra cosa» en el móvil. Se elige o se escribe el motivo;
     sin motivo no se descarta. Descartada, lo dice arriba con quién y cuándo, y
     «Deshacer: sí es una factura».
   - La prueba de staging, como usuario de A: descartar, N22, Bancos, dos veces,
     la buena repetida, recuperar con la otra viva (para) y sin ella, B, con
     asiento, sin motivo y la vuelta atrás (para con una descartada; sin
     ninguna, las dos funciones byte a byte como en producción).
2. **«Lo que he leído»**: de lectura, con **«Corregir en Compras»** al lado del
   título y «No es de este proveedor». Editable, con recálculo del asiento, va
   en un encargo propio justo después del S01.
3. **«Lo que he comprobado»**: el bloque verde, una línea por comprobación de la
   lectura (✓), y en ámbar las que no cuadran (no se esconden), más «No está
   repetida». **«Ver el asiento»** se pliega: abierto de serie, plegado para
   quien no tiene experiencia (lo que se ofrece, no dónde está).

## Queda (paso 3)

Nada más del inventario.
