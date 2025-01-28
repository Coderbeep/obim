import { currentFilePathAtom, currentRelativeFilePathAtom } from "@renderer/store/notes"
import { useAtom, useAtomValue } from "jotai"
import React from "react"

const BreadcrumbItem = ({ children, className }) => {
    return <div className={`px-1 rounded-md select-none ${className}`}>
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

    return <div className="flex justify-center text-normal text-sm text-nowrap">
        {parts.map((part, index) => (
            <>
                <BreadcrumbItem className={index === parts.length - 1 ? "text-normal" : "text-muted hover:bg-gray-200 hover:text-normal" }>
                    {part}  
                </BreadcrumbItem>
                {index < parts.length - 1 && <BreadcrumbSeparator />}
            </>
        ))}
    </div>
}