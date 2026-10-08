'use strict';

/*
 * Flow4U: staff, project and task management that runs entirely in the browser.
 * Records are kept in localStorage and attached files in IndexedDB, so the site
 * works as plain static files (GitHub Pages or any web host) with no server.
 */

const APP_NAME = 'Flow4U';
// Storage names keep the app's original name so data saved before the rename still loads.
const STORAGE_KEY = 'flowforge.data.v2';
const TOUR_KEY = 'flowforge.tour.v2';
const XLSX_SRC = 'vendor/xlsx.full.min.js';
const DUE_SOON_DAYS = 7;
const PANEL_LIMIT = 8;
const KINDS = ['staff', 'projects', 'tasks'];

const ROUTES = {
  overview: 'Overview',
  staff: 'Staff',
  projects: 'Projects',
  tasks: 'Tasks',
  data: 'Import & export'
};

const OPTIONS = {
  staffStatus: ['Available', 'Busy', 'On leave'],
  projectStatus: ['Planning', 'Active', 'On hold', 'Completed'],
  taskStatus: ['To do', 'In progress', 'In review', 'Done'],
  priority: ['Low', 'Medium', 'High', 'Critical']
};

const DEFAULTS = {
  staffStatus: 'Available',
  projectStatus: 'Planning',
  taskStatus: 'To do',
  priority: 'Medium'
};

// Other spellings accepted when importing. Keys are lowercase with spaces and punctuation removed.
const ALIASES = {
  staffStatus: { free: 'Available', occupied: 'Busy', leave: 'On leave', away: 'On leave', holiday: 'On leave', vacation: 'On leave', absent: 'On leave' },
  projectStatus: { new: 'Planning', planned: 'Planning', notstarted: 'Planning', inprogress: 'Active', ongoing: 'Active', started: 'Active', hold: 'On hold', paused: 'On hold', blocked: 'On hold', done: 'Completed', complete: 'Completed', finished: 'Completed', closed: 'Completed' },
  taskStatus: { open: 'To do', new: 'To do', backlog: 'To do', notstarted: 'To do', doing: 'In progress', started: 'In progress', active: 'In progress', review: 'In review', testing: 'In review', qa: 'In review', complete: 'Done', completed: 'Done', closed: 'Done', finished: 'Done' },
  priority: { lowest: 'Low', minor: 'Low', normal: 'Medium', moderate: 'Medium', major: 'High', urgent: 'Critical', highest: 'Critical', blocker: 'Critical' }
};

const TONES = {
  Available: 'green',
  Busy: 'amber',
  'On leave': 'grey',
  Planning: 'grey',
  Active: 'blue',
  'On hold': 'amber',
  Completed: 'green',
  'To do': 'grey',
  'In progress': 'blue',
  'In review': 'violet',
  Done: 'green',
  Low: 'grey',
  Medium: 'blue',
  High: 'amber',
  Critical: 'red'
};

const TOUR = [
  {
    route: 'overview',
    target: '[data-route="overview"]',
    title: 'Your overview',
    text: 'Open work, upcoming deadlines and team workload at a glance. Everything here is worked out from the records you enter.'
  },
  {
    route: 'staff',
    target: '[data-view="staff"] .page-actions [data-action="new"]',
    title: 'Add your team',
    text: 'Start with the people you manage. Once added, they can be placed on project teams and assigned tasks.'
  },
  {
    route: 'projects',
    target: '[data-view="projects"] .page-actions [data-action="new"]',
    title: 'Create projects',
    text: 'Projects group related work. Progress updates on its own as their tasks are marked done.'
  },
  {
    route: 'tasks',
    target: '[data-view="tasks"] .page-actions [data-action="new"]',
    title: 'Track tasks',
    text: 'Assign tasks, set due dates and change status straight from the list. Attach files to a task to keep the work with it.'
  },
  {
    route: 'data',
    target: '[data-route="data"]',
    title: 'Import, export and back up',
    text: 'Bring in lists from Excel, export to Excel, CSV or Word, and download backups. Records stay in this browser, so back up regularly.'
  }
];

/* ---------- Helpers ---------- */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

function str(value) {
  return value == null ? '' : String(value).trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Lowercase and strip accents and Arabic diacritics so searches and name matching are forgiving.
function fold(value) {
  return str(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u0610-\u061a\u0640\u064b-\u065f\u0670]/g, '')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064a');
}

function keyOf(value) {
  return fold(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function plural(count, word, pluralWord = `${word}s`) {
  return `${count} ${count === 1 ? word : pluralWord}`;
}

function compareText(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function sortByName(items, field = 'name') {
  return [...items].sort((a, b) => compareText(a[field], b[field]));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

function matchOption(value, listName) {
  const key = keyOf(value);
  if (!key) return '';
  const alias = Object.hasOwn(ALIASES[listName], key) ? ALIASES[listName][key] : '';
  return OPTIONS[listName].find((option) => keyOf(option) === key) || alias;
}

function optionOrDefault(value, listName) {
  return matchOption(value, listName) || DEFAULTS[listName];
}

/* ---------- Dates ---------- */

const pad = (number) => String(number).padStart(2, '0');
const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function isoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayISO() {
  return isoDate(new Date());
}

function parseISO(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isoDate(date) === value ? date : null;
}

function validISO(value) {
  return parseISO(str(value)) ? str(value) : '';
}

function formatDate(value) {
  const date = parseISO(value);
  return date ? shortDate.format(date) : '';
}

function daysFromToday(value) {
  const date = parseISO(value);
  if (!date) return null;
  return Math.round((date - parseISO(todayISO())) / 86400000);
}

function relativeDue(value) {
  const days = daysFromToday(value);
  if (days === null) return '';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 0) return `${plural(-days, 'day')} overdue`;
  return `Due in ${days} days`;
}

/* ---------- Data ---------- */

function emptyData() {
  return { version: 2, settings: { workspaceName: '' }, staff: [], projects: [], tasks: [] };
}

// Cleans any stored, restored or imported structure into the shape the app expects.
function normalizeData(input) {
  const output = emptyData();
  if (!input || typeof input !== 'object') return output;

  output.settings.workspaceName = str(input.settings?.workspaceName);

  output.staff = list(input.staff)
    .filter((member) => member && str(member.name))
    .map((member) => ({
      id: str(member.id) || uid(),
      name: str(member.name),
      role: str(member.role),
      department: str(member.department),
      email: str(member.email),
      phone: str(member.phone),
      status: optionOrDefault(member.status, 'staffStatus')
    }));
  const staffIds = new Set(output.staff.map((member) => member.id));

  output.projects = list(input.projects)
    .filter((project) => project && str(project.name))
    .map((project) => ({
      id: str(project.id) || uid(),
      name: str(project.name),
      client: str(project.client),
      status: optionOrDefault(project.status, 'projectStatus'),
      deadline: validISO(project.deadline),
      description: str(project.description),
      team: [...new Set(list(project.team).map(str))].filter((id) => staffIds.has(id))
    }));
  const projectIds = new Set(output.projects.map((project) => project.id));

  output.tasks = list(input.tasks)
    .filter((task) => task && str(task.title))
    .map((task) => {
      const projectId = str(task.projectId);
      const assigneeId = str(task.assigneeId ?? task.assignedTo);
      return {
        id: str(task.id) || uid(),
        title: str(task.title),
        projectId: projectIds.has(projectId) ? projectId : '',
        assigneeId: staffIds.has(assigneeId) ? assigneeId : '',
        priority: optionOrDefault(task.priority, 'priority'),
        status: optionOrDefault(task.status, 'taskStatus'),
        dueDate: validISO(task.dueDate),
        description: str(task.description),
        attachments: list(task.attachments)
          .filter((file) => file && str(file.id))
          .map((file) => ({
            id: str(file.id),
            name: str(file.name) || 'file',
            type: str(file.type),
            size: Number(file.size) || 0,
            addedAt: str(file.addedAt)
          }))
      };
    });

  return output;
}

function loadData() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeData(JSON.parse(raw)) : emptyData();
  } catch (error) {
    console.error('Saved data could not be read.', error);
    // Keep the unreadable copy so it is not overwritten by the next save.
    try {
      if (raw) localStorage.setItem(`${STORAGE_KEY}.unreadable`, raw);
    } catch (ignored) {
      // Storage is unavailable; nothing more to do.
    }
    return emptyData();
  }
}

let data = loadData();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error(error);
    toast('Changes could not be saved. Check that this site is allowed to store data.', 'error');
    return false;
  }
}

function commit(message) {
  persist();
  render();
  if (message) toast(message);
}

const byId = (items, id) => items.find((item) => item.id === id);
const staffName = (id) => byId(data.staff, id)?.name || '';
const projectName = (id) => byId(data.projects, id)?.name || '';
const isDone = (task) => task.status === 'Done';
const isOverdue = (task) => !isDone(task) && Boolean(task.dueDate) && task.dueDate < todayISO();
const workspaceTitle = () => data.settings.workspaceName || APP_NAME;

function openTaskCount(staffId) {
  return data.tasks.filter((task) => task.assigneeId === staffId && !isDone(task)).length;
}

