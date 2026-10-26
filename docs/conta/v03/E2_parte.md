# V03 · E2 · Las pantallas de Verifactu y las ventas sin IVA

*26/10 · rama `conta/v03-e2`.*

## Lo que está hecho

### Las ventas sin IVA (respuesta 2 de Julio, a)

La 0146 **cambia en caliente** cuatro funciones, con la misma firma y sin tocar
datos:

- **`conta_venta_guardar`** admite «Exento o 0 %» (en pantalla, «Sin IVA») y
  guarda el porqué con el borrador.
- **`conta_venta_emitir`**
  - Pide el porqué antes de dar número, con Verifactu encendido o apagado. Las
    frases son las de la comprobación de Verifactu: «Es un cliente de CH, fuera
    de la UE: dime qué le has vendido…».
  - La rectificativa hereda el porqué de la factura que corrige.
  - La 70x se parte en dos: la parte sin IVA lleva su tipo, su base y su libro,
    y ya no sale ninguna 477 a cero.
- **`conta_motivos_para_validar`** (regla 5): un apunte exento es su base, al
  céntimo. Hasta hoy rechazaba cualquier apunte exento, porque con el 0 % pedía
  cuota 0 y un apunte nunca vale 0.
- **`conta_vat_book_desde_asiento`**: escribe cuota 0 y la calificación o la
  exención de la factura, que el 303 ya sabía leer:
  - E2, con clave 02 → casilla 60;
  - N2 → casilla 120;
  - E5 → casilla 59;
  - E1 → no va en ninguna casilla.

En producción no hay **ni un** apunte exento ni no sujeto, en ninguna cuenta
(medido el 26/10). Nada de lo que existe cambia.

En el borrador, una línea sin IVA pregunta **qué le has vendido**, según dónde
está el cliente (tablero 27):

| Dónde está el cliente | Qué se ofrece |
|---|---|
| Fuera de la UE | un servicio a una empresa (N2), mercancía que sale (E2) u otra cosa (E1, art. 20) |
| En la UE | servicio (N2), entrega intracomunitaria (E5) o art. 20 (E1) |
| En España | solo el art. 20 (E1) |

El PDF lleva la frase con su artículo (RD 1619/2012, art. 6.1.j).

### «Corregir y reenviar» (0218, solo añade)

`verifactu_reenviar` subsana el alta rechazada con un registro nuevo y lo pone a
la cola, encadenado tras el último:

- **`Subsanacion = S` y `RechazoPrevio = S`.** Así lo dice el XSD
  (`RechazoPrevioType`: la X es para un registro que nunca se envió) y lo exige
  el error 1161.
- **El porqué de la venta sin IVA, si viene.** Cambia la factura y su libro,
  pero solo con el mes abierto. Con el mes cerrado lo dice y no lo toca: se
  corrige con una rectificativa.

### «¿Facturas también con otro programa?» (0226, solo añade)

Una columna que admite nulos en `verifactu_empresa` (hoy tiene 0 filas) y la
función que la escribe.

### Las pantallas

- **Tablero 25 · Ajustes › Facturación › Verifactu.** Los tres pasos:
  1. Tus datos y desde cuándo te obliga: sociedad, 1 de enero de 2027; autónomo, 1 de julio.
  2. Cómo se envían a Hacienda:
     - vía de **colaborador social**: se ve, y dice que **todavía no está
       abierta**, con sus botones apagados;
     - vía del **certificado**: se autoriza escribiendo AUTORIZO y se puede
       retirar.
  3. Pruebas y paso a real escribiendo EMPEZAR, con la serie nueva.

  El candado de la base se dice **antes** de pulsar. Además: «¿Facturas también
  con otro programa?», con su aviso (Excel no cumple), y el sitio de «Ver la
  declaración responsable».
- **Tablero 26 · Facturas:**
  - la banda morada fija mientras se está en pruebas;
  - las cuatro cifras con Hacienda;
  - el aviso de la rechazada con «Arreglarla»;
  - la columna «Hacienda»: Recibida, Enviando…, Rechazada, Recibida con un
    aviso o No se envía;
  - «Enviando…» dice por qué tarda: que Hacienda pide esperar, o que no hay
    conexión y se reenvía sola;
  - el pie sobre las facturas de antes de 2027.
- **Tablero 27 · La factura rechazada:**
  - qué falta, en palabras de la calle;
  - si es el porqué de la venta, «¿Qué le has vendido?» ahí mismo;
  - «Corregir y reenviar»;
  - «Lo que dijo Hacienda», plegado;
  - «Cómo va con Hacienda», con la hora de cada paso.

## Lo probado

