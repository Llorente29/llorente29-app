# Contraste con Holded, Cegid Diez y Pennylane (y Digits y Puzzle)

> Regla de Julio desde el 03/10/2026 (respuesta 4 del C00): **cada paso se contrasta con Holded, Cegid Diez y Pennylane (y Digits y Puzzle para IA y pantalla) antes de decidir**, y todo encargo lleva una sección «Contraste». Se aplica en los encargos siguientes (ficha de proveedor restilada, R02, C02), no en el C00.

## Dónde vive cada dato de la empresa titular

| Dato | Holded | Cegid Diez | Pennylane | Folvy |
|---|---|---|---|---|
| Razón social, NIF, forma jurídica, domicilio | Configuración › Cuenta › Datos de la empresa (sin forma jurídica) | Empresa (tipo de entidad en lista) | Informations entreprise › Général | Tu empresa › Quién eres |
| Registro Mercantil, fecha de constitución | No existe; se teclea en Cuentas anuales | Empresa › Registro Mercantil | Del registro público | Tu empresa › Quién eres › Registro |
| Actividades (IAE, CNAE, fechas) | Configuración › Datos fiscales (solo CNAE) | Empresa › Actividad; de ellas cuelgan IVA y series | Lado asesoría | Tu empresa › A qué te dedicas (lista); de cada actividad cuelgan IVA de ventas por canal y series |
| Régimen de IVA, periodicidad, recargo, caja, prorrata, modelos | Repartido en tres sitios | Parametrización + Obligaciones fiscales | Informations entreprise › Fiscal, todo junto | Tu empresa › Tus impuestos, todo junto; modelos derivados por regla |
| Administradores, socios, cargos, % | No existe; a mano en el 200 | Socios y cargos | Répartition du capital | Tu empresa › Socios y cargos; de ahí se rellenan 200 y depósito |
| Grupo y vinculadas | No existe | Empresa (sociedades) | Filiales et participations | Tu empresa › Grupo |
| Ejercicio, cierre, bloqueo | Configuración › Contabilidad › Periodo fiscal | Periodos contables + bloqueo | Tenue comptable | Tu empresa › Ejercicio, bloqueo mes a mes |
| Plan y dígitos | Asientos y dígitos (bloqueado tras el primer asiento) | Empresa + Parametrización | Tenue comptable + ⚙️ | Tu empresa › Detalle contable; bloqueado tras el primer asiento; código completo siempre |
| Bancos | Tesorería › Cuentas | Tesorería (572 con IBAN) | Connexions bancaires | Módulo Bancos; la ficha enlaza |
| Series | Configuración › Facturación › Numeración | Series de asientos, por actividad | Facturation › Numérotation | Tablas › Numeración de facturas, ligada a actividad |
| Certificado digital | Facturación › Certificado electrónico; Holded lo guarda cifrado | No visto | No usa el del usuario (EDI) | Impuestos › Certificados y accesos; la ficha solo enlaza |
| Notificaciones DEHú, plantilla media, auditoría | Nadie lo tiene como campo | — | — | Tu empresa (ya hecho en el punto 5) |

## Reglas fijadas

1. Una sola ficha de empresa con pestañas.
2. Lo fiscal junto y los modelos por regla.
3. Actividades como lista bajo la empresa, con IVA de ventas y series colgando de cada una.
4. Ejercicio y bloqueo en su pestaña, plan y dígitos bloqueados tras el primer asiento.
5. Lo que usa otro módulo vive allí y la ficha enlaza.
6. Ninguna casilla de un modelo o del depósito se teclea dentro del modelo: tiene campo en la ficha.

## Ficha de proveedor (C01b, respuesta 2, 04/10/2026)

> Contraste de Julio antes de desplegar, con **Holded, Pennylane, Xero,
> QuickBooks, Sage, Odoo y Apicbase**. Aquí queda escrito lo que decidió. El
> detalle de Holded, Pennylane y Cegid Diez, con sus fuentes, está en
> `C01b_contraste.md`. Lo de Xero, QuickBooks, Sage, Odoo y Apicbase es lectura
> de Julio; no lo he podido comprobar desde aquí (el proxy corta sus páginas de
> ayuda).

### Entra ahora (PR #143)

