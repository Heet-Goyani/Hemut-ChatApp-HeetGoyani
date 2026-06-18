'use client';

import { useEffect, useRef, useState } from 'react';
import {
  fetchRAGDocuments,
  uploadRAGDocument,
  deleteRAGDocument,
  chatWithRAG,
  RAGDocument
} from '@/lib/api';

interface RAGPanelProps {
  channelId: string;
  channelName?: string;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  created_at: string;
  sources?: Array<{ filename: string; chunk_index: number; score: number }>;
}

export default function RAGPanel({ channelId, channelName, onClose }: RAGPanelProps) {
  const [documents, setDocuments] = useState<RAGDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [uploading, setUploading] = useState(false);
  
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputVal, setInputVal] = useState('');
  const [loadingAnswer, setLoadingAnswer] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Load documents for channel
  const loadDocs = async () => {
    setLoadingDocs(true);
    try {
      const data = await fetchRAGDocuments(channelId);
      setDocuments(data);
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Failed to load documents.');
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    loadDocs();
    setChatMessages([]);
    setErrorMsg(null);
  }, [channelId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, loadingAnswer]);

  const handleFileUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check size limit (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('File size exceeds the maximum limit of 10MB.');
      return;
    }

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['txt', 'md', 'pdf'].includes(ext)) {
      setErrorMsg('Unsupported file format. Please upload .txt, .md, or .pdf files.');
      return;
    }

    setErrorMsg(null);
    setUploading(true);
    try {
      await uploadRAGDocument(channelId, file);
      await loadDocs();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to upload document.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteDoc = async (id: string) => {
    if (!confirm('Delete this document? It will be removed from the AI search context.')) return;
    setErrorMsg(null);
    try {
      await deleteRAGDocument(id);
      await loadDocs();
    } catch (err: any) {
      setErrorMsg('Failed to delete document.');
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || loadingAnswer) return;

    const userText = inputVal.trim();
    setInputVal('');
    setErrorMsg(null);

    // Add user message
    const userMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: 'user',
      text: userText,
      created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setLoadingAnswer(true);

    try {
      const response = await chatWithRAG(channelId, userText);
      const aiMsg: ChatMessage = {
        id: Math.random().toString(),
        sender: 'ai',
        text: response.answer,
        created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sources: response.sources
      };
      setChatMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      setErrorMsg(err.message || 'Error fetching answer.');
      const errorAI: ChatMessage = {
        id: Math.random().toString(),
        sender: 'ai',
        text: 'Sorry, I encountered an error while searching the context. Make sure you have uploaded documents to this channel.',
        created_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setChatMessages((prev) => [...prev, errorAI]);
    } finally {
      setLoadingAnswer(false);
    }
  };

  return (
    <div className="thread-drawer rag-drawer">
      {/* Header */}
      <div className="thread-drawer-header">
        <div className="thread-drawer-title-area">
          <span className="thread-drawer-title">📂 Document Q&A (RAG)</span>
          {channelName && <span className="thread-drawer-subtitle">#{channelName} Context</span>}
        </div>
        <button className="dm-modal-close" onClick={onClose} aria-label="Close panel">✕</button>
      </div>

      <div className="thread-drawer-body" style={{ padding: 'var(--space-4)', gap: 'var(--space-4)' }}>
        
        {/* Error alert banner */}
        {errorMsg && (
          <div className="alert alert-error" style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--error)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-2) var(--space-3)',
            fontSize: '0.8125rem',
            color: 'var(--error)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>⚠️ {errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} style={{ background: 'transparent', border: 'none', color: 'var(--error)', cursor: 'pointer', fontWeight: 600 }}>✕</button>
          </div>
        )}

        {/* Document section */}
        <div className="rag-documents-section" style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
              Context Documents
            </span>
            <button
              onClick={handleFileUploadClick}
              disabled={uploading}
              className="btn btn-primary btn-sm"
              style={{ padding: '3px 8px', fontSize: '0.75rem', gap: '4px' }}
            >
              {uploading ? 'Uploading...' : '＋ Add File'}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".txt,.md,.pdf"
              style={{ display: 'none' }}
            />
          </div>

          {loadingDocs ? (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>Loading files...</div>
          ) : documents.length === 0 ? (
            <div style={{
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
              textAlign: 'center',
              padding: '16px 8px',
              border: '1px dashed var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-overlay)'
            }}>
              No documents uploaded. Add TXT, MD, or PDF documents to discuss them!
            </div>
          ) : (
            <div className="rag-doc-list" style={{
              maxHeight: '120px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              {documents.map((doc) => (
                <div key={doc.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: 'var(--bg-overlay)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.75rem'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, marginRight: '8px' }}>
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={doc.filename}>
                      📄 {doc.filename}
                    </span>
                    <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                      {(doc.file_size / 1024).toFixed(1)} KB • {new Date(doc.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteDoc(doc.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--error)',
                      cursor: 'pointer',
                      padding: '2px 4px',
                      fontSize: '0.875rem'
                    }}
                    title="Remove context"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Chat window Q&A */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)'
        }}>
          
          {/* Chat history */}
          <div className="rag-chat-history" style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)'
          }}>
            {chatMessages.length === 0 ? (
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                color: 'var(--text-muted)',
                padding: 'var(--space-6) var(--space-4)'
              }}>
                <span style={{ fontSize: '2rem', marginBottom: '8px' }}>🤖</span>
                <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>AI Document Chat</p>
                <p style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                  Ask questions about any of the uploaded files above. The AI will query the text chunks and provide an answer.
                </p>
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div key={msg.id} style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  width: '100%'
                }}>
                  <div style={{
                    maxWidth: '85%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-lg)',
                    borderTopRightRadius: msg.sender === 'user' ? '2px' : 'var(--radius-lg)',
                    borderTopLeftRadius: msg.sender === 'ai' ? '2px' : 'var(--radius-lg)',
                    background: msg.sender === 'user' ? 'hsla(222, 78%, 52%, 0.15)' : 'var(--bg-raised)',
                    border: '1px solid',
                    borderColor: msg.sender === 'user' ? 'hsla(222, 78%, 52%, 0.25)' : 'var(--border-subtle)',
                    fontSize: '0.875rem',
                    lineHeight: '1.45',
                    color: 'var(--text-primary)',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {msg.text}
                  </div>
                  
                  {/* Sources display */}
                  {msg.sender === 'ai' && msg.sources && msg.sources.length > 0 && (
                    <div style={{
                      fontSize: '0.6875rem',
                      color: 'var(--text-muted)',
                      marginTop: '4px',
                      paddingLeft: '4px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '4px'
                    }}>
                      <span style={{ fontWeight: 600 }}>Sources:</span>
                      {msg.sources.map((src, i) => (
                        <span key={i} title={`Similarity Score: ${src.score}`}>
                          {src.filename} (chunk #{src.chunk_index}){i < (msg.sources?.length ?? 0) - 1 ? ' •' : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  <span style={{
                    fontSize: '0.625rem',
                    color: 'var(--text-muted)',
                    marginTop: '2px',
                    padding: '0 4px'
                  }}>
                    {msg.created_at}
                  </span>
                </div>
              ))
            )}

            {/* Answer Loader */}
            {loadingAnswer && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                width: '100%'
              }}>
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-lg)',
                  borderTopLeftRadius: '2px',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span className="spinner" style={{ width: '12px', height: '12px' }} />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Searching documents...</span>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Chat Form Input */}
          <form onSubmit={handleSendMessage} style={{
            padding: 'var(--space-3)',
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-raised)',
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'center'
          }}>
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              placeholder={documents.length === 0 ? "Upload a document first..." : "Ask about the documents..."}
              disabled={documents.length === 0 || loadingAnswer}
              className="input"
              style={{
                flex: 1,
                fontSize: '0.8125rem',
                padding: '6px 10px',
                height: '32px'
              }}
            />
            <button
              type="submit"
              disabled={!inputVal.trim() || loadingAnswer || documents.length === 0}
              className="btn btn-primary"
              style={{
                width: '32px',
                height: '32px',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
              aria-label="Send query"
            >
              ➔
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
