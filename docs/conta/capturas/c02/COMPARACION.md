# C02 · Capturas junto a las maquetas

Maquetas aprobadas: `docs/conta/maquetas/c02/N6Ajustes.png` (Ajustes como
índice), `N5Plan.png` (la pantalla del plan, dentro de N6) y
`N7FichaConta.png` (pestaña Contabilidad de la ficha de proveedor), a 1440.
Capturas de staging-conta, sacadas por la e2e `tests/e2e/conta/c02/plan.spec.ts`
y `ficha.spec.ts` (ordenador 1440 × 900 y móvil 390 × 844), página entera.
Datos inventados de las semillas C01/C01b; el plan es el que activa la propia
e2e en la empresa de A (Taberna de Prueba Norte) y en la de B (Canarias).

| Pantalla | Ordenador | Móvil |
|---|---|---|
| Ajustes: el índice (N6) | `ajustes-ordenador.png` | (el índice es la lista: `plan-movil.png` arranca desde él) |
| Plan contable (N5 dentro de N6), grupo 4 | `plan-ordenador.png` | `plan-movil.png`, una cuenta abierta: `plan-movil-cuenta.png` |
| Qué va a cada sitio | `que-va-a-cada-sitio.png` | — |
| Plan en árbol (respuesta 5): la 400 cerrada | `plan-ordenador-400-cerrada.png` | Un nivel por pantalla: `plan-movil-400.png` |
| Plan en árbol: buscar aplana, con la ruta | `plan-ordenador-busqueda.png` | — |
| Mayor de la cuenta (respuesta 5) | `mayor-ordenador.png` | `plan-movil-cuenta.png` |
| Propuesta de la IA (tarea 5) | `propuesta-ordenador.png` | — |
| Cuenta B (Canarias, IGIC) | `plan-b-canarias.png` | — |
| Ficha › Contabilidad (N7) | `ficha-contabilidad-ordenador.png` | `ficha-contabilidad-movil.png` |
| Ficha › Ver extracto (vacío hasta el C04) | `ficha-extracto-ordenador.png` | `ficha-extracto-movil.png` |
| Ficha › Cocina: «Local habitual» (respuesta 3) | `ficha-cocina-local-habitual.png` | — |

## Igual que la maqueta

**Ajustes (N6).**
- Índice lateral agrupado en **Empresa** (Tu empresa · Tus impuestos · Socios y cargos · Ejercicio), **Contabilidad** (Plan contable · Tablas generales · Numeración · Certificados y accesos) y **Acceso y avisos** (Personas y asesor · Avisos · Lo que ha hecho Folvy). Cada entrada con su línea de resumen debajo, la abierta en azul.
- Nada de Cocina, reparto, locales ni marcas: lo comprueba la e2e.
- Lo que aún no tiene pantalla dice «Aún no» y por qué.

**Plan contable (N5).**
- Cabecera con «Plan de pymes · subcuentas de 8 dígitos · la longitud queda fija con el primer asiento» y los botones «Qué va a cada sitio» y «+ Añadir subcuenta».
- Buscador, «Las que usas» / «Todas», y los grupos 1–7 con su número de cuentas.
- Tabla NÚMERO · CUENTA (con «qué se apunta aquí» debajo) · LO QUE LLEVAS · ORIGEN · Abrir. Las cuentas con hijas como cabecera con código corto (400, 472); las de apunte con el código completo en Geist Mono; las subcuentas sangradas bajo su cuenta («40000002 · Proveedores · Hermanos Ruiz · 1 proveedor · Tuya»).
- Buscar «alquiler» encuentra la 62100000 por lo que se apunta en ella (e2e).
- Al pie, la frase de origen (RD 1515/2007, RD 1/2021) y la regla de la longitud; debajo, el historial de cambios.

**Móvil.** Lista por grupos con el buscador arriba; cada cuenta abre su pantalla con «atrás»; «+ Añadir subcuenta» como acción principal.

**Ficha (N7).** La pestaña es solo N7 (respuesta 3): dos tarjetas a todo el ancho, **Sus cuentas** (Su cuenta · Sus facturas se apuntan en · IVA que te cobra · Retención · Le pagas desde) y **Saldo y movimientos** (Saldo con él · Este año · Último apunte · Va al 347 este año · Registro sanitario) con «Ver extracto». Sin formulario encima: la e2e comprueba que no hay ni un desplegable ni un campo fuera de las tarjetas y que «Sus facturas se apuntan en» sale una sola vez.

