import { createContext, useContext } from 'react'
export type Translate = (key: string) => string
export const Translation = createContext<Translate>((key) => key)
export const useTranslation = () => useContext(Translation)