| Qué | Quién lo hace | Folvy |
|---|---|---|
| IBAN distinto en una factura = aviso y freno | Pennylane (aprobación de IBAN) | La factura en ámbar «IBAN distinto al de la ficha», aviso en la ficha y «Marcar como pagada» desactivado (y rechazado por la base) hasta «Es el nuevo IBAN» o «No es suyo». Lo primero pasa a la ficha con el de antes, quién y cuándo, y pide el certificado del banco de la cuenta nueva. Nada se cambia solo. |
| Repetida en dos niveles | Pennylane (posible duplicado) | «¿Repetida?»: mismo número e importe. «¿Posible repetida?»: misma fecha e importe con otro número, con su porqué. La misma decisión humana. Contra los 179 albaranes reales de Foodint: 0 falsos positivos. |
| Acciones en la fila de la lista | La mayoría | «···» con Abrir, Subir factura y Archivar/Recuperar, sin entrar en la ficha. |

### Apuntado, no se hace ahora

| Qué | Dónde va |
|---|---|
| Alta del proveedor desde la factura, con nombre, NIF e IBAN precargados | Encargo de facturas de proveedor |
| Mínimo de pedido, días de entrega y hora límite por local | Encargo de Cocina (condiciones de pedido) |
| Fusión de proveedores duplicados | Con tesorería e impuestos |
| Mandato SEPA y marca del 347 en la ficha | Tesorería e impuestos |

### Reglas que propongo fijar (las fija Julio)

7. Un dato que cambia adónde va el dinero (el IBAN) nunca se cambia solo: frena el pago, y la persona decide.
8. Una sospecha de repetida no se apunta en las cifras hasta que la persona decide, y siempre dice por qué.

## Plan contable (C02, comprobaciones previas, 04/10/2026)

> Contraste del encargo (Holded, Pennylane, Odoo `es_pymes`, Xero, QuickBooks,
> Sage 50, Contasol, Puzzle, Digits) hecho por Julio antes de escribirlo. Lo
> medido aquí es solo **Odoo**, desde su repositorio público; Holded y Pennylane
> no se alcanzan desde el contenedor, y las capturas de **Cegid Diez** están
> pendientes. Detalle en `C02_comprobaciones_previas.md` §5.

| Qué | Odoo `l10n_es` (medido) | Folvy (propuesta C02) |
|---|---|---|
| De dónde sale el plan | Plantilla escrita a mano: 588 cuentas comunes + 44 de pymes | Cuadro del BOE descargado por Actions, con huella y vigencia |
| Título | Corregido y reescrito, sin decir de dónde sale cada corrección | Título oficial; las erratas del BOE se corrigen solo con cita de la quinta parte |
| Nivel | Cuentas de apunte (`4000`, `4100`, `4300`), no el cuadro | Cuadro (3–4 dígitos) de serie + subcuentas de la longitud elegida |
| «Qué se apunta aquí» | No | Sí, en lenguaje de la calle |
| Bancos | Prefijo `572`, caja `570`, transferencias `57299` | `572` desde `treasury_account`, una subcuenta por cuenta bancaria |

### Cegid Diez (D6, con las capturas de Julio)

> Seis capturas anonimizadas de la contabilidad de un cliente en Diez, en
> `docs/conta/capturas/diez/` (su LEEME dice qué se ha difuminado). Lo que se ve
> en ellas; lo que no se ve, va como «pendiente de captura».