## Diferencias, una a una

1. **La cifra del índice es la real, no la de la maqueta (D2).** La maqueta dice «Pymes · 8 dígitos · 309 cuentas»; la captura dice las que tiene de verdad la empresa (627 en A: 615 hojas del cuadro de pymes más sus subcuentas).
2. **El menú de la izquierda es el del marco de Ajustes del C00**, no el menú completo del módulo: «Ajustes» y «Volver a Folvy». La maqueta N6 dibuja el menú entero (Inicio, Por hacer, Documentos…), que son pantallas que aún no existen; enseñarlas sería prometer lo que no hay.
3. **Los grupos van en píldoras sobre la tabla**, no en una columna propia a la izquierda como en N5. Dentro del marco de N6 ya hay un índice a la izquierda: un segundo índice al lado dejaba la tabla en la mitad del ancho. «Qué va a cada sitio» va arriba, como botón, y el historial al pie de la pantalla.
4. **La tarjeta verde de la IA sale solo cuando hay algo que proponer.** En `plan-ordenador.png` no hay ninguna, porque todos los proveedores de A ya tienen su subcuenta. `propuesta-ordenador.png` la enseña con un proveedor nuevo creado por la e2e: el texto, el porqué con el código («→ 40000005») y las tres respuestas, como en N5. Lleva además la **confianza** («Confianza alta»), que N5 no dibuja y el encargo pide (§4). Las de confianza baja no salen como tarjeta: van plegadas en «Para revisar», con su número.
5. **«LO QUE LLEVAS» dice cuántos terceros o tipos lleva** («1 proveedor», «1 tipo de IVA»), no el importe del año: los importes salen de los asientos, que llegan con el C04.
6. **La lista es la de verdad, entera.** La maqueta enseña siete filas; el grupo 4 del plan de pymes tiene más de cien cuentas, y todas salen (regla 7: «Las que usas» ordena, no esconde). Por eso las capturas son largas.
7. **Ficha (N7): sin apuntes todavía.** «Saldo con él» y «Último apunte» dicen «Sin apuntes todavía» en vez de 1.283,15 € y «24 sep · F-2026-0915»: son cifras de la contabilidad (C04), no de las facturas. «Este año» y «Va al 347» sí se calculan ya, con las facturas recibidas sin las repetidas. «Ver extracto» abre el extracto con sus dos vistas y un estado vacío que lo explica.
8. **Ficha (N7): lo que solo aplica a algunas empresas sale debajo de Sus cuentas** (tipo de identificador, tipo de operación con su modelo, y prorrata, recargo y criterio de caja solo si la empresa está en ellos), cada uno con su fuente en pequeño (respuesta 2). La maqueta no los dibuja.
9. **Ficha (N7): el IVA no se cambia desde la ficha.** La cuenta de cada tipo de IVA es de la empresa, no del proveedor: la línea lleva «En el plan» en vez de un desplegable. Lo que sí es suyo (su cuenta, sus facturas, desde dónde le pagas, sus suplidos) se cambia ahí mismo, con buscador, y dice qué ha cambiado (regla 8).

## Respuesta 3 (05/10)

- **Ficha › Contabilidad, solo N7** (`ficha-contabilidad-*.png`). Se quita el formulario de arriba:
  - «Sus facturas se apuntan en» se cambia desde su tarjeta: «Cambiar» abre el buscador con dos grupos, «Por su tipo de gasto» y «Una cuenta solo para él». Elegir un tipo guarda el tipo de gasto del proveedor y dice adónde van ahora («Sus facturas van ahora a 60000000 · Compras de mercaderías, por su tipo de gasto «…».»). Debajo pone «por su tipo de gasto».
  - El registro sanitario se edita en Datos fiscales; aquí solo se enseña, en Saldo y movimientos.
  - Al pie de Sus cuentas, un enlace discreto: «Qué tipos de gasto usa tu negocio», que lleva a Ajustes › Tablas generales.
  - En la cuenta B la pestaña sigue plegada, y lo de dentro no se ve con el bloque cerrado (lo comprueba la e2e).
