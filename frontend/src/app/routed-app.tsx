import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getConversations, getWorkspaces } from '../api';
import { SIDEBAR_STORAGE_KEY, THEME_STORAGE_KEY } from './constants';
import { AppSidebar } from './app-sidebar';
import type { Conversation, Theme, Workspace } from '../types';
import { LoadingState } from '../components/ui/state';

const ChatHomePage = lazy(() =>
  import('../features/chat/chat-home-page').then(module => ({ default: module.ChatHomePage }))
);
const GeneralChatPage = lazy(() =>
  import('../features/chat/general-chat-page').then(module => ({ default: module.GeneralChatPage }))
);
const WorkspaceIndexPage = lazy(() =>
  import('../features/workspaces/workspace-index-page').then(module => ({ default: module.WorkspaceIndexPage }))
);
const CreateWorkspacePage = lazy(() =>
  import('../features/workspaces/create-workspace-page').then(module => ({ default: module.CreateWorkspacePage }))
);
const WorkspaceHubPage = lazy(() =>
  import('../features/workspaces/workspace-hub-page').then(module => ({ default: module.WorkspaceHubPage }))
);
const WorkspaceChatPage = lazy(() =>
  import('../features/workspaces/workspace-chat-page').then(module => ({ default: module.WorkspaceChatPage }))
);

export function RoutedApp() {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme === 'dark' ? 'dark' : 'light';
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved !== null) return saved === 'true';
    return window.innerWidth >= 1100;
  });
  const [generalChats, setGeneralChats] = useState<Conversation[]>([]);
  const [loadingGeneralChats, setLoadingGeneralChats] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  const refreshGeneralChats = useCallback(async () => {
    setLoadingGeneralChats(true);
    try {
      const all = await getConversations();
      setGeneralChats(all.filter(conversation => !conversation.workspace_id));
    } finally {
      setLoadingGeneralChats(false);
    }
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    setLoadingWorkspaces(true);
    try {
      setWorkspaces(await getWorkspaces());
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([refreshGeneralChats(), refreshWorkspaces()]);
  }, [refreshGeneralChats, refreshWorkspaces]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent text-[var(--text-primary)]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.5),transparent_34%),radial-gradient(circle_at_85%_15%,color-mix(in_srgb,var(--accent)_20%,transparent),transparent_30%)] dark:bg-none" />
      <AppSidebar
        open={sidebarOpen}
        theme={theme}
        setTheme={setTheme}
        onToggleOpen={() => setSidebarOpen(current => !current)}
        generalChats={generalChats}
        loadingGeneralChats={loadingGeneralChats}
        workspaces={workspaces}
        loadingWorkspaces={loadingWorkspaces}
        onGeneralChatsUpdated={refreshGeneralChats}
      />
      <main
        className={[
          'relative min-h-screen px-4 pb-8 pt-20 transition-all duration-300 lg:pr-6',
          sidebarOpen ? 'lg:pl-[calc(var(--sidebar-width)+1.5rem)]' : 'lg:pl-24',
        ].join(' ')}
      >
        <div className="mx-auto w-full">
          <Suspense fallback={<RouteLoadingState />}>
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatHomePage onChatsUpdated={refreshGeneralChats} />} />
              <Route path="/chat/:conversationId" element={<GeneralChatPage onChatsUpdated={refreshGeneralChats} />} />
              <Route path="/workspaces" element={<WorkspaceIndexPage workspaces={workspaces} loading={loadingWorkspaces} />} />
              <Route path="/workspaces/new" element={<CreateWorkspacePage onCreated={refreshWorkspaces} />} />
              <Route path="/workspaces/:workspaceId" element={<WorkspaceHubPage onWorkspaceUpdated={refreshWorkspaces} />} />
              <Route path="/workspaces/:workspaceId/chats/:conversationId" element={<WorkspaceChatPage onWorkspaceUpdated={refreshWorkspaces} />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  );
}

function RouteLoadingState() {
  return (
    <section className="space-y-4 py-8">
      <LoadingState label="Loading view" />
    </section>
  );
}
