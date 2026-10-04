import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Bubble } from './Bubble.tsx'

describe('Bubble', () => {
  it('renderiza texto de usuario', () => {
    const { container } = render(<Bubble entry={{ seq: 1, kind: 'user', text: 'hola mundo', at: 1 }} />)
    // Must escape text, not use innerHTML
    expect(container.querySelector('.bubble--user')?.textContent).toBe('hola mundo')
  })

  it('renderiza texto de assistant', () => {
    const { container } = render(<Bubble entry={{ seq: 2, kind: 'assistant', text: 'buenas', at: 2 }} />)
    expect(container.querySelector('.bubble--assistant')?.textContent).toBe('buenas')
  })

  it('marca streaming con clase cursor', () => {
    const { container } = render(<Bubble entry={{ seq: 3, kind: 'assistant', text: 'escribiendo…', at: 3, streaming: true }} />)
    expect(container.querySelector('.bubble--streaming')).toBeTruthy()
  })
})
