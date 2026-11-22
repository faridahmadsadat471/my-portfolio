const keyInput = document.querySelector('#dashboard-key');
const unlockButton = document.querySelector('#unlock');
const loginStatus = document.querySelector('#login-status');
const loginScreen = document.querySelector('#login-screen');
const studio = document.querySelector('#studio');
const panels = [...document.querySelectorAll('.studio-panel')];
const navItems = [...document.querySelectorAll('.studio-nav-item')];
const appStatus = document.querySelector('#app-status');
let dashboardKey = '';
let projects = [];
let skills = [];
let messages = [];

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('portfolio-dashboard-theme', theme);
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  document.querySelectorAll('#theme-toggle, #login-theme').forEach(button => {
    button.textContent = theme === 'dark' ? '☀' : '☾';
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}
setTheme(localStorage.getItem('portfolio-dashboard-theme') || 'light');
document.querySelectorAll('#theme-toggle, #login-theme').forEach(button => {
  button.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
});

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'x-dashboard-key': dashboardKey, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function showPanel(name) {
  for (const panel of panels) panel.hidden = panel.id !== `panel-${name}`;
  for (const item of navItems) {
    const active = item.dataset.panel === name;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  const titles = { overview: 'Overview', projects: 'Projects', skills: 'Skills', messages: 'Messages', profile: 'Profile' };
  document.querySelector('#page-title').textContent = titles[name];
  appStatus.hidden = true;
}

function textElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function createProjectCard(project, editable = false) {
  const card = document.createElement('article');
  card.className = 'admin-project-card card bg-base-100';
  const top = document.createElement('div');
  top.className = 'project-card-top';
  top.append(textElement('span', 'project-card-mark', '</>'));
  if (editable) {
    const actions = document.createElement('div');
    actions.className = 'project-card-actions';
    const edit = textElement('button', 'btn btn-ghost btn-xs', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => editProject(project));
    const remove = textElement('button', 'btn btn-ghost btn-xs text-error', 'Delete');
    remove.type = 'button';
    remove.addEventListener('click', () => deleteProject(project));
    actions.append(edit, remove);
    top.append(actions);
  }
  card.append(top, textElement('h3', 'admin-project-title', project.title), textElement('p', 'admin-project-description', project.description));
  const tags = document.createElement('div');
  tags.className = 'admin-project-tags';
  for (const technology of project.technologies || []) tags.append(textElement('span', 'badge badge-outline', technology));
  if (tags.childElementCount) card.append(tags);
  const links = document.createElement('div');
  links.className = 'admin-project-links';
  for (const [url, label] of [[project.github, 'Source code'], [project.live, 'Live project']]) {
    if (!url) continue;
    const link = textElement('a', '', `${label} ↗`);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  if (links.childElementCount) card.append(links);
  return card;
}

function renderProjects() {
  const list = document.querySelector('#project-list');
  const overview = document.querySelector('#overview-projects');
  list.replaceChildren();
  overview.replaceChildren();
  document.querySelector('#project-empty').hidden = projects.length > 0;
  document.querySelector('#nav-project-count').textContent = String(projects.length);
  document.querySelector('#overview-project-count').textContent = String(projects.length);
  for (const project of projects) {
    list.append(createProjectCard(project, true));
    if (overview.childElementCount < 3) overview.append(createProjectCard(project));
  }
  if (!projects.length) overview.append(textElement('p', 'overview-empty', 'Your projects will appear here. Add your first one to get started.'));
}

function renderMessages() {
  const list = document.querySelector('#message-list');
  list.replaceChildren();
  document.querySelector('#message-empty').hidden = messages.length > 0;
  document.querySelector('#nav-message-count').textContent = String(messages.length);
  for (const message of messages) {
    const card = document.createElement('article');
    card.className = 'inbox-message card bg-base-100';
    const heading = document.createElement('div');
    heading.className = 'inbox-message-heading';
    heading.append(textElement('h3', '', message.subject), textElement('time', '', new Date(message.createdAt).toLocaleString()));
    card.append(heading, textElement('p', 'inbox-sender', `${message.name} · ${message.email}`), textElement('p', 'inbox-message-body', message.message));
    const reply = textElement('a', 'btn btn-outline btn-sm inbox-reply', 'Reply by email');
    reply.href = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`;
    card.append(reply);
    list.append(card);
  }
}

function setPhoto(url) {
  const preview = document.querySelector('#profile-photo-preview');
  const placeholder = document.querySelector('#profile-photo-placeholder');
  preview.hidden = !url;
  placeholder.hidden = Boolean(url);
  document.querySelector('#remove-photo').hidden = !url;
  preview.src = url ? `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}` : '';
  document.querySelectorAll('.profile-brand-photo').forEach(image => {
    image.src = url ? `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}` : '';
    image.hidden = !url;
  });
  document.querySelectorAll('.brand-symbol').forEach(symbol => { symbol.hidden = Boolean(url); });
}

async function loadDashboard() {
  const [stats, projectRows, skillRows, messageRows, photo] = await Promise.all([
    api('/api/admin/stats'),
    api('/api/admin/projects'),
    api('/api/admin/skills'),
    api('/api/admin/messages?limit=100'),
    api('/api/admin/profile-photo')
  ]);
  projects = projectRows;
  skills = skillRows;
  messages = messageRows;
  document.querySelector('#overview-message-count').textContent = String(stats.total);
  renderProjects();
  renderSkills();
  renderMessages();
  document.querySelector('#overview-message-count').textContent = String(stats.total);
  setPhoto(photo.photoUrl);
}

function renderSkills() {
  const list = document.querySelector('#skills-list');
  list.replaceChildren();
  for (const [index, skill] of skills.entries()) {
    const item = document.createElement('span');
    item.className = 'skill-admin-chip';
    item.append(textElement('span', '', skill));
    const remove = textElement('button', '', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${skill}`);
    remove.addEventListener('click', () => {
      skills.splice(index, 1);
      renderSkills();
    });
    item.append(remove);
    list.append(item);
  }
  document.querySelector('#skills-count').textContent = `${skills.length} / 40`;
  document.querySelector('#nav-skill-count').textContent = String(skills.length);
}

