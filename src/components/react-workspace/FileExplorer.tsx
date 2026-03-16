import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode2, FilePlus2, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';

interface TreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children: TreeNode[];
}

function insertPath(root: TreeNode, filePath: string) {
  const parts = filePath.split('/').filter(Boolean);
  let current = root;

  parts.forEach((part, index) => {
    const isLeaf = index === parts.length - 1;
    const currentPath = parts.slice(0, index + 1).join('/');
    let existing = current.children.find((child) => child.path === currentPath);

    if (!existing) {
      existing = {
        name: part,
        path: currentPath,
        type: isLeaf ? 'file' : 'directory',
        children: [],
      };
      current.children.push(existing);
    }

    current = existing;
  });
}

function sortTree(node: TreeNode): TreeNode {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
  return node;
}

const FileExplorer: React.FC = () => {
  const project = useProjectStore((state) => state.activeProject);
  const activeFilePath = useProjectStore((state) => state.activeFilePath);
  const selectedPaths = useProjectStore((state) => state.selectedPaths);
  const openFile = useProjectStore((state) => state.openFile);
  const setSelectedPaths = useProjectStore((state) => state.setSelectedPaths);
  const createFile = useProjectStore((state) => state.createFile);
  const renamePath = useProjectStore((state) => state.renamePath);
  const deletePath = useProjectStore((state) => state.deletePath);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const tree = useMemo(() => {
    const root: TreeNode = { name: project?.name || 'Project', path: '', type: 'directory', children: [] };
    if (!project) return root;

    Object.keys(project.files)
      .filter((path) => !path.endsWith('.gitkeep'))
      .forEach((path) => insertPath(root, path));

    return sortTree(root);
  }, [project]);

  if (!project) {
    return (
      <div className="react-workspace-empty-pane">
        <Folder size={20} />
        <span>Import a React project zip or create a starter workspace.</span>
      </div>
    );
  }

  const handleCreateFile = () => {
    const nextPath = window.prompt('Create file at path', activeFilePath ? activeFilePath.replace(/[^/]+$/, 'NewFile.tsx') : 'src/NewFile.tsx');
    if (!nextPath) return;
    createFile(nextPath, '');
  };

  const handleCreateFolder = () => {
    const nextPath = window.prompt('Create folder at path', 'src/components');
    if (!nextPath) return;
    createFile(`${nextPath.replace(/\/+$/, '')}/.gitkeep`, '');
  };

  const handleRename = () => {
    const target = selectedPaths[0] || activeFilePath;
    if (!target) return;
    const nextPath = window.prompt('Rename selected path', target);
    if (!nextPath || nextPath === target) return;
    renamePath(target, nextPath);
  };

  const handleDelete = () => {
    const target = selectedPaths[0] || activeFilePath;
    if (!target) return;
    const confirmed = window.confirm(`Delete "${target}" from the workspace?`);
    if (!confirmed) return;
    deletePath(target);
  };

  const renderNode = (node: TreeNode, depth = 0): React.ReactNode => {
    if (node.path && node.name === '.gitkeep') return null;

    const isDirectory = node.type === 'directory';
    const isCollapsed = collapsed[node.path];
    const isActive = node.path === activeFilePath || selectedPaths.includes(node.path);

    return (
      <div key={node.path || 'root'}>
        {node.path && (
          <button
            className={`react-workspace-tree-node ${isActive ? 'react-workspace-tree-node--active' : ''}`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => {
              if (isDirectory) {
                setCollapsed((state) => ({ ...state, [node.path]: !state[node.path] }));
                setSelectedPaths([node.path]);
              } else {
                openFile(node.path);
              }
            }}
          >
            <span className="react-workspace-tree-node__icon">
              {isDirectory ? (
                isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />
              ) : (
                <FileCode2 size={14} />
              )}
            </span>
            <span className="react-workspace-tree-node__icon react-workspace-tree-node__icon--filetype">
              {isDirectory ? <Folder size={14} /> : null}
            </span>
            <span className="react-workspace-tree-node__label">{node.name}</span>
          </button>
        )}

        {(!node.path || (!isCollapsed && isDirectory)) && node.children.map((child) => renderNode(child, node.path ? depth + 1 : depth))}
      </div>
    );
  };

  return (
    <div className="react-workspace-pane react-workspace-file-explorer">
      <div className="react-workspace-pane-header">
        <span>Files</span>
        <div className="react-workspace-pane-actions">
          <button onClick={handleCreateFile} title="Create file"><FilePlus2 size={14} /></button>
          <button onClick={handleCreateFolder} title="Create folder"><FolderPlus size={14} /></button>
          <button onClick={handleRename} title="Rename selected"><Pencil size={14} /></button>
          <button onClick={handleDelete} title="Delete selected"><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="react-workspace-tree">
        {renderNode(tree)}
      </div>
    </div>
  );
};

export default FileExplorer;
