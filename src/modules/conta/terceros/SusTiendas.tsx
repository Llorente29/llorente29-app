// src/modules/conta/terceros/SusTiendas.tsx
//
// D01 · «Sus tiendas» en Liquidaciones de la ficha de una plataforma (Julio,
// 16/10). Una fila por tienda, tal como la nombra la plataforma, con tres
// desplegables (marca, local y cuenta de cobro) y «Guardar» en cada una. Sin
// marca y local, sus liquidaciones no se comparan ni se asientan: la fila lo
// dice. Salen todas las tiendas, asignadas o no (regla 7): primero las que
// faltan.
//
// Regla 30: el desplegable de marcas enseña las activas, pero la marca que ya
// tiene la tienda sale siempre, aunque esté archivada: la lista con la que se
// elige no es la lista con la que se lee.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Chip } from '@/modules/conta/ui/piezas'
import { useTercero, papelesDe } from '@/modules/conta/terceros/contextoTercero'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { asignarTienda, leerTiendas, type MarcaOpcion } from '@/modules/conta/services/tiendasService'
import { estadoTienda, marcaPropuesta, resumenTiendas, textoGuardada, type TiendaPlataforma } from '@/modules/conta/lib/tiendas'

type Carga = { estado: 'cargando' } | { estado: 'error'; error: string } | { estado: 'lista'; tiendas: TiendaPlataforma[]; marcas: MarcaOpcion[] }

const ORDEN = { sin_asignar: 0, sin_banco: 1, asignada: 2 } as const

export function SusTiendas() {
  const { ficha, accountId, companyId, avisar } = useTercero()
  const { rolPlataforma } = papelesDe(ficha)
  const canal = rolPlataforma?.channelId ?? null
  const [carga, setCarga] = useState<Carga>({ estado: 'cargando' })
  const [vuelta, setVuelta] = useState(0)
  const recargar = useCallback(() => setVuelta((v) => v + 1), [])

  useEffect(() => {
    if (!companyId || !canal) return
    let vivo = true
    leerTiendas(accountId, companyId, canal)
      .then((r) => { if (vivo) setCarga({ estado: 'lista', ...r }) })
      .catch((e: unknown) => { if (vivo) setCarga({ estado: 'error', error: e instanceof Error ? e.message : String(e) }) })
    return () => { vivo = false }
  }, [accountId, companyId, canal, vuelta])

  if (!companyId || !canal) return null
  return (
    <section className="cx-tarjeta" aria-label="Sus tiendas">
      <h2 className="cx-tarjeta-titulo">Sus tiendas</h2>
      {carga.estado === 'cargando' && <p className="cxt-liq-explica">Leyendo sus tiendas…</p>}
      {carga.estado === 'error' && <div className="cx-error" role="alert">{carga.error}</div>}
      {carga.estado === 'lista' && <Lista tiendas={carga.tiendas} marcas={carga.marcas} alGuardar={(t) => { avisar(t); recargar() }} />}
    </section>
  )
}

function Lista({ tiendas, marcas, alGuardar }: { tiendas: TiendaPlataforma[]; marcas: MarcaOpcion[]; alGuardar: (texto: string) => void }) {
  const ordenadas = useMemo(() => [...tiendas].sort((a, b) => ORDEN[estadoTienda(a)] - ORDEN[estadoTienda(b)] || a.nombre.localeCompare(b.nombre, 'es')), [tiendas])
  return (
    <>
      <p className="cxt-tiendas-resumen" role="status">{resumenTiendas(tiendas)}</p>
      {ordenadas.length > 0 && (
        <div className="cxt-tienda cxt-tienda-cabeza" aria-hidden="true">
          <span>TIENDA · como la nombra la plataforma</span><span>MARCA</span><span>LOCAL</span><span>CUENTA DE COBRO</span><span />
        </div>
      )}
      {ordenadas.map((t) => <FilaTienda key={t.id} t={t} marcas={marcas} alGuardar={alGuardar} />)}
    </>
  )
}

