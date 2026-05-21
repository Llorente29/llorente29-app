// src/shell/home/HomeGeneral.tsx
//
// Home general transversal del Shell (Bloque G-5, Sprint 3).
// Primera pantalla tras login (aterrizaje). Da la foto del negocio HOY
// cruzando los módulos: 4 métricas transversales + 3 tarjetas-resumen de
// módulo. Responde a "¿cómo va mi negocio hoy?".
//
// ARQUITECTURA (decisión Sesión 14): el Home es FIJO en V1 pero se compone de
// WIDGETS independientes (MetricCard, ModuleSummaryCard) en orden fijo. Esto
// deja preparada la configurabilidad por usuario (drag&drop + persistencia)
// para V1.1/V2 sin reescribir los widgets: solo habrá que envolver este orden
// fijo en un sistema de orden persistente.
//
// DATOS (G-5): MOCK. Las métricas y resúmenes son valores de ejemplo. La
// conexión a datos reales se hará módulo a módulo en fases posteriores,
// pasando los valores reales por las props de cada widget (la estructura ya
// lo permite). Lo ÚNICO real en G-5 es el nombre del usuario en el saludo
// (si se le pasa por prop).
//
// NAVEGACIÓN: onOpenModule cambia la pestaña activa del Shell (se pasa desde
// Shell.tsx). El render del contenido del módulo es G-6.

import { Banknote, Users, Inbox, Leaf, BarChart3 } from 'lucide-react'

import MetricCard from './widgets/MetricCard'
import ModuleSummaryCard from './widgets/ModuleSummaryCard'

const INK = '#1E3A5F'
const MUTED = '#8A8780'

interface HomeGeneralProps {
  // Nombre del usuario para el saludo. Si no se pasa (o el perfil no tiene
  // displayName), saludo genérico. Conectado al userProfile.displayName real
  // desde Shell.tsx (G-5).
  userName?: string
  // Navega a un módulo por su id (cambia pestaña activa del Shell).
  onOpenModule?: (moduleId: string) => void
}

// Saludo según la hora del día.
function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'Buenas noches'
  if (h < 14) return 'Buenos días'
  if (h < 21) return 'Buenas tardes'
  return 'Buenas noches'
}

// Fecha legible en español (ej. "martes 21 de mayo").
function todayLabel(): string {
  return new Date().toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
}

export default function HomeGeneral({ userName, onOpenModule }: HomeGeneralProps) {
  const saludo = userName ? `${greeting()}, ${userName}` : greeting()

  return (
    <div>
      {/* Saludo */}
      <h1
        style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, color: INK, margin: '0 0 2px', fontWeight: 500 }}
      >
        {saludo}
      </h1>
      <p style={{ fontSize: 13, color: MUTED, margin: '0 0 22px' }}>
        Resumen de tu negocio · {todayLabel()}
      </p>

      {/* 4 métricas transversales (MOCK) */}
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}
      >
        <MetricCard label="Ventas hoy" value="3.840 €" icon={Banknote} subtitle="+12% vs ayer" subtitleTone="positive" />
        <MetricCard label="Trabajando ahora" value="12" icon={Users} subtitle="en 3 locales" />
        <MetricCard label="Solicitudes" value="3" icon={Inbox} subtitle="requieren tu atención" subtitleTone="attention" accent />
        <MetricCard label="APPCC hoy" value="8/8" icon={Leaf} subtitle="controles al día" subtitleTone="positive" />
      </div>

      {/* 3 tarjetas-resumen por módulo (MOCK) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <ModuleSummaryCard
          title="Team"
          icon={Users}
          onOpen={() => onOpenModule?.('personal')}
          lines={[
            { text: '2 vacaciones por aprobar' },
            { text: '1 cambio de turno' },
            { text: 'Próximo turno: 16:00', muted: true },
          ]}
        />
        <ModuleSummaryCard
          title="Safety"
          icon={Leaf}
          onOpen={() => onOpenModule?.('appcc')}
          lines={[
            { text: 'Última auditoría: 94/100' },
            { text: '0 incidencias abiertas' },
            { text: 'Próximo control: 18:00', muted: true },
          ]}
        />
        <ModuleSummaryCard
          title="Sales"
          icon={BarChart3}
          onOpen={() => onOpenModule?.('ventas')}
          lines={[
            { text: 'Ticket medio: 18,40 €' },
            { text: '142 pedidos hoy' },
            { text: 'Mejor local: Pza Castilla', muted: true },
          ]}
        />
      </div>
    </div>
  )
}
