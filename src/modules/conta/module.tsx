// src/modules/conta/module.tsx
//
// El módulo de contabilidad (C00, 02/10/2026). Trae su propio marco
// (`chrome: 'propio'`): desde el S02, el patrón único (marco/Marco.tsx), con
// las pantallas de siempre dentro.
// Sale en la barra de Folvy solo con el interruptor `conta`; sus rutas están
// montadas siempre y las protege la RLS. Solo administradores.
//
// No depende de Cocina para nada: se puede vender solo.

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { Calculator } from 'lucide-react'
import type { ModuleDefinition } from '@/shell/types'
import { CONTA, rutaConta } from '@/config/navegacion'
import '@/modules/conta/estilo'
import { Marco } from '@/modules/conta/marco/Marco'
import { EmpresasProveedor } from '@/modules/conta/empresa/EmpresasProveedor'
import AjustesPage from '@/modules/conta/pages/AjustesPage'
import PlanContablePage from '@/modules/conta/pages/PlanContablePage'
import AnaliticaPage from '@/modules/conta/analitica/AnaliticaPage'
import MayorPage from '@/modules/conta/pages/MayorPage'
import AlMayor from '@/modules/conta/plan/AlMayor'
import QueVaACadaSitioPage from '@/modules/conta/pages/QueVaACadaSitioPage'
import TablasGeneralesPage from '@/modules/conta/pages/TablasGeneralesPage'
import AltaPage from '@/modules/conta/pages/AltaPage'
import TercerosPage from '@/modules/conta/terceros/TercerosPage'
import FichaTerceroPage from '@/modules/conta/terceros/FichaTerceroPage'
import LibrosPage from '@/modules/conta/libros/LibrosPage'
import DocumentosPage from '@/modules/conta/documentos/DocumentosPage'
import RevisarFacturaPage from '@/modules/conta/documentos/RevisarFacturaPage'
import LlevarACompras from '@/modules/conta/documentos/LlevarACompras'
import RecibidaAMano from '@/modules/conta/documentos/RecibidaAMano'
import FacturasPage from '@/modules/conta/ventas/FacturasPage'
import FacturaVentaPage from '@/modules/conta/ventas/FacturaVentaPage'
import LlevarAVentas from '@/modules/conta/ventas/LlevarAVentas'
import LoteCatcherPage from '@/modules/conta/documentos/LoteCatcherPage'
import LiquidacionesPage from '@/modules/conta/compras/LiquidacionesPage'
import AsientoPage from '@/modules/conta/libro/AsientoPage'
import NuevoAsientoPage from '@/modules/conta/libro/NuevoAsientoPage'
import ComprasPage from '@/modules/conta/compras/ComprasPage'
import LiquidacionPage from '@/modules/conta/compras/LiquidacionPage'
import ComoTeFacturaPage from '@/modules/conta/compras/ComoTeFacturaPage'
import VentasPage from '@/modules/conta/ventas/VentasPage'
import CierresPage from '@/modules/conta/ventas/CierresPage'
import CierrePage from '@/modules/conta/ventas/CierrePage'
import LiquidacionesVentasPage from '@/modules/conta/ventas/LiquidacionesVentasPage'
import PagosPage from '@/modules/conta/compras/PagosPage'
import RemesaPagosPage from '@/modules/conta/compras/RemesaPagosPage'
import RemesasPagosPage from '@/modules/conta/compras/RemesasPagosPage'
import CobrosPage from '@/modules/conta/ventas/CobrosPage'
import RemesaCobrosPage from '@/modules/conta/ventas/RemesaCobrosPage'
import LiquidacionPlataformaPage from '@/modules/conta/ventas/LiquidacionPlataformaPage'
import BancosPage from '@/modules/conta/bancos/BancosPage'
import ImpuestosPage from '@/modules/conta/impuestos/ImpuestosPage'
import IvaPeriodoPage from '@/modules/conta/impuestos/IvaPeriodoPage'
import TrimestrePage from '@/modules/conta/impuestos/TrimestrePage'
import AnualPage from '@/modules/conta/impuestos/AnualPage'
import AceptarAsesoriaPage from '@/modules/conta/impuestos/AceptarAsesoriaPage'
import { ClienteTrimestre } from '@/modules/conta/impuestos/despacho/ClienteTrimestre'
import InicioPage from '@/modules/conta/inicio/InicioPage'
import PuertaPage from '@/modules/conta/puerta/PuertaPage'
import QueEsperasPage from '@/modules/conta/puerta/QueEsperasPage'
import FichaProveedorPage from '@/modules/conta/proveedor/FichaProveedorPage'
import { Portada } from '@/modules/conta/marco/Portada'
import { MARCA, CON_MARCA } from '@/modules/conta/cuenta/marca'
import PatronPage from '@/modules/conta/muestra/PatronPage'
import { baseDeDatos } from '@/services/versionApp'

