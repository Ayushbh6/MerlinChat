import React, { useState, useRef, useEffect } from 'react';
import { Send, Menu, X, Plus, Lightbulb, ChevronDown, ChevronRight, Trash2, Edit2, Check, Cpu } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import './App.css';

const API_BASE = 'http://localhost:8000/api';

interface Message {
  _id?: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
}

interface Conversation {
  _id: string;
  title: string;
  created_at: string;
  token_count?: number;
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [input, setInput] = useState('');
  const [thinkingMode, setThinkingMode] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [currentTokenCount, setCurrentTokenCount] = useState<number>(0);
  
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [input]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (chatAreaRef.current) {
      chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  // Load conversations on mount
  useEffect(() => {
    fetch(`${API_BASE}/conversations`)
      .then(res => res.json())
      .then(data => {
        setConversations(data);
      })
      .catch(err => console.error("Failed to load conversations:", err));
  }, []);

  const loadConversation = async (id: string) => {
    setActiveConvId(id);
    setMessages([]);
    setCurrentTokenCount(0);
    try {
      const res = await fetch(`${API_BASE}/conversations/${id}/messages`);
      const data = await res.json();
      setMessages(data);
      const conv = conversations.find(c => c._id === id);
      if (conv?.token_count) setCurrentTokenCount(conv.token_count);
    } catch (err) {
      console.error(err);
    }
  };

  const startNewChat = () => {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
    setCurrentTokenCount(0);
    textareaRef.current?.focus();
  };

  const deleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this conversation?")) {
      return;
    }
    try {
      await fetch(`${API_BASE}/conversations/${id}`, { method: 'DELETE' });
      setConversations(prev => prev.filter(c => c._id !== id));
      if (activeConvId === id) {
        startNewChat();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const startRename = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingConvId(conv._id);
    setEditTitle(conv.title);
  };

  const submitRename = async (e: React.MouseEvent | React.KeyboardEvent, id: string) => {
    e.stopPropagation();
    if (!editTitle.trim()) {
      setEditingConvId(null);
      return;
    }
    try {
      await fetch(`${API_BASE}/conversations/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle })
      });
      setConversations(prev => prev.map(c => c._id === id ? { ...c, title: editTitle } : c));
      setEditingConvId(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);

    const payload = {
      conversation_id: activeConvId,
      message: userMsg.content,
      model: 'qwen/qwen3.5-122b-a10b',
      thinking: thinkingMode
    };

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.body) throw new Error("No body in response");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      setMessages(prev => [...prev, { role: 'assistant', content: '', thinking: '' }]);
      
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (dataStr === '[DONE]') {
                setIsStreaming(false);
                break;
              }
              try {
                const data = JSON.parse(dataStr);
                if (data.type === 'meta') {
                  setActiveConvId(data.conversation_id);
                  // Refresh history list to update title if it was "New Chat"
                  fetch(`${API_BASE}/conversations`)
                    .then(res => res.json())
                    .then(setConversations);
                } else if (data.type === 'token_count') {
                  setCurrentTokenCount(data.count);
                  setConversations(prev => prev.map(c => 
                    c._id === activeConvId ? { ...c, token_count: data.count } : c
                  ));
                } else if (data.type === 'thinking') {
                  setMessages(prev => {
                    const newMsgs = [...prev];
                    const last = { ...newMsgs[newMsgs.length - 1] };
                    last.thinking = (last.thinking || '') + data.content;
                    newMsgs[newMsgs.length - 1] = last;
                    return newMsgs;
                  });
                } else if (data.type === 'content') {
                  setMessages(prev => {
                    const newMsgs = [...prev];
                    const last = { ...newMsgs[newMsgs.length - 1] };
                    last.content = (last.content || '') + data.content;
                    newMsgs[newMsgs.length - 1] = last;
                    return newMsgs;
                  });
                }
              } catch (e) {
                // partial chunks or parsing errors
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isChatStarted = messages.length > 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 5) return 'Good night';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    if (hour < 21) return 'Good evening';
    return 'Good night';
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? '' : 'closed'}`}>
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={startNewChat}>
            <Plus size={14} /> New chat
          </button>
          <button className="close-sidebar-btn" onClick={() => setSidebarOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <div className="history-list">
          {conversations.length > 0 && (
            <div className="history-section-label">Conversations</div>
          )}
          {conversations.map(conv => (
            <div 
              key={conv._id} 
              className={`history-item ${activeConvId === conv._id ? 'active' : ''}`}
              onClick={() => loadConversation(conv._id)}
            >
              {editingConvId === conv._id ? (
                <div className="history-item-edit" onClick={e => e.stopPropagation()}>
                  <input 
                    autoFocus
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitRename(e, conv._id)}
                  />
                  <button onClick={e => submitRename(e, conv._id)}><Check size={14}/></button>
                </div>
              ) : (
                <>
                  <span className="history-item-title">{conv.title || 'New Conversation'}</span>
                  <div className="history-item-actions">
                    <button onClick={(e) => startRename(e, conv)}><Edit2 size={14}/></button>
                    <button onClick={(e) => deleteConversation(e, conv._id)}><Trash2 size={14}/></button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="header">
          {!sidebarOpen && (
            <button className="open-sidebar-btn" onClick={() => setSidebarOpen(true)}>
              <Menu size={24} />
            </button>
          )}
          {isChatStarted && currentTokenCount > 0 && (
            <div className="token-counter" title="Tokens used in context">
              <Cpu size={14} />
              <span>{currentTokenCount.toLocaleString()} / 60,000</span>
            </div>
          )}
        </div>

        <div className="chat-area" ref={chatAreaRef}>
          <div className="messages-container">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="msg-bubble">
                  {msg.role === 'assistant' && msg.thinking && (
                    <ThinkingBlock thinking={msg.thinking} />
                  )}
                  {msg.role === 'assistant' ? (
                    <div className="prose">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                      {isStreaming && idx === messages.length - 1 && msg.content === '' && !msg.thinking && (
                        <OrbPulse />
                      )}
                    </div>
                  ) : (
                    <div className="prose">{msg.content}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input Area */}
        <div className={`input-container ${isChatStarted ? 'bottom' : 'centered'}`}>
          {!isChatStarted && (
            <div className="hero-title">
              {getGreeting()}. How can I help?
            </div>
          )}
          <div className="input-box">
            <textarea
              ref={textareaRef}
              className="input-textarea"
              placeholder="Ask anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <div className="input-actions">
              <button
                className={`thinking-toggle-btn ${thinkingMode ? 'active' : ''}`}
                onClick={() => setThinkingMode(!thinkingMode)}
                title={thinkingMode ? 'Thinking mode on' : 'Thinking mode off'}
              >
                <Lightbulb size={12} />
                <span>Think</span>
              </button>
              <button 
                className="send-btn" 
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrbPulse() {
  return <span className="orb-pulse" />;
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = useState(true);
  
  return (
    <div className="thinking-block">
      <div className="thinking-header" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="thinking-title">Thought Process</span>
      </div>
      {open && (
        <div className="thinking-content">
          <div className="prose">
            <ReactMarkdown>{thinking}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