function projectProgress(projectId) {
  const tasks = data.tasks.filter((task) => task.projectId === projectId);
  const done = tasks.filter(isDone).length;
  return { total: tasks.length, done, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

function attachmentIds(source) {
  return source.tasks.flatMap((task) => task.attachments.map((file) => file.id));
}

/* ---------- File storage (IndexedDB) ---------- */

const fileStore = {
  ready: null,

  open() {
    if (!this.ready) {
      this.ready = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error('IndexedDB is not available.'));
          return;
        }
        const request = indexedDB.open('flowforge-files', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      this.ready.catch(() => {
        this.ready = null;
      });
    }
    return this.ready;
  },

  async run(mode, work) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', mode);
      const request = work(transaction.objectStore('files'));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('The file operation was cancelled.'));
    });
  },

  put(id, blob) {
    return this.run('readwrite', (store) => store.put(blob, id));
  },

  get(id) {
    return this.run('readonly', (store) => store.get(id));
  },

  remove(ids) {
    if (!ids.length) return Promise.resolve();
    return this.run('readwrite', (store) => {
      ids.forEach((id) => store.delete(id));
    });
  },

  clear() {
    return this.run('readwrite', (store) => store.clear());
  }
};

function discardFiles(ids) {
  if (ids.length) fileStore.remove(ids).catch((error) => console.error(error));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Images, PDFs and plain text open in a new tab; anything else is downloaded.
// SVG and HTML are always downloaded because they could run scripts on this site.
function openBlob(blob, meta) {
  const type = String(meta.type || blob.type).toLowerCase();
  const previewable = /^(image\/(png|jpe?g|gif|webp|bmp|avif)|application\/pdf|text\/plain)$/.test(type);
  if (previewable) {
    // Re-type the data as the checked type, so a file restored from a crafted backup cannot open as a web page.
    const tab = window.open(URL.createObjectURL(new Blob([blob], { type })), '_blank');
    if (tab) {
      tab.opener = null;
      return;
    }
  }
  downloadBlob(blob, meta.name);
}

const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// Only data: URLs are read, so a backup file cannot make the page contact another address.
const dataURLToBlob = (url) =>
  /^data:/i.test(url) ? fetch(url).then((response) => response.blob()) : Promise.reject(new Error('Attached file data is not a data: URL.'));

/* ---------- UI pieces ---------- */

const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const bdi = (value) => `<bdi>${esc(value)}</bdi>`;
const dash = '<span class="muted">&mdash;</span>';

function badge(value) {
  return `<span class="badge tone-${TONES[value] || 'grey'}">${esc(value)}</span>`;
}

function priorityLabel(value) {
  return `<span class="priority tone-${TONES[value] || 'grey'}">${esc(value)}</span>`;
}

function hash(value) {
  let result = 0;
  for (const char of String(value)) result = (result * 31 + char.codePointAt(0)) >>> 0;
  return result;
}

function initials(name) {
  const words = str(name).split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0];
  // Arabic letters join together, so a single letter reads better than two.
  if (words.length === 1 || /[\u0600-\u06ff]/.test(first)) return first.toUpperCase();
  return (first + [...words[words.length - 1]][0]).toUpperCase();
}

function avatar(person, small = false) {
  const size = small ? ' avatar-sm' : '';
  if (!person) return `<span class="avatar avatar-empty${size}" aria-hidden="true"></span>`;
  return `<span class="avatar av-${hash(person.id) % 8}${size}" title="${esc(person.name)}" aria-hidden="true">${esc(initials(person.name))}</span>`;
}

function progressBar(progress) {
  const complete = progress.total > 0 && progress.done === progress.total;
  const label = progress.total ? `${progress.done}/${progress.total}` : 'No tasks';
  return `<div class="progress${complete ? ' is-complete' : ''}" title="${progress.pct}% of tasks done">
    <span class="progress-track"><span class="progress-fill" style="width:${progress.pct}%"></span></span>
    <span class="progress-text">${label}</span>
  </div>`;
}

function dueCell(value, finished) {
  if (!value) return dash;
  const late = !finished && value < todayISO();
  return `<span class="${late ? 'overdue' : ''}" title="${esc(finished ? '' : relativeDue(value))}">${esc(formatDate(value))}</span>`;
}

function textCell(value) {
  return value ? bdi(value) : dash;
}

function teamCell(ids) {
  const members = ids.map((id) => byId(data.staff, id)).filter(Boolean);
  if (!members.length) return dash;
  const shown = members.slice(0, 4).map((member) => avatar(member, true)).join('');
  const extra = members.length > 4 ? `<span class="team-more">+${members.length - 4}</span>` : '';
  const names = members.map((member) => member.name).join(', ');
  return `<div class="team" title="${esc(names)}">${shown}${extra}<span class="sr-only">${esc(names)}</span></div>`;
}

function statusSelect(task) {
  const options = OPTIONS.taskStatus
    .map((status) => `<option${status === task.status ? ' selected' : ''}>${esc(status)}</option>`)
    .join('');
  return `<span class="status-pick tone-${TONES[task.status]}"><select data-change="task-status" data-id="${esc(task.id)}" aria-label="Status of ${esc(task.title)}">${options}</select></span>`;
}

function fillSelect(select, options, value) {
  select.innerHTML = options.map((option) => `<option value="${esc(option.value)}">${esc(option.label)}</option>`).join('');
  select.value = options.some((option) => option.value === value) ? value : options[0]?.value ?? '';
  return select.value;
}

function fillDatalist(id, values) {
  const unique = [...new Set(values.map(str).filter(Boolean))].sort(compareText);
  $(`#${id}`).innerHTML = unique.map((value) => `<option value="${esc(value)}"></option>`).join('');
}

/* ---------- Tables ---------- */

const filters = {
  staff: { q: '', status: '' },
  projects: { q: '', status: '' },
  tasks: { q: '', project: '', assignee: '', status: '', priority: '' }
};

const sorting = {
  staff: { key: 'name', dir: 1 },
  projects: { key: 'deadline', dir: 1 },
  tasks: { key: 'due', dir: 1 }
};

function matchesQuery(query, ...fields) {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = fields.map(fold).join(' ');
  return terms.every((term) => haystack.includes(term));
}

const TABLES = {
  staff: {
    items: () => data.staff,
    empty: 'No staff members yet.',
    emptyAction: 'Add staff member',
    filter: (member, f) =>
      (!f.status || member.status === f.status) &&
      matchesQuery(f.q, member.name, member.role, member.department, member.email, member.phone),
    columns: [
      {
        key: 'name',
        label: 'Name',
        value: (member) => member.name,
        html: (member) => `<div class="person">${avatar(member)}<div>
          <div class="cell-main">${bdi(member.name)}</div>
          ${member.email || member.phone ? `<div class="cell-sub">${esc([member.email, member.phone].filter(Boolean).join(' · '))}</div>` : ''}
        </div></div>`
      },
      { key: 'role', label: 'Role', value: (member) => member.role, html: (member) => textCell(member.role) },
      { key: 'department', label: 'Department', value: (member) => member.department, html: (member) => textCell(member.department) },
      { key: 'open', label: 'Open tasks', className: 'num', value: (member) => openTaskCount(member.id), html: (member) => String(openTaskCount(member.id)) },
      { key: 'status', label: 'Status', value: (member) => OPTIONS.staffStatus.indexOf(member.status), html: (member) => badge(member.status) }
    ]
  },

  projects: {
    items: () => data.projects,
    empty: 'No projects yet.',
    emptyAction: 'Add project',
    filter: (project, f) =>
      (!f.status || project.status === f.status) && matchesQuery(f.q, project.name, project.client, project.description),
    columns: [
      {
        key: 'name',
        label: 'Project',
        value: (project) => project.name,
        html: (project) => `<div class="cell-main">${bdi(project.name)}</div>${project.client ? `<div class="cell-sub">${bdi(project.client)}</div>` : ''}`
      },
      { key: 'team', label: 'Team', value: (project) => project.team.length || '', html: (project) => teamCell(project.team) },
      { key: 'deadline', label: 'Deadline', value: (project) => project.deadline, group: (project) => (project.status === 'Completed' ? 1 : 0), html: (project) => dueCell(project.deadline, project.status === 'Completed') },
      { key: 'progress', label: 'Progress', value: (project) => projectProgress(project.id).pct, html: (project) => progressBar(projectProgress(project.id)) },
      { key: 'status', label: 'Status', value: (project) => OPTIONS.projectStatus.indexOf(project.status), html: (project) => badge(project.status) }
    ]
  },

  tasks: {
    items: () => data.tasks,
    empty: 'No tasks yet.',
    emptyAction: 'Add task',
    filter: (task, f) =>
      (!f.project || task.projectId === f.project || (f.project === '__none' && !task.projectId)) &&
      (!f.assignee || task.assigneeId === f.assignee || (f.assignee === '__none' && !task.assigneeId)) &&
      (!f.status || task.status === f.status || (f.status === '__open' && !isDone(task))) &&
      (!f.priority || task.priority === f.priority) &&
      matchesQuery(f.q, task.title, task.description, projectName(task.projectId), staffName(task.assigneeId)),
    columns: [
      {
        key: 'title',
        label: 'Task',
        value: (task) => task.title,
        html: (task) => {
          const files = task.attachments.length
            ? `<span title="${esc(plural(task.attachments.length, 'attached file'))}">${icon('paperclip')} ${task.attachments.length}</span>`
            : '';
          const details = [files, task.description ? bdi(task.description) : ''].filter(Boolean).join(' &middot; ');
          return `<div class="cell-main">${bdi(task.title)}</div>${details ? `<div class="cell-sub">${details}</div>` : ''}`;
        }
      },
      { key: 'project', label: 'Project', value: (task) => projectName(task.projectId), html: (task) => textCell(projectName(task.projectId)) },
      {
        key: 'assignee',
        label: 'Assignee',
        value: (task) => staffName(task.assigneeId),
        html: (task) => {
          const person = byId(data.staff, task.assigneeId);
          return person ? `<div class="person">${avatar(person, true)}${bdi(person.name)}</div>` : '<span class="muted">Unassigned</span>';
        }
      },
      { key: 'due', label: 'Due', value: (task) => task.dueDate, group: (task) => (isDone(task) ? 1 : 0), html: (task) => dueCell(task.dueDate, isDone(task)) },
      { key: 'priority', label: 'Priority', value: (task) => OPTIONS.priority.indexOf(task.priority), html: (task) => priorityLabel(task.priority) },
      { key: 'status', label: 'Status', value: (task) => OPTIONS.taskStatus.indexOf(task.status), html: statusSelect }
    ]
  }
};

