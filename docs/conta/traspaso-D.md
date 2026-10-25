# Traspaso de D · V01 Ventas (25/10)

Lo que deja la sesión D, que cierra aquí, para quien coordina. Escrito el 25/10
hacia las 06:10 UTC.

## Los dos PR: listos

| | #324 · El histórico | #325 · Entrega 3, Liquidaciones |
|---|---|---|
| Rama | `claude/v01-historico` | `claude/v01-liquidaciones` |
| Último commit | `4127c93d` (`main` con el #322 traído) | el de este fichero, encima de `3e9a7314` (`main` con el #322 traído) |
| Tanda | `supabase/produccion/tandas/sumied/claude-v01-historico/` | `supabase/produccion/tandas/sumied/claude-v01-liquidaciones/` |
| Autorizo | `20261024T1730_v01_historico_facturas.sql` | `20261024T2031_v01_tiendas_local.sql` (la 1650 solo añade: sigue) |
| Funciones a desplegar a mano | ninguna | ninguna |
| Prueba de staging (ROLLBACK) | en verde (run 40108404871) | en verde (run 40131578779) |
| E2E | la de su zona más `v01`, en verde (run 40165033246, `ccad3050`) | la entera, en verde (run 40142597258, `1d60998f`; el código es el mismo desde entonces) |
| `antes-de-subir.sh` | en verde sobre `4127c93d` | en verde sobre `3e9a7314` |

**Traer `main` con el #322 (C12).**
- **#324:** entró sin conflictos.
- **#325:** chocó en `tests/unit/e2e/trozos.test.ts`, porque las dos ramas añadían una e2e sin medir y salían 10, cuando el límite es menos de 10. Se resolvió **midiendo**, no subiendo el límite: `v01/facturas`, `v01/cierres` y `v01/liquidaciones` entran en `tests/e2e/tiempos.json` con los tiempos de la entera 40142597258. Quedan 7 sin medir.
- **Lo que trae el C12:** no crea ni cambia nada que toquen estas dos tandas. Solo lee `journal_entry`, `external_send` y las liquidaciones.

## Orden de las tandas (Julio, 25/10)

Cada tanda se ensaya y se aplica **desde su rama**, y después se fusiona su PR.

1. **#322** (C12, el traspaso mensual) y su fusión, con sus funciones desplegadas. *Fusionado.*
2. **#323** y su fusión.
3. **Tanda del #324**, desde `claude/v01-historico`, y su fusión.
4. **Tanda del #325**, desde `claude/v01-liquidaciones`, y su fusión.

**Antes del 3 y del 4.** Si al llegar ahí `main` trae algo más que estas ramas no tienen (el #323), hay que traer `main` a las dos y volver a medir su contexto en producción, solo lectura, como el 25/10 a las 05:10. El workflow de producción vuelve a medir el contexto real antes del ensayo.

## Qué comprobar después de cada fusión (con cifras)

- **Siempre:** Vercel en READY en producción, sobre el commit fusionado.
- **#324, recuento de su tanda** (`scripts/conta/produccion/cuentas/v01-historico.sql`):

  | | Medido el 25/10 | Después de la tanda |
  |---|---|---|
  | Asientos | 15.217 | igual |
  | Anotaciones de expedidas | 1.331 | igual |
  | Total de expedidas | 492.114,30 € | igual |
  | Expedidas con número | 1.234 | +85 |
  | Facturas de venta | 0 | 1.281 |
  | Cierres validados sin factura y en Diez | 85 | 0 |
  | Traídos sin NIF y sin factura | 1.196 | 0 |

  Además, en Ventas › Facturas tiene que salir «Hacer los PDF que faltan», para los 1.196 traídos. La 1730 no crea asientos ni envía nada a Diez, así que el traspaso mensual no los vuelve a coger.
- **#325, recuento de su tanda** (`scripts/conta/produccion/cuentas/v01-liquidaciones.sql`):

  | | Medido el 25/10 | Después de la tanda |
  |---|---|---|
  | Tiendas de plataforma | 9 | 9 |
  | Tiendas sin local | 9 | 0 |
  | Por local | — | Foodint Alcalá: 7 · Foodint Carabanchel: 2 |
  | Copia previa (`conta_tienda_local_antes`) | — | 9 |
  | Diferencias resueltas | — (sin tabla) | 0 |
  | Asientos, liquidaciones y descartes | — | iguales |

## Lo pendiente de Uber (va en la sesión nueva)

**Lo medido** (producción, solo lectura, 24/10):
- **Buzón:** el de liquidaciones (`liquidaciones-foodint@entrada.folvy.app`) solo recibe desde el 16/10.
  - El 16/10, Julio reenvió a mano 7 resúmenes antiguos.
  - Desde el 18/10 llegan solos los de `noreply@uber.com`.
- **Hueco:** del 6/07 al 18/10 hay 157 semanas-tienda con ventas de marcas propias. Solo 18 tienen liquidación: faltan unas 139, con unos 1.090 pedidos y unos 24.650 € de ventas.
- **Tiendas propias que no llegan** ni con el reenvío puesto: Lovers Burgers, Dirty Burger y Bendito Burrito Carabanchel. Su resumen va a otro correo.
- **Marcas cedidas:** Uber se las paga a CTB, no a este buzón.

**Lo que trajo Julio** (24/10; los ficheros no están en el repositorio, porque es público):
- **El informe «Detalles del pago»**, del 1/07 al 18/10, en dos exportaciones iguales y un trozo de 9 tiendas.
  - Agrupado por tienda y fecha de pago, salen **144 liquidaciones**.
  - Reproduce al céntimo las 15 que entraron por correo (Bendito 110,00 y 66,78; Meraki 782,16; Milanesa House 216,92…), así que se puede meter sin duplicar: **unas 129 nuevas**, y 7 grupos todavía sin fecha de pago.
- **Un resumen de pagos de 9 tiendas:** 91 pagos, 11.628,09 €.
- **La exportación de facturas de comisión:** solo 3 facturas, de las semanas que acaban el 4, el 11 y el 18/10, de toda la cuenta y no por tienda. Faltan las de julio a septiembre.

**Lo que hace falta de Julio** antes de empezar:
1. **De qué local es cada tienda dudosa.** El informe no trae dirección:
   - «Bendito Burrito (C/ COSTA VERDE, 17)»;
   - «Meraki Pita (C/ COSTA VERDE, 7)»;
   - «Mila´s Sandwiches (C/ COSTA VERDE, 7)»;
   - «Smash Brothers Burgers - Costa Verde»;
   - la segunda «Milanesa House» (UUID 98bdd032…);
   - «Lovers Burger», «Dirty Burgers», «NKD Burger.» y «Smash Brothers Burgers.».

   Costa Verde no es la dirección de ningún local de Foodint.
2. **Un ejemplo del correo semanal de los lunes y otro de la factura semanal**, reenviados o en .eml, para saber si traen el CSV adjunto o un enlace.

**Propuesta de diseño:**
- Un botón «Traer de Uber» en Ventas › Liquidaciones, donde Julio sube el CSV y las facturas. Los datos reales no van en una migración.
- La tienda se reconoce por su UUID de Uber, y el local sale de su dirección (la 2031) o de la tienda que ya llegó por correo.
- Sin duplicar: por tienda, fecha de pago y lo que pagan.
- Estimación: 6–8 h, en su propia rama y PR.

**Reenvío que tiene que crear Julio en Gmail:** remitente `noreply@uber.com` → `liquidaciones-foodint@entrada.folvy.app`. Si ya existe, sobra. Lo que falta es reenviar también desde el correo al que Uber manda los resúmenes de Lovers, Dirty y Bendito Carabanchel, o cambiar ese destinatario en Uber Eats Manager.

## Otras cosas apuntadas (fuera de estos PR)

- **El 303 no declara rectificativas emitidas:** sale como error en cuanto hay una. Va para un encargo de impuestos.
- **La «Relación Compras y Ventas» de CTB de octubre** no está aún en producción. El cruce producto a producto se verá con datos reales cuando se suba.
