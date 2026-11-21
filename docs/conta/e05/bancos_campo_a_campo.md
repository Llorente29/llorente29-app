# E05 · Bancos del núcleo · campo a campo contra la maqueta y ERP10

Maqueta: `nucleo_6_bancos.png` (aprobada por Julio el 17/11). ERP10: «Introducción de
asientos por tesorería» y Utilidades › Conciliación (`erp10_pantallas_referencia.md`).
Reglas: `nucleo_reglas_comunes.md`. Escrito antes de la pantalla, como piden las reglas.

Lo que ya existe se usa **por dentro**: el motor de conciliación
(`supabase/functions/_shared/bancos/nucleo.ts`: `confirmar`, `deshacer`,
`conciliarPendientes`), las lecturas de `services/bancosPantallas.ts` y las funciones
puras de `lib/conciliarVista.ts` y `lib/bancosVista.ts`. **Ninguna pantalla de hoy se toca.**

## Cabecera

| Maqueta | ERP10 | Dato | De dónde sale hoy | ¿Existe? |
|---|---|---|---|---|
| «Bancos» | «Introducción de asientos por tesorería» | título | — | — |
| `57200001 · Banco principal ▾` | subcuenta del banco | las cuentas de banco de la empresa, con su 572 | `bancosDeLaEmpresa` (treasury_account + company_account_link, rol principal) | sí |
| «14 por revisar» | — | movimientos del banco elegido que esperan a una persona | `leerMovimientos` (bank_movement, estado propuesto / por aclarar) | sí |
| «● El saldo cuadra. Banco y Sumied, 12.480,15 a 31/07» | saldo a la fecha | el saldo del extracto contra el de la 572, a la fecha | `cuadreDe` (bank_statement.closing_balance y `saldosContables`) | sí |
| «Más» | — | lo que hoy hay en Bancos y no está en la maqueta | — | **pregunta 4** |
| «Traer el extracto» | «Leer fichero de extracto bancario» | subir el extracto | la página de hoy (`bancos/subir`), en una pestaña del marco | sí |
| — | periodo, serie | el mes de los movimientos; serie 3 Tesorería | `leerMovimientos(…, mes)`; la serie la pone el motor | sí (el periodo no está en la maqueta: **pregunta 7**) |

## La rejilla

| Maqueta | ERP10 | Dato | De dónde sale hoy | ¿Existe? |
|---|---|---|---|---|
| Fecha | fecha | fecha de la operación | bank_movement.op_date | sí |
| Lo que dice el banco | concepto | el concepto del banco tal cual | bank_movement.bank_concept (`textoDelBanco`) | sí |
| A qué va | subcuenta | la subcuenta y su nombre: la del asiento si está casado; si no, la de la propuesta | casado → su asiento; propuesta → `asientoQueSeCrea` (destino guardado) | sí |
| Ingreso | ingreso | importe > 0 | bank_movement.amount | sí |
| Pago | pago | importe < 0, sin signo | bank_movement.amount | sí |
| «Mira esto» (ámbar) | — | propuesto probable o duda | estado + confianza | sí |
| «Hecho solo» (verde) | — | casado por Sumied | casado.porQuien = folvy | sí |
| «Sin saber» (gris) | — | por aclarar, sin propuesta | estado por_aclarar | sí |
| lo seguro, en verde y ya marcado | — | propuesto seguro, preseleccionado para confirmar en bloque | `preseleccionado` (propuesta.preseleccionar) | sí (cómo se pinta: **pregunta 1**) |
| — | documento | n.º de documento | el número del asiento, cuando se valida | sí (no está en la maqueta: **pregunta 7**) |

## Abajo