// C06b (respuesta 6 de Julio, tarea 2): la barra «Pregunta o pide algo» solo
// contesta «Muy pronto», y lo que no funciona no se enseña: ninguna ruta la
// lleva. M01: lo que hacía va al buscador general (grupo «Preguntar»), y solo
// en las rutas que la llevarían (sinPregunta = false). El ejemplo de cada ruta
// se queda escrito para cuando la IA conteste de verdad.
const enMarco = (pagina: ReactNode, _ejemplo: string, sinPregunta = true) => (
  <EmpresasProveedor><Marco sinPregunta={sinPregunta}>{pagina}</Marco></EmpresasProveedor>
)

export const contaModule: ModuleDefinition = {
  id: 'conta',
  name: CON_MARCA ? MARCA.nombre : 'Folvy Conta',
  icon: Calculator,
  topBarOrder: 10,
  requiredRole: 'admin',
  basePath: CONTA.modulo,
  chrome: 'propio',
  featureFlag: CONTA.interruptor,
  routes: [
    // Con Folvy, Ajustes; en el producto vendido solo (C06), su Inicio.
    { path: '', element: <Portada /> },
    // C06 · Inicio («Estilo nuevo · Inicio»): la portada del producto vendido solo.
    { path: CONTA.rutas.inicio, element: enMarco(<InicioPage />, '¿Cuánto llevo gastado en luz?') },
    // V02 · Inicio › Documentos: la puerta por la que entra todo (tablero 19).
    { path: CONTA.rutas.puerta, element: enMarco(<PuertaPage />, '¿Ha llegado la factura de la luz?') },
    // V02d · Inicio › Documentos › Qué esperas cada mes (tablero 23).
    { path: CONTA.rutas.queEsperas, element: enMarco(<QueEsperasPage />, '¿Qué te tiene que llegar cada mes?') },
    // C06 · La ficha del proveedor dentro de contabilidad, sin las piezas de
    // Cocina (sin extensiones): la del producto vendido solo.
    { path: CONTA.rutas.fichaProveedor, element: enMarco(<FichaProveedorPage />, '¿Cuánto le debo?') },
    { path: CONTA.rutas.fichaProveedorApartado, element: enMarco(<FichaProveedorPage />, '¿Cuánto le debo?') },
    // Ajustes como índice lateral (C02 §5a): cada entrada en ajustes/:entrada;
    // Plan contable y Tablas generales tienen su propia página dentro del marco.
    { path: CONTA.rutas.empresa, element: enMarco(<AjustesPage />, 'Añade a Pablo como apoderado') },
    { path: CONTA.rutas.empresaApartado, element: enMarco(<AjustesPage />, 'Añade a Pablo como apoderado') },
    { path: CONTA.rutas.tablas, element: enMarco(<TablasGeneralesPage />, '¿Qué IVA lleva el pan?') },
    { path: CONTA.rutas.tabla, element: enMarco(<TablasGeneralesPage />, '¿Qué IVA lleva el pan?') },
    { path: CONTA.rutas.plan, element: enMarco(<PlanContablePage />, '¿Dónde va el alquiler?') },
    { path: CONTA.rutas.analitica, element: enMarco(<AnaliticaPage />, '¿Puedo llamar «Proyecto» a la marca?') },
    { path: CONTA.rutas.planSitio, element: enMarco(<QueVaACadaSitioPage />, '¿Dónde va el alquiler?') },
    { path: CONTA.rutas.planCuenta, element: <AlMayor /> },
    // Una cuenta del plan (respuesta 5): su Mayor, o «Sumas y saldos» si tiene hijas.
    { path: CONTA.rutas.mayor, element: enMarco(<MayorPage />, '¿Cuánto debo a mis proveedores?') },
    { path: CONTA.rutas.terceros, element: enMarco(<TercerosPage />, '¿Quién me debe dinero?') },
    // El de la ficha lo pone ella según el papel (ejemploDeFicha); éste es el de mientras carga.
    { path: CONTA.rutas.comoTeFactura, element: enMarco(<ComoTeFacturaPage />, '¿Cuándo me manda la factura?') },
    { path: CONTA.rutas.tercero, element: enMarco(<FichaTerceroPage />, '¿Cuánto me debe?') },
    { path: CONTA.rutas.terceroApartado, element: enMarco(<FichaTerceroPage />, '¿Cuánto me debe?') },
    // C04 · Libros › Libro diario (N11), un asiento (N12) y el asiento a mano.
    // C05 · Libros en tres niveles (N13c): el diario del C04 vive dentro, en su ruta de siempre.
    // C06b · respuesta 5, punto 3: sin la barra «Pregunta o pide algo» mientras
    // solo diga «Muy pronto» (tapaba filas de los libros). Como Bancos en el B01.
    { path: CONTA.rutas.libros, element: enMarco(<LibrosPage />, '¿Qué facturas no deducen IVA?', true) },
    { path: CONTA.rutas.libroDiario, element: enMarco(<LibrosPage area="diario" accion="libro-diario" />, '¿Cuánto gané en el Local Norte este mes?', true) },
    { path: CONTA.rutas.diarioResumido, element: enMarco(<LibrosPage area="diario" accion="diario-resumido" />, '¿Cuánto gasté en septiembre?', true) },
    { path: CONTA.rutas.pendientesDiez, element: enMarco(<LibrosPage area="diario" accion="pendientes-diez" />, '¿Cuánto gasté en septiembre?', true) },
    { path: CONTA.rutas.librosArea, element: enMarco(<LibrosPage />, '¿Por qué clientes sale en negativo?', true) },
    { path: CONTA.rutas.librosAccion, element: enMarco(<LibrosPage />, '¿Por qué clientes sale en negativo?', true) },
    // B01 · Bancos en tres niveles (N17): Movimientos, Reglas, Cuentas y extractos, Cierre del mes.
    // Respuesta 4: sin la barra «Pregunta o pide algo» mientras solo diga «Muy pronto».
    { path: CONTA.rutas.bancos, element: enMarco(<BancosPage />, '¿Qué es la transferencia de 1.278,17?', true) },
    { path: CONTA.rutas.bancosPestana, element: enMarco(<BancosPage />, '¿Qué es la transferencia de 1.278,17?', true) },
    // I01b · Impuestos (tableros 8, 9 y 10): el calendario, sus pestañas y el IVA de un periodo.
    { path: CONTA.rutas.impuestos, element: enMarco(<ImpuestosPage />, '¿Cuánto IVA pago este trimestre?') },
    { path: CONTA.rutas.impuestosPestana, element: enMarco(<ImpuestosPage />, '¿Cuánto IVA pago este trimestre?') },
    { path: CONTA.rutas.impuestoIva, element: enMarco(<IvaPeriodoPage />, '¿Por qué pago más que el trimestre pasado?') },
    // I01c · El trimestre (maqueta_303_v2), también de una empresa por la ruta (vista de despacho).
    { path: CONTA.rutas.impuestoTrimestre, element: enMarco(<TrimestrePage />, '¿Cuánto me queda por compensar?') },
    { path: CONTA.rutas.impuestoTrimestreEmpresa, element: enMarco(<TrimestrePage />, '¿Cuánto me queda por compensar?') },
    { path: CONTA.rutas.impuestoAnual, element: enMarco(<AnualPage />, '¿Cuadra lo retenido en el año con los 111?') },
    // P01 · El trimestre de un cliente, abierto desde «Impuestos de tus clientes».
    { path: CONTA.rutas.impuestosCliente, element: enMarco(<ClienteTrimestre />, '¿Qué le falta a este cliente?') },
    // I01b · Aceptar la invitación de una empresa (con sesión; sin ella, la misma página en AuthRouter).
    { path: CONTA.rutas.aceptarAsesoria, element: <AceptarAsesoriaPage /> },
    // Compras (encargo de compras, N18 y N19).
    { path: CONTA.rutas.compras, element: enMarco(<ComprasPage />, '¿Qué facturas me faltan?') },
    { path: CONTA.rutas.ventas, element: enMarco(<VentasPage />, '¿Cuánto vendí ayer?') },
    // D01 R5 · 10: sin la barra «Pregunta o pide algo» mientras solo diga «Muy pronto» (como Bancos).
    { path: CONTA.rutas.documentos, element: enMarco(<DocumentosPage />, '¿Qué facturas me faltan este mes?', true) },
    { path: CONTA.rutas.revisarFactura, element: enMarco(<RevisarFacturaPage />, '¿A qué cuenta va esta factura?', true) },
    { path: CONTA.rutas.loteCatcher, element: enMarco(<LoteCatcherPage />, '¿Cuadra la quincena de Catcher?', true) },
    // S02 · PR 3: Compras y gastos › Liquidaciones, todas en una lista. PC01 · E2 (Julio, 26/10): se
    // llama «Repartidores» (la quincena de los riders); la dirección de antes lleva allí, con sus filtros.
    { path: CONTA.rutas.repartidores, element: enMarco(<LiquidacionesPage />, '¿Cuadra la quincena de los repartidores?', true) },
    { path: CONTA.rutas.liquidaciones, element: <LlevarAVentas a={CONTA.rutas.repartidores} /> },
    // PC01 · E2 · Compras y gastos › Pagos (tablero 15), sus remesas y la ficha de una (tablero 16).
    { path: CONTA.rutas.pagos, element: enMarco(<PagosPage />, '¿Qué tengo que pagar esta semana?', true) },
    { path: CONTA.rutas.remesasPagos, element: enMarco(<RemesasPagosPage />, '¿Qué remesas esperan su cargo?', true) },
    { path: CONTA.rutas.remesaPagos, element: enMarco(<RemesaPagosPage />, '¿Por qué esta remesa está parada?', true) },
    { path: CONTA.rutas.cobros, element: enMarco(<CobrosPage />, '¿Quién me debe y cuándo lo cobro?', true) },
    { path: CONTA.rutas.remesaCobros, element: enMarco(<RemesaCobrosPage />, '¿Qué pasa con esta remesa de recibos?', true) },
    { path: CONTA.rutas.liquidacionNueva, element: enMarco(<LiquidacionPage />, '¿Cuánto me paga este mes?') },
    { path: CONTA.rutas.liquidacion, element: enMarco(<LiquidacionPage />, '¿Cuánto me paga este mes?') },
    { path: CONTA.rutas.nuevoAsiento, element: enMarco(<NuevoAsientoPage />, '¿A qué cuenta va el alquiler?', true) },
    // S01 · La factura recibida desde Contabilidad › Asientos (maqueta 3): el mismo componente que N23.
    // S02 · PR 2: las recibidas son de Compras y gastos; las direcciones de antes llevan allí.
    { path: CONTA.rutas.recibidasEnAsientos, element: <LlevarACompras /> },
    { path: CONTA.rutas.recibidaEnAsientos, element: <LlevarACompras /> },
    { path: CONTA.rutas.recibidaAMano, element: enMarco(<RecibidaAMano />, '¿A qué cuenta va esta factura?', true) },
    // S02 · PR 2: Facturación › Facturas emitidas, y una nueva (la hoja del asiento, tipo expedida).
    // V01 · Ventas › Facturas: la lista, una nueva y la ficha. Lo de antes (Facturación › Facturas emitidas) lleva aquí.
    { path: CONTA.rutas.facturasVenta, element: enMarco(<FacturasPage />, '¿Cuánto he facturado este mes?', true) },
    { path: CONTA.rutas.nuevaFacturaVenta, element: enMarco(<FacturaVentaPage />, '¿Qué IVA lleva esta factura?', true) },
    { path: CONTA.rutas.facturaVenta, element: enMarco(<FacturaVentaPage />, '¿Cómo corrijo una factura emitida?', true) },
    // V01 · Entrega 2 · Ventas › Cierres del día (con «Vendo en hostelería») y la ficha de un cierre.
    { path: CONTA.rutas.cierres, element: enMarco(<CierresPage />, '¿Cuánto vendí ayer?', true) },
    { path: CONTA.rutas.cierre, element: enMarco(<CierrePage />, '¿Por qué este cierre no cuadra?', true) },
    // V01 · Entrega 3 · Ventas › Liquidaciones (con «Vendo en hostelería»): plataformas y socios de marca, y la ficha de una fila de plataforma.
    { path: CONTA.rutas.liquidacionesVentas, element: enMarco(<LiquidacionesVentasPage />, '¿Me han pagado lo que vendí?', true) },
    { path: CONTA.rutas.liquidacionPlataforma, element: enMarco(<LiquidacionPlataformaPage />, '¿Por qué esta liquidación no cuadra?', true) },
    { path: CONTA.rutas.facturasEmitidas, element: <LlevarAVentas a={CONTA.rutas.facturasVenta} /> },
    { path: CONTA.rutas.nuevaEmitida, element: <LlevarAVentas a={CONTA.rutas.nuevaFacturaVenta} /> },
    { path: CONTA.rutas.asiento, element: enMarco(<AsientoPage />, '¿Por qué la comisión lleva IVA?', true) },
    // S02 · La muestra del patrón único: las seis plantillas (datos inventados), solo fuera de
    // producción. Sustituye a las dos de antes (las piezas del M01 y el sistema de diseño del S01).
    ...(baseDeDatos().tipo === 'produccion' ? [] : [
      { path: CONTA.rutas.sistemaDiseno, element: enMarco(<PatronPage />, '') },
      { path: CONTA.rutas.muestraPiezas, element: <Navigate to={rutaConta(CONTA.rutas.sistemaDiseno)} replace /> },
    ]),
    { path: CONTA.rutas.ajustesEntrada, element: enMarco(<AjustesPage />, '¿Dónde cambio el plazo de pago?') },
    // El alta va sin el menú del módulo, como la maqueta N1: es una conversación a pantalla completa.
    { path: CONTA.rutas.alta, element: <EmpresasProveedor><AltaPage /></EmpresasProveedor> },
    { path: '*', element: <Portada /> },
  ],
  sidebar: {
    // El Shell no pinta este menú (marco propio): sirve para decidir si el
    // módulo sale en la barra de Folvy. La barra de verdad sale de
    // esqueleto/productos.ts (marco/Barra.tsx).
    items: [{ id: 'conta_ajustes', label: 'Ajustes', icon: Calculator, path: CONTA.rutas.empresa, requiredRole: 'admin' }],
  },
}
