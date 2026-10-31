B01 Revolut · PR 1 · **Conectar Revolut Business y leer sus movimientos.** Los movimientos de Revolut entran en Sumied como los de cualquier banco: misma tabla, misma conciliación, mismas reglas, por `bank_importar`. Lo terminado entra en cuanto llega (respuesta 3). Pagar va en el PR 2.

## Qué hace

- **Bancos › Cuentas y extractos**: la tarjeta de Revolut Business, con su estado («Al día · hace 5 min», «A medias: falta autorizar», «Desconectada desde Revolut») y sus botones: Conectar, Seguir, Cuentas y Desconectar.
- **El asistente** (maquetas v2, aprobadas el 31/10), en la misma ventana y con su progreso:
  1. copia el certificado y elige desde cuándo traer los movimientos;
  2. pégalo en Revolut › Ajustes › API con la dirección de vuelta, y trae el Client ID. Si se pega el certificado por error, lo dice;
  3. autoriza en Revolut, **solo para leer** (P4).
  Después se liga cada cuenta en euros a su 572: `bank_cuenta_nueva` le crea la siguiente, que en Foodint será la **57200004**. Al final, «Traer los movimientos».
- **La llave**: Sumied crea el par RSA 2048 y el certificado X.509. La privada, el Client ID y el token de renovación van al **Vault**, por empresa; solo los lee la clave de servicio. A la pantalla solo sale el certificado público.
- **La lectura**: Revolut es un proveedor más del agregador (`ProveedorAgregador`):
  - una entrada por pata, solo lo terminado, con la fecha de `completed_at` en hora de Madrid;
  - las devoluciones entran como movimiento contrario y la comisión como movimiento aparte;
  - el id de Revolut va en `reference_2`, dentro de la huella dura: leer dos veces no duplica;
  - se lee hasta **hoy**, se vuelve a leer el último día y solo se manda lo nuevo, buscándolo por su id;
  - el saldo al cerrar es el `balance` de la pata del último movimiento terminado, no el saldo de la cuenta, así que un pago pendiente no da un falso descuadre.
- **Al día**: el aviso de Revolut (`conta-revolut-aviso`) no se cree lo que trae: solo adelanta una lectura, con freno de 30 s. De respaldo, la lectura de cada hora (`conta-revolut-despertar` → `conta-revolut-leer`).
- **Desconectar**: desde Sumied, o desde Revolut. Si Revolut ya no acepta el permiso, la conexión pasa a «retirada». Lo que ya entró se queda.
- **Cuentas en otra divisa**: se ven, pero no se traen todavía (P2).
- **La demo** (DM1): las tres funciones pasan por `cuentaPuedeSalir`. `tests/unit/demo/puerta.test.ts` las detecta solas como funciones que salen fuera, con la puerta puesta.
- **Staging solo habla con el sandbox**: el entorno sale de `REVOLUT_ENTORNO`, y solo `produccion`, escrito así, es producción.

## Lo comprobado contra la especificación oficial

`revolut-engineering/revolut-openapi`, `business.json`, del 30/10/2026: las direcciones, los cuatro permisos, `/accounts`, `/bank-details`, `/transactions` (1.000 por página), los estados, `legs[].balance` y `fee`, los avisos v2 en `/api/2.0/webhooks` con sus eventos, la validación del titular (VoP) y que no hay pago en lote por API. Lo que solo está en las guías se confirma con la primera llamada al sandbox y se pega aquí: el token y su renovación, cuánto dura el token de renovación, la firma del aviso y que el `balance` de la pata cuadra.

## Decisiones abiertas

- **El aviso pide el permiso `WRITE`** (especificación oficial). Con solo `READ` no se registra, y la lectura de cada hora hace de aviso: hasta una hora de retraso. El código lo registra en cuanto haya `WRITE`. Falta que Julio decida si se pide al conectar o con «Activar pagos».
- **La dirección de vuelta** es una página aparte, `revolut-vuelta.html`, en `/bancos/revolut/vuelta` por la primera regla de `vercel.json`. Solo devuelve a la página de Bancos desde la que se salió, nunca a otro sitio. Así no se toca `App.tsx`.

- **En staging, la 2210 no va de verdad desde la rama.** El clasificador de «solo añade» (`staging-tanda.mjs`) ve `vault.create_secret` en el cuerpo de `conta_revolut_secreto_poner` y lo cuenta como escritura en el Vault, aunque no se ejecuta al aplicar. Run 808: «Nada de la rama va de verdad». Afinarlo es tocar la herramienta común: va a otro encargo (T1). Mientras la tabla no esté, la tarjeta dice «Revolut aún no está en este entorno» en vez de dar error, y la e2e del asistente va después de fusionar.

## Tanda

`supabase/produccion/tandas/sumied/claude-revolut-business-sumied-9fhlsh/`. El analizador dice **sigue** para los tres ficheros, sin `autorizo`:

- **2210, añade**: `revolut_conexion`, los secretos en el Vault, `conta_revolut_desconectar` y el despertador, con `project_url` del Vault (W10).
- **2211, cambia**: el CHECK del proveedor de `bank_aggregator_link` admite `revolut`. Solo amplía.
- **2212, cambia**: `bank_importar`, con la misma firma, respaldo y guarda de md5 `09859e42` (la de la B02, igual en producción y en staging). Solo para la fuente `agregador:revolut`, la continuidad se mide también contra la lectura del mismo día. Para BBVA y los ficheros, lo de antes.

Contexto medido en producción en solo lectura el 31/10. La vuelta atrás, en orden inverso. Lo que cuenta: `scripts/conta/produccion/cuentas/b01rv-revolut.sql`. El real lo lanza Julio.

## Pruebas

- **Unitarias** (`tests/unit/modules/conta/revolut/`):
  - sin duplicados en una segunda lectura;
  - **un movimiento de hoy entra hoy, y leerlo otra vez no lo duplica**;
  - un pago pendiente no da un falso descuadre;
  - patas, fechas de Madrid, devoluciones y comisión;
  - el certificado se lee como X.509 y la firma RS256 se verifica;
  - el camino entero de una lectura con un Revolut simulado, y el permiso retirado;
  - ningún secreto ni IBAN entero en un registro;
  - los textos de la tarjeta.
- **La puerta**: `tests/unit/demo/puerta.test.ts` ve las tres funciones con su puerta.
- **Staging**, `supabase/staging/sql/20261031_b01rv_revolut_prueba.sql`, en ROLLBACK:
  - la conexión y quién la ve;
  - el Vault;
  - sin duplicados en la base de verdad;
  - dos lecturas de Revolut el mismo día «sigue», y un fichero del mismo día como antes;
  - desconectar;
  - las tres vueltas atrás.
  Pasada en la base local del W09. Sin la 2212, sale en rojo.
- **`npm run build`** en limpio y **`antes-de-subir.sh`**: todo en verde salvo `tests/conta/capturas.test.ts`, que falla igual en `origin/main`. La carpeta `s01h` de las capturas del #412 no está en su lista; queda apuntado para otro encargo (T1).
- **e2e contra el sandbox**: con la cuenta de pruebas de Julio (P9, sus pasos van aparte), en un push siguiente.

## Funciones a desplegar a mano

### Sumied

- conta-banco-agregador
- conta-revolut-aviso
- conta-revolut-conectar
- conta-revolut-leer

### Folvy

- ninguna

## Producto

- Sumied
- Común
