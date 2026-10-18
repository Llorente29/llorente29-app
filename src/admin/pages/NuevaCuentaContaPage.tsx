// src/admin/pages/NuevaCuentaContaPage.tsx
//
// C06 · Contabilidad sola. El alta interna de una cuenta SOLO de contabilidad:
// nombre de la empresa, correo del administrador del cliente, marca y por qué.
// Crea la cuenta sin Cocina (edge function conta-crear-cuenta) y manda la
// invitación con la marca; el cliente entra, pone su contraseña y aterriza en
// el alta conversada de su empresa.
//
// Regla 8: el botón confirma con contenido o falla en pantalla. Si la
// invitación no sale (la marca de pruebas aún no tiene remitente), lo dice con
// su porqué y, fuera de producción, enseña el enlace para probar la entrada.
//
// I01b · El alta de una asesoría invitada por una empresa (Asesorías, en este
// portal) llega aquí rellena (?asesoria=<invitación>&empresa=&correo=&motivo=).
// Creada la cuenta, se vincula a la empresa que la invitó (conta-asesoria,
// «aprobar»), y se dice.

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { MARCAS } from '@/marca/marca'

const MARCAS_SOLAS = Object.values(MARCAS).filter((m) => m.soloContabilidad)

interface Resultado { account_id: string; slug: string; marca: string; invitacion_enviada: boolean; motivo: string | null; enlace: string | null }

type Estado =
  | { que: 'quieto' }
  | { que: 'enviando' }
  | { que: 'hecho'; r: Resultado; correo: string; empresa: string }
  | { que: 'fallo'; texto: string }

