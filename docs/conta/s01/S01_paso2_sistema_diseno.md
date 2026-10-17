# S01 · Paso 2.1 · El sistema de diseño

> Rama `conta/s01-esqueleto`. Primer trozo del S01: tokens y componentes
> compartidos. **No se ha movido ninguna pantalla.** El esqueleto (barra,
> cabecera, cinta y favoritos) es el paso 2.2.

## Qué hay

**`src/modules/conta/diseno/`** es el único sitio del sistema.

- `tokens.css`: un solo juego `--s-*`.
  - Color, letra (escala de 12 a 28), pesos, espacios en base 4, radios,
    medidas del esqueleto (cabecera 48 px, barra 88 px) y densidad.
  - Los valores de serie son los de N30, así que Folvy no cambia.
- `temas.ts`: cómo pinta cada marca.
  - La identidad (tinta, apoyo, acción, acento, letra) sigue en `marcas.ts`.
  - Aquí van superficies, barra, estados y radio. Los valores de Sumied se
    midieron píxel a píxel en las maquetas.
  - Vive en el front a propósito: en `_shared`, cada cambio de pintura
    obligaría a desplegar a mano las tres funciones que importan `marcas.ts`.
- `src/marca/tema.ts` escribe los `--s-*` de Sumied.
- Los `--cxm-*` del marco son ahora alias de los `--s-*`, con los mismos valores
  de serie.
- Componentes: `Boton` y `BotonEnlace` (principal, secundario, enlace y
  fantasma; con tecla, contador e icono) · `Campo` con `Texto`, `Importe`,
  `Fecha`, `Selector` y `Subcuenta` · `Chip` (seguro, duda, falta, neutro,
  acción y oscuro) · `Cifra` · `Tarjeta` y `TarjetaCifra` · `Cinta` y
  `GrupoCinta` · `Dialogo` · `Icono` (lucide, 16 px, trazo 1,75, por nombre).
- `Tabla`, `Formulario` y `Documento` son las piezas del M01, que se exportan
  desde `diseno/`. Se mudarán a la carpeta cuando sus pantallas pasen.
- **La página del sistema**: `ajustes/sistema-diseno`, solo fuera de
  producción. Con `?marca=sumied` se ve en Sumied.

## Reglas que se comprueban solas

`tests/unit/modules/conta/s01/diseno-reglas.test.ts`, en la batería de antes
de subir:

- ningún color escrito a mano en `diseno/` fuera de `tokens.css` y `temas.ts`;
- ningún tamaño de letra ni radio a mano en su CSS;
- nada de tablas tipo pijama en todo el CSS de contabilidad;
- los componentes solo importan lo permitido, y las pantallas del esqueleto
  solo cogen piezas de `diseno/`.

Cada regla lleva su «la prueba puede fallar».

## Lo que de las maquetas no va igual: decidido por Julio (17/10)

1. **Dos bordes, dos tokens.**
   - `--s-borde-control`: rodea lo que hay que ver para usarlo (campos,
     desplegables, casillas). En Sumied, `#7F8FA6`: 3,29:1 sobre blanco y
     3,06:1 sobre el fondo (C06 R4, WCAG 1.4.11).
   - `--s-borde-decorativo`: solo ordena (tarjetas, separadores de tabla, la
     cinta y el borde de los botones, que ya se reconocen por su texto). En
     Sumied, `#DCE5F0`, el de la maqueta.
   - Una unitaria comprueba que cada pieza usa el suyo.
2. **Acción y apoyo, los de la identidad del 14/10**: `#1E63C9` en los botones
   y `#4A5B73` en el gris de apoyo. Las maquetas se equivocaron.

## Y una de herramientas

El frente D (el del marco) ahora cubre también `conta/s<n>-…` y la carpeta de
capturas `s01/`.

- Cambian `scripts/conta/capturas.mjs` y el paso «Frente» del workflow.
- Una prueba compara los dos.
- Sin esto, las capturas del S01 no se podrían fijar.
- Un push de esta rama corre `tests/e2e/conta/s01` y el juego común (`area.mjs`,
  sin cambios).
