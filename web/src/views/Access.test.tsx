import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Access } from './Access.tsx'

describe('Access', () => {
  it('muestra el modo, el hostname y avisa si no está declarado', async () => {
    const api = { access: async () => ({ mode: 'tailnet', hostname: 'equipo.tailnet.ts.net', declared: false, loginUrl: undefined }) }
    render(<Access api={api as never} />)
    expect(await screen.findByText(/tailnet/i)).toBeDefined()
    expect(await screen.findByText('equipo.tailnet.ts.net')).toBeDefined()
    expect(await screen.findByText(/no está en trustedHosts/i)).toBeDefined()
  })

  it('sin loginUrl explica que hay que abrirla desde el PC', async () => {
    const api = { access: async () => ({ mode: 'loopback', declared: true, loginUrl: undefined }) }
    render(<Access api={api as never} />)
    expect(await screen.findByText(/desde el propio PC/i)).toBeDefined()
  })
})
