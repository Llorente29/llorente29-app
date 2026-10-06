# C03 · Capturas junto a las maquetas

Maquetas aprobadas: `docs/conta/maquetas/c03/N9Cliente.(dc.html|png)` (ficha de
una plataforma de reparto, 1440) y `N10Socio.(dc.html|png)` (ficha de un socio de
marca, 1440). El móvil sigue a M4 (C01b), como pide el encargo.

Capturas de staging-conta sacadas por la e2e `tests/e2e/conta/c03/terceros.spec.ts`
(ordenador 1440 × 900 y móvil 390 × 844, página entera), en la cuenta A, con la
semilla INVENTADA `supabase/seeds/conta/seed_c03_staging.sql`: los mismos
nombres y cifras que las maquetas («Plataforma Norte», «Marcas del Sur»,
6.420 − 1.180 + 1.647 = 6.887 €), con NIF inventados de control válido.

| Pantalla | Ordenador | Móvil |
|---|---|---|
| Clientes y proveedores (lista única) | `lista-ordenador.png` | `lista-movil.png` |
| Plataforma (N9) | `plataforma-ordenador.png` | `plataforma-movil.png` |
| Liquidaciones de la plataforma | — (en la ficha) | `plataforma-liquidaciones-movil.png` |
| Socio de marca (N10) | `socio-ordenador.png` | `socio-movil.png` |
| Cliente normal | `cliente-ordenador.png` | `cliente-movil.png` |
| Cliente archivado | `cliente-archivado-ordenador.png` | — |

## N9 · Plataforma: igual que la maqueta

**Cabecera.** Avatar con iniciales, migas «Clientes y proveedores › Plataformas»,
nombre y, debajo, las píldoras: «Plataforma de reparto» (ámbar), «También
proveedor · comisiones», razón social, «B… ✓ comprobado» (verde) y «Liquida
cada 15 días». A la derecha, «Editar» y «Subir liquidación».

**Pestañas.** Ficha · Datos fiscales · Contactos · Cobro · Liquidaciones ·
Contabilidad · Documentos · Historial.

**Las cuatro cifras.** «Te debe» (con la frase de qué liquidaciones y lo que
falta en el banco, en ámbar), «Te ha vendido este año» (con los pedidos),
«Comisiones este año» (en negativo, % de media y a qué cuenta van) y «Última
liquidación» (su periodo y si cuadró con el banco, en verde).

**Liquidaciones.** Columnas FECHA · PERIODO · ventas − comisiones = neto · NETO
· estado. Cada fila con la cuenta entera («16–31 ago · 8.905,00 € − 1.870,00 € =
7.035,00 €») y debajo lo que pasó: «cuadra con el banco» (verde), «faltan
212,30 € en el banco» (ámbar), «llega el 20». Chips Pendiente (azul), Cobrada
(verde), Con diferencia (ámbar). Pie: cómo serán sus apuntes, con su cuenta 430.

**Columna derecha.** «Lo que he aprendido de este cliente» en el bloque verde
de la IA, cada línea con su porqué y «Cambiar»; «Con quién hablas»; «Sus
cuentas» (como cliente, como proveedor, a dónde van sus ventas y el 347).

## N9 · Diferencias, una a una

1. **Nombres de las cuentas y del banco.** La maqueta pinta «70000000 · Ventas»,
   «BBVA ···6536»; la captura enseña las cuentas y el banco que hay de verdad en
   la empresa de prueba («Cuenta principal ···1332»). Es dato, no diseño.
2. **«Lo que he aprendido» tiene dos líneas, no tres.** La tercera de la maqueta
   («Liquida los días 5 y 20 · las últimas 9 llegaron así») sale cuando hay tres
   o más cobros que lo digan; la semilla tiene tres liquidaciones cobradas, una
   de ellas con diferencia, y la regla no la cuenta como patrón. Las dos que
   salen las fijó la ficha («lo has fijado tú»).
3. **«Ver» por fila** de la maqueta es aquí la acción que toca: «Apuntar cobro»
   o «Quitar cobro», debajo del periodo. El detalle de cada liquidación (sus
   pedidos) no tiene pantalla propia en el C03.
4. **«Con quién hablas» vacío**: la semilla no le pone contactos («Se añaden en
   su ficha de proveedor y salen aquí también»).
5. **Fechas con «sept»**, el formato de la app (la maqueta dice «sep»).
6. **«Subir liquidación» lee el CSV** de la plataforma, no el PDF (respuesta 1,
   decisión 1); el pie de la tarjeta lo dice así.

## N10 · Socio de marca: igual que la maqueta

**Cabecera.** «Socio de marca · cesión» (azul), «Proveedor de mercancía»,
«Cliente · liquidación mensual», razón social y NIF comprobado; «Editar» y
«Preparar liquidación de octubre».

