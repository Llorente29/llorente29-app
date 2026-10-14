# B01 — Respuesta 1 (tarea 1 revisada)

> Copia de trabajo de la respuesta de Julio (13/10/2026), íntegra. El contraste
> de partida que venía al final está en `docs/conta/contraste.md`, sección
> «Bancos y conciliación (B01)».

Buenas comprobaciones. Lo de las tres cuentas y el pago que saldría dos veces cambia el diseño a tiempo.

Sobre lo que no te llegó: la maqueta la adjunta Julio en este mensaje (`maqueta_B01.zip`). El contraste del benchmark va copiado al final de esta respuesta; guárdalo en `docs/conta/contraste.md` como base del tuyo.

## Respuestas

* P1 · Cuentas (Julio): las tres están vivas. No supongas de qué local es cada una. Al dar de alta o completar una cuenta, la pantalla pregunta «¿De qué local es esta cuenta?» (un local o «común») y Julio lo contesta en producción.
   * El banco que hay hoy en Folvy, con el IBAN de un tercero, sale como «Revisa esta cuenta: el IBAN no es de tu empresa», con la corrección propuesta cuando el primer Norma 43 traiga el IBAN de verdad. Nunca se corrige solo.
   * Las otras dos se proponen como alta desde sus subcuentas 57200002 y 57200003, con su IBAN por completar o tomado del primer extracto.
* P2 · Quién manda en el pago: sí, el movimiento del banco.
   * Si hay extracto de ese periodo, «Marcar como pagada» deja de proponer asiento y al casar se rellena el pago de la factura.
   * Si ya existe un asiento de pago (propuesto o validado) para esa factura, se enlaza al movimiento y no se crea otro.
   * Sin extracto (pago en efectivo o banco no subido), «Marcar como pagada» sigue igual que hoy.
   * Lo mismo con «cobrada» en las liquidaciones.
   * Prueba: el mismo pago por los dos caminos da un solo asiento.
* P3 · Serie: la de tesorería de la empresa, configurable. Para Foodint, la 4, como Diez desde abril de 2025, para que la comparación y el envío a Diez casen.
   * La serie 3 del C04 queda para lo que ya usa.
   * En el informe di qué pagos de Folvy están hoy en la 3 y si hay que moverlos. Si hay que moverlos, no lo hagas: propón cómo.
* P4 · Desde cuándo: desde la fecha de corte de la empresa (Foodint 01/10/2026).
   * Un extracto anterior solo enlaza con lo que ya está en el libro (traído de Diez) y no crea asientos.
   * Lo que no encuentre pareja antes del corte sale como «Antes del corte · sin pareja en el libro», solo informativo.
* P5 · Correo: queda preparado, no entra. La bandeja de documentos por correo es el encargo E01, y no se hacen dos buzones. Deja la fuente `correo` con su contrato y su prueba.
* P6 · 407, 551 y 521:
   * 407 (anticipos a proveedores) va como cruce propio: pago a un proveedor conocido sin factura pendiente → «Anticipo a <proveedor>» (407), y cuando llega su factura se compensa con el anticipo. Hay 166 líneas, así que es un caso normal.
   * 551 y 521 van a «Por aclarar» y aprenden reglas por contraparte, con su cuenta propuesta y el porqué.
* P7 · Liquidaciones desde julio:
   * Hoy entran a mano por CSV (lo que ya existe); la carga automática es E03/E04.
   * Mientras no haya liquidación, el cobro de una plataforma se casa como probable contra lo pendiente de cobro en su 430 en el periodo (las ventas del día ya asentadas), nunca como seguro, con el porqué «sin liquidación: cuadra con las ventas de 1–7 oct menos un X % de comisión habitual».
   * La diferencia queda pendiente hasta que llegue la liquidación, que la explica (comisión a su 410/623).

## Sigue

Tareas 2 a 4, sin parar salvo bloqueo. Para en la 5, antes de las pantallas, con capturas de staging del motor funcionando sobre un Norma 43 inventado de las tres cuentas.
