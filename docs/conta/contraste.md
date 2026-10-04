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

### Pendiente
- Cegid Diez: «formato de cuentas», «dígitos del plan», «cambio de subcuentas», «renumerar» — con las capturas de Julio.
