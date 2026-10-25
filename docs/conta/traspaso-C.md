# C12 · Traspaso mensual a Diez: dónde se queda (frente C, 25/10)

> Cierre de la sesión del C12. Todo lo de abajo está **medido, solo leyendo**,
> el 25/10 entre las 05:45 y las 05:51 UTC. Lo que falta lo hacen Julio y el
> coordinador: esta sesión no empieza nada más.

## En una línea

El #322 está aplicado y fusionado, y su front está publicado. Foodint **sigue
enviando al validar**. Pasa a mensual con la tanda del #323, que está lista y
sin lanzar.

## Lo que está hecho

### #322 · el traspaso mensual (https://github.com/Llorente29/llorente29-app/pull/322)

| | Estado | Cómo se ha visto |
|---|---|---|
| Tanda (1250 añade, 1251 cambia `conta_diez_por_enviar`) | **Aplicada** | Las dos en `supabase_migrations.schema_migrations` |
| Fusión | **En `main`**, `1ae930c5` | `git log origin/main` |
| Front | **READY** en producción con `1ae930c5` (`dpl_3jUDNfCLqNWPTWva5s1deS4eekmq`), con `app.sumied.com` y `app.folvy.app` | Vercel, el despliegue de producción, no el commit |
| `conta-diez-traspaso` | Desplegada, versión 1, por el push (run 40166708654, 05:46–05:47 UTC) | md5 de lo desplegado contra `origin/main`: **13 de 13 ficheros iguales** |
| `conta-diez-enviar` | Desplegada por el mismo push, versión 19 | md5: **12 de 12 iguales**, `_shared/diezDespacho.ts` incluido |
| `conta-diez-cola` | Desplegada por el mismo push, versión 5 | md5: **11 de 11 iguales**, `_shared/diezDespacho.ts` incluido |

