# Calibración Ley 1.bis — Lista de exclusión PINNEADA

**Fecha de congelación:** 14/08/2026, 21:30. **Autor:** Julio (pasada a Code por chat, sustituye a
la petición del encargo de "pídele la lista a Julio").

Congelada porque **las medianas se mueven con cada recepción nueva**: la misma consulta daba 84
líneas a las 15:00 y 86 a las 21:30 del mismo día. El gate de calibración del Tramo A.1 necesita un
conjunto fijo, no una consulta viva. **No se recalcula en vivo.**

## Metodología

Movimientos `movement_type='recepcion'` con `unit_cost>0`, cuenta Llorente29, mínimo 3 recepciones
por artículo, y desviación **>1,8×** (o <1/1,8) de la mediana del propio artículo:

```sql
with base as (
  select sm.recipe_item_id, grl.id as line_id, sm.unit_cost
  from stock_movement sm
  join goods_receipt_line grl on grl.id = sm.source_id
  where sm.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
    and sm.source_type='goods_receipt_line' and sm.movement_type='recepcion' and sm.unit_cost>0
), med as (
  select recipe_item_id, percentile_cont(0.5) within group (order by unit_cost) as mediana, count(*) as n
  from base group by 1
)
select b.line_id from base b join med m using (recipe_item_id)
where m.n>=3 and (b.unit_cost > m.mediana*1.8 or b.unit_cost < m.mediana/1.8);
```

## Cinco líneas de esta lista NO se excluyen: son GROUND TRUTH

Sus `goods_receipt_line` fueron corregidas a mano el 14/08 contra el papel — el movimiento
`recepcion` original conserva el coste malo (por eso salen en la consulta), pero el valor ACTUAL de
la línea es verdad verificada y el intérprete debe reproducirlo:

| line_id | Albarán | Artículo | qty_in_base correcto |
|---|---|---|---|
| `b9a8f174-1a8a-4b7f-856d-cf0f5f6870d1` | ALB-00116 | Queso Gouda Loncheado | **6000** |
| `3d13eac9-9bbc-4fc8-a14e-1c5d29155082` | ALB-00116 | Pulled Pork | **12000** |
| `bfc5bca4-dcdf-4e68-8a6f-5fb0561524c0` | ALB-00116 | Tomate Pera | **3300** (no aparece en la lista de excluidas; corregida igualmente) |
| `d99488f8-915f-4972-b764-ff78a4087706` | ALB-00115 | Tequeños Rellenos de Queso | **340** — CONFIRMADO por Julio (2 cajas × 170 ud; ya no está en cuarentena) |
| `538cfa4d-2ba3-481a-8d8d-72975705b814` | ALB-00044 | Bolsas Sos sin Asas Kraft 22x14x37 Cm | **500** (2 cajas × 250; `raw_text` es NULL en esta línea — no participa del cruce automático por texto, se verifica a mano como caso testigo) |

## Las 86 líneas EXCLUIDAS del ground truth

(line_id · albarán · artículo · ratio coste vs mediana)

