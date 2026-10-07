# C04 · Capturas junto a las maquetas

Maquetas aprobadas: `docs/conta/maquetas/c04/N11Diario.(dc.html|png)` (libro
diario, 1440) y `N12Asiento.(dc.html|png)` (un asiento, 1440). El móvil sigue a
M4 (C01b), como en los encargos anteriores.

Capturas de staging-conta sacadas por la e2e `tests/e2e/conta/c04/libro.spec.ts`
(ordenador 1440 × 900 y móvil 390 × 844, página entera) con la semilla
INVENTADA `supabase/seeds/conta/seed_c04_staging.sql`, en la ejecución verde
de la respuesta 3 (la 134, sobre `a99ef15`, las subió en `793b947`; la 133 murió
instalando psql antes de la primera prueba).
Staging se rehízo antes con `20261012_c04_rehacer_libro.sql` (aplicar 82): el
libro de A y B se borra y la semilla lo vuelve a hacer con las funciones de la
base. Se toman ANTES de escribir nada, para que salgan siempre iguales.

| Pantalla | Ordenador | Móvil |
|---|---|---|
| Libro diario, cuenta A (N11) | `diario-ordenador.png` | `diario-movil.png` |
| Libro diario con una fila abierta | `diario-abierto-ordenador.png` | — (en móvil la fila lleva al asiento) |
| Asiento propuesto (N12) | `asiento-ordenador.png` | `asiento-movil.png` |
| Asiento a mano | `nuevo-asiento-ordenador.png` | — |
| Libro de la cuenta B | `diario-b-ordenador.png` | `diario-b-movil.png` |
| Borrador de B en un mes cerrado | `mes-cerrado-b-ordenador.png` | `mes-cerrado-b-movil.png` |
| Extracto del proveedor (lee del libro) | `extracto-proveedor-ordenador.png` | `extracto-proveedor-movil.png` |

Las cifras no son las de la maqueta: son las de la semilla (otro restaurante,
otras fechas). Lo que se compara es la forma.

**Dos cosas de la captura, no de la pantalla.** La barra flotante de la IA (y,
en móvil, la barra de abajo) es `position: fixed`: en una captura de página
entera sale pintada a la altura de la ventana, encima de lo que haya ahí (en
`diario-ordenador.png`, sobre la cabecera de «Cierre de septiembre»). En uso
real no tapa nada al desplazarse; la e2e lo mide con `loQueTapan` y da cero.
Y `asiento-ordenador.png` sale con la franja de staging encima de las migas
porque la página estaba desplazada al hacerla.

## N11 · Libro diario

**Igual que la maqueta.**
- Migas «Libros › Libro diario», título, «Ejercicio 2026» y «+ Nuevo asiento».
- Las cuatro cifras: asientos del mes (y de qué), para revisar (en ámbar,
  «propuestos por Folvy»), estado del mes y resultado del mes con su reparto
  por local.
- Tabla FECHA · Nº · CONCEPTO · local · marca · de dónde sale · IMPORTE ·
  estado. Sin número mientras no se valida («—»). Chips de local (azul) y de
  marca (cedida en ámbar, propias en gris).
- **El número lleva su serie** (respuesta 3): «General 3», «Nóminas 1»,
  «Ventas 3». El número a secas se repetía en cada serie y no decía nada. El
  contraasiento dice «Anula General nº 2: …», nunca «Anula el 4/2».
- **Fila baja** (respuesta 3): el concepto ocupa hasta dos líneas enteras y,
  debajo, en una sola, los chips de local y marca y «de dónde sale». La e2e
  mide cada fila: ≤ 90 px en ordenador y ≤ 110 px en móvil (en móvil el número
  va debajo de la fecha).
- Estados: «Para revisar» (ámbar), «Hecho por Folvy» (verde), «Validado».
- La fila se abre y enseña sus apuntes con «al Debe / al Haber»
  (`diario-abierto-ordenador.png`).
- «Lo que he hecho yo» con fondo de la IA y «Deshacer».
- «Cierre de septiembre» con su lista de pasos.