export default function NuevaCuentaContaPage() {
  const navigate = useNavigate()
  const [busqueda] = useSearchParams()
  const invitacion = busqueda.get('asesoria')
  const [empresa, setEmpresa] = useState(busqueda.get('empresa') ?? '')
  const [correo, setCorreo] = useState(busqueda.get('correo') ?? '')
  const [nombre, setNombre] = useState('')
  const [marca, setMarca] = useState<string>(MARCAS_SOLAS.find((m) => m.id === 'sumied')?.id ?? MARCAS_SOLAS[0]?.id ?? '')
  const [motivo, setMotivo] = useState(busqueda.get('motivo') ?? '')
  const [estado, setEstado] = useState<Estado>({ que: 'quieto' })
  const [vinculo, setVinculo] = useState<{ ok: boolean; texto: string } | null>(null)

  async function crear() {
    if (!supabase) { setEstado({ que: 'fallo', texto: 'No hay conexión con la base.' }); return }
    setEstado({ que: 'enviando' })
    const { data, error } = await supabase.functions.invoke('conta-crear-cuenta', {
      body: { empresa: empresa.trim(), correo: correo.trim(), nombre: nombre.trim() || null, marca, motivo: motivo.trim() },
    })
    if (error) {
      // La función dice el porqué en el cuerpo; supabase-js lo deja en context.
      let texto = error.message
      try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) texto = String(b.error) } catch { /* sin cuerpo */ }
      setEstado({ que: 'fallo', texto })
      return
    }
    setEstado({ que: 'hecho', r: data as Resultado, correo: correo.trim(), empresa: empresa.trim() })
    // I01b · Una asesoría invitada: se vincula a la empresa que la invitó.
    if (invitacion) {
      const { data: v, error: ve } = await supabase.functions.invoke('conta-asesoria', {
        body: { accion: 'aprobar', invitacion, cuenta: (data as Resultado).account_id },
      })
      let texto = (v as { mensaje?: string } | null)?.mensaje ?? ''
      if (ve) { try { const b = await (ve as { context?: Response }).context?.json(); texto = String(b?.mensaje ?? ve.message) } catch { texto = ve.message } }
      setVinculo({ ok: !ve, texto: ve ? `La cuenta está creada, pero NO se ha vinculado a la empresa: ${texto}` : texto })
    }
  }

  if (estado.que === 'hecho') {
    const { r } = estado
    const nombreMarca = MARCAS_SOLAS.find((m) => m.id === r.marca)?.nombre ?? r.marca
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-display font-medium mb-4" style={{ color: 'var(--color-accent)' }}>Cuenta de contabilidad creada</h1>
        <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--color-bg-surface, #fff)', border: '1px solid var(--color-border, #e5e5e5)' }} role="status">
          <p className="text-sm mb-2"><strong>{estado.empresa}</strong> ya tiene su cuenta solo de contabilidad, con la marca <strong>{nombreMarca}</strong>: sin Cocina, con el interruptor de contabilidad y el registro de quién la creó y por qué.</p>
          <p className="text-sm mb-1"><strong>Slug:</strong> {r.slug}</p>
          <p className="text-sm mb-3"><strong>Account ID:</strong> {r.account_id}</p>
          {r.invitacion_enviada ? (
            <p className="text-sm" style={{ color: '#2F6B2F' }}>✓ Invitación con la marca mandada a {estado.correo}. Cuando entre, pondrá su contraseña y seguirá con el alta de su empresa.</p>
          ) : (
            <>
              <p className="text-sm" style={{ color: '#A12626' }}>⚠ La cuenta está creada, pero la invitación NO ha salido: {r.motivo ?? 'sin motivo'}</p>
              {r.enlace && (
                <p className="text-xs mt-2" style={{ wordBreak: 'break-all' }}>Enlace de entrada (solo fuera de producción, para probar): <a href={r.enlace}>{r.enlace}</a></p>
              )}
            </>
          )}
        </div>
        {vinculo && <p className="text-sm mb-4" role="status" style={{ color: vinculo.ok ? '#2F6B2F' : '#A12626' }}>{vinculo.ok ? '✓ ' : '⚠ '}{vinculo.texto}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => navigate(`/_admin/cuentas/${r.account_id}`)} className="px-4 py-2 rounded-md text-sm font-medium" style={{ background: 'var(--color-terracota)', color: '#fff' }}>Ver la cuenta</button>
          <button type="button" onClick={() => { setEstado({ que: 'quieto' }); setEmpresa(''); setCorreo(''); setNombre(''); setMotivo('') }} className="px-4 py-2 rounded-md text-sm font-medium" style={{ border: '1px solid var(--color-border, #ddd)' }}>Crear otra</button>
        </div>
      </div>
    )
  }

  const enviando = estado.que === 'enviando'
  const listo = empresa.trim().length >= 2 && /@/.test(correo) && !!marca && motivo.trim().length >= 3
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-display font-medium mb-2" style={{ color: 'var(--color-accent)' }}>Nueva cuenta solo de contabilidad</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary, #555)' }}>
        Sin Cocina: sin local, marca, canales, familias, ingredientes ni almacén. El cliente recibe la invitación con la marca y termina él el alta de su empresa.
      </p>
      {estado.que === 'fallo' && (
        <div className="rounded-lg p-4 mb-6" style={{ background: '#FDECEC', border: '1px solid #E5A0A0' }} role="alert">
          <p className="text-sm font-medium" style={{ color: '#A12626' }}>No se ha creado: {estado.texto}</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 mb-6">
        <Campo etiqueta="Nombre de la empresa" valor={empresa} alCambiar={setEmpresa} ejemplo="Ferretería Ejemplo, S.L." />
        <Campo etiqueta="Correo del administrador del cliente" valor={correo} alCambiar={setCorreo} ejemplo="ana@empresa-ejemplo.es" tipo="email" />
        <Campo etiqueta="Su nombre (para el saludo, opcional)" valor={nombre} alCambiar={setNombre} ejemplo="Ana" />
        <label className="block">
          <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary, #555)' }}>Marca</span>
          <select value={marca} onChange={(e) => setMarca(e.target.value)} className="w-full border rounded-md px-3 py-2 text-sm">
            {MARCAS_SOLAS.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.dominios.length ? ` · ${m.dominios[0]}` : ' · sin dominio todavía'}</option>)}
          </select>
        </label>
        <Campo etiqueta="Por qué se da de alta (queda en el registro)" valor={motivo} alCambiar={setMotivo} ejemplo="Cliente de contabilidad que viene de Cegid Diez" />
      </div>
      <button type="button" disabled={!listo || enviando} onClick={() => void crear()} className="px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50" style={{ background: 'var(--color-terracota)', color: '#fff' }}>
        {enviando ? 'Creando…' : 'Crear la cuenta e invitar'}
      </button>
    </div>
  )
}

function Campo({ etiqueta, valor, alCambiar, ejemplo, tipo = 'text' }: { etiqueta: string; valor: string; alCambiar: (v: string) => void; ejemplo: string; tipo?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary, #555)' }}>{etiqueta}</span>
      <input type={tipo} value={valor} onChange={(e) => alCambiar(e.target.value)} placeholder={ejemplo} className="w-full border rounded-md px-3 py-2 text-sm" />
    </label>
  )
}
