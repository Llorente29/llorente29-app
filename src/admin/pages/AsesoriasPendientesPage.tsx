// src/admin/pages/AsesoriasPendientesPage.tsx
//
// I01b · Las asesorías que han aceptado la invitación de una empresa y aún no
// tienen cuenta en Sumied. El alta la da la plataforma (decisión de Julio del
// 18/10: la invitación vincula; las cuentas nuevas no se crean solas). «Dar de
// alta» abre «Nueva cuenta de contabilidad» rellena; al crearla, se vincula.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface Pendiente {
  id: string; asesoria: string; correo: string; base: string; empresa: string; cuenta_empresa: string; invita: string; aceptada: string; ya_es_admin_de: number
}

export default function AsesoriasPendientesPage() {
  const [lista, setLista] = useState<Pendiente[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    if (!supabase) return
    void supabase.rpc('conta_asesoria_pendientes' as never).then(({ data, error: e }) => {
      if (!vivo) return
      if (e) setError(e.message)
      else setLista((data as unknown as Pendiente[]) ?? [])
    })
    return () => { vivo = false }
  }, [])
  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-display font-medium mb-2" style={{ color: 'var(--color-accent)' }}>Asesorías por dar de alta</h1>
      <p className="text-sm mb-4">Han aceptado la invitación de una empresa para llevar sus impuestos y aún no tienen cuenta. Al darlas de alta se vinculan solas a la empresa que las invitó.</p>
      {error && <p className="text-sm" role="alert" style={{ color: '#A12626' }}>No se han podido leer: {error}</p>}
      {!error && !lista && <p className="text-sm">Leyendo…</p>}
      {lista?.length === 0 && <p className="text-sm">No hay ninguna esperando.</p>}
      {lista && lista.length > 0 && (
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Asesoría</th><th>Correo</th><th>La invita</th><th>Aceptó</th><th /></tr></thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--color-border, #e5e5e5)' }}>
                <td className="py-2">{p.asesoria}<div className="text-xs">{p.base === 'power_of_attorney' ? 'con un poder' : 'colaboradora social'}</div></td>
                <td className="py-2">{p.correo}{p.ya_es_admin_de > 1 && <div className="text-xs" style={{ color: '#A12626' }}>Ese correo administra {p.ya_es_admin_de} cuentas: mira cuál antes de crear otra.</div>}</td>
                <td className="py-2">{p.empresa}<div className="text-xs">{p.invita} · {p.cuenta_empresa}</div></td>
                <td className="py-2">{new Date(p.aceptada).toLocaleDateString('es-ES')}</td>
                <td className="py-2">
                  <Link to={`/_admin/cuentas/nueva-contabilidad?${new URLSearchParams({ asesoria: p.id, empresa: p.asesoria, correo: p.correo, motivo: `Asesoría invitada por ${p.empresa} (${p.invita}) para llevar sus impuestos` }).toString()}`}
                    className="underline">Dar de alta</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
