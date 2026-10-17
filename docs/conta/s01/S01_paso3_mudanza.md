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

### La cinta: el título de cada grupo, debajo (Julio, 17/10)

Medido a 1440 px: con el título al lado de sus botones, Bancos pedía ~1.365 px
(hay 1.210) y Libros y listados, tres filas. Julio eligió el título **debajo**
de sus botones, como en las barras de la N17 y la N22: Bancos cabe en una fila
(lo pedía la B01) y Libros y listados, en dos. La cinta mide 61 px por fila.

### La cabecera, medida

A 1440 px y con un periodo al lado (el mes de Bancos, el ejercicio de Libros)
solo cabían dos pestañas. Con menos aire y la empresa hasta 180 px: Bancos, tres
de cuatro; Contabilidad sin periodo, las cinco. Lo que no cabe, en «Más ▾».
**Para Julio:** si se quiere ver siempre las cuatro de Bancos, lo siguiente que
da sitio (unos 70 px) es dejar «Favoritos» solo con su estrella. Eso cambia la
maqueta: no lo he hecho.

## Queda (paso 3)

Lo de hostelería que queda en otras pantallas (Ventas, textos del diario,
fichas, alta), Ajustes (Empresa con su logo, Registro de la IA, la marca de
hostelería), la marca al dar de alta, Definiciones › Analítica, la vista
Recibida en Contabilidad › Asientos, `?tipo=` en el asiento nuevo y el
`journal_entry_id` (paso 1).
