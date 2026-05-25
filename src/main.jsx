import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from 'marked';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Menu,
  Search,
  X,
} from 'lucide-react';
import { bookData } from './generated/book-data.js';
import './styles.css';

marked.use({
  gfm: true,
  breaks: false,
});

const statusText = {
  draft: '已起草',
  planned: '待扩写',
  published: '已发布',
};

const statusClass = {
  draft: 'status-draft',
  planned: 'status-planned',
  published: 'status-published',
};

function flattenChapters(parts) {
  return parts.flatMap((part) =>
    (part.chapters ?? []).map((chapter) => ({
      ...chapter,
      partId: part.id,
      partTitle: part.title,
    })),
  );
}

function getInitialChapterId(chapters) {
  const hashId = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
  if (chapters.some((chapter) => chapter.id === hashId)) return hashId;
  if (chapters.some((chapter) => chapter.id === bookData.start)) return bookData.start;
  return chapters[0]?.id;
}

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

function App() {
  const navChapters = useMemo(() => flattenChapters(bookData.parts ?? []), []);
  const contentById = useMemo(() => new Map((bookData.chapters ?? []).map((chapter) => [chapter.id, chapter])), []);
  const [activeId, setActiveId] = useState(() => getInitialChapterId(navChapters));
  const [query, setQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeIndex = navChapters.findIndex((chapter) => chapter.id === activeId);
  const navChapter = navChapters[activeIndex] ?? navChapters[0];
  const activeChapter = contentById.get(navChapter?.id) ?? navChapter;
  const previousChapter = activeIndex > 0 ? navChapters[activeIndex - 1] : null;
  const nextChapter = activeIndex >= 0 && activeIndex < navChapters.length - 1 ? navChapters[activeIndex + 1] : null;

  useEffect(() => {
    const onHashChange = () => {
      const hashId = decodeURIComponent(window.location.hash.replace(/^#\/?/, ''));
      if (navChapters.some((chapter) => chapter.id === hashId)) setActiveId(hashId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navChapters]);

  useEffect(() => {
    if (!activeId) return;
    const nextHash = `#/${encodeURIComponent(activeId)}`;
    if (window.location.hash !== nextHash) window.history.replaceState(null, '', nextHash);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeId]);

  const renderedHtml = useMemo(() => {
    if (!activeChapter?.hasContent) return '';
    return marked.parse(activeChapter.markdown ?? '');
  }, [activeChapter]);

  const filteredParts = useMemo(() => {
    const needle = normalizeText(query.trim());
    if (!needle) return bookData.parts ?? [];
    return (bookData.parts ?? [])
      .map((part) => ({
        ...part,
        chapters: (part.chapters ?? []).filter((chapter) => {
          const content = contentById.get(chapter.id);
          const haystack = [
            part.title,
            chapter.order,
            chapter.title,
            chapter.level,
            chapter.status,
            ...(chapter.tags ?? []),
            ...(chapter.summary ?? []),
            content?.markdown ?? '',
          ]
            .map(normalizeText)
            .join(' ');
          return haystack.includes(needle);
        }),
      }))
      .filter((part) => part.chapters.length > 0);
  }, [contentById, query]);

  const completedCount = (bookData.chapters ?? []).filter((chapter) => chapter.hasContent).length;
  const progress = navChapters.length ? Math.round((completedCount / navChapters.length) * 100) : 0;

  function selectChapter(id) {
    setActiveId(id);
    setSidebarOpen(false);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'is-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <BookOpen size={22} />
          </div>
          <div>
            <p>{bookData.shortTitle}</p>
            <h1>{bookData.title}</h1>
          </div>
          <button className="icon-button close-sidebar" type="button" onClick={() => setSidebarOpen(false)} aria-label="关闭目录">
            <X size={18} />
          </button>
        </div>

        <div className="search-box">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索章节、标签、正文"
            aria-label="搜索章节"
          />
        </div>

        <div className="progress-panel">
          <div>
            <span>{completedCount}</span>
            <small>/ {navChapters.length} 章已有正文</small>
          </div>
          <div className="progress-track" aria-label={`写作进度 ${progress}%`}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>

        <nav className="chapter-nav" aria-label="章节目录">
          {filteredParts.map((part) => (
            <section key={part.id} className="nav-part">
              <h2>{part.title}</h2>
              {(part.chapters ?? []).map((chapter) => {
                const content = contentById.get(chapter.id);
                const isActive = chapter.id === activeId;
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    className={`chapter-link ${isActive ? 'is-active' : ''}`}
                    onClick={() => selectChapter(chapter.id)}
                  >
                    <span className="chapter-order">{chapter.order || '--'}</span>
                    <span className="chapter-label">
                      <strong>{chapter.title}</strong>
                      <small>{content?.hasContent ? '可阅读' : statusText[chapter.status] || chapter.status}</small>
                    </span>
                    {content?.hasContent ? <CheckCircle2 size={16} /> : <FileText size={16} />}
                  </button>
                );
              })}
            </section>
          ))}
        </nav>
      </aside>

      <div className="overlay" onClick={() => setSidebarOpen(false)} />

      <main className="reader">
        <header className="topbar">
          <button className="icon-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="打开目录">
            <Menu size={20} />
          </button>
          <div>
            <span>{activeChapter?.partTitle}</span>
            <strong>{activeChapter?.title}</strong>
          </div>
        </header>

        <article className="chapter">
          <div className="chapter-kicker">
            <span>第 {activeChapter?.order || '--'} 章</span>
            <span className={`status-pill ${statusClass[activeChapter?.status] || ''}`}>
              {activeChapter?.hasContent ? '可阅读' : statusText[activeChapter?.status] || activeChapter?.status}
            </span>
          </div>

          <h1>{activeChapter?.title}</h1>

          <div className="chapter-meta">
            <span>{activeChapter?.level}</span>
            {(activeChapter?.tags ?? []).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>

          {(activeChapter?.summary ?? []).length > 0 && (
            <section className="summary-band" aria-label="本章摘要">
              {(activeChapter.summary ?? []).map((item) => (
                <p key={item}>{item}</p>
              ))}
            </section>
          )}

          {activeChapter?.hasContent ? (
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          ) : (
            <div className="empty-state">
              <FileText size={34} />
              <h2>这一章还没有正文</h2>
              <p>在 {activeChapter?.source} 新增 Markdown 内容后，GitHub Actions 会在下一次部署时自动渲染到这里。</p>
            </div>
          )}

          <footer className="chapter-pager">
            <PagerButton chapter={previousChapter} direction="prev" onSelect={selectChapter} />
            <PagerButton chapter={nextChapter} direction="next" onSelect={selectChapter} />
          </footer>
        </article>
      </main>
    </div>
  );
}

function PagerButton({ chapter, direction, onSelect }) {
  if (!chapter) return <span />;
  const isPrev = direction === 'prev';
  return (
    <button type="button" className="pager-button" onClick={() => onSelect(chapter.id)}>
      {isPrev && <ChevronLeft size={18} />}
      <span>
        <small>{isPrev ? '上一章' : '下一章'}</small>
        <strong>{chapter.title}</strong>
      </span>
      {!isPrev && <ChevronRight size={18} />}
    </button>
  );
}

createRoot(document.getElementById('root')).render(<App />);