```
cd81e36a-68ac-4131-9d7c-2b51425498dd · ALB-00045 · Aceite de Oliva Suave 0,4º · 8.80
fcd484af-cdb2-4328-b0a7-bbe526d69991 · ALB-00100 · Agua Mineral 50 CL · 0.25
6af4cede-7b02-4c5a-b76e-602907af3e52 · ALB-00030 · Alubias rojas · 0.42
01b7ec8e-ebe7-4b84-804e-e2ef4cb1d640 · ALB-00033 · Alubias rojas · 0.34
7e41cfb9-99e5-41e4-860a-a0eb8d8107c5 · ALB-00001 · Arroz Largo · 5.00
315f9f40-f24a-42c9-b2d5-d885306e83fc · ALB-00005 · Arroz Largo · 2.48
3e71cc66-43ad-4330-9594-0d90e85f34ae · ALB-00014 · Arroz Largo · 2.48
27ab4dd6-ec20-4ab4-886f-9f4103b14d93 · ALB-00049 · CAJA GENERICA 780 Ml · 250.00
c5ff518c-c611-4dff-b9f9-99a1fe44f0a5 · ALB-00056 · CAJA GENERICA 780 Ml · 190.62
7a44ca14-bc02-4336-8d22-45655bacdfd5 · ALB-00005 · Cebolla Morada · 4.11
e815e8f4-57bd-4a52-ae6d-10eb222e90ae · ALB-00014 · Cebolla Morada · 4.11
16cb3898-0e71-4439-8e40-757bfd442de9 · ALB-00049 · Cebolla Morada · 5.00
c01a89fb-3035-4953-99cc-6e5662a7eea7 · ALB-00087 · Cebolla Morada · 5.00
0b922664-80bd-49b7-bb94-9af4bb925828 · ALB-00005 · Cilantro · 2.19
5132edd6-f83b-456b-877a-aed168db035c · ALB-00014 · Cilantro · 2.19
09c36e26-a107-4b76-b60f-7840555e79a3 · ALB-00033 · Cilantro · 2.19
b1724c38-f863-496d-b52d-1531f08e7418 · ALB-00014 · Coca-Cola Original Lata · 2.00
a5d2270c-ac69-4409-9206-402f1f906b48 · ALB-00100 · Coca-Cola Original Lata · 0.03
dda2231f-4cac-439f-b131-3d4147bd9b7d · ALB-00031 · Crema Agria · 2.00
4a207c0d-6a9b-42dd-adb1-643bd3925905 · ALB-00045 · Crema Agria · 2.00
1cab3016-fb6d-4d00-9ec7-f5b3e8f1dfd0 · ALB-00100 · Fanta Limón Lata · 0.03
0d22ff6d-2383-4fe6-b192-fa53c0554c48 · ALB-00100 · Fanta Naranja Lata · 0.03
d49134ce-2172-4595-b207-272eaf71de4a · ALB-00030 · Jamon Dulce · 0.55
e191c67d-41ba-4ba9-98fb-f9f80e9d1833 · ALB-00029 · Kebab Pollo Loncheado · 0.11
b8d5cd69-8723-4820-8458-efa0ac1a5468 · ALB-00029 · Kebab Ternera Loncheado · 0.14
959e3bf0-a87f-4b25-9b0c-98d6bd0f0aba · ALB-00005 · Lechuga Romana · 0.53
dd7de937-7535-4d9e-aead-515a399b103f · ALB-00014 · Lechuga Romana · 0.53
1f022e68-76ad-4f9d-8cf1-0adf1961ac7c · ALB-00033 · Lechuga Romana · 0.40
8b146f56-b3e8-4796-b11f-9cb49d0ecc74 · ALB-00049 · Lechuga Romana · 0.40
4d5e754b-e724-4968-aec6-908bf4d438d6 · ALB-00087 · Lechuga Romana · 0.41
c4ab1ec4-9e84-44c6-ae17-0a558d095bfe · ALB-00086 · Milanesa de Pollo Rebozado · 4.21
d45c7967-385f-4bc8-9601-af7a2ddf264e · ALB-00103 · Milanesa de Pollo Rebozado · 4.21
857fb7ea-33dc-43fc-8314-81d3484bcff5 · ALB-00008 · Milanesa Ternera Rebozado · 64.00
e61cd886-79ee-49da-af49-860af08f3c56 · ALB-00024 · Milanesa Ternera Rebozado · 64.00
5a655ce1-74b4-42ce-abc8-a55080273319 · ALB-00027 · Milanesa Ternera Rebozado · 64.00
a3e0de38-d211-42e3-bf26-15396ea5ff82 · ALB-00031 · Milanesa Ternera Rebozado · 64.00
aa2d374f-6b23-42be-babd-b5339fbe0c66 · ALB-00090 · Pan de Pita 21 cm · 0.01
abffd839-1d8b-4300-a496-c68b9f8ff540 · ALB-00029 · Patatas Bastón · 0.08
57ad9dc9-eb70-4203-81ab-f98ed7ae8e3f · ALB-00040 · Patatas Bastón · 0.08
d1a0f1ab-f185-4fbc-af6b-3481c6d316ac · ALB-00005 · Pesto Verde · 0.52
f357fc9a-1fc1-4e54-afbc-4f7e8d413d6a · ALB-00033 · Pesto Verde · 0.52
3d13eac9-9bbc-4fc8-a14e-1c5d29155082 · ALB-00116 · Pulled Pork · 2.00  ← GROUND TRUTH corregido, ver arriba
0cfc5d78-0700-498f-9fd9-c7c748efd808 · ALB-00041 · Queso Gouda Loncheado · 5.45
973dbb21-5604-42d9-be6d-51ff67a209bf · ALB-00045 · Queso Gouda Loncheado · 5.45
736daa66-e3d8-433c-9026-42627fcf109f · ALB-00048 · Queso Gouda Loncheado · 5.45
82f96f89-2bcc-4353-9af5-68b4f16278da · ALB-00053 · Queso Gouda Loncheado · 5.45
155aec25-e3d4-4756-9946-9705b422cdab · ALB-00058 · Queso Gouda Loncheado · 5.45
2e3e89af-6dee-484d-bbe1-c4f943bbb9e6 · ALB-00059 · Queso Gouda Loncheado · 5.45
b9a8f174-1a8a-4b7f-856d-cf0f5f6870d1 · ALB-00116 · Queso Gouda Loncheado · 5.45  ← GROUND TRUTH corregido
d454e623-25d4-424f-8fe7-d3cb6d1d527c · ALB-00036 · Queso Mozarela · 0.47
216b2d5d-b08f-451f-b2ce-b9e8771343e5 · ALB-00101 · Queso Mozarela · 0.52
9ae7e79e-4687-4d2a-a6ec-fd2f0ca8cae0 · ALB-00090 · Rollitos de Queso Feta · 0.13
d14c917c-4f15-45a4-91e8-a88112490dda · ALB-00089 · Salsa Tzatziki 200g · 0.08
e07ac7f9-5971-4c31-8e51-4e47bad1f23d · ALB-00056 · Salsero 120 Cc · 0.18
e8273e88-4436-4343-9bb6-979b22d0d1e0 · ALB-00030 · Servilletas 30 x 40 · 0.20
4208fc9a-0f49-4f06-b5d7-315a20a2dd7b · ALB-00033 · Servilletas 30 x 40 · 0.20
d8723852-c471-4173-a4f8-4d235cb37523 · ALB-00056 · Servilletas 30 x 40 · 2.70
10907d30-c9cc-417d-a6db-fa1e56fbdb2d · ALB-00084 · Servilletas 30 x 40 · 2.70
a42041fc-d5db-4121-a477-aa0672a92b2d · ALB-00102 · Servilletas 30 x 40 · 2.70
1e7d58e5-3d15-447f-b95a-9af6bd780e20 · ALB-00105 · Servilletas 30 x 40 · 0.09
b421aed4-dff8-405b-83c7-4c4f8b8400ed · ALB-00040 · Sweet Potato Fries · 0.10
d99488f8-915f-4972-b764-ff78a4087706 · ALB-00115 · Tequeños Rellenos de Queso · 2.00  ← GROUND TRUTH confirmado (340), ver arriba
cd4f6f8b-c3c0-445c-b842-6d118e72ba0a · ALB-00005 · Tomate Pera · 2.36
c9896503-70ad-452f-ad24-49c385642b64 · ALB-00014 · Tomate Pera · 2.22
453bd77d-4da4-4f08-8973-01f088b646af · ALB-00058 · Tomate Pera · 0.46
1a2af56c-5d15-4f4a-92ce-3f14875be264 · ALB-00059 · Tomate Pera · 0.46
1da4bc3e-5ac9-42f4-b11f-18d32f3ff00a · ALB-00070 · Tomate Pera · 0.46
b12a40dd-2f64-456e-8cf9-f38c06f82a73 · ALB-00077 · Tomate Pera · 0.46
493daa20-efb8-45cd-ab40-753fd85ed7f0 · ALB-00079 · Tomate Pera · 0.46
a86e6378-61a6-4555-974c-17e2b575ab5b · ALB-00087 · Tomate Pera · 2.79
84e37664-0526-49d7-ac2d-2021dd47382b · ALB-00104 · Tomate Pera · 0.46
f2c73c70-988a-443d-8cdc-cbfb513b32bb · ALB-00107 · Tomate Pera · 0.46
98d2e18c-0011-4b44-ba9d-42b675517c8a · ALB-00114 · Tomate Pera · 2.79
172d8445-a052-4d12-a754-8c16d5a7dd2f · ALB-00031 · Tortilla Maíz 12 cm · 13.33
2fab8b7f-2b4a-4245-8065-2354bdd87a7f · ALB-00041 · Tortilla Maíz 12 cm · 12.00
12b59be8-80e8-445b-b3c9-71c4a045425a · ALB-00045 · Tortilla Maíz 12 cm · 12.00
71f6b49a-3285-467e-8671-2d2a2d99e7ff · ALB-00048 · Tortilla Maíz 12 cm · 12.00
0dd136a9-cb9d-4fb1-8b06-43c5988afd86 · ALB-00053 · Tortilla Maíz 12 cm · 12.00
22cc12f3-b591-4c48-9a77-4964b27090ba · ALB-00058 · Tortilla Maíz 12 cm · 12.00
df72cfbc-c5d5-445a-96e1-e1d0d6359b12 · ALB-00023 · Tortilla Trigo 30 cm · 0.17
fc87e73f-729e-45eb-a08b-4b8ab5585653 · ALB-00070 · Tortilla Trigo 30 cm · 0.17
fc378a66-3660-460a-bd0a-c9b37700ffe3 · ALB-00077 · Tortilla Trigo 30 cm · 0.17
aaef5d7f-df08-4267-b4c8-b25134236954 · ALB-00104 · Tortilla Trigo 30 cm · 0.17
90485de4-f04e-45c4-a226-0e846c65fa45 · ALB-00114 · Tortilla Trigo 30 cm · 0.17
```

## Nota histórica: los Tequeños del ALB-00115 (d99488f8), ya resuelta

La propia lista destapó un séptimo error el 14/08. La línea entró como 2 paquetes de 85 (= 170 ud) a
57,56 €/paquete → 0,677 €/ud, exactamente el doble de la mediana histórica (0,339 €/ud). Dividiendo
57,56 entre 170 —el formato que el proveedor declara en su propio nombre, "CJ 170 UD"— sale
0,339 €/ud: la mediana clavada. Confirmado por Julio: llegaron 2 cajas de 170 (=340), no 170. Esto
cambió el estado de PED-00040 (Tequeños pasó de "parcial 50%" a "servido completo") y movió el
invariante de stock de Llorente29 de 656 a **658** movimientos `source_type='goods_receipt_line'`.