function resetProjectForm() {
  document.querySelector('#project-form').reset();
  document.querySelector('#project-id').value = '';
  document.querySelector('#project-form-title').textContent = 'Add a project';
  document.querySelector('#project-status').textContent = '';
  document.querySelector('#project-form').hidden = true;
}

function openProjectForm(project = null) {
  const form = document.querySelector('#project-form');
  form.hidden = false;
  document.querySelector('#project-id').value = project?.id || '';
  document.querySelector('#project-title').value = project?.title || '';
  document.querySelector('#project-description').value = project?.description || '';
  document.querySelector('#project-technologies').value = project?.technologies?.join(', ') || '';
  document.querySelector('#project-github').value = project?.github || '';
  document.querySelector('#project-live').value = project?.live || '';
  document.querySelector('#project-form-title').textContent = project ? 'Edit project' : 'Add a project';
  document.querySelector('#project-status').textContent = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelector('#project-title').focus();
}

function editProject(project) {
  showPanel('projects');
  openProjectForm(project);
}

async function deleteProject(project) {
  if (!window.confirm(`Delete “${project.title}” from your portfolio?`)) return;
  try {
    await api(`/api/admin/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
    projects = projects.filter(item => item.id !== project.id);
    renderProjects();
    appStatus.textContent = 'Project deleted.';
    appStatus.hidden = false;
  } catch (error) {
    appStatus.textContent = error.message;
    appStatus.hidden = false;
  }
}

unlockButton.addEventListener('click', async () => {
  dashboardKey = keyInput.value.trim();
  if (!dashboardKey) { loginStatus.textContent = 'Enter your dashboard key to continue.'; return; }
  unlockButton.disabled = true;
  loginStatus.textContent = '';
  try {
    await loadDashboard();
    sessionStorage.setItem('portfolio-dashboard-key', dashboardKey);
    loginScreen.hidden = true;
    studio.hidden = false;
    showPanel('overview');
  } catch (error) {
    loginStatus.textContent = error.message;
  } finally {
    unlockButton.disabled = false;
  }
});
keyInput.addEventListener('keydown', event => { if (event.key === 'Enter') unlockButton.click(); });

document.querySelector('#logout').addEventListener('click', () => {
  sessionStorage.removeItem('portfolio-dashboard-key');
  dashboardKey = '';
  studio.hidden = true;
  loginScreen.hidden = false;
  keyInput.value = '';
  loginStatus.textContent = '';
  keyInput.focus();
});

for (const item of navItems) item.addEventListener('click', () => showPanel(item.dataset.panel));
document.querySelectorAll('[data-open-panel]').forEach(button => button.addEventListener('click', () => {
  showPanel(button.dataset.openPanel);
  if (button.dataset.openPanel === 'projects') openProjectForm();
}));
document.querySelector('#new-project').addEventListener('click', () => openProjectForm());
document.querySelectorAll('[data-open-form]').forEach(button => button.addEventListener('click', () => openProjectForm()));
document.querySelector('#cancel-project').addEventListener('click', resetProjectForm);

document.querySelector('#project-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.querySelector('#project-id').value;
  const project = {
    title: document.querySelector('#project-title').value.trim(),
    description: document.querySelector('#project-description').value.trim(),
    technologies: document.querySelector('#project-technologies').value.split(',').map(value => value.trim()).filter(Boolean),
    github: document.querySelector('#project-github').value.trim(),
    live: document.querySelector('#project-live').value.trim()
  };
  const button = event.currentTarget.querySelector('[type="submit"]');
  const status = document.querySelector('#project-status');
  button.disabled = true;
  status.textContent = '';
  try {
    const saved = await api(id ? `/api/admin/projects/${encodeURIComponent(id)}` : '/api/admin/projects', { method: id ? 'PUT' : 'POST', body: JSON.stringify(project) });
    projects = id ? projects.map(item => item.id === id ? saved : item) : [...projects, saved];
    renderProjects();
    resetProjectForm();
    appStatus.textContent = id ? 'Project updated and published.' : 'Project added and published.';
    appStatus.hidden = false;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function addSkill() {
  const input = document.querySelector('#new-skill');
  const skill = input.value.trim();
  const status = document.querySelector('#skills-status');
  status.textContent = '';
  if (!skill) { status.textContent = 'Enter a skill name first.'; return; }
  if (skills.some(value => value.toLocaleLowerCase() === skill.toLocaleLowerCase())) {
    status.textContent = 'That skill is already in your toolkit.';
    return;
  }
  if (skills.length >= 40) { status.textContent = 'You can add up to 40 skills.'; return; }
  skills.push(skill);
  input.value = '';
  renderSkills();
  input.focus();
}

document.querySelector('#add-skill').addEventListener('click', addSkill);
document.querySelector('#new-skill').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); addSkill(); }
});
document.querySelector('#skills-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  const status = document.querySelector('#skills-status');
  button.disabled = true;
  status.textContent = '';
  try {
    skills = await api('/api/admin/skills', { method: 'PUT', body: JSON.stringify({ skills }) });
    renderSkills();
    status.textContent = 'Skills saved and published to your portfolio.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#toggle-key-visibility').addEventListener('click', event => {
  const button = event.currentTarget;
  const showing = keyInput.type === 'password';
  keyInput.type = showing ? 'text' : 'password';
  button.setAttribute('aria-label', showing ? 'Hide dashboard key' : 'Show dashboard key');
  button.setAttribute('aria-pressed', String(showing));
});

document.querySelector('#profile-photo-file').addEventListener('change', async event => {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  const status = document.querySelector('#photo-status');
  if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    status.textContent = 'Choose a PNG, JPEG, or WebP image up to 2 MB.';
    input.value = '';
    return;
  }
  status.textContent = 'Uploading photo…';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    const result = await api('/api/admin/profile-photo', { method: 'POST', body: JSON.stringify({ contentType: file.type, data: btoa(binary) }) });
    setPhoto(result.photoUrl);
    status.textContent = 'Your photo is now on your portfolio.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    input.value = '';
  }
});

document.querySelector('#remove-photo').addEventListener('click', async () => {
  const status = document.querySelector('#photo-status');
  try {
    await api('/api/admin/profile-photo', { method: 'DELETE' });
    setPhoto('');
    status.textContent = 'Profile photo removed.';
  } catch (error) {
    status.textContent = error.message;
  }
});

const savedKey = sessionStorage.getItem('portfolio-dashboard-key');
if (savedKey) {
  keyInput.value = savedKey;
  unlockButton.click();
}
