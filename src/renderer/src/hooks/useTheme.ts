import { useCallback, useEffect, useState } from 'react'
import type { Theme } from '../../../shared/types'

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    window.chessAPI.getSettings().then((settings) => setThemeState(settings.theme))
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      void window.chessAPI.setTheme(next)
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
