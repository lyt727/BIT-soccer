import { api, session } from '../lib/api.js';
import { el, clear, toast } from '../lib/ui.js';

const DEMO_PASSWORD = '123456';

const DEMO = [
  ['13900000001', 'lby', '管理员'],
  ['13900000003', 'ljz', '数据录入员'],
  ['13800138001', 'zht', '参赛球员'],
  ['13800138002', 'clm', '参赛球员'],
];

export async function renderLogin(container) {
  clear(container);
  const wrap = el('div', { class: 'login-wrap' });
  wrap.append(
    el('div', { class: 'login-logo' },
      el('img', { src: '/icon.png', alt: '绿茵BIT' }),
      el('h1', {}, '绿茵BIT'),
      el('p', {}, '北理工校园足球赛事管理系统')),
  );

  const state = { mode: 'login', method: 'password' };
  const card = el('div', { class: 'card auth-card' });
  wrap.append(card);
  renderAuthCard(card, state);

  const demoBox = el('div', { class: 'card demo-box' },
    el('div', { class: 'row between' },
      el('b', {}, '演示账号（点击填入手机号）'),
      el('span', { class: 'small muted' }, `登录密码统一为 ${DEMO_PASSWORD}`)),
    el('div', { class: 'demo-accounts' },
      DEMO.map(([phone, name, role]) => el('button', {
        type: 'button',
        onclick: () => {
          state.mode = 'login';
          state.method = 'password';
          renderAuthCard(card, state);
          const phoneInput = card.querySelector('#login-phone');
          const pwdInput = card.querySelector('#login-password');
          if (phoneInput) {
            phoneInput.value = phone;
            phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (pwdInput) pwdInput.value = DEMO_PASSWORD;
          toast(`已填入 ${name}（${role}）的账号与密码`);
        },
      },
      el('span', {},
        el('div', { style: { fontWeight: '600', fontSize: '14px' } }, `${name} · ${role}`),
        el('div', { class: 'small muted' }, phone))))),
  );
  wrap.append(demoBox);
  container.append(wrap);
}

function renderAuthCard(card, state) {
  clear(card);
  const tabs = el('div', { class: 'auth-tabs' },
    tabBtn('登录', state.mode === 'login', () => {
      state.mode = 'login'; state.method = 'password'; renderAuthCard(card, state);
    }),
    tabBtn('注册', state.mode === 'register', () => {
      state.mode = 'register'; renderAuthCard(card, state);
    }));
  card.append(tabs);
  if (state.mode === 'login' && state.method === 'code') card.append(codeLoginForm(card, state));
  else if (state.mode === 'login') card.append(loginForm(card, state));
  else card.append(registerForm(card));
}

function tabBtn(label, active, onClick) {
  return el('button', {
    class: `auth-tab ${active ? 'active' : ''}`,
    type: 'button',
    onclick: onClick,
  }, label);
}

function switchLink(label, onClick) {
  return el('button', {
    type: 'button',
    style: {
      background: 'none', border: 'none', padding: '10px 0 0',
      color: '#0b7a43', fontSize: '13px', cursor: 'pointer',
      textDecoration: 'underline', display: 'block', margin: '0 auto',
    },
    onclick: onClick,
  }, label);
}

function codeRow(phoneInput, scene) {
  const codeInput = el('input', {
    id: scene === 'register' ? 'reg-code-input' : 'login-code-input',
    type: 'text', inputmode: 'numeric',
    maxlength: 6, placeholder: '6 位验证码', autocomplete: 'one-time-code',
  });
  const sendBtn = el('button', {
    class: 'btn outline', type: 'button', style: { whiteSpace: 'nowrap' },
  }, '获取验证码');
  let timer = null;
  sendBtn.onclick = async () => {
    const phone = phoneInput.value.trim();
    if (!/^1\d{10}$/.test(phone)) {
      toast('请先输入正确的 11 位手机号', 'error');
      return;
    }
    sendBtn.disabled = true;
    try {
      const data = await api('/auth/send-code', {
        method: 'POST', auth: false,
        body: { phone, scene },
      });
      if (data.demoCode) {
        codeInput.value = data.demoCode;
        toast(`演示验证码：${data.demoCode}（已自动填入）`, 'success', 3200);
      } else {
        toast('验证码已发送', 'success');
      }
      let left = 60;
      sendBtn.textContent = `${left}s 后重发`;
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          sendBtn.disabled = false;
          sendBtn.textContent = '重新获取';
        } else {
          sendBtn.textContent = `${left}s 后重发`;
        }
      }, 1000);
    } catch (err) {
      sendBtn.disabled = false;
      toast(err.message, 'error');
    }
  };
  return {
    wrap: el('div', { class: 'code-row' }, codeInput, sendBtn),
    input: codeInput,
    sendBtn,
  };
}

