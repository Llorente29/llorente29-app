// src/admin/pages/NuevaCuentaPage.tsx
//
// Página de alta de cuenta cliente (Modalidad 3) — panel superadmin. Sesión 15.
//
// Formulario que recoge los datos de la cuenta nueva, su primer admin, el local
// y marca iniciales, y los submódulos a activar. Al enviar, llama a
// accountsAdminService.createAccount(), que invoca la Edge Function create-account
// (alta atómica: cuenta + auth.user + perfil + permisos + local + marca +
// suscripción + items + audit).
//
// CATÁLOGO DE SUBMÓDULOS: hardcodeado de la BBDD (consultado Sesión 15). Los ids
// son los reales de la tabla `submodules`. NOTA: esto debería cargarse dinámicamente
// de BBDD en una iteración futura (deuda apuntada); por ahora estático para no
// añadir una query más y porque el catálogo cambia rara vez.
//
// v1: contraseña temporal manual (sin welcome email; depende de SMTP pendiente).

import { useState } from 'react'
import { createAccount, type CreateAccountPayload } from '@/platform/accountsAdminService'

// ─── Catálogo de submódulos (ids reales de BBDD, Sesión 15) ────────────────
interface SubmoduleOption {
  id: string
  label: string
}
interface ModuleGroup {
  module: string
  submodules: SubmoduleOption[]
}

const SUBMODULE_CATALOG: ModuleGroup[] = [
  {
    module: 'Personal (Folvy Team)',
    submodules: [
      { id: 'd20f0030-0ee3-457d-ba37-1e5441e51b4a', label: 'Personal Esencial' },
      { id: '4d65c713-4cf6-4e96-875b-9535406aaac7', label: 'Personal Pro' },
      { id: 'ff971854-3844-4473-8187-6975fb11401c', label: 'Personal Multi-local' },
      { id: 'a91e1ec4-3e59-4a53-a0da-49716033bacf', label: 'Add-on Informes Gestoría' },
      { id: 'cc0893a0-3743-4c70-ba2c-0539e839759e', label: 'Add-on Predicción de personal' },
    ],
  },
  {
    module: 'APPCC (Folvy Safety)',
    submodules: [
      { id: '57fb501d-d7be-4f39-a5c9-e1b0aed6cd34', label: 'APPCC Esencial' },
      { id: 'd91832d1-2edc-451f-bbe3-2a9c095cc3ff', label: 'APPCC Pro' },
      { id: '96a06c80-2b6d-422e-956c-334af977875f', label: 'APPCC Multi-local' },
      { id: 'cbb672f4-5534-4dd0-8e97-6753ad35e240', label: 'Add-on Asistente IA Plan APPCC' },
      { id: '58e2e21d-d670-41ad-8c69-03a98f680b04', label: 'Add-on Sensores IoT' },
    ],
  },
  {
    module: 'Ventas (Folvy Sales)',
    submodules: [
      { id: 'b580a418-a644-46a1-a39f-a377906546ae', label: 'Ventas Esencial' },
      { id: '02f54945-7cdc-4c90-b776-c0279e03388f', label: 'Ventas Pro' },
      { id: 'e20b48f9-d1cb-45c1-8fac-4a931fd9f8ae', label: 'Ventas Multi-local' },
      { id: 'ccb792c2-130d-43f9-a07a-11923b6f4a4d', label: 'Add-on Predicción de ventas' },
    ],
  },
  {
    module: 'Operaciones',
    submodules: [
      { id: '66313e70-44fb-4c12-aa7d-e66683ed5956', label: 'Stock Esencial' },
      { id: 'c3e49302-53f8-487c-87c9-b71713a67b4f', label: 'Stock Pro' },
      { id: '560745a7-5e9f-4e01-9e15-005baa354015', label: 'Stock Multi-local' },
      { id: '0ebe62f3-ab39-4b08-840c-66a17e746cc2', label: 'Add-on Sugerencias IA' },
      { id: '4f272290-ae53-454f-ba7e-65e17fc535a7', label: 'Add-on Import tSpoonLab' },
    ],
  },
]

// ─── Estado del formulario ─────────────────────────────────────────────────
interface FormState {
  accountName: string
  accountSlug: string
  adminEmail: string
  adminPassword: string
  adminDisplayName: string
  locationName: string
  brandName: string
  brandSlug: string
  status: 'active' | 'trialing'
}

const EMPTY_FORM: FormState = {
  accountName: '',
  accountSlug: '',
  adminEmail: '',
  adminPassword: '',
  adminDisplayName: '',
  locationName: '',
  brandName: '',
  brandSlug: '',
  status: 'active',
}

