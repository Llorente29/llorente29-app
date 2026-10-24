# N4 · Sacar los disparadores de Sumied de las tablas de Folvy — el plan

> Paso 6 de la auditoría C09. **Solo el documento, sin código.** Se decide con
> Julio antes de tocar nada. Medido en producción, en solo lectura, el 24/10
> (`pg_trigger` y `pg_proc`).

## 0 · El recuento: son 10, no 13

El C09 dijo «13». Medido hoy disparador a disparador, **en tablas de Folvy hay
10**, en cuatro tablas: 4 en `supplier`, 4 en `supplier_invoice`, 1 en
`goods_receipt` y 1 en `accounts`. Las demás funciones de Sumied con
disparador cuelgan de tablas de Sumied (`company_account`, `party_role`,
`treasury_account`, `bank_match`…), o de `tax_rate`, `expense_category` y
`withholding_rate` (`company_account_link_sin_dueno`), que son catálogos de la
contabilidad. No he podido reconstruir de dónde salían los otros 3 del C09; lo
más probable es que contara esas tres tablas como de Folvy. **Que Julio diga de
quién son `tax_rate`, `expense_category` y `withholding_rate`**: si son de
Folvy, son 13 y entran en el plan con el mismo patrón que el 4.

## 1 · Los 10, uno a uno

«Camino» es quién escribe en esa tabla y, por tanto, quién paga si el
disparador falla. «Rompe» dice si un error del disparador para la escritura
de Folvy.

| # | Tabla · disparador | Momento | Qué hace | Rompe la escritura de Folvy |
|---|---|---|---|---|
| 1 | `goods_receipt` · `trg_goods_receipt_compras_camino` | after update of status, cuando cambia | Al confirmar (o anular una con camino) una recepción, decide por dónde va a contabilidad (`_compras_camino_guarda` → `goods_receipt_path`). | **No**: dos `exception when others`; si falla, apunta el camino como «error» o deja un `warning`. |
| 2 | `supplier` · `trg_party_desde_proveedor` | after insert, update of name, tax_id, archived_at | Crea o actualiza el tercero (`party`, `party_role`) del proveedor. | **No**: `exception when others` → `warning`. |
| 3 | `supplier` · `trg_party_al_borrar_proveedor` | before delete | Borra el papel del tercero y el tercero si se queda sin papeles. | **Sí**: un error para el borrado del proveedor. |
| 4 | `supplier` · `company_account_link_sin_dueno` | after delete | Borra los enlaces a subcuentas del proveedor borrado y lo apunta en `company_account_log`. | **Sí**. |
| 5 | `supplier` · `trg_supplier_tax_rates_ok` | before insert, update of usual_tax_rate_ids, account_id | Para un IVA habitual que no es del sistema ni de la cuenta. | **Sí, a propósito**: es una guarda. |
| 6 | `supplier_invoice` · `bank_factura_aprobada_con_pago` | after update of status | Al aprobar una factura que ya tenía su pago casado en Bancos, la marca pagada. | **No**: `exception when others` → lo apunta en el registro de Bancos. |
| 7 | `supplier_invoice` · `supplier_invoice_iban_guard` | before update of status | No deja marcar pagada una factura cuyo IBAN leído no es el de la ficha, sin decidir. | **Sí, a propósito**: guarda. |
| 8 | `supplier_invoice` · `trg_supplier_invoice_aprobacion` | before insert, update of status | Al aprobar: aplica la regla de quién puede aprobar (`invoice_approval_rule`) y sella quién y cuándo. Sin usuario (servidor), no mira. | **Sí, a propósito**: guarda de permisos. |
| 9 | `supplier_invoice` · `trg_supplier_invoice_no_repetida` | before insert, update of invoice_number, supplier_id, status, not_duplicate_confirmed_at, grand_total | No deja entrar dos veces la misma factura (proveedor, número normalizado y total). | **Sí, a propósito**: guarda. |
| 10 | `accounts` · `trg_accounts_create_gestoria_config` | after insert | Crea `account_gestoria_config` de una cuenta de Folvy (no de una solo de contabilidad). | **Sí**, pero solo es un `insert … on conflict do nothing`. |

**Lo que dice esta tabla:** solo 3 de los 10 (1, 2 y 6) son «Sumied reacciona
a algo de Folvy». Los otros 7 son de dos clases distintas, y cada clase pide
una salida distinta:

- **Guardas de un dato que es de los dos** (5, 7, 8 y 9): protegen la
  integridad de `supplier` y `supplier_invoice`, que hoy escriben Folvy y
  Sumied (paso 7, «dueño único»). Una guarda **no se saca**: se queda con el
  dueño del dato. Quién es el dueño lo decide el paso 7.
- **Limpieza al borrar** (3 y 4) y **alta de cuenta** (10): Sumied ordena lo
  suyo cuando Folvy borra o crea algo.

## 2 · Por dónde se sustituye cada uno

Tres salidas, de menos a más obra:

- **A · Cola de eventos** (para los que reaccionan): el disparador se queda en
  la tabla de Folvy pero **solo apunta** una fila en una tabla de eventos
  (`frontera_evento`: tabla, id, qué pasó, cuándo), sin lógica de Sumied y sin
  poder fallar más que un `insert`. Sumied la consume a su ritmo (cron cada
  minuto o al abrir la pantalla) y hace lo de hoy. Folvy deja de ejecutar
  código de Sumied; Sumied deja de depender de que su código no falle dentro
  de una transacción ajena.
- **B · Clave ajena en vez de disparador** (para la limpieza al borrar): que
  `party_role.supplier_id` y el enlace a subcuentas tengan `on delete cascade`
  (o `set null`) hacia `supplier`, en vez de un disparador que borra a mano.
  Lo hace la base, no un código de nadie.
