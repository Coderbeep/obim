import { Content, RootLayout, Sidebar } from './components'
import CMImageContextMenu from './components/CMImageContextMenu'
import Editor from './components/myEditor'
import { notesDirectoryPath } from '@shared/constants'
import { FileExplorer } from './components/FileExplorer'
import { useEffect } from 'react'
import { storeFilesInDB } from '../utils/db'
import SearchWindow from './components/SearchWindow'
import useSearchField from './hooks/useSearchField'
import './assets/index.css'
import { Breadcrumbs } from './components/Breadcrumbs'

function App() {

  useEffect(() => {
    const load = async () => {
      const files = await window['api'].getFilesRecursive(notesDirectoryPath);
      storeFilesInDB(files)
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
    </RootLayout>
  )
}

export default App
