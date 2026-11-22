import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element extends EventTarget {
  children = [];
  dataset = {};
  hidden = false;
  value = '';
  textContent = '';
  classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  removeAttribute() {}
  querySelector() { return new Element(); }
  querySelectorAll() { return []; }
  focus() {}
}

function environment() {
  const elements = new Map();
  const document = {
    documentElement: new Element(),
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    querySelectorAll() { return []; },
    createElement() { return new Element(); },
    addEventListener() {}
  };
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  return { document, localStorage: storage, sessionStorage: storage, window: { matchMedia() { return { addEventListener() {} }; } }, AbortSignal, Uint8Array, Date, URL, btoa };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('homepage renders API skills and profile photos with empty or populated projects', async () => {
  const script = await readFile(new URL('../../frontend/assets/main.js', import.meta.url), 'utf8');
  for (const projects of [[], [{ title: 'Real project', description: 'A useful portfolio project.', technologies: ['Node.js'] }]]) {
    const context = environment();
    context.fetch = async url => ({ ok: true, async json() { return url === '/api/projects' ? projects : { skills: ['Dynamic skill'], photoUrl: '/api/profile/photo' }; } });
    vm.runInNewContext(script, context);
    await settle();
    assert.deepEqual(context.document.querySelector('#technology-list').children.map(node => node.textContent), ['Dynamic skill']);
    assert.equal(context.document.querySelector('#about-profile-photo').src, '/api/profile/photo');
    assert.equal(context.document.querySelector('#about-photo-placeholder').hidden, true);
    assert.equal(context.document.querySelector('#project-list').children.length, projects.length);
    assert.equal(context.document.querySelector('#projects-coming').hidden, projects.length > 0);
  }
});

test('photo upload resets the file input after the asynchronous request finishes', async () => {
  const context = environment();
  const requests = [];
  context.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, async json() { return { photoUrl: '/api/profile/photo' }; } };
  };
  vm.runInNewContext(await readFile(new URL('../../frontend/assets/dashboard.js', import.meta.url), 'utf8'), context);
  const input = context.document.querySelector('#profile-photo-file');
  input.files = [{ size: 8, type: 'image/png', async arrayBuffer() { return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer; } }];
  input.value = 'selected-photo.png';
  input.dispatchEvent(new Event('change'));
  await settle();
  assert.equal(requests[0].url, '/api/admin/profile-photo');
  assert.equal(input.value, '');
  assert.equal(context.document.querySelector('#photo-status').textContent, 'Your photo is now on your portfolio.');
});
