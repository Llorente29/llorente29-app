// src/admin/pages/AdminHomePage.tsx
//
// Home del portal de staff Folvy (plano de control interno). Sesión 16.
//
// Punto de entrada del panel /_admin. Presenta las secciones del portal como
// tarjetas. Activas: Cuentas, Auditoría. El resto son huecos preparados
// (deshabilitados) que marcan el rumbo del portal interno.

import { useNavigate } from 'react-router-dom'

interface Section {
  key: string
  title: string
  description: string
  to: string | null      // null = próximamente (deshabilitada)
}

const SECTIONS: Section[] = [
  {
    key: 'cuentas',
    title: 'Cuentas',
    description: 'Alta, listado, ficha, estado y módulos de los clientes de Folvy.',
    to: '/_admin/cuentas',
  },
  {
    key: 'auditoria',
    title: 'Auditoría',
    description: 'Registro inmutable de acciones administrativas y eventos de seguridad.',
    to: '/_admin/auditoria',
  },
  {
    key: 'staff',
    title: 'Staff',
    description: 'Gestión de administradores de plataforma y sus permisos.',
    to: '/_admin/staff',
  },
  {
    key: 'metricas',
    title: 'Métricas',
    description: 'Indicadores de la plataforma: clientes activos, uso, crecimiento.',
    to: null,
  },
  {
    key: 'impersonation',
    title: 'Impersonation',
    description: 'Acceder a la app de un cliente para dar soporte (ver como él).',
    to: null,
  },
]

export default function AdminHomePage() {
  const navigate = useNavigate()

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-display font-medium mb-1" style={{ color: 'var(--color-accent)' }}>
        Portal de staff
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary, #666)' }}>
        Gestión interna de la plataforma Folvy.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {SECTIONS.map(s => {
          const enabled = s.to !== null
          return (
            <button
              key={s.key}
              type="button"
              disabled={!enabled}
              onClick={() => enabled && navigate(s.to!)}
              className="text-left rounded-lg p-5 transition-shadow"
              style={{
                background: 'var(--color-bg-surface, #fff)',
                border: '1px solid var(--color-border, #e5e5e5)',
                cursor: enabled ? 'pointer' : 'default',
                opacity: enabled ? 1 : 0.55,
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base font-display font-medium" style={{ color: 'var(--color-accent)' }}>
                  {s.title}
                </span>
                {!enabled && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ background: '#ECECEC', color: '#888' }}
                  >
                    próximamente
                  </span>
                )}
              </div>
              <p className="text-sm" style={{ color: 'var(--color-text-secondary, #666)' }}>
                {s.description}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
