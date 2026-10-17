// src/modules/conta/diseno/iconos.ts
//
// S01 · El catálogo de iconos del sistema (lucide-react), por nombre. El
// componente que los pinta es Icono.tsx; aquí solo el catálogo, para que lo
// lean también la paleta y la cinta sin cargar componentes.

import {
  ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, Ban, Bell, BookOpen, Building2, Calendar, ChartColumn, Check,
  ChevronDown, ChevronUp, Contact, Copy, CornerDownLeft, Download, Equal, Euro, File, FileText, House, Info, Landmark,
  ListChecks, Mail, Menu, PanelLeftClose, PanelLeftOpen, Percent, Pin, PinOff, Plus, Receipt, Scale, ScanLine, Search,
  Settings, Sparkles, Star, TriangleAlert, Upload, Users, X, type LucideIcon,
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
  menu: Menu,
  barraPlegar: PanelLeftClose,
  barraDesplegar: PanelLeftOpen,
  fecha: Calendar,
  graficas: ChartColumn,
  ia: Sparkles,
} as const satisfies Record<string, LucideIcon>

export type NombreIcono = keyof typeof ICONOS

/** Tamaño y trazo fijos: los de diseno/tokens.css (--s-icono, --s-icono-trazo). */
export const TAM_ICONO = 16
export const TRAZO_ICONO = 1.75
