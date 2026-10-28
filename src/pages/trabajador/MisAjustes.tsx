// src/pages/trabajador/MisAjustes.tsx
// ENCARGO CODE — Ajustes personales del empleado en su portal. Por ahora, un
// único ajuste: opt-out del recordatorio de olvido de fichaje de salida
// (desconexión digital — art. 88 LOPDGDD — es ayuda consentida, con derecho
// a renuncia).
// L1a · PR 1 (27/10/2026): y el texto de qué se guarda al fichar, para qué y
// cuánto tiempo (src/lib/registroDeJornadaTexto.ts).

import { useState } from 'react'
import { ArrowLeft, BellRing, ShieldCheck, ChevronDown } from 'lucide-react'
import { Card } from '../../components/ui'
import type { Employee } from '../../types'
import { setMyReminderPref } from '../../services/employeeSelfService'
import { APARTADOS_REGISTRO_DE_JORNADA, TITULO_REGISTRO_DE_JORNADA } from '../../lib/registroDeJornadaTexto'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function MisAjustes({ employee, onBack }: Props) {
  const [enabled, setEnabled] = useState(employee.forgotClockoutReminder ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [textoAbierto, setTextoAbierto] = useState(false)

  async function toggle() {
    const next = !enabled
    setEnabled(next)
    setSaving(true)
    setError('')
    try {
      await setMyReminderPref(next)
    } catch (err) {
      setEnabled(!next)
      setError(err instanceof Error ? err.message : 'No se pudo guardar el cambio')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-page p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="text-xs text-text-secondary uppercase tracking-wide">Mis ajustes</p>
            <p className="font-bold text-text-primary">{employee.name.split(' ')[0]}</p>
          </div>
        </div>

        {error && <p className="text-sm text-danger mb-3">{error}</p>}

        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-accent-bg flex items-center justify-center shrink-0">
                <BellRing size={18} className="text-accent" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-text-primary">Recordarme si olvido fichar mi salida</p>
                <p className="text-xs text-text-secondary mt-1">
                  Si un día olvidas fichar tu salida, te avisamos por WhatsApp. Puedes desactivarlo cuando
                  quieras; entonces será tu responsabilidad recordarlo.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Recordarme si olvido fichar mi salida"
              disabled={saving}
              onClick={toggle}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-base ${
                enabled ? 'bg-accent' : 'bg-border-strong'
              } ${saving ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-base ${
                  enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </Card>

        <div className="mt-3" data-prueba="que-se-guarda">
        <Card className="p-4">
          <button
            type="button"
            onClick={() => setTextoAbierto(a => !a)}
            aria-expanded={textoAbierto}
            className="w-full flex items-start gap-3 text-left"
          >
            <div className="w-9 h-9 rounded-full bg-accent-bg flex items-center justify-center shrink-0">
              <ShieldCheck size={18} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-text-primary">{TITULO_REGISTRO_DE_JORNADA}</p>
              <p className="text-xs text-text-secondary mt-1">
                La ubicación solo al fichar, tres meses. El registro, cuatro años.
              </p>
            </div>
            <ChevronDown size={18} className={`text-text-secondary shrink-0 mt-2 transition-base ${textoAbierto ? 'rotate-180' : ''}`} />
          </button>
          {textoAbierto && (
            <div className="mt-4 space-y-4 border-t border-border-default pt-4">
              {APARTADOS_REGISTRO_DE_JORNADA.map(a => (
                <section key={a.titulo}>
                  <h3 className="text-sm font-semibold text-text-primary mb-1">{a.titulo}</h3>
                  {a.parrafos.map((p, i) => (
                    <p key={i} className="text-sm text-text-secondary mb-1.5">{p}</p>
                  ))}
                </section>
              ))}
            </div>
          )}
        </Card>
        </div>
      </div>
    </div>
  )
}
