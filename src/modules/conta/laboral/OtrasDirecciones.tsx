// src/modules/conta/laboral/OtrasDirecciones.tsx
//
// S01m · En la ficha del centro (local): «Otras direcciones con las que lo
// nombran las plataformas». Glovo, por ejemplo, puede tener una dirección vieja
// de la tienda; con ella aquí, sus liquidaciones y sus facturas encuentran el
// local. Se guardan aparte de la ficha, con su botón, y dicen qué han hecho
// (regla 8). Solo para un centro que ya existe. Las iniciales se toman al
// montarlo: la página lo remonta (key) cuando llegan de la base.
import { useState } from 'react'
import { Boton } from '@/modules/conta/diseno'
import { direccionesDeTexto, guardarOtrasDirecciones } from '@/modules/conta/services/otrasDireccionesService'

export function OtrasDirecciones({ locationId, iniciales, quien, alGuardar }: {
  locationId: string; iniciales: readonly string[]; quien: string | null; alGuardar: (direcciones: string[]) => void
}) {
  const [texto, setTexto] = useState(iniciales.join('\n'))
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const guardar = async () => {
    setGuardando(true); setMsg(null)
    try {
      const dirs = direccionesDeTexto(texto)
      const t = await guardarOtrasDirecciones(locationId, dirs, quien)
      setMsg({ ok: true, texto: t }); alGuardar(dirs)
    } catch (e) {
      setMsg({ ok: false, texto: `No se han guardado: ${e instanceof Error ? e.message : String(e)}` })
    } finally { setGuardando(false) }
  }
  return (
    <div className="s-campo" data-prueba="otras-direcciones">
      <label className="s-campo"><span className="s-campo-etiqueta">Otras direcciones con las que lo nombran las plataformas</span>
        <textarea className="s-control" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Una por línea, como sale en la plataforma: Avenida de Ejemplo, 106" data-prueba="otras-direcciones-texto" /></label>
      <p className="s-apoyo">Si una plataforma tiene una dirección vieja de este local, escríbela aquí: sus liquidaciones y sus facturas lo encontrarán.</p>
      <Boton variante="secundario" onClick={() => void guardar()} disabled={guardando} data-prueba="otras-direcciones-guardar">
        {guardando ? 'Guardando…' : 'Guardar las otras direcciones'}
      </Boton>
      {msg && <p className="s-aviso-lista" data-tono={msg.ok ? 'seguro' : 'falta'} role={msg.ok ? 'status' : 'alert'} data-prueba="otras-direcciones-hecho">{msg.texto}</p>}
    </div>
  )
}
