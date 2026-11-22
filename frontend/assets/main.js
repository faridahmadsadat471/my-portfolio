const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');
const themeToggle = document.querySelector('#site-theme-toggle');
function setPortfolioTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('portfolio-dashboard-theme', theme);
  themeToggle.textContent = theme === 'dark' ? '☀' : '☾';
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
}
setPortfolioTheme(localStorage.getItem('portfolio-dashboard-theme') || 'light');
themeToggle.addEventListener('click', () => setPortfolioTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
function closeMenu() {
  menuButton.setAttribute('aria-expanded', 'false');
  navigation.classList.remove('open');
}
menuButton.addEventListener('click', () => {
  const expanded = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!expanded));
  navigation.classList.toggle('open', !expanded);
});
navigation.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation.classList.contains('open')) { closeMenu(); menuButton.focus(); }
});
window.matchMedia('(min-width: 521px)').addEventListener('change', event => { if (event.matches) closeMenu(); });
document.querySelector('#year').textContent = String(new Date().getFullYear());

function safeWebUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}
function renderSkills(skills) {
  const list = document.querySelector('#technology-list');
  const values = Array.isArray(skills) ? skills.filter(skill => typeof skill === 'string' && skill.trim()) : [];
  list.replaceChildren();
  for (const skill of values) {
    const item = document.createElement('li');
    item.textContent = skill;
    list.append(item);
  }
}
function renderProjects(projects) {
  const list = document.querySelector('#project-list');
  const valid = Array.isArray(projects) ? projects.filter(project => project && typeof project.title === 'string' && typeof project.description === 'string') : [];
  list.replaceChildren();
  for (const project of valid) {
    const card = document.createElement('article'); card.className = 'project-card';
    const heading = document.createElement('h3'); heading.textContent = project.title;
    const description = document.createElement('p'); description.textContent = project.description;
    const stack = document.createElement('div'); stack.className = 'project-technologies';
    for (const name of Array.isArray(project.technologies) ? project.technologies : []) {
      const tag = document.createElement('span'); tag.textContent = String(name); stack.append(tag);
    }
    const links = document.createElement('div'); links.className = 'project-links';
    for (const [value, label] of [[project.github, 'Source code'], [project.live, 'Live website']]) {
      const url = safeWebUrl(value); if (!url) continue;
      const link = document.createElement('a'); Object.assign(link, { href: url, textContent: label, target: '_blank', rel: 'noopener noreferrer' }); links.append(link);
    }
    card.append(heading, description, stack, links); list.append(card);
  }
  document.querySelector('#projects-coming').hidden = valid.length > 0;
}
async function loadProjects() {
  for (const url of ['/api/projects', '/assets/profile.json']) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const data = await response.json();
      renderProjects(Array.isArray(data) ? data : data.projects);
      return;
    } catch { /* Static content remains useful when the API is unavailable. */ }
  }
}
loadProjects();
fetch('/api/profile', { signal: AbortSignal.timeout(5000) }).then(response => response.ok ? response.json() : null).then(profile => {
  if (!profile) return;
  renderSkills(profile.skills);
  if (!profile?.photoUrl) return;
  document.querySelectorAll('.profile-brand-photo').forEach(image => {
    image.src = profile.photoUrl;
    image.hidden = false;
  });
  document.querySelectorAll('.brand-symbol').forEach(symbol => { symbol.hidden = true; });
  const aboutPhoto = document.querySelector('#about-profile-photo');
  aboutPhoto.src = profile.photoUrl;
  aboutPhoto.hidden = false;
  document.querySelector('#about-photo-placeholder').hidden = true;
}).catch(() => {});

const form = document.querySelector('#contact-form');
const status = document.querySelector('#form-status');
const submitButton = form.querySelector('button[type="submit"]');
let sending = false;
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !form.reportValidity()) return;
  status.classList.remove('error');
  const values = Object.fromEntries(new FormData(form));
  for (const key of ['name', 'email', 'subject', 'message']) values[key] = values[key].trim();
  if (values.name.length < 2 || values.message.length < 10 || !values.subject) {
    status.textContent = 'Please add your name, a subject, and a message of at least 10 characters.';
    status.classList.add('error'); return;
  }
  sending = true; submitButton.disabled = true; submitButton.textContent = 'Sending…';
  status.textContent = '';
  try {
    const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values), signal: AbortSignal.timeout(45000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Your message could not be sent. Please try again or email me directly.');
    status.textContent = data.emailNotification === 'sent'
      ? 'Thank you! Your message was sent successfully. I’ll get back to you by email.'
      : data.emailNotification === 'failed'
        ? 'Your message was saved, but the email notification could not be delivered. I’ll still see it in the dashboard.'
        : 'Your message was saved, but email notifications are not configured yet. I’ll still see it in the dashboard.';
    form.reset();
  } catch (error) {
    status.classList.add('error');
    status.textContent = error.name === 'TimeoutError' ? 'The connection timed out. Please try again or email me directly.' : (error.message === 'Failed to fetch' ? 'Unable to connect. Please try again or email me directly.' : error.message);
  } finally { sending = false; submitButton.disabled = false; submitButton.textContent = 'Send message'; }
});

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) navigation.querySelectorAll('a').forEach(link => {
      if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }, { rootMargin: '-15% 0px -55% 0px' });
  document.querySelectorAll('main>section[id]').forEach(section => observer.observe(section));
}
