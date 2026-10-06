# Encargo C03 — Clientes, plataformas y socios de marca

> Copia de trabajo del encargo de Julio (06/10/2026). El repositorio es público:
> los dos socios de marca van como «socio de marca 1» (activo) y «socio de
> marca 2» (ya no activo, histórico que se conserva). Las plataformas (Glovo,
> Uber Eats, Just Eat) se nombran porque ya están en el código.

Rama `conta/c03-clientes`, desde `main` (lleva C02 y C02c). PR en borrador desde
el primer commit. Una cosa cada vez; lo que surja fuera, al PR como pendiente.
Nada en producción hasta el visto bueno de Julio; después, workflow con ensayo,
real y `autorizo`. Vista previa con variables de rama hacia staging-conta
comprobadas. Maquetas: `N9Cliente` (ficha de una plataforma, 1440) y `N10Socio`
(ficha de un socio de marca con su liquidación mensual, 1440). Estilo del C02.
La ficha de un cliente normal es N9 sin liquidaciones. Móvil: los apartados de
`M4Proveedor`, adaptados.

## 1. Para qué
Del lado de los ingresos hay tres cosas distintas: plataformas de reparto (te
liquidan ventas menos comisiones), socios de marca (cesión de marca: les compras
mercancía, elaboras sus marcas y liquidas una vez al mes) y clientes normales
(empresas o particulares con factura). Los consumidores de la tienda no tienen
ficha: son tickets, salvo cuando piden factura con NIF (< 1 %), y entonces se
crea el cliente desde el ticket.

## 2. Contraste
Holded (un contacto, dos papeles), Cegid Diez (430 separada; compensación por
«subcuenta de pago por defecto»), Pennylane (antigüedad de la deuda,
recordatorios, cobros desde el banco), Digits/Puzzle (antigüedad con IA). Lo
nuestro: un tercero con sus papeles y una ficha; liquidaciones de plataforma
leídas y cuadradas con el banco; la del socio calculada desde albaranes,
aportaciones y ventas por marca; la deuda explicada en palabras.

## 3. Hechos de negocio (dichos por Julio)
- Clientes de Foodint: plataformas, tienda (Shop) y venta directa. La ficha de
  cliente normal existe desde el principio.
- Factura con NIF a un consumidor: < 1 %, desde el ticket.
- Socio de marca 1 y socio de marca 2 son cesión de marca: Foodint les compra
  mercancía como a un proveedor, elabora sus marcas, pone algo de género propio,
  y una vez al mes liquida: compras realizadas − aportaciones del socio +
  comisiones pactadas. El 2 ya no está activo; su histórico se conserva
  (tercero archivado, cuentas y movimientos intactos).
- Las plataformas ya están como proveedor (410) y como cliente (430) desde la
  importación de Diez, enlazadas a la misma ficha con papel de pago.

## 4. Modelo (sin cadáveres)
- `party` es la ficha única; `supplier` y el nuevo `customer_fiscal` son papeles
  (`party_role`: supplier · customer · platform · brand_partner). `supplier`
  sigue existiendo y apunta a su `party` (antes = después). El `customer` de
  Shop no es `party` salvo que pida factura con NIF.
- Datos fiscales del cliente: los del C01b (NIF/NIF-IVA/pasaporte con VIES,
  razón social, dirección estructurada, país, recargo, retención, tipo de
  operación, «Excluir del 347» con motivo).
- Cobro: forma y plazo (tablas del C00), cuenta donde cobra (572), IBAN si
  domicilias, días habituales aprendidos.
- Plataforma: periodo de liquidación, % de comisión pactado, liquidaciones
  (periodo, ventas brutas, comisiones, otros cargos, neto, fecha de cobro,
  estado pendiente / cobrada / vencida / con diferencia) con líneas por marca y
  local. «Subir liquidación» lee el PDF (lector por glifos del C02c; Glovo, Uber
  Eats y Just Eat, cada uno con fixture inventada). No contabiliza hasta el C04.
- Socio de marca: marcas cedidas (`brand`), % de comisión y base, aportaciones
  admitidas (marketing, packaging, otras), periodo mensual. Liquidación: compras
  del periodo (albaranes a ese proveedor) − aportaciones + comisión sobre ventas
  de sus marcas; borrador / confirmada / cobrada-pagada; la calcula Folvy, la
  confirma la persona.
- Factura completa desde ticket: «Pedir factura» crea (o encuentra por NIF) el
  `party` y emite la factura (RD 1619/2012, Verifactu) donde ya exista
  facturación; si no, solo el gancho, dicho en el PR.
- Cuentas: cliente → subcuenta de 4300; plataforma → su 430 traída; socio → su
  400 y su 430 en la misma ficha; ventas a 700/705 con desglose por marca. Las
  7 430 traídas de Diez se enlazan por NIF o nombre con confirmación; el socio
  2 queda archivado.
- 347 de ventas (> 3.005,06 €), mismas exclusiones; las plataformas por sus
  liquidaciones.

## 5. Reglas (núcleo puro con pruebas)
1. Un NIF, un tercero («es el mismo que tu proveedor X: añadirle el papel de cliente»).
2. Te debe = facturas emitidas pendientes + liquidaciones pendientes; vencido = pasada la fecha pactada.
3. Plataforma: ventas − comisiones − otros cargos = neto; cobro distinto → «con diferencia» y la cifra; nunca se cuadra sola.
4. Socio: fórmula con las tres fuentes reales; si falta una, se dice y no se cierra.
5. Aprendizaje por cliente con porqué y «Cambiar».
6. Archivado: fuera de listas y propuestas, conserva todo, se recupera con un clic.
7. Plazo de cobro > 60 días: se guarda y avisa (Ley 3/2004).

## 6. Diseño
Lista única «Clientes y proveedores» (filtros por papel y Archivados; Nombre ·
Papeles · Te debe / Le debes · Última operación · «···»; buscador por nombre o
NIF). Ficha N9 (cabecera, cuatro cifras, liquidaciones o facturas con estado,
«Lo que he aprendido», «Con quién hablas», «Sus cuentas»; pestañas Ficha ·
Datos fiscales · Contactos · Cobro · Liquidaciones · Contabilidad · Documentos ·
Historial). Socio N10 (cifras del mes, «Cómo se calcula», liquidaciones
anteriores, cuentas y marcas; «Preparar liquidación de <mes>»). Navegación
Mayor ↔ ficha. Móvil como M4. Estados vacío, con diferencia y archivado.
Capturas frente a maquetas en `docs/conta/capturas/c03/COMPARACION.md`.

## 7. Agentes
«Datos maestros e impuestos»: NIF válido y único por cuenta; neto = ventas −
comisiones − cargos; ningún tercero con dos subcuentas para el mismo papel; 347
de ventas coherente. A las 03:40.

## 8. Pruebas
Unitarias del núcleo y lectores; migración antes = después (cada `supplier` con
su `party`; las 7 430 enlazadas) en staging y la misma consulta en producción
en solo lectura; e2e A y B, ordenador y móvil; RLS; vuelta atrás;
`antes-de-subir.sh` antes de cada push.

## 9. Tareas
1. Comprobaciones previas: informe en el PR y parar.
2. Modelo y migraciones con antes = después y vuelta atrás.
3. Núcleo: reglas, lectores, fórmula del socio; pruebas.
4. Pantallas: lista, N9, N10, móvil; capturas.
5. Agente, e2e, RLS, contraste, informe final; PR listo.

## 10. Entrega
Vista previa (A y B), «fusiona», migraciones por el workflow, Vercel READY.
Después, en producción, Julio enlaza las 430 de Diez y sube la primera
liquidación real.
