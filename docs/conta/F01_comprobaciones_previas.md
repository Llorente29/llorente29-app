# F01 · Marco Sumied — comprobaciones previas (tarea 1)

> Solo lectura: código en `origin/main` (`59d5923`), las ramas `conta/*` del
> remoto, los PR abiertos y producción por `execute_sql`, solo `select` de
> esquema. Nada cambiado en ningún sitio. 15/10/2026.

## La conclusión, en cinco líneas

1. **Ya hay un marco** (`MarcoConta` + `MenuConta`, C00) que envuelve **todas**
   las rutas del módulo desde `module.tsx`. El marco nuevo se pone en su sitio,
   en un solo fichero de rutas, y las pantallas viejas siguen dentro sin tocarlas.
2. **No hace falta ninguna tanda de base de datos** si la preferencia se guarda en
   el navegador por usuario (como ya hacen los favoritos de Libros) y si la
   empresa no lleva código (no existe ninguno: ver §5). Las dos son preguntas.
3. **Ningún PR abierto de A, B o C toca el libro diario, el marco, el menú ni los
   tokens.** El último que tocó `LibroDiarioPage.tsx` fue el #194 de C, ya fusionado.
4. **Hay cuatro choques con lo que existe** que no puedo resolver yo sin cambiar
   algo que no es mío: los colores y radios compartidos, el tema de Sumied, los
   tres Ctrl K que ya hay, y la rama `conta/f01-marco`, que el CI ya da al frente C.
5. El plan está en §7 y las preguntas en §8. **Paro aquí.**

---

## 1. Cómo está montado hoy

**Rutas.** `src/modules/conta/module.tsx` declara el módulo (`basePath: 'conta'`,
`chrome: 'propio'`, interruptor `conta`, solo administradores). Cada ruta se
envuelve con `enMarco(pagina, ejemplo, sinPregunta)` =
`<EmpresasProveedor><MarcoConta …>{pagina}</MarcoConta></EmpresasProveedor>`.
Solo `alta` (conversación a pantalla completa), `planCuenta` (redirige) y la
portada van fuera. **Ese `enMarco` es el único punto donde entra el marco**: se
cambia ahí y lo reciben las 32 rutas que lo llevan.

**Marco de hoy** (`marco/MarcoConta.tsx`, 36 líneas):
- `.cx` → `.cx-marco` → menú flotante a la izquierda (ordenador) + `<main>`;
- en el móvil, `BarraInferiorConta` (dos a cada lado del botón de la IA, y «Más»
  en el producto solo);
- la barra «Pregunta o pide algo» abajo, que hoy solo contesta «Muy pronto» y
  está quitada en Libros, Bancos, Documentos, el asiento y el asiento nuevo.

**Menú** (`src/config/navegacion.ts`, `MENU_CONTA`, una sola configuración):
13 entradas en 4 grupos. Las de `ruta: null` no se pintan (C00 §7):

| Hoy en el menú | Ruta | ¿Existe? |
|---|---|---|
| Inicio | `inicio` | solo en el producto solo |
| Por hacer | — | no |
| Compras | `compras` | sí |
| Ventas | `ventas` | sí (dice «Aún no.»; no sale en el producto solo) |
| Documentos | `documentos` (+ Catcher) | sí |
| Bancos | `bancos/:pestana` | sí |
| Clientes y proveedores | `clientes-y-proveedores` | sí |
| Pagos y cobros · Facturas que emites | — | no |
| Impuestos · Cómo va tu negocio | — | no |
| Libros | `libros/:area/:accion` | sí |
| Ajustes | `ajustes/…` (+ plan, tablas, Mayor `plan/:codigo`) | sí |

Arriba del menú, `CabeceraEmpresa` («Cambiar de empresa», «Dar de alta otra
empresa»), que lee `useEmpresas()` (`empresa/EmpresasProveedor.tsx`; la empresa
elegida se guarda en `localStorage` por cuenta). Abajo, «Volver a Folvy» (no en
el producto solo). Cada entrada lleva su número de pendientes
(`marco/useCuentasMenu.ts`: Compras, Clientes y proveedores, Libros, Bancos).