| Captura | Qué hace Diez | Folvy (C02) |
|---|---|---|
| 1 · Ficha de proveedor | **El proveedor es la subcuenta**: la ficha se abre desde el plan de cuentas (pestañas Subcuentas · Datos proveedor · Movimientos · Saldos · Norma contable). Lleva por defecto para sus facturas: hasta tres tipos de IVA, la retención, el % de IVA deducible, el tipo de operación, la **subcuenta de gasto** (una subcuenta de 623, no la cuenta), la de suplidos, y la de pago. Marcas: recargo de equivalencia, no incluir en el 347, proveedor genérico, criterio de caja, REAGP. | Igual en lo esencial: una subcuenta por proveedor enlazada a su ficha (`company_account_link`), y la pestaña Contabilidad (N7) con su cuenta, dónde se apuntan sus facturas, IVA, retención y desde dónde se le paga. **Cubierto al cerrar el C02** (respuesta 2): la cuenta de sus suplidos, «IVA deducible al …%» (solo con prorrata), el tipo de operación (303/349), recargo de equivalencia y criterio de caja (solo si la empresa está en ellos), cada uno con su fuente; y «Va al 347» calculado. **No cubrimos aún**: «pago directo factura» y «proveedor genérico», que van al C04 (factura recibida). |
| 1 y 4 · Qué cuenta usa | Este cliente apunta a sus proveedores de servicios en **410** (41000002, 41000003), no en 400, y el gasto en **subcuentas** de 623 (62300001, 62300002). | **Hallazgo para la tarea 3**: hoy al activar todo proveedor va a 4000. Propongo que vaya a **4100 (acreedores)** cuando su tipo de gasto no es una compra (grupo 62 y siguientes) y a **4000** cuando lo es (60x), que es lo que hace este asesor y lo que dice el PGC de pymes en su quinta parte: 400 son «Deudas con suministradores de mercancías y de los demás bienes definidos en el grupo 3» y 410 «Deudas con suministradores de servicios que no tienen la condición estricta de proveedores». **Confirmado por Julio (respuesta 2) y hecho**: la marca va en `expense_category` (0130), la IA propone moverlo si su tipo de gasto cambia y la ficha tiene «Cambiar». |
| 2 · Movimientos | Por subcuenta: fecha, serie, documento, concepto, debe, haber y saldo, con selector de ejercicio y de subcuenta. | «Ver extracto» de la pestaña Contabilidad, vista «Apunte a apunte»: lo mismo, más el enlace a la factura o al pago. Hecho y probado con apuntes de semilla; vacío y dicho hasta que el C04 dé apuntes. |
| 3 · Saldos | Por meses, con apertura y cierre: debe, haber, saldo deudor, acreedor y acumulado, y los totales del año. | «Ver extracto», vista «Saldos por mes», por ejercicio (también los que no empiezan en enero): debe, haber, saldo, acumulado, apertura, cierre y total del año. Se llena con el C04. |
| 4 · Factura recibida | Proveedor (subcuenta), bases y cuotas de IVA, retención, suplidos, contrapartida a la subcuenta de gasto, pago y **la vista del asiento** al lado del documento escaneado. El IVA soportado va a **47200000**, la cuenta sin subcuenta por tipo. | Referencia para el C04. Ojo: nosotros creamos una 472 por tipo (47200021…), como pide el encargo; Diez, en este cliente, usa una sola. Al importar desde Diez (pendiente fuera del C02) habrá que casar las dos. |
| 5 · Impuesto sobre Sociedades | Cinta con caracteres, correcciones, compensación de bases, deducciones, modelo 200. | Fuera del C02 (el C00 ya cubre la ficha frente al 200). |
| 6 · Conciliación bancaria | Extracto por banco (57200001, 57200002) con el concepto bancario, el del asiento, la subcuenta asignada, «validado» y «contabilizado». Las plataformas de reparto tienen **su propia 430** (43000002, 43000003) y aparece la 407 (anticipos a proveedores). | Confirma D5: las plataformas serán clientes con su subcuenta en el C03, por la misma regla que los proveedores. Referencia para la conciliación, que viene después. |

**Pendiente de captura** (las seis no lo enseñan): «formato de cuentas» y «dígitos del plan» (dónde se fija la longitud y si se bloquea), «cambio de subcuentas» y «renumerar». Lo que hacemos nosotros está escrito y probado (longitud 6–12 fija desde el primer asiento, renumerado que conserva el número de cada subcuenta); el contraste con Diez en esos cuatro puntos se cierra cuando lleguen esas pantallas.

### Al cerrar el C02: qué hacen mejor ellos y qué hacemos mejor nosotros (05/10/2026)

**Mejor ellos, hoy**
- **Diez** lleva años de libros detrás: extracto, saldos, conciliación y el 200 funcionan con apuntes de verdad. Nosotros tenemos las pantallas y su núcleo probado, pero vacías hasta el C04.
- **Pennylane** deja cambiar los dígitos desde su ⚙️. Holded los bloquea tras el primer asiento, y nosotros igual (6–12 hasta el primer asiento): a propósito, porque renumerar con libros abiertos es lo que rompe la contabilidad.
- **Sage 50 y Contasol** traen modos de importación de un plan (según el contraste del encargo; no lo he podido ver yo). Nosotros aún no: queda fuera del C02, y Foodint vendrá de Diez.
- **Diez** usa una sola 47200000. Más simple de leer en un mayor; nosotros abrimos una por tipo, que es lo que pide el encargo y lo que separa el 303 sin hacer cuentas.

