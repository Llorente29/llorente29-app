# F6 · Consecuencia esperada del release C9 L1 §5.2 + §5.3

**Escrito ANTES de desplegar**, 04/09/2026 16:40 Madrid.
Commits: `28b6e16d` (§5.2) y `a7a8729a` (§5.3), en `claude/schema-migrations-repo-40d7u8`.

> **Corrección, 05/09/2026.** Este documento citaba `8d49424f` y `2a28fb80`.
> **Ninguno de los dos existe** en el repositorio — comprobado con `git cat-file`.
> Los SHA buenos son los de arriba. Se corrigen al bajar el documento a `main`,
> porque un F6 que apunta a commits inexistentes no sirve para rastrear nada,
> que es justo para lo que existe. Lo único que cambia son esos dos SHA: el
> resto del documento es el que se escribió el 04/09 antes de desplegar, y
> **L1 sigue sin publicarse.**

## Por qué no ha salido ya

**Son las 16:40 y la banda prohibida es 12:15 → 23:45.** Alcalá lleva 25 pedidos en
tres horas y el último hace dos minutos: servicio pleno. Un push a `main` que toque
`src/` dispara `build-apk.yml` y publica el bundle; las tres estaciones están en
`safe: true`, así que se lo tragarían en mitad del pase.

**Se suelta después de las 23:45**, con un push a `main` de estos dos commits. No hay
nada más que hacer: ni migración, ni edge function, ni Vercel.

## Qué sale

Sólo la app de la tablet (OTA). Dos ficheros: `ticketRenderer.ts` y `escpos.ts`.

## Qué cambia el día siguiente, en el pase

1. **Cada bebida lleva su pegatina.** Antes iban colapsadas en una sola de bolsa.
   Sobre un pedido real de 8 unidades (3 comida + 5 bebida, con un combo dentro),
   las pegatinas pasan de 4 a **9**.
   **Esto cuesta papel y hay que mirarlo el primer día:** un pedido con muchas latas
   ahora imprime muchas más pegatinas. Si el consumo se dispara, la salida es quitar
   la pegatina de bolsa (un bloque y un `+ 1`), no volver a colapsar las bebidas.
2. **El «N de M» da números más altos.** No ha cambiado su criterio —sigue contando
   piezas físicas— es que hay más piezas. Si alguien en el pase dice «antes ponía 4 y
   ahora 9», ésa es la razón y es la correcta.
3. **Los acentos dejan de salir como `?`.** «Jer?me» pasa a «Jerome». Se pliega a
   ASCII a propósito: esa térmica corrompe los bytes altos, así que el objetivo es
   que no haya interrogantes, no que salga la tilde.

## Qué NO cambia

- Ni la migración ni `label_token`: comprobado antes de escribir código que
  `ensure_label_tokens` ya acuñaba un token por unidad **también para las bebidas**.
  Sólo los tiraba el renderizador.
- `label-scan`, `vercel.json`, `order_for_print`: intactos.
- El ticket de cocina y la factura de bolsa: el §5.3 les afecta sólo en que los
  acentos salen bien; ningún cambio de maquetación.
- Carabanchel sigue **sin** `labels` en su impresora (§4). No se toca.

## Riesgo residual declarado

- **El QR de cada bebida no se ha probado en papel.** La verificación física del §3
  (N de N sin reescalar) se hizo pendiente para comida; ahora hay más etiquetas y
  algunas irán sobre latas curvas y frías, que es peor superficie que una caja.
  **Eso hay que mirarlo en la misma prueba física.**
- La pegatina de bolsa se ha conservado por decisión mía (identifica la bolsa
  cerrada; el contenido ya lo prueban las unidades). Es revocable en dos líneas.

## Cómo saber si ha ido bien

`select count(*) from label_token where scanned_at is not null` empieza a subir de
verdad cuando alguien escanee. Y en el pase: que ninguna pegatina lleve un `?` en el
nombre del cliente.