**Cómo se distingue Folvy de Sumied.** Dos señales:
- `MARCA` (`src/marca/marca.ts` ← `supabase/functions/_shared/marcas.ts`): se
  decide una vez por el dominio (`app.sumied.com`) o por `?marca=` fuera de
  producción. `CON_MARCA` dice si no es Folvy. **Ningún texto del módulo escribe
  la marca: la pide a `cuenta/marca.ts`.**
- `useProductoSolo()` = la marca es de solo contabilidad **o** la cuenta es solo
  de contabilidad. Con eso: Inicio en el menú, sin «Volver a Folvy», sin lo que
  dice «aún no», sin la barra de la IA.
- Sumied tiene **tema propio** (`marca/tema.ts`): escribe encima de los `--cx-*`
  la letra **Inter** y sus colores (tinta `#0B1F3B`, acción `#1E63C9`, acento
  turquesa). Ver choque 2.

**Estilo.** `estilo/tokens.css` es «el único sitio» de colores, letras y radios,
todo colgado de `.cx`. Geist y Geist Mono ya están instaladas (Fontsource, dentro
de la app). Hay 12 hojas por pantalla (`diario.css`, `libros.css`, `bancos.css`…).

**El libro diario hoy** (`libro/LibroDiarioPage.tsx`, 463 líneas, C04), dentro de
`LibrosPage area="diario"` (nivel 2: pestañas de área; nivel 3: barra de acciones
con «Tuyos», Favoritos y Buscar). Lo que hace y no se puede perder:
- elegir ejercicio (`?ejercicio=`); filtros por origen con su número (`?ver=`);
- cuatro cifras del mes (asientos, para revisar —pulsable—, el mes, resultado
  por local);
- franja del mes cerrado con «Pedir desbloqueo»; aviso del día en curso;
- «Proponer lo pendiente» (con la pregunta «¿Desde qué día asienta…?» y «Lo que
  no he propuesto, y por qué»), «Enviar a Diez», «+ Nuevo asiento»;
- cada asiento despliega sus apuntes, con enlace al Mayor y al asiento;
- estado con Diez de cada asiento de ventas (`ChipDiez`) y anular con Diez;
- «Lo que he hecho yo» con Deshacer; el cierre del mes anterior con sus pasos;
- en el móvil, por niveles.

## 2. Lo que ya existe y se aprovecha

| Pieza nueva | Lo que hay | Cómo se usa |
|---|---|---|
| Barra de módulos | `MENU_CONTA`, `entradaActiva`, `entradasVisibles`, `useCuentasMenu` (los globos ámbar), `CabeceraEmpresa` | se reordena la configuración en los 7 módulos; los números salen del mismo `useCuentasMenu` (misma vara, regla 31) |
| Pestañas arriba | `AREAS_LIBROS` (`libros/navegacion.ts`), las pestañas de `bancos/navegacion.ts`, `PESTANAS_AJUSTES` | son las pestañas de L, B y A |
| Buscador Ctrl K | `buscar()` de Libros y de Bancos (opciones por nombre y sinónimo) | entran como grupo «Opciones» del buscador general |
| Exportar | `libros/exportar.ts` (`excelTabla`, `pdfTabla` con jsPDF), `src/lib/descargaCsv.ts` | la tabla densa exporta con ellas, sin librerías nuevas |
| Panel del documento | `documentos/PapelPdf.tsx` (pdfjs), `compras/VerPapel.tsx` | el visor del panel |
| Lo propuesto | `MarcaIA`, `BloqueIA` (`ui/piezas.tsx`) | el recuadro «Por qué lo propongo así» |
| Estados, huesos, vacío, error | `Chip`, `Hueso`, `Vacio`, `ErrorConReintento`, `Guardado` | dentro de la tabla y el formulario |
| Diario | `lib/diario.ts` (filtros, cifras, estados, `marcaNegativoDiez`), `lib/conDiez.ts`, `diarioService` | el diario nuevo lee lo mismo; solo cambia cómo se pinta |
| Preferencia por usuario | `leerFavoritos`/`alternarFavorito` (`localStorage` con la clave por usuario) | el mismo patrón para densidad y barra plegada |

