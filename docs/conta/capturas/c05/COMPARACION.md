# C05 · Capturas junto a las maquetas

Maquetas aprobadas: `docs/conta/maquetas/c05/N13cLibros.(dc.html|png)` (Libros
en tres niveles, con «Facturas recibidas» abierta), `N14Balance.(dc.html|png)`
(balance de situación) y `N15Registro.(dc.html|png)` (facturas expedidas). Todas
a 1440. El móvil sigue a M4 (C01b), como en los encargos anteriores.

Capturas de staging-conta sacadas por la e2e `tests/e2e/conta/c05/libros.spec.ts`
(ordenador 1440 × 900 y móvil 390 × 844, página entera) con las semillas
INVENTADAS del C04 y del C05 (`supabase/seeds/conta/seed_c05_staging.sql`), en
la ejecución verde **153** (sobre `09426b8`; las subió el propio e2e en
`9cdf62c`). La 152 se quedó en rojo por tres pruebas mías y no subió capturas:
lo cuenta `docs/conta/C05_informe_final.md`.

| Pantalla | Ordenador | Móvil |
|---|---|---|
| Libros, primer nivel (áreas) | — (en ordenador se entra a un área) | `indice-movil.png` |
| Balance de situación (N14) | `balance-ordenador.png` | `balance-movil.png` |
| PyG por local | `pyg-por-local-ordenador.png` | — (en móvil, la PyG oficial) |
| Sumas y saldos | `sumas-saldos-ordenador.png` | `sumas-saldos-movil.png` |
| Facturas expedidas (N15) | `expedidas-ordenador.png` | `expedidas-movil.png` |
| Facturas recibidas (N13c) | `recibidas-ordenador.png` | `recibidas-movil.png` |
| Ejercicios (con el 2025 traído) | `ejercicios-ordenador.png` | `ejercicios-movil.png` |
| Qué cuentas alimentan cada línea | `mapeo-ordenador.png` | `mapeo-movil.png` |
| Cuentas anuales del ejercicio | `cuentas-anuales-ordenador.png` | `cuentas-anuales-movil.png` |
| Cuenta B: PyG sin «Por local» | `cuenta-b-pyg-ordenador.png` | `cuenta-b-pyg-movil.png` |

Las cifras no son las de la maqueta: son las de la semilla (otro restaurante,
otras fechas, un trimestre con una sola anotación). Lo que se compara es la
forma.

**Lo que es de la captura, no de la pantalla.**
- La barra de la IA (y, en móvil, la de abajo) es `position: fixed`: en una
  captura de página entera sale pintada a la altura de la ventana, encima de lo
  que haya ahí. En `balance-ordenador.png` tapa «A-1) Fondos propios»; en
  `recibidas-movil.png` tapa los favoritos. En uso real no tapa nada al
  desplazarse, y la e2e lo mide con `loQueTapan`: cero.
- La franja ocre de arriba es la de staging («NO ES PRODUCCIÓN»).
- El menú del módulo solo tiene «Clientes y proveedores», «Libros» y «Ajustes»:
  las demás entradas de la maqueta (Inicio, Por hacer, Documentos, Bancos…)
  son de encargos que aún no existen.

## N13c · Libros en tres niveles

**Igual que la maqueta.**
- Título «Libros» con «Contabilidad» encima y el ejercicio arriba a la derecha.
- Las seis áreas en la fila de pestañas: Diario, Mayor y saldos, Libros
  registro de IVA, Balances, Cuentas anuales y Registro, Cierre.
- La barra de acciones agrupada (FACTURAS · OTROS LIBROS · SALIDAS · TUYOS),
  cada acción con su punto de estado y su dato debajo («4T · 1 · 1 sin NIF»,
  «1 bien», «ninguna»), la abierta resaltada.
- Migas «Libros › Libros registro de IVA», título de la acción y cuatro cifras
  en tarjetas.
- En móvil, por niveles: primero las áreas (`indice-movil.png`); al tocar una,
  «‹ Libros» y sus acciones en lista.

**Distinto, y por qué.**
1. **El periodo es un desplegable** con los cuatro trimestres del ejercicio y
   «Todo el ejercicio», no el segmento «3T 2026 · Mes · Entre fechas». «Mes» y
   «Entre fechas» no están: el libro registro se lleva y se pide por
   trimestre.
2. **Tres botones de salida iguales** («Exportar PDF», «Excel», «Formato AEAT»)
   en vez de «Imprimir · PDF» y un «Exportar · formato AEAT» azul. El formato
   AEAT tiene además su propia acción en SALIDAS, con el zip de documentos.
3. **Las cuatro cifras son las del libro**, no las de la maqueta: base, cuota,
   «Cuadre con el diario» (la 472/477 del periodo contra el libro) y «Por
   completar N de M». La tarjeta de retenciones de la maqueta vive en la acción
   «Retenciones», por modelo y trimestre.
4. **«Filtros del listado de facturación»**, plegados encima de la tabla: no
   están en la maqueta. Son el listado de facturación de Diez (respuesta 1):
   subcuenta, NIF, «importe superior a», tipo de factura, «agrupar por NIF» y
   «solo las del 347». Con filtros, la cabecera dice «N de M» (regla 7).
