import { currentRelativeFilePathAtom, selectedBreadcrumbAtom } from "../store/NotesStore"
import { useAtomValue, useSetAtom } from "jotai"
import { Fragment, useRef } from "react"

const BreadcrumbItem = ({ children, className, onClick }) => {
    return <div className={`px-1 rounded-md select-none ${className}`} onClick={onClick}>
        {children}
    </div>
}

const BreadcrumbSeparator = () => {
    return <div className="px-1 select-none text-muted">
        /
    </div>
}

export const Breadcrumbs = () => {
    const path = useAtomValue(currentRelativeFilePathAtom)
    const parts = path.split('/').filter(part => part !== '')
    const setSelectedBreadcrumb = useSetAtom(selectedBreadcrumbAtom)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleClick = (index: number) => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
        }

        setSelectedBreadcrumb("/" + parts.slice(0, index + 1).join('/'))

        timeoutRef.current = setTimeout(() => {
            setSelectedBreadcrumb('')
            timeoutRef.current = null
        }, 300)
    }

    return <div className="flex justify-center text-normal text-sm text-nowrap">
        {parts.map((part, index) => (
            <Fragment key={`${part}-${index}`}>
                <BreadcrumbItem
                    className={index === parts.length - 1 ? "text-normal"
                        : "text-muted hover:bg-gray-200 hover:text-normal"}
                    onClick={() => index < parts.length - 1 && handleClick(index)}>
                    {part}
                </BreadcrumbItem>
                {index < parts.length - 1 && <BreadcrumbSeparator />}
            </Fragment>
        ))}
    </div>
}