// src/modules/conta/laboral/LaboralPage.tsx
//
// LS1 (28/10/2026) · Laboral dentro de Sumied. Cada página es la misma
// pantalla de Folvy › Personal, con el mismo nombre en la dirección
// (`laboral/control-horario`, como `personal/control-horario`): así los
// enlaces que las pantallas llevan dentro siguen funcionando. Todas van
// envueltas en el contexto de Sumied: «centro» en vez de «local» y nada de
// hostelería. Folvy no cambia: allí no hay contexto y todo es como siempre.
//
// Las pantallas grandes se cargan cuando se abren (lazy): Sumied no carga el
// cuadrante ni la formación hasta que alguien entra.

import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { CONTA, rutaConta } from '@/config/navegacion'
import { SUMIED, conProductoLaboral } from '@/modules/personal/laboral/productoLaboral'
import '@/modules/personal/laboral/estilo'

type Pantalla = LazyExoticComponent<ComponentType>

/** Las pantallas de Personal que entran tal cual, por el nombre de su dirección. */
const PANTALLAS: Record<string, Pantalla> = {
  '': lazy(() => import('@/pages/StaffPage')),
  'ahora-mismo': lazy(() => import('@/pages/AhoraMismoPage')),
  'para-revisar': lazy(() => import('./ParaRevisarPage')),
  'control-horario': lazy(() => import('@/pages/FichajesGlobalPage')),
  'registro-jornada': lazy(() => import('@/modules/personal/laboral/RegistroJornadaPage')),
  'bolsa-horas': lazy(() => import('@/pages/BolsaHorasPage')),
  'recordatorios-fichaje': lazy(() => import('@/pages/ClockoutReminderReportPage')),
  kiosko: lazy(() => import('@/pages/KioskoFichajePage')),
  calendario: lazy(() => import('@/pages/CalendarioPage')),
  'plantilla-turnos': lazy(() => import('@/pages/PlantillaTurnosPage')),
  disponibilidad: lazy(() => import('@/pages/DisponibilidadPage')),
  'turnos-abiertos': lazy(() => import('@/pages/TurnosAbiertosPage')),
  cambios: lazy(() => import('@/pages/CambiosPendientesPage')),
  plantilla: lazy(() => import('@/pages/PlantillaPage')),
  solicitudes: lazy(() => import('@/pages/SolicitudesPendientesPage')),
  formacion: lazy(() => import('@/pages/CoursesPage')),
  nominas: lazy(() => import('@/pages/NominasPage')),
  centros: lazy(() => import('./CentrosPage')),
  portal: lazy(() => import('./PortalEmpleadoPage')),
}

function Cargando() {
  return <p className="s-apoyo" role="status" style={{ padding: 'var(--s-6)' }}>Cargando…</p>
}

export default function LaboralPage() {
  const { pagina = '' } = useParams<{ pagina?: string }>()
  const Pantalla = PANTALLAS[pagina]
  if (!Pantalla) return <Navigate to={rutaConta(CONTA.rutas.laboral)} replace />
  return conProductoLaboral(SUMIED, (
    <div className="s-laboral" data-laboral-pagina={pagina || 'equipo'}>
      <Suspense fallback={<Cargando />}>
        <Pantalla />
      </Suspense>
    </div>
  ))
}
