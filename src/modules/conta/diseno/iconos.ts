// src/modules/conta/diseno/iconos.ts
//
// S01 · El catálogo de iconos del sistema (lucide-react), por nombre. El
// componente que los pinta es Icono.tsx; aquí solo el catálogo, para que lo
// lean también la paleta y la cinta sin cargar componentes.

import {
  ArrowDownLeft, ArrowLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, BadgeCheck, Ban, Bell, BookOpen, Building2, Calculator,
  Calendar, CalendarCheck, CalendarRange, ChartColumn, Check, ChevronDown, ChevronUp, Contact, Copy, CornerDownLeft, CreditCard,
  Download, Equal, Euro, File, FileCheck, FileMinus, FileSignature, FileText, HandCoins, Handshake, House, Info, Landmark,
  LayoutTemplate, LibraryBig, ListChecks, Lock, Mail, Menu, NotebookPen, Package, PanelLeftClose, PanelLeftOpen, Percent, Pin,
  PinOff, Plus, Receipt, Repeat, Scale, ScanLine, Search, Settings, SlidersHorizontal, Sparkles, Star, Store, TriangleAlert,
  Truck, Upload, UserRound, Users, Wallet, Workflow, X,
  ExternalLink, Printer, Briefcase, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, CircleQuestionMark, Maximize2, Minimize2, ZoomIn, ZoomOut, Ellipsis, LogOut,
  type LucideIcon,
} from 'lucide-react'

export const ICONOS = {
  // Productos de la barra.
  inicio: House,
  contabilidad: BookOpen,
  facturacion: FileText,
  compras: Receipt,
  bancos: Landmark,
  laboral: Users,
  impuestos: Percent,
  contactos: Contact,
  ajustes: Settings,
  // Cabecera.
  buscar: Search,
  favorito: Star,
  fijar: Pin,
  desfijar: PinOff,
  empresa: Building2,
  avisos: Bell,
  // Cinta de Asientos (maqueta 1).
  expedida: ArrowUpRight,
  recibida: ArrowDownLeft,
  tesoreria: Euro,
  general: Equal,
  predefinidos: Copy,
  vigilancia: Scale,
  revisar: ListChecks,
  digitalizar: ScanLine,
  anular: Ban,
  // S01f · Las pestañas de cada producto (cabecera de pestañas, 14 px).
  asientos: NotebookPen,
  listados: LibraryBig,
  definiciones: SlidersHorizontal,
  cierre: Lock,
  importar: Upload,
  facturas: FileText,
  presupuestos: FileSignature,
  recurrentes: Repeat,
  rectificativas: FileMinus,
  cobros: HandCoins,
  catalogo: Package,
  plantillas: LayoutTemplate,
  pagos: CreditCard,
  liquidaciones: Calculator,
  movimientos: ArrowLeftRight,
  reglas: Workflow,
  cuentasBanco: Wallet,
  cierreMes: CalendarCheck,
  tusClientes: Users,
  trimestre: CalendarRange,
  presentados: FileCheck,
  certificados: BadgeCheck,
  clientes: UserRound,
  proveedores: Truck,
  plataformas: Store,
  socios: Handshake,
  usuarios: Users,
  // Comunes.
  nuevo: Plus,
  cerrar: X,
  anterior: ArrowLeft,
  siguiente: ArrowRight,
  intro: CornerDownLeft,
  desplegar: ChevronDown,
  plegar: ChevronUp,
  ok: Check,
  aviso: TriangleAlert,
  info: Info,
  documento: File,
  correo: Mail,
  subir: Upload,
  descargar: Download,
  imprimir: Printer,
  abrirAparte: ExternalLink,
  menu: Menu,
  barraPlegar: PanelLeftClose,
  barraDesplegar: PanelLeftOpen,
  fecha: Calendar,
  graficas: ChartColumn,
  ia: Sparkles,
  // S02 · El patrón único.
  despacho: Briefcase,
  ayuda: CircleQuestionMark,
  izquierda: ChevronLeft,
  derecha: ChevronRight,
  plegarDocumento: ChevronsRight,
  desplegarDocumento: ChevronsLeft,
  pantallaCompleta: Maximize2,
  salirPantallaCompleta: Minimize2,
  acercar: ZoomIn,
  alejar: ZoomOut,
  masAcciones: Ellipsis,
  // S01f · «Cerrar sesión».
  salir: LogOut,
} as const satisfies Record<string, LucideIcon>

export type NombreIcono = keyof typeof ICONOS

/** Tamaño y trazo fijos: los de diseno/tokens.css (--s-icono, --s-icono-trazo). */
export const TAM_ICONO = 16
/** S01f · Los de las pestañas de la cabecera: 14 px, con el mismo trazo. */
export const TAM_ICONO_PESTANA = 14
export const TRAZO_ICONO = 1.75