// A column's optional group() keeps finished items below open ones whichever way the column is sorted.
function sortRows(rows, column, dir) {
  return rows
    .map((row) => ({ row, value: column.value(row), group: column.group ? column.group(row) : 0 }))
    .sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      const aEmpty = a.value === '' || a.value == null;
      const bEmpty = b.value === '' || b.value == null;
      if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
      const result = typeof a.value === 'number' && typeof b.value === 'number' ? a.value - b.value : compareText(a.value, b.value);
      return result * dir;
    })
    .map((entry) => entry.row);
}

function rowActions(kind, item) {
  const label = esc(item.name || item.title);
  return `<div class="row-actions">
    <button type="button" class="icon-btn" data-action="edit" data-kind="${kind}" data-id="${esc(item.id)}" aria-label="Edit ${label}" title="Edit">${icon('edit')}</button>
    <button type="button" class="icon-btn danger" data-action="delete" data-kind="${kind}" data-id="${esc(item.id)}" aria-label="Delete ${label}" title="Delete">${icon('trash')}</button>
  </div>`;
}

function renderTable(kind) {
  const config = TABLES[kind];
  const table = $(`[data-table="${kind}"]`);
  const sort = sorting[kind];
  const column = config.columns.find((col) => col.key === sort.key) || config.columns[0];
  const all = config.items();
  const rows = sortRows(all.filter((item) => config.filter(item, filters[kind])), column, sort.dir);

  table.tHead.innerHTML = `<tr>${config.columns
    .map((col) => {
      const state = col.key === sort.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none';
      return `<th class="${col.className || ''}" aria-sort="${state}"><button type="button" class="sort-btn" data-action="sort" data-kind="${kind}" data-key="${col.key}">${esc(col.label)}</button></th>`;
    })
    .join('')}<th class="col-actions"><span class="sr-only">Actions</span></th></tr>`;

  const span = config.columns.length + 1;
  if (!all.length) {
    table.tBodies[0].innerHTML = `<tr class="empty-row"><td colspan="${span}">${esc(config.empty)}<br>
      <button type="button" class="btn btn-sm" data-action="new" data-kind="${kind}">${icon('plus')}${esc(config.emptyAction)}</button></td></tr>`;
  } else if (!rows.length) {
    table.tBodies[0].innerHTML = `<tr class="empty-row"><td colspan="${span}">Nothing matches the current filters.</td></tr>`;
  } else {
    table.tBodies[0].innerHTML = rows
      .map((item) => `<tr data-kind="${kind}" data-id="${esc(item.id)}">${config.columns
        .map((col) => `<td class="${col.className || ''}">${col.html(item)}</td>`)
        .join('')}<td class="col-actions">${rowActions(kind, item)}</td></tr>`)
      .join('');
  }

  const filtered = Object.values(filters[kind]).some(Boolean);
  $(`[data-result="${kind}"]`).textContent = filtered ? `${rows.length} of ${all.length}` : '';
  $(`[data-action="clear-filters"][data-kind="${kind}"]`).hidden = !filtered;
}

function renderTaskFilters() {
  const f = filters.tasks;
  f.project = fillSelect(
    $('[data-filter="tasks.project"]'),
    [
      { value: '', label: 'All projects' },
      { value: '__none', label: 'No project' },
      ...sortByName(data.projects).map((project) => ({ value: project.id, label: project.name }))
    ],
    f.project
  );
  f.assignee = fillSelect(
    $('[data-filter="tasks.assignee"]'),
    [
      { value: '', label: 'Everyone' },
      { value: '__none', label: 'Unassigned' },
      ...sortByName(data.staff).map((member) => ({ value: member.id, label: member.name }))
    ],
    f.assignee
  );
}

function syncFilterInputs(kind) {
  $$(`[data-filter^="${kind}."]`).forEach((input) => {
    const value = filters[kind][input.dataset.filter.split('.')[1]];
    if (input.value !== value) input.value = value;
  });
}

function renderSummary(kind) {
  const target = $(`[data-summary="${kind}"]`);
  if (kind === 'staff') {
    const available = data.staff.filter((member) => member.status === 'Available').length;
    target.textContent = data.staff.length ? `${plural(data.staff.length, 'member')} · ${available} available` : 'No staff members yet';
  } else if (kind === 'projects') {
    const active = data.projects.filter((project) => project.status === 'Active').length;
    target.textContent = data.projects.length ? `${plural(data.projects.length, 'project')} · ${active} active` : 'No projects yet';
  } else {
    const open = data.tasks.filter((task) => !isDone(task)).length;
    const overdue = data.tasks.filter(isOverdue).length;
    target.textContent = data.tasks.length ? `${plural(data.tasks.length, 'task')} · ${open} open · ${overdue} overdue` : 'No tasks yet';
  }
}

/* ---------- Overview ---------- */

function stat(label, value, foot, footClass = '') {
  return `<div class="card stat">
    <p class="stat-label">${esc(label)}</p>
    <p class="stat-value">${esc(value)}</p>
    <p class="stat-foot ${footClass}">${esc(foot)}</p>
  </div>`;
}

function panelList(rows, total) {
  const more = total > rows.length ? `<p class="panel-more">${total - rows.length} more not shown</p>` : '';
  return `<ul class="list">${rows.join('')}</ul>${more}`;
}

function panelEmpty(message) {
  return `<p class="panel-empty">${esc(message)}</p>`;
}

function renderOverview() {
  $('#overview-date').textContent = longDate.format(new Date());
  $('#tour-notice').hidden = tourSeen() || tourIndex >= 0;

  const counts = { staff: data.staff.length, projects: data.projects.length, tasks: data.tasks.length };
  $('#setup').hidden = KINDS.every((kind) => counts[kind] > 0);
  $$('#setup [data-step]').forEach((step) => step.classList.toggle('is-done', counts[step.dataset.step] > 0));

  const open = data.tasks.filter((task) => !isDone(task));
  const overdue = open.filter(isOverdue).length;
  const done = counts.tasks - open.length;
  const available = data.staff.filter((member) => member.status === 'Available').length;
  const active = data.projects.filter((project) => project.status === 'Active').length;
  const completion = counts.tasks ? Math.round((done / counts.tasks) * 100) : 0;

  $('#stats').innerHTML = [
    stat('Staff', counts.staff, counts.staff ? `${available} available` : 'No one added yet'),
    stat('Active projects', active, counts.projects ? `${plural(counts.projects, 'project')} in total` : 'No projects yet'),
    stat('Open tasks', open.length, overdue ? `${overdue} overdue` : 'Nothing overdue', overdue ? 'is-danger' : ''),
    stat('Completion', `${completion}%`, counts.tasks ? `${done} of ${plural(counts.tasks, 'task')} done` : 'No tasks yet')
  ].join('');

  // Overdue and due-soon tasks
  const attention = open
    .filter((task) => task.dueDate && daysFromToday(task.dueDate) <= DUE_SOON_DAYS)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || OPTIONS.priority.indexOf(b.priority) - OPTIONS.priority.indexOf(a.priority));
  $('#panel-attention').innerHTML = attention.length
    ? panelList(
        attention.slice(0, PANEL_LIMIT).map((task) => {
          const meta = [projectName(task.projectId), staffName(task.assigneeId) || 'Unassigned'].filter(Boolean).map(bdi).join(' · ');
          return `<li><button type="button" class="list-row" data-action="edit" data-kind="tasks" data-id="${esc(task.id)}">
            <span class="list-main"><span class="list-title">${bdi(task.title)}</span><span class="list-sub">${meta}</span></span>
            <span class="list-aside${isOverdue(task) ? ' overdue' : ''}">${esc(relativeDue(task.dueDate))}</span>
          </button></li>`;
        }),
        attention.length
      )
    : panelEmpty(counts.tasks ? `Nothing is overdue or due in the next ${DUE_SOON_DAYS} days.` : 'Tasks with due dates will appear here.');

  // Projects that are not completed, nearest deadline first
  const running = data.projects
    .filter((project) => project.status !== 'Completed')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || compareText(a.name, b.name));
  $('#panel-projects').innerHTML = running.length
    ? panelList(
        running.slice(0, PANEL_LIMIT).map((project) => {
          const late = project.deadline && project.deadline < todayISO();
          const when = project.deadline ? relativeDue(project.deadline) : 'No deadline';
          return `<li><button type="button" class="list-row" data-action="show-tasks" data-project="${esc(project.id)}">
            <span class="list-main"><span class="list-title">${bdi(project.name)}</span>
            <span class="list-sub"><span class="${late ? 'overdue' : ''}">${esc(when)}</span> · ${esc(project.status)}</span></span>
            <span class="list-aside">${progressBar(projectProgress(project.id))}</span>
          </button></li>`;
        }),
        running.length
      )
    : panelEmpty(counts.projects ? 'Every project is marked completed.' : 'Projects you create will appear here with their progress.');

  // Open tasks per person
  const unassigned = open.filter((task) => !task.assigneeId).length;
  const load = data.staff
    .map((member) => ({ member, count: openTaskCount(member.id) }))
    .sort((a, b) => b.count - a.count || compareText(a.member.name, b.member.name));
  const max = Math.max(1, unassigned, ...load.map((entry) => entry.count));
  const loadRow = (person, count, label, sub, filterId) => `<li><button type="button" class="list-row" data-action="show-tasks" data-assignee="${esc(filterId)}">
      ${avatar(person, true)}
      <span class="list-main"><span class="list-title">${label}</span>${sub ? `<span class="list-sub">${sub}</span>` : ''}</span>
      <span class="load" title="${esc(plural(count, 'open task'))}"><span class="load-track"><span class="load-fill" style="width:${Math.round((count / max) * 100)}%"></span></span><span class="load-num">${count}</span></span>
    </button></li>`;
  const loadRows = load.slice(0, PANEL_LIMIT).map(({ member, count }) => {
    const sub = [member.role ? bdi(member.role) : '', member.status !== 'Available' ? esc(member.status) : ''].filter(Boolean).join(' · ');
    return loadRow(member, count, bdi(member.name), sub, member.id);
  });
  if (unassigned) loadRows.push(loadRow(null, unassigned, 'Unassigned', 'Open tasks without an owner', '__none'));
  $('#panel-workload').innerHTML = load.length
    ? panelList(loadRows, load.length + (unassigned ? 1 : 0))
    : panelEmpty('Add staff members to see how open tasks are spread across the team.');
}