- **Staging, en ROLLBACK** (`supabase/staging/sql/20261026_v03_ventas_sin_iva_prueba.sql`),
  [run 584](https://github.com/Llorente29/llorente29-app/actions/runs/40263364430) en verde. Sus líneas, tal cual:

  ```
  0 · las cuatro, con el md5 de producción
  0 · antes, guardar rechaza la línea exenta: «La línea 1: «Exento o 0 %» aún no se puede facturar aquí (solo IVA general, reducido o superreducido).»
  1 · sin el porqué no se emite: «Es un cliente de CH, fuera de la UE: dime qué le has vendido (un servicio a una empresa o mercancía que sale de España).»
  1 · F-2026/000001 emitida: 430 2.271, 705 2.150 sin IVA (con su tipo, base y libro), 705 100, 477 21; validado
  3 · exportación a España no: «Una exportación es una venta a fuera de la UE: este cliente es de España.»
  libro · N2 2.150 cuota 0 → 120; S1 100 → 07/09; E2 450 clave 02 → 60; E1 300 sin casilla; la rectificativa R4, en negativo con cuota 0
  5 · No se valida: apunte 2 (70500000): un apunte sin IVA es su base: el importe 100.00 no es la base 90.00.
  6 · en pruebas: alta F-2026/000004 con el desglose N2 sin tipo ni cuota, 2.150,00 y el cliente como IDOtro 04
  8 · reenviada F-2026/000004: subsanación S con RechazoPrevio S, encadenada tras la rechazada, E2 con clave 02; otra vez no: «La F-2026/000004 no está rechazada por Hacienda (está esperando a enviarse): no hay nada que reenviar.»
  8 · su libro: E2 con clave 02
  9 · otros programas: excel y tpv, sin repetir; «fax» no: «Los otros programas son: tpv, tienda, excel u otro.»
  7 · la vuelta atrás: las cuatro, con el md5 del principio y sin sobrecargas
  ```

  En el mismo run, la 0218 y la 0226 (solo añaden) entraron **de verdad** en staging
  (W05); la 0146 no (cambia en caliente: solo en ROLLBACK hasta la tanda).
- **Unitarias** (`tests/unit/modules/conta/v03/ventasSinIva.test.ts` y `estado.test.ts`):
  - la UE se lee de la base, de `_verifactu_es_ue`;
  - cada código de rechazo se ata a su texto en la lista oficial;
  - el asiento previo sale como en staging;
  - la frase del PDF lleva su artículo.
- **e2e** (`tests/e2e/conta/v03/verifactu.spec.ts`), en ordenador y móvil, con la
  cuenta D (Asesoría de Prueba Oeste, **no** de hostelería). La entera de Sumied
  (toca lo común: los tokens del morado) sobre `8cfd66a5`,
  [run 40268812432](https://github.com/Llorente29/llorente29-app/actions/runs/40268812432):
  503 en verde y 6 en rojo, las 6 de Bancos (`b01`), con `bank_casar: DELETE
  requires a WHERE clause`. No es de esta rama (no toca Bancos, y `bank_casar` es
  idéntica en staging y en producción); en la noche de `main` del 25/10 pasaron.
  La V03:
  - el alta (tablero 25) y la rechazada (26 y 27), en verde en los dos tamaños:
    4 pruebas, 18,9 s (ya en `tests/e2e/tiempos.json`);
  - «sin IVA a Suiza, emitiendo de verdad» se salta y lo dice: staging aún no
    tiene la 0146.
- **Capturas**: en el artefacto «capturas» del run (tablero-25, tablero-25-otros-programas,
  tablero-26, tablero-27 y sin-iva-*, en `docs/conta/capturas/v03`). Desde esta
  sesión no se pueden bajar al repositorio: la red del entorno no llega al
  almacén de artefactos de GitHub.

## Lo que queda abierto

- **La e2e no emite todavía una venta sin IVA.** Staging solo ensaya la 0146 en
  ROLLBACK hasta que se aplique en producción y se fusione. Hasta entonces, esa
  parte de la e2e lo dice y se salta; la prueba de staging la cubre entera. Pasó
  lo mismo con la 0836 en la V01.
- **La rechazada de la e2e está simulada en el navegador.** Staging no habla con
  la AEAT (falta el certificado de pruebas). Lo que escribe la base al reenviar
  lo prueba la sección 8 de la prueba de staging.
- **Pendiente de confirmar con la AEAT de pruebas:** que acepta la subsanación
  con `RechazoPrevio = S`.
- **«Me he equivocado en…»** (rectificar, anular o subsanar) es de la E3.
- **Julio:**
  - el texto de la declaración responsable;
  - el alta de Sumied como colaborador social (hasta entonces, esa vía sale
    cerrada);
  - el certificado de pruebas, para la sonda y las 25.
- **El asesor:** que el 303 aún no reparte las rectificativas emitidas
  (`rectificativa_expedida`; ya pasaba antes y no lo cambia esta entrega). Y qué
  hacer con el 0 % de los alimentos de 2023–2024: hoy es el mismo tipo «Exento o
  0 %» y aquí pediría un porqué que no tiene. En 2026 no se factura ninguno.