**Mejor nosotros**
- **La serie sale del BOE**, con huella y fecha, y cada corrección lleva su cita literal. Un agente comprueba cada noche que la serie y el BOE siguen iguales. Según el contraste del encargo, ninguno de los nueve lo hace; lo medido aquí es Odoo, que lo escribe a mano y no dice de dónde sale cada corrección.
- **«Qué se apunta aquí»** en lenguaje de la calle, y búsqueda por eso: «alquiler» encuentra la 621.
- **El plan sale montado de los datos del negocio**: una subcuenta por proveedor y por banco, la 472/477 de cada tipo de IVA y los enlaces de cada tipo de gasto y retención. El 400 o 410 se elige por lo que vende, como hace el asesor en Diez.
- **La IA propone y no ejecuta.** Cada propuesta dice su porqué, con los códigos, y su confianza. Las dudosas no interrumpen: van a la bandeja «Para revisar». Lo contestado no vuelve, y lo hecho queda en «Lo que ha hecho Folvy».
- **La ficha del proveedor enseña solo lo que aplica a la empresa**, cada dato con su fuente: prorrata, recargo y caja salen solo si los tienes. Diez enseña todas las casillas a todos.

## Libro diario (C04, 07/10/2026)

> Contraste con Holded, Cegid Diez, Pennylane y Digits/Puzzle según el encargo
> y las maquetas N11/N12. Lo de cada producto es lectura del encargo y de la
> exportación de Diez que subió Julio (series de junio de 2025); sus páginas de
> ayuda no se pueden abrir desde aquí (el proxy las corta), y se dice.

| Qué | Holded | Cegid Diez | Pennylane | Digits / Puzzle | Folvy (C04) |
|---|---|---|---|---|---|
| Series | Una numeración | Por series (1 expedidas, 2 recibidas, 3 tesorería, 4 general, 9 automáticos), número al grabar, sin orden de fechas | Diarios por tipo | Un libro | Las cinco de Diez por dentro (1, 2, 3, 4, 9), en pantalla por su palabra (Ventas · Compras · Banco · General · Nóminas); número **al validar**, sin huecos, por empresa, ejercicio y serie |
| Lo que propone la máquina | Reglas de conciliación | No | Propuestas con confianza | Todo automático, con cola de revisión | Propuesto con Seguro / Probable / Duda, una frase de porqué y su cita; nunca se valida solo (salvo la opción de la empresa para los Seguros de ventas del día) |
| Corregir lo validado | Se edita | Se edita | Se edita | Se edita | No se toca: se anula con un contraasiento enlazado (CCom art. 29.1) |
| Integridad | — | — | — | — | Huella encadenada por asiento (LGT 29.2.j, RD 1007/2023); «Comprobar la cadena» en Detalle contable y el agente cada noche |
| Local y marca | Etiquetas | Centros de coste | Analítica | Clases | Local (o «común», repartido por regla) y marca en cada apunte; resultado por local que suma el total |
| Ventas de plataforma | Por factura | Por documento de la plataforma | Por factura | Por cobro | Resumen del día por local de las facturas simplificadas (RIVA 63.4), devoluciones el día que pasan; la liquidación solo comisión, cargos y cobro |
| Mes cerrado | Bloqueo | Bloqueo de periodos | Clôture | Close | Bloqueo mes a mes; lo que llega tarde va al primer día abierto; «Pedir desbloqueo» con motivo |

### Citas del C04, comprobadas contra su texto vigente

Las de `src/modules/conta/lib/normas.ts` las vigila la prueba de cumplimiento
(`tests/conta/cumplimiento/normas.test.ts`): el literal tiene que estar en el
bloque vigente de su fuente. Las de la semilla de staging y del agente se
comprobaron a mano el 07/10 en `docs/conta/fuentes/textos/`, versión vigente:

| Cita | Dónde se usa | Versión vigente | Lo que dice |
|---|---|---|---|
| CCom art. 25.1 | normas · libroDiario | desde 1996-11-01 | Llevará necesariamente un libro de Inventarios y Cuentas anuales y otro Diario |
| CCom art. 28.2 | normas · resumen del día | desde 2013-09-29 (Ley 14/2013, art. 48) | Anotación conjunta por periodos **no superiores al trimestre** |
| CCom art. 29.1 | anulación con contraasiento | desde 1996-11-01 | Sin espacios en blanco, interpolaciones, tachaduras ni raspaduras; los errores se salvan a continuación |
| LIVA art. 80.Dos | devoluciones de plataforma | desde 2023-01-01 | Si queda sin efecto total o parcialmente la operación, la base se modifica en la cuantía correspondiente |
| LIVA art. 90.Uno | comisión y alquiler al 21 % | desde 2012-07-15 | El impuesto se exige al tipo del 21 por ciento |
| LIVA art. 91.Uno.2.2.º | ventas al 10 % | hay una versión guardada desde 2026-12-01 (BOE-A-2026-20266) | Servicios de hostelería… los de restaurantes: sigue igual en esa versión |
| RIVA art. 63.4 | resumen del día | desde 2023-07-01 | La anotación individualizada se puede sustituir por asientos resúmenes |
| RD 1619/2012 art. 15.2 | rectificativa solo si hubo factura | — (normas) | Será obligatoria la expedición de una factura rectificativa |
| PGC de Pymes (RD 1515/2007), NRV 16.ª — empresa con `chart_kind = 'pymes'` | marca cedida | — (normas) | «… así como las cantidades recibidas por cuenta de terceros, no formarán parte de los ingresos» |
| PGC normal (RD 1514/2007), NRV 14.ª — empresa con `chart_kind = 'normal'` | marca cedida | redacción del RD 1/2021 | «No formarán parte de los ingresos … así como las cantidades recibidas por cuenta de terceros» |
| RD 439/2007 art. 100 | retención del alquiler | desde 2018-12-23 | Retención del 19 por ciento sobre el arrendamiento de inmuebles urbanos |
| RD 439/2007 art. 108 | IRPF de la nómina al 111 | desde 2015-07-12 | Declaración trimestral de las cantidades retenidas |

Fuentes nuevas en `docs/conta/fuentes/fuentes.json`, con su identificador
comprobado en el BOE: Ley 58/2003 General Tributaria (BOE-A-2003-23186), RD
1007/2023 (BOE-A-2023-24840), Ley 14/2013 (BOE-A-2013-10074) y la Resolución
del ICAC de 10/02/2021 sobre ingresos (**BOE-A-2021-2155**; el identificador
que tenía apuntado, 2021-2347, era otro). La descarga nocturna comprueba que
cada una contiene su frase.

La marca cedida se cita **según el plan de la empresa** (`company_tax_profile.chart_kind`): las dos normas dicen lo mismo con distinto número, y antes la semilla y el agente decían «PGC NRV 16.ª» a secas, que en el plan normal es otra norma. Hoy el núcleo (`NORMAS.ingresosPorCuentaDeTerceros`) cita la de pymes porque las dos empresas de prueba son de pymes; el agente nocturno da las dos en su norma. Comprobado en los textos guardados: `rd-1515-2007.txt` línea 1168 (16.ª) y `rd-1514-2007.txt` líneas 1797 y 1835 (14.ª, versión vigente).

### Lo cobrado por cuenta del socio de marca: ¿419 o 410? (respuesta 3, 12/10/2026)

Lo que la empresa cobra de las ventas de una marca cedida es del socio: no es
ingreso (NRV 16.ª del PGC de Pymes, 14.ª del normal) y tampoco es lo que se le
compra (su 400). Va a una subcuenta propia por socio, «Liquidación pendiente con
<socio>», que su liquidación mensual compensa con su 430 y su 400. Dónde cuelga:

| Cuenta | Lo que dice el BOE (RD 1515/2007, quinta parte; igual en el RD 1514/2007) | ¿Encaja? |
|---|---|---|
| **419** Acreedores por operaciones en común | «Deudas con partícipes en las operaciones reguladas por los artículos 239 a 243 del Código de Comercio y en otras operaciones en común de análogas características.» Se abona por las aportaciones recibidas como partícipe gestor o por el beneficio que deba atribuirse a los no gestores (6510). | **No.** El art. 239 CCom es la cuenta en participación: «contribuyendo para ellas con la parte del capital que convinieren, y haciéndose partícipes de sus resultados prósperos o adversos». Con la marca cedida no hay aportación ni reparto de resultados: la empresa vende en nombre ajeno (camino B, LIVA 11.Dos.15.º), cobra por cuenta del socio y lo suyo es solo la comisión (705). La 449 (el signo contrario) cae por lo mismo. |
| **410** Acreedores por prestaciones de servicios | «Deudas con suministradores de servicios que no tienen la condición estricta de proveedores.» | **Sí**, la que queda: es una deuda con el socio que no es de mercancía (eso es su 400) y se salda en su liquidación. Es la que dijo Julio si la 419 no encajaba. |