/* ---------- Import & export page ---------- */

function renderDataPage() {
  const input = $('[data-form="workspace"] [name="workspaceName"]');
  if (document.activeElement !== input) input.value = data.settings.workspaceName;

  const files = data.tasks.flatMap((task) => task.attachments);
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const parts = [plural(data.staff.length, 'staff member'), plural(data.projects.length, 'project'), plural(data.tasks.length, 'task')];
  $('#storage-summary').textContent =
    `Stored in this browser: ${parts.join(', ')} and ${plural(files.length, 'attached file')}` +
    (files.length ? ` (${formatSize(bytes)}).` : '.');
}

/* ---------- Rendering and routing ---------- */

function currentRoute() {
  const route = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return Object.hasOwn(ROUTES, route) ? route : 'overview';
}

function navigate(route) {
  if (currentRoute() === route) render();
  else location.hash = `#/${route}`;
}

function renderChrome(route) {
  const name = data.settings.workspaceName;
  $('#brand-name').textContent = name || APP_NAME;
  $('#brand-sub').textContent = name ? APP_NAME : 'Work management';
  KINDS.forEach((kind) => {
    $(`[data-count="${kind}"]`).textContent = data[kind].length || '';
  });
  $$('[data-route]').forEach((link) => {
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  $$('.view').forEach((view) => {
    view.hidden = view.dataset.view !== route;
  });
  document.title = `${ROUTES[route]} · ${workspaceTitle()}`;
}

function render() {
  const route = currentRoute();
  renderChrome(route);
  if (route === 'overview') {
    renderOverview();
  } else if (route === 'data') {
    renderDataPage();
  } else {
    if (route === 'tasks') renderTaskFilters();
    syncFilterInputs(route);
    renderSummary(route);
    renderTable(route);
  }
}

function showTasks(filter) {
  filters.tasks = { q: '', project: '', assignee: '', status: '', priority: '', ...filter };
  navigate('tasks');
}

function printView() {
  const route = currentRoute();
  const parts = [workspaceTitle(), ROUTES[route], `Printed ${shortDate.format(new Date())}`];
  const result = $(`[data-result="${route}"]`)?.textContent;
  if (result) parts.push(`Filtered: showing ${result}`);
  $('#print-meta').textContent = parts.join(' · ');
  window.print();
}

/* ---------- Toasts and dialogs ---------- */

function toast(message, tone = 'info') {
  const item = document.createElement('div');
  item.className = `toast${tone === 'error' ? ' toast-error' : ''}`;
  item.textContent = message;
  $('#toasts').append(item);
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 250);
  }, tone === 'error' ? 6500 : 3200);
}

function showDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function confirmDialog({ title, message, confirmLabel = 'Delete', danger = true }) {
  const dialog = $('#dialog-confirm');
  const ok = $('#confirm-ok');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  ok.textContent = confirmLabel;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dialog.returnValue = '';
  showDialog(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

function formValues(form) {
  const values = {};
  for (const [name, value] of new FormData(form)) {
    if (typeof value === 'string') values[name] = value.trim();
  }
  return values;
}

// Clears the form, including any "name already exists" message left from last time.
function resetForm(form) {
  form.reset();
  Array.from(form.elements).forEach((element) => element.setCustomValidity?.(''));
}

function setFields(form, record, names) {
  names.forEach((name) => {
    form.elements.namedItem(name).value = record[name] ?? '';
  });
}

function rejectField(form, name, message) {
  const input = form.elements.namedItem(name);
  input.setCustomValidity(message);
  input.reportValidity();
}

/* ---------- Staff ---------- */

function openStaffForm(id) {
  const form = $('[data-form="staff"]');
  const member = id ? byId(data.staff, id) : null;
  resetForm(form);
  form.elements.namedItem('id').value = member?.id || '';
  setFields(form, member || { status: DEFAULTS.staffStatus }, ['name', 'role', 'department', 'email', 'phone', 'status']);
  fillDatalist('list-roles', data.staff.map((entry) => entry.role));
  fillDatalist('list-departments', data.staff.map((entry) => entry.department));
  $('#dialog-staff-title').textContent = member ? 'Edit staff member' : 'Add staff member';
  showDialog($('#dialog-staff'));
}

function saveStaff(form) {
  const values = formValues(form);
  if (data.staff.some((member) => member.id !== values.id && keyOf(member.name) === keyOf(values.name))) {
    rejectField(form, 'name', 'Someone with this name already exists. Add an initial or surname to tell them apart.');
    return;
  }
  const record = {
    name: values.name,
    role: values.role,
    department: values.department,
    email: values.email,
    phone: values.phone,
    status: optionOrDefault(values.status, 'staffStatus')
  };
  const existing = byId(data.staff, values.id);
  if (existing) Object.assign(existing, record);
  else data.staff.push({ id: uid(), ...record });
  form.closest('dialog').close();
  commit(existing ? 'Staff member updated' : 'Staff member added');
}

/* ---------- Projects ---------- */

function renderTeamChecklist(selected) {
  const box = $('#project-team');
  if (!data.staff.length) {
    box.innerHTML = '<p class="checklist-empty">No staff members yet. Add people on the Staff page to build a team.</p>';
    return;
  }
  box.innerHTML = sortByName(data.staff)
    .map((member) => `<label class="check-item">
      <input type="checkbox" name="team" value="${esc(member.id)}"${selected.includes(member.id) ? ' checked' : ''}>
      ${avatar(member, true)}
      <span class="check-name">${bdi(member.name)}</span>
      ${member.role ? `<span class="check-meta">${bdi(member.role)}</span>` : ''}
    </label>`)
    .join('');
}

function openProjectForm(id) {
  const form = $('[data-form="projects"]');
  const project = id ? byId(data.projects, id) : null;
  resetForm(form);
  form.elements.namedItem('id').value = project?.id || '';
  setFields(form, project || { status: DEFAULTS.projectStatus }, ['name', 'client', 'status', 'deadline', 'description']);
  renderTeamChecklist(project?.team || []);
  fillDatalist('list-clients', data.projects.map((entry) => entry.client));
  $('#dialog-projects-title').textContent = project ? 'Edit project' : 'Add project';
  showDialog($('#dialog-projects'));
}

function saveProject(form) {
  const values = formValues(form);
  if (data.projects.some((project) => project.id !== values.id && keyOf(project.name) === keyOf(values.name))) {
    rejectField(form, 'name', 'A project with this name already exists.');
    return;
  }
  const record = {
    name: values.name,
    client: values.client,
    status: optionOrDefault(values.status, 'projectStatus'),
    deadline: validISO(values.deadline),
    description: values.description,
    team: new FormData(form).getAll('team').map(String)
  };
  const existing = byId(data.projects, values.id);
  if (existing) Object.assign(existing, record);
  else data.projects.push({ id: uid(), ...record });
  form.closest('dialog').close();
  commit(existing ? 'Project updated' : 'Project added');
}

/* ---------- Tasks ---------- */

// Attachment changes are held here until the task is saved, so Cancel discards them.
let taskDraft = null;

function openTaskForm(id, preset = {}) {
  const form = $('[data-form="tasks"]');
  const task = id ? byId(data.tasks, id) : null;
  resetForm(form);
  form.elements.namedItem('id').value = task?.id || '';
  fillSelect(
    form.elements.namedItem('projectId'),
    [{ value: '', label: 'No project' }, ...sortByName(data.projects).map((project) => ({ value: project.id, label: project.name }))],
    task ? task.projectId : preset.projectId || ''
  );
  fillSelect(
    form.elements.namedItem('assigneeId'),
    [{ value: '', label: 'Unassigned' }, ...sortByName(data.staff).map((member) => ({ value: member.id, label: member.name }))],
    task ? task.assigneeId : preset.assigneeId || ''
  );
  setFields(form, task || { priority: DEFAULTS.priority, status: DEFAULTS.taskStatus }, ['title', 'status', 'priority', 'dueDate', 'description']);
  taskDraft = { kept: [...(task?.attachments || [])], added: [] };
  renderDraftFiles();
  $('#dialog-tasks-title').textContent = task ? 'Edit task' : 'Add task';
  showDialog($('#dialog-tasks'));
}

function renderDraftFiles() {
  const items = [
    ...taskDraft.kept.map((meta) => ({ meta, pending: false })),
    ...taskDraft.added.map(({ meta }) => ({ meta, pending: true }))
  ];
  $('#task-file-list').innerHTML = items
    .map(({ meta, pending }) => `<li class="file-item">
      ${icon('file')}
      <button type="button" class="file-name" data-action="open-file" data-file="${esc(meta.id)}" title="Open ${esc(meta.name)}">${bdi(meta.name)}</button>
      <span class="file-size">${pending ? 'Not saved yet · ' : ''}${formatSize(meta.size)}</span>
      <button type="button" class="icon-btn danger" data-action="remove-file" data-file="${esc(meta.id)}" aria-label="Remove ${esc(meta.name)}" title="Remove">${icon('x')}</button>
    </li>`)
    .join('');
}

function addDraftFiles(fileList) {
  if (!taskDraft) return;
  Array.from(fileList).forEach((file) => {
    taskDraft.added.push({
      file,
      meta: { id: uid(), name: file.name, type: file.type, size: file.size, addedAt: todayISO() }
    });
  });
  renderDraftFiles();
}

async function openDraftFile(fileId) {
  const pending = taskDraft?.added.find((entry) => entry.meta.id === fileId);
  if (pending) {
    openBlob(pending.file, pending.meta);
    return;
  }
  const meta = taskDraft?.kept.find((entry) => entry.id === fileId);
  if (!meta) return;
  try {
    const blob = await fileStore.get(meta.id);
    if (blob) openBlob(blob, meta);
    else toast(`${meta.name} is not stored in this browser.`, 'error');
  } catch (error) {
    console.error(error);
    toast('The file could not be opened.', 'error');
  }
}

function removeDraftFile(fileId) {
  taskDraft.kept = taskDraft.kept.filter((meta) => meta.id !== fileId);
  taskDraft.added = taskDraft.added.filter((entry) => entry.meta.id !== fileId);
  renderDraftFiles();
}

async function saveTask(form) {
  const values = formValues(form);
  const existing = byId(data.tasks, values.id);
  const draft = taskDraft;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;

  const stored = [];
  let failed = 0;
  for (const { meta, file } of draft.added) {
    try {
      await fileStore.put(meta.id, file);
      stored.push(meta);
    } catch (error) {
      console.error(error);
      failed += 1;
    }
  }
  const keptIds = new Set(draft.kept.map((meta) => meta.id));
  const removed = (existing?.attachments || []).filter((meta) => !keptIds.has(meta.id)).map((meta) => meta.id);

  const record = {
    title: values.title,
    projectId: byId(data.projects, values.projectId) ? values.projectId : '',
    assigneeId: byId(data.staff, values.assigneeId) ? values.assigneeId : '',
    priority: optionOrDefault(values.priority, 'priority'),
    status: optionOrDefault(values.status, 'taskStatus'),
    dueDate: validISO(values.dueDate),
    description: values.description,
    attachments: [...draft.kept, ...stored]
  };
  if (existing) Object.assign(existing, record);
  else data.tasks.push({ id: uid(), ...record });

  submit.disabled = false;
  form.closest('dialog').close();
  discardFiles(removed);
  commit(existing ? 'Task updated' : 'Task added');
  if (failed) toast(`${plural(failed, 'file')} could not be stored. The browser may be out of space.`, 'error');
}

function updateTaskStatus(id, status) {
  const task = byId(data.tasks, id);
  if (!task) return;
  task.status = optionOrDefault(status, 'taskStatus');
  commit();
  // The table was redrawn, so put focus back on this task's status control.
  $(`[data-change="task-status"][data-id="${CSS.escape(id)}"]`)?.focus();
}

/* ---------- Deleting ---------- */

async function deleteRecord(kind, id) {
  let title;
  let message;
  let apply;

  if (kind === 'staff') {
    const member = byId(data.staff, id);
    if (!member) return;
    const taskCount = data.tasks.filter((task) => task.assigneeId === id).length;
    const projectCount = data.projects.filter((project) => project.team.includes(id)).length;
    title = `Delete ${member.name}?`;
    message = 'This cannot be undone.';
    if (taskCount) message += ` ${plural(taskCount, 'task')} assigned to them will become unassigned.`;
    if (projectCount) message += ` They will be removed from ${plural(projectCount, 'project team')}.`;
    apply = () => {
      data.staff = data.staff.filter((entry) => entry.id !== id);
      data.projects.forEach((project) => {
        project.team = project.team.filter((memberId) => memberId !== id);
      });
      data.tasks.forEach((task) => {
        if (task.assigneeId === id) task.assigneeId = '';
      });
      return [];
    };
  } else if (kind === 'projects') {
    const project = byId(data.projects, id);
    if (!project) return;
    const tasks = data.tasks.filter((task) => task.projectId === id);
    title = `Delete ${project.name}?`;
    message = tasks.length
      ? `Its ${plural(tasks.length, 'task')} and their attached files will be deleted too. This cannot be undone.`
      : 'This cannot be undone.';
    apply = () => {
      data.projects = data.projects.filter((entry) => entry.id !== id);
      data.tasks = data.tasks.filter((task) => task.projectId !== id);
      return tasks.flatMap((task) => task.attachments.map((file) => file.id));
    };
  } else {
    const task = byId(data.tasks, id);
    if (!task) return;
    title = `Delete ${task.title}?`;
    message = task.attachments.length
      ? `Its ${plural(task.attachments.length, 'attached file')} will be deleted too. This cannot be undone.`
      : 'This cannot be undone.';
    apply = () => {
      data.tasks = data.tasks.filter((entry) => entry.id !== id);
      return task.attachments.map((file) => file.id);
    };
  }

  if (!(await confirmDialog({ title, message }))) return;
  discardFiles(apply());
  commit(kind === 'staff' ? 'Staff member deleted' : kind === 'projects' ? 'Project deleted' : 'Task deleted');
}

/* ---------- Spreadsheet library ---------- */

let xlsxLoading = null;

function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxLoading) {
    xlsxLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_SRC;
      script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('The spreadsheet library did not load.')));
      script.onerror = () => {
        xlsxLoading = null;
        script.remove();
        reject(new Error('The spreadsheet library could not be loaded. Check your connection and try again.'));
      };
      document.head.append(script);
    });
  }
  return xlsxLoading;
}

/* ---------- Export ---------- */

const SHEET_NAMES = { staff: 'Staff', projects: 'Projects', tasks: 'Tasks' };

// Columns marked "computed" are for reading only; they are left out of the template and ignored on import.
const EXPORT_COLUMNS = {
  staff: [
    { label: 'Name', value: (member) => member.name },
    { label: 'Role', value: (member) => member.role },
    { label: 'Department', value: (member) => member.department },
    { label: 'Email', value: (member) => member.email },
    { label: 'Phone', value: (member) => member.phone },
    { label: 'Status', value: (member) => member.status },
    { label: 'Open tasks', value: (member) => openTaskCount(member.id), computed: true }
  ],
  projects: [
    { label: 'Name', value: (project) => project.name },
    { label: 'Client', value: (project) => project.client },
    { label: 'Status', value: (project) => project.status },
    { label: 'Deadline', value: (project) => project.deadline },
    { label: 'Team', value: (project) => project.team.map(staffName).filter(Boolean).join(', ') },
    { label: 'Description', value: (project) => project.description },
    { label: 'Tasks done', value: (project) => projectProgress(project.id).done, computed: true },
    { label: 'Tasks total', value: (project) => projectProgress(project.id).total, computed: true },
    { label: 'Progress (%)', value: (project) => projectProgress(project.id).pct, computed: true }
  ],
  tasks: [
    { label: 'Title', value: (task) => task.title },
    { label: 'Project', value: (task) => projectName(task.projectId) },
    { label: 'Assignee', value: (task) => staffName(task.assigneeId) },
    { label: 'Priority', value: (task) => task.priority },
    { label: 'Status', value: (task) => task.status },
    { label: 'Due date', value: (task) => task.dueDate },
    { label: 'Description', value: (task) => task.description },
    { label: 'Attachments', value: (task) => task.attachments.map((file) => file.name).join(', '), computed: true }
  ]
};

