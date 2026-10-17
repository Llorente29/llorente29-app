# S01 · Paso 4: Inicio como bandeja, Ctrl K como paleta y el nivel de cada usuario

Lo del inventario del paso 1 (§4.1 y §7) y la maqueta 5, en el orden en que se
ha hecho.

## Ctrl K, la paleta de órdenes

- La paleta busca en **el mismo catálogo** que la cinta y Favoritos
  (`esqueleto/ordenes.ts`), por su nombre y por sus sinónimos: «cobro» abre
  Tesorería, «plantilla» abre Predefinidos. Cada una dice dónde vive
  («Contabilidad › Asientos»).
- Solo las que salen en esta empresa. **Hallazgo**: el buscador no recibía el
  contexto de la empresa (hostelería, Diez, interruptores) y buscaba siempre
  como «sin empresa»; ahora lo recibe del marco. Y «Pendientes de Diez» de
  Libros ya no sale sin Diez.
- **«mayor 43000012»** (o «mayor de la 572») abre ese mayor, el primero de la
  lista.
- Si una pestaña y una orden llevan al mismo sitio, se queda el nombre de la
  pestaña («Facturas recibidas», no «Digitalizar»).

## El nivel: un diccionario y textos que no mueven nada

- `marco/nuevo/contexto.ts`: el marco lleva el `nivel` de quien mira
  (`useNivel()`); fuera del marco nuevo, «medio».
- `textos/textos.ts`: **el diccionario**. Cada clave con sus tres textos (sin
  experiencia, medio, experto); TypeScript obliga a los tres. **Medio es el
  texto de siempre**: quien estaba no ve nada distinto. Huecos entre llaves; un
  hueco sin dato se queda escrito (se ve, no se esconde).
- `textos/PorNivel.tsx`: pinta los tres en la misma celda y solo se ve (y se
  oye) el del nivel. **Ocupa lo del más largo**: un botón no cambia de tamaño al
  cambiar de nivel (maqueta 5: «nunca dónde está cada cosa»). `useTexto()` para
  donde no hace falta guardar el sitio (un título).
- Dónde está ya:
  - **La factura recibida** (maquetas 3 y 5): el título («Una compra de
    Makro» · «Makro · F-1» · «Recibida · F-1 · Makro»), el botón («Está bien,
    guardar» · «Está bien · apuntar» · «Validar»; desde Asientos, «… y
    siguiente») y los títulos de «Lo que he leído» y «Cómo se apunta».
  - **El Inicio**: las cuatro cifras («Tienes en el banco» · «En el banco» ·
    «Bancos (572)»…), los títulos de las secciones y el enlace de las gráficas.
- El resto de pantallas pasa al diccionario cuando se toque cada una.

## Inicio como bandeja

- **Las cuatro cifras arriba**, como estaban; **las gráficas, a un clic**
  («Ver la evolución»): de serie, solo las cifras.
- **Lo pendiente**, cada cosa con su acción. Nuevo: **«N facturas recibidas
  para revisar» → «Validarlas una a una»**, que abre el recorrido de Asientos ›
  Recibida con «Validar y siguiente» (las de los últimos 12 meses).
- **Los impuestos que vienen, con sus DOS plazos** (`lib/plazosImpuestos.ts`):
  - de los modelos de la empresa (`company_tax_profile.tax_forms`, los del
    alta) y de cómo declara el IVA (`vat_period`, `sii`);
  - **domiciliando el pago, hasta el 15; si no, hasta el 20**. En enero, lo que
    acaba el 30 (303 y 130 del cuarto trimestre) se domicilia hasta el 25;
  - el 202 en abril, octubre y diciembre; el 200 en julio (25; domiciliado el
    20); los informativos sin pago (390, 190, 180 y el 347 en febrero);
  - sale lo que tiene la ventana abierta y lo que se abre en 15 días; pasado
    el día de domiciliar, en ámbar: «Domiciliar ya no se puede (era hasta el
    15/10); presentarlo y pagarlo, hasta el 20/10»;
  - si el último día cae en fin de semana, el lunes. **Los festivos no se
    cuentan** (no hay calendario de festivos nacionales en la base) y lo dice
    la pantalla. Un ejercicio que no acaba el 31/12 cambiaría el 200 y el 202:
    tampoco se cuenta.
  - Medido en producción (solo lectura, tabla entera): una sola fila de
    `company_tax_profile`, la de Foodint, trimestral, con 111, 115, 180, 190,
    200, 202, 303, 347 y 390. El 17/10 le salen 111, 115, 202 y 303, hasta el
    20/10, con el 15 ya pasado.

## Pruebas

- Unitarias: `s01/paleta.test.ts`, `s01/textos.test.tsx`,
  `s01/plazosImpuestos.test.ts` (con los modelos reales de Foodint).
- e2e (`s01/esqueleto.spec.ts`): la paleta («cobro» → Tesorería, «mayor
  57200001»), y el Inicio en los tres niveles: **las mismas cajas** (cifras,
  títulos y el enlace de las gráficas) y las palabras distintas, los
  impuestos con sus plazos y las gráficas a un clic.
