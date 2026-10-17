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

## Queda (paso 3)

Compras y gastos (cintas de Por revisar, Facturas recibidas y Liquidaciones),
las condiciones de hostelería dentro de las pantallas, Contactos y sus
pestañas, Ajustes (Empresa con su logo, Registro de la IA, la marca de
hostelería), la marca al dar de alta, Definiciones › Analítica, la vista
Recibida en Contabilidad › Asientos, `?tipo=` en el asiento nuevo y el
`journal_entry_id` (paso 1).