function loginForm(card, state) {
  const phoneInput = el('input', {
    id: 'login-phone', type: 'tel', maxlength: 11, inputmode: 'numeric',
    placeholder: '请输入手机号', autocomplete: 'username',
  });
  const pwdInput = el('input', {
    id: 'login-password', type: 'password',
    placeholder: '请输入登录密码', autocomplete: 'current-password',
  });
  return el('div', {},
    labelField('手机号', phoneInput),
    labelField('密码', pwdInput),
    el('button', {
      id: 'login-btn', class: 'btn primary block', type: 'button',
      style: { marginTop: '8px' },
      onclick: async (e) => {
        const btnEl = e.currentTarget;
        if (!phoneInput.value.trim() || !pwdInput.value) {
          toast('请输入手机号和密码', 'error');
          return;
        }
        btnEl.disabled = true;
        try {
          const data = await api('/auth/login-password', {
            method: 'POST', auth: false,
            body: {
              phone: phoneInput.value.trim(),
              password: pwdInput.value,
            },
          });
          session.save(data.token, data.user);
          toast(`欢迎回来，${data.user.name}`, 'success');
          location.hash = '#/home';
        } catch (err) { toast(err.message, 'error'); }
        btnEl.disabled = false;
      },
    }, '登 录'),
    switchLink('使用短信验证码登录', () => {
      state.method = 'code';
      renderAuthCard(card, state);
    }),
    switchLink('忘记密码？请联系管理员重置', () => {
      toast('请把姓名和手机号发给管理员，由管理员重置密码', 'success', 3600);
    }),
  );
}

function codeLoginForm(card, state) {
  const phoneInput = el('input', {
    id: 'login-phone', type: 'tel', maxlength: 11, inputmode: 'numeric',
    placeholder: '请输入手机号',
  });
  const row = codeRow(phoneInput, 'login');
  return el('div', {},
    labelField('手机号', phoneInput),
    labelField('验证码', row.wrap),
    el('button', {
      id: 'login-btn', class: 'btn primary block', type: 'button',
      style: { marginTop: '8px' },
      onclick: async (e) => {
        const btnEl = e.currentTarget;
        btnEl.disabled = true;
        try {
          const data = await api('/auth/login-code', {
            method: 'POST', auth: false,
            body: {
              phone: phoneInput.value.trim(),
              code: row.input.value.trim(),
            },
          });
          session.save(data.token, data.user);
          toast(`欢迎回来，${data.user.name}`, 'success');
          location.hash = '#/home';
        } catch (err) { toast(err.message, 'error'); }
        btnEl.disabled = false;
      },
    }, '登 录'),
    switchLink('改用手机号 + 密码登录', () => {
      state.method = 'password';
      renderAuthCard(card, state);
    }),
  );
}

function registerForm(card) {
  const nameInput = el('input', { id: 'reg-name', placeholder: '真实姓名' });
  const phoneInput = el('input', {
    id: 'reg-phone', type: 'tel', maxlength: 11, inputmode: 'numeric',
    placeholder: '请输入手机号',
  });
  const pwdInput = el('input', {
    id: 'reg-password', type: 'password', placeholder: '设置密码（至少 6 位）',
  });
  const pwd2Input = el('input', {
    id: 'reg-password2', type: 'password', placeholder: '请再次输入密码',
  });
  return el('div', {},
    labelField('姓名', nameInput),
    labelField('手机号', phoneInput),
    labelField('密码', pwdInput),
    labelField('确认密码', pwd2Input),
    el('button', {
      id: 'register-btn', class: 'btn primary block', type: 'button',
      style: { marginTop: '8px' },
      onclick: async (e) => {
        const btnEl = e.currentTarget;
        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();
        const password = pwdInput.value;
        if (!name) { toast('请填写真实姓名', 'error'); return; }
        if (!/^1\d{10}$/.test(phone)) { toast('请输入正确的 11 位手机号', 'error'); return; }
        if (password.length < 6) { toast('密码至少 6 位', 'error'); return; }
        if (password !== pwd2Input.value) { toast('两次输入的密码不一致', 'error'); return; }
        btnEl.disabled = true;
        try {
          const data = await api('/auth/register', {
            method: 'POST', auth: false,
            body: { name, phone, password },
          });
          session.save(data.token, data.user);
          toast('注册成功，已自动登录', 'success');
          location.hash = '#/home';
        } catch (err) { toast(err.message, 'error'); }
        btnEl.disabled = false;
      },
    }, '注册并登录'));
}

function labelField(label, input) {
  return el('label', { class: 'field' },
    el('span', {}, label), input);
}
