import { Content, RootLayout, Sidebar } from './components'
import CMImageContextMenu from './components/CMImageContextMenu'
import Editor from './components/myEditor'
import { notesDirectoryPath } from '@shared/constants'
import { FileExplorer } from './components/FileExplorer'
import { useEffect } from 'react'
import { storeFilesInDB } from '../utils/db'
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
      <CMImageContextMenu />
      <Sidebar>
        <FileExplorer directoryPath={notesDirectoryPath} />
      </Sidebar>
      <Content>
        <Breadcrumbs />
        <Editor />
      </Content>
      <ImageSearchOverlay id="image-overlay"/>  
      <ContextMenu id="context-menu" type="FILE"/>
      </RootLayout>
  )
}

export default App
