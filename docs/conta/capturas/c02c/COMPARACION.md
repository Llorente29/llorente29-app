# C02c · Capturas junto a la maqueta

Maqueta aprobada: `docs/conta/maquetas/c02c/N8Importar.dc.html` (paso 2 del
asistente «Traer tu plan de otro programa», 1440). El PNG de la maqueta no
está en el repositorio: llevaba pintados un tercero real, su NIF y el final de
un IBAN (ver `LEEME.txt`); la referencia es el HTML.

Capturas de staging-conta sacadas por la e2e `tests/e2e/conta/c02c/traer.spec.ts`
(ordenador 1440 × 900 y móvil 390 × 844, página entera), en una empresa
temporal de la cuenta A (pymes, 8 dígitos) que la propia prueba crea y borra.
Los datos son los de la fixture INVENTADA `tests/conta/fixtures/importar/diez/`:
en el ordenador se suben los tres PDF con la forma de Diez; en el móvil, los
mismos datos en CSV.

| Pantalla | Ordenador | Móvil |
|---|---|---|
| Paso 1: ¿de qué programa vienes? | `paso1-ordenador.png` | `paso1-movil.png` |
| Paso 2: revisa lo que no está claro (N8) | `revisar-ordenador.png` | `revisar-movil.png` |
| Paso 3: traer el plan | `paso3-ordenador.png` | — |
| El plan ya traído, con «Tuya · de Diez» | `plan-traido-ordenador.png` | — |

## Igual que la maqueta

**Cabecera del paso 2.** «Traer tu plan de Cegid Diez», debajo el nombre de los
ficheros y la frase-resumen («N cuentas, M tuyas · plan de pymes · 8 dígitos,
igual que aquí»), y a la derecha los tres pasos (✓ Tu fichero — 2 Revisa lo
que no está claro — 3 Traer el plan).

**Las cuatro cifras.** Entran tal cual · Para revisar · Cambian · Nuevas en
Folvy, cada una con su nota en su color (verde, ámbar, azul, gris) y la misma
redacción («472 y 477: aquí van por tipo de IVA», «fichas de proveedor que se
crean, por completar»).

**Filtros y tabla.** Píldoras «Para revisar · N», «Todas · N», Proveedores,
Clientes, Bancos. Columnas NÚMERO (se conserva) · EN DIEZ · → · EN FOLVY ·
CONFIANZA · acciones. Cada fila con el porqué debajo de lo que queda en Folvy
(«mismo NIF B…», «mismo IBAN en Bancos», «sin NIF en el listado; mismo nombre
que el 41000001», «hay 2 iguales: 47510015 y 47510019»), y la confianza en
chip: Seguro (verde), Probable (azul), Decide tú (ámbar). Las filas «Decide
tú» van con el fondo ámbar suave.

**Pie.** «Nada se escribe hasta el paso 3. Luego podrás deshacerlo entero desde
«Lo que ha hecho Folvy».», «Guardar y seguir luego» y «Siguiente: traer el
plan →» (deshabilitado mientras quede algo por decidir).

## Distinto de la maqueta, y por qué

1. **Sin «‹ Plan contable» encima del título.** El asistente vive DENTRO de
   Ajustes › Plan contable (encargo §5): el índice de la izquierda ya dice
   dónde se está y vuelve. En el paso 1 sí hay «‹ Elegir otro programa», y en
   el 3, «‹ Volver a la revisión».
2. **«Tirar y empezar de nuevo» en el pie.** No está en la maqueta. Hace falta
   porque la revisión se guarda («Guardar y seguir luego») y sin él no habría
   forma de cambiar de fichero; pregunta antes.
3. **Las acciones de cada fila son las de la respuesta 1, no las de la
   maqueta.** La maqueta dibujaba «Los dos», «Así» y «Vale». Con la respuesta 1:
   - un tercero con NIF y sin ficha → «ficha nueva, por completar», Probable;
   - sin NIF → «Decide tú» con tres salidas: **Es este** (con buscador, en
     «Cambiar»), **Crear ficha por completar** y **Cuenta mía sin ficha**;
   - la 430 de quien también es proveedor → enlazada a su misma ficha con el
     papel de pago («su cuenta como cliente»);
   - la 430 solo cliente → «Cliente · su ficha llega con los clientes».
   «Los dos» (40000003 enlazada como proveedor y como cliente) sale como dos
   filas, cada una con su enlace: así se ve y se cambia cada una.
4. **Las dos 4751 iguales llevan «111», «115» y «Ninguno».** La maqueta solo
   tenía 111 y 115; «Ninguno» deja la cuenta como tuya sin modelo, porque no
   todas las 4751 son de un modelo.
5. **La fila del IVA dice «IVA soportado, ahora por tipo»** en vez de listar
   «47200000 · común + 47200010 · 10 %…». Los tipos salen en el paso 3 y en el
   plan ya traído (`plan-traido-ordenador.png`, la 47200021 buscada); en la
   fila, la lista no cabía en móvil.
6. **Buscador en la barra de filtros** («Busca: «Glovo», «410»»). No está en la
   maqueta; con 96 tuyas y los terceros, hace falta (la e2e busca «Glovo»).
7. **Las cifras son las de la fixture, no las de la maqueta** (79 / 9 / 2 / 6
   en N8). La fixture está hecha con la FORMA del Diez real, no con sus datos.

## Móvil

No hay maqueta de móvil para N8. Las cuatro cifras van en rejilla de dos; cada
cuenta es una tarjeta con el número, cómo se llamaba en Diez, cómo queda en
Folvy y su porqué, el chip de confianza y las acciones debajo. Si quedan
cuentas por decidir, el aviso añade «Si te es más cómodo, guarda y decídelas
en el ordenador.» Nada queda tapado por la barra inferior (lo mide la e2e).

En `revisar-movil.png` la franja «NO ES PRODUCCIÓN» aparece a media página, y
en `revisar-ordenador.png` la barra «Pregunta o pide algo»: son elementos
fijos y la captura de página entera los pinta donde estaba la ventana. En la
pantalla real van arriba y abajo; la e2e mide que no tapen nada al bajar del
todo.

## Corregido al ver las capturas

- **EN FOLVY era tan estrecha como EN DIEZ** («Falta que digas qué es» en tres
  líneas) y la columna de acciones se quedaba con el sitio. Ahora es la ancha
  (1,6 veces EN DIEZ), como en N8; número, flecha y confianza, lo justo.
- **La revisión se iba al paso 1 durante la captura** (ver arriba): era el
  marco de Ajustes, y le pasaba a cualquiera que estrechara la ventana.

## Lo que la e2e comprueba además de pintar

- Paso 1 con los tres PDF: cada uno dice qué ha leído y que cuadra con su pie
  (««proveedores.pdf»: proveedores y acreedores de Diez · 57 cuentas, 41 con
  NIF (el PDF dice 57: cuadra).»), sin pedir columnas.
- La revisión no se va ni un instante mientras se hace la captura (06/10: la
  captura de página entera dejaba la ventana a 1×1 y el marco de Ajustes
  desmontaba el asistente; arreglado en `MarcoAjustes.tsx`).
- Traer: la frase de lo hecho, el plan activado con «Tuya · de Diez» y el IVA
  por tipo; «Deshacer entero» en el historial vuelve a «sin activar», dice
  cuántas cuentas quita (las 96 de Diez y las que puso Folvy) y no deja fichas
  nuevas en la base.
- Móvil: «Guardar y seguir luego», recargar y seguir donde estaba, y tirar.
