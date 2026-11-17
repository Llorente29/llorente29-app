// src/modules/conta/nucleo/iconos.ts
//
// K02 · Los iconos del marco del núcleo (maqueta aprobada el 16/11), por
// nombre. Son los de lucide-react, como los del sistema de diseño, pero los
// del marco del núcleo son otros dibujos (los de la maqueta: la calculadora de
// Contabilidad, el maletín de Despacho…), así que viven aquí y no en
// diseno/iconos.ts, que es lo común. Núcleo puro: solo el catálogo.

import {
  BadgeCheck, BookOpen, BriefcaseBusiness, Building2, Calculator, Calendar, ChartColumn, CircleCheck, Clock, FileDown, FileSpreadsheet,
  FileText, FileUp, FolderInput, HandCoins, Handshake, Inbox, Landmark, Layers, ListChecks, Lock, LockOpen, Mail, Network, Palette,
  Percent, ReceiptText, Scale, ScrollText, Search, Store, Table, Truck, Upload, UserRound, Users, Wallet, Wrench,
} from 'lucide-react'

export const ICONOS_NUCLEO = {
  // Los módulos de la izquierda.
  contabilidad: Calculator,
  facturacion: ReceiptText,
  impuestos: Percent,
  personal: UserRound,
  despacho: BriefcaseBusiness,
  // Los botones de la cinta.
  asientos: FileText,
  emitidas: FileUp,
  ventasDia: ChartColumn,
  recibidas: FileDown,
  bancos: Landmark,
  hecho: CircleCheck,
  cierre: Lock,
  apertura: LockOpen,
  empresa: Building2,
  ejercicio: Calendar,
  plan: BookOpen,
  tablas: Table,
  analitica: Network,
  terceros: Users,
  clientes: Handshake,
  proveedores: Truck,
  plataformas: Store,
  documentos: Inbox,
  esperas: Mail,
  extracto: Upload,
  diez: FolderInput,
  diario: ScrollText,
  mayor: BookOpen,
  sumas: Scale,
  acumulados: Layers,
  estados: FileSpreadsheet,
  iva: Percent,
  retenciones: ReceiptText,
  aeat: FileSpreadsheet,
  anuales: BadgeCheck,
  buscar: Search,
  cobros: HandCoins,
  pagos: Wallet,
  liquidaciones: ListChecks,
  mirar: ListChecks,
  calendario: Calendar,
  trimestre: Percent,
  presentados: BadgeCheck,
  certificados: BadgeCheck,
  tiempo: Clock,
  personas: Users,
  utilidades: Wrench,
  diseno: Palette,
} as const

export type IconoNucleo = keyof typeof ICONOS_NUCLEO