function FilaTienda({ t, marcas, alGuardar }: { t: TiendaPlataforma; marcas: MarcaOpcion[]; alGuardar: (texto: string) => void }) {
  const { ficha } = useTercero()
  const { userName } = useCuentaConta()
  const propuesta = t.marcaId ? null : marcaPropuesta(t.nombre, marcas.filter((m) => !m.archivada))
  const [marca, setMarca] = useState(t.marcaId ?? propuesta ?? '')
  const [local, setLocal] = useState(t.localId ?? '')
  const [banco, setBanco] = useState(t.bancoId ?? '')
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const estado = estadoTienda(t)
  const cambiado = marca !== (t.marcaId ?? '') || local !== (t.localId ?? '') || banco !== (t.bancoId ?? '')
  const opcionesMarca = marcas.filter((m) => !m.archivada || m.id === t.marcaId)
  const nombreMarca = (id: string) => marcas.find((m) => m.id === id)?.nombre ?? null
  const nombreLocal = (id: string) => ficha.locales.find((l) => l.id === id)?.name ?? null
  const nombreBanco = (id: string) => {
    const b = ficha.bancos.find((x) => x.id === id)
    return b ? `${b.name}${b.iban ? ` ···${b.iban.slice(-4)}` : ''}` : null
  }
  const id = (campo: string) => `tienda-${t.id}-${campo}`

  return (
    <form className="cxt-tienda" data-testid={`tienda-${t.id}`} onSubmit={async (e) => {
      e.preventDefault()
      setFallo(null)
      if ((marca && !local) || (!marca && local)) { setFallo('Elige la marca y el local, los dos: con uno solo no se sabe de qué asientos es.'); return }
      setOcupado(true)
      try {
        await asignarTienda(t.id, marca || null, local || null, banco || null, userName)
        alGuardar(textoGuardada(t, marca ? nombreMarca(marca) : null, local ? nombreLocal(local) : null, banco ? nombreBanco(banco) : null))
      } catch (er) {
        setFallo(er instanceof Error ? er.message : 'No se ha podido guardar la tienda.')
      } finally {
        setOcupado(false)
      }
    }}>
      <span className="cxt-tienda-nombre">
        <span>{t.nombre}</span>
        <span className="cxt-liq-explica">
          {t.liquidaciones === 0 ? 'Sin liquidaciones aún' : t.liquidaciones === 1 ? '1 liquidación' : `${t.liquidaciones} liquidaciones`}
          {' · '}
          {estado === 'sin_asignar'
            ? <Chip tono="ambar">Sin marca ni local</Chip>
            : estado === 'sin_banco' ? <Chip tono="ambar">Sin cuenta de cobro</Chip> : <Chip tono="ia">Asignada</Chip>}
          {propuesta && marca === propuesta && <> · marca propuesta por el nombre: guárdala si es esa</>}
        </span>
      </span>
      <div className="cxt-tienda-campo">
        <label className="cxt-tienda-etiqueta" htmlFor={id('marca')}>Marca</label>
        <select id={id('marca')} className="cx-input" value={marca} disabled={ocupado} onChange={(e) => setMarca(e.target.value)}>
          <option value="">Sin marca</option>
          {opcionesMarca.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.archivada ? ' (archivada)' : ''}</option>)}
        </select>
      </div>
      <div className="cxt-tienda-campo">
        <label className="cxt-tienda-etiqueta" htmlFor={id('local')}>Local</label>
        <select id={id('local')} className="cx-input" value={local} disabled={ocupado} onChange={(e) => setLocal(e.target.value)}>
          <option value="">Sin local</option>
          {ficha.locales.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="cxt-tienda-campo">
        <label className="cxt-tienda-etiqueta" htmlFor={id('banco')}>Cuenta de cobro</label>
        <select id={id('banco')} className="cx-input" value={banco} disabled={ocupado} onChange={(e) => setBanco(e.target.value)}>
          <option value="">Sin cuenta</option>
          {ficha.bancos.map((b) => <option key={b.id} value={b.id}>{b.name}{b.iban ? ` ···${b.iban.slice(-4)}` : ''}</option>)}
          {t.bancoId && !ficha.bancos.some((b) => b.id === t.bancoId) && <option value={t.bancoId}>La que tenía (ya no está activa)</option>}
        </select>
      </div>
      <span className="cxt-tienda-acciones">
        <button type="submit" className="cx-boton" disabled={ocupado || !cambiado} aria-label={`Guardar ${t.nombre}`}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
      </span>
      {fallo && <div className="cx-error cxt-tienda-fallo" role="alert">{fallo}</div>}
    </form>
  )
}
