# RECON — Casar la venta por el id del canal, no por el nombre

> 22/09/2026, 22:0x. Encargo de Julio (Korean Crispy Menu, 718 € sin casar).
> Cuenta Foodint `51ad1792-6629-4ef7-833a-b57b09a86710`.
> **Nada escrito en la base.** El encargo decía «no escribir nada hasta saber
> cuál de los dos es». Ya se sabe.

## La respuesta: EL ID VIENE. El adaptador lo tira.

El encargo planteaba dos ramas: o Last no manda el id del combo, o lo manda y
el adaptador lo pierde. **Es la segunda, y es la rama buena: «guardarlo, es el
arreglo entero y lo demás sobra».**

Payload real de Last, combo del pedido U605 de hoy a las 21:49:

```json
{
  "name": "Korean Crispy  Menu (Para 1) KDB",
  "type": "COMBO",
  "organizationProductId": null,                                 ← lo que lee el adaptador
  "organizationComboId":  "9cf2395e-3c1a-4813-9b46-d5544f2f0a02", ← el id está AQUÍ
  "catalogProductId":     "867bde75-bec9-4c86-a688-4aba1b635f98", ← y AQUÍ
  "comboProducts": [ { "organizationProductId": "649b7b2e-…" }, … ]
}
```

**Last no se deja el id: lo pone en otro campo.** Un combo no es un producto, así
que `organizationProductId` va a `null` **por diseño**, y el id del combo viaja
en `organizationComboId`.

### Y es sistemático, no un caso suelto

Productos de Last en 30 días, contados sobre el payload crudo:

| tipo | productos | `organizationProductId` | `organizationComboId` | `catalogProductId` |
|---|---:|---:|---:|---:|
| PRODUCT | 3.696 | 3.678 | 0 | **3.694** |
| **COMBO** | **747** | **0** | **744** | **747** |

- Los 747 combos: **cero** traen `organizationProductId`. Por eso el 84 % de los
  combos «llega sin identificador»: no es que no lo traiga, es que se mira el
  campo equivocado.
- **744 de 747** traen `organizationComboId` (99,6 %).
- **747 de 747** traen `catalogProductId` — el **100 %**, y es el identificador
  más completo de los tres, también en los PRODUCT (3.694 de 3.696).

### El adaptador, confirmado

`adapt_lastapp_order` **lee `organizationProductId` y no lee ni
`organizationComboId` ni `catalogProductId`**. Medido sobre `pg_proc`: ninguna
función de la base lee `organizationComboId`, y `catalogProductId` solo lo usa
`list_pending_external_brands`, para otra cosa.

## Lo que esto cambia del plan del encargo

El encargo pedía, si no viniera el id, «casar el combo por otra clave estable
(el `combo_slot_id`, la firma de sus componentes…)». **Eso sobra.** No hace
falta inventar una clave: hay dos, y una está en el 100 % de las líneas.

El arreglo se reduce a:

1. **Leer el id correcto según el tipo.** Para `type='COMBO'`, el id es
   `organizationComboId`; para el resto, `organizationProductId`. Y
   `catalogProductId` como tercera red, que cubre lo poco que queda.
2. **Guardarlo en `sale_line.external_product_id`**, que hoy queda a `null` en
   los 747 combos de 30 días.
3. **Casar por id primero y por nombre después** (punto 1 del encargo). Con el id
   guardado, las 119 líneas de 1.567,14 € que ya traen un id presente en la
   carta casan solas.

**Los puntos 4 y 5 del encargo (duplicados y normalizador tolerante) siguen
valiendo**, pero bajan de prioridad: dejan de ser el arreglo y pasan a ser la red
de seguridad, que es su sitio.

## Lo que NO he hecho, y por qué

**Nada escrito.** `adapt_lastapp_order` es el camino del pedido, y son las 22:0x
con la cena en marcha — a las 21:49 entró el U605 que he usado de prueba. Un
cambio en el adaptador con pedidos entrando se aplica fuera de servicio, como el
del envase.

## Lo que queda, en orden

1. Leer `adapt_lastapp_order` entero y escribir el cambio de los tres campos.
   Es cirugía en el adaptador: hay que ver dónde casa y dónde escribe.
2. El recasado retroactivo del **casado** (punto 3), que el encargo ya marca como
   «preguntar a Julio si choca con la regla del 18/09». No toca stock.
3. El informe de duplicados (punto 4) y el normalizador (punto 5).
4. El aviso en caliente del cambio de nombre (punto 6).

## Una cosa que anotar

Los `comboProducts` **sí** traen `organizationProductId` cada uno. O sea que los
hijos de un combo se pueden casar por id igual que un plato suelto — y eso es
justo lo que hace falta para que los `combo_item` lleven ficha y artículo, que es
el otro frente abierto de hoy.