**Las dos que usan `_shared` ya salieron con el push.** Desde el W06 (#289),
`deploy-edge-functions` vuelve a desplegar cada función que importa algo
cambiado de `_shared`. Lo desplegado ya es `main` byte a byte. El despliegue a
mano que queda en la lista (abajo) no cambia nada, pero no hace daño: si se
lanza, después hay que volver a comparar el md5.

### #323 · Foodint a mensual (https://github.com/Llorente29/llorente29-app/pull/323)

- Rama `conta/c12b-foodint-mensual`, **commit `31e48a4d`**, con `main` traído:
  el diff ya son solo sus 8 ficheros.
- El analizador dice **AUTORIZO**. Nombre para el campo:
  `20261024T1631_c12b_foodint_mensual.sql`.
- Contexto medido tres veces en producción (24/10 16:32, 25/10 05:09 y 05:50
  UTC, esta última con el #322 aplicado y fusionado): **igual las tres veces**.
- `antes-de-subir.sh` en verde sobre `31e48a4d`.
- Ensayo de staging **en verde** (run 40166736071, sobre `e5bb3e90`). Para
  ello hubo que cambiar lo de staging, **no la tanda**:
  - el manifiesto de staging lleva solo la prueba: la 1631 sola paraba siempre
    en staging, que no tiene Foodint;
  - en el paso 1, la prueba quita la tanda del C12 dentro de su `savepoint`
    (con la vuelta atrás de la 1250), porque la sesión de staging ya la trae
    delante.
- `revisar` (pr-a-main) estaba en rojo porque el diff aún llevaba el #322
  dentro. Con `main` traído en `31e48a4d` tiene que pasar: **está por ver en
  ese commit**.
- La descripción dice el orden: **después de la fusión del #322 y de sus
  funciones**. La guarda de la 1631 solo mira la base.

## La cuenta, antes de la tanda del #323

`scripts/conta/produccion/cuentas/c12b-foodint-mensual.sql`, las siete líneas,
más dos de control. Medido a las 05:50 UTC, con la tanda del #322 aplicada:

| Línea | Valor |
|---|---|
| Foodint · empresas en modo mensual | 0 |
| `conta_diez_envio_empresa` · en mensual (tabla entera) | 0 |
| Foodint · envíos pendientes | 27 |
| Foodint · pendientes con reintento puesto | 26 |
| Foodint · en Diez (enviado o enlazado) | 215 |
| Foodint · cierres del día validados de octubre sin estar en Diez | **0** |
| Foodint · validados de octubre que van en el traspaso | 27 |
| *(control)* Foodint · empresas con Diez encendido y al validar (la 1631 espera 1) | 1 |
| *(control)* historial | `20261024T1250_c12_traspaso_mensual`, `20261024T1251_c12_por_enviar_modo` |

Los 27 pendientes **no son cierres**:
- 25 asientos de banco y 1 pago a proveedor, que la cola reintenta y nunca
  salen («Diez real está cerrado para asientos de banco, manuales y
  liquidaciones (C0008)»);
- 1 recibida sin IVA, que no se envía y no tiene reintento.

Con la 1631, los 26 se quedan sin reintento y viajan en el primer traspaso.

**Después del real de la 1631** tiene que salir:
- Foodint en mensual: **1**;
- pendientes con reintento: **0**;
- pendientes y en Diez: **los mismos que arriba** (27 y 215).

## Lo que falta, y quién

1. **Prueba de arranque de `conta-diez-traspaso` y `conta-diez-enviar`.** No
   se ha hecho: desde esta sesión no hay red hacia producción (el proxy rechaza
   `supabase.co`), y ninguna de las dos ha recibido todavía una llamada.
   - Un `GET` con la clave anon como `Authorization` contesta **405 «usa
     POST»** antes de hacer nada: eso prueba que el módulo arranca y no escribe.
   - `conta-diez-cola` lo probará la propia cola en su siguiente pasada. La
     última, a las 05:41, aún fue a la versión 4: hay que ver un `POST | 200`
     en la versión 5 en `function_edge_logs`.
2. *(Julio)* Si se quiere, el despliegue a mano de `conta-diez-enviar` y
   `conta-diez-cola`: `deploy-edge-functions`, «Run workflow» desde `main`,
   **`funciones`** = `conta-diez-enviar conta-diez-cola`, **`la_prohibida`**
   vacío. Después, el md5 de lo desplegado contra `main` otra vez.
3. *(Julio)* La tanda del #323 desde su rama (`31e48a4d`): el ensayo y después
   el real, con `autorizo` = `20261024T1631_c12b_foodint_mensual.sql`.
   Después, la cuenta de arriba, y la fusión.
4. *(Julio)* Antes del primer traspaso real, cargar en la **C0008** las dos
   configuraciones definitivas:
   - `docs/conta/c12/prueba-excel/ConfiguracionExpedidas-c12.XML`;
   - `docs/conta/c12/prueba-excel/ConfiguracionRecibidas-c12.XML`, con PRO y
     ALQ.

   Que use sus propios ficheros exportados: git guarda los del repositorio con
   otros finales de línea.
5. *(Julio no valida cierres)* Desde la fusión del #321 hasta que Foodint esté
   en mensual: lo acordado.

## El siguiente encargo (decidido, sin construir)

En `docs/conta/c12/traspaso-completo.md`:
- Emitidas y recibidas **por Excel**, sin fila de títulos, con su PDF por
  «Url documento» y el número de Sumied. Después, «Ya lo he importado» y la
  lectura de vuelta.
- **Antes de generar**, todas las subcuentas comprobadas en Diez por la API. Si
  falta alguna o Diez no contesta, no se genera nada; se ofrece crear las que
  falten con la confirmación de Julio.
- Retenciones: profesionales a la 47510015 (PRO) y alquileres a la 47510019
  (ALQ).
- El PDF, con el enlace permanente con llave por documento (`conta-pdf/<llave>`).
- Banco, asientos a mano y liquidaciones por la API (`apuntes/add`), sin PDF.

Los generadores de prueba (`scripts/conta/diez/c12-excel-*.mjs`) ya hacen las
comprobaciones del asiento que tendrá el de verdad, con su prueba unitaria
(`tests/unit/scripts/c12ExcelRecibidas.test.ts`).