function sortedForExport(kind) {
  if (kind === 'tasks') {
    return [...data.tasks].sort(
      (a, b) =>
        compareText(projectName(a.projectId), projectName(b.projectId)) ||
        (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
        compareText(a.title, b.title)
    );
  }
  return sortByName(data[kind]);
}

function exportRows(kind, template = false) {
  const columns = EXPORT_COLUMNS[kind].filter((column) => !template || !column.computed);
  const header = columns.map((column) => column.label);
  if (template) return [header];
  return [header, ...sortedForExport(kind).map((item) => columns.map((column) => column.value(item)))];
}

function fileName(suffix) {
  const base = str(data.settings.workspaceName).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'flow4u';
  return `${base}-${suffix}`;
}

function sheetFromRows(XLSX, rows) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = rows[0].map((_, index) => ({
    wch: Math.min(60, rows.reduce((width, row) => Math.max(width, String(row[index] ?? '').length + 2), 10))
  }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  return sheet;
}

async function exportWorkbook() {
  try {
    const XLSX = await loadXLSX();
    const book = XLSX.utils.book_new();
    KINDS.forEach((kind) => XLSX.utils.book_append_sheet(book, sheetFromRows(XLSX, exportRows(kind)), SHEET_NAMES[kind]));
    book.Props = { Title: workspaceTitle() };
    XLSX.writeFile(book, fileName(`${todayISO()}.xlsx`));
  } catch (error) {
    console.error(error);
    toast(error.message || 'The workbook could not be created.', 'error');
  }
}

async function downloadTemplate() {
  try {
    const XLSX = await loadXLSX();
    const book = XLSX.utils.book_new();
    const notes = [
      [`${APP_NAME} import template`],
      [],
      ['Fill in the Staff, Projects and Tasks sheets, then import this file from Import & export.'],
      ['Keep the column headers as they are. Only Name (Staff, Projects) and Title (Tasks) are required; any sheet can be left empty.'],
      [],
      ['Sheet', 'Column', 'What to enter'],
      ['Staff', 'Status', OPTIONS.staffStatus.join(', ')],
      ['Projects', 'Status', OPTIONS.projectStatus.join(', ')],
      ['Projects', 'Deadline', 'A date cell, or text written as YYYY-MM-DD'],
      ['Projects', 'Team', 'Staff names separated by commas'],
      ['Tasks', 'Project', 'A project name. Names not found create a new project.'],
      ['Tasks', 'Assignee', 'A staff name. Names not found create a new staff member.'],
      ['Tasks', 'Priority', OPTIONS.priority.join(', ')],
      ['Tasks', 'Status', OPTIONS.taskStatus.join(', ')],
      ['Tasks', 'Due date', 'A date cell, or text written as YYYY-MM-DD']
    ];
    const readMe = XLSX.utils.aoa_to_sheet(notes);
    readMe['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(book, readMe, 'Read me');
    KINDS.forEach((kind) => XLSX.utils.book_append_sheet(book, sheetFromRows(XLSX, exportRows(kind, true)), SHEET_NAMES[kind]));
    XLSX.writeFile(book, `${APP_NAME.toLowerCase()}-import-template.xlsx`);
  } catch (error) {
    console.error(error);
    toast(error.message || 'The template could not be created.', 'error');
  }
}

function csvCell(value) {
  let text = String(value ?? '');
  // Stop spreadsheet apps from treating text such as "=SUM(...)" as a formula.
  if (/^[=@\t\r]/.test(text) || /^[+-](?![\d\s().-]*$)/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCSV(kind) {
  const csv = exportRows(kind).map((row) => row.map(csvCell).join(',')).join('\r\n');
  // The byte order mark tells Excel the file is UTF-8, so Arabic text is not garbled.
  downloadBlob(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }), fileName(`${kind}-${todayISO()}.csv`));
}

function reportTable(headers, rows) {
  const head = `<tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr>`;
  const body = rows.length
    ? rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="empty">None</td></tr>`;
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function exportWordReport() {
  const title = `${workspaceTitle()} status report`;
  const open = data.tasks.filter((task) => !isDone(task));
  const done = data.tasks.length - open.length;
  const overdue = open.filter(isOverdue).length;
  const pct = data.tasks.length ? Math.round((done / data.tasks.length) * 100) : 0;
  const text = (value) => esc(value || '').replace(/\n/g, '<br>');
  const date = (value, finished) => {
    if (!value) return '';
    return !finished && value < todayISO() ? `<span class="overdue">${esc(formatDate(value))}</span>` : esc(formatDate(value));
  };

  const summary = [
    `Staff: ${data.staff.length} (${data.staff.filter((member) => member.status === 'Available').length} available)`,
    `Projects: ${data.projects.length} (${data.projects.filter((project) => project.status === 'Active').length} active)`,
    `Tasks: ${data.tasks.length} (${open.length} open, ${overdue} overdue, ${done} done)`,
    `Completion: ${pct}%`
  ];

  const projects = reportTable(
    ['Project', 'Client', 'Status', 'Deadline', 'Progress', 'Team'],
    sortByName(data.projects).map((project) => {
      const progress = projectProgress(project.id);
      return [
        text(project.name),
        text(project.client),
        esc(project.status),
        date(project.deadline, project.status === 'Completed'),
        progress.total ? `${progress.pct}% (${progress.done}/${progress.total})` : 'No tasks',
        text(project.team.map(staffName).filter(Boolean).join(', '))
      ];
    })
  );

  const tasks = reportTable(
    ['Task', 'Project', 'Assignee', 'Priority', 'Status', 'Due'],
    sortedForExport('tasks').map((task) => [
      text(task.title),
      text(projectName(task.projectId)),
      text(staffName(task.assigneeId) || 'Unassigned'),
      esc(task.priority),
      esc(task.status),
      date(task.dueDate, isDone(task))
    ])
  );

  const staff = reportTable(
    ['Name', 'Role', 'Department', 'Status', 'Open tasks'],
    sortByName(data.staff).map((member) => [
      text(member.name),
      text(member.role),
      text(member.department),
      esc(member.status),
      String(openTaskCount(member.id))
    ])
  );

  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page Section1 { size: 841.9pt 595.3pt; mso-page-orientation: landscape; margin: 50pt; }
div.Section1 { page: Section1; }
body { font-family: Calibri, Arial, sans-serif; font-size: 10.5pt; color: #1b1f24; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; margin: 18pt 0 6pt; }
p.meta { color: #687180; margin: 0 0 10pt; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #cbd0d8; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #eceef2; }
.overdue { color: #b8322a; }
.empty { color: #687180; }
</style>
</head>
<body><div class="Section1">
<h1>${esc(title)}</h1>
<p class="meta">Prepared ${esc(longDate.format(new Date()))}</p>
<ul>${summary.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
<h2>Projects</h2>${projects}
<h2>Tasks</h2>${tasks}
<h2>Staff</h2>${staff}
</div></body></html>`;

  downloadBlob(new Blob(['\ufeff', html], { type: 'application/msword' }), fileName(`report-${todayISO()}.doc`));
}

/* ---------- Import ---------- */

const SHEET_TYPES = {
  staff: ['staff', 'people', 'team', 'employees', 'members', 'personnel'],
  projects: ['projects', 'project'],
  tasks: ['tasks', 'task', 'todo', 'todos']
};

// Accepted header names for each field, in the same normalised form as keyOf().
const COLUMN_ALIASES = {
  staff: {
    name: ['name', 'fullname', 'staffname', 'employee', 'member', 'person'],
    role: ['role', 'jobtitle', 'title', 'position'],
    department: ['department', 'dept', 'division', 'unit'],
    email: ['email', 'emailaddress', 'mail'],
    phone: ['phone', 'phonenumber', 'mobile', 'telephone', 'tel'],
    status: ['status', 'availability']
  },
  projects: {
    name: ['name', 'project', 'projectname'],
    client: ['client', 'clientordepartment', 'clientdepartment', 'customer', 'department'],
    status: ['status'],
    deadline: ['deadline', 'duedate', 'due', 'enddate'],
    team: ['team', 'teammembers', 'members', 'staff'],
    description: ['description', 'notes', 'details', 'summary']
  },
  tasks: {
    title: ['title', 'task', 'tasktitle', 'taskname', 'name', 'subject'],
    project: ['project', 'projectname'],
    assignee: ['assignee', 'assignedto', 'owner', 'responsible', 'staff', 'member'],
    priority: ['priority'],
    status: ['status', 'state'],
    dueDate: ['duedate', 'due', 'deadline', 'date'],
    description: ['description', 'notes', 'details']
  }
};

const KEY_FIELD = { staff: 'name', projects: 'name', tasks: 'title' };
const DATE_FIELDS = new Set(['deadline', 'dueDate']);
const OPTION_FIELDS = {
  staff: { status: 'staffStatus' },
  projects: { status: 'projectStatus' },
  tasks: { status: 'taskStatus', priority: 'priority' }
};

function detectSheetType(sheetName, headers) {
  const name = keyOf(sheetName);
  if (['readme', 'instructions', 'help', 'notes', 'lists'].includes(name)) return null;
  for (const [type, names] of Object.entries(SHEET_TYPES)) {
    if (names.includes(name)) return type;
  }
  const has = (...keys) => keys.some((key) => headers.includes(key));
  if (has('task', 'tasktitle', 'taskname', 'assignee', 'assignedto', 'priority') || (has('title') && has('project'))) return 'tasks';
  if (has('client', 'deadline', 'teammembers', 'projectname', 'team')) return 'projects';
  if (has('role', 'department', 'email', 'phone', 'fullname', 'jobtitle')) return 'staff';
  return null;
}

function validDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? isoDate(date) : null;
}

// Returns an ISO date, '' for an empty cell, or null when the value cannot be read as a date.
function cellToDate(value, date1904) {
  if (value === '' || value == null) return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null;
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value + (date1904 ? 1462 : 0)) * 86400000);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoDate(value);

  const text = str(value)
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text);
  if (match) {
    // Day first, unless the numbers only make sense month first.
    let day = Number(match[1]);
    let month = Number(match[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return validDate(Number(match[3]), month, day);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : isoDate(parsed);
}

function parseWorkbook(book, XLSX) {
  const date1904 = Boolean(book.Workbook?.WBProps?.date1904);
  const result = { staff: [], projects: [], tasks: [], sheets: [], warnings: [] };

  book.SheetNames.forEach((sheetName) => {
    const sheet = book.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) return;
    const firstRow = XLSX.utils.decode_range(sheet['!ref']).s.r;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
    const headerIndex = rows.findIndex((row) => row.some((cell) => str(cell)));
    if (headerIndex < 0) return;

    const headers = rows[headerIndex].map(keyOf);
    const type = detectSheetType(sheetName, headers);
    if (!type) return;

    const fieldsByColumn = {};
    const used = new Set();
    headers.forEach((header, column) => {
      const field = Object.keys(COLUMN_ALIASES[type]).find((name) => !used.has(name) && COLUMN_ALIASES[type][name].includes(header));
      if (field) {
        fieldsByColumn[column] = field;
        used.add(field);
      }
    });

    const keyField = KEY_FIELD[type];
    if (!used.has(keyField)) {
      result.warnings.push(`Sheet "${sheetName}" was skipped because it has no ${keyField === 'title' ? 'Title' : 'Name'} column.`);
      return;
    }

    let count = 0;
    rows.slice(headerIndex + 1).forEach((cells, offset) => {
      const rowNumber = firstRow + headerIndex + offset + 2;
      const record = {};
      Object.entries(fieldsByColumn).forEach(([column, field]) => {
        const raw = cells[column];
        if (DATE_FIELDS.has(field)) {
          const value = cellToDate(raw, date1904);
          if (value === null) result.warnings.push(`${sheetName}, row ${rowNumber}: "${str(raw)}" is not a date and was left empty.`);
          else if (value) record[field] = value;
          return;
        }
        const text = str(raw instanceof Date ? isoDate(raw) : raw);
        if (!text) return;
        const optionList = OPTION_FIELDS[type][field];
        if (optionList) {
          const matched = matchOption(text, optionList);
          if (matched) record[field] = matched;
          else result.warnings.push(`${sheetName}, row ${rowNumber}: ${field} "${text}" is not recognised and was skipped.`);
          return;
        }
        record[field] = text;
      });
      if (!record[keyField]) return;
      result[type].push(record);
      count += 1;
    });

    if (count) result.sheets.push({ name: sheetName, type, count });
  });

  return result;
}

async function readSpreadsheet(file) {
  const XLSX = await loadXLSX();
  if (/\.(csv|txt)$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let text;
    let encodingWarning = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      // Older Excel versions save CSV in the system code page rather than UTF-8.
      const arabic = (navigator.languages || [navigator.language]).some((lang) => /^(ar|fa|ur)\b/i.test(lang));
      text = new TextDecoder(arabic ? 'windows-1256' : 'windows-1252').decode(bytes);
      encodingWarning = 'This CSV file is not UTF-8, so some characters may be wrong. Saving it from Excel as "CSV UTF-8" or .xlsx avoids this.';
    }
    const parsed = parseWorkbook(XLSX.read(text.replace(/^\ufeff/, ''), { type: 'string', raw: true }), XLSX);
    if (encodingWarning) parsed.warnings.unshift(encodingWarning);
    return parsed;
  }
  return parseWorkbook(XLSX.read(await file.arrayBuffer(), { type: 'array' }), XLSX);
}

