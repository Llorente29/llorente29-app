# S01 · Paso 2.2 · El esqueleto

> Rama `conta/s01-esqueleto`. Barra por productos, cabecera de una fila de
> 48 px, pestañas de Contabilidad, cinta y favoritos. Las pantallas aún no se
> han mudado (eso es el paso 3): se ven dentro del esqueleto como estaban.

## Qué hay

Las piezas están en **`src/modules/conta/esqueleto/`**; el marco
(`marco/nuevo/MarcoNuevo.tsx`) las junta. Solo usan piezas y tokens del
sistema de diseño, y lo comprueba la unitaria.

- **`productos.ts`: el esqueleto en datos.**
  - El orden de la barra es Inicio · Contabilidad · Facturación · Compras y
    gastos · Bancos · Laboral · Impuestos · Contactos y, abajo, Ajustes.
  - Cada pestaña dice qué direcciones son suyas y gana el prefijo más largo.
    Las pantallas no cambian de dirección.
  - **Nada vacío.** Un producto o una pestaña sin pantalla no sale.
    Facturación, Laboral e Impuestos llevan además su interruptor en
    `feature_flags` (`conta_facturacion`, `conta_laboral`, `conta_impuestos`,
    sin caducidad). Hoy no tienen pantalla, así que no salen aunque el
    interruptor esté encendido.
  - **Hostelería y Diez son de la empresa.** Liquidaciones solo sale con
    hostelería e Importar solo con Diez.
- **`ordenes.ts`: el catálogo de órdenes**, con un id que no cambia. De él
  salen la cinta y Favoritos, y saldrá la paleta de Ctrl K (paso 4).
- **Barra de productos.**
  - Unos 88 px, con el símbolo de la marca arriba. En Sumied es azul noche.
  - Debajo de Inicio sale «N por revisar», lo de todos los productos.
  - Plegada, se ven solo los iconos (56 px).
  - En el móvil va abajo: Inicio, Contabilidad, Compras y gastos, Bancos y
    «Más».
- **Cabecera de una fila de 48 px** (tu respuesta 3), de izquierda a derecha:
  logotipo · logo y nombre del cliente con el cambio de empresa · ejercicio y
  mes (solo donde la pantalla lo lee) · pestañas, con «Más ▾» para las que no
  caben · «Buscar · Ctrl K» · Favoritos · «Nombre · Nivel ▾».
- **Cinta.**
  - En Asientos lleva los grupos de la maqueta 1: NUEVO · REVISAR ·
    UTILIDADES.
  - Se oculta y se recuerda. Oculta, queda «Mostrar la cinta».
- **Favoritos.**
  - Se fija desde su menú: la pantalla en la que se está y cada orden de su
    cinta.
  - Se guarda en la base, así que sigue a la persona de un navegador a otro.
  - Un favorito que en esta empresa no se puede abrir sale en gris y dice por
    qué (regla 7).
- **Menú del usuario.** Nivel (los tres), densidad, cinta y «Volver a Folvy».
  El nivel se guarda ya; las palabras por nivel llegan en el paso 4.
- **Regla 8.** Fijar, quitar, cambiar de nivel, ocultar la cinta y un error al
  guardar lo dicen en la línea de aviso de debajo de la cabecera.

## La base: una tanda (añadir) y un fichero de datos (autorizo)

| Fichero | Qué hace | Clase |
|---|---|---|
| `20261121T0100_s01_esqueleto.sql` | `conta_user_pref` (RLS: cada uno su fila) y `company.is_hospitality` (admite nulos) | añadir |
| `20261121T0110_s01_hosteleria_de_hoy.sql` | Pone la marca de las empresas de hoy según la actividad de su cuenta. En producción, solo Foodint (medido el 17/10) | cambia datos: **autorizo** |

- Las dos tienen su vuelta atrás en `supabase/vuelta-atras/`.
- La prueba de staging es `20261121_s01_esqueleto_prueba.sql`, con `rollback`.
  Comprueba:
  - la 0110 sobre datos;
  - las políticas, como usuario de A: su fila sí; la de B y la cuenta de B, no;
  - las dos vueltas atrás, de verdad.
- Staging lo aplica primero de su manifiesto. La prueba de corte de la D01
  falla con los datos de staging y el workflow para en el primer fallo.

## La cuenta D, sin hostelería (tu respuesta 1)

- «Asesoría de Prueba Oeste»: otra actividad, de Folvy (sin marca propia),
  con su empresa marcada como no de hostelería.
- Semilla: `seed_s01_cuenta_d_sin_hosteleria_staging.sql`.
- Entra en la plantilla de los carriles. Los usuarios pasan de siete a ocho, y
  las comprobaciones cuentan los de la lista en vez de un 7 escrito a mano.

## Lo que queda para el paso 3, dicho

- **Libros** sigue pintando sus áreas en la pantalla, y **Bancos** sus
  pestañas. Pasan a la cinta y a la cabecera cuando se muden; hasta entonces,
  la cinta solo está en Asientos para no salir dos veces.
- **«Recibida» y «Digitalizar»** de la cinta abren hoy Compras y gastos ›
  Facturas recibidas. La misma factura vista desde Contabilidad (maqueta 3)
  llega en el paso 3; la unitaria lo tiene apuntado con su nombre.
- **«Expedida», «Tesorería» y «Predefinidos»** abren el asiento a mano con
  `?tipo=`. Que el asiento use ese tipo es del paso 3.
- **La marca de hostelería en el alta y en Ajustes**: hoy solo la pone la 0110.
  Una empresa dada de alta después queda sin decir y se trata como «no» hasta
  el paso 3.
- **«Vigilancia» y «Anular»** no están en la cinta. Vigilancia aún no tiene
  pantalla, y Anular es del asiento abierto.
- **El logo del cliente** sale hoy de la cuenta (`accounts.logo_url`). El de
  cada empresa, con su subida en Ajustes, es del paso 3.