**Diferencias, una a una.**
1. **«Exportar» no está**; en su sitio, «Proponer lo pendiente». Exportar el
   diario es del encargo de informes, no del C04. «Proponer lo pendiente» es
   la acción que el C04 sí tiene: propone los días y documentos sin asiento y
   dice, en lista, cuáles no ha podido proponer y por qué.
2. **Filtros: solo los que tienen algo, con su número.** La maqueta pinta los
   nueve siempre. Aquí salen «Todos» y los que tienen asientos («Ventas · 4»…).
   Hay uno más que la maqueta no tiene: «Anulados». Un filtro vacío no esconde
   ninguna fila (regla 7): en «Todos» está todo.
3. **Anulados y contraasientos se ven** (tachado y gris; «Contraasiento» en
   gris). La maqueta no tiene ninguno. Un anulado no desaparece nunca del libro
   (CCom art. 29.1).
4. **La tercera cifra dice «Abierto · ningún mes anterior cerrado»** y no
   «bloqueado hasta el día 5 · septiembre cerrado»: en la cuenta A de staging
   no hay ningún mes cerrado. La de B sí lo enseña (`diario-b-*`).
5. **Los chips van en una sola línea bajo el concepto**, seguidos de «de dónde
   sale», y no en columnas propias: así la fila no crece. Si no caben, se corta
   «de dónde sale» con «…» (entero en el `title` y en el asiento). El concepto
   se corta a dos líneas, no a una.
6. **«Abrir el asiento»** al pie de la fila abierta. La maqueta no lo pinta. Es
   el único camino por teclado al N12 desde la tabla.
7. **«Lo que he hecho yo»: «Deshacer» solo donde hay algo que deshacer.** Un
   asiento que Folvy dejó «para revisar» no ha escrito nada en el libro, así que
   no lleva «Deshacer». El título va en azul porque es un enlace al asiento; en
   la maqueta, en negro.
8. **El cierre dice lo que falta y el botón no se puede pulsar.** «Cerrar
   septiembre» va deshabilitado con «Falta: facturas de proveedor: 1 de 4; …»
   (regla 8: un botón que no hace nada dice por qué). La maqueta no tiene botón
   ni el «Ver» de la cabecera, y lleva una línea de la asesora que aquí no
   existe todavía.

**Móvil** (`diario-movil.png`): una columna. Las cifras de dos en dos. La tabla
se convierte en filas con fecha, concepto, chips, importe y estado; la fila
lleva al asiento. Debajo, «Lo que he hecho yo» y el cierre. Los filtros pasan a
varias líneas.

## N12 · Asiento

**Igual que la maqueta.**
- Migas «Libros › Libro diario › Para revisar», título y chips: «Propuesto por
  Folvy · Seguro» en verde, serie, fecha y documento.
- «Descartar» y «Validar asiento».
- Apuntes con CUENTA · local · marca, DEBE y HABER, el código de la cuenta (que
  lleva a su Mayor) y «Cambiar» en cada línea.
- **Las cuentas, por su nombre de uso** (respuesta 3): la subcuenta de la
  empresa por el suyo («62300001 · Comisiones de plataformas») y la hoja de
  serie por su «qué se apunta aquí». El título del BOE («Servicios de
  profesionales independientes», «Acreedores por prestaciones de servicios
  (euros)») sale solo en el Mayor y en «Detalle contable». El buscador de
  «Cambiar» encuentra por los dos.
- **Lo cobrado por cuenta del socio va a su cuenta de liquidación**
  (respuesta 3): «41000003 · Liquidación pendiente con Marcas del Sur»,
  2.334,48 € al Haber, y no a su 400 de proveedor. Medido en staging (empresa
  A): Banco 7.797,40 · Comisiones de plataformas 1.712,89 · IVA 359,71 al
  Debe; Plataforma Norte 7.535,52 · Liquidación pendiente 2.334,48 al Haber.
- **El código de cada cuenta, entero.** En la captura de la 134 la línea de la
  liquidación llevaba dos chips (local y «Brasa Prestada · cedida») y el código
  salía cortado: «410000» por «41000003». En el asiento la línea de apoyo ahora
  salta a una segunda línea, y la e2e mide que ningún código se salga de su
  caja (ensayada con la misma regla antes del cambio, +62 px fuera, y después,
  dentro).
