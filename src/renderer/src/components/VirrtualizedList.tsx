import path from "path";
import React, { FC, useCallback, useEffect, useRef, useState } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import {
  VariableSizeNodeComponentProps,
  VariableSizeNodeData,
  VariableSizeTree
} from "react-vtree";

type DataNode = Readonly<{
  children: DataNode[];
  id: number;
  name: string;
  isDirectory?: boolean;
  path: string;
}>;

type StackElement = Readonly<{
  nestingLevel: number;
  node: DataNode;
}>;

type ExtendedData = VariableSizeNodeData &
  Readonly<{
    isLeaf: boolean;
    name: string;
    nestingLevel: number;
  }>;

let nodeId = 0;

type FileItem = {
  filename: string;
  path: string;
  isDirectory: boolean;
  children?: FileItem[];
};

const createNode = (fileItem: FileItem, depth: number = 0): DataNode => {
  const node: DataNode = {
    children: fileItem.children ? fileItem.children.map(child => createNode(child, depth + 1)) : [],
    id: nodeId++,
    name: fileItem.filename,
    isDirectory: fileItem.isDirectory,
    path: fileItem.path
  };
  return node;
};

const fetchChildren = async (dirPath: string): Promise<DataNode[]> => {
  const children = await window['api'].getFiles(dirPath);
  return children.map(createNode);
};

const defaultGapStyle = { marginLeft: 10 };
const defaultButtonStyle = { fontFamily: "Courier New" };

const Node: FC<VariableSizeNodeComponentProps<ExtendedData>> = ({
  height,
  data: { id, isLeaf, name, nestingLevel },
  isOpen,
  resize,
  style,
  toggle,
  treeData: { itemSize, nodes, setNodes }
}) => {
  const canOpen = height <= itemSize;
  const halfSize = itemSize / 2;

  const toggleNodeSize = useCallback(
    () => resize(canOpen ? height + halfSize : height - halfSize, true),
    [height, resize]
  );

  useEffect(() => {
    if (id === "0" && height !== 0) {
      resize(0, true);
    }
  }, [height]);

  const handleToggle = async () => {
    if (!isLeaf && !isOpen) {
      const node = nodes.find(node => node.id === parseInt(id, 10));
      if (node && !node.children.length) {
        console.log(`Fetching children for ${node.name}`);
        const children = await fetchChildren(node.path);
        node.children = children; // Update the node with its children
        setNodes([...nodes]); // Trigger re-render by updating state
      }
    }
    toggle();
  };

  return (
    <div
      style={{
        ...style,
        alignItems: "center",
        background: canOpen ? undefined : "#ddd",
        display: "flex",
        marginLeft: nestingLevel * 10 + (isLeaf ? 24 : 0),
        overflow: "hidden"
      }}
    >
      {!isLeaf && (
        <div>
          <button type="button" onClick={handleToggle} style={defaultButtonStyle}>
            {isOpen ? "-" : "+"}
          </button>
        </div>
      )}
      <div style={defaultGapStyle}>{name}</div>
      <div>
        <button type="button" onClick={toggleNodeSize} style={defaultGapStyle}>
          {canOpen ? "Open" : "Close"}
        </button>
      </div>
    </div>
  );
};

const itemSize = 30;

function* treeWalker(
  refresh: boolean,
  rootNode: DataNode
): Generator<ExtendedData | string | symbol, void, boolean> {
  const stack: StackElement[] = [];

  stack.push({
    nestingLevel: 0,
    node: rootNode
  });

  while (stack.length !== 0) {
    const { node, nestingLevel } = stack.pop()!;
    const id = node.id.toString();

    const isOpened = yield refresh
      ? {
          defaultHeight: itemSize,
          id,
          isLeaf: node.children.length === 0 && !node.isDirectory,
          isOpenByDefault: false,
          name: node.name,
          nestingLevel
        }
      : id;

    if (node.children.length !== 0 && isOpened) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push({
          nestingLevel: nestingLevel + 1,
          node: node.children[i]
        });
      }
    }
  }
}

type TreePresenterProps = Readonly<{
  directoryPath: string;
  itemSize: number;
}>;

const TreePresenter: FC<TreePresenterProps> = ({ directoryPath, itemSize }) => {
  const tree = useRef<VariableSizeTree<ExtendedData>>(null);
  const [rootNode, setRootNode] = useState<DataNode | null>(null);
  const [nodes, setNodes] = useState<DataNode[]>([]);

  useEffect(() => {
    const fetchRootNode = async (directoryPath: string): Promise<DataNode> => {
      const rootFileItem: FileItem = {
        filename: directoryPath,
        path: directoryPath,
        isDirectory: true,
        children: await window['api'].getFiles(directoryPath)
      };
      return createNode(rootFileItem);
    };

    fetchRootNode(directoryPath).then(setRootNode);
  }, [directoryPath]);

  useEffect(() => {
    if (rootNode) {
      setNodes([rootNode]);
    }
  }, [rootNode]);

  return (
    <AutoSizer disableWidth>
      {({ height }) => (
        rootNode && (
          <VariableSizeTree
            ref={tree}
            itemData={{ itemSize, nodes, setNodes }}
            treeWalker={(refresh) => treeWalker(refresh, rootNode)}
            height={height}
            width="100%"
          >
            {Node}
          </VariableSizeTree>
        )
      )}
    </AutoSizer>
  );
};

export default TreePresenter;