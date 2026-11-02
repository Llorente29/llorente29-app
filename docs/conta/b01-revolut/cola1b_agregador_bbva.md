B01 · Cola 1b · **El agregador de BBVA no trae todos los movimientos.** Lo medido, en solo lectura, el 02/11/2026. Sin código en producción.

## Lo que pasó el 30/10, con los números de la base

En las dos cuentas falta lo mismo: **entró el cargo de la Seguridad Social y no el traspaso que lo cubría.**

| Cuenta | Lo que entró el 30/10 | Hueco del extracto | Lo que falta |
|---|---|---:|---|
| Cuenta principal ···6536 | −3.308,46 (Seguridad Social) | 3.308,46 | el traspaso de +3.308,46 |
| BBVA ···4525 | −483,36 y −315,00 (Seguridad Social) | 798,36 | un traspaso de +798,36 (= 483,36 + 315,00) |

**Cómo sale el hueco:**
- open-banking.io no da el saldo de cada día, da el de ahora.
- La lectura calcula el saldo final del periodo con ese saldo, y el inicial restándole los movimientos que trae.
- El saldo del banco ya incluía el traspaso (···6536: 75,55 €, igual antes y después del 30/10, porque entró y salió lo mismo), pero la lista de movimientos no lo traía.
- Así el saldo inicial calculado sale 3.308,46 € más alto que el cierre del 29/10: el **hueco** que enseña Bancos.

**Y no se ha arreglado solo:**
- las lecturas del 01/11 y del 02/11 (03:02) leyeron solo del 31/10 en adelante: «Sin movimientos nuevos del 2026-10-31 al 2026-11-01»;
- la lectura empieza siempre el día siguiente al último leído, así que **el 30/10 no se vuelve a pedir nunca**, aunque el banco lo tenga ya.

**La cuenta de origen:**
- Las tres cuentas conectadas son ···0133, ···4525 y ···6536.
- La ···0133 no puede ser el origen: tenía 470,91 € y su periodo del 29–30/10 cuadra («sigue»), sin ningún −3.308,46.
- Así que el origen de los dos traspasos es **una cuenta de BBVA que no está conectada a open-banking.io**, o una de estas en la que BBVA tampoco lo lista.
- **Pregunta para Julio:** ¿desde qué cuenta salieron? Si es una cuarta cuenta, ¿está en Sumied?

## Si es el filtro «solo lo contabilizado» o el proveedor

**Desde aquí no se puede saber, y por qué:**
- las credenciales de open-banking.io solo están en el secreto `OPEN_BANKING_IO_CREDENTIALS` de las funciones de Supabase, y no las pido (T11);
- la función de cada noche no apunta los pendientes que descarta;
- en la base solo entra lo contabilizado.

**Las tres explicaciones posibles, y lo que dice cada una:**

| | El traspaso, en open-banking.io | Lo arregla releer los últimos días |
|---|---|---|
| A · El filtro | Estaba en pendiente (PDNG) a las 03:02 del 31/10 y la lectura lo descartó. | Sí |
| B · Llegó tarde | BBVA lo contabilizó después con fecha del 30/10, que ya no se vuelve a leer. | Sí |
| C · El proveedor | open-banking.io (o BBVA por PSD2) no lo da, ni pendiente ni contabilizado. | No: hace falta el extracto |

**Para saberlo, un guion de solo lectura** que se lanza en el ordenador que tenga el `credentials.json` (el fichero no sale de ahí): `scripts/conta/banco/mirar-open-banking.mjs`.
- No llama a `sync` ni a `syncAll`: solo lee lo que open-banking.io ya tiene guardado.
- Pinta cada cuenta por sus 4 últimas cifras con sus saldos, y cada movimiento con:
  - las fechas contable, de valor y de operación;
  - el estado y el importe con signo;
  - el código del banco y el saldo que dejó (`balanceAfterTransaction`);
  - si el concepto dice «traspaso»;
  - si lo lee la noche y si sale con el filtro de fechas.
- Sin nombres, IBAN ni conceptos.
- Probado con un cliente simulado que imita el 30/10.

Para lanzarlo:

```bash
mkdir mirar && cd mirar && npm init -y && npm i @open-banking-io/client@1.3.0
```

```bash
node <ruta del repositorio>/scripts/conta/banco/mirar-open-banking.mjs <ruta>/credentials.json 2026-10-28 2026-11-02
```

**Cómo se lee el resultado:**
- traspaso con estado PDNG → **A**;
- BOOK, y la noche sí lo lee → **B**;
- no sale → **C**.

## Lo que tiene que pasar después (propuesta, sin construir)

1. **Releer los últimos días en cada lectura**, no solo desde el día siguiente al último:
   - Revolut ya lo hace con su último día (`releerUltimoDia`), mandando a la base solo lo que no tiene (`conocidos`, por el id del proveedor en `reference_2`);
   - BBVA haría lo mismo con una ventana de 7 días;
   - antes, comprobar que el id de open-banking.io no cambia entre dos lecturas: lo dirá el guion lanzado dos días seguidos.
   - Arregla A y B.
2. **Un hueco pide primero releer, y después el extracto:**
   - si un extracto del agregador sale con hueco, la lectura siguiente vuelve a pedir esos días;
   - si el hueco se cierra, lo dice; si después de dos lecturas sigue abierto, Bancos pide subir el extracto de esos días, como hoy.
3. **Un traspaso entre cuentas propias se casa solo:**
   - hoy se casa a mano, por los dos lados (el tipo «traspaso» de `bank_casar`);
   - la propuesta: con los dos lados en Sumied (misma empresa, mismo día o el siguiente, importe opuesto), se proponen juntos, y con el concepto «traspaso» se casan solos como traspaso;
   - si falta un lado (la cuenta de origen no está conectada), se queda en «Por aclarar» diciendo «Traspaso desde una cuenta que no está en Sumied».
4. **La lectura de cada noche apunta los pendientes que deja fuera** (cuántos y su importe) en su parte, para que la próxima vez no haga falta un guion.

## Apuntado y no hecho (T1)

- **Pregunta abierta:** de qué cuenta salieron los dos traspasos.
