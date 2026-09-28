// The pinned checkout has React DOM 18.3.1 but not @types/react-dom.
// Test-only declaration of the two public root operations this fixture uses.
// Keep this narrow; it is not a replacement React DOM implementation.
declare module 'react-dom/client' {
  import type { ReactNode } from 'react'
  export interface Root {
    render(children: ReactNode): void
    unmount(): void
  }
  export function createRoot(container: Element | DocumentFragment): Root
}