En el plan: hoja 4100, subcuenta «Liquidación pendiente con <socio>», enlazada
al socio con el papel `liquidacion` (C04 · 0110). Se crea al confirmar el papel de
socio (ficha, lista de terceros y revisión de las 430 de Diez) o desde «Sus
cuentas» si ya lo era. Textos leídos en `docs/conta/fuentes/textos/rd-1515-2007.txt`
(419: líneas 5244–5255; 410: 5226–5235) y `codigo-comercio.txt` (art. 239).

## Libros y balances (C05, 08/10/2026)

### Configuración de Cegid Diez, transcrita por Julio (respuesta 1, d)

Transcrita de las capturas de Julio, sin cifras de la empresa. El asterisco
marca las cuentas que van a una línea u otra según el signo del saldo (en Folvy,
`annual_accounts_mapping.by_balance`).

**Balance abreviado · línea ← cuentas**

| Línea | Cuentas en Diez |
|---|---|
| A.I Inmovilizado intangible | 20, 280, 290 |
| A.II Inmovilizado material | 21, 281, 291, 23 |
| A.III Inversiones inmobiliarias | 22, 282, 292 |
| A.IV Grupo y asociadas a largo plazo | 2403, 2404, 2413, 2414, 2423, 2424, 2493, 2494, 2933, 2934, 2943, 2944, 2953, 2954 |
| A.V Inversiones financieras a largo plazo | 2405, 2415, 2425, 2495, 250–255, 257–259, 26, 2945, 2955, 297, 298, 2935… |
| A.VI Activos por impuesto diferido | 474 |
| B.I Mantenidos para la venta | 580–584, 599 |
| B.II Existencias | 30–36, 39, 407 |
| B.III.1 Clientes | 430–437, 490, 493 |
| B.III.2 Socios por desembolsos exigidos | 5580 |
| B.III.3 Otros deudores | 44, 460, 470, 471, 472, 544, 473 |
| B.IV Grupo y asociadas a corto plazo | 5303, 5304, 5313, 5314… y *5523, *5524 |
| B.V Inversiones financieras a corto plazo | 5305, 5315…, 540–549, *551, *5525… |
| B.VI Periodificaciones | 480, 567 |
| B.VII Efectivo | 57 |
| A-1.I.1 Capital | 100, 101, 102 |
| A-1.I.2 Capital no exigido | 1030, 1040 |
| A-1.II Prima de emisión | 110 |
| A-1.III Reservas | 112–115, 119 |
| A-1.IV Acciones propias | 108, 109 |
| A-1.V Resultados de ejercicios anteriores | 120, 121 |
| A-1.VI Otras aportaciones de socios | 118 |
| A-1.VII Resultado del ejercicio | 129, 6, 7 |
| A-1.VIII Dividendo a cuenta | 557 |
| A-1.IX Otros instrumentos de patrimonio | 111 |
| A-2 Ajustes por cambios de valor | 133, 1340, 1341, 137 |
| A-3 Subvenciones | 130, 131, 132 |
| B.I Provisiones a largo plazo | 14 |
| B.II.1 Entidades de crédito a largo plazo | 1605, 170 |
| B.II.2 Arrendamiento financiero a largo plazo | 1625, 174 |
| B.II.3 Otras deudas a largo plazo | 1615, 1635, 171–173, 175–180, 1851, 189 |
| B.III Grupo y asociadas a largo plazo | 1603, 1604, 1613, 1614, 1623, 1624, 1633, 1634 |
| B.IV Pasivos por impuesto diferido | 479 |
| B.V Periodificaciones a largo plazo | 181 |
| Deuda con características especiales a largo plazo | 15 |
| C.I Vinculados a activos no corrientes | 585–589 |
| C.II Provisiones a corto plazo | 499, 529 |
| C.III.1 Entidades de crédito a corto plazo | 5105, 520, 527 |
| C.III.2 Arrendamiento financiero a corto plazo | 5125, 524 |
| C.III.3 Otras deudas a corto plazo | 1034, 1044, 190, 192, 194, 500, 501, 505, 506, 509, 510, 5115, 5135, 5145, 521–523, 525, 526… |
| C.IV Grupo y asociadas a corto plazo | 5103, 5104, 5113, 5114, 5123, 5124, 5133, 5134, 5143, 5144, *5523, *5524, 5563, 5564 |
| C.V.1 Proveedores | 400, 401, 403–406 |
| C.V.2 Otros acreedores | 41, 438, 465, 466, 475, 476, 477 |
| C.VI Periodificaciones a corto plazo | 485, 568 |
| Deuda con características especiales a corto plazo | 502, 507 |

