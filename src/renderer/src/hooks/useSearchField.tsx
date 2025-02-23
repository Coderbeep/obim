import { useEffect } from "react"
import { getFilesFromDB } from '../../utils/db'
import { isVisibleAtom, queryAtom, resultsAtom } from "../store/SearchWindowStore"
import { useAtom, useSetAtom } from "jotai"

export const useSearchField = () => {
    const [isVisible, setIsVisible] = useAtom(isVisibleAtom)
    const [query, setQuery] = useAtom(queryAtom)
    const setResults = useSetAtom(resultsAtom)

    useEffect(() => {
        if (isVisible) {
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    setIsVisible(false)
                }
            })
        } else {
            window.removeEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    setIsVisible(false)
                }
            })
        }
    })

    const queryDB = async (query: string) => {
        const filesFromDB = await getFilesFromDB(query)
        setResults(filesFromDB.slice(0, 30))
    }

    const onQueryChange = (newQuery: string) => {
        setQuery(newQuery)
        queryDB(newQuery)
    }

    return {
        onQueryChange
    }
}

export default useSearchField