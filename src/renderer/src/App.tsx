import { Content, RootLayout, Sidebar } from './components'
import ObimEditor from './components/obimEditor'
import { notesDirectoryPath } from '@shared/constants'
import { FileExplorer } from './components/FileExplorer/FileExplorer'
import { useEffect } from 'react'
import { storeFilesInDB } from '../utils/filesDB'
import SearchWindow from './components/SearchWindow'
import './assets/index.css'
import { Breadcrumbs } from './components/Breadcrumbs'
import ImageSearchOverlay from './components/ImageSearchOverlay'
import { ContextMenu } from './components/ContextMenu'

function App() {

  useEffect(() => {
    const load = async () => {
      const files = await window['api'].getFilesRecursiveAsList(notesDirectoryPath);
      storeFilesInDB(files)
      console.log('Files loaded')
    }
    load()
  }, [])

  return (
    <RootLayout>
      <SearchWindow />
      <Sidebar>
        <FileExplorer directoryPath={notesDirectoryPath} />
      </Sidebar>
      <Content>
        <Breadcrumbs />
        <ObimEditor />
      </Content>
      <ImageSearchOverlay id="image-overlay" />
      <ContextMenu id="context-menu" />
    </RootLayout>
  )
}

export default App