function splitNames(value) {
  return str(value)
    .split(/[,;\u060c\n]+/)
    .map(str)
    .filter(Boolean);
}

// Builds the data that would result from an import without changing anything yet.
function planImport(parsed, mode) {
  const next = mode === 'replace' ? { ...emptyData(), settings: { ...data.settings } } : structuredClone(data);
  const counts = { staff: { added: 0, updated: 0 }, projects: { added: 0, updated: 0 }, tasks: { added: 0, updated: 0 } };
  const staffByKey = new Map(next.staff.map((member) => [keyOf(member.name), member]));
  const projectsByKey = new Map(next.projects.map((project) => [keyOf(project.name), project]));
  const tasksByKey = new Map(next.tasks.map((task) => [`${task.projectId}|${keyOf(task.title)}`, task]));

  const upsertStaff = (fields) => {
    const key = keyOf(fields.name);
    const existing = staffByKey.get(key);
    if (existing) {
      Object.assign(existing, fields);
      counts.staff.updated += 1;
      return existing;
    }
    const member = { id: uid(), name: '', role: '', department: '', email: '', phone: '', status: DEFAULTS.staffStatus, ...fields };
    next.staff.push(member);
    staffByKey.set(key, member);
    counts.staff.added += 1;
    return member;
  };
  const staffRef = (name) => (keyOf(name) ? (staffByKey.get(keyOf(name)) || upsertStaff({ name })).id : '');

  const upsertProject = (fields, team) => {
    const key = keyOf(fields.name);
    const existing = projectsByKey.get(key);
    if (existing) {
      Object.assign(existing, fields);
      if (team) existing.team = team;
      counts.projects.updated += 1;
      return existing;
    }
    const project = { id: uid(), name: '', client: '', status: DEFAULTS.projectStatus, deadline: '', description: '', ...fields, team: team || [] };
    next.projects.push(project);
    projectsByKey.set(key, project);
    counts.projects.added += 1;
    return project;
  };
  const projectRef = (name) => (keyOf(name) ? (projectsByKey.get(keyOf(name)) || upsertProject({ name })).id : '');

  parsed.staff.forEach((row) => upsertStaff(row));

  parsed.projects.forEach(({ team, ...fields }) => {
    const teamIds = team ? [...new Set(splitNames(team).map(staffRef).filter(Boolean))] : null;
    upsertProject(fields, teamIds);
  });

  parsed.tasks.forEach(({ project, assignee, ...fields }) => {
    const projectId = project ? projectRef(project) : '';
    const key = `${projectId}|${keyOf(fields.title)}`;
    const existing = tasksByKey.get(key);
    if (existing) {
      Object.assign(existing, fields);
      if (assignee) existing.assigneeId = staffRef(assignee);
      counts.tasks.updated += 1;
      return;
    }
    const task = {
      id: uid(),
      title: '',
      projectId,
      assigneeId: assignee ? staffRef(assignee) : '',
      priority: DEFAULTS.priority,
      status: DEFAULTS.taskStatus,
      dueDate: '',
      description: '',
      attachments: [],
      ...fields
    };
    next.tasks.push(task);
    tasksByKey.set(key, task);
    counts.tasks.added += 1;
  });

  return { data: next, counts };
}

let pendingImport = null;

async function startImport(file) {
  let parsed;
  try {
    parsed = await readSpreadsheet(file);
  } catch (error) {
    console.error(error);
    const libraryProblem = /library/i.test(error.message);
    toast(libraryProblem ? error.message : `${file.name} could not be read. Use an Excel (.xlsx, .xls), OpenDocument (.ods) or CSV file.`, 'error');
    return;
  }
  if (!parsed.staff.length && !parsed.projects.length && !parsed.tasks.length) {
    toast(`No staff, projects or tasks were found in ${file.name}. Check that the column headers match the template.`, 'error');
    return;
  }
  pendingImport = { fileName: file.name, parsed };
  $('[data-form="import"]').reset();
  renderImportSummary();
  showDialog($('#dialog-import'));
}

