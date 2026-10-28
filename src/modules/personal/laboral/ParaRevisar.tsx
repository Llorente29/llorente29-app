// src/modules/personal/laboral/ParaRevisar.tsx
//
// L1a · PR 2 (28/10/2026). «Para revisar», arriba en Equipo (Personal ›
// Empleados): una frase por caso y su botón, como en la maqueta («Ana ·
// entrada del 12/10 sin salida · Corregir»). Los casos:
//   · una jornada de más de 12 horas, o una entrada sin salida
//     (jornadas_para_revisar: no se tocan solas);
//   · un fichaje fuera del radio de su local, de los últimos 7 días (fuera del
//     radio no se bloquea: se marca y se avisa aquí);
//   · una corrección con la que la persona no está de acuerdo.
// Regla 7: están todos. Con muchos, se enseñan los primeros y el botón dice
// cuántos faltan; el número de arriba es el de todos.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { Boton, Chip, Tarjeta } from '@/modules/conta/diseno'
import { leerFueraDelRadio, metros, DIAS_FUERA_DEL_RADIO } from '@/services/fueraDelRadioService'
import { correccionesEnDesacuerdo, jornadasParaRevisar, type JornadaParaRevisar } from './registroJornadaServicio'
import { diaMadrid, fechaLarga, horaMadrid } from './calculoJornada'
import { PIEZA_LABORAL } from './estilo'
import { useProductoLaboral } from './productoLaboral'

interface Caso {
  clave: string
  cuando: string
  texto: string
  detalle: string
  tono: 'falta' | 'duda'
  etiqueta: string
  boton: string
  ir: string
  /** La jornada que se puede corregir ahí mismo (LS1, Sumied). */
  jornada?: JornadaParaRevisar
}

const VISIBLES = 6
const TIPO: Record<string, string> = { entrada: 'entrada', salida: 'salida', pausa_inicio: 'pausa', pausa_fin: 'vuelta de la pausa' }

/**
 * LS1 (28/10/2026): en Sumied › Laboral › Para revisar se corrige ahí mismo
 * (`alCorregir`), y la pantalla dice «nada para revisar» en vez de
 * desaparecer (`siempre`), porque se abre a propósito (regla 7).
 */
