import React from 'react';
import { X, ZoomIn, ZoomOut, Download, Copy, Check } from 'lucide-react';
import { useUIStore } from '../store/uiStore';
import FileIcon from './FileIcon';

const AttachmentViewer: React.FC = () => {
    const { viewerOpen, viewerFile, setViewerOpen, setViewerFile } = useUIStore();
    const [zoom, setZoom] = React.useState(1);
    const [copied, setCopied] = React.useState(false);

    if (!viewerOpen || !viewerFile) return null;

    const handleClose = () => {
        setViewerOpen(false);
        setViewerFile(null);
        setZoom(1);
    };

    const handleCopy = async () => {
        if (viewerFile.textContent) {
            await navigator.clipboard.writeText(viewerFile.textContent);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const isImage = viewerFile.type === 'image';

    return (
        <div className="attachment-viewer-overlay" onClick={handleClose}>
            <div className="attachment-viewer-header" onClick={e => e.stopPropagation()}>
                <div className="viewer-title">
                    <FileIcon name={viewerFile.name} type={viewerFile.type} size={18} />
                    <span className="truncate">{viewerFile.name}</span>
                </div>
                <div className="viewer-actions">
                    {isImage && (
                        <>
                            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} title="Zoom Out">
                                <ZoomOut size={20} />
                            </button>
                            <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} title="Zoom In">
                                <ZoomIn size={20} />
                            </button>
                        </>
                    )}
                    {!isImage && viewerFile.textContent && (
                        <button onClick={handleCopy} title="Copy Content">
                            {copied ? <Check size={20} /> : <Copy size={20} />}
                        </button>
                    )}
                    {viewerFile.url && (
                        <a href={viewerFile.url} download={viewerFile.name} className="download-link" title="Download">
                            <Download size={20} />
                        </a>
                    )}
                    <button className="close-btn" onClick={handleClose}>
                        <X size={24} />
                    </button>
                </div>
            </div>

            <div className="attachment-viewer-content" onClick={handleClose}>
                <div className="viewer-inner" onClick={e => e.stopPropagation()}>
                    {isImage ? (
                        <div className="image-container">
                            <img 
                                src={viewerFile.url} 
                                alt={viewerFile.name} 
                                style={{ transform: `scale(${zoom})` }}
                            />
                        </div>
                    ) : (
                        <div className="text-container">
                            {viewerFile.textContent || viewerFile.aiDescription ? (
                                <pre>{viewerFile.textContent || viewerFile.aiDescription}</pre>
                            ) : (
                                <div className="no-preview">
                                    <FileText size={48} />
                                    <p>No text preview available for this file type.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .attachment-viewer-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.9);
                    backdrop-filter: blur(10px);
                    z-index: 2000;
                    display: flex;
                    flex-direction: column;
                    animation: fadeIn 0.25s ease-out;
                }

                .attachment-viewer-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: calc(16px * var(--lib-s-scale, 1)) calc(24px * var(--lib-s-scale, 1));
                    background: rgba(255, 255, 255, 0.05);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                    color: white;
                }

                .viewer-title {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-weight: 500;
                    font-size: calc(1rem * var(--lib-f-scale, 1));
                    flex: 1;
                    min-width: 0;
                }

                .viewer-title .truncate {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .viewer-actions {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    flex-shrink: 0;
                }

                .viewer-actions button, .download-link {
                    background: transparent;
                    border: none;
                    color: rgba(255, 255, 255, 0.7);
                    cursor: pointer;
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .viewer-actions button:hover, .download-link:hover {
                    color: white;
                    transform: scale(1.1);
                }

                .attachment-viewer-content {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 40px;
                    overflow: hidden;
                }

                .viewer-inner {
                    max-width: 100%;
                    max-height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .image-container img {
                    max-width: 90vw;
                    max-height: 80vh;
                    object-fit: contain;
                    border-radius: 8px;
                    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                }

                .text-container {
                    background: #1a1a1a;
                    padding: 32px;
                    border-radius: 16px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    max-width: 800px;
                    max-height: 80vh;
                    overflow-y: auto;
                    width: 100%;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                }

                .text-container pre {
                    color: #e0e0e0;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    font-family: 'JetBrains Mono', 'Fira Code', monospace;
                    font-size: 0.9rem;
                    line-height: 1.6;
                }

                .no-preview {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 16px;
                    color: rgba(255, 255, 255, 0.4);
                    padding: 40px;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }

                @media (max-width: 640px) {
                    .attachment-viewer-header {
                        padding: 10px 16px;
                    }
                    .viewer-actions { gap: 12px; }
                    .viewer-actions svg { width: 18px; height: 18px; }
                    .attachment-viewer-content {
                        padding: 16px;
                    }
                }
            `}</style>
        </div>
    );
};

export default AttachmentViewer;