**PyG abreviada · línea ← cuentas (numeración de Diez)**

| Diez | Línea | Cuentas |
|---|---|---|
| 1 | Cifra de negocios | 700–709 |
| 2 | Variación de existencias | 6930, 71, 7930 |
| 3 | Trabajos para el activo | 73 |
| 4 | Aprovisionamientos | 600–602, 606–609, 61, 6931–6933, 7931–7933 |
| 5 | Otros ingresos de explotación | 740, 747, 75 |
| 6 | Gastos de personal | 64, 7950, 7957 |
| 7 | Otros gastos de explotación | 62, 631, 634, 636, 639, 65, 694, 695, 794, 7954 |
| 8 | Amortización | 68 |
| 9 | Imputación de subvenciones | 746 |
| 10 | Excesos de provisiones | 7951, 7952, 7955, 7956 |
| 11 | Deterioro y enajenación del inmovilizado | 670–672, 690–692, 770–772, 790–792 |
| 12 | Diferencia negativa en combinaciones de negocios | 774 |
| 13 | Otros resultados | 678, 778 |
| 14.b | Otros ingresos financieros | 760–762, 767, 769 |
| 14 | Gastos financieros | 660–662, 664, 665, 669 |
| 15 | Valor razonable | 663, 763 |
| 16 | Diferencias de cambio | 668, 768 |
| 17 | Deterioro de instrumentos financieros | 666, 667, 673, 675, 696–699, 766, 773, 775, 796–799 |
| 18 | Impuesto sobre beneficios | 6300, 6301, 633, 638 |

El ECPN y el estado de ingresos y gastos reconocidos no se transcribieron: salen
del PGC (grupos 8 y 9 contra la 129), como pidió Julio.

### Diferencias con el mapeo de Folvy (del texto consolidado del BOE)

Medido con un guion, no a ojo: cada prefijo de la transcripción se busca en el
mapeo del modelo abreviado de `supabase/conta/pgc/cuentas-anuales.json` (el
prefijo más largo manda, como en la pantalla). **217 prefijos del balance y 99
de la PyG.** Salen 10 «distintos»; mirados uno a uno contra el BOE:

| Cuenta | Diez | Folvy | Quién tiene razón y por qué |
|---|---|---|---|
| *5523, *5524 | activo B.IV y pasivo C.IV, por signo | lo mismo, por signo | **Iguales.** El guion las marca porque aparecen en dos líneas; en Folvy también van por signo. |
| *551, *5525 | activo B.V por signo | B.V si es deudor; C.III.3 si es acreedor | **Iguales en lo que se ve.** La transcripción solo recoge el lado del activo; Folvy añade el del pasivo, que es el que dice el BOE. |
| 544 | III.3 Otros deudores (y dentro del rango «540–549» de B.V) | III.3 Otros deudores | **Iguales.** El BOE la pone en «Otros deudores» (modelo abreviado: «44, 460, 470, 471, 472, 544»). El rango 540–549 de B.V es una abreviatura de la transcripción. |
| 707 | dentro del rango «700–709» | — | **No es diferencia:** la 707 no existe en el cuadro de cuentas. |
| 2935 | A.V Inversiones financieras a largo plazo | **Ahora también A.V** (respuesta 3) | **Diez.** La 2935 corrige la 2405 (otras partes vinculadas), y una correctora va en la línea de la cuenta que corrige. El modelo del BOE escribe «(293)» entera en grupo y asociadas. El plan general vigente ya no tiene la 2935, pero una empresa traída de Diez sí. Lo mismo para la 5935 a corto plazo; la 2945 y la 2955 ya estaban bien. |
| 510 | C.III.3 Otras deudas a corto plazo | **Ahora también «Otras deudas a corto plazo»**, colocada por defecto y con «Completar» (respuesta 3) | **Diez.** Una deuda de 3 cifras con partes vinculadas va a la línea «otras» de su grupo. Al completarla, 5103 y 5104 van a grupo y asociadas y 5105 a entidades de crédito. La misma regla mueve la 160, la 162 y la 512 (12 filas en los tres modelos, medidas). |