export default function ParaRevisar({ alCorregir, siempre = false }: { alCorregir?: (j: JornadaParaRevisar) => void; siempre?: boolean } = {}) {
  const { activeAccountId, staff, locations } = useApp()
  const navigate = useNavigate()
  const voc = useProductoLaboral()
  const [casos, setCasos] = useState<Caso[] | null>(null)
  const [error, setError] = useState('')
  const [todos, setTodos] = useState(false)
  const claveStaff = staff.map(e => e.id).sort().join(',')

  useEffect(() => {
    if (!activeAccountId) return
    let vivo = true
    const nombre = new Map(staff.map(e => [e.id, e.name.trim().split(/\s+/)[0] || e.name]))
    const local = new Map(locations.map(l => [l.id, l.name]))
    const t = window.setTimeout(async () => {
      try {
        const [jornadas, fuera, desacuerdos] = await Promise.all([
          jornadasParaRevisar(activeAccountId),
          leerFueraDelRadio(claveStaff ? claveStaff.split(',') : []),
          correccionesEnDesacuerdo(activeAccountId),
        ])
        const lista: Caso[] = []
        for (const j of jornadas) {
          const dia = diaMadrid(j.entrada)
          const quien = nombre.get(j.employeeId) ?? j.nombre
          lista.push(j.tipo === 'larga'
            ? {
                clave: `j-${j.clockEntryId}`, cuando: j.entrada,
                texto: `${quien} · jornada de ${String(j.horas ?? '').replace('.', ',')} h el ${fechaLarga(dia)}`,
                detalle: `De las ${horaMadrid(j.entrada)} a las ${j.salida ? horaMadrid(j.salida) : '—'}${j.salida && diaMadrid(j.salida) !== dia ? ` del ${fechaLarga(diaMadrid(j.salida))}` : ''}. ¿Falta una salida en medio?`,
                tono: 'duda', etiqueta: 'Más de 12 h', boton: 'Corregir', jornada: j,
                ir: `control-horario?persona=${j.employeeId}&desde=${dia}&hasta=${j.salida ? diaMadrid(j.salida) : dia}`,
              }
            : {
                clave: `j-${j.clockEntryId}`, cuando: j.entrada,
                texto: `${quien} · entrada del ${fechaLarga(dia)} sin salida`,
                detalle: `Entró a las ${horaMadrid(j.entrada)} y no hay salida antes de su siguiente entrada. Esas horas no cuentan hasta que se corrija.`,
                tono: 'falta', etiqueta: 'Sin salida', boton: 'Corregir', jornada: j,
                ir: `control-horario?persona=${j.employeeId}&desde=${dia}&hasta=${dia}`,
              })
        }
        if (fuera.disponible) {
          for (const f of fuera.fichajes) {
            const dia = diaMadrid(f.hora)
            lista.push({
              clave: `f-${f.id}`, cuando: f.hora,
              texto: `${nombre.get(f.employeeId) ?? 'Persona'} · ${TIPO[f.tipo] ?? f.tipo} del ${fechaLarga(dia)} fuera del radio`,
              detalle: `A las ${horaMadrid(f.hora)}, a ${metros(f.distanciaM)} de ${(f.locationId && local.get(f.locationId)) || `su ${voc.local}`}. Se guardó con la distancia: nadie se quedó sin fichar.`,
              tono: 'duda', etiqueta: 'Fuera del radio', boton: 'Ver',
              ir: `control-horario?persona=${f.employeeId}&desde=${dia}&hasta=${dia}`,
            })
          }
        }
        for (const c of desacuerdos) {
          const hora = c.horaDespues ?? c.horaAntes
          const dia = hora ? diaMadrid(hora) : diaMadrid(c.cuando)
          lista.push({
            clave: `d-${c.id}`, cuando: c.conformidadAt ?? c.cuando,
            texto: `${nombre.get(c.employeeId) ?? 'Persona'} no está de acuerdo con la corrección de su ${TIPO[c.tipo ?? ''] ?? 'marca'} del ${fechaLarga(dia)}`,
            detalle: c.conformidadNota ? `Dice: «${c.conformidadNota}».` : 'Así sale en su registro de jornada.',
            tono: 'falta', etiqueta: 'En desacuerdo', boton: 'Ver el registro',
            ir: `registro-jornada?persona=${c.employeeId}&mes=${dia.slice(0, 7)}`,
          })
        }
        lista.sort((a, b) => b.cuando.localeCompare(a.cuando))
        if (vivo) { setCasos(lista); setError('') }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e))
      }
    }, 0)
    return () => { vivo = false; window.clearTimeout(t) }
    // staff y locations cambian de identidad en cada sincronización: manda la lista de ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, claveStaff, locations.length, voc.local])

  if (error) {
    return (
      <div className={PIEZA_LABORAL}>
        <Tarjeta tono="falta" titulo="Para revisar" apoyo={`No se ha podido leer: ${error}`} />
      </div>
    )
  }
  if (!casos) return null
  if (casos.length === 0) {
    return siempre
      ? <div className={PIEZA_LABORAL} data-prueba="para-revisar-vacio"><Tarjeta compacta tono="ok" titulo="Para revisar · 0" apoyo="Ninguna jornada de más de 12 h, ninguna entrada sin salida, ningún fichaje fuera del radio y ninguna corrección en desacuerdo." /></div>
      : null
  }

  const vistos = todos ? casos : casos.slice(0, VISIBLES)
  return (
    <div className={PIEZA_LABORAL} data-prueba="para-revisar">
      <Tarjeta compacta titulo={`Para revisar · ${casos.length}`}
        apoyo={`Jornadas de más de 12 h, entradas sin salida, fichajes fuera del radio (${DIAS_FUERA_DEL_RADIO} días) y correcciones en desacuerdo. Nada se arregla solo.`}>
        <div className="l-revisar">
          {vistos.map(c => (
            <div key={c.clave} className="l-revisar-fila" data-prueba="para-revisar-caso">
              <Chip tono={c.tono}>{c.etiqueta}</Chip>
              <div className="l-revisar-texto">
                <b>{c.texto}</b>
                <span>{c.detalle}</span>
              </div>
              <Boton onClick={() => (alCorregir && c.jornada ? alCorregir(c.jornada) : navigate(`${voc.base}/${c.ir}`))}
                data-prueba={alCorregir && c.jornada ? 'para-revisar-corregir' : undefined}>{c.boton}</Boton>
            </div>
          ))}
          {casos.length > VISIBLES && (
            <div className="l-revisar-pie">
              <Boton variante="enlace" onClick={() => setTodos(v => !v)}>
                {todos ? 'Ver solo los más recientes' : `Ver los ${casos.length} (faltan ${casos.length - VISIBLES})`}
              </Boton>
            </div>
          )}
        </div>
      </Tarjeta>
    </div>
  )
}