**Las cuatro cifras.** «Le has comprado este mes» 6.420 € (albaranes y su
cuenta 400), «Aportaciones del socio» −1.180 € (marketing y packaging · según
contrato), «Comisión pactada» +9 % de 18.300 € (ventas de sus marcas · 1.647 €)
y «Liquidación de octubre» 6.887 €.

**Cómo se calcula.** Las tres líneas y el total «6.887,00 € a su favor», con el
pie de dónde sale cada una.

**Liquidaciones anteriores.** Septiembre, agosto y julio, cada mes con su total
y «Cobrada».

**Sus cuentas.** Como proveedor, como cliente, a dónde van sus ventas y sus
marcas con «ventas separadas» (IA).

## N10 · Diferencias, una a una

1. **Por local (dato de Julio, después de la maqueta).** Debajo del total, una
   línea por local: «Norte Centro · 3.800,00 € − 700,00 € + 990,00 € =
   4.090,00 € a su favor» y «Norte Mercado · … 2.797,00 € a su favor».
   «Preparar liquidación» prepara una por local.
2. **«No se puede cerrar todavía»** (ámbar) bajo el cálculo, y «falta una
   fuente: no se cierra» en la cuarta cifra: en staging hay una venta de
   Last.app sin base imponible en Norte Centro (semilla del R02). Es la regla 4
   haciendo su trabajo: con esa fuente coja, Norte Centro no se cierra, y Norte
   Mercado sí. La maqueta enseña el caso sin faltas («a su favor · se cierra el
   31»), que es lo que sale cuando no falta nada.
3. **Iniciales «MD»**, de «Marcas del Sur» (la maqueta pinta «SM»).
4. **Pestañas.** La maqueta N10 no las enseña; aquí están, las mismas que en N9.
5. **Liquidaciones anteriores** suma los dos locales de cada mes (julio
   4.872,25 €; la maqueta pinta 4.870,25 €: dato de la semilla).

## Lista, cliente y móvil (sin maqueta propia)

- **Lista** (encargo §6): filtros con su número («Todos · N», «Archivados · 1»),
  columnas Nombre · Papeles · Te debe / Le debes · Última operación · «···». Los
  archivados no salen en «Todos» y el pie lo dice («1 archivado en su filtro»).
- **Cliente normal**: «Las facturas llegan con Facturación» con «Pedir factura»
  (respuesta 1, decisión 3, opción b) y «Nueva factura» como acción principal,
  que explica que llega con F01.
- **Archivado**: píldora «Archivado», franja ámbar con el porqué y «Recuperar».
- **Móvil** como M4: atrás a su lista, nombre con sus papeles y NIF, la acción
  principal grande, dos cifras, la frase de lo aprendido y los apartados de
  56 px. La plataforma enseña sus liquidaciones en su pantalla; el socio, el
  cálculo línea a línea con su signo.

## Lo que corrigieron estas capturas

La primera tanda (e2e 37471541076) enseñó cinco cosas que se arreglaron antes
de dar el PR por listo:

1. **51 terceros sin ningún papel** en la lista: borrar un proveedor dejaba su
   tercero huérfano. Lo arregla la migración 0170, y una limpieza única de
   staging borra los que había.
2. **Las acciones de la cabecera caían debajo del nombre**; ahora van a la
   derecha, como en N9 y N10.
3. **El periodo de cada liquidación se partía en cinco líneas**; la acción de
   cobro pasa debajo y el periodo gana el ancho.
4. **«347» salía partido** («34 / 7») en «Sus cuentas».
5. **Móvil:** «Te debe · llega el 5 sept» hablaba de una liquidación que ya
   había llegado con 212,30 € de menos; ahora dice «212,30 € con retraso o
   diferencia». Y el cálculo del socio perdía los signos.

## Respuesta 2 · El 347 de una plataforma y el ejemplo de la barra

- **«347» en «Sus cuentas» de una plataforma.** Antes decía «entra en el 347 de
  ventas» con lo vendido, que solo es cierto si la plataforma revende. Ahora
  depende de cómo vende según su contrato (RD 1065/2007, art. 34.3), y la cita
  sale debajo en pequeño:
  - **sin decir** (la semilla, y lo que verá la captura de N9): «Según su
    contrato: comisionista o revendedor. ¿Cuál es?», con dos botones: «Vende en
    mi nombre (comisionista)» y «Me compra y revende». No se asume ninguno.
  - **comisionista**: entra como **proveedor**, solo por su comisión; tus
    ventas a consumidores con ticket no van (art. 33.2.a).
  - **revendedora**: entra como **cliente**, por lo que le vendes.
  La maqueta N9 no tiene esta línea partida; es una diferencia buscada.
- **El ejemplo de la barra** «Pregunta o pide algo» va con el papel de la
  ficha: plataforma «¿Cuánto me debe la plataforma?», socio «¿Qué le liquido
  este mes?», cliente normal «¿Cuánto me debe?».
