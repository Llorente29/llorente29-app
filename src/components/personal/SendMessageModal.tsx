// src/components/personal/SendMessageModal.tsx
//
// B.7 — Modal "Enviar mensaje a [empleado]".
//
// Permite a un manager (gated por canManageEmployees en el caller) enviar un
// mensaje a UN empleado por ambos canales (in-app + email). El envío pasa por
// el dispatcher (dispatcherService.dispatch), que orquesta:
//   - in_app: notificación en la campana del empleado.
//   - email:  vía accountEmailService -> Edge Function account-email.
//
// Decisiones de UX (sesión 25/05):
//   - 1 destinatario (no multi-selección): coherente con el patrón de StaffPage,
//     donde las acciones individuales viven en el modal de detalle.
//   - Ambos canales por defecto, SIN selector: el manager escribe, el sistema
//     decide los medios. Un empleado sin email recibe solo in-app sin error.
//   - Errores con mensaje claro por tipo, no un genérico. El feedback usa los
//     conteos reales del dispatcher.
//
// best-effort: dispatch() nunca lanza; el resultado se interpreta para el feedback.
//
// NOTA sobre Employee.email: el tipo lo declara `string` (no nullable), pero en
// producción puede ser cadena vacía. Se trata como "sin email" con email.trim().

import { useState } from 'react'
import { Modal, Input, Textarea, Button, Label, Alert } from '../ui'
import { Mail } from 'lucide-react'
import type { Employee } from '../../types'
import { dispatch } from '../../services/dispatcherService'

interface SendMessageModalProps {
  employee: Employee
  accountId: string
  senderEmployeeId: string | null
  senderName: string | null
  onClose: () => void
}

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; summary: string }
  | { phase: 'error'; message: string }

const TITLE_MAX = 200
const BODY_MAX = 5000

export default function SendMessageModal({
  employee,
  accountId,
  senderEmployeeId,
  senderName,
  onClose,
}: SendMessageModalProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [state, setState] = useState<SendState>({ phase: 'idle' })

  const hasEmail = employee.email.trim() !== ''

  const canSend =
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    state.phase !== 'sending' &&
    state.phase !== 'sent'

  async function handleSend() {
    if (!canSend) return
    setState({ phase: 'sending' })

    const result = await dispatch(
      {
        accountId,
        kind: 'account_message',
        title: title.trim(),
        body: body.trim(),
        senderEmployeeId,
        // senderName solo si lo tenemos; el dispatcher lo pasa al email.
        ...(senderName ? { extra: { senderName } } : {}),
      },
      [{ employeeId: employee.id, email: hasEmail ? employee.email : null }],
      ['in_app', 'email'],
    )

    // Interpretación honesta de los conteos reales del dispatcher.
    const inAppOk = result.inApp.delivered > 0
    const emailSent = result.email.delivered > 0
    const emailFailed = result.email.failed > 0
    const emailSkipped = result.email.skipped > 0

    // Caso 1: nada salió por ningún canal -> error.
    if (!inAppOk && !emailSent) {
      if (emailFailed) {
        setState({
          phase: 'error',
          message:
            'No se pudo enviar el mensaje. Puede que hayas alcanzado el límite de ' +
            'envíos o que no tengas permiso en esta cuenta. Inténtalo más tarde.',
        })
      } else {
        setState({
          phase: 'error',
          message: 'No se pudo enviar el mensaje. Inténtalo de nuevo.',
        })
      }
      return
    }

    // Caso 2: algo salió. Construir resumen honesto.
    const parts: string[] = []
    if (inAppOk) parts.push('notificación enviada en la app')
    if (emailSent) parts.push('email enviado')
    let summary = parts.join(' y ') + '.'
    summary = summary.charAt(0).toUpperCase() + summary.slice(1)

    if (emailFailed && inAppOk) {
      summary += ' El email no pudo entregarse, pero el empleado verá el aviso en la app.'
    } else if (emailSkipped && inAppOk && !emailSent) {
      summary += ' (Sin email registrado: solo se envió la notificación en la app.)'
    }

    setState({ phase: 'sent', summary })
    // Cierre automático tras una breve confirmación visual.
    setTimeout(onClose, 2000)
  }

  const inputsDisabled = state.phase === 'sending' || state.phase === 'sent'

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Enviar mensaje a ${employee.name}`}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {hasEmail ? (
          <p className="text-xs text-text-secondary">
            Se enviará como notificación en la app y por email a{' '}
            <strong>{employee.email}</strong>.
          </p>
        ) : (
          <p className="text-xs text-text-secondary">
            Este empleado no tiene email registrado: se enviará solo como
            notificación en la app.
          </p>
        )}

        <div>
          <Label>Asunto</Label>
          <Input
            value={title}
            maxLength={TITLE_MAX}
            placeholder="Ej. Cambio de turno del viernes"
            onChange={(e) => setTitle(e.target.value)}
            disabled={inputsDisabled}
          />
        </div>

        <div>
          <Label>Mensaje</Label>
          <Textarea
            value={body}
            maxLength={BODY_MAX}
            rows={6}
            placeholder="Escribe el mensaje para el empleado…"
            onChange={(e) => setBody(e.target.value)}
            disabled={inputsDisabled}
          />
          <p className="text-xs text-text-secondary mt-1">
            {body.length}/{BODY_MAX}
          </p>
        </div>

        {state.phase === 'error' && <Alert type="error">{state.message}</Alert>}
        {state.phase === 'sent' && <Alert type="success">{state.summary}</Alert>}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-default">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={state.phase === 'sending'}
          >
            {state.phase === 'sent' ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSend}
            disabled={!canSend}
          >
            <Mail size={14} /> {state.phase === 'sending' ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
