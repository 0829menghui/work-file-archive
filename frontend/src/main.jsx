import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  BookOpen,
  Box,
  ChevronRight,
  Download,
  ExternalLink,
  FileArchive,
  FileBox,
  Folder,
  FolderPlus,
  HardDrive,
  History,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import "./styles.css";

function resolveApiBase() {
  return import.meta.env.VITE_API_BASE || "/work-file-archive/api";
}

const API = resolveApiBase();
const LEARNING_VIEW_STORAGE_KEY = "work-file-archive-learning-view-mode";
const LEARNING_UTILITY_DOCK_TOP_STORAGE_KEY = "work-file-archive-learning-dock-top";
const LEARNING_RECENT_SEARCH_STORAGE_KEY = "work-file-archive-learning-recent-searches";
const ARCHIVE_RECENT_SEARCH_STORAGE_KEY = "work-file-archive-archive-recent-searches";
const LEARNING_CUSTOM_TEMPLATES_STORAGE_KEY = "work-file-archive-learning-custom-templates";
const LEARNING_SNIPPET_META_STORAGE_KEY = "work-file-archive-learning-snippet-meta";
const GLOBAL_FINDER_RECENT_SEARCH_STORAGE_KEY = "work-file-archive-global-recent-searches";

const LEARNING_TEMPLATES = [
  {
    key: "study-note",
    name: "学习笔记",
    category: "学习笔记",
    tags: "学习笔记",
    status: "进行中",
    priority: "中",
    content: [
      "# 本次学习主题",
      "",
      "## 学习目标",
      "- 目标 1",
      "- 目标 2",
      "",
      "## 关键知识点",
      "- 结论 1",
      "- 结论 2",
      "",
      "## 复盘",
      "> 今天最值得沉淀的点是什么？",
    ].join("\n"),
  },
  {
    key: "sql-template",
    name: "SQL 模板",
    category: "SQL",
    tags: "SQL",
    status: "计划中",
    priority: "中",
    content: [
      "## SQL 名称",
      "",
      "- 用途：",
      "- 来源表：",
      "- 输出口径：",
      "- 注意事项：",
      "",
      "```sql",
      "select *",
      "from table_name",
      "where dt = '${biz_date}';",
      "```",
    ].join("\n"),
  },
  {
    key: "review-template",
    name: "复盘模板",
    category: "复盘",
    tags: "复盘",
    status: "计划中",
    priority: "中",
    content: [
      "# 事件背景",
      "",
      "## 做得好的",
      "- ",
      "",
      "## 暴露的问题",
      "- ",
      "",
      "## 后续动作",
      "- [ ] ",
    ].join("\n"),
  },
  {
    key: "troubleshoot-template",
    name: "问题排查模板",
    category: "问题排查",
    tags: "排查, SQL",
    status: "进行中",
    priority: "高",
    content: [
      "# 问题描述",
      "",
      "## 现象",
      "- ",
      "",
      "## 排查路径",
      "- ",
      "",
      "## 关键 SQL",
      "```sql",
      "select * from table_name limit 100;",
      "```",
      "",
      "## 结论",
      "> ",
    ].join("\n"),
  },
];

const PROJECT_STAGE_OPTIONS = ["建模", "材质", "灯光", "渲染", "导出", "交付", "归档"];

function getLearningDraftStorageKey(itemId) {
  return `work-file-archive-learning-draft-${itemId}`;
}

function parseRecentSearches(raw) {
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 8) : [];
  } catch {
    return [];
  }
}

function exportRowsToCsv(filename, headers, rows) {
  const escapeCell = (value) => {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.map((header) => escapeCell(header.label)).join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header.key])).join(",")),
  ];
  const blob = new Blob(["\ufeff", lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function pushRecentSearch(list, value) {
  const next = (value || "").trim();
  if (!next) return list;
  return [next, ...list.filter((item) => item !== next)].slice(0, 8);
}

function slugifyLearningAnchor(text = "") {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatSize(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

async function copyTextToClipboard(text = "") {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error("clipboard-unavailable");
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "readonly");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch(path, options = {}, token) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? authHeaders(token) : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    let message = "请求失败";
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {
      message = response.statusText || message;
    }
    throw new Error(message);
  }
  return response.json();
}

function buildTree(folders) {
  const byId = new Map();
  folders.forEach((folder) => byId.set(folder.id, { ...folder, children: [] }));
  const roots = [];
  byId.forEach((folder) => {
    if (folder.parent_id && byId.has(folder.parent_id)) {
      byId.get(folder.parent_id).children.push(folder);
    } else {
      roots.push(folder);
    }
  });
  return roots;
}

function buildLearningTree(items) {
  const byId = new Map();
  items.forEach((item) => byId.set(item.id, { ...normalizeLearningItem(item), children: [] }));
  const roots = [];
  byId.forEach((item) => {
    if (item.parent_id && byId.has(item.parent_id)) {
      byId.get(item.parent_id).children.push(item);
    } else {
      roots.push(item);
    }
  });
  const sortNodes = (nodes) => {
    nodes.sort((a, b) => {
      if (a.item_type !== b.item_type) {
        return a.item_type === "folder" ? -1 : 1;
      }
      return (a.title || "").localeCompare(b.title || "", "zh-Hans-CN");
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

function normalizeLearningItem(item) {
  const folderCategories = new Set(["目录", "文件夹"]);
  const inferredType = item.item_type
    || (folderCategories.has(item.category) && !item.content && !item.resource_url ? "folder" : "doc");
  const repairedType = inferredType === "doc"
    && folderCategories.has(item.category)
    && !item.content
    && !item.resource_url
    ? "folder"
    : inferredType;
  return {
    ...item,
    item_type: repairedType,
  };
}

function filterLearningTree(nodes, filters) {
  const keyword = (filters.query || "").trim().toLowerCase();
  const status = filters.status || "all";
  const itemType = filters.itemType || "all";
  if (!keyword && status === "all" && itemType === "all") return nodes;
  return nodes
    .map((node) => {
      const children = filterLearningTree(node.children || [], filters);
      const matched = `${node.title} ${node.category} ${node.tags || ""} ${node.content} ${node.resource_url || ""}`
        .toLowerCase()
        .includes(keyword);
      const statusMatched = status === "all" || node.status === status;
      const typeMatched = itemType === "all" || node.item_type === itemType;
      const selfMatched = (!keyword || matched) && statusMatched && typeMatched;
      if (selfMatched || children.length) return { ...node, children };
      return null;
    })
    .filter(Boolean);
}

function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="brand-mark">
          <Box size={34} />
        </div>
        <h1>个人模块化工作台</h1>
        <p>一个账号管理多个工作模块，分别服务文件归档和个人知识沉淀。</p>
        <form onSubmit={submit} className="login-form">
          <label>
            用户名
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <div className="error">{error}</div> : null}
          <button className="primary-button" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function FolderNode({
  folder,
  activeId,
  dragOverId,
  onSelect,
  onDragStart,
  onDropItem,
  onDragOverFolder,
  depth = 0,
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = folder.children.length > 0;
  return (
    <div>
      <button
        className={`tree-row ${activeId === folder.id ? "active" : ""} ${
          dragOverId === folder.id ? "drop-target" : ""
        }`}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        draggable
        onDragStart={(event) =>
          onDragStart(event, {
            type: "folder",
            id: folder.id,
            parentId: folder.parent_id,
            name: folder.name,
          })
        }
        onDragOver={(event) => {
          event.preventDefault();
          onDragOverFolder(folder.id);
        }}
        onDragLeave={() => onDragOverFolder(null)}
        onDrop={(event) => onDropItem(event, folder)}
        onClick={() => onSelect(folder)}
      >
        <span
          className="tree-toggle"
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {hasChildren ? <ChevronRight size={14} className={open ? "rotate" : ""} /> : null}
        </span>
        <Folder size={16} />
        <span>{folder.name}</span>
      </button>
      {open && hasChildren
        ? folder.children.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              activeId={activeId}
              dragOverId={dragOverId}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onDropItem={onDropItem}
              onDragOverFolder={onDragOverFolder}
              depth={depth + 1}
            />
          ))
        : null}
    </div>
  );
}

function LearningTreeNode({
  node,
  activeId,
  dragOverId,
  draggable = false,
  selectable = false,
  selectedIds = [],
  onSelect,
  onToggleSelect,
  onDragStart,
  onDropItem,
  onDragOverItem,
  depth = 0,
}) {
  const [open, setOpen] = useState(true);
  const isFolder = node.item_type === "folder";
  const hasChildren = (node.children || []).length > 0;
  const childCount = (node.children || []).length;
  return (
    <div
      className={isFolder ? "learning-folder-group" : ""}
      onDragOver={(event) => {
        if (!isFolder) return;
        event.preventDefault();
        onDragOverItem(node.id);
      }}
      onDragLeave={(event) => {
        if (!isFolder || event.currentTarget.contains(event.relatedTarget)) return;
        onDragOverItem(null);
      }}
      onDrop={(event) => {
        if (!isFolder) return;
        onDropItem(event, node);
      }}
    >
      <button
        type="button"
        draggable={draggable}
        data-full-title={node.title}
        className={`learning-tree-row ${isFolder ? "folder-row" : "doc-row"} ${
          activeId === node.id ? "active" : ""
        } ${
          dragOverId === node.id ? "drop-target" : ""
        }`}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
        onDragStart={(event) =>
          onDragStart(event, {
            scope: "learning",
            type: node.item_type,
            id: node.id,
            parentId: node.parent_id,
            title: node.title,
          })
        }
        onClick={() => onSelect(node)}
      >
        {selectable ? (
          <input
            type="checkbox"
            className="learning-select-box"
            checked={selectedIds.includes(node.id)}
            onChange={() => onToggleSelect(node.id)}
            onClick={(event) => event.stopPropagation()}
          />
        ) : null}
        <span
          className="tree-toggle"
          onClick={(event) => {
            if (!isFolder || !hasChildren) return;
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {isFolder && hasChildren ? <ChevronRight size={14} className={open ? "rotate" : ""} /> : null}
        </span>
        <span className={`learning-node-icon ${isFolder ? "folder" : "doc"}`}>
          {isFolder ? <Folder size={16} /> : <BookOpen size={16} />}
        </span>
        <span className="learning-node-title" title={node.title}>
          {node.title}
        </span>
        {isFolder ? (
          <span className="learning-child-count">{childCount} 项</span>
        ) : null}
        <small className={`learning-item-kind ${isFolder ? "folder" : "doc"}`}>
          {isFolder ? "文件夹" : "文档"}
        </small>
      </button>
      {isFolder ? (
        <div className="folder-drop-caption">拖入这里存放</div>
      ) : null}
      {isFolder && open
        ? (node.children || []).map((child) => (
            <LearningTreeNode
              key={child.id}
              node={child}
              activeId={activeId}
              dragOverId={dragOverId}
              draggable={draggable}
              selectable={selectable}
              selectedIds={selectedIds}
              onSelect={onSelect}
              onToggleSelect={onToggleSelect}
              onDragStart={onDragStart}
              onDropItem={onDropItem}
              onDragOverItem={onDragOverItem}
              depth={depth + 1}
            />
          ))
        : null}
    </div>
  );
}

function FileIcon({ ext }) {
  const models = ["blend", "max", "ma", "mb", "c4d", "fbx", "obj", "gltf", "glb", "stl"];
  if (models.includes(ext)) return <FileBox size={18} />;
  if (["zip", "rar", "7z"].includes(ext)) return <FileArchive size={18} />;
  return <HardDrive size={18} />;
}

function ModuleIcon({ moduleKey, size = 16 }) {
  if (moduleKey === "archive_3d") return <Archive size={size} />;
  if (moduleKey === "learning") return <BookOpen size={size} />;
  if (moduleKey === "admin") return <Users size={size} />;
  return <Box size={size} />;
}

function renderInlineText(text) {
  const parts = [];
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;
  let tokenIndex = 0;

  while ((match = pattern.exec(text || "")) !== null) {
    if (match.index > lastIndex) {
      parts.push((text || "").slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={`code-${tokenIndex}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={`strong-${tokenIndex}`}>{token.slice(2, -2)}</strong>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (linkMatch) {
        parts.push(
          <a key={`link-${tokenIndex}`} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }
    lastIndex = match.index + token.length;
    tokenIndex += 1;
  }

  if (lastIndex < (text || "").length) {
    parts.push((text || "").slice(lastIndex));
  }

  return parts;
}

function isSqlContent(content = "") {
  const trimmed = content.trim();
  return Boolean(
    trimmed
    && !/[#>*-]\s|```/.test(trimmed)
    && /^(select|with|insert|update|delete|create|alter|drop|merge|show|desc|explain)\b/i.test(trimmed)
  );
}

function formatSql(content = "") {
  const upperKeywords = [
    "select", "from", "where", "and", "or", "group by", "order by", "having", "limit",
    "join", "left join", "right join", "inner join", "outer join", "on", "with", "as",
    "insert into", "values", "update", "set", "delete from", "create table", "alter table",
  ];
  let sql = content.trim().replace(/\s+/g, " ");
  upperKeywords
    .sort((a, b) => b.length - a.length)
    .forEach((keyword) => {
      sql = sql.replace(new RegExp(`\\b${keyword.replace(" ", "\\s+")}\\b`, "gi"), keyword.toUpperCase());
    });

  sql = sql
    .replace(/\s*,\s*/g, ",\n  ")
    .replace(/\s+(FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|VALUES|SET)\b/g, "\n$1")
    .replace(/\s+((?:LEFT|RIGHT|INNER|OUTER)\s+JOIN|JOIN)\b/g, "\n$1")
    .replace(/\s+(AND|OR)\b/g, "\n  $1")
    .replace(/\s+(ON)\b/g, "\n  $1")
    .replace(/\(\s*/g, "(\n  ")
    .replace(/\s*\)/g, "\n)")
    .replace(/;\s*$/g, ";\n");

  return sql.trimEnd();
}

function guessSqlSnippetTitle(sql = "", fallback = "SQL 片段") {
  const firstMeaningfulLine = (sql || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstMeaningfulLine) return fallback;
  const namedComment = firstMeaningfulLine.match(/^--\s*(?:名称|标题)\s*[:：]\s*(.+)$/);
  if (namedComment) return namedComment[1].trim();
  const compact = firstMeaningfulLine.replace(/^--\s*/, "").replace(/\s+/g, " ").trim();
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact || fallback;
}

function extractSqlSnippetMeta(sql = "") {
  const lines = (sql || "").split(/\r?\n/).map((line) => line.trim());
  const meta = {
    purpose: "",
    sourceTable: "",
    targetTable: "",
    owner: "",
    notes: "",
  };
  lines.forEach((line) => {
    if (!meta.purpose) {
      const match = line.match(/^--\s*(?:用途|说明)\s*[:：]\s*(.+)$/);
      if (match) meta.purpose = match[1].trim();
    }
    if (!meta.sourceTable) {
      const match = line.match(/^--\s*(?:来源表|源表)\s*[:：]\s*(.+)$/);
      if (match) meta.sourceTable = match[1].trim();
    }
    if (!meta.targetTable) {
      const match = line.match(/^--\s*(?:目标表|结果表|落地表)\s*[:：]\s*(.+)$/);
      if (match) meta.targetTable = match[1].trim();
    }
    if (!meta.owner) {
      const match = line.match(/^--\s*(?:负责人|维护人)\s*[:：]\s*(.+)$/);
      if (match) meta.owner = match[1].trim();
    }
    if (!meta.notes) {
      const match = line.match(/^--\s*(?:口径|注意事项|备注)\s*[:：]\s*(.+)$/);
      if (match) meta.notes = match[1].trim();
    }
  });
  return meta;
}

function highlightMatch(text, keyword) {
  const source = String(text || "");
  const query = String(keyword || "").trim();
  if (!query) return source;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "ig");
  const parts = source.split(regex);
  if (parts.length === 1) return source;
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
  );
}

function extractSqlSnippetsFromItem(item) {
  if (!item || item.item_type === "folder") return [];
  const content = item.content || "";
  const trimmed = content.trim();
  if (!trimmed) return [];

  if (isSqlContent(trimmed)) {
    return [{
      id: `${item.id}-sql-0`,
      itemId: item.id,
      itemTitle: item.title,
      title: item.title || guessSqlSnippetTitle(trimmed),
      category: item.category || "",
      tags: parseLearningTags(item.tags || ""),
      content: formatSql(trimmed),
      rawContent: trimmed,
      ...extractSqlSnippetMeta(trimmed),
      updatedAt: item.updated_at || "",
    }];
  }

  const lines = content.split(/\r?\n/);
  let inCode = false;
  let codeLanguage = "";
  let code = [];
  let currentHeading = "";
  let snippetIndex = 0;
  const snippets = [];

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (!inCode && heading) {
      currentHeading = heading[2].trim();
      return;
    }
    if (line.trim().startsWith("```")) {
      if (inCode) {
        if (codeLanguage === "sql") {
          const snippetText = code.join("\n").trim();
          if (snippetText) {
            snippetIndex += 1;
            snippets.push({
              id: `${item.id}-sql-${snippetIndex}`,
              itemId: item.id,
              itemTitle: item.title,
              title: currentHeading || guessSqlSnippetTitle(snippetText, `SQL 片段 ${snippetIndex}`),
              category: item.category || "",
              tags: parseLearningTags(item.tags || ""),
              content: formatSql(snippetText),
              rawContent: snippetText,
              ...extractSqlSnippetMeta(snippetText),
              updatedAt: item.updated_at || "",
            });
          }
        }
        code = [];
        codeLanguage = "";
        inCode = false;
      } else {
        codeLanguage = line.trim().slice(3).trim().toLowerCase();
        inCode = true;
      }
      return;
    }
    if (inCode) code.push(rawLine);
  });

  return snippets;
}

function getLearningSnippetStorageKey(snippet) {
  return snippet?.id || "";
}

function mergeLearningSnippetMeta(snippet, overrides = {}) {
  if (!snippet) return snippet;
  const custom = overrides[getLearningSnippetStorageKey(snippet)];
  if (!custom) return snippet;
  return {
    ...snippet,
    title: custom.title || snippet.title,
    category: custom.category || snippet.category,
    tags: Array.isArray(custom.tags) ? custom.tags.filter(Boolean) : snippet.tags,
    purpose: custom.purpose ?? snippet.purpose,
    sourceTable: custom.sourceTable ?? snippet.sourceTable,
    targetTable: custom.targetTable ?? snippet.targetTable,
    owner: custom.owner ?? snippet.owner,
    notes: custom.notes ?? snippet.notes,
  };
}

function extractLearningOutline(content = "") {
  return (content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line, index) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      if (!match) return null;
      return {
        id: `outline-${index}-${match[2]}`,
        anchor: `outline-anchor-${index}-${slugifyLearningAnchor(match[2])}`,
        level: Math.min(match[1].length, 3),
        title: match[2].trim(),
      };
    })
    .filter(Boolean);
}

function renderCodePreviewBlock(source, language = "") {
  const codeText = language === "sql" ? formatSql(source) : source;
  const label = language === "sql" ? "SQL" : (language || "代码块").toUpperCase();
  return (
    <div className={`learning-code-block ${language === "sql" ? "sql" : ""}`}>
      <div className="learning-code-block-head">
        <span>{label}</span>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyTextToClipboard(codeText);
            if (!ok) window.alert("复制失败，请检查浏览器权限");
          }}
        >
          复制
        </button>
      </div>
      <pre className={language === "sql" ? "sql-preview" : ""}>
        <code>{codeText}</code>
      </pre>
    </div>
  );
}

function renderLearningContent(content) {
  const trimmedContent = (content || "").trim();
  if (isSqlContent(trimmedContent)) {
    return renderCodePreviewBlock(trimmedContent, "sql");
  }

  const lines = (content || "").split(/\r?\n/);
  const elements = [];
  let paragraph = [];
  let list = [];
  let orderedList = [];
  let code = [];
  let codeLanguage = "";
  let table = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    elements.push(
      <p key={`p-${elements.length}`}>
        {renderInlineText(paragraph.join(" "))}
      </p>
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    elements.push(
      <ul key={`ul-${elements.length}`}>
        {list.map((item, index) => (
          <li key={`${item.text}-${index}`} className={item.checked !== null ? "todo-item" : ""}>
            {item.checked !== null ? <input type="checkbox" checked={item.checked} readOnly /> : null}
            <span>{renderInlineText(item.text)}</span>
          </li>
        ))}
      </ul>
    );
    list = [];
  };
  const flushOrderedList = () => {
    if (!orderedList.length) return;
    elements.push(
      <ol key={`ol-${elements.length}`} className="learning-markdown-ordered-list">
        {orderedList.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineText(item)}</li>
        ))}
      </ol>
    );
    orderedList = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    const [head, ...body] = table;
    elements.push(
      <div className="learning-table-wrap" key={`table-${elements.length}`}>
        <table className="learning-markdown-table">
          <thead>
            <tr>
              {head.map((cell, index) => <th key={`th-${index}`}>{renderInlineText(cell)}</th>)}
            </tr>
          </thead>
          {body.length ? (
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {row.map((cell, index) => <td key={`td-${rowIndex}-${index}`}>{renderInlineText(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          ) : null}
        </table>
      </div>
    );
    table = [];
  };

  lines.forEach((rawLine, lineIndex) => {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      if (inCode) {
        elements.push(<React.Fragment key={`code-${elements.length}`}>{renderCodePreviewBlock(code.join("\n"), codeLanguage)}</React.Fragment>);
        code = [];
        codeLanguage = "";
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        flushOrderedList();
        flushTable();
        codeLanguage = line.trim().slice(3).trim().toLowerCase();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      code.push(rawLine);
      return;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushOrderedList();
      flushTable();
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushOrderedList();
      flushTable();
      const Tag = `h${Math.min(heading[1].length + 1, 4)}`;
      const anchor = `outline-anchor-${lineIndex}-${slugifyLearningAnchor(heading[2])}`;
      elements.push(
        <Tag key={`h-${elements.length}`} id={anchor} data-outline-anchor={anchor}>
          {renderInlineText(heading[2])}
        </Tag>
      );
      return;
    }
    const tableLine = line.match(/^\|(.+)\|$/);
    if (tableLine) {
      flushParagraph();
      flushList();
      flushOrderedList();
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        table.push(cells);
      }
      return;
    }
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      flushParagraph();
      flushList();
      flushOrderedList();
      flushTable();
      elements.push(<hr key={`hr-${elements.length}`} className="learning-markdown-divider" />);
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushOrderedList();
      const todo = bullet[1].match(/^\[( |x|X)\]\s+(.+)$/);
      if (todo) {
        list.push({ checked: todo[1].toLowerCase() === "x", text: todo[2] });
      } else {
        list.push({ checked: null, text: bullet[1] });
      }
      return;
    }
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushList();
      flushTable();
      orderedList.push(ordered[1]);
      return;
    }
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      flushOrderedList();
      flushTable();
      elements.push(<blockquote key={`q-${elements.length}`}>{renderInlineText(quote[1])}</blockquote>);
      return;
    }
    flushList();
    flushOrderedList();
    flushTable();
    paragraph.push(line.trim());
  });

  if (inCode) {
    elements.push(<React.Fragment key={`code-${elements.length}`}>{renderCodePreviewBlock(code.join("\n"), codeLanguage)}</React.Fragment>);
  }
  flushParagraph();
  flushList();
  flushOrderedList();
  flushTable();

  return elements.length ? elements : <p className="learning-preview-empty">正文预览</p>;
}

