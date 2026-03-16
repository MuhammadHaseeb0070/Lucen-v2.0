import React from 'react';
import { X } from 'lucide-react';
import { useProjectStore } from '../../store/projectStore';

const EditorTabs: React.FC = () => {
  const openTabs = useProjectStore((state) => state.openTabs);
  const activeFilePath = useProjectStore((state) => state.activeFilePath);
  const activeProject = useProjectStore((state) => state.activeProject);
  const setActiveFile = useProjectStore((state) => state.setActiveFile);
  const closeFile = useProjectStore((state) => state.closeFile);

  if (!activeProject) return null;

  return (
    <div className="react-workspace-editor-tabs">
      {openTabs.length === 0 ? (
        <div className="react-workspace-editor-tabs__empty">Open a file to start editing.</div>
      ) : (
        openTabs.map((tab) => {
          const file = activeProject.files[tab.path];
          const label = file?.name || tab.path.split('/').pop() || tab.path;
          return (
            <button
              key={tab.path}
              className={`react-workspace-editor-tab ${tab.path === activeFilePath ? 'react-workspace-editor-tab--active' : ''}`}
              onClick={() => setActiveFile(tab.path)}
            >
              <span className="react-workspace-editor-tab__label">{label}</span>
              {tab.isDirty && <span className="react-workspace-editor-tab__dirty" />}
              <span
                className="react-workspace-editor-tab__close"
                onClick={(event) => {
                  event.stopPropagation();
                  closeFile(tab.path);
                }}
              >
                <X size={12} />
              </span>
            </button>
          );
        })
      )}
    </div>
  );
};

export default EditorTabs;