5. **La clave va debajo del número** («R1 · rectificativa», «F4 · resumen ·
   art. 63.4 · …») y no en una columna CLAVE con chip; el NIF va en su columna y,
   si falta, la fila lo dice en ámbar con «Completar».
6. **Fechas completas** («02/10/2026»), no «30/09».
7. **Sin la nota al pie** «Columnas del formato normalizado… Ver las 61»: la
   tabla enseña todas las anotaciones del periodo, sin «ver las N» (regla 7).
8. **Las recibidas de la semilla salen sin expedidor** («—» y «Falta NIF del
   expedidor · Completar»). Es la semilla: el C04 y el C05 proponen esos
   asientos sin tercero. El camino real lo manda en el asiento
   (`propuestasLibroService`), y la prueba de staging lo comprueba ahora en su
   paso 5 (NIF y nombre del tercero en el libro registro).

## N14 · Balance de situación

**Igual que la maqueta.**
- Migas «Libros › Balances», título, segmento «Oficial · Detallado», fecha de
  corte, «Qué cuentas alimentan cada línea» y la salida.
- La barra verde de la IA, «Lo que veo en este balance», con tres notas: saldos
  del lado contrario (las cuentas, en ámbar en la tabla), patrimonio neto
  negativo con su cita y el modelo que toca con «Cómo se decide».
- Activo a la izquierda y «Patrimonio neto y pasivo» a la derecha, con la
  columna del ejercicio anterior en gris, los «+» que abren las cuentas de cada
  línea y el pie «Cuadra · Activo = PN + Pasivo · ✓ 0,00 €».

**Distinto, y por qué.**
1. **Salen TODAS las líneas del modelo**, también las que están a cero («—»),
   no solo las que tienen importe. Es el modelo oficial, y la regla 7: el
   umbral no decide qué línea existe. Por eso la captura es más larga.
2. **El total va abajo** («TOTAL ACTIVO (A + B)»), como en el modelo del BOE, y
   no arriba.
3. **La columna del año anterior está a cero.** La semilla trae el 2025 de
   «otro programa» y cerrado allí, pero sin saldos: la columna sale con «—» y
   el total a 0,00 €. Con los saldos de Diez que vendrán, se llena.
4. **La cita es la LSC, no el Código de Comercio** (art. 257.1 LSC y RD
   1515/2007 art. 2.1; el encargo citaba «art. 257 CCom»). La barra lo dice
   con las cifras de la empresa: activo, cifra de negocios y plantilla.
5. **La fecha de corte es un desplegable** («A 08/10/2026» y los fines de mes
   del ejercicio), no un botón.

## N15 · Facturas expedidas

**Igual que la maqueta.**
- Migas, título «Facturas expedidas», cuatro cifras (base, IVA repercutido,
  cuadre con el diario con su ✓, y la cuarta).
- El resumen de tiques en una sola anotación con su rango y su número de
  tiques, como destinatario «VENTAS A CONSUMIDOR FINAL».

**Distinto, y por qué.**
1. **El resumen es F4, no «F2 · resumen».** Respuesta 1: el asiento resumen de
   tiques es F4 en el diseño de registro de la AEAT. La fila dice «F4 ·
   resumen · art. 63.4 · T1-000101–T1-000105 · 5 tiques».
2. **La cuarta cifra es «Por completar N de M»**, no «Para el 303 · Listo»: el
   303 es del encargo de Impuestos; aquí lo que se puede hacer es completar.
3. **Las pestañas Expedidas / Recibidas / Bienes / Intracomunitarias** no van
   en un segmento junto al título: son acciones de la barra del nivel 3 (N13c),
   que es la que manda (el N15 es anterior).
4. Lo mismo que en N13c sobre el periodo, los botones de salida, la clave y las
   fechas.

## Lo que las capturas enseñaron y ya está arreglado

Mirarlas una a una sacó cinco fallos de pantalla. Los cinco están arreglados en
el commit siguiente a estas capturas. La e2e vigila los dos primeros, y la
próxima ejecución sube capturas nuevas.

1. **«1 anotaciones.»** en expedidas. Ahora «1 anotación.» (y en los avisos de
   exportar). La e2e de expedidas lo mira con una expresión que falla con «1
   anotaciones».
2. **La PyG por local escondía un local.** Las columnas salían solo de los
   locales con apuntes, y Norte Mercado no tiene: no aparecía. Ahora salen todos
   los locales de la empresa y «Común», a cero si no hay nada (regla 7). La e2e
   pide las tres columnas.
3. **La barra de acciones de Cuentas anuales no cabía a 1440.** «Depósito de
   cuentas» salía cortado y «Tuyos», fuera de la vista, en un desplazamiento
   lateral sin barra visible. Ahora la barra parte en dos filas.
4. **Los subtítulos de las tarjetas** («Modelo de 2026…», «Los estados»,
   «Historial»…) usaban la clase del título de la página, 32 px. Ahora tienen
   la suya, 20 px.
5. **En el mapeo, «700cambiardejar fuera»**: la píldora es `inline-flex` y se
   comía los espacios entre el código y sus botones. Ahora van separados, y la
   píldora no corta con «…» las que llevan «· tuyo» y tres botones.
