// src/modules/conta/laboral/CentrosPage.tsx
//
// LS1 (28/10/2026) · Pieza nueva de Laboral en Sumied: los centros de trabajo
// de la empresa. Un centro es una fila de `locations` de la cuenta, igual que
// un local de Folvy: así fichar(), el registro de jornada, el cuadrante y el
// resto de pantallas de Laboral funcionan sin tocar nada.
//
// Lo que se pide: el nombre, la dirección y, si se quiere, dónde está (para
// saber si alguien ficha fuera) y el radio. Sin ubicación también se ficha:
// el fichaje queda «sin distancia». Fichar fuera nunca bloquea: avisa
// (`clock_geofence_mode = 'warn'`), como en L1a.
//
// Guardar dice qué ha guardado o por qué no (regla 8).

import { useState } from 'react'
import { OtrasDirecciones } from './OtrasDirecciones'
import { leerOtrasDirecciones } from '@/modules/conta/services/otrasDireccionesService'
import { useLeer } from '@/modules/conta/libros/contexto'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Dialogo, Tarjeta } from '@/modules/conta/diseno'
import type { Location } from '@/types'
import { RADIO_POR_DEFECTO, VACIO, deCentro, errorDeCentro, numero, type Borrador } from './centros'

export default function CentrosPage() {
  const { locations, saveLocation } = useApp()
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState('')
  const [gps, setGps] = useState('')
  const centros = [...locations].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
  // S01m · Las otras direcciones con las que lo nombran las plataformas.
  const { userName } = useCuentaConta()
  const [vueltaOtras, setVueltaOtras] = useState(0)
  const otras = useLeer(() => leerOtrasDirecciones(locations.map((l) => l.id)), `${locations.map((l) => l.id).join(',')}:otras:${vueltaOtras}`)

  function abrir(b: Borrador) { setBorrador(b); setError(''); setGps(''); setHecho('') }

  function aqui() {
    if (!borrador) return
    if (!navigator.geolocation) { setGps('Este navegador no da la ubicación: escribe las coordenadas.'); return }
    setGps('Buscando dónde estás…')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        // Coordenadas del GPS de este navegador: números siempre, nunca null.
        // eslint-disable-next-line no-restricted-syntax
        setBorrador((b) => b && { ...b, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })
        const prec = Math.round(p.coords.accuracy)
        setGps(prec > 100
          ? `Puesta, pero con una precisión de ${prec} m: es una ubicación aproximada. Mejor desde el móvil, en el centro, con la ubicación precisa activada.`
          : `Puesta, con una precisión de ${prec} m.`)
      },
      () => setGps('No se ha podido leer la ubicación (permiso denegado o sin señal). Escribe las coordenadas o déjalo sin ubicación.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  async function guardar() {
    if (!borrador) return
    const fallo = errorDeCentro(borrador)
    if (fallo) { setError(fallo); return }
    const previo = borrador.id ? locations.find((l) => l.id === borrador.id) : undefined
    const lat = numero(borrador.lat), lng = numero(borrador.lng), radio = numero(borrador.radio) ?? RADIO_POR_DEFECTO
    const centro: Location = {
      ...(previo ?? { id: `loc-${Date.now()}`, phone: '', active: true, hoursBalanceCloseDay: 25, hoursBalanceSyncWithGestoria: true }),
      name: borrador.nombre.trim(),
      address: borrador.direccion.trim(),
      lat: lat ?? undefined,
      lng: lng ?? undefined,
      clockRadiusM: Math.round(radio),
      clockGeofenceMode: 'warn',
    }
    setGuardando(true); setError('')
    try {
      await saveLocation(centro)
      setBorrador(null)
      setHecho(`${previo ? 'Guardado' : 'Dado de alta'}: ${centro.name}, ${lat != null ? `con ubicación y un radio de ${centro.clockRadiusM} m` : 'sin ubicación (los fichajes quedan «sin distancia»)'}.`)
    } catch (e) {
      setError(e instanceof Error ? `No se ha guardado: ${e.message}` : 'No se ha guardado. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  async function cambiarActivo(c: Location) {
    setHecho(''); setError('')
    try {
      await saveLocation({ ...c, active: !c.active })
      setHecho(c.active ? `${c.name} queda cerrado: ya no sale para fichar ni en el cuadrante. Sus fichajes se conservan.` : `${c.name} vuelve a estar abierto.`)
    } catch (e) {
      setError(e instanceof Error ? `No se ha cambiado: ${e.message}` : 'No se ha cambiado. Vuelve a intentarlo.')
    }
  }

  return (
    <div className="s-pagina" data-prueba="laboral-centros">
      <Tarjeta titulo="Centros de trabajo"
        apoyo="Donde trabaja tu equipo. Cada persona ficha en su centro; si le pones la ubicación, el registro guarda a qué distancia fichó (sin bloquear nunca)."
        accion={<Boton variante="principal" icono="nuevo" onClick={() => abrir(VACIO)} data-prueba="centro-nuevo">Nuevo centro</Boton>} />

      {hecho && <p className="s-aviso-lista" data-tono="seguro" role="status" data-prueba="centro-hecho">{hecho}</p>}
      {error && !borrador && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}

      {centros.length === 0 ? (
        <Tarjeta titulo="Aún no hay ningún centro" apoyo="Da de alta el primero: con él ya se puede dar de alta a las personas y fichar." />
      ) : (
        <ul className="s-laboral-centros" aria-label="Centros de trabajo">
          {centros.map((c) => (
            <li key={c.id} data-prueba="centro">
              <Tarjeta compacta nivel={3}
                titulo={<span className="s-laboral-centro-nombre">{c.name} {!c.active && <Chip tono="neutro">Cerrado</Chip>}</span>}
                apoyo={<>
                  {c.address || 'Sin dirección'}
                  {' · '}
                  {c.lat != null && c.lng != null
                    ? <Chip tono="seguro">Ubicación puesta · radio {c.clockRadiusM ?? RADIO_POR_DEFECTO} m</Chip>
                    : <Chip tono="duda" titulo="Se ficha igual; el fichaje queda «sin distancia».">Sin ubicación</Chip>}
                  {(otras.datos?.get(c.id) ?? []).length > 0 && <span className="s-laboral-otras" data-prueba="centro-otras"> · También: {otras.datos!.get(c.id)!.join(' · ')}</span>}
                </>}
                accion={<span className="s-laboral-acciones">
                  <Boton variante="secundario" onClick={() => abrir(deCentro(c))}>Editar</Boton>
                  <Boton variante="fantasma" onClick={() => cambiarActivo(c)}>{c.active ? 'Cerrar' : 'Abrir'}</Boton>
                </span>} />
            </li>
          ))}
        </ul>
      )}

      {borrador && (
        <Dialogo titulo={borrador.id ? 'Editar centro' : 'Nuevo centro de trabajo'}
          explicacion="La ubicación es opcional. Con ella, el registro guarda a qué distancia ficha cada uno."
          alCerrar={() => setBorrador(null)}
          acciones={<>
            <Boton variante="secundario" onClick={() => setBorrador(null)}>Cancelar</Boton>
            <Boton variante="principal" onClick={guardar} disabled={guardando} data-prueba="centro-guardar">{guardando ? 'Guardando…' : 'Guardar'}</Boton>
          </>}>
          {error && <p className="s-aviso-lista" data-tono="falta" role="alert">{error}</p>}
          <label className="s-campo"><span className="s-campo-etiqueta">Nombre</span>
            <input className="s-control" value={borrador.nombre} onChange={(e) => setBorrador({ ...borrador, nombre: e.target.value })}
              placeholder="Oficina de Madrid" data-prueba="centro-nombre" autoFocus /></label>
          <label className="s-campo"><span className="s-campo-etiqueta">Dirección</span>
            <input className="s-control" value={borrador.direccion} onChange={(e) => setBorrador({ ...borrador, direccion: e.target.value })}
              placeholder="Calle, número, ciudad" data-prueba="centro-direccion" /></label>
          <div className="s-laboral-fila">
            <label className="s-campo"><span className="s-campo-etiqueta">Latitud</span>
              <input className="s-control" inputMode="decimal" value={borrador.lat} onChange={(e) => setBorrador({ ...borrador, lat: e.target.value })} data-prueba="centro-lat" /></label>
            <label className="s-campo"><span className="s-campo-etiqueta">Longitud</span>
              <input className="s-control" inputMode="decimal" value={borrador.lng} onChange={(e) => setBorrador({ ...borrador, lng: e.target.value })} data-prueba="centro-lng" /></label>
            <label className="s-campo"><span className="s-campo-etiqueta">Radio (m)</span>
              <input className="s-control" inputMode="numeric" value={borrador.radio} onChange={(e) => setBorrador({ ...borrador, radio: e.target.value })} data-prueba="centro-radio" /></label>
          </div>
          <div className="s-laboral-acciones">
            <Boton variante="secundario" onClick={aqui}>Estoy en el centro: usar mi ubicación</Boton>
            {(borrador.lat || borrador.lng) && <Boton variante="fantasma" onClick={() => setBorrador({ ...borrador, lat: '', lng: '' })}>Quitar la ubicación</Boton>}
          </div>
          {gps && <p className="s-apoyo" role="status">{gps}</p>}
          {borrador.id && !borrador.id.startsWith('loc-') && (
            <OtrasDirecciones key={`${borrador.id}:${(otras.datos?.get(borrador.id) ?? []).join('|')}`} locationId={borrador.id} iniciales={otras.datos?.get(borrador.id) ?? []} quien={userName ?? null} alGuardar={() => setVueltaOtras((v) => v + 1)} />
          )}
        </Dialogo>
      )}
    </div>
  )
}
