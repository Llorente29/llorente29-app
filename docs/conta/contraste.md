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