function renderImportSummary() {
  const form = $('[data-form="import"]');
  const mode = new FormData(form).get('mode');
  const { parsed, fileName: name } = pendingImport;
  const { counts } = planImport(parsed, mode);
  const sheets = parsed.sheets.map((sheet) => `${esc(sheet.name)} (${plural(sheet.count, 'row')})`).join(', ');
  const rows = [
    ['Staff', counts.staff],
    ['Projects', counts.projects],
    ['Tasks', counts.tasks]
  ]
    .map(([label, count]) => `<tr><td>${label}</td><td class="num">${count.added}</td><td class="num">${count.updated}</td></tr>`)
    .join('');

  $('#import-summary').innerHTML = `
    <p class="import-source">Read ${sheets} from <strong>${bdi(name)}</strong>.</p>
    <table class="summary-table">
      <thead><tr><th>Records</th><th class="num">New</th><th class="num">Updated</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  const warnings = parsed.warnings;
  $('#import-warnings').innerHTML = warnings.length
    ? `<div class="warnings"><strong>${plural(warnings.length, 'note')}</strong><ul>${warnings
        .slice(0, 6)
        .map((warning) => `<li>${esc(warning)}</li>`)
        .join('')}${warnings.length > 6 ? `<li>and ${warnings.length - 6} more</li>` : ''}</ul></div>`
    : '';
}

function applyImport(form) {
  if (!pendingImport) return;
  const mode = new FormData(form).get('mode');
  const { data: next, counts } = planImport(pendingImport.parsed, mode);
  const normalized = normalizeData(next);
  const keep = new Set(attachmentIds(normalized));
  const orphaned = attachmentIds(data).filter((id) => !keep.has(id));

  data = normalized;
  pendingImport = null;
  form.closest('dialog').close();
  discardFiles(orphaned);

  const added = counts.staff.added + counts.projects.added + counts.tasks.added;
  const updated = counts.staff.updated + counts.projects.updated + counts.tasks.updated;
  commit(`Import complete: ${plural(added, 'record')} added, ${updated} updated.`);
}

/* ---------- Backup and restore ---------- */

async function downloadBackup() {
  const ids = attachmentIds(data);
  const files = [];
  let missing = 0;
  for (const id of ids) {
    try {
      const blob = await fileStore.get(id);
      if (blob) files.push({ id, data: await blobToDataURL(blob) });
      else missing += 1;
    } catch (error) {
      console.error(error);
      missing += 1;
    }
  }
  const backup = { app: APP_NAME, version: 2, exportedAt: new Date().toISOString(), data, files };
  downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), fileName(`backup-${todayISO()}.json`));
  if (missing) toast(`${plural(missing, 'attached file')} could not be read and ${missing === 1 ? 'is' : 'are'} missing from the backup.`, 'error');
}

async function restoreBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch (error) {
    toast(`${file.name} is not a valid backup file.`, 'error');
    return;
  }
  const source = backup && typeof backup.data === 'object' ? backup.data : backup;
  if (!source || !['staff', 'projects', 'tasks'].some((kind) => Array.isArray(source[kind]))) {
    toast(`${file.name} does not contain ${APP_NAME} data.`, 'error');
    return;
  }

  const restored = normalizeData(source);
  const confirmed = await confirmDialog({
    title: 'Restore this backup?',
    message: `Everything in this browser will be replaced with ${plural(restored.staff.length, 'staff member')}, ${plural(restored.projects.length, 'project')} and ${plural(restored.tasks.length, 'task')} from ${file.name}.`,
    confirmLabel: 'Replace and restore'
  });
  if (!confirmed) return;

  let failed = 0;
  try {
    await fileStore.clear();
  } catch (error) {
    console.error(error);
  }
  const wanted = new Set(attachmentIds(restored));
  for (const entry of list(backup.files)) {
    if (!entry || !wanted.has(entry.id)) continue;
    try {
      await fileStore.put(entry.id, await dataURLToBlob(entry.data));
    } catch (error) {
      console.error(error);
      failed += 1;
    }
  }

  data = restored;
  commit('Backup restored');
  if (failed) toast(`${plural(failed, 'attached file')} could not be restored.`, 'error');
}

async function clearAllData() {
  const confirmed = await confirmDialog({
    title: 'Delete all data?',
    message: 'Every staff member, project, task and attached file in this browser will be permanently deleted. Download a backup first if you may need them again.',
    confirmLabel: 'Delete everything'
  });
  if (!confirmed) return;
  data = { ...emptyData(), settings: data.settings };
  try {
    await fileStore.clear();
  } catch (error) {
    console.error(error);
  }
  commit('All data deleted');
}

/* ---------- Tour ---------- */

let tourIndex = -1;

function tourSeen() {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done';
  } catch (error) {
    return true;
  }
}

function markTourSeen() {
  try {
    localStorage.setItem(TOUR_KEY, 'done');
  } catch (error) {
    // Without storage the prompt simply shows again next time.
  }
}

function clearTourTarget() {
  $$('.tour-target').forEach((element) => element.classList.remove('tour-target'));
}

function showTourStep() {
  const step = TOUR[tourIndex];
  clearTourTarget();
  navigate(step.route);
  const target = $(step.target);
  if (target) {
    target.classList.add('tour-target');
    requestAnimationFrame(() => target.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
  $('#tour-step').textContent = `Step ${tourIndex + 1} of ${TOUR.length}`;
  $('#tour-title').textContent = step.title;
  $('#tour-text').textContent = step.text;
  $('[data-action="tour-back"]').disabled = tourIndex === 0;
  $('[data-action="tour-next"]').textContent = tourIndex === TOUR.length - 1 ? 'Finish' : 'Next';
  $('#tour').hidden = false;
  $('[data-action="tour-next"]').focus();
}

function startTour() {
  tourIndex = 0;
  $('#tour-notice').hidden = true;
  showTourStep();
}

function endTour() {
  tourIndex = -1;
  clearTourTarget();
  $('#tour').hidden = true;
  markTourSeen();
  render();
}

/* ---------- Events ---------- */

const ACTIONS = {
  new: (el) => {
    if (el.dataset.kind === 'staff') openStaffForm();
    if (el.dataset.kind === 'projects') openProjectForm();
    if (el.dataset.kind === 'tasks') {
      // Pre-fill the project or person the task list is currently filtered to.
      const { project, assignee } = filters.tasks;
      const fromList = currentRoute() === 'tasks';
      openTaskForm(null, {
        projectId: fromList && !project.startsWith('__') ? project : '',
        assigneeId: fromList && !assignee.startsWith('__') ? assignee : ''
      });
    }
  },
  edit: (el) => openRecord(el.dataset.kind, el.dataset.id),
  delete: (el) => deleteRecord(el.dataset.kind, el.dataset.id),
  sort: (el) => {
    const { kind, key } = el.dataset;
    const current = sorting[kind];
    sorting[kind] = { key, dir: current.key === key ? -current.dir : 1 };
    renderTable(kind);
    $(`[data-table="${kind}"] [data-key="${key}"]`)?.focus();
  },
  'clear-filters': (el) => {
    const kind = el.dataset.kind;
    Object.keys(filters[kind]).forEach((field) => {
      filters[kind][field] = '';
    });
    render();
  },
  'show-tasks': (el) => {
    if (el.dataset.project) showTasks({ project: el.dataset.project });
    if (el.dataset.assignee) showTasks({ assignee: el.dataset.assignee, status: '__open' });
  },
  'close-dialog': (el) => el.closest('dialog').close(),
  print: printView,
  'start-tour': startTour,
  'dismiss-tour': () => {
    markTourSeen();
    $('#tour-notice').hidden = true;
  },
  'tour-next': () => {
    if (tourIndex >= TOUR.length - 1) {
      endTour();
      return;
    }
    tourIndex += 1;
    showTourStep();
  },
  'tour-back': () => {
    tourIndex = Math.max(0, tourIndex - 1);
    showTourStep();
  },
  'tour-end': endTour,
  'add-files': () => $('#task-file-input').click(),
  'open-file': (el) => openDraftFile(el.dataset.file),
  'remove-file': (el) => removeDraftFile(el.dataset.file),
  import: () => $('#import-input').click(),
  restore: () => $('#restore-input').click(),
  'download-template': downloadTemplate,
  'export-xlsx': exportWorkbook,
  'export-csv': (el) => exportCSV(el.dataset.kind),
  'export-doc': exportWordReport,
  backup: downloadBackup,
  'clear-all': clearAllData
};

const SUBMITS = {
  staff: saveStaff,
  projects: saveProject,
  tasks: saveTask,
  import: applyImport,
  workspace: (form) => {
    data.settings.workspaceName = formValues(form).workspaceName || '';
    commit('Workspace name saved');
  }
};

function openRecord(kind, id) {
  if (kind === 'staff') openStaffForm(id);
  if (kind === 'projects') openProjectForm(id);
  if (kind === 'tasks') openTaskForm(id);
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (trigger) {
      ACTIONS[trigger.dataset.action]?.(trigger, event);
      return;
    }
    // Clicking anywhere on a table row opens it, unless the click was on a control or selected text.
    const row = event.target.closest('tr[data-id]');
    if (row && !event.target.closest('a, button, input, select, label') && !String(window.getSelection())) {
      openRecord(row.dataset.kind, row.dataset.id);
    }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (target.setCustomValidity) target.setCustomValidity('');
    if (target.dataset.filter) {
      const [kind, field] = target.dataset.filter.split('.');
      filters[kind][field] = target.value;
      renderTable(kind);
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.change === 'task-status') updateTaskStatus(target.dataset.id, target.value);
    if (target.name === 'mode' && pendingImport) renderImportSummary();
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    const handler = SUBMITS[form.dataset.form];
    if (!handler) return;
    event.preventDefault();
    handler(form);
  });

  $('#import-input').addEventListener('change', (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) startImport(file);
  });

  $('#restore-input').addEventListener('change', (event) => {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) restoreBackup(file);
  });

  $('#task-file-input').addEventListener('change', (event) => {
    addDraftFiles(event.target.files);
    event.target.value = '';
  });

  const dropzone = $('#task-dropzone');
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
  dropzone.addEventListener('dragover', (event) => {
    if (!hasFiles(event) || $('[data-action="add-files"]').disabled) return;
    event.preventDefault();
    dropzone.classList.add('is-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', (event) => {
    dropzone.classList.remove('is-over');
    if (!hasFiles(event) || $('[data-action="add-files"]').disabled) return;
    event.preventDefault();
    event.stopPropagation();
    addDraftFiles(event.dataTransfer.files);
  });

  // Dropping a file outside the drop area would otherwise make the browser leave the page.
  window.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });

  $('#dialog-tasks').addEventListener('close', () => {
    taskDraft = null;
  });
  $('#dialog-import').addEventListener('close', () => {
    pendingImport = null;
  });

  window.addEventListener('hashchange', () => {
    render();
    window.scrollTo(0, 0);
    if (tourIndex < 0) $(`[data-view="${currentRoute()}"] h1`)?.focus({ preventScroll: true });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tourIndex >= 0 && !$('dialog[open]')) endTour();
  });
}

function fillStaticSelects() {
  $$('select[data-options]').forEach((select) => {
    const lead = [];
    if (select.dataset.all) lead.push({ value: '', label: select.dataset.all });
    if (select.dataset.open) lead.push({ value: '__open', label: select.dataset.open });
    const options = OPTIONS[select.dataset.options].map((value) => ({ value, label: value }));
    fillSelect(select, [...lead, ...options], '');
  });
}

function init() {
  fillStaticSelects();
  bindEvents();
  render();
  fileStore.open().catch(() => {
    $('[data-action="add-files"]').disabled = true;
    $('#files-hint').textContent = 'File attachments are not available in this browser.';
  });
}

init();
