import React from 'react';
import { SandpackCodeEditor } from '@codesandbox/sandpack-react';
import { useProjectStore } from '../../store/projectStore';

const CodeEditorPane: React.FC = () => {
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeFilePath = useProjectStore((state) => state.activeFilePath);

  if (!activeProject || !activeFilePath) {
    return (
      <div className="react-workspace-empty-pane">
        <span>Select a file from the explorer to start editing.</span>
      </div>
    );
  }

  return (
    <div className="react-workspace-editor-pane">
      <div className="react-workspace-editor-pane__path">{activeFilePath}</div>
      <SandpackCodeEditor
        showTabs={false}
        showLineNumbers
        showInlineErrors
        wrapContent={false}
        closableTabs={false}
        className="react-workspace-code-editor"
      />
    </div>
  );
};

export default CodeEditorPane;
