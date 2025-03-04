import { Content, RootLayout, Sidebar } from './components'
import ObimEditor from './components/obimEditor'
import { FileExplorer } from './components/FileExplorer/FileExplorer'
import { useEffect, useState } from 'react'
import { storeFilesInDB } from '../utils/filesDB'
import SearchWindow from './components/SearchWindow'
import './assets/index.css'
import { Breadcrumbs } from './components/Breadcrumbs'
import ImageSearchOverlay from './components/ImageSearchOverlay'
import { ContextMenu } from './components/ContextMenu'
import { InitializationCard } from './components/InitializationCard'
import { useAtom } from 'jotai'
import { isInitializedAtom } from './store/NotesStore'
import { getNotesDirectoryPath } from '@shared/constants'

function App() {
  const [isInitialized, setIsInitialized] = useAtom(isInitializedAtom)

  useEffect(() => {
    setIsInitialized(window['config'].isMainDirectoryPathDefinedSync())
    if (isInitialized) {
    const load = async () => {
      const files = await window['api'].getFilesRecursiveAsList(getNotesDirectoryPath())
      storeFilesInDB(files)
      console.log('Files loaded')
    }
    load()
    }
  }, [isInitialized])

  if (isInitialized) {
    return (
      <RootLayout>
        <SearchWindow />
        <Sidebar>
          <FileExplorer directoryPath={getNotesDirectoryPath()} />
        </Sidebar>
        <Content>
          <Breadcrumbs />
          <ObimEditor />
        </Content>
        <ImageSearchOverlay id="image-overlay" />
        <ContextMenu id="context-menu" />
      </RootLayout>
    )
  } else {
    return <InitializationCard />
  }
}

export default App