**Resultado:** de 316 prefijos salían 2 diferencias reales (2935 y 510). Las dos
se resuelven como Diez (respuesta 3), así que ya no queda ninguna.

### Regla: una correctora va en la línea de la cuenta que corrige

Amortizaciones, deterioros y desembolsos pendientes (28x, 29x, 249x, 39x, 490,
539x, 59x) restan **en la misma línea** que su cuenta corregida, aunque el
modelo del BOE las agrupe por subgrupo. La prueba
`tests/unit/modules/conta/correctorasC05.test.ts` lo comprueba en los tres
modelos con 59 parejas «correctora → corregida». La tabla sale de las
definiciones del cuadro de cuentas, no del generador.

### Regla: una deuda de 3 cifras con partes vinculadas va a «otras»

Las cuentas de 3 cifras que el modelo reparte entre grupo y asociadas (…3, …4)
y otras partes vinculadas (…5), cuando son deudas (160, 162, 510, 512), van a la
línea «Otras deudas…» u «Otros pasivos financieros» de su grupo. Van marcadas
«colocada por defecto» y con «Completar».

La regla se probó primero en general, a toda cuenta de 3 cifras, y daba
disparates: 103/104 (capital no exigido) a deudas, 630 (impuesto sobre
beneficios) a otros ingresos, y la 552 perdía la colocación por signo. Por eso
se queda en las deudas con partes vinculadas. El resto sigue con su hija «otras»
(la que acaba en 5).

### La numeración de la PyG: Diez no es el BOE

Diez numera «12. Diferencia negativa», «13. Otros resultados», «14.b Otros
ingresos financieros»… El texto consolidado de la PyG abreviada (y la de pymes)
no tiene esas líneas numeradas. «Diferencia negativa de combinaciones de
negocio» y «Otros resultados» son partidas que las normas de elaboración
(normal y abreviado: norma 7.ª.6 y 7.ª.9; pymes: norma 6.ª.6) mandan **añadir**
cuando hay importe. Folvy sigue el texto del PGC:

- «Otros resultados» es una partida «a crear». Solo aparece si tiene saldo, dentro de «A) Resultado de explotación», justo después de la línea 11. Cita la norma 6.ª.6 (pymes) o la 7.ª.9 (abreviado y normal).
- Las líneas del BOE mantienen su número: 12 es «Ingresos financieros», no «Diferencia negativa».

**Sospecha, no comprobada:** la numeración de Diez sale del modelo de depósito
del Registro Mercantil (Orden JUS/616/2022), que numera las casillas a su
manera. El cruce línea a línea con las casillas va en el C05b.

### 774 en pymes

El modelo de pymes no tiene «Diferencia negativa de combinaciones de negocio».
Si la 774 tiene saldo en una empresa de pymes, sale en rojo «sin sitio en el
modelo» (regla 2) y la IA explica por qué. Nunca se esconde en otra línea.

### Corrección del encargo

El encargo decía «arts. 257–258 CCom»: son de la **Ley de Sociedades de
Capital** (RDL 1/2010). Límites vigentes del abreviado y de pymes: 4 M de
activo, 8 M de cifra de negocios y 50 personas (LSC 257.1; RD 1515/2007 art.
2.1 en su versión vigente, que coincide). Para la PyG abreviada: 11,4 M, 22,8 M
y 250 personas (LSC 258.1). Hay un solo umbral, y el aviso «entre ambos» se ha
quitado.

### Opciones de los listados de Diez y dónde están en Folvy

| Diez | Folvy |
|---|---|
| Sumas y saldos: las siete opciones, rango de subcuentas, fecha y salida | Libros › Mayor y saldos › Sumas y saldos: las siete casillas, «desde»/«hasta» cuenta, la fecha y PDF o Excel. **El correo no está:** queda apuntado. |
| Listado de facturación | Dentro de Expedidas y Recibidas, como filtros: subcuenta, NIF, «importe superior a», tipo de factura, «agrupar por NIF» y «solo las del 347». Con filtros puestos, la cabecera dice «N de M» (regla 7). |
| Libro de requerimientos | Libros registro › Formato AEAT: el Excel con las hojas y columnas del diseño de la AEAT (acumulado del 1 de enero al final del trimestre) y el zip con los documentos de las recibidas. Dentro va `indice.txt` con las que no tienen documento o no se pudieron bajar. |
