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
import { useSetAtom } from 'jotai'
import { filesAtom } from './store/NotesStore'

function App() {
  const setMainDirectoryFilesAtom = useSetAtom(filesAtom)

  useEffect(() => {
    const load = async () => {
      const files = await window['api'].getFilesRecursiveAsList(notesDirectoryPath);
      const mainDirectoryFiles = await window['api'].getFiles(notesDirectoryPath);
      const directories = files.filter((file) => file.isDirectory)
      setMainDirectoryFilesAtom(mainDirectoryFiles)
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
      <div id="image-overlay" className="absolute bg-black/80 w-10 h-10 text-white text-xs p-2 rounded-md z-50"></div>
      </RootLayout>
  )
}

export default App
