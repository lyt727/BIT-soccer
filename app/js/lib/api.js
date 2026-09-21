const TOKEN_KEY = 'gb_token';
const USER_KEY = 'gb_user';

export const session = {
  user: null,
  token: '',

  restore() {
    this.token = localStorage.getItem(TOKEN_KEY) || '';
    try { this.user = JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { this.user = null; }
  },

  save(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  updateUser(user) {
    this.user = user;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clear() {
    this.token = '';
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    if (res.status === 401) {
      session.clear();
      if (!location.hash.includes('login')) location.hash = '#/login';
    }
    throw new ApiError(data?.error || `请求失败（${res.status}）`, res.status, data?.code);
  }
  return data;
}

export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseResponse(res);
}

export async function apiBlob(path) {
  const res = await fetch(`/api${path}`, {
    headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(text || '加载失败', res.status);
  }
  return res.blob();
}

// 图片压缩转 dataURL（注册材料 / AI 识图上传通用）
export function fileToDataUrl(file, maxDim = 1280) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      reject(new Error('仅支持 JPG/PNG 图片'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      resolve({ dataUrl: canvas.toDataURL(mime, 0.88), name: file.name, size: canvas.width * canvas.height });
    };
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = url;
  });
}

export function hasPerm(user, action) {
  if (!user) return false;
  return (user.permissions || []).includes(action) || user.role === 'admin';
}

export function isStaffFor(user, event, minRole = null) {
  if (user?.role === 'admin') return true;
  const r = event?.staffRole;
  if (!r) return false;
  if (!minRole) return true;
  const order = { data_operator: 1, admin: 2 };
  return order[r] >= order[minRole];
}
