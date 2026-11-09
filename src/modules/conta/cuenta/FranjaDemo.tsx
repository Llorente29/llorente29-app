// src/modules/conta/cuenta/FranjaDemo.tsx
//
// GD · La franja de una cuenta de demostración (Julio, nº44): arriba del
// contenido de cada pantalla de Sumied, discreta, ni roja ni ámbar, y también en
// el móvil. Dice lo que es la cuenta: «Cuenta de demostración · datos inventados
// · aquí puedes tocar todo». Solo en las cuentas con accounts.is_demo.

import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'

const TEXTO_FRANJA_DEMO = ['Cuenta de demostración', 'datos inventados', 'aquí puedes tocar todo'] as const

export function FranjaDemo() {
  const { esDemo } = useCuentaConta()
  if (!esDemo) return null
  return (
    <p className="cx-franja-demo" role="note" aria-label="Cuenta de demostración" data-prueba="franja-demo">
      {TEXTO_FRANJA_DEMO.map((t, i) => (
        <span key={t}>{i > 0 && <span aria-hidden="true" className="cx-franja-demo-punto"> · </span>}{t}</span>
      ))}
    </p>
  )
}