- **«Local habitual», al bloque de Cocina** (`ficha-cocina-local-habitual.png`): encima de «Artículos que le compras», en la ficha general. En B (sin Cocina) no existe, y la e2e lo comprueba con Carnes Sur. Guardar dice cuál ha quedado («Local habitual: X.»).
- **«Qué se apunta aquí» en las cuentas de apunte** (`plan-ordenador.png`). Si la cuenta no tiene texto propio, hereda el de su cuenta madre: la 40000000 dice «Lo que debes a quienes te venden género…», como la 400. Las subcuentas de terceros siguen con «1 proveedor». Las del IVA llevan el ejemplo de la tabla de impuestos del C00, no un texto escrito en el código: «Hostelería, alimentos, transporte» (10 %) y «Casi todo lo que compras» (21 %).
  - **Hueco, sin inventar textos:** la serie trae «qué se apunta aquí» en 58 cuentas. Con la herencia, 79 de las 615 hojas tienen texto; en el grupo 4, 17 de 73. El resto sale solo con su título del BOE (por ejemplo, el 403 «Proveedores, empresas del grupo»). La prueba unitaria mide esa cobertura, no la da por hecha.
- **La 40000000 decía «4 proveedores» que ya no existían.** Eran proveedores que la e2e de propuestas crea y borra: el enlace no tiene clave ajena y sobrevivía a su dueño (5 huérfanos en staging). La 0187 quita el enlace al borrar el proveedor, el banco, el tipo de gasto, el tipo de IVA o la retención, y limpia los que ya había. En esta captura, la 40000000 ya no lleva nada. La e2e de propuestas lo comprueba: antes de borrar, el enlace se ve con la misma sesión; después, no.
- **En la captura de página entera, la franja «BUILD LOCAL» tapa los títulos de las dos tarjetas.** Es la franja de entorno (`FranjaEntorno`, `sticky`), que sale en todo lo que no es producción, también en la vista previa («PREVIEW»). La captura de página entera la deja a la altura de la ventana; en uso real se queda arriba del todo. En producción no existe.

## Respuesta 4 (05/10)

- **La reserva del BOE en «qué se apunta aquí»** (`plan-ordenador.png`, `plan-movil.png`). Si una cuenta de apunte no tiene texto propio ni heredado, enseña la primera frase de la definición de la quinta parte del BOE, la del código más cercano hacia arriba que la tenga. Va en el mismo sitio y con la misma letra, y un «(PGC)» pequeño al final la distingue de los textos de Folvy:
  - la 40100000 lleva la suya: «Deudas con proveedores, formalizadas en efectos de giro aceptados.»;
  - las 40300000, 40310000 y 40340000 llevan la de la 403, porque las dos últimas no tienen definición propia;
  - la 40000000 sigue con el texto de Folvy, sin marca;
  - las subcuentas de terceros siguen con «1 proveedor».
- **Medido con la serie real:** en pymes, ninguna de las 615 cuentas de apunte sale solo con el título. En el grupo 4, 17 llevan texto de Folvy y 56 la definición del BOE. En el plan general se quedan sin texto las 42 de los grupos 8 y 9, porque allí el BOE solo describe el movimiento.
- **Lo que no cambia:** `plain_name`. La definición está en su propia columna (`pgc_account.boe_definition`, la 0115, generada desde el BOE por `plan.mjs`) y la herencia se resuelve al enseñar. Cuando lleguen los textos de hostelería (C02b), sustituyen a la reserva sin migración.

## Respuesta 5 (05/10): el plan en árbol y el Mayor

Contraste: Holded, Diez, Sage 50 y Contasol enseñan el plan como un árbol
plegable, y en todos la cuenta abre su Mayor (en QuickBooks, el «register»).
Pennylane, Odoo, QuickBooks y Xero usan una lista plana, porque sus planes
son cortos o porque la gente busca en vez de leer.

- **El árbol** (`plan-ordenador.png`): grupo › subgrupo › cuenta › cuenta de apunte › subcuentas, con ▸/▾ y sangría.
  - **Al entrar,** el grupo elegido sale abierto hasta el nivel de cuenta, con «Las que usas» abierto también lo que tiene subcuentas o enlaces: 400 › 40000000 › las cuatro de proveedores, 410, 472.
  - **La fila cerrada dice lo que lleva:** «403 · Proveedores, empresas del grupo · 5 cuentas» (`plan-ordenador-400-cerrada.png`).
  - **La 40000000 no se ve con la 400 cerrada,** y lo comprueba la e2e.
  - **Teclado:** ↑ ↓ para moverse, → abre o baja, ← cierra o sube, e Intro. Cada fila lleva su `aria-expanded`.
  - **Lo abierto se recuerda** por persona y empresa mientras dura la sesión del navegador, no en la base.
