export class ApiError extends Error {
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function notFound(msg = '资源不存在') {
  return new ApiError(404, msg, 'NOT_FOUND');
}

export function forbidden(msg = '没有权限执行该操作') {
  return new ApiError(403, msg, 'FORBIDDEN');
}

export function badRequest(msg, code = 'BAD_REQUEST') {
  return new ApiError(400, msg, code);
}
