// src/admin/pages/NuevaCuentaPage.tsx
//
// Página de alta de cuenta cliente (Modalidad 3) — panel superadmin.
//
// VÍA ÚNICA (Ses 17/06): el alta elige un PLAN, no submódulos sueltos. El flujo
// es formulario(plan) -> createAccount -> Edge create-account -> create_account_tx
// -> onboard_account, que deja el cliente COMPLETO y atómico: suscripción+items
// del plan, kitchen_settings, canales (Salón/Glovo/JustEat/Uber/Shop), familias
// de plato, e ingredientes del master con sus alérgenos. No hay otra vía de alta.
//
// El catálogo de submódulos hardcodeado (deuda apuntada) se ELIMINA: lo que un
// cliente puede usar lo define el plan (editable en BBDD). Subir/bajar de plan
// después no borra datos (solo cambia accesos).
//
// ONBOARDING (welcome única vía): el admin recibe email para crear su contraseña.

import { useState } from 'react'
import { createAccount, type CreateAccountPayload } from '@/platform/accountsAdminService'

// ─── Planes (ids reales de billing_plans) ────────────────────────────────────
interface PlanOption {
  id: string
  code: string
  name: string
  blurb: string
  includes: string
}

const PLANS: PlanOption[] = [
  {
    id: 'a32e052e-adf2-4f09-aafd-79967e14df4f',
    code: 'starter',
    name: 'Starter',
    blurb: '1 local · prueba 14 días',
    includes: 'APPCC, Personal y TPV (esencial).',
  },
  {
    id: '4a39bb67-e03e-4fb3-ad4f-5eb13fe438ee',
    code: 'professional',
    name: 'Professional',
    blurb: 'Hasta 5 locales · prueba 14 días',
    includes: 'APPCC (Pro), Personal (Pro), Ventas, Operaciones, Delivery y TPV + KDS.',
  },
  {
    id: '50d85e56-5c61-4a87-9816-b3be83feb556',
    code: 'enterprise',
    name: 'Enterprise',
    blurb: 'Locales ilimitados · prueba 14 días',
    includes: 'Todos los módulos construidos en todos sus niveles (multi-local incluido).',
  },
]

// ─── Estado del formulario ───────────────────────────────────────────────────
interface FormState {
  accountName: string
  accountSlug: string
  adminEmail: string
  adminDisplayName: string
  locationName: string
  brandName: string
  brandSlug: string
  status: 'active' | 'trial'
  planId: string
}

const EMPTY_FORM: FormState = {
  accountName: '',
  accountSlug: '',
  adminEmail: '',
  adminDisplayName: '',
  locationName: '',
  brandName: '',
  brandSlug: '',
  status: 'active',
  planId: '4a39bb67-e03e-4fb3-ad4f-5eb13fe438ee', // professional por defecto
}

type Submitting =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'done'; accountId: string; slug: string; welcomeSent: boolean }
  | { state: 'error'; message: string; detail?: string }