type Submitting = { state: 'idle' } | { state: 'sending' } | { state: 'done'; accountId: string; slug: string } | { state: 'error'; message: string; detail?: string }

export default function NuevaCuentaPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [selectedSubmodules, setSelectedSubmodules] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState<Submitting>({ state: 'idle' })

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function toggleSubmodule(id: string) {
    setSelectedSubmodules(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Validación mínima cliente (la Edge Function valida de nuevo server-side).
  function validate(): string | null {
    if (!form.accountName.trim()) return 'El nombre de la cuenta es obligatorio.'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.accountSlug)) return 'El slug debe ser minúsculas, números y guiones (ej. "llorente29").'
    if (!form.adminEmail.includes('@')) return 'El email del admin no es válido.'
    if (form.adminPassword.length < 8) return 'La contraseña temporal debe tener al menos 8 caracteres.'
    if (!form.adminDisplayName.trim()) return 'El nombre del admin es obligatorio.'
    if (!form.locationName.trim()) return 'El nombre del local es obligatorio.'
    if (!form.brandName.trim()) return 'El nombre de la marca es obligatorio.'
    if (!/^[a-z0-9][a-z0-9-]*$/.test(form.brandSlug)) return 'El slug de la marca debe ser minúsculas, números y guiones.'
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
      adminPassword: form.adminPassword,
      adminDisplayName: form.adminDisplayName.trim(),
      locationName: form.locationName.trim(),
      brandName: form.brandName.trim(),
      brandSlug: form.brandSlug.trim(),
      submoduleIds: Array.from(selectedSubmodules),
      planId: null,
      status: form.status,
    }

    const result = await createAccount(payload)

    if (result.ok) {
      setSubmitting({ state: 'done', accountId: result.data.account_id, slug: result.data.slug })
    } else {
      setSubmitting({ state: 'error', message: result.error, detail: result.detail })
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setSelectedSubmodules(new Set())
    setSubmitting({ state: 'idle' })
  }

  // ─── Pantalla de éxito ────────────────────────────────────────────────────
  if (submitting.state === 'done') {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-display font-medium mb-4" style={{ color: 'var(--color-accent)' }}>
          Cuenta creada
        </h1>
        <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--color-bg-surface, #fff)', border: '1px solid var(--color-border, #e5e5e5)' }}>
          <p className="text-sm mb-1"><strong>Slug:</strong> {submitting.slug}</p>
          <p className="text-sm"><strong>Account ID:</strong> {submitting.accountId}</p>
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

  // ─── Formulario ─────────────────────────────────────────────────────────
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
        <Field label="Contraseña temporal" value={form.adminPassword} onChange={v => update('adminPassword', v)} placeholder="mín. 8 caracteres" type="text" />
        <Field label="Nombre del admin" value={form.adminDisplayName} onChange={v => update('adminDisplayName', v)} placeholder="Pamela García" />
        <Field label="Nombre del local inicial" value={form.locationName} onChange={v => update('locationName', v)} placeholder="Local Alcalá" />
        <Field label="Nombre de la marca" value={form.brandName} onChange={v => update('brandName', v)} placeholder="Llorente 29" />
        <Field label="Slug de la marca" value={form.brandSlug} onChange={v => update('brandSlug', v.toLowerCase())} placeholder="llorente29" />
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>
          Estado de la cuenta
        </label>
        <select
          value={form.status}
          onChange={e => update('status', e.target.value as 'active' | 'trialing')}
          className="w-full md:w-64 px-3 py-2 rounded-md text-sm"
          style={{ border: '1px solid var(--color-border, #ccc)' }}
        >
          <option value="active">Activa (cliente firmado)</option>
          <option value="trialing">Trial</option>
        </select>
      </div>

      <div className="mb-8">
        <h2 className="text-base font-display font-medium mb-3" style={{ color: 'var(--color-accent)' }}>
          Módulos a activar
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary, #666)' }}>
          Marca los submódulos que tendrá esta cuenta. Para Llorente29 (V1): Personal, APPCC y Ventas.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SUBMODULE_CATALOG.map(group => (
            <div key={group.module} className="rounded-lg p-4" style={{ border: '1px solid var(--color-border, #e5e5e5)' }}>
              <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary, #1a1a1a)' }}>{group.module}</p>
              <div className="flex flex-col gap-2">
                {group.submodules.map(sm => (
                  <label key={sm.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedSubmodules.has(sm.id)}
                      onChange={() => toggleSubmodule(sm.id)}
                    />
                    <span style={{ color: 'var(--color-text-secondary, #444)' }}>{sm.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
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
          {selectedSubmodules.size} submódulo(s) seleccionado(s)
        </span>
      </div>
    </div>
  )
}

// ─── Campo de texto reutilizable ───────────────────────────────────────────
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
