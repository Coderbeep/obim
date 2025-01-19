import { useState } from "react"
import { storeFilesInDB, getFilesFromDB } from '../../utils/db'
import { FileItem } from "@shared/models"


export const useSearchField = () => {
    const [isVisible, setIsVisible] = useState(false)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<FileItem[]>([])

    const toggleVisibility = () => {
        setIsVisible((prev) => !prev)
    }

    const queryDB = async (query: string) => {
        const filesFromDB = await getFilesFromDB(query)
        setResults(filesFromDB.slice(0, 10))
    }

    const onQueryChange = (newQuery: string) => {
        setQuery(newQuery)
        queryDB(newQuery)
        console.log("new query")
        console.log(results)
    }

    return {
        toggleVisibility, onQueryChange, isVisible, setIsVisible, results
    }
}

export default useSearchField