# Deuda · «Platos vendidos sin coste», a rehacer en la tarjeta «Platos sin escandallo» del Inicio

Abierta el 05/10/2026. Una deuda, con su condición de cierre.

## Qué se ha quitado

En **Cocina › Excepciones de ventas** (`SalesExceptionsPage`, vista general), la
sección **«Casado pero sin coste»** —la lista de platos vendidos cuyo artículo
no tiene coste, con sus botones para reclasificarlos— y su lectura en el
servicio, `listCostlessSoldProducts` (`salesReliabilityService`).

Se queda la cifra agregada «casado pero sin coste» de la tarjeta de señal
(`SignalCard`): esa sale de `getReliability`, que está viva.

## Por qué

- La lista llamaba a la RPC `list_costless_sold_products`, que **retiró a
  propósito** la migración `20260902204305_retirar_list_costless_sold_products`
  el 02/09. Su guarda contó funciones de Postgres y crons, pero no el front.
- Desde entonces la sección no mostraba nada. Solo salía un aviso ámbar de que
  no se podía mostrar. Ha estado **un mes rota en producción sin que nadie lo
  notara**.
- Al regenerar `src/types/database.ts` desde producción, el comprobador de tipos
  la cazó: eran los 2 últimos errores. Es la regla 40 de `CLAUDE.md`: lo que va
  entre comillas no lo mira nadie hasta que el tipo es el de verdad.
- Ya estaba anotada en `docs/RECON_tipos_b18_20260903.md` §4.1.

Decisión de Julio, 05/10: se quita (camino 1). No se vuelve a crear la RPC.

## Dónde vuelve la señal

La señal no se pierde: está prometida como la tarjeta **«Platos sin
escandallo»** del Inicio, con la clave `kitchen.platos_sin_escandallo` en
`src/shell/home/cards/p2Cards.ts`, que lleva a Cocina › Platos.

**Se rehace allí sobre la fuente de coste actual («el coste es lo que se
compró»), no sobre la RPC muerta ni sobre su consulta.**

## Condición de cierre

La tarjeta `kitchen.platos_sin_escandallo` existe en el Inicio con datos reales:

- calcula el coste con la fuente actual;
- filtra por `account_id`;
- **ordena por dinero vendido y no esconde filas** (regla 7);
- lleva a la ficha de cada plato para completarlo.
