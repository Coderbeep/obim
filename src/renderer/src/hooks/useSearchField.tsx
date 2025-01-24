import { useEffect, useState } from "react"
import { getFilesFromDB } from '../../utils/db'
import { FileItem } from "@shared/models"


export const useSearchField = () => {
    const [isVisible, setIsVisible] = useState(false)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<FileItem[]>([])

    const toggleVisibility = () => {
        setIsVisible((prev) => !prev)
    }

    useEffect(() => {
        if (isVisible) {
            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    setIsVisible(false)
            }})
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
        toggleVisibility, onQueryChange, isVisible, setIsVisible, results
    }
}

export default useSearchField