export default function NuevaCuentaPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState<Submitting>({ state: 'idle' })

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // Validación mínima cliente (la Edge Function valida de nuevo server-side).
  function validate(): string | null {
    if (!form.accountName.trim()) return 'El nombre de la cuenta es obligatorio.'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.accountSlug)) return 'El slug debe ser minúsculas, números y guiones (ej. "llorente29").'
    if (!form.adminEmail.includes('@')) return 'El email del admin no es válido.'
    if (!form.adminDisplayName.trim()) return 'El nombre del admin es obligatorio.'
    if (!form.locationName.trim()) return 'El nombre del local es obligatorio.'
    if (!form.brandName.trim()) return 'El nombre de la marca es obligatorio.'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.brandSlug)) return 'El slug de la marca debe ser minúsculas, números y guiones.'
    if (!form.planId) return 'Selecciona un plan.'
    return null
  }

  async function handleSubmit() {
    const validationError = validate()
    if (validationError) {
      setSubmitting({ state: 'error', message: validationError })
      return
    }

    setSubmitting({ state: 'sending' })

    const payload: CreateAccountPayload = {
      accountName: form.accountName.trim(),
      accountSlug: form.accountSlug.trim(),
      adminEmail: form.adminEmail.trim(),
      adminDisplayName: form.adminDisplayName.trim(),
      locationName: form.locationName.trim(),
      brandName: form.brandName.trim(),
      brandSlug: form.brandSlug.trim(),
      submoduleIds: [],            // el PLAN define los submódulos (no se marcan a mano)
      planId: form.planId,
      status: form.status,
    }

    const result = await createAccount(payload)

    if (result.ok) {
      setSubmitting({
        state: 'done',
        accountId: result.data.account_id,
        slug: result.data.slug,
        welcomeSent: result.data.welcome_sent !== false,
      })
    } else {
      setSubmitting({ state: 'error', message: result.error, detail: result.detail })
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setSubmitting({ state: 'idle' })
  }

  // ─── Pantalla de éxito ───────────────────────────────────────────────────────
  if (submitting.state === 'done') {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-display font-medium mb-4" style={{ color: 'var(--color-accent)' }}>
          Cuenta creada
        </h1>
        <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--color-bg-surface, #fff)', border: '1px solid var(--color-border, #e5e5e5)' }}>
          <p className="text-sm mb-1"><strong>Slug:</strong> {submitting.slug}</p>
          <p className="text-sm mb-3"><strong>Account ID:</strong> {submitting.accountId}</p>
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary, #555)' }}>
            La cuenta nace completa: módulos del plan, canales, familias e ingredientes del catálogo con sus alérgenos.
          </p>
          {submitting.welcomeSent ? (
            <p className="text-sm" style={{ color: '#2F6B2F' }}>
              ✓ Email de bienvenida enviado al admin. El cliente establecerá su contraseña desde el enlace.
            </p>
          ) : (
            <p className="text-sm" style={{ color: '#A12626' }}>
              ⚠ La cuenta se creó, pero el email de bienvenida NO se pudo enviar. Reenvíalo manualmente o revisa el log.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={resetForm}
          className="px-4 py-2 rounded-md text-sm font-medium"
          style={{ background: 'var(--color-terracota)', color: '#fff' }}
        >
          Crear otra cuenta
        </button>
      </div>
    )
  }

  const sending = submitting.state === 'sending'

  // ─── Formulario ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-display font-medium mb-6" style={{ color: 'var(--color-accent)' }}>
        Nueva cuenta cliente
      </h1>

      {submitting.state === 'error' && (
        <div className="rounded-lg p-4 mb-6" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }}>
          <p className="text-sm font-medium" style={{ color: '#A12626' }}>{submitting.message}</p>
          {submitting.detail && <p className="text-xs mt-1" style={{ color: '#A12626' }}>{submitting.detail}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Field label="Nombre de la cuenta" value={form.accountName} onChange={v => update('accountName', v)} placeholder="Restaurante Llorente 29" />
        <Field label="Slug (URL)" value={form.accountSlug} onChange={v => update('accountSlug', v.toLowerCase())} placeholder="llorente29" />
        <Field label="Email del admin" value={form.adminEmail} onChange={v => update('adminEmail', v)} placeholder="admin@cliente.com" type="email" />
        <Field label="Nombre del admin" value={form.adminDisplayName} onChange={v => update('adminDisplayName', v)} placeholder="Pamela García" />
        <Field label="Nombre del local inicial" value={form.locationName} onChange={v => update('locationName', v)} placeholder="Local Alcalá" />
        <Field label="Nombre de la marca" value={form.brandName} onChange={v => update('brandName', v)} placeholder="Llorente 29" />
        <Field label="Slug de la marca" value={form.brandSlug} onChange={v => update('brandSlug', v.toLowerCase())} placeholder="llorente29" />
      </div>

      <div className="rounded-lg p-3 mb-6" style={{ background: '#EDF2F7', border: '1px solid #C8D6E5' }}>
        <p className="text-xs" style={{ color: '#2F4261' }}>
          El admin recibirá un email de bienvenida para crear su propia contraseña. No se asigna contraseña temporal.
        </p>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
          Estado de la cuenta
        </label>
        <select
          value={form.status}
          onChange={e => update('status', e.target.value as 'active' | 'trial')}
          className="w-full md:w-64 px-3 py-2 rounded-md text-sm"
          style={{ border: '1px solid var(--color-border, #ccc)' }}
        >
          <option value="active">Activa (cliente firmado)</option>
          <option value="trial">Trial</option>
        </select>
      </div>

      <div className="mb-8">
        <h2 className="text-base font-display font-medium mb-1" style={{ color: 'var(--color-accent)' }}>
          Plan
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary, #666)' }}>
          El plan define los módulos de la cuenta. Se puede subir o bajar después sin perder datos.
        </p>
        <div className="flex flex-col gap-3">
          {PLANS.map(plan => {
            const selected = form.planId === plan.id
            return (
              <label
                key={plan.id}
                className="flex items-start gap-3 rounded-lg p-4 cursor-pointer"
                style={{
                  border: `1px solid ${selected ? 'var(--color-terracota)' : 'var(--color-border, #e5e5e5)'}`,
                  background: selected ? 'rgba(193,102,68,0.06)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="plan"
                  className="mt-1"
                  checked={selected}
                  onChange={() => update('planId', plan.id)}
                />
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
                    {plan.name} <span className="font-normal" style={{ color: 'var(--color-text-secondary, #888)' }}>· {plan.blurb}</span>
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary, #666)' }}>{plan.includes}</p>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={sending}
          className="px-5 py-2.5 rounded-md text-sm font-medium"
          style={{ background: 'var(--color-terracota)', color: '#fff', opacity: sending ? 0.6 : 1 }}
        >
          {sending ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
        <span className="text-xs" style={{ color: 'var(--color-text-secondary, #888)' }}>
          Plan: {PLANS.find(p => p.id === form.planId)?.name ?? '—'}
        </span>
      </div>
    </div>
  )
}

// ─── Campo de texto reutilizable ─────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md text-sm"
        style={{ border: '1px solid var(--color-border, #ccc)' }}
      />
    </div>
  )
}
