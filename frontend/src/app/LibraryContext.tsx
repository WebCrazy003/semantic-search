// frontend/src/app/LibraryContext.tsx
// One library poller for the whole app. Routes mount and unmount as the user navigates,
// so the hook cannot live in a page: the Documents page, the hero's counters and the
// Admin document picker would each start their own 500 ms poll and disagree with each
// other. This keeps exactly one.

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