| Maqueta | ERP10 | Dato | De dónde sale hoy | ¿Existe? |
|---|---|---|---|---|
| «Escribir uno a mano · si no viene en el extracto»: Fecha, Cuenta (F4), Concepto, Ingreso, Pago | la línea de edición | un apunte de tesorería sin movimiento del banco | — | **no**: tanda que solo añade (**pregunta 3**) |
| «Saldo de la cuenta a la fecha 12.480,15» | saldo a la fecha | saldo de la 572 a la fecha del movimiento elegido | `saldosContables(empresa, fecha, [572])` | sí |
| La ayuda de teclas: Intro, ↑↓, F4, F5, Esc | el teclado de ERP10 | — | el teclado común del núcleo (#724, aún no en `main`) | **pieza común**: se usa cuando entre |

## A la derecha · «Qué es»

| Maqueta | Dato | De dónde sale hoy | ¿Existe? |
|---|---|---|---|
| «31/07/2026 · Transferencia a … · pago» y el importe | fecha, quién, ingreso o pago | `quienEs`, importe | sí |
| «Creo que paga esta factura. F-2026/0412 de …, del 01/07, por 357,44. Mismo importe y vencía hoy.» | la propuesta y su porqué | bank_movement.reason (`m.porque`) y la propuesta guardada | sí |
| «Sí, es ese pago [Intro]» | confirmar la propuesta | `nucleo.confirmar`, como hoy (con la comprobación del motor) | sí |
| «Es otra factura» | casar con otra factura | `facturasParaCasar` + `nucleo.confirmar` | sí |
| «O es otra cosa»: Pago sin factura todavía · Traspaso entre mis cuentas · Comisión del banco · Nómina o impuesto · Lo ha pagado un socio | otro destino | los destinos del motor (`Destino`): sin factura, traspaso, cuenta 626, nómina / impuesto, cuenta del socio | sí |
| «El asiento que sale · Cuadra · 357,44» y sus líneas | el asiento | `asientoQueSeCrea` (casado: el suyo) | sí |
| «Hacerlo solo la próxima vez que pase igual» | guardar una regla | `bank_regla_guardar` (la de hoy, solo en Reglas) | **pregunta 2** |
| — (deshacer) | deshacer lo casado | `nucleo.deshacer`, como hoy | sí (dónde: **pregunta 5**) |

## A la derecha · «El documento»

| Maqueta / encargo | Dato | De dónde sale hoy | ¿Existe? |
|---|---|---|---|
| el justificante del movimiento; si no, «Falta el justificante» | el ticket o la factura casada | bank_movement.ticket (`subirTicket`) y el PDF de la factura casada | sí |

## Dónde se abre

| Maqueta / encargo | Hoy en el núcleo | ¿Existe? |
|---|---|---|
| Asientos › «Bancos 14» (maqueta) | `mapa.ts`: Asientos › Bancos, con su contador | sí |
| Importaciones › «Del banco» (encargo) | Importaciones › Bancos: «Traer el extracto» | **pregunta 6** |
| Línea de estado «Bancos cuadrados con el extracto de hoy» | `estado.ts` (K02): espera a que algo lo cuente | **pregunta 6** |

## Lo que la maqueta no dice (para Julio, antes de pintarlo)

1. **Confirmar los seguros en bloque.** El encargo lo pide («confirmar los 24») y la maqueta no lo enseña. Propongo: los seguros, con su punto verde y ya marcados, y un botón «Confirmar los N» en la cabecera, a la derecha de «14 por revisar», solo cuando hay alguno marcado.
2. **«Hacerlo solo la próxima vez que pase igual».** Guardaría una regla con `bank_regla_guardar`, la de hoy. El encargo deja fuera las reglas nuevas: ¿se pinta y guarda la regla de hoy, o se deja sin pintar hasta otro encargo?
3. **«Escribir uno a mano».** No existe en la base. Propongo una tanda que solo añade, una función que crea el asiento de tesorería (serie 3: la 572 contra la cuenta elegida, con su concepto) como «propuesto», igual que lo que casa el banco. ¿Propuesto o validado al momento?
4. **«Más».** Propongo lo que hoy cuelga de Bancos y la maqueta no tiene: Cuentas y extractos, Reglas del banco, Hecho por Sumied y Cerrar el mes.
5. **Deshacer.** No está en la maqueta. Propongo, en «Qué es» de un movimiento casado, «Deshacer» como enlace (como en «Pasada sola»), con su confirmación con contenido.
6. **Dónde se abre.** La maqueta lo pone en Asientos › «Bancos 14» y el encargo dice Importaciones › «Del banco». Propongo los dos: Asientos › Bancos (ya está) y un «Del banco» en Importaciones › Bancos, al lado de «Traer el extracto». Y «Bancos cuadrados» en la línea de estado, contado con el mismo cuadre de la pantalla.
7. **El periodo y el documento de ERP10.** La maqueta no los tiene. Propongo no ponerlos: el mes sale de la fecha de los movimientos que hay, y el número de documento lo da el asiento validado.

## Lo que no entra

Conectar bancos (el agregador), pagar desde Sumied, las reglas de conciliación nuevas y subir extractos (el botón lleva a la página de hoy, en una pestaña del marco).