- La línea de cuadre: «Cuadra · Debe 9.870,00 € · Haber 9.870,00 € · ✓ 0,00 €»
  y la frase de cómo se cambia una cuenta.
- «Por qué lo propongo así», con fondo de la IA: cuadre con el PDF, ventas por
  marca, la marca cedida va al socio (cita **NRV 16.ª**: la empresa es de
  pymes) y la comisión con IVA deducible (Ley 37/1992, art. 90). «Si me
  corriges, aprendo para la siguiente del mismo origen.»
- «Documento».

**Diferencias, una a una.**
1. **«Serie Banco» y no «Serie Ventas»** para la liquidación de la plataforma:
   el dinero entra por el banco y las ventas de esos pedidos ya están en los
   resúmenes del día. Las series se dicen siempre por su nombre (respuesta 1).
2. **No hay chip del tercero** («Plataforma Norte · 43000001») en la cabecera:
   el tercero está en su línea (43000001 · Clientes · Plataforma Norte), que
   lleva a su Mayor.
3. **No hay «+ Añadir apunte» en una propuesta.** Una propuesta se corrige
   cambiando cuentas; añadir líneas a mano es del asiento a mano
   (`nuevo-asiento-ordenador.png`, que sí lo tiene, con el cuadre en vivo: «No
   cuadra: faltan 0,50 € en el Haber»). Si hiciera falta en las propuestas, es
   una línea en el encargo siguiente.
4. **No hay sello «IA» en cada línea.** Lo que decidió la IA se explica en «Por
   qué lo propongo así», con su cita. Ponerlo además en cada línea lo repetía.
5. **El chip de local es el local** («Norte Centro») y no «3 locales». La
   semilla tiene la liquidación en un solo local. Con varios, el chip dice
   cuántos.
6. **«Documento» sin vista del PDF ni desglose.** La semilla no lleva fichero,
   y la pantalla dice de dónde sale («Liquidación de la plataforma ·
   SEED-C03-0916 · lo preparó Folvy»). El desglose (vendido, comisión, cobrado)
   va en la primera línea de «Por qué lo propongo así».
7. **«Detalle contable», plegado, que la maqueta no tiene**: la serie con su
   código, el número, la huella y «Comprobar la cadena». Es lo que pide un
   asesor y no estorba al que no lo es.
8. **«Validar asiento» sin «↵»**: no hay atajo de teclado para validar. Validar
   no se deshace, así que no va en una tecla.

**Mes cerrado** (`mes-cerrado-b-*`, cuenta B): franja ámbar «septiembre está
cerrado · cerrado por Admin Sur. No se valida con esa fecha: desbloquéalo desde
el libro o descártalo y lo vuelvo a proponer en el primer día abierto». «Validar
asiento» va deshabilitado, sin esconderlo.

**Móvil** (`asiento-movil.png`): título y chips arriba, y los dos botones
debajo. Cada apunte en bloque, con su importe a la derecha y «Cambiar» debajo.
El cuadre en dos líneas. «Por qué lo propongo así», «Documento» y «Detalle
contable» van debajo.

## Extracto en la ficha del proveedor

`extracto-proveedor-*`: «Saldo y movimientos» y el extracto leen del libro. El
saldo es 1.283,15 € a tu cargo, con la F-2026-0915 validada; el número del
documento lleva a su asiento. Antes del C04 decía «Aún no hay apuntes».

## Sin captura

- **«Sus cuentas» del socio**: fila «Lo que cobras por su cuenta», con su
  cuenta de liquidación o, si no la tiene, «Crear su cuenta de liquidación».
  La cuenta se crea sola al confirmar el papel de socio (ficha, lista y
  revisión de las 430). Ninguna e2e abre todavía la ficha del socio:
  esa fila está sin prueba de pantalla, y se dice.
- **La marca cedida de la semilla** se llama ahora «Brasa Prestada»: nombre
  inventado del todo.