- **Buscar aplana** (`plan-ordenador-busqueda.png`): solo lo que casa, con su ruta encima en pequeño («6 › 62»). Al borrar la búsqueda, el árbol vuelve como estaba.
  - La 62100000 sale con «6 › 62», no con «6 › 62 › 621», porque en el plan de pymes la 621 es hoja: su cuenta de apunte cuelga del subgrupo.
- **Pinchar:**
  - **Una cuenta de apunte o subcuenta** abre su Mayor. Toda la fila es el enlace, y el «···» guarda lo demás: Ver el Mayor, Ficha del proveedor o Banco, Cambiar nombre si es tuya, Palabras clave, Ocultar.
  - **Una cuenta con hijas** se abre o se cierra, y su «Abrir» lleva a «Sumas y saldos» de ese nivel: una fila por hija, vacía hasta el C04 con el mismo mensaje que el extracto.
- **El Mayor** (`mayor-ordenador.png`), en `/conta/plan/<código>`.
  - **Cabecera:** el código y el nombre, «qué se apunta aquí», el saldo («Sin apuntes todavía»), el ejercicio y lo que lleva.
  - **Enlaces según de quién es la cuenta:** la 40000002 lleva «Ficha del proveedor · Hermanos Ruiz» y «Cambiar nombre».
    - Es una subcuenta creada por la empresa, así que se puede renombrar (0189, con registro).
    - No lleva «Ocultar» porque tiene un enlace, y la base no la dejaría ocultar.
  - **Una de serie** dice que su título es el oficial y no se cambia.
  - **Debajo, el extracto en sus dos vistas,** con la misma pieza que la ficha del proveedor.
  - **Lo que aún no tiene pantalla no se enlaza:** cliente llega con el C03, e Impuestos › IVA cuando exista.
- **Desde la ficha del proveedor,** cada cuenta de «Sus cuentas» abre su Mayor («Su cuenta 40000002»). La e2e hace la vuelta completa: Mayor → ficha → Mayor.
- **Móvil** (`plan-movil.png`, `plan-movil-400.png`, `plan-movil-cuenta.png`):
  - cada nivel es una pantalla, con «atrás» al de arriba;
  - la fila de una cuenta abre su Mayor, y «4 subcuentas tuyas ›» enseña las suyas;
  - buscar también aplana.
- **La dirección vieja** `ajustes/plan/cuenta/<código>` lleva al Mayor.

## Corregido al compararlas

- **La columna CUENTA era estrecha** (unos 200 px a 1440: los títulos se partían en tres líneas). Ahora NÚMERO 110, LO QUE LLEVAS 140, ORIGEN 96: CUENTA gana unos 100 px.
- **El buscador cortaba su ejemplo** («Busca: «alquiler», «472», ·»): ahora ocupa lo que dejan los botones.
- **«Lo que ha hecho Folvy · Nada todavía»** con historial del plan debajo: ahora el resumen cuenta también los cambios del plan (no decir «nada» habiendo filas, regla 7).
- **La captura de Ajustes salió sin las líneas de resumen** (se sacó antes de que cargaran): la e2e espera ahora a «Pymes · 8 dígitos · N cuentas» y al ejercicio antes de capturar.
- **Ficha (N7), primera captura del 05/10:**
  - En el ordenador salió el esqueleto de carga en lugar de las dos tarjetas: la captura de página entera cambia el tamaño de la ventana y la pieza se volvía a montar sin datos. Ahora conserva lo último leído mientras vuelve a pedirlo, y la e2e comprueba las tarjetas justo antes de capturar.
  - El IVA salía como «IVA soportado 21 % 21 %», con el tipo repetido. Ahora sale una vez, ordenado por código («47200010 · IVA soportado 10 % y 47200021 · IVA soportado 21 %»). La prueba unitaria compara el texto entero y la e2e comprueba que no se repite.
  - En el móvil, la etiqueta quedaba aplastada a la izquierda («IVA / que / te / cobra»). Ahora va encima y la cuenta debajo, a todo el ancho.
- **Ficha (N7), segunda captura:** las dos tarjetas iban dentro de la columna de 640 px del formulario (unos 310 px cada una). Ahora van a todo el ancho, como en N7 (y desde la respuesta 3 ya no hay campos arriba). El extracto abierto no salía en la captura de página entera, porque al volver a montarse la pieza se cerraba. Ahora recuerda si estaba abierto, y tiene su propia captura de elemento.
- **Propuesta (tarea 5), primera captura:** con un solo proveedor, el porqué decía «Así cada uno tiene su extracto. Van al 400 porque te venden mercancía». Ahora va en singular, con prueba.