No hay tabla densa ni formulario por bloques reutilizables: cada pantalla pinta
los suyos. Esas dos piezas son nuevas de verdad.

## 3. Dónde se guarda la preferencia (densidad, barra plegada, panel oculto)

Medido en producción (`information_schema.columns`): **no hay ninguna tabla ni
columna de preferencias de usuario** (ni en `user_profiles`, ni `*_settings` por
persona). Dos caminos:

- **A · En el navegador, por usuario** (`localStorage`, clave
  `folvy.conta.marco.<usuario>`), como los favoritos de Libros. Sin base de
  datos. Se recuerda por usuario **en ese ordenador**: en otro, empieza en
  compacta y plegada. Ya está escrito en el repositorio que es «una comodidad,
  no un dato».
- **B · En la base**: una tabla nueva `conta_user_preference (user_id, clave,
  valor)` con RLS por usuario. Es «añadir»: pasa siempre por el analizador,
  pero es una tanda, y Julio la lanza.

**Recomiendo A**: lo que se pierde es que la densidad no viaje entre ordenadores,
y no justifica una tanda. Si se quiere B, cabe más tarde sin cambiar las piezas
(una sola función lee y escribe).

## 4. PR abiertos y ramas de A, B y C

PR abiertos (15/10, 21:00):

