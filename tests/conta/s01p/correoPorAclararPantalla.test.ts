// tests/conta/s01p/correoPorAclararPantalla.test.ts
//
// S01p·20 · 1 · La fila de «Por aclarar» de un correo de plataforma del que no salió nada:
// lleva el asunto del correo y el porqué, y su botón es «Volver a leer» (no «Leerla», que no
// tiene fichero que leer). Las demás llegadas, como antes.
import { describe, expect, it } from 'vitest'
import { boton, entendido, esCorreoSinFactura, tituloDeLlegada, type FilaDocumento } from '@/modules/conta/documentos/documentos'

const llegada = (o: Partial<FilaDocumento> = {}): FilaDocumento => ({
  id: 'l1', tipo: 'llegada', estado: 'por_aclarar', proveedor: { id: null, nombre: null }, numero: null, fecha: '2026-11-13', total: null,
  canal: 'correo', confianza: null, porque: 'No he encontrado la factura en el correo.', entendido: null, recepcion: null, asiento: null,
  llego: '2026-11-13T10:00:00Z', archivo: null, ...o,
})

describe('S01p·20 · 1 · el correo sin factura en «Por aclarar»', () => {
  it('lleva el asunto y el porqué, y su botón es «Volver a leer»', () => {
    const f = llegada({ correo: { id: 'e1', asunto: 'Fwd: Just-eat invoice: 1234567' } })
    expect(esCorreoSinFactura(f)).toBe(true)
    expect(tituloDeLlegada(f)).toBe('«Fwd: Just-eat invoice: 1234567»')
    expect(entendido(f)).toEqual({ titulo: '«Fwd: Just-eat invoice: 1234567»', porque: 'No he encontrado la factura en el correo.' })
    expect(boton(f)).toEqual({ texto: 'Volver a leer', principal: true })
  })
  it('sin asunto: «Un correo sin factura»', () => {
    expect(tituloDeLlegada(llegada({ correo: { id: 'e1', asunto: null } }))).toBe('Un correo sin factura')
  })
  it('las demás llegadas, como antes: con fichero, «Leerla»; con enlace, «Subir el PDF»; sin correo, «Un documento sin leer»', () => {
    expect(boton(llegada({ archivo: 'f.pdf', porque: null }))).toEqual({ texto: 'Leerla', principal: true })
    expect(boton(llegada({ porque: 'Falta el PDF: el correo trae un enlace.', correo: { id: 'e1', asunto: 'x' } }))).toEqual({ texto: 'Subir el PDF', principal: true })
    expect(tituloDeLlegada(llegada({ porque: 'Recibida, sin leer todavía.' }))).toBe('Un documento sin leer')
    expect(esCorreoSinFactura(llegada({ archivo: 'f.pdf', correo: { id: 'e1', asunto: 'x' } }))).toBe(false)
  })
})
