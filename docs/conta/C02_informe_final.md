# C02 · Plan contable — informe final (05/10/2026)

Todo está en la rama `conta/c02-plan-contable` (PR #147) y aplicado en
**staging-conta**. En **producción no hay nada**: las tandas de abajo las lanza
Julio. El PR no se fusiona sin «fusiona».

## Lo hecho, tarea a tarea

| Tarea | Qué | Dónde se comprueba |
|---|---|---|
| 1 | Comprobaciones previas; decisiones D1–D7 | `C02_comprobaciones_previas.md` |
| 2 | La serie del BOE en `pgc_account`: pymes 772 códigos / 615 hojas, general 898 / 714; 19 correcciones citadas, 22 aceptadas; agente «Plan contable» cada noche | `plan.mjs comprobar` en `antes-de-subir.sh`; agente en el nocturno |
| 3 | El plan de cada empresa: activar, subcuentas, enlaces, longitud 6–12, renumerar, numeración agotada, cambio de plan, fusionar duplicadas, cerrar, palabras clave; 400 o 410 por lo que vende el proveedor | 32 pruebas del núcleo; prueba de staging de 0120–0150 |
| 4 | Ajustes como índice (N6), pantalla del plan (N5), «Qué va a cada sitio», móvil | e2e `c02/plan.spec.ts`; `capturas/c02/COMPARACION.md` |
| 5 | Propuestas de la IA con porqué, confianza y dos respuestas; las de confianza baja, a «Para revisar»; registro | 11 pruebas del núcleo; prueba de staging de la 0180; e2e `c02/propuestas.spec.ts` |
| 6 | Ficha de proveedor › Contabilidad (N7): sus cuentas, los datos que aplican a la empresa, «Va al 347», extracto en dos vistas; Tablas con las 472/477 reales; `supplier.ledger_account_code` fuera | 16 pruebas del núcleo; e2e `c02/ficha.spec.ts`; prueba de staging de 0160 y 0170 |
| 7 | e2e y RLS, contraste, este informe | e2e `c02/rls.spec.ts`; `contraste.md` |

## Migraciones (todas con vuelta atrás probada en staging)

| Fichero | Qué | Tanda en producción |
|---|---|---|
| `20261007T0100_c02_pgc_account` | La tabla de la serie | 1 |
| `20261007T0110_c02_pgc_serie` | La serie (generada por `plan.mjs`) | 1 |
| `20261007T0115_c02_pgc_definicion` | La reserva de «qué se apunta aquí»: la primera frase de la definición de cada código en la quinta parte del BOE (generada por `plan.mjs`; pymes 450, general 492). `plain_name` no se toca | 1 |
| `20261007T0120_c02_plan_empresa` | `company_account`, `company_account_link`, `company_account_log` y sus funciones; dígitos 6–12 | 1 |
| `20261007T0130_c02_proveedor_400_410` | La marca 400/410 en `expense_category` | 1 |
| `20261007T0140_c02_duplicadas_cerrar_palabras` | Fusionar, cerrar, palabras clave | 1 |
| `20261007T0150_c02_deshacer_cambio_plan` | Deshacer una subcuenta, cambio de plan, guarda del perfil | 1 |
| `20261007T0160_c02_cuentas_del_proveedor` | Papeles del proveedor: gasto, pago, suplidos | 1 |
| `20261007T0180_c02_propuestas_plan` | Contestar las propuestas; el IVA nombrado por su tipo | 1 |
| `20261007T0185_c02_lectura` | SELECT a `conta_lectura` (si existe) sobre las cuatro tablas del plan: los agentes leen desde el primer día | 1 |
| `20261007T0187_c02_enlaces_sin_dueno` | Al borrar un proveedor, banco, tipo de gasto, tipo de IVA o retención, sus enlaces del plan se quitan (con registro); limpia los huérfanos | 1 |
| `20261007T0189_c02_renombrar_subcuenta` | «Cambiar nombre» de una subcuenta tuya desde su Mayor (las de serie y las cerradas, no), con registro | 1 |
| `20261007T0170_c02_elimina` | **Borra** `supplier.ledger_account_code` (copia antes) | **2, con `autorizo`**, después de que el front que ya no la lee esté en producción (Vercel READY) |

Medido en producción, en solo lectura, el 05/10:
- Existen las tablas del C00 y C01b de las que dependen (`ai_suggestion`, `company_tax_profile`, `expense_category`, `treasury_account`, `fiscal_year`).
- No existe ninguna del C02.
- Hay un perfil fiscal, con 8 dígitos: el nuevo mínimo de 6 no le afecta.
- `supplier.ledger_account_code`: 0 de 42 proveedores la tienen rellena (tabla entera). Ninguna función, vista ni cron la nombra, y ninguna de las 69 edge functions desplegadas. De esas, 6 se buscaron con `grep` y 63 se revisaron leyendo, sin script.

Ninguna toca el camino del pedido: son tablas y funciones de contabilidad. Aun así, la tanda 1 cambia el CHECK de `company_tax_profile` (cierre exclusivo de una tabla que el pedido no lee). La ventana la decide Julio, como siempre.

## Lo que se encontró por el camino y se arregló

- **Al comparar las capturas con las maquetas:**
  - la columna CUENTA era estrecha y el buscador cortaba su texto;
  - el índice decía «Nada todavía» con historial debajo;
  - la ficha salía con el esqueleto y con «21 % 21 %»;
  - las tarjetas de N7 iban a 640 px;
  - el porqué de una propuesta iba en plural con un solo proveedor.
- **Probando el núcleo con datos reales (regla 31):**
  - el porqué de «Material de oficina» decía «en el título» cuando coincidía en «qué se apunta aquí»;
  - la subcuenta de un IVA del 7,5 % se habría llamado «IVA soportado 75 %». Arreglado también en la función de la base. Hoy no hay ningún nombre mal: todos los tipos vigentes son enteros.
- **La e2e de Socios** contaba antes de que cargara la tarjeta.

## Pendiente, fuera del C02

- **Textos de hostelería en «qué se apunta aquí» (C02b).** Ahora toda cuenta de apunte sin texto propio ni heredado enseña la definición del BOE con «(PGC)». Los textos de las cuentas que usa un restaurante (grupos 4 a 7) llegan como fichero de datos con cita, en un encargo corto, y sustituyen la reserva sin migración. En el plan general, los grupos 8 y 9 (42 cuentas) siguen solo con el título: el BOE solo da su movimiento.

- **«Por hacer» no tiene pantalla todavía.** La bandeja de propuestas de confianza baja vive en la pantalla del plan («Para revisar») hasta que exista.
- **Llegan con el C04 (factura recibida):**
  - los apuntes del extracto y del saldo;
  - la propuesta «sin uso en 12 meses», que sin apuntes no se dispara nunca;
  - la detección de «primera factura con ISP».
- **«Le pagas desde» con la 430 del cliente** (compensar): el modelo lo admite; el desplegable solo enseña bancos hasta el C03.
- **Importar un plan desde otro programa** (Foodint vendrá de Diez).
- **`orden-modelo-115`** da 404 en la descarga de fuentes; ya pasaba en `main`.
- **El contraste con Diez** en «formato de cuentas», «cambio de subcuentas» y «renumerar» espera a esas capturas.
