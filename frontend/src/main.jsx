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

const API = import.meta.env.VITE_API_BASE || "/api";
const LEARNING_VIEW_STORAGE_KEY = "work-file-archive-learning-view-mode";

function getLearningDraftStorageKey(itemId) {
  return `work-file-archive-learning-draft-${itemId}`;
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
  return text.split(/(`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
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

function renderLearningContent(content) {
  const trimmedContent = (content || "").trim();
  if (isSqlContent(trimmedContent)) {
    return <pre className="sql-preview"><code>{formatSql(trimmedContent)}</code></pre>;
  }

  const lines = (content || "").split(/\r?\n/);
  const elements = [];
  let paragraph = [];
  let list = [];
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

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      if (inCode) {
        elements.push(
          <pre key={`code-${elements.length}`} className={codeLanguage === "sql" ? "sql-preview" : ""}>
            <code>{codeLanguage === "sql" ? formatSql(code.join("\n")) : code.join("\n")}</code>
          </pre>
        );
        code = [];
        codeLanguage = "";
        inCode = false;
      } else {
        flushParagraph();
        flushList();
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
      flushTable();
      return;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      flushTable();
      const Tag = `h${Math.min(heading[1].length + 1, 4)}`;
      elements.push(<Tag key={`h-${elements.length}`}>{renderInlineText(heading[2])}</Tag>);
      return;
    }
    const tableLine = line.match(/^\|(.+)\|$/);
    if (tableLine) {
      flushParagraph();
      flushList();
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        table.push(cells);
      }
      return;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      const todo = bullet[1].match(/^\[( |x|X)\]\s+(.+)$/);
      if (todo) {
        list.push({ checked: todo[1].toLowerCase() === "x", text: todo[2] });
      } else {
        list.push({ checked: null, text: bullet[1] });
      }
      return;
    }
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      flushTable();
      elements.push(<blockquote key={`q-${elements.length}`}>{renderInlineText(quote[1])}</blockquote>);
      return;
    }
    flushList();
    flushTable();
    paragraph.push(line.trim());
  });

  if (inCode) {
    elements.push(
      <pre key={`code-${elements.length}`} className={codeLanguage === "sql" ? "sql-preview" : ""}>
        <code>{codeLanguage === "sql" ? formatSql(code.join("\n")) : code.join("\n")}</code>
      </pre>
    );
  }
  flushParagraph();
  flushList();
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
    status: item?.status || "制作中",
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
  const [archiveSearch, setArchiveSearch] = useState({
    query: "",
    kind: "all",
    scope: "folder",
  });
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
  const [learningTreeWidth, setLearningTreeWidth] = useState(() => {
    const raw = localStorage.getItem("work-file-archive-learning-tree-width");
    const value = raw ? Number(raw) : 360;
    return Number.isFinite(value) ? Math.min(Math.max(value, 280), 560) : 360;
  });
  const [learningSidebarPanels, setLearningSidebarPanels] = useState(() => ({
    filters: true,
    categories: false,
    shortcuts: false,
  }));
  const [learningHistoryOpen, setLearningHistoryOpen] = useState(false);
  const [adminData, setAdminData] = useState({ users: [], modules: [] });
  const [moduleDrafts, setModuleDrafts] = useState({});
  const [newUser, setNewUser] = useState({
    username: "",
    display_name: "",
    password: "",
    role: "user",
    module_permissions: {},
  });
  const [uploading, setUploading] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState(null);
  const [dragOverLearningId, setDragOverLearningId] = useState(null);
  const [showIneffectiveVersions, setShowIneffectiveVersions] = useState(false);
  const uploadRef = useRef(null);
  const folderUploadRef = useRef(null);
  const learningTitleRef = useRef(null);
  const learningContentRef = useRef(null);
  const learningWorkspaceRef = useRef(null);
  const learningTagInputRef = useRef(null);

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

  useEffect(() => {
    if (auth) {
      localStorage.setItem("work-file-archive-auth", JSON.stringify(auth));
      loadModules();
    }
  }, [auth]);

  useEffect(() => {
    localStorage.setItem("work-file-archive-learning-custom-tags", JSON.stringify(learningCustomTags));
  }, [learningCustomTags]);

  useEffect(() => {
    localStorage.setItem(LEARNING_VIEW_STORAGE_KEY, learningViewMode);
  }, [learningViewMode]);

  useEffect(() => {
    localStorage.setItem("work-file-archive-learning-tree-width", String(learningTreeWidth));
  }, [learningTreeWidth]);

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
    if (activeModule === "archive_3d") loadProjects();
    if (activeModule === "learning") loadLearningItems();
    if (activeModule === "admin" && auth.user.role === "admin") loadAdminData();
  }, [activeModule, auth?.token, modules.length]);

  useEffect(() => {
    if (project && activeModule === "archive_3d") loadTree(project.id);
  }, [project?.id]);

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

  async function loadProjects() {
    try {
      const data = await apiFetch("/projects", {}, token);
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
      const data = await apiFetch("/admin/users", {}, token);
      setAdminData(data);
      setModuleDrafts(Object.fromEntries(data.modules.map((module) => [
        module.key,
        {
          name: module.name,
          description: module.description || "",
          sort_order: module.sort_order ?? 0,
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
    if (!canEditActiveModule) return;
    try {
      const created = await apiFetch(
        "/learning/items",
        {
          method: "POST",
          body: JSON.stringify({
            title: `未命名文档 ${learningItems.length + 1}`,
            parent_id: selectedLearningFolderId,
            item_type: "doc",
            category: "学习笔记",
            status: "计划中",
            priority: "中",
            content: "",
            resource_url: "",
          }),
        },
        token
      );
      await loadLearningItems();
      setSelectedLearningId(created.id);
      setLearningDraft(buildLearningDraft(normalizeLearningItem(created)));
      setLearningEditing(true);
      setMessage("已新建文档");
    } catch (err) {
      showError(err);
    }
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

  function logout() {
    localStorage.removeItem("work-file-archive-auth");
    setAuth(null);
  }

  if (!auth) return <Login onLogin={setAuth} />;

  return (
    <main className={`app-shell ${activeModule === "admin" ? "compact-shell" : ""}`}>
      <aside className="sidebar">
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

            <div className="learning-sidebar-panels learning-sidebar-panels-inline">
              <section className={`learning-sidebar-panel ${learningSidebarPanels.filters ? "open" : ""}`}>
                <button
                  type="button"
                  className="learning-sidebar-panel-toggle"
                  onClick={() => toggleLearningSidebarPanel("filters")}
                >
                  <span>搜索与筛选</span>
                  <ChevronRight size={16} className={learningSidebarPanels.filters ? "rotate" : ""} />
                </button>
                {learningSidebarPanels.filters ? (
                  <div className="learning-sidebar-panel-body">
                    <div className="learning-toolbar">
                      <div className="searchbox learning-search">
                        <Search size={16} />
                        <input
                          value={learningFilters.query}
                          placeholder="搜索标题、分类、正文、链接"
                          onChange={(event) => setLearningFilters((current) => ({ ...current, query: event.target.value }))}
                        />
                      </div>
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
              </section>

              <section className={`learning-sidebar-panel ${learningSidebarPanels.categories ? "open" : ""}`}>
                <button
                  type="button"
                  className="learning-sidebar-panel-toggle"
                  onClick={() => toggleLearningSidebarPanel("categories")}
                >
                  <span>分类与标签</span>
                  <ChevronRight size={16} className={learningSidebarPanels.categories ? "rotate" : ""} />
                </button>
                {learningSidebarPanels.categories ? (
                  <div className="learning-sidebar-panel-body">
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
                              onClick={() => toggleLearningTagFilter(item)}
                            >
                              #{item}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>

              {(learningPinnedDocs.length || learningRecentDocs.length) ? (
                <section className={`learning-sidebar-panel ${learningSidebarPanels.shortcuts ? "open" : ""}`}>
                  <button
                    type="button"
                    className="learning-sidebar-panel-toggle"
                    onClick={() => toggleLearningSidebarPanel("shortcuts")}
                  >
                    <span>快捷入口</span>
                    <ChevronRight size={16} className={learningSidebarPanels.shortcuts ? "rotate" : ""} />
                  </button>
                  {learningSidebarPanels.shortcuts ? (
                    <div className="learning-sidebar-panel-body">
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
                </section>
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
              {projects.map((item) => (
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
                  <span>{item.name}</span>
                  <em>{item.status || "制作中"}</em>
                  <small>{formatSize(item.total_size)}</small>
                </button>
              ))}
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
                    onChange={(event) => setArchiveSearch((current) => ({ ...current, query: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && activeFolder) loadItems(activeFolder.id);
                    }}
                  />
                </div>
                <select
                  className="toolbar-select"
                  value={archiveSearch.scope}
                  onChange={(event) => {
                    const next = { ...archiveSearch, scope: event.target.value };
                    setArchiveSearch(next);
                    if (activeFolder) loadItems(activeFolder.id, next);
                  }}
                >
                  <option value="folder">当前目录</option>
                  <option value="project">整个项目</option>
                </select>
                <select
                  className="toolbar-select"
                  value={archiveSearch.kind}
                  onChange={(event) => {
                    const next = { ...archiveSearch, kind: event.target.value };
                    setArchiveSearch(next);
                    if (activeFolder) loadItems(activeFolder.id, next);
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
                <IconButton label="退出登录" onClick={logout}>
                  <LogOut size={17} />
                </IconButton>
              </div>
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
                <IconButton label="退出登录" onClick={logout}>
                  <LogOut size={17} />
                </IconButton>
              </div>
            </div>
          ) : (
            <div className="toolbar">
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
                        </strong>
                        <span>{formatSize(version.size)} · {version.uploaded_by_name || "-"}</span>
                        {version.remark ? <small>{version.remark}</small> : null}
                      </div>
                      <div className="version-actions">
                        <button title="下载版本" onClick={() => downloadFile(detail.file.id, version.id)}>
                          <Download size={15} />
                        </button>
                        {canEditActiveModule && version.id !== detail.file.current_version_id ? (
                          <button
                            title={version.is_effective ? "标记失效" : "恢复有效"}
                            onClick={() => setVersionEffectiveness(version, !version.is_effective)}
                          >
                            {version.is_effective ? "失效" : "有效"}
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
                                {learningTagSuggestOpen && filteredLearningTagSuggestions.length ? (
                                  <div className="learning-tag-dropdown">
                                    {filteredLearningTagSuggestions.map((tag) => (
                                      <button
                                        key={`dropdown-${tag}`}
                                        type="button"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => addLearningTag(tag)}
                                      >
                                        #{tag}
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="learning-tag-picker">
                              <span>可连续选择多个已有标签</span>
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

                        <div className="learning-edit-body">
                          <div className="learning-editor-label">
                            <strong>正文</strong>
                            <span>适合写学习笔记、方案、复盘和知识沉淀</span>
                          </div>
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
                                <article className="learning-content-preview">
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

                        <div className="learning-reading-body">
                          <div className="learning-editor-label">
                            <strong>正文</strong>
                            <span>适合写学习笔记、方案、复盘和知识沉淀</span>
                          </div>
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
                            <article className="learning-content-preview">
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
                <strong>用户模块权限</strong>
                <span>修改已经创建的用户对每个模块的访问级别</span>
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
                {adminData.users.map((item) => {
                  const isSelf = item.id === auth.user.id;
                  return (
                    <div className={`admin-permission-row ${item.is_active ? "" : "inactive"}`} key={item.id}>
                      <div className="admin-permission-user">
                        <strong>{item.display_name}</strong>
                        <span>
                          @{item.username} · {item.role === "admin" ? "管理员" : item.is_active ? "普通用户" : "已停用"}
                        </span>
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
              {adminData.users.map((item) => {
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
          </section>
        ) : null}
      </section>

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
