// frontend/src/app/LibraryContext.tsx
// One library poller for the pages that need it (the document manager, the admin page),
// so a page and the components inside it agree about what is indexed instead of each
// polling on its own.

import { createContext, useContext, type ReactNode } from 'react'
import { useLibrary, type Library } from '../hooks/useLibrary'

const LibraryContext = createContext<Library | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const library = useLibrary()
  return <LibraryContext.Provider value={library}>{children}</LibraryContext.Provider>
}

export function useLibraryContext(): Library {
  const value = useContext(LibraryContext)
  if (!value) throw new Error('useLibraryContext must be used inside a LibraryProvider')
  return value
}