const TEXT_PREVIEW_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "sql",
  "json",
  "csv",
  "tsv",
  "xml",
  "yaml",
  "yml",
  "py",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "html",
  "log",
]);
const IMAGE_PREVIEW_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const VIDEO_PREVIEW_EXTENSIONS = new Set(["mp4", "webm", "mov"]);
const MODULE_ACCESS_LABELS = {
  none: "无权限",
  read: "仅查看",
  edit: "可编辑",
  manage: "管理",
};

function buildLearningDraft(item) {
  return {
    title: item?.title || "",
    category: item?.category || "大数据",
    tags: item?.tags || "",
    status: item?.status || "计划中",
    priority: item?.priority || "中",
    resource_url: item?.resource_url || "",
    content: item?.content || "",
    is_pinned: Boolean(item?.is_pinned),
  };
}

function buildProjectDraft(item) {
  return {
    name: item?.name || "",
    client_name: item?.client_name || "",
    contact_name: item?.contact_name || "",
    status: item?.status || "制作中",
    stage: item?.stage || "建模",
    delivery_date: item?.delivery_date || "",
    delivery_notes: item?.delivery_notes || "",
    description: item?.description || "",
  };
}

function parseLearningTags(tags = "") {
  return tags
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAuditActionLabel(action = "") {
  const labels = {
    create_project: "新建项目",
    update_project: "更新项目资料",
    create_folder: "新建目录",
    rename_folder: "重命名目录",
    move_folder: "移动目录",
    delete_folder: "删除目录",
    upload_file: "上传文件",
    replace_file: "上传新版本",
    move_file: "移动文件",
    delete_file: "删除文件",
    restore_file: "恢复文件",
    update_version_effectiveness: "修改版本有效性",
    update_version_final: "设置最终版本",
    update_version_remark: "更新版本备注",
  };
  return labels[action] || action || "项目操作";
}

function formatTimelineTargetLabel(targetType = "") {
  const labels = {
    project: "项目",
    folder: "目录",
    file: "文件",
    file_version: "版本",
  };
  return labels[targetType] || "记录";
}

function getPreviewKind(ext = "") {
  const value = ext.toLowerCase();
  if (IMAGE_PREVIEW_EXTENSIONS.has(value)) return "image";
  if (VIDEO_PREVIEW_EXTENSIONS.has(value)) return "video";
  if (value === "pdf") return "pdf";
  if (TEXT_PREVIEW_EXTENSIONS.has(value)) return "text";
  return "unsupported";
}

function IconButton({ label, onClick, children, className = "" }) {
  return (
    <button
      className={`icon-button ${className}`}
      type="button"
      aria-label={label}
      data-tooltip={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function App() {
  const [auth, setAuth] = useState(() => {
    const raw = localStorage.getItem("work-file-archive-auth");
    return raw ? JSON.parse(raw) : null;
  });
  const [modules, setModules] = useState([]);
  const [activeModule, setActiveModule] = useState("archive_3d");
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [folders, setFolders] = useState([]);
  const [activeFolder, setActiveFolder] = useState(null);
  const [items, setItems] = useState({ folders: [], files: [] });
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedArchiveIds, setSelectedArchiveIds] = useState([]);
  const [archiveBatchTargetFolderId, setArchiveBatchTargetFolderId] = useState("");
  const [detail, setDetail] = useState(null);
  const [previewText, setPreviewText] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [projectDraft, setProjectDraft] = useState(() => buildProjectDraft());
  const [projectSaving, setProjectSaving] = useState(false);
  const [archiveProjectPanelOpen, setArchiveProjectPanelOpen] = useState(false);
  const [projectTimeline, setProjectTimeline] = useState([]);
  const [archiveSearch, setArchiveSearch] = useState({
    query: "",
    kind: "all",
    scope: "folder",
    status: "all",
  });
  const [archiveRecentSearches, setArchiveRecentSearches] = useState(() =>
    parseRecentSearches(localStorage.getItem(ARCHIVE_RECENT_SEARCH_STORAGE_KEY))
  );
  const [message, setMessage] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState([]);
  const [selectedTrashIds, setSelectedTrashIds] = useState([]);
  const [learningItems, setLearningItems] = useState([]);
  const [learningFilters, setLearningFilters] = useState({
    query: "",
    status: "all",
    itemType: "all",
  });
  const [learningRecentSearches, setLearningRecentSearches] = useState(() =>
    parseRecentSearches(localStorage.getItem(LEARNING_RECENT_SEARCH_STORAGE_KEY))
  );
  const [globalFinderRecentSearches, setGlobalFinderRecentSearches] = useState(() =>
    parseRecentSearches(localStorage.getItem(GLOBAL_FINDER_RECENT_SEARCH_STORAGE_KEY))
  );
  const [selectedLearningId, setSelectedLearningId] = useState(null);
  const [selectedLearningIds, setSelectedLearningIds] = useState([]);
  const [learningBatchTargetParentId, setLearningBatchTargetParentId] = useState("");
  const [learningDraft, setLearningDraft] = useState(() => buildLearningDraft());
  const [learningSaving, setLearningSaving] = useState(false);
  const [learningEditing, setLearningEditing] = useState(false);
  const [learningVersions, setLearningVersions] = useState([]);
  const [learningViewMode, setLearningViewMode] = useState(() => {
    const raw = localStorage.getItem(LEARNING_VIEW_STORAGE_KEY);
    return raw === "split" ? "split" : "write";
  });
  const [learningAutosaveLabel, setLearningAutosaveLabel] = useState("");
  const [learningTagInput, setLearningTagInput] = useState("");
  const [learningTagSuggestOpen, setLearningTagSuggestOpen] = useState(false);
  const [learningActiveOutlineAnchor, setLearningActiveOutlineAnchor] = useState("");
  const [learningSidebarTagInput, setLearningSidebarTagInput] = useState("");
  const [learningCustomTags, setLearningCustomTags] = useState(() => {
    try {
      const raw = localStorage.getItem("work-file-archive-learning-custom-tags");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return [];
    }
  });
  const [learningCustomTemplates, setLearningCustomTemplates] = useState(() => {
    try {
      const raw = localStorage.getItem(LEARNING_CUSTOM_TEMPLATES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [learningSnippetMetaOverrides, setLearningSnippetMetaOverrides] = useState(() => {
    try {
      const raw = localStorage.getItem(LEARNING_SNIPPET_META_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  });
  const [learningTreeWidth, setLearningTreeWidth] = useState(() => {
    const raw = localStorage.getItem("work-file-archive-learning-tree-width");
    const value = raw ? Number(raw) : 360;
    return Number.isFinite(value) ? Math.min(Math.max(value, 280), 560) : 360;
  });
  const [learningUtilityDockTop, setLearningUtilityDockTop] = useState(() => {
    const raw = localStorage.getItem(LEARNING_UTILITY_DOCK_TOP_STORAGE_KEY);
    const value = raw ? Number(raw) : 84;
    return Number.isFinite(value) ? Math.max(72, value) : 84;
  });
  const [learningSidebarPanels, setLearningSidebarPanels] = useState(() => ({
    filters: true,
    categories: false,
    shortcuts: false,
    sqlLibrary: true,
  }));
  const [learningUtilityPanel, setLearningUtilityPanel] = useState(null);
  const [learningHistoryOpen, setLearningHistoryOpen] = useState(false);
  const [learningSqlLibraryQuery, setLearningSqlLibraryQuery] = useState("");
  const [learningSqlLibraryCategory, setLearningSqlLibraryCategory] = useState("all");
  const [learningSqlLibraryTag, setLearningSqlLibraryTag] = useState("all");
  const [learningSqlLibraryOwner, setLearningSqlLibraryOwner] = useState("all");
  const [selectedLearningSnippet, setSelectedLearningSnippet] = useState(null);
  const [learningSnippetEditing, setLearningSnippetEditing] = useState(false);
  const [learningSnippetDraft, setLearningSnippetDraft] = useState({
    title: "",
    category: "",
    purpose: "",
    sourceTable: "",
    targetTable: "",
    owner: "",
    notes: "",
    tags: "",
  });
  const [archiveSearchTick, setArchiveSearchTick] = useState(0);
  const [archiveProjectStageFilter, setArchiveProjectStageFilter] = useState("all");
  const [archiveProjectQuery, setArchiveProjectQuery] = useState("");
  const [adminData, setAdminData] = useState({ users: [], modules: [], logs: [] });
  const [moduleDrafts, setModuleDrafts] = useState({});
  const [adminFilters, setAdminFilters] = useState({
    userQuery: "",
    status: "all",
    logQuery: "",
    logTargetType: "all",
    logAction: "all",
  });
  const [learningTemplatePickerOpen, setLearningTemplatePickerOpen] = useState(false);
  const [selectedLearningTemplatePreview, setSelectedLearningTemplatePreview] = useState(null);
  const [learningTemplateQuery, setLearningTemplateQuery] = useState("");
  const [learningTemplateCategory, setLearningTemplateCategory] = useState("all");
  const [newUser, setNewUser] = useState({
    username: "",
    display_name: "",
    password: "",
    role: "user",
    module_permissions: {},
  });
  const [adminPermissionCopySource, setAdminPermissionCopySource] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [dragOverLearningId, setDragOverLearningId] = useState(null);
  const [showIneffectiveVersions, setShowIneffectiveVersions] = useState(false);
  const [globalFinderOpen, setGlobalFinderOpen] = useState(false);
  const [globalFinderQuery, setGlobalFinderQuery] = useState("");
  const [globalFinderScope, setGlobalFinderScope] = useState("all");
  const uploadRef = useRef(null);
  const folderUploadRef = useRef(null);
  const learningTitleRef = useRef(null);
  const learningContentRef = useRef(null);
  const learningReadPreviewRef = useRef(null);
  const learningSplitPreviewRef = useRef(null);
  const learningWorkspaceRef = useRef(null);
  const learningTagInputRef = useRef(null);
  const globalFinderInputRef = useRef(null);
  const learningUtilityDockRef = useRef(null);
  const learningUtilityDragStateRef = useRef({
    dragging: false,
    pointerId: null,
    startY: 0,
    startTop: 84,
    moved: false,
  });

  function clampLearningUtilityDockTop(nextTop, panelOpen = Boolean(learningUtilityPanel)) {
    const viewportHeight = window.innerHeight || 0;
    const reservedSpace = panelOpen ? 440 : 104;
    const minTop = 72;
    const maxTop = Math.max(minTop, viewportHeight - reservedSpace);
    return Math.min(Math.max(Math.round(nextTop), minTop), maxTop);
  }

  const token = auth?.token;
  const tree = useMemo(() => buildTree(folders), [folders]);
  const activeModuleInfo = modules.find((module) => module.key === activeModule);
  const activeModuleAccess = auth?.user?.role === "admin"
    ? "manage"
    : activeModuleInfo?.access_level || "none";
  const canEditActiveModule = ["edit", "manage"].includes(activeModuleAccess);
  const visibleVersions = useMemo(() => {
    if (!detail?.versions) return [];
    return showIneffectiveVersions
      ? detail.versions
      : detail.versions.filter((version) => version.is_effective);
  }, [detail?.versions, showIneffectiveVersions]);
  const learningCategories = Array.from(
    new Set(
      learningItems
        .filter((item) => item.item_type !== "folder")
        .map((item) => item.category)
        .filter(Boolean)
    )
  );
  const learningTags = Array.from(
    new Set(
      learningItems
        .filter((item) => item.item_type !== "folder")
        .flatMap((item) => parseLearningTags(item.tags || ""))
    )
  );
  const learningSidebarTags = Array.from(new Set([...learningCustomTags, ...learningTags]));
  const learningSelectableTags = useMemo(
    () => Array.from(new Set([...learningCategories, ...learningSidebarTags].filter(Boolean))),
    [learningCategories, learningSidebarTags]
  );
  const learningTree = useMemo(() => buildLearningTree(learningItems), [learningItems]);
  const filteredLearningTree = useMemo(
    () => filterLearningTree(learningTree, learningFilters),
    [learningTree, learningFilters]
  );
  const selectedLearningItem = useMemo(
    () => learningItems.find((item) => item.id === selectedLearningId) || null,
    [learningItems, selectedLearningId]
  );
  const archiveStats = useMemo(() => {
    return {
      projects: projects.length,
      folders: items.folders.length,
      files: items.files.length,
      size: formatSize(project?.total_size || 0),
    };
  }, [projects.length, items.folders.length, items.files.length, project?.total_size]);
  const archiveFolderOptions = useMemo(
    () => folders.filter((folder) => !activeFolder || folder.id !== activeFolder.id),
    [folders, activeFolder?.id]
  );
  const selectedLearningFolderId = useMemo(() => {
    if (!selectedLearningItem) return null;
    return selectedLearningItem.item_type === "folder"
      ? selectedLearningItem.id
      : selectedLearningItem.parent_id || null;
  }, [selectedLearningItem]);
  const selectedLearningFolderChildren = useMemo(() => {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "folder") return [];
    return learningItems.filter((item) => item.parent_id === selectedLearningItem.id);
  }, [learningItems, selectedLearningItem]);
  const learningFolderOptions = useMemo(
    () => learningItems.filter((item) => item.item_type === "folder" && !selectedLearningIds.includes(item.id)),
    [learningItems, selectedLearningIds]
  );
  const currentLearningFolderTitle = selectedLearningItem?.item_type === "folder"
    ? selectedLearningItem.title
    : "顶层";
  const currentLearningFolderTree = useMemo(() => {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "folder") return null;
    return buildLearningTree(selectedLearningFolderChildren);
  }, [selectedLearningItem, selectedLearningFolderChildren]);
  const learningDraftDirty = useMemo(() => {
    if (!selectedLearningItem || selectedLearningItem.item_type === "folder") return false;
    const base = buildLearningDraft(selectedLearningItem);
    return JSON.stringify(base) !== JSON.stringify(learningDraft);
  }, [selectedLearningItem, learningDraft]);
  const showLearningEditor = canEditActiveModule && learningEditing;
  const projectDraftDirty = useMemo(() => {
    if (!project) return false;
    return JSON.stringify(buildProjectDraft(project)) !== JSON.stringify(projectDraft);
  }, [project, projectDraft]);
  const learningStats = useMemo(() => {
    const docs = learningItems.filter((item) => item.item_type !== "folder");
    return {
      total: docs.length,
      inProgress: docs.filter((item) => item.status === "进行中").length,
      completed: docs.filter((item) => item.status === "已完成").length,
      highPriority: docs.filter((item) => item.priority === "高").length,
      pinned: docs.filter((item) => item.is_pinned).length,
    };
  }, [learningItems]);
  const learningRecentDocs = useMemo(
    () =>
      [...learningItems]
        .filter((item) => item.item_type === "doc")
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
        .slice(0, 6),
    [learningItems]
  );
  const currentLearningTags = useMemo(
    () => parseLearningTags(learningDraft.tags || ""),
    [learningDraft.tags]
  );
  const availableLearningTagChoices = useMemo(
    () => learningSelectableTags.filter((tag) => !currentLearningTags.includes(tag)),
    [learningSelectableTags, currentLearningTags]
  );
  const normalizedLearningTagInput = useMemo(
    () => learningTagInput.trim().replace(/^#/, ""),
    [learningTagInput]
  );
  const filteredLearningTagSuggestions = useMemo(() => {
    const keyword = normalizedLearningTagInput.toLowerCase();
    return availableLearningTagChoices
      .filter((tag) => !keyword || tag.toLowerCase().includes(keyword))
      .slice(0, 16);
  }, [availableLearningTagChoices, normalizedLearningTagInput]);
  const exactLearningTagMatch = useMemo(
    () =>
      availableLearningTagChoices.find((tag) => tag.toLowerCase() === normalizedLearningTagInput.toLowerCase()) || "",
    [availableLearningTagChoices, normalizedLearningTagInput]
  );
  const learningPinnedDocs = useMemo(
    () =>
      learningItems
        .filter((item) => item.item_type === "doc" && item.is_pinned)
        .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
        .slice(0, 6),
    [learningItems]
  );
  const learningOutline = useMemo(
    () => extractLearningOutline(learningDraft.content || ""),
    [learningDraft.content]
  );
  const learningDocInsights = useMemo(() => {
    const content = learningDraft.content || "";
    const headings = extractLearningOutline(content).length;
    const tags = parseLearningTags(learningDraft.tags || "");
    const sqlBlocks = extractSqlSnippetsFromItem({
      id: selectedLearningItem?.id || "draft",
      title: learningDraft.title || "未命名文档",
      item_type: "doc",
      content,
      category: learningDraft.category || "",
      tags: learningDraft.tags || "",
      updated_at: selectedLearningItem?.updated_at || "",
    }).length;
    return [
      { label: "标题层级", value: headings },
      { label: "标签数量", value: tags.length },
      { label: "SQL 片段", value: sqlBlocks },
      { label: "正文长度", value: content.trim() ? `${content.trim().length} 字` : "空白" },
    ];
  }, [learningDraft.content, learningDraft.tags, learningDraft.title, learningDraft.category, selectedLearningItem?.id, selectedLearningItem?.updated_at]);
  const learningRelatedDocs = useMemo(() => {
    if (!selectedLearningItem?.id) return [];
    const currentTags = parseLearningTags(learningDraft.tags || "");
    return learningItems
      .filter((item) => item.item_type === "doc" && item.id !== selectedLearningItem.id)
      .map((item) => {
        const itemTags = parseLearningTags(item.tags || "");
        const sharedTags = itemTags.filter((tag) => currentTags.includes(tag));
        let score = 0;
        if ((item.category || "") === (learningDraft.category || "")) score += 3;
        score += sharedTags.length * 2;
        if ((item.title || "").includes(learningDraft.title || "") || (learningDraft.title || "").includes(item.title || "")) {
          score += 1;
        }
        return {
          ...item,
          sharedTags,
          score,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (b.updated_at || "").localeCompare(a.updated_at || "");
      })
      .slice(0, 6);
  }, [learningItems, selectedLearningItem?.id, learningDraft.category, learningDraft.tags, learningDraft.title]);
  const learningReferencedDocs = useMemo(() => {
    if (!selectedLearningItem?.id || !learningDraft.content?.trim()) return [];
    const content = learningDraft.content.toLowerCase();
    return learningItems
      .filter((item) => item.item_type === "doc" && item.id !== selectedLearningItem.id)
      .filter((item) => {
        const title = (item.title || "").trim();
        return title.length >= 2 && content.includes(title.toLowerCase());
      })
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .slice(0, 6);
  }, [learningItems, selectedLearningItem?.id, learningDraft.content]);
  const learningMentionedByDocs = useMemo(() => {
    const currentTitle = (learningDraft.title || "").trim().toLowerCase();
    if (!selectedLearningItem?.id || currentTitle.length < 2) return [];
    return learningItems
      .filter((item) => item.item_type === "doc" && item.id !== selectedLearningItem.id)
      .filter((item) => (item.content || "").toLowerCase().includes(currentTitle))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .slice(0, 6);
  }, [learningItems, selectedLearningItem?.id, learningDraft.title]);
  const learningSqlSnippets = useMemo(
    () =>
      learningItems
        .flatMap((item) => extractSqlSnippetsFromItem(item))
        .map((snippet) => mergeLearningSnippetMeta(snippet, learningSnippetMetaOverrides))
        .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [learningItems, learningSnippetMetaOverrides]
  );
  const resolvedSelectedLearningSnippet = useMemo(() => {
    if (!selectedLearningSnippet) return null;
    return (
      learningSqlSnippets.find((snippet) => snippet.id === selectedLearningSnippet.id) ||
      mergeLearningSnippetMeta(selectedLearningSnippet, learningSnippetMetaOverrides)
    );
  }, [selectedLearningSnippet, learningSqlSnippets, learningSnippetMetaOverrides]);
  const learningSqlLibraryCategories = useMemo(
    () => Array.from(new Set(learningSqlSnippets.map((snippet) => snippet.category).filter(Boolean))),
    [learningSqlSnippets]
  );
  const learningSqlLibraryTags = useMemo(
    () => Array.from(new Set(learningSqlSnippets.flatMap((snippet) => snippet.tags || []).filter(Boolean))),
    [learningSqlSnippets]
  );
  const learningSqlLibraryOwners = useMemo(
    () => Array.from(new Set(learningSqlSnippets.map((snippet) => snippet.owner).filter(Boolean))),
    [learningSqlSnippets]
  );
  const filteredLearningSqlSnippets = useMemo(() => {
    const keyword = learningSqlLibraryQuery.trim().toLowerCase();
    return learningSqlSnippets.filter((snippet) => {
      const categoryMatched = learningSqlLibraryCategory === "all" || snippet.category === learningSqlLibraryCategory;
      const tagMatched = learningSqlLibraryTag === "all" || (snippet.tags || []).includes(learningSqlLibraryTag);
      const ownerMatched = learningSqlLibraryOwner === "all" || snippet.owner === learningSqlLibraryOwner;
      if (!categoryMatched || !tagMatched || !ownerMatched) return false;
      if (!keyword) return true;
      return [
        snippet.title,
        snippet.itemTitle,
        snippet.category,
        snippet.tags.join(" "),
        snippet.purpose,
        snippet.sourceTable,
        snippet.targetTable,
        snippet.owner,
        snippet.notes,
        snippet.rawContent,
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [learningSqlSnippets, learningSqlLibraryQuery, learningSqlLibraryCategory, learningSqlLibraryTag, learningSqlLibraryOwner]);
  const learningTemplateCategories = useMemo(
    () => Array.from(new Set([...LEARNING_TEMPLATES, ...learningCustomTemplates].map((item) => item.category).filter(Boolean))),
    [learningCustomTemplates]
  );
  const filteredLearningTemplates = useMemo(() => {
    const keyword = learningTemplateQuery.trim().toLowerCase();
    return [...LEARNING_TEMPLATES, ...learningCustomTemplates].filter((template) => {
      const categoryMatched = learningTemplateCategory === "all" || template.category === learningTemplateCategory;
      if (!categoryMatched) return false;
      if (!keyword) return true;
      return [
        template.name,
        template.category,
        template.tags || "",
        template.status || "",
        template.priority || "",
        template.content || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [learningCustomTemplates, learningTemplateQuery, learningTemplateCategory]);
  const filteredLearningTemplatesBuiltIn = useMemo(
    () => filteredLearningTemplates.filter((template) => LEARNING_TEMPLATES.some((item) => item.key === template.key)),
    [filteredLearningTemplates]
  );
  const filteredLearningTemplatesCustom = useMemo(
    () => filteredLearningTemplates.filter((template) => !LEARNING_TEMPLATES.some((item) => item.key === template.key)),
    [filteredLearningTemplates]
  );
  const archiveProjectStageOptions = useMemo(() => {
    const stageOrder = ["需求", "建模", "贴图", "灯光", "渲染", "交付"];
    const counts = projects.reduce((acc, item) => {
      const key = item.stage || "建模";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return stageOrder
      .filter((stage) => counts[stage])
      .map((stage) => ({ stage, count: counts[stage] }));
  }, [projects]);
  const adminOverview = useMemo(() => {
    const activeUsers = adminData.users.filter((item) => item.is_active).length;
    const adminUsers = adminData.users.filter((item) => item.role === "admin").length;
    const enabledModules = adminData.modules.filter((item) => item.is_enabled).length;
    const hiddenModules = adminData.modules.filter((item) => item.is_hidden).length;
    const recentLogs = adminData.logs.filter((item) => {
      if (!item.created_at) return false;
      const created = new Date(item.created_at).getTime();
      return Number.isFinite(created) && created >= Date.now() - 7 * 24 * 60 * 60 * 1000;
    }).length;
    return [
      { label: "启用账号", value: activeUsers },
      { label: "管理员", value: adminUsers },
      { label: "已启用模块", value: enabledModules },
      { label: "隐藏模块", value: hiddenModules },
      { label: "7天操作日志", value: recentLogs },
    ];
  }, [adminData]);
  const archiveVisibleProjects = useMemo(() => {
    const keyword = archiveProjectQuery.trim().toLowerCase();
    return projects.filter((item) => {
      const stageMatched = archiveProjectStageFilter === "all" || item.stage === archiveProjectStageFilter;
      if (!stageMatched) return false;
      if (!keyword) return true;
      return [
        item.name,
        item.client_name,
        item.contact_name,
        item.description,
        item.delivery_notes,
        item.delivery_date,
        item.stage,
        item.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [projects, archiveProjectQuery, archiveProjectStageFilter]);
  const filteredAdminUsers = useMemo(() => {
    const keyword = adminFilters.userQuery.trim().toLowerCase();
    return adminData.users.filter((item) => {
      const statusMatched = adminFilters.status === "all"
        || (adminFilters.status === "active" && item.is_active)
        || (adminFilters.status === "inactive" && !item.is_active)
        || (adminFilters.status === "admin" && item.role === "admin")
        || (adminFilters.status === "user" && item.role === "user");
      if (!statusMatched) return false;
      if (!keyword) return true;
      return [item.username, item.display_name, item.role]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [adminData.users, adminFilters.userQuery, adminFilters.status]);
  const filteredAuditLogs = useMemo(() => {
    const keyword = adminFilters.logQuery.trim().toLowerCase();
    return adminData.logs.filter((item) => {
      const typeMatched = adminFilters.logTargetType === "all" || item.target_type === adminFilters.logTargetType;
      const actionMatched = adminFilters.logAction === "all" || item.action === adminFilters.logAction;
      if (!typeMatched || !actionMatched) return false;
      if (!keyword) return true;
      return [
        item.action,
        item.detail,
        item.target_type,
        item.user_display_name || "",
        item.username || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
    });
  }, [adminData.logs, adminFilters.logQuery, adminFilters.logTargetType, adminFilters.logAction]);
  const adminAuditActions = useMemo(
    () => Array.from(new Set(adminData.logs.map((item) => item.action).filter(Boolean))),
    [adminData.logs]
  );

  useEffect(() => {
    if (auth) {
      localStorage.setItem("work-file-archive-auth", JSON.stringify(auth));
      loadModules();
    }
  }, [auth]);

  useEffect(() => {
    if (!learningUtilityPanel) return undefined;
    const handlePointerDown = (event) => {
      if (learningUtilityDockRef.current?.contains(event.target)) return;
      setLearningUtilityPanel(null);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [learningUtilityPanel]);

  useEffect(() => {
    localStorage.setItem("work-file-archive-learning-custom-tags", JSON.stringify(learningCustomTags));
  }, [learningCustomTags]);

  useEffect(() => {
    localStorage.setItem(LEARNING_CUSTOM_TEMPLATES_STORAGE_KEY, JSON.stringify(learningCustomTemplates));
  }, [learningCustomTemplates]);

  useEffect(() => {
    localStorage.setItem(LEARNING_SNIPPET_META_STORAGE_KEY, JSON.stringify(learningSnippetMetaOverrides));
  }, [learningSnippetMetaOverrides]);

  useEffect(() => {
    localStorage.setItem(LEARNING_RECENT_SEARCH_STORAGE_KEY, JSON.stringify(learningRecentSearches));
  }, [learningRecentSearches]);

  useEffect(() => {
    localStorage.setItem(GLOBAL_FINDER_RECENT_SEARCH_STORAGE_KEY, JSON.stringify(globalFinderRecentSearches));
  }, [globalFinderRecentSearches]);

  useEffect(() => {
    localStorage.setItem(ARCHIVE_RECENT_SEARCH_STORAGE_KEY, JSON.stringify(archiveRecentSearches));
  }, [archiveRecentSearches]);

  useEffect(() => {
    localStorage.setItem(LEARNING_VIEW_STORAGE_KEY, learningViewMode);
  }, [learningViewMode]);

  useEffect(() => {
    if (!globalFinderOpen) return;
    window.requestAnimationFrame(() => globalFinderInputRef.current?.focus());
  }, [globalFinderOpen]);

  useEffect(() => {
    const keyword = globalFinderQuery.trim();
    if (!keyword) return undefined;
    const timer = window.setTimeout(() => {
      setGlobalFinderRecentSearches((current) => pushRecentSearch(current, keyword));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [globalFinderQuery]);

  useEffect(() => {
    if (!learningTemplatePickerOpen) return;
    if (!filteredLearningTemplates.length) {
      setSelectedLearningTemplatePreview(null);
      return;
    }
    setSelectedLearningTemplatePreview((current) => {
      if (current && filteredLearningTemplates.some((item) => item.key === current.key)) return current;
      return filteredLearningTemplates[0];
    });
  }, [learningTemplatePickerOpen, filteredLearningTemplates]);

  useEffect(() => {
    localStorage.setItem("work-file-archive-learning-tree-width", String(learningTreeWidth));
  }, [learningTreeWidth]);

  useEffect(() => {
    localStorage.setItem(LEARNING_UTILITY_DOCK_TOP_STORAGE_KEY, String(learningUtilityDockTop));
  }, [learningUtilityDockTop]);

  useEffect(() => {
    setLearningUtilityDockTop((current) => clampLearningUtilityDockTop(current));
    const handleResize = () => {
      setLearningUtilityDockTop((current) => clampLearningUtilityDockTop(current));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [learningUtilityPanel]);

  useEffect(() => {
    if (!selectedLearningItem) {
      setLearningDraft(buildLearningDraft());
      setLearningEditing(false);
      setLearningAutosaveLabel("");
      setLearningTagInput("");
      return;
    }
    const baseDraft = buildLearningDraft(selectedLearningItem);
    if (selectedLearningItem.item_type === "doc") {
      const cached = localStorage.getItem(getLearningDraftStorageKey(selectedLearningItem.id));
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed?.draft) {
            setLearningDraft({ ...baseDraft, ...parsed.draft });
            setLearningEditing(true);
            setLearningAutosaveLabel("已恢复未保存草稿");
            return;
          }
        } catch {
          localStorage.removeItem(getLearningDraftStorageKey(selectedLearningItem.id));
        }
      }
    }
    setLearningDraft(baseDraft);
    setLearningEditing(false);
    setLearningAutosaveLabel("");
    setLearningTagInput("");
  }, [selectedLearningItem?.id]);

  useEffect(() => {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "doc") return;
    const storageKey = getLearningDraftStorageKey(selectedLearningItem.id);
    if (learningEditing && learningDraftDirty) {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          draft: learningDraft,
          savedAt: Date.now(),
        })
      );
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [selectedLearningItem?.id, selectedLearningItem?.item_type, learningEditing, learningDraftDirty, learningDraft]);

  useEffect(() => {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "doc" || !canEditActiveModule || !learningEditing || !learningDraftDirty) return undefined;
    const timer = window.setTimeout(() => {
      saveLearningDraft({ silent: true, keepEditing: true });
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [selectedLearningItem?.id, selectedLearningItem?.item_type, canEditActiveModule, learningEditing, learningDraftDirty, learningDraft]);

  useEffect(() => {
    const onBeforeUnload = (event) => {
      if (!learningEditing || !learningDraftDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [learningEditing, learningDraftDirty]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!selectedLearningItem || selectedLearningItem.item_type !== "doc" || !learningEditing) return;
      event.preventDefault();
      saveLearningDraft({ keepEditing: true });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedLearningItem?.id, selectedLearningItem?.item_type, learningEditing, learningDraftDirty, learningDraft]);

  useEffect(() => {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "doc" || !canEditActiveModule || !learningEditing) return;
    window.requestAnimationFrame(() => {
      learningTitleRef.current?.focus();
      learningTitleRef.current?.select?.();
    });
  }, [selectedLearningItem?.id, canEditActiveModule, learningEditing]);

  useEffect(() => {
    if (!auth) return;
    setMessage("");
    setSelectedFile(null);
    setDetail(null);
    if (!activeModuleInfo && activeModule !== "admin") return;
    if (activeModuleAccess === "none" && activeModule !== "admin") return;
    if (activeModule === "archive_3d") loadProjects(archiveSearch);
    if (activeModule === "learning") loadLearningItems();
    if (activeModule === "admin" && auth.user.role === "admin") loadAdminData();
  }, [activeModule, auth?.token, modules.length]);

  useEffect(() => {
    if (project && activeModule === "archive_3d") loadTree(project.id);
  }, [project?.id]);

  useEffect(() => {
    if (!project || activeModule !== "archive_3d") {
      setProjectTimeline([]);
      return;
    }
    loadProjectTimeline(project.id);
  }, [project?.id, activeModule]);

  useEffect(() => {
    setProjectDraft(buildProjectDraft(project));
  }, [project?.id, project?.updated_at]);

  useEffect(() => {
    setArchiveProjectPanelOpen(false);
  }, [project?.id]);

  useEffect(() => {
    if (activeFolder) loadItems(activeFolder.id);
  }, [activeFolder?.id]);

  useEffect(() => {
    if (activeModule !== "archive_3d") return undefined;
    const timer = window.setTimeout(() => {
      loadProjects(archiveSearch);
      if (activeFolder) loadItems(activeFolder.id, archiveSearch);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [archiveSearch.query, archiveSearch.kind, archiveSearch.scope, archiveSearch.status, archiveSearchTick, activeModule, activeFolder?.id]);

  useEffect(() => {
    setSelectedArchiveIds((current) => current.filter((id) => items.files.some((file) => file.id === id)));
  }, [items.files]);

  useEffect(() => {
    setSelectedTrashIds((current) => current.filter((id) => trash.some((file) => file.id === id)));
  }, [trash]);

  useEffect(() => {
    if (!selectedFile) {
      setDetail(null);
      setPreviewText("");
      setPreviewError("");
      return;
    }
    apiFetch(`/files/${selectedFile.id}`, {}, token).then(setDetail).catch(showError);
  }, [selectedFile?.id]);

  useEffect(() => {
    if (!detail?.file || getPreviewKind(detail.file.extension) !== "text") {
      setPreviewText("");
      setPreviewError("");
      return;
    }
    const controller = new AbortController();
    setPreviewText("加载预览中...");
    setPreviewError("");
    fetch(`${API}/files/${detail.file.id}/preview?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          let message = "无法预览该文件";
          try {
            const data = await response.json();
            message = data.detail || message;
          } catch {
            message = response.statusText || message;
          }
          throw new Error(message);
        }
        return response.text();
      })
      .then(setPreviewText)
      .catch((err) => {
        if (err.name !== "AbortError") {
          setPreviewText("");
          setPreviewError(err.message);
        }
      });
    return () => controller.abort();
  }, [detail?.file?.id, detail?.file?.extension, token]);

  useEffect(() => {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "doc") {
      setLearningVersions([]);
      return;
    }
    apiFetch(`/learning/items/${selectedLearningItem.id}/versions`, {}, token)
      .then(setLearningVersions)
      .catch(showError);
  }, [selectedLearningItem?.id, selectedLearningItem?.item_type, token]);

  function showError(err) {
    const text = err.message || String(err);
    setMessage(text === "没有访问该模块的权限" ? "当前账号没有访问该模块的权限" : text);
    window.setTimeout(() => setMessage(""), 3200);
  }

  function addSidebarLearningTag() {
    const next = learningSidebarTagInput.trim().replace(/^#/, "");
    if (!next) return;
    setLearningCustomTags((current) => (current.includes(next) ? current : [...current, next]));
    setLearningSidebarTagInput("");
    setLearningFilters((current) => ({ ...current, query: next }));
  }

  function toggleLearningTagFilter(tag) {
    setLearningFilters((current) => ({
      ...current,
      query: current.query === tag ? "" : tag,
    }));
  }

  function saveLearningTemplateFromCurrentDoc() {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "doc") return;
    const suggested = `${learningDraft.title || "未命名文档"} 模板`;
    const name = window.prompt("模板名称", suggested);
    if (!name) return;
    const normalized = name.trim();
    if (!normalized) return;
    const template = {
      key: `custom-${Date.now()}`,
      name: normalized,
      category: learningDraft.category || "学习笔记",
      tags: learningDraft.tags || "",
      status: learningDraft.status || "计划中",
      priority: learningDraft.priority || "中",
      content: learningDraft.content || "",
      createdAt: new Date().toISOString(),
    };
    setLearningCustomTemplates((current) => {
      const withoutDuplicate = current.filter((item) => item.name !== normalized);
      return [template, ...withoutDuplicate].slice(0, 24);
    });
    setLearningTemplatePickerOpen(true);
    setMessage(`已保存自定义模板：${normalized}`);
  }

  function deleteLearningTemplate(templateKey) {
    setLearningCustomTemplates((current) => current.filter((item) => item.key !== templateKey));
    setMessage("已删除自定义模板");
  }

  function scrollLearningOutlineTo(anchor) {
    if (!anchor) return;
    setLearningActiveOutlineAnchor(anchor);
    const containers = [learningReadPreviewRef.current, learningSplitPreviewRef.current].filter(Boolean);
    for (const container of containers) {
      const target = container.querySelector(`[data-outline-anchor="${anchor}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    const fallback = document.getElementById(anchor);
    if (fallback) fallback.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    setLearningActiveOutlineAnchor(learningOutline[0]?.anchor || "");
  }, [learningOutline]);

  useEffect(() => {
    function handleGlobalShortcut(event) {
      const targetTag = event.target?.tagName?.toLowerCase?.() || "";
      const isEditingField = ["input", "textarea", "select"].includes(targetTag) || event.target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (isEditingField) return;
        event.preventDefault();
        setGlobalFinderOpen(true);
      }
      if (event.key === "Escape" && globalFinderOpen) {
        setGlobalFinderOpen(false);
      }
    }
    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [globalFinderOpen]);

  function exportAuditLogs() {
    if (!filteredAuditLogs.length) {
      setMessage("没有可导出的日志");
      return;
    }
    exportRowsToCsv(
      `work-file-archive-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { key: "created_at", label: "时间" },
        { key: "action", label: "操作" },
        { key: "target_type", label: "对象类型" },
        { key: "user_display_name", label: "操作人" },
        { key: "detail", label: "详情" },
      ],
      filteredAuditLogs
    );
    setMessage("已导出操作日志");
  }

  const globalFinderResults = useMemo(() => {
    const keyword = globalFinderQuery.trim().toLowerCase();
    if (!keyword) return [];
    const groups = [];
    const currentScope = activeModule === "archive_3d"
      ? "archive"
      : activeModule === "learning"
        ? "learning"
        : activeModule === "admin"
          ? "admin"
          : "all";
    const includeScope = (scope) =>
      globalFinderScope === "all"
      || globalFinderScope === scope
      || (globalFinderScope === "current" && currentScope === scope);
    if (includeScope("learning")) {
      const docs = learningItems
        .filter((item) =>
          [item.title, item.category, item.tags || "", item.content || ""].join(" ").toLowerCase().includes(keyword)
        )
        .slice(0, 8)
        .map((item) => ({
          id: `learning-${item.id}`,
          group: "知识库",
          title: highlightMatch(item.title, globalFinderQuery),
          meta: highlightMatch(`${item.item_type === "folder" ? "文件夹" : "文档"} · ${item.category || "未分类"}`, globalFinderQuery),
          action: () => {
            setActiveModule("learning");
            selectLearningItem(item);
            setGlobalFinderOpen(false);
          },
        }));
      groups.push(...docs);
    }
    if (includeScope("snippet")) {
      const snippets = learningSqlSnippets
        .filter((item) =>
          [item.title, item.itemTitle, item.category, item.tags.join(" "), item.rawContent].join(" ").toLowerCase().includes(keyword)
        )
        .slice(0, 8)
        .map((item) => ({
          id: `snippet-${item.id}`,
          group: "SQL 片段",
          title: highlightMatch(item.title, globalFinderQuery),
          meta: highlightMatch(
            [
              item.itemTitle,
              item.category || "SQL",
              item.purpose || "",
              item.sourceTable || "",
              item.targetTable || "",
            ].filter(Boolean).join(" · "),
            globalFinderQuery
          ),
          action: () => {
            setActiveModule("learning");
            openLearningSnippetSource(item);
            setGlobalFinderOpen(false);
          },
        }));
      groups.push(...snippets);
    }
    if (includeScope("archive")) {
      const projectMatches = projects
        .filter((item) =>
          [item.name, item.client_name, item.contact_name, item.description, item.stage, item.status]
            .join(" ")
            .toLowerCase()
            .includes(keyword)
        )
        .slice(0, 8)
        .map((item) => ({
          id: `project-${item.id}`,
          group: "3D 项目",
          title: highlightMatch(item.name, globalFinderQuery),
          meta: highlightMatch(`${item.status || "制作中"} · ${item.stage || "建模"} · ${item.client_name || "未填写客户"}`, globalFinderQuery),
          action: () => {
            setActiveModule("archive_3d");
            setProject(item);
            setGlobalFinderOpen(false);
          },
        }));
      groups.push(...projectMatches);
    }
    if (includeScope("admin") && auth?.user?.role === "admin") {
      const userMatches = adminData.users
        .filter((item) => [item.display_name, item.username, item.role].join(" ").toLowerCase().includes(keyword))
        .slice(0, 8)
        .map((item) => ({
          id: `user-${item.id}`,
          group: "系统管理",
          title: highlightMatch(item.display_name, globalFinderQuery),
          meta: highlightMatch(`@${item.username} · ${item.role === "admin" ? "管理员" : "普通用户"}`, globalFinderQuery),
          action: () => {
            setActiveModule("admin");
            setAdminFilters((current) => ({ ...current, userQuery: item.username }));
            setGlobalFinderOpen(false);
          },
        }));
      groups.push(...userMatches);
    }
    return groups.slice(0, 24);
  }, [globalFinderQuery, globalFinderScope, activeModule, learningItems, learningSqlSnippets, projects, adminData.users, auth?.user?.role]);

  async function loadModules() {
    try {
      const data = await apiFetch("/modules", {}, token);
      const withAdmin = auth?.user?.role === "admin"
        ? [...data, { key: "admin", name: "系统管理", description: "用户和模块授权" }]
        : data;
      setModules(withAdmin);
      const nextModule = withAdmin.some((item) => item.key === activeModule)
        ? activeModule
        : withAdmin[0]?.key || "archive_3d";
      setActiveModule(nextModule);
    } catch (err) {
      showError(err);
    }
  }

  async function loadProjects(search = archiveSearch) {
    try {
      const params = new URLSearchParams();
      if (search.query) params.set("q", search.query);
      if (search.status && search.status !== "all") params.set("status", search.status);
      const suffix = params.size ? `?${params.toString()}` : "";
      const data = await apiFetch(`/projects${suffix}`, {}, token);
      setProjects(data);
      setProject((current) => {
        if (!data.length) return null;
        if (!current) return data[0];
        return data.find((item) => item.id === current.id) || data[0];
      });
    } catch (err) {
      showError(err);
    }
  }

  async function loadTree(projectId) {
    try {
      const data = await apiFetch(`/projects/${projectId}/tree`, {}, token);
      setFolders(data.folders);
      setActiveFolder((current) => current || data.folders[0] || null);
    } catch (err) {
      showError(err);
    }
  }

  async function loadProjectTimeline(projectId) {
    if (!projectId) {
      setProjectTimeline([]);
      return;
    }
    try {
      const data = await apiFetch(`/projects/${projectId}/timeline`, {}, token);
      setProjectTimeline(data.logs || []);
    } catch (err) {
      showError(err);
    }
  }

  async function loadItems(folderId, search = archiveSearch) {
    try {
      const params = new URLSearchParams();
      if (search.query) params.set("q", search.query);
      if (search.kind && search.kind !== "all") params.set("kind", search.kind);
      if (search.scope && search.scope !== "folder") params.set("scope", search.scope);
      const suffix = params.size ? `?${params.toString()}` : "";
      const data = await apiFetch(`/folders/${folderId}/items${suffix}`, {}, token);
      setItems(data);
    } catch (err) {
      showError(err);
    }
  }

  async function loadLearningItems() {
    try {
      const data = (await apiFetch("/learning/items", {}, token)).map(normalizeLearningItem);
      setLearningItems(data);
      setSelectedLearningIds((current) => current.filter((id) => data.some((item) => item.id === id)));
      setSelectedLearningId((current) => {
        if (current && data.some((item) => item.id === current)) return current;
        return data[0]?.id || null;
      });
    } catch (err) {
      showError(err);
    }
  }

  async function loadAdminData() {
    if (auth?.user?.role !== "admin") return;
    try {
      const [data, logs] = await Promise.all([
        apiFetch("/admin/users", {}, token),
        apiFetch("/admin/audit-logs", {}, token),
      ]);
      setAdminData({ ...data, logs: logs.logs || [] });
      setModuleDrafts(Object.fromEntries(data.modules.map((module) => [
        module.key,
        {
          name: module.name,
          description: module.description || "",
          sort_order: module.sort_order ?? 0,
          is_enabled: Boolean(module.is_enabled ?? 1),
          is_hidden: Boolean(module.is_hidden ?? 0),
        },
      ])));
      setNewUser((current) => ({
        ...current,
        module_permissions: Object.keys(current.module_permissions).length
          ? current.module_permissions
          : Object.fromEntries(data.modules.map((module) => [module.key, "read"])),
      }));
    } catch (err) {
      showError(err);
    }
  }

  function startDrag(event, payload) {
    event.dataTransfer.effectAllowed = "move";
    const value = JSON.stringify(payload);
    event.dataTransfer.setData("application/json", value);
    event.dataTransfer.setData("text/plain", value);
  }

  function readDragPayload(event) {
    const raw =
      event.dataTransfer.getData("application/json") ||
      event.dataTransfer.getData("text/plain");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function moveDraggedItem(event, targetFolder = null) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverFolderId(null);
    if (!canEditActiveModule) {
      setMessage("当前账号只有查看权限，不能移动文件或目录");
      return;
    }
    const payload = readDragPayload(event);
    if (!payload) return;

    try {
      if (payload.type === "file") {
        if (!targetFolder) {
          setMessage("文件需要放到具体目录里");
          return;
        }
        if (payload.folderId === targetFolder.id) return;
        await apiFetch(
          `/files/${payload.id}/move`,
          { method: "PATCH", body: JSON.stringify({ folder_id: targetFolder.id }) },
          token
        );
        setMessage(`已移动文件到 ${targetFolder.name}`);
      }
      if (payload.type === "folder") {
        if (!targetFolder) {
          if (payload.parentId === null || payload.parentId === undefined) return;
          await apiFetch(
            `/folders/${payload.id}/move`,
            { method: "PATCH", body: JSON.stringify({ parent_id: null }) },
            token
          );
          setMessage("已移动目录到一级目录");
        } else {
          if (payload.id === targetFolder.id || payload.parentId === targetFolder.id) return;
          await apiFetch(
            `/folders/${payload.id}/move`,
            { method: "PATCH", body: JSON.stringify({ parent_id: targetFolder.id }) },
            token
          );
          setMessage(`已移动目录到 ${targetFolder.name}`);
        }
      }
      await loadTree(project.id);
      if (activeFolder) await loadItems(activeFolder.id);
      if (selectedFile) {
        apiFetch(`/files/${selectedFile.id}`, {}, token).then(setDetail).catch(() => setSelectedFile(null));
      }
    } catch (err) {
      showError(err);
    }
  }

  async function moveLearningItem(itemId, parentId, targetLabel) {
    await apiFetch(
      `/learning/items/${itemId}`,
      { method: "PATCH", body: JSON.stringify({ parent_id: parentId }) },
      token
    );
    await loadLearningItems();
    if (targetLabel) setSelectedLearningId(parentId);
    setMessage(targetLabel ? `已移动到 ${targetLabel}` : "已移动到知识库根目录");
  }

  async function moveDraggedLearningItem(event, targetItem = null) {
    event.preventDefault();
    event.stopPropagation();
    setDragOverLearningId(null);
    if (!canEditActiveModule) {
      setMessage("当前账号只有查看权限，不能移动文档或目录");
      return;
    }
    const payload = readDragPayload(event);
    if (!payload || payload.scope !== "learning") return;
    const draggedId = Number(payload.id);
    const draggedParentId =
      payload.parentId === null || payload.parentId === undefined ? null : Number(payload.parentId);

    try {
      if (!targetItem) {
        if (draggedParentId === null) return;
        await moveLearningItem(draggedId, null, "");
        return;
      }
      if (targetItem.item_type !== "folder") return;
      if (draggedId === targetItem.id || draggedParentId === targetItem.id) return;
      await moveLearningItem(draggedId, targetItem.id, targetItem.title);
    } catch (err) {
      showError(err);
    }
  }

  async function createProject() {
    if (!canEditActiveModule) return;
    const name = window.prompt("项目名称");
    if (!name) return;
    try {
      await apiFetch("/projects", { method: "POST", body: JSON.stringify({ name }) }, token);
      await loadProjects();
    } catch (err) {
      showError(err);
    }
  }

  async function saveProjectDraft() {
    if (!canEditActiveModule || !project || !projectDraftDirty) return;
    if (!projectDraft.name.trim()) {
      setMessage("项目名称不能为空");
      return;
    }
    try {
      setProjectSaving(true);
      await apiFetch(
        `/projects/${project.id}`,
        { method: "PATCH", body: JSON.stringify(projectDraft) },
        token
      );
      await loadProjects();
      await loadProjectTimeline(project.id);
      setProject((current) => current ? { ...current, ...projectDraft } : current);
      setMessage("项目资料已保存");
    } catch (err) {
      showError(err);
    } finally {
      setProjectSaving(false);
    }
  }

  async function createFolder() {
    if (!canEditActiveModule) return;
    if (!project) return;
    const name = window.prompt("目录名称");
    if (!name) return;
    try {
      await apiFetch(
        "/folders",
        {
          method: "POST",
          body: JSON.stringify({
            project_id: project.id,
            parent_id: activeFolder?.id || null,
            name,
          }),
        },
        token
      );
      await loadTree(project.id);
      if (activeFolder) await loadItems(activeFolder.id);
    } catch (err) {
      showError(err);
    }
  }

  async function uploadFiles(fileList) {
    if (!canEditActiveModule) {
      setMessage("当前账号只有查看权限，不能上传");
      return;
    }
    if (!activeFolder || !fileList?.length) return;
    const form = new FormData();
    Array.from(fileList).forEach((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      form.append("files", file);
      form.append("relative_paths", relativePath);
    });
    form.append("remark", "网页上传");
    setUploading(true);
    try {
      await apiFetch(`/folders/${activeFolder.id}/upload`, { method: "POST", body: form }, token);
      await loadItems(activeFolder.id);
      await loadProjects();
    } catch (err) {
      showError(err);
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
      if (folderUploadRef.current) folderUploadRef.current.value = "";
    }
  }

  function downloadFile(fileId, versionId) {
    const params = new URLSearchParams({ token });
    if (versionId) params.set("version_id", versionId);
    const suffix = `?${params.toString()}`;
    window.open(`${API}/files/${fileId}/download${suffix}`, "_blank");
  }

  function downloadFolder() {
    if (!activeFolder) return;
    window.open(`${API}/folders/${activeFolder.id}/download?token=${encodeURIComponent(token)}`, "_blank");
  }

  function toggleArchiveSelection(fileId) {
    setSelectedArchiveIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]
    );
  }

  function toggleArchiveSelectAll() {
    const visibleIds = items.files.map((file) => file.id);
    if (!visibleIds.length) return;
    setSelectedArchiveIds((current) =>
      current.length === visibleIds.length ? [] : visibleIds
    );
  }

  function downloadSelectedFiles() {
    if (!selectedArchiveIds.length) return;
    const params = new URLSearchParams({
      token,
      file_ids: selectedArchiveIds.join(","),
    });
    window.open(`${API}/files/batch-download?${params.toString()}`, "_blank");
  }

  async function deleteSelectedFiles() {
    if (!canEditActiveModule || !selectedArchiveIds.length) return;
    if (!window.confirm(`确定批量删除选中的 ${selectedArchiveIds.length} 个文件吗？文件会进入回收站。`)) return;
    try {
      const deletingCurrent = selectedFile && selectedArchiveIds.includes(selectedFile.id);
      const result = await apiFetch(
        "/files/batch-delete",
        { method: "POST", body: JSON.stringify({ file_ids: selectedArchiveIds }) },
        token
      );
      await loadItems(activeFolder.id);
      await loadProjects();
      if (deletingCurrent) setSelectedFile(null);
      setSelectedArchiveIds([]);
      setMessage(`已删除 ${result.count || 0} 个文件`);
    } catch (err) {
      showError(err);
    }
  }

  async function moveSelectedFiles() {
    if (!canEditActiveModule || !selectedArchiveIds.length || !archiveBatchTargetFolderId) return;
    const targetFolder = folders.find((folder) => folder.id === Number(archiveBatchTargetFolderId));
    if (!targetFolder) {
      setMessage("请选择目标目录");
      return;
    }
    if (!window.confirm(`确定把选中的 ${selectedArchiveIds.length} 个文件移动到 ${targetFolder.name} 吗？`)) return;
    try {
      for (const fileId of selectedArchiveIds) {
        await apiFetch(
          `/files/${fileId}/move`,
          { method: "PATCH", body: JSON.stringify({ folder_id: targetFolder.id }) },
          token
        );
      }
      setSelectedArchiveIds([]);
      setArchiveBatchTargetFolderId("");
      await loadTree(project.id);
      await loadItems(activeFolder.id);
      setMessage(`已移动 ${selectedArchiveIds.length} 个文件到 ${targetFolder.name}`);
    } catch (err) {
      showError(err);
    }
  }

  async function deleteFile(file) {
    if (!canEditActiveModule) return;
    if (!window.confirm(`删除 ${file.name}？文件会进入回收站。`)) return;
    try {
      await apiFetch(`/files/${file.id}`, { method: "DELETE" }, token);
      await loadItems(activeFolder.id);
      if (selectedFile?.id === file.id) setSelectedFile(null);
    } catch (err) {
      showError(err);
    }
  }

  async function renameFile(file) {
    if (!canEditActiveModule) return;
    const name = window.prompt("新文件名", file.name);
    if (!name || name === file.name) return;
    try {
      await apiFetch(`/files/${file.id}`, { method: "PATCH", body: JSON.stringify({ name }) }, token);
      await loadItems(activeFolder.id);
    } catch (err) {
      showError(err);
    }
  }

  async function setVersionEffectiveness(version, isEffective) {
    if (!canEditActiveModule) return;
    try {
      await apiFetch(
        `/file-versions/${version.id}/effectiveness`,
        { method: "PATCH", body: JSON.stringify({ is_effective: isEffective }) },
        token
      );
      if (selectedFile) {
        const nextDetail = await apiFetch(`/files/${selectedFile.id}`, {}, token);
        setDetail(nextDetail);
      }
      setMessage(isEffective ? "版本已恢复为有效" : "版本已标记为失效");
    } catch (err) {
      showError(err);
    }
  }

  async function setVersionFinal(version, isFinal) {
    if (!canEditActiveModule || !selectedFile) return;
    try {
      await apiFetch(
        `/file-versions/${version.id}/final`,
        { method: "PATCH", body: JSON.stringify({ is_final: isFinal }) },
        token
      );
      const nextDetail = await apiFetch(`/files/${selectedFile.id}`, {}, token);
      setDetail(nextDetail);
      setMessage(isFinal ? "已标记为最终版" : "已取消最终版");
    } catch (err) {
      showError(err);
    }
  }

  async function updateVersionRemark(version) {
    if (!canEditActiveModule || !selectedFile) return;
    const nextRemark = window.prompt("请输入版本备注", version.remark || "");
    if (nextRemark === null) return;
    try {
      await apiFetch(
        `/file-versions/${version.id}/remark`,
        { method: "PATCH", body: JSON.stringify({ remark: nextRemark.trim() }) },
        token
      );
      const nextDetail = await apiFetch(`/files/${selectedFile.id}`, {}, token);
      setDetail(nextDetail);
      if (project?.id) await loadProjectTimeline(project.id);
      setMessage("版本备注已更新");
    } catch (err) {
      showError(err);
    }
  }

  async function loadTrash() {
    try {
      const data = await apiFetch("/trash", {}, token);
      setTrash(data.files);
      setTrashOpen(true);
    } catch (err) {
      showError(err);
    }
  }

  async function restoreFile(file) {
    try {
      await apiFetch(`/files/${file.id}/restore`, { method: "POST" }, token);
      await loadTrash();
      if (activeFolder) await loadItems(activeFolder.id);
      await loadProjects();
    } catch (err) {
      showError(err);
    }
  }

  function toggleTrashSelection(fileId) {
    setSelectedTrashIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]
    );
  }

  function toggleTrashSelectAll() {
    const visibleIds = trash.map((file) => file.id);
    if (!visibleIds.length) return;
    setSelectedTrashIds((current) => (current.length === visibleIds.length ? [] : visibleIds));
  }

  async function restoreSelectedTrash() {
    if (!selectedTrashIds.length) return;
    try {
      const result = await apiFetch(
        "/trash/batch-restore",
        { method: "POST", body: JSON.stringify({ file_ids: selectedTrashIds }) },
        token
      );
      setSelectedTrashIds([]);
      await loadTrash();
      if (activeFolder) await loadItems(activeFolder.id);
      await loadProjects();
      setMessage(`已恢复 ${result.count || 0} 个文件`);
    } catch (err) {
      showError(err);
    }
  }

  async function purgeTrashFiles(fileIds = selectedTrashIds) {
    if (!fileIds.length) return;
    if (!window.confirm(`确定彻底删除选中的 ${fileIds.length} 个文件吗？此操作不可恢复。`)) return;
    try {
      const result = await apiFetch(
        "/trash/batch-purge",
        { method: "DELETE", body: JSON.stringify({ file_ids: fileIds }) },
        token
      );
      setSelectedTrashIds([]);
      await loadTrash();
      await loadProjects();
      setMessage(`已彻底删除 ${result.count || 0} 个文件`);
    } catch (err) {
      showError(err);
    }
  }

  async function backup() {
    try {
      const data = await apiFetch("/backup", { method: "POST" }, token);
      setMessage(`备份完成：${data.path}`);
    } catch (err) {
      showError(err);
    }
  }

  async function createLearningItem() {
    return createLearningItemWithPayload({
      title: `未命名文档 ${learningItems.length + 1}`,
      parent_id: selectedLearningFolderId,
      item_type: "doc",
      category: "学习笔记",
      status: "计划中",
      priority: "中",
      content: "",
      resource_url: "",
    }, "已新建文档");
  }

  async function createLearningItemWithPayload(payload, successMessage = "已新建文档") {
    if (!canEditActiveModule) return;
    try {
      const created = await apiFetch(
        "/learning/items",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        token
      );
      await loadLearningItems();
      setSelectedLearningId(created.id);
      setLearningDraft(buildLearningDraft(normalizeLearningItem(created)));
      setLearningEditing(true);
      setLearningTemplatePickerOpen(false);
      setMessage(successMessage);
      return created;
    } catch (err) {
      showError(err);
    }
  }

  async function createLearningItemFromTemplate(template) {
    if (!template) return;
    await createLearningItemWithPayload(
      {
        title: `${template.name} ${learningItems.filter((item) => item.item_type === "doc").length + 1}`,
        parent_id: selectedLearningFolderId,
        item_type: "doc",
        category: template.category,
        tags: template.tags,
        status: template.status,
        priority: template.priority,
        content: template.content,
        resource_url: "",
      },
      `已从模板创建：${template.name}`
    );
  }

  async function createLearningFolder() {
    if (!canEditActiveModule) return;
    const title = window.prompt("文件夹名称", "新文件夹");
    if (!title) return;
    try {
      const created = await apiFetch(
        "/learning/items",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            parent_id: selectedLearningFolderId,
            item_type: "folder",
            category: "文件夹",
          }),
        },
        token
      );
      await loadLearningItems();
      setSelectedLearningId(created.id);
      setMessage("已新建文件夹");
    } catch (err) {
      showError(err);
    }
  }

  async function updateLearningItem(itemId, patch, options = {}) {
    if (!canEditActiveModule) return;
    const { silent = false, keepEditing = false } = options;
    try {
      setLearningSaving(true);
      await apiFetch(
        `/learning/items/${itemId}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        token
      );
      await loadLearningItems();
      localStorage.removeItem(getLearningDraftStorageKey(itemId));
      if (silent) {
        setLearningAutosaveLabel(`自动保存于 ${nowTimeLabel()}`);
      } else {
        setMessage("文档已保存");
        setLearningAutosaveLabel(`手动保存于 ${nowTimeLabel()}`);
      }
      setLearningEditing(keepEditing);
    } catch (err) {
      showError(err);
    } finally {
      setLearningSaving(false);
    }
  }

  async function deleteLearningItem(item) {
    if (!canEditActiveModule) return;
    if (!window.confirm(`删除「${item.title}」？`)) return;
    try {
      await apiFetch(`/learning/items/${item.id}`, { method: "DELETE" }, token);
      await loadLearningItems();
      if (selectedLearningId === item.id) {
        setSelectedLearningId(null);
        setLearningDraft(buildLearningDraft());
      }
    } catch (err) {
      showError(err);
    }
  }

  function toggleLearningSelection(itemId) {
    setSelectedLearningIds((current) =>
      current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
    );
  }

  async function deleteSelectedLearningItems() {
    if (!canEditActiveModule || !selectedLearningIds.length) return;
    if (!window.confirm(`确定批量删除选中的 ${selectedLearningIds.length} 项内容吗？`)) return;
    try {
      for (const itemId of selectedLearningIds) {
        await apiFetch(`/learning/items/${itemId}`, { method: "DELETE" }, token);
      }
      const deletingCurrent = selectedLearningId && selectedLearningIds.includes(selectedLearningId);
      if (deletingCurrent) {
        setSelectedLearningId(null);
        setLearningDraft(buildLearningDraft());
      }
      setSelectedLearningIds([]);
      await loadLearningItems();
      setMessage(`已删除 ${selectedLearningIds.length} 项内容`);
    } catch (err) {
      showError(err);
    }
  }

  async function moveSelectedLearningItems() {
    if (!canEditActiveModule || !selectedLearningIds.length) return;
    const nextParentId = learningBatchTargetParentId ? Number(learningBatchTargetParentId) : null;
    const targetLabel = nextParentId
      ? learningItems.find((item) => item.id === nextParentId)?.title || "目标目录"
      : "知识库根目录";
    if (!window.confirm(`确定把选中的 ${selectedLearningIds.length} 项内容移动到 ${targetLabel} 吗？`)) return;
    try {
      for (const itemId of selectedLearningIds) {
        await apiFetch(
          `/learning/items/${itemId}`,
          { method: "PATCH", body: JSON.stringify({ parent_id: nextParentId }) },
          token
        );
      }
      setSelectedLearningIds([]);
      setLearningBatchTargetParentId("");
      await loadLearningItems();
      setMessage(`已移动 ${selectedLearningIds.length} 项内容到 ${targetLabel}`);
    } catch (err) {
      showError(err);
    }
  }

  async function updateSelectedLearningCategory() {
    if (!canEditActiveModule || !selectedLearningIds.length) return;
    const docIds = selectedLearningIds.filter((itemId) => {
      const item = learningItems.find((current) => current.id === itemId);
      return item?.item_type === "doc";
    });
    if (!docIds.length) {
      setMessage("选中的内容里没有可改分类的文档");
      return;
    }
    const category = window.prompt("请输入新的分类", selectedLearningItem?.category || "大数据");
    if (!category || !category.trim()) return;
    try {
      for (const itemId of docIds) {
        await apiFetch(
          `/learning/items/${itemId}`,
          { method: "PATCH", body: JSON.stringify({ category: category.trim() }) },
          token
        );
      }
      await loadLearningItems();
      setMessage(`已更新 ${docIds.length} 篇文档的分类`);
    } catch (err) {
      showError(err);
    }
  }

  function openLearningLink(item) {
    if (!item.resource_url) return;
    window.open(item.resource_url, "_blank", "noopener,noreferrer");
  }

  function selectLearningItem(nextItem) {
    if (canEditActiveModule && learningDraftDirty && nextItem.id !== selectedLearningId) {
      const confirmed = window.confirm("当前文档还没保存，确定切换吗？");
      if (!confirmed) return;
    }
    setSelectedLearningId(nextItem.id);
    setLearningEditing(false);
  }

  async function saveLearningDraft(options = {}) {
    if (!selectedLearningItem || !canEditActiveModule || !learningDraftDirty) return;
    if (!learningDraft.title.trim()) {
      setMessage("文档标题不能为空");
      return;
    }
    await updateLearningItem(selectedLearningItem.id, learningDraft, options);
  }

  function cancelLearningEdit() {
    if (!selectedLearningItem) return;
    localStorage.removeItem(getLearningDraftStorageKey(selectedLearningItem.id));
    setLearningDraft(buildLearningDraft(selectedLearningItem));
    setLearningAutosaveLabel("");
    setLearningEditing(false);
  }

  function formatLearningSqlDraft() {
    setLearningDraft((current) => ({
      ...current,
      content: formatSql(current.content),
    }));
  }

  function applyLearningDraftTransform(transformer) {
    const textarea = learningContentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selectedText = learningDraft.content.slice(start, end);
    const result = transformer(selectedText, learningDraft.content, start, end);
    const nextText = result?.text ?? learningDraft.content;
    const nextSelectionStart = result?.selectionStart ?? start;
    const nextSelectionEnd = result?.selectionEnd ?? nextSelectionStart;
    setLearningDraft((current) => ({ ...current, content: nextText }));
    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    });
  }

  function insertLearningTemplate(kind) {
    const wrappers = {
      heading1: (selected) => `# ${selected || "一级标题"}`,
      heading2: (selected) => `## ${selected || "二级标题"}`,
      quote: (selected) => `> ${selected || "补一段结论或备注"}`,
      list: (selected) => `- ${selected || "第一条"}\n- 第二条`,
      todo: (selected) => `- [ ] ${selected || "待完成事项"}`,
      code: (selected) => `\`\`\`\n${selected || "代码片段"}\n\`\`\``,
      sql: (selected) => `\`\`\`sql\n${selected || "select * from table_name;"}\n\`\`\``,
      table: () => "| 字段 | 说明 |\n| --- | --- |\n| column | remark |",
    };
    const builder = wrappers[kind];
    if (!builder) return;
    applyLearningDraftTransform((selectedText, content, start, end) => {
      const snippet = builder(selectedText);
      const nextText = `${content.slice(0, start)}${snippet}${content.slice(end)}`;
      const cursor = start + snippet.length;
      return { text: nextText, selectionStart: cursor, selectionEnd: cursor };
    });
  }

  function updateLearningTags(nextTags) {
    setLearningDraft((current) => ({ ...current, tags: nextTags.join(", ") }));
  }

  function addLearningTag(tag) {
    const value = (tag || "").trim().replace(/^#/, "");
    if (!value) return;
    if (!learningSelectableTags.some((item) => item.toLowerCase() === value.toLowerCase())) {
      setMessage("这里只能选择已有标签");
      window.setTimeout(() => setMessage(""), 2200);
      return;
    }
    const nextTags = Array.from(new Set([...currentLearningTags, value]));
    updateLearningTags(nextTags);
    setLearningTagInput("");
    setLearningTagSuggestOpen(true);
    window.requestAnimationFrame(() => learningTagInputRef.current?.focus());
  }

  function removeLearningTag(tag) {
    updateLearningTags(currentLearningTags.filter((item) => item !== tag));
  }

  function handleLearningTagInputKeyDown(event) {
    if (event.key !== "Enter" && event.key !== ",") return;
    event.preventDefault();
    if (exactLearningTagMatch) addLearningTag(exactLearningTagMatch);
  }

  async function copyLearningSqlSnippet(snippet) {
    const text = snippet.rawContent || snippet.content || "";
    if (!text) return;
    try {
      const copied = await copyTextToClipboard(text);
      if (!copied) throw new Error("clipboard-unavailable");
      setMessage(`已复制：${snippet.title}`);
      window.setTimeout(() => setMessage(""), 1800);
    } catch {
      setMessage("复制失败，请检查浏览器权限");
      window.setTimeout(() => setMessage(""), 2200);
    }
  }

  function openLearningSnippetDetail(snippet) {
    const tags = Array.isArray(snippet.tags) ? snippet.tags.join(", ") : "";
    setLearningSnippetDraft({
      title: snippet.title || "",
      category: snippet.category || "",
      purpose: snippet.purpose || "",
      sourceTable: snippet.sourceTable || "",
      targetTable: snippet.targetTable || "",
      owner: snippet.owner || "",
      notes: snippet.notes || "",
      tags,
    });
    setLearningSnippetEditing(false);
    setSelectedLearningSnippet(snippet);
  }

  function closeLearningSnippetDetail() {
    setSelectedLearningSnippet(null);
    setLearningSnippetEditing(false);
  }

  function saveLearningSnippetMeta() {
    if (!resolvedSelectedLearningSnippet) return;
    const key = getLearningSnippetStorageKey(resolvedSelectedLearningSnippet);
    if (!key) return;
    const nextMeta = {
      title: learningSnippetDraft.title.trim(),
      category: learningSnippetDraft.category.trim(),
      purpose: learningSnippetDraft.purpose.trim(),
      sourceTable: learningSnippetDraft.sourceTable.trim(),
      targetTable: learningSnippetDraft.targetTable.trim(),
      owner: learningSnippetDraft.owner.trim(),
      notes: learningSnippetDraft.notes.trim(),
      tags: parseLearningTags(learningSnippetDraft.tags),
    };
    setLearningSnippetMetaOverrides((current) => ({
      ...current,
      [key]: nextMeta,
    }));
    setLearningSnippetEditing(false);
    setMessage(`已更新片段资料：${nextMeta.title || resolvedSelectedLearningSnippet.title}`);
  }

  function openLearningSnippetSource(snippet) {
    const item = learningItems.find((current) => current.id === snippet.itemId);
    if (!item) return;
    setSelectedLearningSnippet(null);
    selectLearningItem(item);
    setLearningEditing(false);
  }

  function insertLearningSqlSnippet(snippet) {
    if (!selectedLearningItem || selectedLearningItem.item_type !== "doc") {
      setMessage("请先选中一个文档，再插入 SQL 片段");
      return;
    }
    if (!canEditActiveModule) {
      setMessage("当前账号只有查看权限，不能插入片段");
      return;
    }
    const snippetText = snippet.rawContent || snippet.content || "";
    if (!snippetText) return;
    setLearningEditing(true);
    setLearningViewMode("write");
    setLearningDraft((current) => ({
      ...current,
      content: current.content
        ? `${current.content.trimEnd()}\n\n${snippetText}\n`
        : snippetText,
      category: current.category || snippet.category || "SQL",
      tags: Array.from(new Set([...parseLearningTags(current.tags || ""), ...snippet.tags])).join(", "),
    }));
    setMessage(`已插入 SQL 片段：${snippet.title}`);
  }

  async function createDocumentFromSnippet(snippet) {
    if (!snippet) return;
    const title = `${snippet.title} 模板`;
    const tags = Array.from(new Set([...(snippet.tags || []), "SQL"])).join(", ");
    await createLearningItemWithPayload(
      {
        title,
        parent_id: selectedLearningFolderId,
        item_type: "doc",
        category: snippet.category || "SQL",
        tags,
        status: "计划中",
        priority: "中",
        content: [
          snippet.purpose ? `- 用途：${snippet.purpose}` : "",
          snippet.sourceTable ? `- 来源表：${snippet.sourceTable}` : "",
          snippet.targetTable ? `- 目标表：${snippet.targetTable}` : "",
          snippet.owner ? `- 负责人：${snippet.owner}` : "",
          snippet.notes ? `- 备注：${snippet.notes}` : "",
          "",
          "```sql",
          snippet.rawContent || snippet.content || "",
          "```",
        ].filter(Boolean).join("\n"),
        resource_url: "",
      },
      `已从片段创建文档：${snippet.title}`
    );
  }

  async function restoreLearningVersion(version) {
    if (!canEditActiveModule) return;
    if (!window.confirm(`确定恢复到 ${version.created_at?.slice(0, 16).replace("T", " ")} 的版本吗？`)) return;
    try {
      const restored = await apiFetch(
        `/learning/versions/${version.id}/restore`,
        { method: "POST" },
        token
      );
      await loadLearningItems();
      setSelectedLearningId(restored.id);
      setLearningDraft(buildLearningDraft(normalizeLearningItem(restored)));
      setLearningEditing(false);
      setMessage("已恢复到选中历史版本");
    } catch (err) {
      showError(err);
    }
  }

  function openLearningEditor(mode = "write") {
    setLearningViewMode(mode);
    setLearningEditing(true);
  }

  function startLearningTreeResize(event) {
    event.preventDefault();
    const bounds = learningWorkspaceRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const onMove = (moveEvent) => {
      const nextWidth = Math.round(moveEvent.clientX - bounds.left);
      setLearningTreeWidth(Math.min(Math.max(nextWidth, 280), 560));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleLearningUtilityHandlePointerDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const dragState = learningUtilityDragStateRef.current;
    dragState.dragging = true;
    dragState.pointerId = event.pointerId;
    dragState.startY = event.clientY;
    dragState.startTop = learningUtilityDockTop;
    dragState.moved = false;
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== dragState.pointerId) return;
      const deltaY = moveEvent.clientY - dragState.startY;
      if (!dragState.moved && Math.abs(deltaY) > 4) {
        dragState.moved = true;
        document.body.classList.add("is-resizing");
      }
      if (!dragState.moved) return;
      setLearningUtilityDockTop(clampLearningUtilityDockTop(dragState.startTop + deltaY));
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== dragState.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("is-resizing");
      const didMove = dragState.moved;
      dragState.dragging = false;
      dragState.pointerId = null;
      dragState.moved = false;
      if (!didMove) {
        setLearningUtilityPanel((current) => (current ? null : "filters"));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function toggleLearningSidebarPanel(panelKey) {
    setLearningSidebarPanels((current) => ({
      ...current,
      [panelKey]: !current[panelKey],
    }));
  }

  function setNewUserModulePermission(moduleKey, accessLevel) {
    setNewUser((current) => ({
      ...current,
      module_permissions: {
        ...current.module_permissions,
        [moduleKey]: accessLevel,
      },
    }));
  }

  async function createUser(event) {
    event.preventDefault();
    try {
      await apiFetch(
        "/admin/users",
        { method: "POST", body: JSON.stringify(newUser) },
        token
      );
      setNewUser({
        username: "",
        display_name: "",
        password: "",
        role: "user",
        module_permissions: Object.fromEntries(adminData.modules.map((module) => [module.key, "read"])),
      });
      await loadAdminData();
      setMessage("用户已创建");
    } catch (err) {
      showError(err);
    }
  }

  async function updateUserModules(targetUser, moduleKey, accessLevel) {
    const modulePermissions = {
      ...(targetUser.modules || {}),
      [moduleKey]: accessLevel,
    };
    try {
      await apiFetch(
        `/admin/users/${targetUser.id}/modules`,
        { method: "PATCH", body: JSON.stringify({ module_permissions: modulePermissions }) },
        token
      );
      await loadAdminData();
      setMessage("模块权限已更新");
    } catch (err) {
      showError(err);
    }
  }

  async function copyUserModulePermissions(targetUser, sourceUserId) {
    if (!sourceUserId) {
      setMessage("请选择要复制的来源账号");
      return;
    }
    try {
      await apiFetch(
        `/admin/users/${targetUser.id}/copy-modules`,
        { method: "POST", body: JSON.stringify({ source_user_id: Number(sourceUserId) }) },
        token
      );
      await loadAdminData();
      setAdminPermissionCopySource("");
      setMessage(`已复制授权到 ${targetUser.display_name}`);
    } catch (err) {
      showError(err);
    }
  }

  async function updateUser(targetUser, patch, successMessage = "用户已更新") {
    try {
      await apiFetch(
        `/admin/users/${targetUser.id}`,
        { method: "PATCH", body: JSON.stringify(patch) },
        token
      );
      await loadAdminData();
      setMessage(successMessage);
    } catch (err) {
      showError(err);
    }
  }

  function renameUser(targetUser, field) {
    const label = field === "username" ? "用户名" : "显示名";
    const nextValue = window.prompt(`请输入新的${label}`, targetUser[field] || "");
    if (nextValue === null) return;
    const value = nextValue.trim();
    if (!value) {
      setMessage(`${label}不能为空`);
      return;
    }
    updateUser(targetUser, { [field]: value }, `${label}已更新`);
  }

  function resetUserPassword(targetUser) {
    const password = window.prompt(`请输入 ${targetUser.display_name} 的新密码`);
    if (password === null) return;
    if (password.trim().length < 4) {
      setMessage("密码至少 4 位");
      return;
    }
    updateUser(targetUser, { password }, "密码已重置");
  }

  async function deleteUser(targetUser) {
    if (!window.confirm(`确定删除账号 ${targetUser.display_name} 吗？删除后该账号将无法登录。`)) return;
    try {
      await apiFetch(`/admin/users/${targetUser.id}`, { method: "DELETE" }, token);
      await loadAdminData();
      setMessage("账号已删除");
    } catch (err) {
      showError(err);
    }
  }

  function setModuleDraft(moduleKey, patch) {
    setModuleDrafts((current) => ({
      ...current,
      [moduleKey]: {
        ...(current[moduleKey] || {}),
        ...patch,
      },
    }));
  }

  async function updateModule(module) {
    const draft = moduleDrafts[module.key] || module;
    try {
      await apiFetch(
        `/admin/modules/${module.key}`,
        { method: "PATCH", body: JSON.stringify(draft) },
        token
      );
      await loadAdminData();
      await loadModules();
      setMessage("模块已更新");
    } catch (err) {
      showError(err);
    }
  }

  function applyArchiveSearchPatch(patch, { reloadFiles = false, reloadProjects = false, remember = false } = {}) {
    const next = { ...archiveSearch, ...patch };
    setArchiveSearch(next);
    if (remember && (patch.query || "").trim()) {
      setArchiveRecentSearches((current) => pushRecentSearch(current, patch.query));
    }
    if (reloadProjects) loadProjects(next);
    if (reloadFiles && activeFolder) loadItems(activeFolder.id, next);
  }

  function applyLearningSearchQuery(query) {
    setLearningFilters((current) => ({ ...current, query }));
    if (query.trim()) {
      setLearningRecentSearches((current) => pushRecentSearch(current, query));
    }
  }

  function logout() {
    localStorage.removeItem("work-file-archive-auth");
    setAuth(null);
  }

  if (!auth) return <Login onLogin={setAuth} />;

  return (
    <main className={`app-shell ${activeModule === "admin" ? "compact-shell" : ""}`}>
      <aside className={`sidebar ${activeModule === "learning" ? "learning-sidebar-shell" : ""}`}>
        <div className="app-title">
          <Box size={24} />
          <div>
            <strong>个人工作台</strong>
            <span>{auth.user.display_name}</span>
          </div>
        </div>

        <div className="module-switcher">
          <button className="module-trigger" type="button" title="切换模块">
            <ModuleIcon moduleKey={activeModule} size={17} />
            <span>{activeModuleInfo?.name || "模块"}</span>
          </button>
          <div className="module-popover">
            <div className="module-popover-title">模块</div>
            <div className="module-list">
              {modules.map((module) => (
                <button
                  key={module.key}
                  className={`module-row ${activeModule === module.key ? "active" : ""}`}
                  title={module.name}
                  onClick={() => {
                    setMessage("");
                    setActiveModule(module.key);
                    setActiveFolder(null);
                    setSelectedFile(null);
                  }}
                >
                  <ModuleIcon moduleKey={module.key} size={16} />
                  <span>{module.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeModule === "admin" ? (
          <div className="sidebar-module-panel">
            <strong>{activeModuleInfo?.name || "当前模块"}</strong>
            <span>{activeModuleInfo?.description || "当前账号可以在这里查看模块内容。"}</span>
            <small>权限：{MODULE_ACCESS_LABELS[activeModuleAccess]}</small>
          </div>
        ) : null}

        {activeModule === "learning" ? (
          <div className="learning-sidebar-inline">
            <div className="section-head">
              <span>知识目录</span>
              {canEditActiveModule ? (
                <div className="section-actions">
                  <button
                    title="模板建文档"
                    onClick={() => setLearningTemplatePickerOpen((current) => !current)}
                  >
                    <FileBox size={16} />
                  </button>
                  <button title="新建文件夹" onClick={createLearningFolder}>
                    <FolderPlus size={16} />
                  </button>
                  <button title="新建文档" onClick={createLearningItem}>
                    <Plus size={16} />
                  </button>
                  <button
                    title="批量删除"
                    onClick={deleteSelectedLearningItems}
                    disabled={!selectedLearningIds.length}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : null}
            </div>
            {learningTemplatePickerOpen ? (
              <div className="learning-template-picker">
                <div className="learning-template-picker-head">
                  <div>
                    <strong>知识库模板</strong>
                    <span>先看模板结构，再决定是否创建文档。</span>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => setLearningTemplatePickerOpen(false)}>
                    收起
                  </button>
                </div>
                <div className="learning-template-picker-filters">
                  <div className="searchbox learning-template-search">
                    <Search size={16} />
                    <input
                      value={learningTemplateQuery}
                      placeholder="搜索模板名称、分类、标签、正文"
                      onChange={(event) => setLearningTemplateQuery(event.target.value)}
                    />
                  </div>
                  <select
                    value={learningTemplateCategory}
                    onChange={(event) => setLearningTemplateCategory(event.target.value)}
                  >
                    <option value="all">全部分类</option>
                    {learningTemplateCategories.map((item) => (
                      <option key={`template-category-${item}`} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="learning-template-picker-layout">
                  <div className="learning-template-picker-side">
                    <div className="learning-template-section">
                      <div className="learning-template-section-head">
                        <span>内置模板</span>
                      </div>
                      <div className="learning-template-list">
                        {filteredLearningTemplatesBuiltIn.map((template) => (
                          <button
                            key={template.key}
                            type="button"
                            className={`learning-template-card ${selectedLearningTemplatePreview?.key === template.key ? "active" : ""}`}
                            onClick={() => setSelectedLearningTemplatePreview(template)}
                          >
                            <span>{template.name}</span>
                            <small>{template.category} · {template.priority}优先级</small>
                          </button>
                        ))}
                        {!filteredLearningTemplatesBuiltIn.length ? (
                          <div className="learning-template-empty">当前筛选下没有内置模板</div>
                        ) : null}
                      </div>
                    </div>
                    {learningCustomTemplates.length ? (
                      <div className="learning-template-section">
                        <div className="learning-template-section-head">
                          <span>自定义模板</span>
                        </div>
                        <div className="learning-template-list">
                          {filteredLearningTemplatesCustom.map((template) => (
                            <div key={template.key} className="learning-template-custom-row">
                              <button
                                type="button"
                                className={`learning-template-card ${selectedLearningTemplatePreview?.key === template.key ? "active" : ""}`}
                                onClick={() => setSelectedLearningTemplatePreview(template)}
                              >
                                <span>{template.name}</span>
                                <small>{template.category} · {template.priority}优先级</small>
                              </button>
                              <button
                                type="button"
                                className="learning-template-delete"
                                onClick={() => deleteLearningTemplate(template.key)}
                              >
                                删除
                              </button>
                            </div>
                          ))}
                          {!filteredLearningTemplatesCustom.length ? (
                            <div className="learning-template-empty">当前筛选下没有自定义模板</div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {selectedLearningTemplatePreview ? (
                    <div className="learning-template-preview">
                      <div className="learning-template-preview-head">
                        <strong>{selectedLearningTemplatePreview.name}</strong>
                        <small>
                          {selectedLearningTemplatePreview.category} · {selectedLearningTemplatePreview.status} · {selectedLearningTemplatePreview.priority}优先级
                        </small>
                      </div>
                      <div className="learning-template-preview-tags">
                        {parseLearningTags(selectedLearningTemplatePreview.tags || "").map((tag) => (
                          <span key={`${selectedLearningTemplatePreview.key}-${tag}`}>#{tag}</span>
                        ))}
                      </div>
                      <pre className="learning-template-preview-content">{selectedLearningTemplatePreview.content}</pre>
                      <div className="learning-template-preview-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => createLearningItemFromTemplate(selectedLearningTemplatePreview)}
                        >
                          使用模板创建
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div
              ref={learningUtilityDockRef}
              className={`learning-utility-dock ${learningUtilityPanel ? "open" : ""}`}
              style={{ top: `${learningUtilityDockTop}px` }}
            >
              <button
                type="button"
                className={`learning-utility-handle ${learningUtilityPanel ? "open" : ""}`}
                title={learningUtilityPanel ? "收起资料侧栏" : "打开资料侧栏"}
                onPointerDown={handleLearningUtilityHandlePointerDown}
              >
                <span className="learning-utility-handle-badge" title="轻点展开，拖动可移动位置">
                  <ChevronRight size={18} />
                </span>
                <span className="learning-utility-handle-label">
                  {learningUtilityPanel ? "收起资料侧栏" : "资料侧栏"}
                </span>
              </button>

              {learningUtilityPanel ? (
                <div className="learning-utility-popover">
                  <div className="learning-utility-popover-head">
                    <strong>
                      {learningUtilityPanel === "filters" ? "搜索与筛选" : null}
                      {learningUtilityPanel === "categories" ? "分类与标签" : null}
                      {learningUtilityPanel === "shortcuts" ? "快捷入口" : null}
                      {learningUtilityPanel === "sqlLibrary" ? "SQL 片段库" : null}
                    </strong>
                    <button type="button" onClick={() => setLearningUtilityPanel(null)}>
                      <X size={14} />
                    </button>
                  </div>

                  <div className="learning-utility-nav">
                    <button
                      type="button"
                      className={learningUtilityPanel === "filters" ? "active" : ""}
                      onClick={() => setLearningUtilityPanel("filters")}
                    >
                      <Search size={16} />
                      <span>搜索与筛选</span>
                    </button>
                    <button
                      type="button"
                      className={learningUtilityPanel === "categories" ? "active" : ""}
                      onClick={() => setLearningUtilityPanel("categories")}
                    >
                      <BookOpen size={16} />
                      <span>分类与标签</span>
                    </button>
                    {(learningPinnedDocs.length || learningRecentDocs.length) ? (
                      <button
                        type="button"
                        className={learningUtilityPanel === "shortcuts" ? "active" : ""}
                        onClick={() => setLearningUtilityPanel("shortcuts")}
                      >
                        <History size={16} />
                        <span>快捷入口</span>
                      </button>
                    ) : null}
                    {learningSqlSnippets.length ? (
                      <button
                        type="button"
                        className={learningUtilityPanel === "sqlLibrary" ? "active" : ""}
                        onClick={() => setLearningUtilityPanel("sqlLibrary")}
                      >
                        <FileBox size={16} />
                        <span>SQL 片段库</span>
                      </button>
                    ) : null}
                  </div>

                  {learningUtilityPanel === "filters" ? (
                    <div className="learning-utility-popover-body">
                      <div className="learning-toolbar">
                        <div className="searchbox learning-search">
                          <Search size={16} />
                          <input
                            value={learningFilters.query}
                            placeholder="搜索标题、分类、正文、链接"
                            onChange={(event) => applyLearningSearchQuery(event.target.value)}
                          />
                        </div>
                        {learningRecentSearches.length ? (
                          <div className="recent-search-row">
                            <span>最近搜索</span>
                            <div>
                              {learningRecentSearches.map((term) => (
                                <button key={`learning-search-${term}`} type="button" onClick={() => applyLearningSearchQuery(term)}>
                                  {term}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="learning-filter-row">
                          <select
                            value={learningFilters.status}
                            onChange={(event) => setLearningFilters((current) => ({ ...current, status: event.target.value }))}
                          >
                            <option value="all">全部状态</option>
                            <option value="计划中">计划中</option>
                            <option value="进行中">进行中</option>
                            <option value="已完成">已完成</option>
                            <option value="暂停">暂停</option>
                          </select>
                          <select
                            value={learningFilters.itemType}
                            onChange={(event) => setLearningFilters((current) => ({ ...current, itemType: event.target.value }))}
                          >
                            <option value="all">全部内容</option>
                            <option value="doc">仅文档</option>
                            <option value="folder">仅文件夹</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {learningUtilityPanel === "categories" ? (
                    <div className="learning-utility-popover-body">
                      <div className="learning-sidebar-tag-adder">
                        <input
                          value={learningSidebarTagInput}
                          placeholder="添加标签"
                          onChange={(event) => setLearningSidebarTagInput(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              addSidebarLearningTag();
                            }
                          }}
                        />
                        <button type="button" onClick={addSidebarLearningTag}>添加</button>
                      </div>
                      <div className="learning-category-strip compact">
                        <div>
                          {learningCategories.map((item) => (
                            <button
                              key={item}
                              type="button"
                              className={learningFilters.query === item ? "active" : ""}
                              onClick={() => setLearningFilters((current) => ({ ...current, query: current.query === item ? "" : item }))}
                            >
                              {item}
                            </button>
                          ))}
                        </div>
                      </div>
                      {learningSidebarTags.length ? (
                        <div className="learning-category-strip compact">
                          <div>
                            {learningSidebarTags.slice(0, 16).map((item) => (
                              <button
                                key={`tag-filter-${item}`}
                                type="button"
                                className={learningFilters.query === item ? "active" : ""}
                                onClick={() => {
                                  toggleLearningTagFilter(item);
                                  setLearningRecentSearches((current) => pushRecentSearch(current, item));
                                }}
                              >
                                #{item}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {learningUtilityPanel === "shortcuts" ? (
                    <div className="learning-utility-popover-body">
                      {learningPinnedDocs.length ? (
                        <div className="learning-mini-section">
                          <span>置顶文档</span>
                          <div className="learning-mini-list">
                            {learningPinnedDocs.map((item) => (
                              <button key={`pinned-${item.id}`} type="button" onClick={() => selectLearningItem(item)}>
                                {item.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {learningRecentDocs.length ? (
                        <div className="learning-mini-section">
                          <span>最近编辑</span>
                          <div className="learning-mini-list">
                            {learningRecentDocs.map((item) => (
                              <button key={`recent-${item.id}`} type="button" onClick={() => selectLearningItem(item)}>
                                {item.title}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {learningUtilityPanel === "sqlLibrary" ? (
                    <div className="learning-utility-popover-body">
                      <div className="searchbox learning-search learning-sql-library-search">
                        <Search size={16} />
                        <input
                          value={learningSqlLibraryQuery}
                          placeholder="搜索 SQL 名称、目录、正文"
                          onChange={(event) => setLearningSqlLibraryQuery(event.target.value)}
                        />
                      </div>
                      <div className="learning-sql-library-filters">
                        <div className="learning-sql-filter-row">
                          <select
                            value={learningSqlLibraryCategory}
                            onChange={(event) => setLearningSqlLibraryCategory(event.target.value)}
                          >
                            <option value="all">全部分类</option>
                            {learningSqlLibraryCategories.map((item) => (
                              <option key={`snippet-category-${item}`} value={item}>{item}</option>
                            ))}
                          </select>
                          <select
                            value={learningSqlLibraryTag}
                            onChange={(event) => setLearningSqlLibraryTag(event.target.value)}
                          >
                            <option value="all">全部标签</option>
                            {learningSqlLibraryTags.map((item) => (
                              <option key={`snippet-tag-${item}`} value={item}>{item}</option>
                            ))}
                          </select>
                          <select
                            value={learningSqlLibraryOwner}
                            onChange={(event) => setLearningSqlLibraryOwner(event.target.value)}
                          >
                            <option value="all">全部负责人</option>
                            {learningSqlLibraryOwners.map((item) => (
                              <option key={`snippet-owner-${item}`} value={item}>{item}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="learning-sql-library-list">
                        {filteredLearningSqlSnippets.slice(0, 12).map((snippet) => (
                          <article className="learning-sql-snippet-card" key={snippet.id}>
                            <button
                              type="button"
                              className="learning-sql-snippet-main"
                              onClick={() => openLearningSnippetDetail(snippet)}
                            >
                              <div className="learning-sql-snippet-meta">
                                <strong>{snippet.title}</strong>
                                <span>{snippet.itemTitle}</span>
                              </div>
                              <small>
                                {snippet.category || "未分类"}
                                {snippet.purpose ? ` · ${snippet.purpose}` : ""}
                                {snippet.sourceTable ? ` · ${snippet.sourceTable}` : ""}
                              </small>
                              <code className="learning-sql-snippet-preview">
                                {((snippet.rawContent || snippet.content || "").split(/\r?\n/).find((line) => line.trim()) || "").slice(0, 120)}
                              </code>
                              {(snippet.purpose || snippet.sourceTable || snippet.targetTable || snippet.owner || snippet.notes) ? (
                                <div className="learning-sql-snippet-details">
                                  {snippet.purpose ? <span><strong>用途</strong>{snippet.purpose}</span> : null}
                                  {snippet.sourceTable ? <span><strong>来源表</strong>{snippet.sourceTable}</span> : null}
                                  {snippet.targetTable ? <span><strong>目标表</strong>{snippet.targetTable}</span> : null}
                                  {snippet.owner ? <span><strong>负责人</strong>{snippet.owner}</span> : null}
                                  {snippet.notes ? <span><strong>备注</strong>{snippet.notes}</span> : null}
                                </div>
                              ) : null}
                              {snippet.tags?.length ? (
                                <div className="learning-sql-snippet-tags">
                                  {snippet.tags.slice(0, 4).map((tag) => (
                                    <span key={`${snippet.id}-${tag}`}>#{tag}</span>
                                  ))}
                                </div>
                              ) : null}
                            </button>
                            <div className="learning-sql-snippet-actions">
                              <button
                                type="button"
                                className="learning-sql-snippet-copy"
                                onClick={() => openLearningSnippetSource(snippet)}
                              >
                                源文档
                              </button>
                              <button
                                type="button"
                                className="learning-sql-snippet-copy"
                                onClick={() => insertLearningSqlSnippet(snippet)}
                              >
                                插入
                              </button>
                              <button
                                type="button"
                                className="learning-sql-snippet-copy"
                                onClick={() => createDocumentFromSnippet(snippet)}
                              >
                                建文档
                              </button>
                              <button
                                type="button"
                                className="learning-sql-snippet-copy"
                                onClick={() => copyLearningSqlSnippet(snippet)}
                              >
                                复制
                              </button>
                            </div>
                          </article>
                        ))}
                        {!filteredLearningSqlSnippets.length ? (
                          <div className="learning-sql-empty">没有匹配的 SQL 片段</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {selectedLearningIds.length ? (
              <div className="learning-batch-toolbar learning-batch-toolbar-inline">
                <span className="batch-summary">已选 {selectedLearningIds.length} 项内容</span>
                <div className="batch-actions">
                  <select
                    className="batch-target-select"
                    value={learningBatchTargetParentId}
                    onChange={(event) => setLearningBatchTargetParentId(event.target.value)}
                  >
                    <option value="">移动到知识库根目录</option>
                    {learningFolderOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.title}</option>
                    ))}
                  </select>
                  <button type="button" onClick={moveSelectedLearningItems}>
                    批量移动
                  </button>
                  <button type="button" onClick={updateSelectedLearningCategory}>
                    批量改分类
                  </button>
                </div>
              </div>
            ) : null}

            <div className="tree learning-sidebar-tree learning-sidebar-tree-inline">
              {canEditActiveModule ? (
                <button
                  className={`tree-row root-drop-row ${dragOverLearningId === "root" ? "drop-target" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverLearningId("root");
                  }}
                  onDragLeave={() => setDragOverLearningId(null)}
                  onDrop={(event) => moveDraggedLearningItem(event, null)}
                >
                  <span className="tree-toggle" />
                  <Folder size={16} />
                  <span>知识库一级目录</span>
                </button>
              ) : null}
              {filteredLearningTree.map((item) => (
                <LearningTreeNode
                  key={item.id}
                  node={item}
                  activeId={selectedLearningId}
                  dragOverId={dragOverLearningId}
                  draggable={canEditActiveModule}
                  selectable={canEditActiveModule}
                  selectedIds={selectedLearningIds}
                  onSelect={selectLearningItem}
                  onToggleSelect={toggleLearningSelection}
                  onDragStart={startDrag}
                  onDropItem={moveDraggedLearningItem}
                  onDragOverItem={setDragOverLearningId}
                />
              ))}
              {!filteredLearningTree.length ? (
                <div className="empty-state module-empty">还没有匹配的文档</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeModule === "archive_3d" ? (
          <>
            <div className="section-head">
              <span>项目</span>
              <button title="新建项目" onClick={createProject} disabled={!canEditActiveModule}>
                <Plus size={16} />
              </button>
            </div>
            <div className="project-list">
              <div className="archive-project-filters">
                <input
                  className="archive-project-search"
                  value={archiveProjectQuery}
                  placeholder="搜索项目、客户、联系人"
                  onChange={(event) => setArchiveProjectQuery(event.target.value)}
                />
                <select
                  className="archive-project-stage-select"
                  value={archiveProjectStageFilter}
                  onChange={(event) => setArchiveProjectStageFilter(event.target.value)}
                >
                  <option value="all">全部阶段</option>
                  <option value="需求">需求</option>
                  <option value="建模">建模</option>
                  <option value="贴图">贴图</option>
                  <option value="灯光">灯光</option>
                  <option value="渲染">渲染</option>
                  <option value="交付">交付</option>
                </select>
              </div>
              {archiveProjectStageOptions.length ? (
                <div className="archive-stage-pills">
                  <button
                    type="button"
                    className={archiveProjectStageFilter === "all" ? "active" : ""}
                    onClick={() => setArchiveProjectStageFilter("all")}
                  >
                    全部阶段
                    <span>{projects.length}</span>
                  </button>
                  {archiveProjectStageOptions.map((item) => (
                    <button
                      type="button"
                      key={`project-stage-pill-${item.stage}`}
                      className={archiveProjectStageFilter === item.stage ? "active" : ""}
                      onClick={() => setArchiveProjectStageFilter(item.stage)}
                    >
                      {item.stage}
                      <span>{item.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {archiveVisibleProjects.map((item) => (
                <button
                  key={item.id}
                  className={`project-row ${project?.id === item.id ? "active" : ""}`}
                  onClick={() => {
                    setProject(item);
                    setActiveFolder(null);
                    setSelectedFile(null);
                  }}
                >
                  <Archive size={16} />
                  <div className="project-row-copy">
                    <span>{item.name}</span>
                    <small>
                      {[
                        item.client_name || "未填客户",
                        item.contact_name || "",
                        item.stage || "建模",
                        item.delivery_date ? `交付 ${item.delivery_date}` : "",
                      ].filter(Boolean).join(" · ")}
                    </small>
                    {item.delivery_notes ? (
                      <small className="project-row-notes">{item.delivery_notes}</small>
                    ) : null}
                  </div>
                  <em>{item.status || "制作中"}</em>
                  <small>{formatSize(item.total_size)}</small>
                </button>
              ))}
              {!archiveVisibleProjects.length ? (
                <div className="empty-state module-empty">没有匹配的项目</div>
              ) : null}
            </div>
            {project ? (
              <div className={`archive-project-panel ${archiveProjectPanelOpen ? "expanded" : "collapsed"}`}>
                <button
                  type="button"
                  className="archive-project-toggle"
                  onClick={() => setArchiveProjectPanelOpen((current) => !current)}
                >
                  <div className="archive-project-toggle-copy">
                    <strong>项目资料</strong>
                    <span>
                      {[projectDraft.client_name || "未填写客户", projectDraft.status || "制作中"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <span className={`archive-project-toggle-arrow ${archiveProjectPanelOpen ? "open" : ""}`}>
                    <ChevronRight size={16} />
                  </span>
                </button>
                {archiveProjectPanelOpen ? (
                  <div className="archive-project-panel-body">
                    <div className="archive-project-panel-head">
                      <span>{canEditActiveModule ? "这里维护客户、状态和备注" : "当前账号可查看项目资料"}</span>
                    </div>
                    <label>
                      <span>项目名称</span>
                      <input
                        value={projectDraft.name}
                        readOnly={!canEditActiveModule}
                        onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))}
                      />
                    </label>
                    <div className="archive-project-panel-grid">
                      <label>
                        <span>客户</span>
                        <input
                          value={projectDraft.client_name}
                          readOnly={!canEditActiveModule}
                          placeholder="客户或负责人"
                          onChange={(event) => setProjectDraft((current) => ({ ...current, client_name: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>联系人</span>
                        <input
                          value={projectDraft.contact_name}
                          readOnly={!canEditActiveModule}
                          placeholder="对接人 / 联系方式"
                          onChange={(event) => setProjectDraft((current) => ({ ...current, contact_name: event.target.value }))}
                        />
                      </label>
                      <label>
                        <span>状态</span>
                        <select
                          value={projectDraft.status}
                          disabled={!canEditActiveModule}
                          onChange={(event) => setProjectDraft((current) => ({ ...current, status: event.target.value }))}
                        >
                          <option>制作中</option>
                          <option>待确认</option>
                          <option>已交付</option>
                          <option>已归档</option>
                        </select>
                      </label>
                      <label>
                        <span>阶段</span>
                        <select
                          value={projectDraft.stage}
                          disabled={!canEditActiveModule}
                          onChange={(event) => setProjectDraft((current) => ({ ...current, stage: event.target.value }))}
                        >
                          {PROJECT_STAGE_OPTIONS.map((item) => (
                            <option key={item} value={item}>{item}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>交付日期</span>
                        <input
                          type="date"
                          value={projectDraft.delivery_date || ""}
                          readOnly={!canEditActiveModule}
                          onChange={(event) => setProjectDraft((current) => ({ ...current, delivery_date: event.target.value }))}
                        />
                      </label>
                    </div>
                    <label>
                      <span>项目说明</span>
                      <textarea
                        value={projectDraft.description}
                        readOnly={!canEditActiveModule}
                        placeholder="记录交付说明、特殊约束、文件组织说明"
                        onChange={(event) => setProjectDraft((current) => ({ ...current, description: event.target.value }))}
                      />
                    </label>
                    <label>
                      <span>交付备注</span>
                      <textarea
                        value={projectDraft.delivery_notes}
                        readOnly={!canEditActiveModule}
                        placeholder="记录交付版本、素材范围、客户确认点和回传要求"
                        onChange={(event) => setProjectDraft((current) => ({ ...current, delivery_notes: event.target.value }))}
                      />
                    </label>
                    <div className="archive-project-timeline">
                      <div className="archive-project-timeline-head">
                        <strong>项目时间线</strong>
                        <span>最近 {projectTimeline.length || 0} 条操作，帮我们回看项目推进过程</span>
                      </div>
                      {projectTimeline.length ? (
                        <div className="archive-project-timeline-list">
                          {projectTimeline.map((entry) => (
                            <div className="archive-project-timeline-item" key={`timeline-${entry.id}`}>
                              <div className="archive-project-timeline-dot" />
                              <div className="archive-project-timeline-copy">
                                <strong>{formatAuditActionLabel(entry.action)}</strong>
                                <span>
                                  {[formatTimelineTargetLabel(entry.target_type), entry.user_name || "系统", entry.created_at?.slice(0, 16).replace("T", " ") || ""]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                                {entry.detail ? <small>{entry.detail}</small> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-version">这个项目还没有可展示的时间线记录。</div>
                      )}
                    </div>
                    {canEditActiveModule ? (
                      <button
                        type="button"
                        className="primary-button archive-project-save"
                        disabled={!projectDraftDirty || projectSaving}
                        onClick={saveProjectDraft}
                      >
                        {projectSaving ? "保存中..." : "保存项目资料"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="section-head">
              <span>目录</span>
              <button title="新建目录" onClick={createFolder} disabled={!canEditActiveModule}>
                <FolderPlus size={16} />
              </button>
            </div>
            <div className="tree">
              <button
                className={`tree-row root-drop-row ${dragOverFolderId === "root" ? "drop-target" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverFolderId("root");
                }}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={(event) => moveDraggedItem(event, null)}
              >
                <span className="tree-toggle" />
                <Folder size={16} />
                <span>项目一级目录</span>
              </button>
              {tree.map((folder) => (
                <FolderNode
                  key={folder.id}
                  folder={folder}
                  activeId={activeFolder?.id}
                  dragOverId={dragOverFolderId}
                  onSelect={(next) => {
                    setActiveFolder(next);
                    setSelectedFile(null);
                  }}
                  onDragStart={startDrag}
                  onDropItem={moveDraggedItem}
                  onDragOverFolder={setDragOverFolderId}
                />
              ))}
            </div>
          </>
        ) : null}

      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>
              {activeModule === "archive_3d" ? project?.name || "请选择项目" : null}
              {activeModule === "learning" ? "大数据知识库" : null}
              {activeModule === "admin" ? "系统管理" : null}
            </h1>
            <p>
              {activeModule === "archive_3d" ? activeFolder?.name || "请选择目录" : null}
              {activeModule === "learning" ? "在这里写方案、SQL 模板、复盘和知识文档" : null}
              {activeModule === "admin" ? "创建用户并分配模块访问权限" : null}
            </p>
          </div>
          {activeModule === "archive_3d" ? (
            <div className="topbar-actions">
              <div className="topbar-stats">
                <span><strong>{archiveStats.projects}</strong> 项目</span>
                <span><strong>{archiveStats.folders}</strong> 子目录</span>
                <span><strong>{archiveStats.files}</strong> 文件</span>
                <span><strong>{archiveStats.size}</strong></span>
              </div>
              <div className="toolbar">
                <div className="searchbox">
                  <Search size={16} />
                  <input
                    value={archiveSearch.query}
                    placeholder={archiveSearch.scope === "project" ? "搜索整个项目文件" : "搜索当前目录文件"}
                    onChange={(event) => applyArchiveSearchPatch({ query: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        setArchiveSearchTick((current) => current + 1);
                        if (archiveSearch.query.trim()) {
                          setArchiveRecentSearches((current) => pushRecentSearch(current, archiveSearch.query));
                        }
                      }
                    }}
                  />
                </div>
                <select
                  className="toolbar-select"
                  value={archiveSearch.scope}
                  onChange={(event) => {
                    applyArchiveSearchPatch({ scope: event.target.value }, { reloadFiles: true });
                  }}
                >
                  <option value="folder">当前目录</option>
                  <option value="project">整个项目</option>
                </select>
                <select
                  className="toolbar-select"
                  value={archiveSearch.kind}
                  onChange={(event) => {
                    applyArchiveSearchPatch({ kind: event.target.value }, { reloadFiles: true });
                  }}
                >
                  <option value="all">全部类型</option>
                  <option value="model">3D 模型</option>
                  <option value="cad">工程图/CAD</option>
                  <option value="image">图片贴图</option>
                  <option value="video">视频预览</option>
                  <option value="doc">文档文本</option>
                  <option value="archive">压缩包</option>
                </select>
                <select
                  className="toolbar-select"
                  value={archiveSearch.status}
                  onChange={(event) => {
                    applyArchiveSearchPatch({ status: event.target.value }, { reloadProjects: true });
                  }}
                >
                  <option value="all">全部项目状态</option>
                  <option value="制作中">制作中</option>
                  <option value="待确认">待确认</option>
                  <option value="已交付">已交付</option>
                  <option value="已归档">已归档</option>
                </select>
                <IconButton label="刷新" onClick={() => activeFolder && loadItems(activeFolder.id)}>
                  <RefreshCw size={17} />
                </IconButton>
                <IconButton label="下载当前目录" onClick={downloadFolder}>
                  <Download size={17} />
                </IconButton>
                <IconButton label="回收站" onClick={loadTrash}>
                  <Trash2 size={17} />
                </IconButton>
                <IconButton label="备份数据库" onClick={backup}>
                  <Shield size={17} />
                </IconButton>
                <IconButton label="全局搜索" onClick={() => setGlobalFinderOpen(true)}>
                  <Search size={17} />
                </IconButton>
                <IconButton label="退出登录" onClick={logout}>
                  <LogOut size={17} />
                </IconButton>
              </div>
              {archiveRecentSearches.length ? (
                <div className="recent-search-row recent-search-row-topbar">
                  <span>最近搜索</span>
                  <div>
                    {archiveRecentSearches.map((term) => (
                      <button key={`archive-search-${term}`} type="button" onClick={() => applyArchiveSearchPatch({ query: term }, { reloadProjects: true, reloadFiles: true })}>
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : activeModule === "learning" ? (
            <div className="topbar-actions">
              <div className="topbar-stats">
                <span><strong>{learningStats.total}</strong> 文档</span>
                <span><strong>{learningStats.inProgress}</strong> 进行中</span>
                <span><strong>{learningStats.completed}</strong> 已完成</span>
                <span><strong>{learningStats.highPriority}</strong> 高优先级</span>
                <span><strong>{learningStats.pinned}</strong> 已置顶</span>
              </div>
              <div className="toolbar">
                <IconButton label="全局搜索" onClick={() => setGlobalFinderOpen(true)}>
                  <Search size={17} />
                </IconButton>
                <IconButton label="退出登录" onClick={logout}>
                  <LogOut size={17} />
                </IconButton>
              </div>
            </div>
          ) : (
            <div className="toolbar">
              <IconButton label="全局搜索" onClick={() => setGlobalFinderOpen(true)}>
                <Search size={17} />
              </IconButton>
              <IconButton label="退出登录" onClick={logout}>
                <LogOut size={17} />
              </IconButton>
            </div>
          )}
        </header>

        {activeModule === "archive_3d" ? (
        <div
          className="content-grid"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (event.dataTransfer.files?.length) {
              uploadFiles(event.dataTransfer.files);
            }
          }}
        >
          <section className="file-pane">
            <div className="pane-head">
              <div>
                <strong>文件</strong>
                <span>
                  {archiveSearch.scope === "project"
                    ? `当前项目搜到 ${items.files.length} 个文件`
                    : `${items.files.length} 个文件，${items.folders.length} 个子目录`}
                </span>
              </div>
              {canEditActiveModule ? (
              <div className="upload-actions">
                <label className="upload-button">
                  <Upload size={16} />
                  {uploading ? "上传中..." : "上传文件"}
                  <input ref={uploadRef} type="file" multiple onChange={(event) => uploadFiles(event.target.files)} />
                </label>
                <label className="upload-button secondary">
                  <FolderPlus size={16} />
                  上传文件夹
                  <input
                    ref={folderUploadRef}
                    type="file"
                    multiple
                    webkitdirectory="true"
                    directory="true"
                    onChange={(event) => uploadFiles(event.target.files)}
                  />
                </label>
              </div>
              ) : (
                <span className="readonly-hint">仅查看权限</span>
              )}
            </div>
            {items.files.length ? (
              <div className="batch-toolbar">
                <label className="batch-select-all">
                  <input
                    type="checkbox"
                    checked={selectedArchiveIds.length > 0 && selectedArchiveIds.length === items.files.length}
                    onChange={toggleArchiveSelectAll}
                  />
                  <span>全选当前结果</span>
                </label>
                <span className="batch-summary">
                  {selectedArchiveIds.length ? `已选 ${selectedArchiveIds.length} 个文件` : "还没有选中文件"}
                </span>
                <div className="batch-actions">
                  <select
                    className="batch-target-select"
                    value={archiveBatchTargetFolderId}
                    onChange={(event) => setArchiveBatchTargetFolderId(event.target.value)}
                  >
                    <option value="">选择目标目录</option>
                    {archiveFolderOptions.map((folder) => (
                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={moveSelectedFiles}
                    disabled={!selectedArchiveIds.length || !archiveBatchTargetFolderId}
                  >
                    批量移动
                  </button>
                  <button type="button" onClick={downloadSelectedFiles} disabled={!selectedArchiveIds.length}>
                    批量下载
                  </button>
                  {canEditActiveModule ? (
                    <button type="button" onClick={deleteSelectedFiles} disabled={!selectedArchiveIds.length}>
                      批量删除
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="table">
              <div className="table-row table-head">
                <span>选择</span>
                <span>名称</span>
                <span>类型</span>
                <span>大小</span>
                <span>版本</span>
                <span>更新</span>
                <span>操作</span>
              </div>
              {items.folders.map((folder) => (
                <button
                  key={`folder-${folder.id}`}
                  className={`table-row folder-table-row as-button ${dragOverFolderId === folder.id ? "drop-target" : ""}`}
                  draggable
                  onDragStart={(event) =>
                    startDrag(event, {
                      type: "folder",
                      id: folder.id,
                      parentId: folder.parent_id,
                      name: folder.name,
                    })
                  }
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverFolderId(folder.id);
                  }}
                  onDragLeave={() => setDragOverFolderId(null)}
                  onDrop={(event) => moveDraggedItem(event, folder)}
                  onClick={() => {
                    setActiveFolder(folder);
                    setSelectedFile(null);
                  }}
                >
                  <span />
                  <span className="file-name"><Folder size={18} />{folder.name}</span>
                  <span>目录</span>
                  <span>-</span>
                  <span>-</span>
                  <span>{folder.updated_at?.slice(0, 10)}</span>
                  <span>打开</span>
                </button>
              ))}
              {items.files.map((file) => (
                <div
                  key={file.id}
                  className={`table-row file-table-row ${selectedFile?.id === file.id ? "selected" : ""}`}
                  draggable
                  onDragStart={(event) =>
                    startDrag(event, {
                      type: "file",
                      id: file.id,
                      folderId: file.folder_id,
                      name: file.name,
                    })
                  }
                  onClick={() => setSelectedFile(file)}
                >
                  <span className="archive-select-cell">
                    <input
                      type="checkbox"
                      checked={selectedArchiveIds.includes(file.id)}
                      onChange={() => toggleArchiveSelection(file.id)}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </span>
                  <span className="file-name file-name-stack">
                    <span className="file-name-main"><FileIcon ext={file.extension} />{file.name}</span>
                    {archiveSearch.scope === "project" && file.folder_name ? (
                      <small className="file-location-tag">{file.folder_name}</small>
                    ) : null}
                  </span>
                  <span>.{file.extension || "file"}</span>
                  <span>{formatSize(file.size)}</span>
                  <span>v{file.version_no || 1}</span>
                  <span>{file.updated_at?.slice(0, 10)}</span>
                  <span className="row-actions">
                    <IconButton label="下载文件" onClick={(event) => { event.stopPropagation(); downloadFile(file.id); }}>
                      <Download size={15} />
                    </IconButton>
                    {canEditActiveModule ? (
                    <>
                    <IconButton label="重命名" onClick={(event) => { event.stopPropagation(); renameFile(file); }}>
                      <History size={15} />
                    </IconButton>
                    <IconButton label="删除到回收站" onClick={(event) => { event.stopPropagation(); deleteFile(file); }}>
                      <Trash2 size={15} />
                    </IconButton>
                    </>
                    ) : null}
                  </span>
                </div>
              ))}
              {!items.files.length && !items.folders.length ? (
                <div className="empty-state">把 3D 工程文件拖到这里上传</div>
              ) : null}
            </div>
          </section>

          {detail ? (
            <div className="detail-backdrop" onClick={() => setSelectedFile(null)}>
              <aside className="detail-pane" onClick={(event) => event.stopPropagation()}>
                <div className="pane-head detail-head">
                  <div>
                    <strong>文件详情</strong>
                    <span>版本、下载和有效性</span>
                  </div>
                  <IconButton label="关闭详情" onClick={() => setSelectedFile(null)}>
                    <X size={18} />
                  </IconButton>
              </div>
              <div className="detail-body">
                <div className="preview-box">
                  {(() => {
                    const previewKind = getPreviewKind(detail.file.extension);
                    const previewUrl = `${API}/files/${detail.file.id}/preview?token=${encodeURIComponent(token)}`;
                    if (previewKind === "image") {
                      return <img src={previewUrl} alt={detail.file.name} />;
                    }
                    if (previewKind === "video") {
                      return <video src={previewUrl} controls />;
                    }
                    if (previewKind === "pdf") {
                      return <iframe title={detail.file.name} src={previewUrl} />;
                    }
                    if (previewKind === "text") {
                      return (
                        <pre className="text-preview">
                          {previewError || previewText}
                        </pre>
                      );
                    }
                    return (
                      <div className="unsupported-preview">
                        <FileIcon ext={detail.file.extension} />
                        <strong>{detail.file.name}</strong>
                        <span>该格式暂不支持在线预览，请下载后用对应软件打开。</span>
                      </div>
                    );
                  })()}
                </div>
                <div className="file-summary">
                  <strong>{detail.file.name}</strong>
                  <span>{formatSize(detail.file.size)}</span>
                </div>
                <dl>
                  <dt>上传人</dt>
                  <dd>{detail.file.created_by_name || "-"}</dd>
                  <dt>类型</dt>
                  <dd>.{detail.file.extension || "file"}</dd>
                  <dt>更新时间</dt>
                  <dd>{detail.file.updated_at}</dd>
                </dl>
                <div className="version-heading">
                  <h2>历史版本</h2>
                  <label>
                    <input
                      type="checkbox"
                      checked={showIneffectiveVersions}
                      onChange={(event) => setShowIneffectiveVersions(event.target.checked)}
                    />
                    显示失效
                  </label>
                </div>
                <div className="version-list">
                  {visibleVersions.map((version) => (
                    <div
                      key={version.id}
                      className={`version-row ${version.is_effective ? "" : "ineffective"}`}
                    >
                      <div>
                        <strong>
                          v{version.version_no}
                          <span className={`version-badge ${version.is_effective ? "effective" : "ineffective"}`}>
                            {version.is_effective ? "有效" : "失效"}
                          </span>
                          {version.is_final ? (
                            <span className="version-badge final">最终版</span>
                          ) : null}
                        </strong>
                        <span>{formatSize(version.size)} · {version.uploaded_by_name || "-"}</span>
                        {version.remark ? <small>{version.remark}</small> : null}
                      </div>
                      <div className="version-actions">
                        <button title="下载版本" onClick={() => downloadFile(detail.file.id, version.id)}>
                          <Download size={15} />
                        </button>
                        {canEditActiveModule ? (
                          <button
                            type="button"
                            className="version-remark-button"
                            title="编辑版本备注"
                            onClick={() => updateVersionRemark(version)}
                          >
                            备注
                          </button>
                        ) : null}
                        {canEditActiveModule && version.id !== detail.file.current_version_id ? (
                          <button
                            title={version.is_effective ? "标记失效" : "恢复有效"}
                            onClick={() => setVersionEffectiveness(version, !version.is_effective)}
                          >
                            {version.is_effective ? "失效" : "有效"}
                          </button>
                        ) : null}
                        {canEditActiveModule ? (
                          <button
                            title={version.is_final ? "取消最终版" : "标记为最终版"}
                            onClick={() => setVersionFinal(version, !version.is_final)}
                          >
                            {version.is_final ? "取消最终版" : "设为最终版"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  {!visibleVersions.length ? (
                    <div className="empty-version">没有可显示的版本</div>
                  ) : null}
                </div>
              </div>
              </aside>
            </div>
          ) : null}
        </div>
        ) : null}

        {activeModule === "learning" ? (
          <section className="module-page learning-page">
            <section className="learning-editor-pane learning-editor-pane-wide">
                {selectedLearningItem?.item_type === "doc" ? (
                  <>
                    <div className="learning-editor-head">
                      <div className="learning-editor-title-wrap">
                        <span className="learning-editor-kicker">文档编辑</span>
                        {showLearningEditor ? (
                          <input
                            ref={learningTitleRef}
                            className="learning-editor-title"
                            value={learningDraft.title}
                            readOnly={!showLearningEditor}
                            placeholder="输入文档标题"
                            onChange={(event) =>
                              setLearningDraft((current) => ({ ...current, title: event.target.value }))
                            }
                          />
                        ) : (
                          <div className="learning-read-title">{learningDraft.title || "未命名文档"}</div>
                        )}
                        <span className="learning-editor-meta-line">
                          最后更新 {selectedLearningItem.updated_at?.slice(0, 10) || "-"}
                          {learningDraftDirty ? " · 未保存" : ""}
                          {!learningDraftDirty && !learningEditing ? " · 已保存" : ""}
                          {learningAutosaveLabel ? ` · ${learningAutosaveLabel}` : ""}
                        </span>
                      </div>
                      <div className="learning-editor-actions">
                        {selectedLearningItem.resource_url ? (
                          <button type="button" onClick={() => openLearningLink(selectedLearningItem)}>
                            <ExternalLink size={14} />
                            打开资料
                          </button>
                        ) : null}
                        <div className="learning-view-switch" role="tablist" aria-label="文档视图模式">
                          <button
                            type="button"
                            className={!learningEditing ? "active" : ""}
                            onClick={() => setLearningEditing(false)}
                          >
                            阅读
                          </button>
                          <button
                            type="button"
                            className={learningEditing && learningViewMode === "write" ? "active" : ""}
                            onClick={() => openLearningEditor("write")}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className={learningEditing && learningViewMode === "split" ? "active" : ""}
                            onClick={() => openLearningEditor("split")}
                          >
                            分栏
                          </button>
                        </div>
                        {canEditActiveModule ? (
                          <>
                            {learningEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLearningDraft((current) => ({ ...current, is_pinned: !current.is_pinned }))
                                  }
                                >
                                  {learningDraft.is_pinned ? "取消置顶" : "设为置顶"}
                                </button>
                                <button type="button" onClick={saveLearningTemplateFromCurrentDoc}>
                                  存为模板
                                </button>
                                {isSqlContent(learningDraft.content) ? (
                                  <button type="button" onClick={formatLearningSqlDraft}>
                                    格式化 SQL
                                  </button>
                                ) : null}
                                <button type="button" onClick={cancelLearningEdit}>
                                  取消
                                </button>
                                <button
                                  type="button"
                                  className="primary-button"
                                  disabled={!learningDraftDirty || learningSaving}
                                  onClick={() => saveLearningDraft({ keepEditing: true })}
                                >
                                  {learningSaving ? "保存中..." : "保存文档"}
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" onClick={() => deleteLearningItem(selectedLearningItem)}>
                                  删除
                                </button>
                                <button type="button" className="primary-button" onClick={() => openLearningEditor("write")}>
                                  编辑
                                </button>
                              </>
                            )}
                          </>
                        ) : null}
                      </div>
                    </div>

                    {showLearningEditor ? (
                      <div className="learning-edit-stack">
                        <div className="learning-editor-meta">
                          <label>
                            <span>分类</span>
                            <input
                              value={learningDraft.category}
                              onChange={(event) =>
                                setLearningDraft((current) => ({ ...current, category: event.target.value }))
                              }
                            />
                          </label>
                          <label>
                            <span>状态</span>
                            <select
                              value={learningDraft.status}
                              onChange={(event) =>
                                setLearningDraft((current) => ({ ...current, status: event.target.value }))
                              }
                            >
                              <option>计划中</option>
                              <option>进行中</option>
                              <option>已完成</option>
                              <option>暂停</option>
                            </select>
                          </label>
                          <label>
                            <span>优先级</span>
                            <select
                              value={learningDraft.priority}
                              onChange={(event) =>
                                setLearningDraft((current) => ({ ...current, priority: event.target.value }))
                              }
                            >
                              <option>高</option>
                              <option>中</option>
                              <option>低</option>
                            </select>
                          </label>
                        </div>

                        <label className="learning-link-field">
                          <span>资料链接</span>
                          <input
                            value={learningDraft.resource_url}
                            placeholder="课程、文档、飞书、语雀、GitHub、博客地址"
                            onChange={(event) =>
                              setLearningDraft((current) => ({ ...current, resource_url: event.target.value }))
                            }
                          />
                        </label>
                        <label className="learning-link-field">
                          <span>标签</span>
                          <div className="learning-tag-editor">
                            <div className="learning-tag-display">
                              {currentLearningTags.length ? (
                                currentLearningTags.map((tag) => (
                                  <button
                                    key={tag}
                                    type="button"
                                    className="learning-tag-chip removable"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => removeLearningTag(tag)}
                                    title={`移除标签 ${tag}`}
                                  >
                                    #{tag}
                                    <span>×</span>
                                  </button>
                                ))
                              ) : null}
                              <div className="learning-tag-input-wrap">
                                <input
                                  ref={learningTagInputRef}
                                  className="learning-tag-input"
                                  value={learningTagInput}
                                  placeholder="筛选已有标签"
                                  onFocus={() => setLearningTagSuggestOpen(true)}
                                  onBlur={() => window.setTimeout(() => setLearningTagSuggestOpen(false), 120)}
                                  onChange={(event) => {
                                    setLearningTagInput(event.target.value);
                                    setLearningTagSuggestOpen(true);
                                  }}
                                  onKeyDown={handleLearningTagInputKeyDown}
                                />
                                <button
                                  type="button"
                                  className="learning-tag-trigger"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => setLearningTagSuggestOpen((current) => !current)}
                                  title="展开已有标签"
                                >
                                  选择
                                </button>
                                {learningTagSuggestOpen && filteredLearningTagSuggestions.length ? (
                                  <div className="learning-tag-dropdown">
                                    {filteredLearningTagSuggestions.map((tag) => (
                                      <button
                                        key={`dropdown-${tag}`}
                                        type="button"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => addLearningTag(tag)}
                                      >
                                        <span>#{tag}</span>
                                        <small>加入当前文档</small>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            {learningTagSuggestOpen && !filteredLearningTagSuggestions.length && availableLearningTagChoices.length ? (
                              <div className="learning-tag-picker">
                                <span>没有匹配项，请从已有标签中选择</span>
                              </div>
                            ) : !availableLearningTagChoices.length ? (
                              <div className="learning-tag-picker">
                                <span>还没有可选标签，请先在左侧“分类与标签”里维护标签</span>
                              </div>
                            ) : null}
                          </div>
                        </label>

                        <div className="learning-context-grid">
                          <section className="learning-context-card">
                            <div className="learning-context-head">
                              <strong>文档概览</strong>
                              <span>快速掌握当前文档结构和沉淀密度</span>
                            </div>
                            <div className="learning-insight-metrics">
                              {learningDocInsights.map((item) => (
                                <div key={`learning-insight-${item.label}`} className="learning-insight-pill">
                                  <strong>{item.value}</strong>
                                  <span>{item.label}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                          {learningRelatedDocs.length ? (
                            <section className="learning-context-card">
                              <div className="learning-context-head">
                                <strong>关联文档</strong>
                                <span>按分类和标签自动推荐，方便横向联想</span>
                              </div>
                              <div className="learning-related-list">
                                {learningRelatedDocs.map((item) => (
                                  <button
                                    type="button"
                                    key={`related-doc-${item.id}`}
                                    className="learning-related-item"
                                    onClick={() => selectLearningItem(item)}
                                  >
                                    <strong>{item.title}</strong>
                                    <span>
                                      {[item.category || "未分类", ...(item.sharedTags || []).slice(0, 2).map((tag) => `#${tag}`)].join(" · ")}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}
                          {learningReferencedDocs.length ? (
                            <section className="learning-context-card">
                              <div className="learning-context-head">
                                <strong>引用文档</strong>
                                <span>正文里已经点到的资料，顺手就能继续翻下去</span>
                              </div>
                              <div className="learning-related-list">
                                {learningReferencedDocs.map((item) => (
                                  <button
                                    type="button"
                                    key={`reference-doc-${item.id}`}
                                    className="learning-related-item"
                                    onClick={() => selectLearningItem(item)}
                                  >
                                    <strong>{item.title}</strong>
                                    <span>{[item.category || "未分类", item.updated_at?.slice(0, 10) || ""].filter(Boolean).join(" · ")}</span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}
                          {learningMentionedByDocs.length ? (
                            <section className="learning-context-card">
                              <div className="learning-context-head">
                                <strong>被引用文档</strong>
                                <span>这些文档也在引用当前资料，回溯关系会更清楚</span>
                              </div>
                              <div className="learning-related-list">
                                {learningMentionedByDocs.map((item) => (
                                  <button
                                    type="button"
                                    key={`mentioned-doc-${item.id}`}
                                    className="learning-related-item"
                                    onClick={() => selectLearningItem(item)}
                                  >
                                    <strong>{item.title}</strong>
                                    <span>{[item.category || "未分类", item.updated_at?.slice(0, 10) || ""].filter(Boolean).join(" · ")}</span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}
                        </div>

                        <div className="learning-edit-body">
                          <div className="learning-editor-label">
                            <strong>正文</strong>
                            <span>适合写学习笔记、方案、复盘和知识沉淀</span>
                          </div>
                          {learningOutline.length ? (
                            <div className="learning-outline-panel">
                              <div className="learning-outline-head">
                                <strong>文档目录</strong>
                                <span>{learningOutline.length} 个标题</span>
                              </div>
                              <div className="learning-outline-list">
                                {learningOutline.map((item) => (
                                  <button
                                    type="button"
                                    key={item.id}
                                    className={`learning-outline-chip level-${item.level} ${learningActiveOutlineAnchor === item.anchor ? "active" : ""}`}
                                    onClick={() => scrollLearningOutlineTo(item.anchor)}
                                  >
                                    {item.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div className="learning-snippet-toolbar">
                            <button type="button" onClick={() => insertLearningTemplate("heading1")}>H1</button>
                            <button type="button" onClick={() => insertLearningTemplate("heading2")}>H2</button>
                            <button type="button" onClick={() => insertLearningTemplate("list")}>列表</button>
                            <button type="button" onClick={() => insertLearningTemplate("todo")}>待办</button>
                            <button type="button" onClick={() => insertLearningTemplate("quote")}>引用</button>
                            <button type="button" onClick={() => insertLearningTemplate("code")}>代码块</button>
                            <button type="button" onClick={() => insertLearningTemplate("sql")}>SQL 模板</button>
                            <button type="button" onClick={() => insertLearningTemplate("table")}>表格</button>
                          </div>
                          <div className={`learning-edit-workspace ${learningViewMode === "split" ? "split" : ""}`}>
                            <div className="learning-edit-card">
                              <div className="learning-content-card-head">
                                <strong>编辑区</strong>
                                <span>{learningViewMode === "split" ? "左侧编写，右侧即时预览" : "支持 Ctrl/Cmd + S 保存"}</span>
                              </div>
                              <textarea
                                ref={learningContentRef}
                                value={learningDraft.content}
                                placeholder="在这里开始写你的文档..."
                                onChange={(event) =>
                                  setLearningDraft((current) => ({ ...current, content: event.target.value }))
                                }
                              />
                            </div>
                            {learningViewMode === "split" ? (
                              <div className="learning-edit-card learning-content-card-preview">
                                <div className="learning-content-card-head">
                                  <strong>即时预览</strong>
                                  <span>边写边看排版效果</span>
                                </div>
                                <article ref={learningSplitPreviewRef} className="learning-content-preview">
                                  {renderLearningContent(learningDraft.content)}
                                </article>
                              </div>
                            ) : null}
                          </div>
                          <div className="learning-version-panel">
                            <button
                              type="button"
                              className="learning-version-panel-head"
                              onClick={() => setLearningHistoryOpen((current) => !current)}
                            >
                              <strong>历史快照</strong>
                              <span>{learningVersions.length} 个版本，保存后自动沉淀</span>
                              <em>{learningHistoryOpen ? "收起" : "展开"}</em>
                            </button>
                            {learningHistoryOpen ? (
                              <div className="learning-version-list">
                                {learningVersions.map((version) => (
                                  <div className="learning-version-row" key={version.id}>
                                    <div>
                                      <strong>{version.title}</strong>
                                      <span>
                                        {version.created_at?.slice(0, 16).replace("T", " ")} · {version.created_by_name || "-"}
                                      </span>
                                      <small>{version.category} · {version.status} · {version.priority}优先级</small>
                                    </div>
                                    <button type="button" onClick={() => restoreLearningVersion(version)}>
                                      恢复
                                    </button>
                                  </div>
                                ))}
                                {!learningVersions.length ? (
                                  <div className="empty-version">还没有历史快照，先保存一次文档。</div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="learning-read-summary">
                          <div className="learning-read-meta">
                            <span className="learning-read-pill">分类：{learningDraft.category || "未分类"}</span>
                            <span className={`learning-read-pill status-${learningDraft.status || "计划中"}`}>状态：{learningDraft.status || "计划中"}</span>
                            <span className="learning-read-pill">优先级：{learningDraft.priority || "中"}</span>
                            {learningDraft.is_pinned ? <span className="learning-read-pill pinned">已置顶</span> : null}
                          </div>
                          <div className="learning-read-fields">
                            <div className="learning-read-field">
                              <span>资料链接</span>
                              {learningDraft.resource_url ? (
                                <a href={learningDraft.resource_url} target="_blank" rel="noreferrer">
                                  {learningDraft.resource_url}
                                </a>
                              ) : (
                                <em>未设置资料链接</em>
                              )}
                            </div>
                            <div className="learning-read-field">
                              <span>标签</span>
                              <div className={`learning-tag-display ${currentLearningTags.length ? "" : "empty"}`}>
                                {currentLearningTags.length ? (
                                  currentLearningTags.map((tag) => (
                                    <span key={tag} className="learning-tag-chip">#{tag}</span>
                                  ))
                                ) : (
                                  <span className="learning-tag-empty">未设置标签</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="learning-context-grid">
                          <section className="learning-context-card">
                            <div className="learning-context-head">
                              <strong>文档概览</strong>
                              <span>快速了解正文规模、标签和 SQL 沉淀情况</span>
                            </div>
                            <div className="learning-insight-metrics">
                              {learningDocInsights.map((item) => (
                                <div key={`learning-read-insight-${item.label}`} className="learning-insight-pill">
                                  <strong>{item.value}</strong>
                                  <span>{item.label}</span>
                                </div>
                              ))}
                            </div>
                          </section>
                          {learningRelatedDocs.length ? (
                            <section className="learning-context-card">
                              <div className="learning-context-head">
                                <strong>关联文档</strong>
                                <span>同主题内容会自动靠拢，后面翻资料更快</span>
                              </div>
                              <div className="learning-related-list">
                                {learningRelatedDocs.map((item) => (
                                  <button
                                    type="button"
                                    key={`learning-read-related-${item.id}`}
                                    className="learning-related-item"
                                    onClick={() => selectLearningItem(item)}
                                  >
                                    <strong>{item.title}</strong>
                                    <span>
                                      {[item.category || "未分类", ...(item.sharedTags || []).slice(0, 2).map((tag) => `#${tag}`)].join(" · ")}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}
                          {learningReferencedDocs.length ? (
                            <section className="learning-context-card">
                              <div className="learning-context-head">
                                <strong>引用文档</strong>
                                <span>正文里提到的资料会直接出现在这里，继续跳转更顺</span>
                              </div>
                              <div className="learning-related-list">
                                {learningReferencedDocs.map((item) => (
                                  <button
                                    type="button"
                                    key={`read-reference-doc-${item.id}`}
                                    className="learning-related-item"
                                    onClick={() => selectLearningItem(item)}
                                  >
                                    <strong>{item.title}</strong>
                                    <span>{[item.category || "未分类", item.updated_at?.slice(0, 10) || ""].filter(Boolean).join(" · ")}</span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}
                          {learningMentionedByDocs.length ? (
                            <section className="learning-context-card">
                              <div className="learning-context-head">
                                <strong>被引用文档</strong>
                                <span>当前资料被谁引用，一眼就能看出上下游关系</span>
                              </div>
                              <div className="learning-related-list">
                                {learningMentionedByDocs.map((item) => (
                                  <button
                                    type="button"
                                    key={`read-mentioned-doc-${item.id}`}
                                    className="learning-related-item"
                                    onClick={() => selectLearningItem(item)}
                                  >
                                    <strong>{item.title}</strong>
                                    <span>{[item.category || "未分类", item.updated_at?.slice(0, 10) || ""].filter(Boolean).join(" · ")}</span>
                                  </button>
                                ))}
                              </div>
                            </section>
                          ) : null}
                        </div>

                        <div className="learning-reading-body">
                          <div className="learning-editor-label">
                            <strong>正文</strong>
                            <span>适合写学习笔记、方案、复盘和知识沉淀</span>
                          </div>
                          {learningOutline.length ? (
                            <div className="learning-outline-panel">
                              <div className="learning-outline-head">
                                <strong>文档目录</strong>
                                <span>{learningOutline.length} 个标题</span>
                              </div>
                              <div className="learning-outline-list">
                                {learningOutline.map((item) => (
                                  <button
                                    type="button"
                                    key={item.id}
                                    className={`learning-outline-chip level-${item.level} ${learningActiveOutlineAnchor === item.anchor ? "active" : ""}`}
                                    onClick={() => scrollLearningOutlineTo(item.anchor)}
                                  >
                                    {item.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div
                            className={`learning-content-card learning-content-card-preview learning-reading-card ${canEditActiveModule ? "click-to-edit" : ""}`}
                            onClick={() => {
                              if (canEditActiveModule) openLearningEditor("write");
                            }}
                          >
                            <div className="learning-content-card-head">
                              <strong>阅读视图</strong>
                              <span>{canEditActiveModule ? "点击正文或上方编辑按钮开始修改" : "当前账号仅可阅读"}</span>
                            </div>
                            <article ref={learningReadPreviewRef} className="learning-content-preview">
                              {renderLearningContent(learningDraft.content)}
                            </article>
                          </div>
                        </div>

                        <div className="learning-version-panel">
                          <button
                            type="button"
                            className="learning-version-panel-head"
                            onClick={() => setLearningHistoryOpen((current) => !current)}
                          >
                            <strong>历史快照</strong>
                            <span>{learningVersions.length} 个版本，保存后自动沉淀</span>
                            <em>{learningHistoryOpen ? "收起" : "展开"}</em>
                          </button>
                          {learningHistoryOpen ? (
                            <div className="learning-version-list">
                              {learningVersions.map((version) => (
                                <div className="learning-version-row" key={version.id}>
                                  <div>
                                    <strong>{version.title}</strong>
                                    <span>
                                      {version.created_at?.slice(0, 16).replace("T", " ")} · {version.created_by_name || "-"}
                                    </span>
                                    <small>{version.category} · {version.status} · {version.priority}优先级</small>
                                  </div>
                                  {canEditActiveModule ? (
                                    <button type="button" onClick={() => restoreLearningVersion(version)}>
                                      恢复
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                              {!learningVersions.length ? (
                                <div className="empty-version">还没有历史快照，先保存一次文档。</div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </>
                    )}
                  </>
                ) : selectedLearningItem?.item_type === "folder" ? (
                  <div className="learning-editor-empty folder-state">
                    <Folder size={28} />
                    <strong>{selectedLearningItem.title}</strong>
                    <span>
                      {selectedLearningFolderChildren.length} 项内容，文档和子文件夹都会归到这里。
                    </span>
                    {canEditActiveModule ? (
                      <div className="folder-empty-actions">
                        <button type="button" onClick={createLearningFolder}>
                          <FolderPlus size={15} />
                          新建子文件夹
                        </button>
                        <button type="button" onClick={() => setLearningTemplatePickerOpen((current) => !current)}>
                          <FileBox size={15} />
                          模板建文档
                        </button>
                        <button type="button" className="primary-button" onClick={createLearningItem}>
                          <Plus size={15} />
                          新建文档
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="learning-editor-empty">
                    <BookOpen size={28} />
                    <strong>还没有选中内容</strong>
                    <span>左侧选择一个文档开始编辑，或者新建一个顶级文件夹/文档。</span>
                  </div>
                )}
            </section>
          </section>
        ) : null}

        {activeModule === "admin" ? (
          <section className="module-page">
            <div className="module-page-head">
              <div>
                <strong>用户与模块权限</strong>
                <span>admin 可以管理模块展示信息、账号和用户授权</span>
              </div>
            </div>
            <section className="admin-overview-grid">
              {adminOverview.map((item) => (
                <article className="admin-overview-card" key={`admin-overview-${item.label}`}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </article>
              ))}
            </section>
            <section className="admin-module-manager">
              <div className="admin-section-title">
                <strong>模块管理</strong>
                <span>修改模块在侧边栏和授权区展示的名称、说明和排序</span>
              </div>
              <div className="admin-module-grid">
                {adminData.modules.map((module) => {
                  const draft = moduleDrafts[module.key] || module;
                  return (
                    <article className="admin-module-card" key={module.key}>
                      <div className="admin-module-icon">
                        <ModuleIcon moduleKey={module.key} size={20} />
                      </div>
                      <label>
                        <span>模块名称</span>
                        <input
                          value={draft.name || ""}
                          onChange={(event) => setModuleDraft(module.key, { name: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>说明</span>
                        <input
                          value={draft.description || ""}
                          onChange={(event) => setModuleDraft(module.key, { description: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>排序</span>
                        <input
                          type="number"
                          value={draft.sort_order ?? 0}
                          onChange={(event) => setModuleDraft(module.key, { sort_order: event.target.value })}
                        />
                      </label>
                      <label className="admin-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.is_enabled)}
                          onChange={(event) => setModuleDraft(module.key, { is_enabled: event.target.checked })}
                        />
                        <span>启用模块</span>
                      </label>
                      <label className="admin-toggle">
                        <input
                          type="checkbox"
                          checked={Boolean(draft.is_hidden)}
                          onChange={(event) => setModuleDraft(module.key, { is_hidden: event.target.checked })}
                        />
                        <span>在普通用户侧隐藏</span>
                      </label>
                      <button type="button" onClick={() => updateModule(module)}>保存模块</button>
                    </article>
                  );
                })}
              </div>
            </section>
            <form className="admin-create" onSubmit={createUser}>
              <input
                placeholder="用户名"
                value={newUser.username}
                onChange={(event) => setNewUser({ ...newUser, username: event.target.value })}
              />
              <input
                placeholder="显示名"
                value={newUser.display_name}
                onChange={(event) => setNewUser({ ...newUser, display_name: event.target.value })}
              />
              <input
                placeholder="初始密码"
                type="password"
                value={newUser.password}
                onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
              />
              <select
                value={newUser.role}
                onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
              <div className="module-checks">
                {adminData.modules.map((module) => (
                  <label className="permission-select" key={module.key}>
                    <span>{module.name}</span>
                    <select
                      value={newUser.module_permissions[module.key] || "none"}
                      onChange={(event) => setNewUserModulePermission(module.key, event.target.value)}
                    >
                      {Object.entries(MODULE_ACCESS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <button className="primary-button" type="submit">
                <UserPlus size={16} />
                创建用户
              </button>
            </form>
            <section className="admin-permission-manager">
              <div className="admin-section-title">
                <div>
                  <strong>用户模块权限</strong>
                  <span>修改已经创建的用户对每个模块的访问级别</span>
                </div>
                <div className="admin-section-head-actions">
                  <select
                    value={adminPermissionCopySource}
                    onChange={(event) => setAdminPermissionCopySource(event.target.value)}
                  >
                    <option value="">选择来源账号，复制他的模块权限</option>
                    {filteredAdminUsers.map((item) => (
                      <option key={`permission-source-${item.id}`} value={item.id}>
                        {item.display_name} @{item.username}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div
                className="admin-permission-table"
                style={{ "--module-count": adminData.modules.length || 1 }}
              >
                <div className="admin-permission-head">
                  <span>用户</span>
                  {adminData.modules.map((module) => (
                    <span key={module.key}>{module.name}</span>
                  ))}
                </div>
                {filteredAdminUsers.map((item) => {
                  const isSelf = item.id === auth.user.id;
                  return (
                    <div className={`admin-permission-row ${item.is_active ? "" : "inactive"}`} key={item.id}>
                      <div className="admin-permission-user">
                        <strong>{item.display_name}</strong>
                        <span>
                          @{item.username} · {item.role === "admin" ? "管理员" : item.is_active ? "普通用户" : "已停用"}
                        </span>
                        {adminPermissionCopySource && Number(adminPermissionCopySource) !== item.id ? (
                          <button
                            type="button"
                            className="admin-copy-permission-button"
                            onClick={() => copyUserModulePermissions(item, adminPermissionCopySource)}
                          >
                            复制选中来源授权到该用户
                          </button>
                        ) : null}
                      </div>
                      {adminData.modules.map((module) => (
                        <div className="admin-permission-cell" key={module.key}>
                          <span>{module.name}</span>
                          {item.role === "admin" ? (
                            <div className="admin-permission-admin-note">
                              <strong>管理</strong>
                              <span>管理员默认拥有全部模块权限</span>
                              {!isSelf ? (
                                <button
                                  type="button"
                                  onClick={() => updateUser(item, { role: "user" }, "已转为普通用户，可以单独授权")}
                                >
                                  转普通用户后授权
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <select
                              value={item.modules?.[module.key] || "none"}
                              disabled={!item.is_active}
                              onChange={(event) => updateUserModules(item, module.key, event.target.value)}
                            >
                              {Object.entries(MODULE_ACCESS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>
            <div className="admin-user-list">
              <div className="admin-section-title">
                <strong>账号管理</strong>
                <span>修改账号资料、角色、状态和密码</span>
              </div>
              <div className="admin-filter-row">
                <input
                  placeholder="搜索用户、角色"
                  value={adminFilters.userQuery}
                  onChange={(event) => setAdminFilters((current) => ({ ...current, userQuery: event.target.value }))}
                />
                <select
                  value={adminFilters.status}
                  onChange={(event) => setAdminFilters((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="all">全部账号</option>
                  <option value="active">启用中</option>
                  <option value="inactive">已停用</option>
                  <option value="admin">管理员</option>
                  <option value="user">普通用户</option>
                </select>
              </div>
              {filteredAdminUsers.map((item) => {
                const isSelf = item.id === auth.user.id;
                return (
                  <div className={`admin-user-row ${item.is_active ? "" : "inactive"}`} key={item.id}>
                    <div className="admin-user-summary">
                      <div>
                        <strong>{item.display_name}</strong>
                        <span>@{item.username}</span>
                      </div>
                      <div className="admin-user-badges">
                        <span>{item.role === "admin" ? "管理员" : "普通用户"}</span>
                        <span>{item.is_active ? "启用中" : "已停用"}</span>
                      </div>
                    </div>

                    <div className="admin-user-controls">
                      <label>
                        <span>角色</span>
                        <select
                          value={item.role}
                          disabled={isSelf}
                          onChange={(event) => updateUser(item, { role: event.target.value }, "角色已更新")}
                        >
                          <option value="user">普通用户</option>
                          <option value="admin">管理员</option>
                        </select>
                      </label>
                      <label>
                        <span>状态</span>
                        <select
                          value={item.is_active ? "active" : "inactive"}
                          disabled={isSelf}
                          onChange={(event) => updateUser(
                            item,
                            { is_active: event.target.value === "active" },
                            "状态已更新"
                          )}
                        >
                          <option value="active">启用</option>
                          <option value="inactive">停用</option>
                        </select>
                      </label>
                      <button type="button" onClick={() => renameUser(item, "display_name")}>改显示名</button>
                      <button type="button" onClick={() => renameUser(item, "username")}>改用户名</button>
                      <button type="button" onClick={() => resetUserPassword(item)}>重置密码</button>
                      <button
                        type="button"
                        className="danger-text-button"
                        disabled={isSelf || !item.is_active}
                        onClick={() => deleteUser(item)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <section className="admin-audit-section">
              <div className="admin-section-title admin-section-title-with-actions">
                <div>
                  <strong>操作日志</strong>
                  <span>查看账号、模块、项目和知识库的关键操作记录</span>
                </div>
                <div className="admin-section-head-actions">
                  <button type="button" onClick={exportAuditLogs}>导出 CSV</button>
                </div>
              </div>
              <div className="admin-filter-row">
                <input
                  placeholder="搜索操作、人员、详情"
                  value={adminFilters.logQuery}
                  onChange={(event) => setAdminFilters((current) => ({ ...current, logQuery: event.target.value }))}
                />
                <select
                  value={adminFilters.logTargetType}
                  onChange={(event) => setAdminFilters((current) => ({ ...current, logTargetType: event.target.value }))}
                >
                  <option value="all">全部对象</option>
                  <option value="user">用户</option>
                  <option value="module">模块</option>
                  <option value="project">项目</option>
                  <option value="folder">目录</option>
                  <option value="learning_item">知识库</option>
                  <option value="file">文件</option>
                </select>
                <select
                  value={adminFilters.logAction}
                  onChange={(event) => setAdminFilters((current) => ({ ...current, logAction: event.target.value }))}
                >
                  <option value="all">全部动作</option>
                  {adminAuditActions.map((item) => (
                    <option key={`audit-action-${item}`} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="admin-audit-list">
                {filteredAuditLogs.map((log) => (
                  <article key={log.id} className="admin-audit-row">
                    <div>
                      <strong>{log.action}</strong>
                      <span>{log.user_display_name || log.username || "系统"} · {log.target_type || "未知对象"}</span>
                    </div>
                    <small>{log.detail || "无额外说明"}</small>
                    <time>{log.created_at?.replace("T", " ").slice(0, 16)}</time>
                  </article>
                ))}
                {!filteredAuditLogs.length ? <div className="empty-version">没有匹配的操作日志</div> : null}
              </div>
            </section>
          </section>
        ) : null}
      </section>

      {globalFinderOpen ? (
        <div className="modal-backdrop">
          <section className="modal global-finder-modal">
            <div className="modal-head global-finder-head">
              <div>
                <strong>全局搜索</strong>
                <span>跨知识库、SQL 片段、3D 项目和系统管理快速跳转，支持 Ctrl/Cmd + K</span>
              </div>
              <button onClick={() => setGlobalFinderOpen(false)}><X size={18} /></button>
            </div>
            <div className="searchbox">
              <Search size={16} />
              <input
                ref={globalFinderInputRef}
                value={globalFinderQuery}
                placeholder="搜索文档、片段、项目、用户"
                onChange={(event) => setGlobalFinderQuery(event.target.value)}
              />
            </div>
            <div className="global-finder-scope">
              {[
                ["all", "全部"],
                ["current", "当前模块"],
                ["learning", "知识库"],
                ["snippet", "SQL 片段"],
                ["archive", "3D 项目"],
                ["admin", "系统管理"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={globalFinderScope === value ? "active" : ""}
                  onClick={() => setGlobalFinderScope(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {globalFinderRecentSearches.length && !globalFinderQuery.trim() ? (
              <div className="global-finder-recent">
                <div className="global-finder-recent-head">
                  <strong>最近搜索</strong>
                  <button type="button" onClick={() => setGlobalFinderRecentSearches([])}>
                    清空
                  </button>
                </div>
                <div className="global-finder-recent-list">
                  {globalFinderRecentSearches.map((item) => (
                    <button key={`global-recent-${item}`} type="button" onClick={() => setGlobalFinderQuery(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="global-finder-results">
              {globalFinderResults.map((item) => (
                <button
                  key={`${item.group}-${item.id}`}
                  type="button"
                  className="global-finder-row"
                  onClick={() => {
                    item.action();
                    setGlobalFinderOpen(false);
                  }}
                >
                  <span className="global-finder-group">{item.group}</span>
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </button>
              ))}
              {!globalFinderResults.length ? (
                <div className="empty-version">没有匹配结果，换个关键词试试。</div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {resolvedSelectedLearningSnippet ? (
        <div className="modal-backdrop" onClick={closeLearningSnippetDetail}>
          <section
            className="modal learning-snippet-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <strong>{resolvedSelectedLearningSnippet.title}</strong>
                <span>{resolvedSelectedLearningSnippet.itemTitle || "SQL 片段详情"}</span>
              </div>
              <button onClick={closeLearningSnippetDetail}><X size={18} /></button>
            </div>
            <div className="learning-snippet-modal-body">
              <div className="learning-snippet-modal-toolbar">
                <button type="button" onClick={() => setLearningSnippetEditing((current) => !current)}>
                  {learningSnippetEditing ? "完成查看" : "编辑资料"}
                </button>
                {learningSnippetEditing ? (
                  <button type="button" className="primary-button" onClick={saveLearningSnippetMeta}>
                    保存片段资料
                  </button>
                ) : null}
              </div>
              {learningSnippetEditing ? (
                <div className="learning-snippet-form">
                  <label>
                    <span>片段标题</span>
                    <input
                      value={learningSnippetDraft.title}
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>分类</span>
                    <input
                      value={learningSnippetDraft.category}
                      placeholder="例如 SQL / 实时 / 排查"
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, category: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>负责人</span>
                    <input
                      value={learningSnippetDraft.owner}
                      placeholder="维护人 / 负责人"
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, owner: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>来源表</span>
                    <input
                      value={learningSnippetDraft.sourceTable}
                      placeholder="来源表或中间表"
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, sourceTable: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>目标表</span>
                    <input
                      value={learningSnippetDraft.targetTable}
                      placeholder="落地表 / 目标表"
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, targetTable: event.target.value }))}
                    />
                  </label>
                  <label className="span-2">
                    <span>标签</span>
                    <input
                      value={learningSnippetDraft.tags}
                      placeholder="逗号分隔，例如 SQL, 实时, 指标"
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, tags: event.target.value }))}
                    />
                  </label>
                  <label className="span-2">
                    <span>用途</span>
                    <textarea
                      value={learningSnippetDraft.purpose}
                      placeholder="一句话说明这段 SQL 主要解决什么问题"
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, purpose: event.target.value }))}
                    />
                  </label>
                  <label className="span-2">
                    <span>备注</span>
                    <textarea
                      value={learningSnippetDraft.notes}
                      placeholder="口径说明、使用注意事项、依赖条件"
                      onChange={(event) => setLearningSnippetDraft((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                </div>
              ) : (
                <>
                  <div className="learning-snippet-modal-meta">
                    <span><strong>分类</strong>{resolvedSelectedLearningSnippet.category || "未分类"}</span>
                    <span><strong>负责人</strong>{resolvedSelectedLearningSnippet.owner || "未填写"}</span>
                    <span><strong>来源表</strong>{resolvedSelectedLearningSnippet.sourceTable || "未填写"}</span>
                    <span><strong>目标表</strong>{resolvedSelectedLearningSnippet.targetTable || "未填写"}</span>
                  </div>
                  {resolvedSelectedLearningSnippet.purpose ? (
                    <div className="learning-snippet-modal-notes">
                      <strong>用途</strong>
                      <p>{resolvedSelectedLearningSnippet.purpose}</p>
                    </div>
                  ) : null}
                  {resolvedSelectedLearningSnippet.notes ? (
                    <div className="learning-snippet-modal-notes">
                      <strong>备注</strong>
                      <p>{resolvedSelectedLearningSnippet.notes}</p>
                    </div>
                  ) : null}
                  {resolvedSelectedLearningSnippet.tags?.length ? (
                    <div className="learning-sql-snippet-tags modal-tags">
                      {resolvedSelectedLearningSnippet.tags.map((tag) => (
                        <span key={`snippet-modal-tag-${resolvedSelectedLearningSnippet.id}-${tag}`}>#{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
              <pre className="learning-snippet-modal-code">
                <code>{resolvedSelectedLearningSnippet.rawContent || resolvedSelectedLearningSnippet.content || ""}</code>
              </pre>
              <div className="learning-snippet-modal-actions">
                <button type="button" onClick={() => openLearningSnippetSource(resolvedSelectedLearningSnippet)}>打开源文档</button>
                <button type="button" onClick={() => insertLearningSqlSnippet(resolvedSelectedLearningSnippet)}>插入正文</button>
                <button type="button" onClick={() => createDocumentFromSnippet(resolvedSelectedLearningSnippet)}>生成文档</button>
                <button type="button" onClick={() => copyLearningSqlSnippet(resolvedSelectedLearningSnippet)}>复制 SQL</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {trashOpen ? (
        <div className="modal-backdrop">
          <section className="modal">
            <div className="modal-head">
              <strong>回收站</strong>
              <button onClick={() => setTrashOpen(false)}><X size={18} /></button>
            </div>
            <div className="trash-list">
              {trash.length ? (
                <div className="trash-toolbar">
                  <label className="batch-select-all">
                    <input
                      type="checkbox"
                      checked={selectedTrashIds.length > 0 && selectedTrashIds.length === trash.length}
                      onChange={toggleTrashSelectAll}
                    />
                    <span>全选回收站文件</span>
                  </label>
                  <span className="batch-summary">
                    {selectedTrashIds.length ? `已选 ${selectedTrashIds.length} 个文件` : "还没有选中文件"}
                  </span>
                  <div className="batch-actions">
                    <button type="button" onClick={restoreSelectedTrash} disabled={!selectedTrashIds.length}>
                      批量恢复
                    </button>
                    {auth.user.role === "admin" ? (
                      <button type="button" onClick={() => purgeTrashFiles()} disabled={!selectedTrashIds.length}>
                        彻底删除
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {trash.map((file) => (
                <div className="trash-row" key={file.id}>
                  <label className="trash-select">
                    <input
                      type="checkbox"
                      checked={selectedTrashIds.includes(file.id)}
                      onChange={() => toggleTrashSelection(file.id)}
                    />
                  </label>
                  <div>
                    <strong>{file.name}</strong>
                    <span>{file.project_name} / {file.folder_name}</span>
                  </div>
                  <div className="trash-actions">
                    <button onClick={() => restoreFile(file)}>恢复</button>
                    {auth.user.role === "admin" ? (
                      <button
                        type="button"
                        className="danger-text-button"
                        onClick={() => purgeTrashFiles([file.id])}
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {!trash.length ? <div className="empty-state">回收站为空</div> : null}
            </div>
          </section>
        </div>
      ) : null}

      {message ? <div className="toast">{message}</div> : null}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
