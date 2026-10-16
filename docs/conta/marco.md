# Pasar una pantalla al marco nuevo

> Para A, B y C. M01 (encargo F01, tareas 2 a 4). Maqueta N30, aprobada por
> Julio el 15/10. La primera pantalla pasada es el libro diario
> (`src/modules/conta/libro/LibroDiarioPage.tsx`): úsala de ejemplo.
> Las tres piezas, con datos inventados, se ven en staging en
> `/conta/ajustes/muestra-piezas` (fuera de producción no existe otra cosa;
> en producción esa ruta no se monta).

## Lo que ya tienes sin hacer nada

Toda ruta que `module.tsx` envuelve con `enMarco(...)` ya va dentro del marco:

- la barra de módulos;
- la barra de arriba, con la empresa, las pestañas del módulo, «Buscar todo» (Ctrl K) y Cómoda | Compacta;
- el buscador general.

Una pantalla vieja **se ve igual que antes** dentro del marco, con su estilo y sus tokens (`tokens.css`). Pasarla es opcional y se hace pantalla a pantalla.

## Los cinco pasos

1. **Sus pestañas, al marco.** Si la pantalla pinta pestañas propias, quítalas y declara las del módulo en `src/modules/conta/marco/nuevo/modulos.ts`:
   - `pestanas`: etiqueta, ruta y los prefijos que la marcan;
   - quita `pestanasEnLaPantalla` si lo tenía (Bancos lo tiene hasta que B lo pase).

   La prueba de `tests/unit/modules/conta/m01/marco.test.ts` comprueba que toda ruta de `CONTA.rutas` cae en su módulo. Si añades una ruta, ponla en su `ESPERADO`.

2. **Sus botones, a la barra de acciones.** En vez de una cabecera con botones:

   ```tsx
   <AccionesPantalla etiqueta="Acciones del libro diario">
     <BotonAccion principal tecla="Ins" atajo="Insert" onClick={nuevo}>+ Nuevo asiento</BotonAccion>
     <BotonAccion onClick={proponer}>Proponer lo pendiente</BotonAccion>
   </AccionesPantalla>
   ```

   - `tecla` es lo que se dibuja y `atajo` lo que oye el lector.
   - La tecla la escucha **tu** pantalla, y no salta mientras se escribe en un campo (mira `escribiendo()` en el diario).
   - **Nunca uses F5, F10, F11 ni F12**: son del navegador. Ctrl K es del marco.

3. **El ejercicio o el periodo, arriba**, solo si la pantalla ya lo lee (decisión 8 de Julio):

   ```tsx
   <PeriodoEnBarra><select className="cxm-select">…</select></PeriodoEnBarra>
   ```

   Si la pantalla está dentro de otra que ya lo pone (el diario dentro de Libros), no lo repitas.

4. **El título grande, fuera.** El nombre ya lo dicen el módulo y la pestaña. Deja un encabezado para el lector:

   ```tsx
   <h2 className="cx-oculto">Libro diario</h2>
   ```

   Tus e2e lo buscan con `toHaveCount(1)`, no con `toBeVisible()`.

5. **Su contenido, con las piezas** (abajo). Usa los tokens del marco (`--cxm-*`, `marco.css`), nunca colores escritos. Tu CSS va en tu hoja, bajo `.cxm`. Mira cómo lo hace `estilo/libroMarco.css`.

## Las tres piezas

### Tabla densa · `ui/tabla/TablaDensa.tsx`

Para cualquier listado.

**Qué hace tu pantalla y qué hace la pieza:**
- **Tu pantalla** filtra sus filas, porque sabe qué es cada una, y le pasa las que se ven.
- **La pieza** las pinta, las mueve con el teclado, las marca y las baja.
- **El núcleo** (filtros, vistas guardadas, cuadre, CSV) está en `ui/tabla/tablaDensa.ts`, con pruebas en `tests/unit/modules/conta/m01/piezas.test.ts`.