- **C · Se queda, con dueño** (para las guardas): se mueve solo si el paso 7
  decide que el dueño del dato es el otro.

| # | Salida | Cómo |
|---|---|---|
| 1 · compras_camino | **A** | El disparador apunta «recepción confirmada / anulada». Un `conta_compras_camino_pendientes()` cada minuto llama a `_compras_camino_guarda`. El camino llega con un minuto de retraso; hoy nadie lo lee en el mismo instante (lo lee la pantalla de Compras). |
| 2 · party_desde_proveedor | **A** | El disparador apunta «proveedor creado / cambiado». Sumied crea o actualiza el tercero al consumirlo. Hasta entonces el proveedor existe sin tercero; hoy, si falla, ya pasa lo mismo («queda sin enlazar y el agente lo dice»). |
| 3 · party_al_borrar_proveedor | **B** | `party_role.supplier_id` con `on delete cascade`; el tercero huérfano lo barre Sumied (o el agente lo enseña). |
| 4 · company_account_link_sin_dueno | **B + A** | El enlace no tiene clave ajena (va por `entity`, `entity_id` en texto): o se le añade una columna `supplier_id` con `on delete cascade`, o el borrado se apunta en la cola y Sumied quita el enlace y escribe su `company_account_log`. **Decisión de Julio**: la columna es más limpia; la cola, menos obra. |
| 5 · supplier_tax_rates_ok | **C** | Guarda de `supplier`. Se queda donde esté el dueño de `supplier` (paso 7). Si `supplier` es de Folvy, la guarda pasa a ser de Folvy (mismo código, en el producto de Folvy). |
| 6 · factura aprobada con pago | **A** | El disparador apunta «factura aprobada». Sumied la marca pagada al consumirlo. |
| 7 · iban_guard | **C** | Guarda de `supplier_invoice` (paso 7). |
| 8 · aprobacion | **C** | Guarda de `supplier_invoice` (paso 7). Es la que más pesa: decide quién puede aprobar. |
| 9 · no_repetida | **C** | Guarda de `supplier_invoice` (paso 7). |
| 10 · gestoria_config | **A**, o nada | `account_gestoria_config` es de Folvy (la gestoría laboral, no la contable). Si es así, **no es de Sumied**: se queda donde está y solo cambia de dueño en el papel. **Decisión de Julio**: ¿de quién es `account_gestoria_config`? |

## 3 · Cómo se ensaya cada uno por sus caminos (regla 10)

Cada cambio se ensaya **dentro de una transacción revertida, en staging**, por
los caminos que escriben en esa tabla. No vale medir que la función da lo
mismo: hay que **escribir como escribe Folvy** y ver qué pasa con la escritura.

| Tabla | Caminos que hay que ensayar (todos) |
|---|---|
| `goods_receipt` (1) | Recibir un albarán a mano en Cocina y confirmarlo; confirmarlo desde el papel (la IA de recepciones); anular uno confirmado con camino; y **confirmarlo con la función de Sumied rota a propósito** (para ver que la recepción entra igual y el evento queda pendiente). Después: el consumidor deja el mismo `goods_receipt_path` que hoy. |
| `supplier` (2–5) | Crear un proveedor desde Cocina; crearlo desde una factura (`conta_proveedor_desde_factura`); cambiarle nombre, NIF y archivarlo; fusionar dos (`supplier_merge_do` y su deshacer); borrar uno sin facturas; y poner un IVA habitual de otra cuenta (tiene que parar). Después: `party`, `party_role` y `company_account_link` quedan como hoy. |
| `supplier_invoice` (6–9) | Subir una factura (correo y a mano); aprobarla como encargado y como alguien sin permiso (tiene que parar); aprobar una con pago ya casado (tiene que quedar pagada); marcar pagada con IBAN distinto (tiene que parar); meter la misma dos veces (tiene que parar); y la marca «No es repetida». |
| `accounts` (10) | Alta de cuenta de Folvy (`create_account_tx` / `onboard_account`) y alta de cuenta solo de contabilidad (`conta_crear_cuenta_sola`). |

Y en todos, **la salud del pedido** de la comprobación de después: ninguno de
estos cuatro está en `CAMINO_TABLAS`, pero `goods_receipt` mueve stock
(`trg_goods_receipt_recompute_average`), y un albarán que no entra es stock que
no sube.

## 4 · El orden que propongo

1. **La cola** (`frontera_evento` y su consumidor), sola, que solo añade.
2. **1, 2 y 6** a la cola, de uno en uno, cada uno con su ensayo por caminos.
   Son los que de verdad son «Sumied dentro de Folvy».
3. **3 y 4** a clave ajena (o a la cola, según decida Julio en el 4).
4. **5, 7, 8 y 9**: no se tocan hasta el paso 7 (dueño único).
5. **10**: solo cambiar de dueño en el papel si `account_gestoria_config` es de Folvy.

Cada paso es «cambia en caliente» en tablas de Folvy, así que va con su prueba
de staging y su `autorizo` si el analizador lo pide.

## 5 · Lo que tiene que decidir Julio

1. ¿De quién son `tax_rate`, `expense_category` y `withholding_rate`? Decide si
   son 10 o 13.
2. El 4: ¿columna `supplier_id` con clave ajena en el enlace, o la cola?
3. El 10: ¿`account_gestoria_config` es de Folvy (laboral)? Si lo es, no se mueve.
4. ¿Vale un minuto de retraso en el camino de compras (1) y en el tercero del
   proveedor (2)? Si no, la cola se consume en la misma transacción y se pierde
   la mitad de la ventaja.
5. Las guardas (5, 7, 8, 9) esperan al paso 7. ¿De acuerdo en no tocarlas antes?