| PR | Frente | Qué toca | ¿Choca? |
|---|---|---|---|
| [#202](https://github.com/Llorente29/llorente29-app/pull/202) | A | contadores de Catcher (`LoteCatcherPage`, `QuincenaCatcher`, `catcherCuenta`) | no |
| [#201](https://github.com/Llorente29/llorente29-app/pull/201) | C | semillas de staging y la prueba del agente | no |
| [#172](https://github.com/Llorente29/llorente29-app/pull/172) (borrador) | — | solo un `.md` de comprobaciones | no |
| #165, #78, #50 | Cocina | nada de contabilidad | no |

Ramas `conta/*` con commits que no están en `main`: todas las que tocan
`module.tsx`, `navegacion.ts`, `tokens.css`, `MarcoConta`, `MenuConta` o
`LibroDiarioPage.tsx` (`c06-sola`, `b01-bancos`, `d01-recibidas`, `d01-catcher`,
`c06b-patrones-numeracion`, `c06b-validar-pdf`) **ya están fusionadas** (#181,
#187, #188, #198, #194, #186). Las vivas sin fusionar (`b02-conciliacion`,
`d01-liquidaciones-estudio`) no tocan nada de esto.

**Libro diario: C no tiene ningún PR abierto que lo toque.** Pero sí van a
chocar dos cosas compartidas en cuanto haya trabajo nuevo:
- `src/config/navegacion.ts` y `module.tsx`: cada pantalla nueva de A, B o C
  añade ahí su ruta. Mi cambio reordena el menú entero. Conviene fusionar el
  marco pronto y avisar a los tres.
- `tests/e2e/conta/c00/marco.spec.ts` es del **juego común** (corre en el push
  de cualquier frente) y otras 7 pruebas buscan el menú de hoy (`.cx-menu`,
  «Menú de contabilidad», «Volver a Folvy», «Cambiar de empresa»):
  `c00/flujos`, `c04/libro`, `c06/sola`, `d01/documentos`, `compras/compras`,
  `solapes.ts` y la unitaria `marcaC06.test.ts`. Cambiar el marco las rompe a la
  vez para todos: van en el mismo PR que el marco.

## 5. Lo que la maqueta pide y hoy no existe

- **El código de la empresa («1044»).** No hay ninguno: `company` no tiene
  columna de código (la única con «number» es `fiscal_number`, que es el número
  de la calle), ni en lo de Diez. Medido en `information_schema`. O se enseña
  solo el nombre, o hace falta una columna (añadir, tanda). Pregunta 4.
- **Ejercicio y periodo arriba («2026 · Oct ▾»).** Hoy cada pantalla elige el
  suyo (el diario con `?ejercicio=`, Libros con su contexto, Bancos con el suyo).
  Uno arriba que una pantalla vieja no lee diría una cosa y la pantalla otra:
  es la regla 30 (la lista con la que se elige no es la que se lee). Pregunta 5.
- **El módulo I (Impuestos)** no tiene ninguna pantalla. Pregunta 3.
- **Inicio y Por hacer** no están en los 7 módulos. Pregunta 3.
- **«Vistas guardadas» y «+ Guardar vista»**: dónde se guardan, el mismo caso que
  la densidad (§3).

## 6. Los cuatro choques

1. **Colores y radios compartidos.** La maqueta N30 cambia valores que hoy usan
   **todas** las pantallas: fondo `#F5F7FA`→`#EEF1F5`, línea
   `#E6EAF0`→`#DDE3EB`, ámbar `#8A4B00`/`#FFF1DC`→`#7A4A00`/`#FFE7B8`, radios
   24/20/14/12 px → 8/6/5 px, y quita el degradado de fondo y las sombras
   grandes. Si cambio `tokens.css`, cambio por dentro el aspecto de las
   pantallas de A, B y C (y sus capturas) sin que lo pidan. Lo que propongo:
   **los tokens nuevos viven en un ámbito propio (`.cxm`)** que usan el marco y
   las tres piezas; las pantallas viejas se ven dentro del marco con su estilo
   de hoy hasta que su sesión las pase. Pregunta 1.
2. **El tema de Sumied.** Hoy Sumied pinta en Inter, con `#0B1F3B` y `#1E63C9`.
   La maqueta dice Geist y `#2F5BFF` «en Folvy y en Sumied». Pregunta 2.
3. **Ctrl K ya lo usan tres.** `LibrosPage`, `BancosPage` y `BarraPregunta`
   escuchan Ctrl K en `window`. Con un buscador general habría dos ventanas a la
   vez. Sin tocarlas por dentro: el marco escucha **antes** (fase de captura) y
   corta la tecla, y sus «Buscar» siguen funcionando con el ratón; sus opciones
   entran en el buscador general como grupo «Opciones». La barra de la IA no
   sale en el marco nuevo (solo dice «Muy pronto» y la maqueta no la tiene).
4. **La rama `conta/f01-marco` ya es del frente C.** El paso «Frente» de
   `e2e-staging-conta.yml` y `scripts/conta/capturas.mjs` casan
   `conta/f[0-9]*` con **C** («facturas emitidas, F01…»). Con ese nombre, mis e2e
   entrarían con los usuarios dobles de C y le cambiarían la contraseña en mitad
   de sus pruebas; y «fijar_capturas» solo dejaría fijar carpetas `c…`, no
   `f01/`. Y la sesión de Code me ha dado la rama `claude/hopeful-clarke-f8p14x`,
   que no tiene frente: corre la suite entera y no puede fijar nada. Hace falta
   un frente D (una línea en el workflow, una en `capturas.mjs` y su prueba, y
   sus usuarios en `seed_e2e_frentes_staging.sql`, que es semilla de staging y
   la lanza Julio). Pregunta 6.

## 7. El plan

**Sin tanda de base de datos** (si las respuestas 3, 4 y 6 son las recomendadas).

**Tarea 2 · El marco** (`marco/nuevo/…`, y `enMarco` en `module.tsx`):
- `estilo/marco.css` con los tokens de N30 en `.cxm` (choque 1);
- barra de módulos: plegada 76 px / desplegada 232 px, círculos con letra,
  activo azul, globo ámbar con `useCuentasMenu`; «»» la abre y se recuerda (§3);
- los 7 módulos se declaran en `navegacion.ts` (`MODULOS_CONTA`), con sus
  pestañas y qué rutas caen en cada uno, de modo que la pestaña activa sale de
  la ruta (sin tocar las pantallas);
- barra superior de 48 px: empresa (reusa `useEmpresas`), ejercicio y periodo
  (pregunta 5), pestañas con «Más ▾» si no caben, buscador, Cómoda | Compacta y
  usuario (con «Volver a Folvy» dentro, fuera del producto solo);
- barra de acciones: un hueco que la pantalla llena (`<AccionesPantalla>`, con
  la tecla dibujada); las viejas la dejan vacía y no se pinta;
- buscador Ctrl K: asientos (número, concepto), facturas recibidas y emitidas
  (número, tercero, importe), clientes y proveedores (nombre, NIF) y subcuentas
  (código, nombre), más las opciones de Libros y Bancos; agrupado por tipo, ↑↓
  e Intro. Lee con el cliente de siempre, **cada consulta con `account_id` y
  `company_id`** (regla 9), cinco por grupo. Cada nombre de tabla entre comillas
  se comprueba contra el esquema y se pega (regla 40);
- móvil: barra inferior con 4 módulos y «Más» (la hoja que ya existe);
- las e2e del menú que cambian (§4), en el mismo PR.

**Tarea 3 · Las tres piezas** (`ui/marco/`), cada una con prueba unitaria y una
página de ejemplo en staging (ruta `ejemplo-marco`, solo fuera de producción,
con datos inventados):
- `TablaDensa`: cabecera fija, filas por densidad, cifras en mono a la derecha,
  filtros, vistas guardadas, exportar (Excel/CSV/PDF con lo de `exportar.ts`),
  ↑↓ Intro Espacio, pie con filas y «Debe · Haber · Cuadra», franja «Te toca hoy»;
- `FormularioBloques`: rejilla de 6, campos de 30 px, lo propuesto en azul claro
  con su línea, Tab/Intro, F4, Ctrl S, Ctrl Intro, Av Pág/Re Pág, «3 de 12»
  (sin F5, F10, F11 ni F12);
- `PanelDocumento`: 420 px, PDF o foto con −/+, Cambiar, Ocultar › (se
  recuerda), y «Por qué lo propongo así».

**Tarea 4 · El libro diario en el marco**, la guía `docs/conta/marco.md`, las
capturas (fijadas con el frente D), el informe y el PR:
- el diario pasa a `TablaDensa`; todo lo de §1 se queda (lista de comprobación
  en el informe, punto a punto); añade el número en Diez de cada asiento, las
  vistas y el cuadre en el pie;
- **toca `LibrosPage.tsx`, que es de C**: en el marco nuevo, sus pestañas de
  área pasan arriba y la página no debe pintarlas otra vez. Es un cambio
  pequeño (no pintar el nivel 2 cuando el marco ya lo enseña), y aviso a C.

## 8. Lo que pregunto

1. **Colores y radios** (choque 1). ¿Las pantallas viejas se quedan con su
   estilo de hoy dentro del marco nuevo hasta que su sesión las pase (lo que
   recomiendo), o cambian todas ya a los colores y radios de N30?
2. **Sumied** (choque 2). ¿En el marco nuevo Sumied va en Geist y con los
   colores de N30, como Folvy, o conserva su tema (Inter, `#1E63C9`)?
3. **Los 7 módulos.** Propongo: V ← Ventas · C ← Compras **y Documentos**
   (facturas recibidas y Catcher como pestañas) · B ← Bancos · L ← Libros (y el
   Mayor del plan) · P ← Clientes y proveedores · A ← Ajustes. Y además:
   - **I (Impuestos)** no tiene pantalla: ¿no se pinta hasta que la tenga (como
     dice el C00) o sale apagado?
   - **Inicio** (producto solo) y **Por hacer**: ¿Inicio se abre pulsando el
     nombre de la empresa, o como primer módulo? «Te toca hoy» cubre Por hacer
     dentro de cada pantalla.
4. **El código de la empresa** («1044»): no existe. ¿Solo el nombre, o se añade
   una columna (tanda)? Y si va: ¿es el código de la empresa en Diez?
5. **Ejercicio y periodo arriba.** ¿Se enseña solo en las pantallas que ya lo
   leen (el diario, al pasarlo) y en las viejas no sale, o sale en todas aunque
   las viejas no le hagan caso? Recomiendo lo primero (regla 30).
6. **La rama y el frente.** ¿Me das un frente D propio (propongo ramas
   `conta/m01-*`, capturas en `docs/conta/capturas/m01/`)? Son dos líneas de
   CI y su prueba, que hago yo, y una semilla de staging de usuarios que lanzas
   tú. Si no, ¿uso `conta/f01-marco` como frente C, sabiendo que comparte
   usuarios con C?
7. **La preferencia** (§3): ¿en el navegador por usuario (recomendado, sin
   tanda) o en la base?