| Prop | Para qué |
| --- | --- |
| `etiqueta`, `nombreFila` | El nombre de la tabla para el lector, y «asiento» / «asientos» para el pie. |
| `filas`, `total`, `clave` | Las filas ya filtradas y cuántas hay sin filtros. El pie dice «12 de 340 asientos» (regla 7). |
| `columnas` | `{ id, titulo, celda, exportar?, cifra?, ancho?, pesoPdf? }`. Las cifras van a la derecha y en mono. Sin `exportar`, la columna no se baja. |
| `teTocaHoy` | Chips con su número que filtran al pulsarlos: «…» mientras cuenta y «—» si no se pudo contar. |
| `vistas` | Botones como «Todos» o «Para revisar · 4», más las que guarda la persona (`guardarVista` / `leerVistas`, en el navegador y por usuario) y «+ Guardar vista». |
| `filtros` | `{ campos, valores, alCambiar }`. Tipos: `desde`, `hasta`, `opciones` y `texto`. Las listas salen de lo que hay en tus datos (regla 30) y la fila se comprueba con `cumpleFiltros`. |
| `exportar` | Excel, CSV y PDF de lo que se ve, o solo de lo marcado. Lo dice en pantalla con el nombre del fichero y cuántas filas (regla 8). |
| `cuadre` | El Debe y el Haber de cada fila. El pie dice «Debe … · Haber … · Cuadra», o la diferencia. |
| `alAbrir`, `abierta`, `detalle` | Intro o un clic. Para desplegar algo debajo de la fila, pasa `abierta` y `detalle`. |
| `movil`, `tarjeta` | En el móvil, una lista de tarjetas en vez de la tabla. |

- **Teclado:** ↑ ↓ moverse, Inicio y Fin, Av Pág y Re Pág, Intro abrir, Espacio marcar. El pie lo dice.
- **Densidad:** el alto de fila lo pone el marco. En compacta salen unas 30 filas por pantalla y en cómoda unas 20; no lo fijes tú.
- **En una e2e:** la tabla es `getByRole('grid', { name })` y cada fila es `getByRole('row', { name })`. En el móvil, `getByRole('list')` con botones.

### Formulario por bloques · `ui/formulario/FormularioBloques.tsx`

Para rellenar un documento, como el de factura de ERP10.

- **Bloques:** `{ id, titulo, campos?, contenido?, ancho? }` en una rejilla de 6 columnas.
- **Campos:** `{ id, etiqueta, columnas?, tipo?, propuesto?, soloLectura? }`.
- **Lo propuesto:** `propuesto` es lo que propone la máquina. Sale en azul claro hasta que Tab lo acepta o se escribe otra cosa, y una línea arriba lo explica.
- **Teclado:**

  | Tecla | Qué hace |
  | --- | --- |
  | Tab e Intro | Siguiente campo |
  | F4 | Buscar subcuenta, en los campos `tipo: 'subcuenta'`, con la lista `subcuentas` |
  | Ctrl S | `alGuardar` |
  | Ctrl Intro | `alValidar` |
  | Av Pág / Re Pág | `posicion.siguiente` / `posicion.anterior` («3 de 12») |

- **Lo que pasa al guardar** lo pones tú en `aviso`, con contenido.
- **Núcleo:** `ui/formulario/formulario.ts`. Una prueba falla si alguna tecla usa F5, F10, F11 o F12.

### Panel del documento · `ui/documento/PanelDocumento.tsx`

Va en `documento` del formulario, a la derecha, en unos 420 px.

- **Qué recibe:** `titulo`, `url` (firmada si es privada), `tipo` (`'pdf'` o `'imagen'`), `alCambiar` y `porque` (el recuadro «Por qué lo propongo así»).
- **Ocultar ›** deja el formulario a todo el ancho y se recuerda por usuario (preferencias del marco).
- **Sin documento** lo dice, con «Subir» si pasas `alCambiar`.
- **En el móvil o por debajo de 1.100 px**, baja debajo del formulario.

## Antes de subir

- `scripts/conta/antes-de-subir.sh`, como siempre.
- **Las e2e que miraban tu pantalla vieja, en el mismo PR.** Lo que cambia al pasar el diario está en `tests/e2e/conta/c04/libro.spec.ts`:
  - `filaDe(page, …)` busca una fila en el ordenador y una tarjeta en el móvil;
  - la altura de fila se mide contra `--cxm-fila`.
- **Las capturas de tu pantalla en compacta y en cómoda** las sacas cambiando la densidad con el grupo «Densidad» de la barra de arriba. Mira `tests/e2e/conta/m01/marco.spec.ts`.
